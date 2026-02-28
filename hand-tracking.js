// ============================================================
//  hand-tracking.js
//  Hand Tracking Logic — MediaPipe + WebSocket Unity Bridge
//
//  DEPENDENCIES (loaded before this file in hand-tracking-display.html):
//    @mediapipe/hands
//    @mediapipe/camera_utils
//    @mediapipe/drawing_utils
//
//  STARTUP ORDER:
//    1. python relay.py
//    2. Open hand-tracking-display.html in Chrome, allow camera
//    3. Hit Play in Unity
//
//  FILE STRUCTURE:
//    1.  Configuration
//    2.  DOM references
//    3.  State
//    4.  FPS tracking
//    5.  WebSocket bridge
//    6.  Directional control detection
//    7.  Gesture detection
//    8.  Canvas drawing
//    9.  UI updates
//    10. Event log
//    11. Gesture edge detection
//    12. GAME HOOKS  ← put your custom logic here
//    13. MediaPipe result handler
//    14. MediaPipe + camera setup
// ============================================================


// ============================================================
// 1. CONFIGURATION
// ============================================================
const CONFIG = {
  WS_PORT:         8765,
  MOVE_THRESHOLD:  0.008,   // wrist units/frame to register left/right/up/down
  DEPTH_THRESHOLD: 0.04,    // Z delta/frame to register in/out
  Z_SMOOTH_FRAMES: 5,       // rolling average window for depth smoothing
  SEND_RATE_MS:    16,      // ~60 Hz max send rate to Unity
};


// ============================================================
// 2. DOM REFERENCES
// ============================================================
const video          = document.getElementById('input-video');
const canvas         = document.getElementById('output-canvas');
const ctx            = canvas.getContext('2d');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText    = document.getElementById('loading-text');
const gameOutput     = document.getElementById('game-output');


// ============================================================
// 3. STATE
// ============================================================
const hands      = { left: null, right: null };
const prevWrist  = { left: null, right: null };
const zHistory   = { left: [],   right: []   };


// ============================================================
// 4. FPS TRACKING
// ============================================================
let lastFPSTime  = performance.now();
let frameCount   = 0;
let fps          = 0;

function updateFPS() {
  frameCount++;
  const now = performance.now();
  if (now - lastFPSTime > 500) {
    fps = Math.round(frameCount / ((now - lastFPSTime) / 1000));
    // Update only the text node so the <span> subtitle isn't clobbered
    document.getElementById('fps-display').childNodes[0].textContent = fps;
    frameCount  = 0;
    lastFPSTime = now;
  }
}


// ============================================================
// 5. WEBSOCKET BRIDGE
// ============================================================
let ws           = null;
let lastSendTime = 0;

