using System;
using System.Collections;
using UnityEngine;
using NativeWebSocket;
using Newtonsoft.Json;

/// <summary>
/// HandTrackingReceiver
/// ====================
/// Connects to the hand tracking relay server and deserializes incoming
/// hand data into a strongly-typed HandPayload each frame.
///
/// SETUP:
///   1. Install NativeWebSocket via Package Manager:
///      https://github.com/endel/NativeWebSocket.git#upm
///
///   2. Install Newtonsoft JSON via Package Manager:
///      com.unity.nuget.newtonsoft-json
///
///   3. Attach this script to any persistent GameObject (e.g. GameManager).
///
///   4. Other scripts can reference CurrentState to read hand data:
///      handReceiver.CurrentState.right.controls.up
///
/// STARTUP ORDER:
///   python relay.py  →  Open HTML in Chrome  →  Press Play in Unity
/// </summary>
public class HandTrackingReceiver : MonoBehaviour
{
    // -----------------------------------------------------------------------
    // Inspector Settings
    // -----------------------------------------------------------------------
    [Header("Connection")]
    [SerializeField] private string relayHost = "localhost";
    [SerializeField] private int    relayPort = 8765;
    [SerializeField] private float  reconnectDelay = 2f;

    [Header("Debug")]
    [SerializeField] private bool logMessages = false;
    [SerializeField] private bool logConnections = true;

    // -----------------------------------------------------------------------
    // Public State — read this from other scripts
    // -----------------------------------------------------------------------
    public HandPayload CurrentState { get; private set; }
    public bool IsConnected => ws != null && ws.State == WebSocketState.Open;

    // -----------------------------------------------------------------------
    // Data Classes
    // -----------------------------------------------------------------------

    [Serializable]
    public class HandControls
    {
        public bool left;
        public bool right;
        public bool up;
        public bool down;

        [JsonProperty("in")]
        public bool inward;   // "in" is a C# reserved word

        [JsonProperty("out")]
        public bool outward;  // "out" is a C# reserved word
    }

    [Serializable]
    public class WristData
    {
        public float x;
        public float y;
        public float z;

        /// <summary>
        /// Returns normalized wrist position as a Unity Vector3.
        /// X and Y are 0-1 (screen space), Z is MediaPipe relative depth.
        /// </summary>
        public Vector3 ToVector3() => new Vector3(x, 1f - y, z);   // flip Y for Unity space
    }

    [Serializable]
    public class GestureData
    {
        public bool fist;
        public bool open;
        public bool point;
        public bool pinch;
        public int  extendedCount;
        public float pinchDistance;
    }

    [Serializable]
    public class HandState
    {
        public bool        detected;
        public WristData   wrist;
        public HandControls controls;
        public GestureData gestures;
    }

    [Serializable]
    public class HandPayload
    {
        public HandState left;
        public HandState right;
        public int       fps;
        public double    timestamp;
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------
    private WebSocket ws;
    private bool      shouldReconnect = true;

    // -----------------------------------------------------------------------
    // Unity Lifecycle
    // -----------------------------------------------------------------------
    private async void Start()
    {
        // Initialise with empty state so null checks aren't needed in other scripts
        CurrentState = CreateEmptyPayload();
        await Connect();
    }

    private void Update()
    {
        // Required by NativeWebSocket to dispatch messages on the main thread
#if !UNITY_WEBGL || UNITY_EDITOR
        ws?.DispatchMessageQueue();
#endif
    }

    private async void OnApplicationQuit()
    {
        shouldReconnect = false;
        if (ws != null) await ws.Close();
    }

    // -----------------------------------------------------------------------
    // Connection
    // -----------------------------------------------------------------------
    private async System.Threading.Tasks.Task Connect()
    {
        while (shouldReconnect)
        {
            string url = $"ws://{relayHost}:{relayPort}";
            if (logConnections) Debug.Log($"[HandTracking] Connecting to {url}...");

            ws = new WebSocket(url);

            ws.OnOpen += OnOpen;
            ws.OnMessage += OnMessage;
            ws.OnError += OnError;
            ws.OnClose += OnClose;

            await ws.Connect();

            // ws.Connect returns when the socket closes — wait before retrying
            if (shouldReconnect)
            {
                if (logConnections) Debug.Log($"[HandTracking] Retrying in {reconnectDelay}s...");
                await System.Threading.Tasks.Task.Delay((int)(reconnectDelay * 1000));
            }
        }
    }

    // -----------------------------------------------------------------------
    // WebSocket Callbacks
    // -----------------------------------------------------------------------
    private void OnOpen()
    {
        if (logConnections) Debug.Log("[HandTracking] Connected to relay.");
    }

    private void OnMessage(byte[] bytes)
    {
        try
        {
            var json = System.Text.Encoding.UTF8.GetString(bytes);
            if (logMessages) Debug.Log($"[HandTracking] {json}");

            // Ignore relay handshake message
            if (json.Contains("\"type\":\"relay_ready\"")) return;

            var payload = JsonConvert.DeserializeObject<HandPayload>(json);
            if (payload != null)
            {
                CurrentState = payload;
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning($"[HandTracking] Parse error: {e.Message}");
        }
    }

    private void OnError(string error)
    {
        Debug.LogWarning($"[HandTracking] WebSocket error: {error}");
    }

    private void OnClose(WebSocketCloseCode code)
    {
        if (logConnections) Debug.Log($"[HandTracking] Connection closed: {code}");
        CurrentState = CreateEmptyPayload();
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    private static HandPayload CreateEmptyPayload()
    {
        var emptyControls = new HandControls();
        var emptyHand     = new HandState
        {
            detected = false,
            wrist    = new WristData(),
            controls = emptyControls,
            gestures = new GestureData()
        };
        return new HandPayload { left = emptyHand, right = emptyHand };
    }

    /// <summary>
    /// Convenience: returns a Vector2 (0-1) of the requested hand's wrist position.
    /// Returns Vector2.zero if that hand is not detected.
    /// </summary>
    public Vector2 GetWristPosition(bool rightHand = true)
    {
        var hand = rightHand ? CurrentState?.right : CurrentState?.left;
        if (hand == null || !hand.detected || hand.wrist == null) return Vector2.zero;
        return new Vector2(hand.wrist.x, 1f - hand.wrist.y);
    }

    /// <summary>
    /// Convenience: returns the controls for the requested hand.
    /// Returns a blank (all-false) HandControls if not detected.
    /// </summary>
    public HandControls GetControls(bool rightHand = true)
    {
        var hand = rightHand ? CurrentState?.right : CurrentState?.left;
        if (hand == null || !hand.detected) return new HandControls();
        return hand.controls;
    }
}