function connectWebSocket() {
  ws = new WebSocket(`ws://localhost:${CONFIG.WS_PORT}/browser`);

  ws.onopen = () => {
    console.log('[WS] Connected to Unity relay');
    const el = document.getElementById('ws-status');
    el.className = 'hand-status connected';
    document.getElementById('ws-label').textContent = 'RELAY';
    logEvent('WebSocket connected', 'left');
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected — retrying in 2s...');
    const el = document.getElementById('ws-status');
    el.className = 'hand-status disconnected';
    document.getElementById('ws-label').textContent = 'WS';
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (e) => console.warn('[WS] Error:', e);
}

function sendToUnity(payload) {
  const now = performance.now();
  if (now - lastSendTime < CONFIG.SEND_RATE_MS) return;
  lastSendTime = now;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}


// ============================================================
// 6. DIRECTIONAL CONTROL DETECTION
// ============================================================

/**
 * Smooth raw Z values with a rolling average to reduce depth noise.
 */
function smoothZ(side, rawZ) {
  const hist = zHistory[side];
  hist.push(rawZ);
  if (hist.length > CONFIG.Z_SMOOTH_FRAMES) hist.shift();
  return hist.reduce((a, b) => a + b, 0) / hist.length;
}

/**
 * Compute 6-axis directional controls from frame-to-frame wrist delta.
 *
 * @param  {Object|null} hand  - Hand state object or null
 * @param  {string}      side  - 'left' | 'right'
 * @returns {{ left, right, up, down, in, out }}
 */
function getDirectionalControls(hand, side) {
  if (!hand) {
    prevWrist[side] = null;
    zHistory[side]  = [];
    return { left: false, right: false, up: false, down: false, in: false, out: false };
  }

  const wrist = hand.wrist;

  // Average all landmark Z values for more stable depth than wrist alone
  const rawZ      = hand.landmarks.reduce((sum, lm) => sum + lm.z, 0) / hand.landmarks.length;
  const smoothedZ = smoothZ(side, rawZ);

  const controls = { left: false, right: false, up: false, down: false, in: false, out: false };

  if (prevWrist[side]) {
    const dx = wrist.x - prevWrist[side].x;
    const dy = wrist.y - prevWrist[side].y;
    const dz = smoothedZ - prevWrist[side].z;

    // X axis — video is mirrored so negative dx = moving right on screen
    if (dx < -CONFIG.MOVE_THRESHOLD)  controls.right = true;
    if (dx >  CONFIG.MOVE_THRESHOLD)  controls.left  = true;

    // Y axis — Y=0 is top of frame
    if (dy < -CONFIG.MOVE_THRESHOLD)  controls.up    = true;
    if (dy >  CONFIG.MOVE_THRESHOLD)  controls.down  = true;

    // Z axis — more negative = further from camera
    if (dz < -CONFIG.DEPTH_THRESHOLD) controls.out   = true;
    if (dz >  CONFIG.DEPTH_THRESHOLD) controls.in    = true;
  }

  prevWrist[side] = { x: wrist.x, y: wrist.y, z: smoothedZ };
  return controls;
}


// ============================================================
// 7. GESTURE DETECTION
// ============================================================

/**
 * Classify hand pose from 21 MediaPipe landmarks.
 *
 * @param  {Array} landmarks - Array of {x, y, z} in normalised 0-1 coords
 * @returns {{ fist, open, point, pinch, extendedCount, pinchDistance }}
 */
function detectGestures(landmarks) {
  const tip = (i) => landmarks[i];

  const fingerExtended = (tipIdx) => tip(tipIdx).y < landmarks[tipIdx - 2].y;
  const index  = fingerExtended(8);
  const middle = fingerExtended(12);
  const ring   = fingerExtended(16);
  const pinky  = fingerExtended(20);
  const thumb  = tip(4).y < landmarks[2].y;

  // Pinch: distance between thumb tip and index tip in normalised space
  const dx = tip(4).x - tip(8).x;
  const dy = tip(4).y - tip(8).y;
  const pinchDist = Math.sqrt(dx * dx + dy * dy);

  const extendedCount = [index, middle, ring, pinky].filter(Boolean).length;

  return {
    fist:          extendedCount === 0 && !thumb,
    open:          extendedCount >= 4,
    point:         index && !middle && !ring && !pinky,
    pinch:         pinchDist < 0.07,
    extendedCount,
    pinchDistance: pinchDist,
  };
}


// ============================================================
// 8. CANVAS DRAWING
// ============================================================
const COLORS = {
  left:  { line: '#00e5ff', point: '#ffffff', glow: 'rgba(0,229,255,0.5)' },
  right: { line: '#ff4081', point: '#ffffff', glow: 'rgba(255,64,129,0.5)' },
};

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

/** Draw the skeleton overlay for one hand. */
function drawHand(landmarks, side) {
  const c = COLORS[side];
  ctx.save();
  ctx.shadowBlur  = 10;
  ctx.shadowColor = c.glow;
  ctx.strokeStyle = c.line;
  ctx.lineWidth   = 2;
  ctx.globalAlpha = 0.85;

  HAND_CONNECTIONS.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * canvas.width, landmarks[a].y * canvas.height);
    ctx.lineTo(landmarks[b].x * canvas.width, landmarks[b].y * canvas.height);
    ctx.stroke();
  });

  ctx.shadowBlur = 6;
  landmarks.forEach((lm, i) => {
    const isTip = [4, 8, 12, 16, 20].includes(i);
    ctx.beginPath();
    ctx.arc(lm.x * canvas.width, lm.y * canvas.height, isTip ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle   = isTip ? c.line : c.point;
    ctx.globalAlpha = isTip ? 1 : 0.6;
    ctx.fill();
  });

  ctx.restore();
}

/** Draw directional arrow glyphs and hand label near the wrist. */
function drawDirectionalArrow(landmarks, side, controls) {
  const wrist = landmarks[0];
  const x = wrist.x * canvas.width;
  const y = wrist.y * canvas.height;
  const c = COLORS[side];

  ctx.save();
  ctx.font      = 'bold 20px Arial';
  ctx.fillStyle = c.line;
  ctx.shadowBlur  = 12;
  ctx.shadowColor = c.glow;
  ctx.textAlign   = 'center';

  const arrows = [];
  if (controls.up)    arrows.push('↑');
  if (controls.down)  arrows.push('↓');
  if (controls.left)  arrows.push('←');
  if (controls.right) arrows.push('→');
  if (controls.in)    arrows.push('●');
  if (controls.out)   arrows.push('○');

  if (arrows.length > 0) ctx.fillText(arrows.join(''), x, y - 30);

  ctx.font        = 'bold 11px Space Mono, monospace';
  ctx.globalAlpha = 0.8;
  ctx.fillText(side.toUpperCase(), x, y + 28);
  ctx.restore();
}


// ============================================================
// 9. UI UPDATES
// ============================================================
function setDirBtn(id, activeClass) {
  const el = document.getElementById(id);
  if (el) el.className = 'dir-btn' + (activeClass ? ' ' + activeClass : '');
}

function setDepthBtn(id, activeClass) {
  const el = document.getElementById(id);
  if (el) el.className = 'depth-btn' + (activeClass ? ' ' + activeClass : '');
}

function updateDirectionalUI(controls, side) {
  const ac = side === 'left' ? 'active-left' : 'active-right';
  const p  = side === 'left' ? 'l' : 'r';

  setDirBtn  (`${p}-up`,    controls.up    ? ac : '');
  setDirBtn  (`${p}-down`,  controls.down  ? ac : '');
  setDirBtn  (`${p}-left`,  controls.left  ? ac : '');
  setDirBtn  (`${p}-right`, controls.right ? ac : '');
  setDepthBtn(`${p}-in`,    controls.in    ? ac : '');
  setDepthBtn(`${p}-out`,   controls.out   ? ac : '');
}

function updateStatusUI(left, right) {
  document.getElementById('left-status').className  = 'hand-status' + (left  ? ' active-left'  : '');
  document.getElementById('right-status').className = 'hand-status' + (right ? ' active-right' : '');
}


// ============================================================
// 10. EVENT LOG
// ============================================================
const eventLog = [];

function logEvent(msg, side) {
  const ts = (performance.now() / 1000).toFixed(2);
  eventLog.push({ msg, side, ts });
  if (eventLog.length > 30) eventLog.shift();
  gameOutput.innerHTML = eventLog.slice(-10).reverse().map(e =>
    `<div class="event-${e.side}">[${e.ts}] ${e.msg}</div>`
  ).join('');
}


// ============================================================
// 11. GESTURE EDGE DETECTION
// ============================================================
const prevGestures = { left: {}, right: {} };

function detectGestureEdges(handData, side) {
  if (!handData) { prevGestures[side] = {}; return; }
  const g    = handData.gestures;
  const prev = prevGestures[side];
  ['fist', 'open', 'point', 'pinch'].forEach(name => {
    if ( g[name] && !prev[name]) onGestureStart(name, side, handData);
    if (!g[name] &&  prev[name]) onGestureEnd(name, side, handData);
  });
  prevGestures[side] = { ...g };
}


// ============================================================
// 12. GAME HOOKS — PUT YOUR CUSTOM LOGIC HERE
// ============================================================

/**
 * Called every animation frame with current hand data + 6-axis controls.
 *
 * @param {Object|null} left       - Left hand state, or null if not detected
 * @param {Object|null} right      - Right hand state, or null if not detected
 * @param {Object}      leftCtrl   - { left, right, up, down, in, out }
 * @param {Object}      rightCtrl  - { left, right, up, down, in, out }
 *
 * Hand state shape:
 *   .landmarks[]     21 × {x, y, z}  normalised 0-1 coordinates
 *   .wrist           Shortcut to landmarks[0]
 *   .gestures        { fist, open, point, pinch, extendedCount, pinchDistance }
 */
function onHandsUpdate(left, right, leftCtrl, rightCtrl) {
  // Example — log right wrist position:
  // if (right) console.log('R wrist:', right.wrist.x.toFixed(2), right.wrist.y.toFixed(2));

  // TODO: Drive your game objects here.
}

/**
 * Called once on the leading edge of a gesture (gesture just started).
 *
 * @param {string} gesture - 'fist' | 'open' | 'point' | 'pinch'
 * @param {string} side    - 'left' | 'right'
 * @param {Object} handData
 */
function onGestureStart(gesture, side, handData) {
  logEvent(`${gesture.toUpperCase()} ${side}`, side);

  // Examples:
  // if (gesture === 'fist'  && side === 'right') { /* attack  */ }
  // if (gesture === 'pinch' && side === 'left')  { /* grab    */ }
  // if (gesture === 'open')                      { /* release */ }
}

/**
 * Called once on the trailing edge of a gesture (gesture just ended).
 *
 * @param {string} gesture
 * @param {string} side
 * @param {Object} handData
 */
function onGestureEnd(gesture, side, handData) {
  // logEvent(`${gesture} end ${side}`, side);

  // Example: release grabbed object when pinch opens
  // if (gesture === 'pinch') releaseGrab(side);
}

// ============================================================
// END OF GAME HOOKS
// ============================================================


// ============================================================
// 13. MEDIAPIPE RESULT HANDLER
// ============================================================
function onResults(results) {
  updateFPS();

  // Keep canvas resolution in sync with the video stream
  canvas.width  = video.videoWidth  || canvas.offsetWidth;
  canvas.height = video.videoHeight || canvas.offsetHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  hands.left  = null;
  hands.right = null;

  if (results.multiHandLandmarks && results.multiHandedness) {
    results.multiHandLandmarks.forEach((landmarks, i) => {
      const label = results.multiHandedness[i].label;
      // MediaPipe labels are flipped because the video feed is mirrored
      const side  = label === 'Left' ? 'right' : 'left';
      const gestures = detectGestures(landmarks);
      hands[side] = { landmarks, wrist: landmarks[0], gestures };
      drawHand(landmarks, side);
    });
  }

  // Compute 6-axis controls (requires prevWrist from last frame)
  const leftCtrl  = getDirectionalControls(hands.left,  'left');
  const rightCtrl = getDirectionalControls(hands.right, 'right');

  // Draw directional overlays on top of the skeleton
  if (hands.left)  drawDirectionalArrow(hands.left.landmarks,  'left',  leftCtrl);
  if (hands.right) drawDirectionalArrow(hands.right.landmarks, 'right', rightCtrl);

  // Update side-panel UI
  updateStatusUI(hands.left, hands.right);
  updateDirectionalUI(leftCtrl,  'left');
  updateDirectionalUI(rightCtrl, 'right');

  // Gesture edge detection → fires onGestureStart / onGestureEnd
  detectGestureEdges(hands.left,  'left');
  detectGestureEdges(hands.right, 'right');

  // Build and send the JSON payload to Unity via relay
  const payload = {
    left: {
      detected: !!hands.left,
      wrist:    hands.left  ? { x: hands.left.wrist.x,  y: hands.left.wrist.y,  z: hands.left.wrist.z  } : null,
      controls: leftCtrl,
      gestures: hands.left  ? hands.left.gestures  : null,
    },
    right: {
      detected: !!hands.right,
      wrist:    hands.right ? { x: hands.right.wrist.x, y: hands.right.wrist.y, z: hands.right.wrist.z } : null,
      controls: rightCtrl,
      gestures: hands.right ? hands.right.gestures : null,
    },
    fps,
    timestamp: performance.now(),
  };

  sendToUnity(payload);

  // Fire the per-frame game hook
  onHandsUpdate(hands.left, hands.right, leftCtrl, rightCtrl);
}


// ============================================================
// 14. MEDIAPIPE + CAMERA SETUP
// ============================================================
const mpHands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
});

mpHands.setOptions({
  maxNumHands:            2,
  modelComplexity:        1,    // 0 = lite (faster), 1 = full (more accurate)
  minDetectionConfidence: 0.7,
  minTrackingConfidence:  0.5,
});

mpHands.onResults(onResults);

async function initCamera() {
  loadingText.textContent = 'REQUESTING CAMERA ACCESS...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
    });
    video.srcObject = stream;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });

    loadingText.textContent = 'LOADING HAND MODEL...';
    document.getElementById('model-info').textContent = 'MODEL: MEDIAPIPE HANDS v0.4';

    const camera = new Camera(video, {
      onFrame: async () => { await mpHands.send({ image: video }); },
      width:  1280,
      height: 720,
    });
    await camera.start();

    // Hide the loading overlay once everything is running
    setTimeout(() => loadingOverlay.classList.add('hidden'), 800);

  } catch (err) {
    loadingText.textContent = 'CAMERA ERROR: ' + err.message;
    console.error('[Camera]', err);
  }
}

// Kick everything off
connectWebSocket();
initCamera();
