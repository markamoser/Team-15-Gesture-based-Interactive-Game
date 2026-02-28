using UnityEngine;

/// <summary>
/// PlayerController
/// ================
/// Example controller that drives a GameObject using hand tracking data
/// from HandTrackingReceiver. Supports all 6 directional controls:
///   Left / Right / Up / Down / In (toward cam) / Out (away from cam)
///
/// SETUP:
///   1. Attach this script to your player GameObject.
///   2. Drag the GameObject holding HandTrackingReceiver into the
///      "Hand Receiver" field in the Inspector.
///   3. Configure which hand(s) drive which axes in the Inspector.
///
/// EXTENDING:
///   Override OnGestureDetected() or subscribe to the gesture events
///   below to add attack, jump, or ability logic.
/// </summary>
public class PlayerController : MonoBehaviour
{
    // -----------------------------------------------------------------------
    // Inspector Settings
    // -----------------------------------------------------------------------
    [Header("References")]
    [SerializeField] private HandTrackingReceiver handReceiver;

    [Header("Hand Assignment")]
    [Tooltip("Which hand controls lateral (left/right) and vertical (up/down) movement")]
    [SerializeField] private bool movementHandIsRight = true;

    [Tooltip("Which hand controls depth (in/out) movement")]
    [SerializeField] private bool depthHandIsRight = false;

    [Header("Movement Speed")]
    [SerializeField] private float lateralSpeed = 5f;
    [SerializeField] private float verticalSpeed = 5f;
    [SerializeField] private float depthSpeed    = 4f;

    [Header("Movement Smoothing")]
    [Tooltip("Higher = snappier, Lower = smoother")]
    [SerializeField, Range(1f, 30f)] private float smoothing = 10f;

    [Header("Bounds (set to 0 to disable)")]
    [SerializeField] private Vector3 movementBoundsMin = new Vector3(-10f, -5f, -10f);
    [SerializeField] private Vector3 movementBoundsMax = new Vector3( 10f,  5f,  10f);
    [SerializeField] private bool    enforceBounds = true;

    [Header("Debug")]
    [SerializeField] private bool showDebugGizmos = true;

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------
    private Vector3 currentVelocity;
    private Vector3 targetVelocity;

    // Previous gesture states for edge detection
    private bool prevFistLeft,  prevFistRight;
    private bool prevOpenLeft,  prevOpenRight;
    private bool prevPointLeft, prevPointRight;
    private bool prevPinchLeft, prevPinchRight;

    // -----------------------------------------------------------------------
    // Public Events — subscribe in other scripts for gesture triggers
    // -----------------------------------------------------------------------
    public System.Action<string, bool> OnGestureStart;  // (gestureName, isRightHand)
    public System.Action<string, bool> OnGestureEnd;    // (gestureName, isRightHand)

    // -----------------------------------------------------------------------
    // Unity Lifecycle
    // -----------------------------------------------------------------------
    private void Reset()
    {
        // Auto-find HandTrackingReceiver on the same GameObject or parent
        handReceiver = GetComponentInParent<HandTrackingReceiver>();
        if (handReceiver == null)
            handReceiver = FindObjectOfType<HandTrackingReceiver>();
    }

    private void Update()
    {
        if (handReceiver == null) return;

        HandleMovement();
        HandleGestureEdges();
    }

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    private void HandleMovement()
    {
        var moveCtrl  = handReceiver.GetControls(movementHandIsRight);
        var depthCtrl = handReceiver.GetControls(depthHandIsRight);

        // Build target velocity from active directional controls
        targetVelocity = Vector3.zero;

        if (moveCtrl.left)   targetVelocity += Vector3.left    * lateralSpeed;
        if (moveCtrl.right)  targetVelocity += Vector3.right   * lateralSpeed;
        if (moveCtrl.up)     targetVelocity += Vector3.up      * verticalSpeed;
        if (moveCtrl.down)   targetVelocity += Vector3.down    * verticalSpeed;
        if (depthCtrl.inward)  targetVelocity += Vector3.forward * depthSpeed;
        if (depthCtrl.outward) targetVelocity += Vector3.back    * depthSpeed;

        // Smooth velocity (prevents jitter from noisy hand detection)
        currentVelocity = Vector3.Lerp(currentVelocity, targetVelocity, Time.deltaTime * smoothing);

        // Apply movement
        Vector3 newPosition = transform.position + currentVelocity * Time.deltaTime;

        // Clamp within bounds
        if (enforceBounds)
        {
            newPosition.x = Mathf.Clamp(newPosition.x, movementBoundsMin.x, movementBoundsMax.x);
            newPosition.y = Mathf.Clamp(newPosition.y, movementBoundsMin.y, movementBoundsMax.y);
            newPosition.z = Mathf.Clamp(newPosition.z, movementBoundsMin.z, movementBoundsMax.z);
        }

        transform.position = newPosition;
    }

    // -----------------------------------------------------------------------
    // Gesture Edge Detection
    // -----------------------------------------------------------------------
    private void HandleGestureEdges()
    {
        var state = handReceiver.CurrentState;
        if (state == null) return;

        CheckGestureEdge(state.left?.gestures?.fist,   ref prevFistLeft,   "fist",  false);
        CheckGestureEdge(state.right?.gestures?.fist,  ref prevFistRight,  "fist",  true);
        CheckGestureEdge(state.left?.gestures?.open,   ref prevOpenLeft,   "open",  false);
        CheckGestureEdge(state.right?.gestures?.open,  ref prevOpenRight,  "open",  true);
        CheckGestureEdge(state.left?.gestures?.point,  ref prevPointLeft,  "point", false);
        CheckGestureEdge(state.right?.gestures?.point, ref prevPointRight, "point", true);
        CheckGestureEdge(state.left?.gestures?.pinch,  ref prevPinchLeft,  "pinch", false);
        CheckGestureEdge(state.right?.gestures?.pinch, ref prevPinchRight, "pinch", true);
    }

    private void CheckGestureEdge(bool? current, ref bool prev, string gestureName, bool isRight)
    {
        bool curr = current ?? false;
        if (curr && !prev) GestureStarted(gestureName, isRight);
        if (!curr && prev) GestureEnded(gestureName, isRight);
        prev = curr;
    }

    // -----------------------------------------------------------------------
    // Gesture Callbacks — override or subscribe to OnGestureStart/End
    // -----------------------------------------------------------------------

    /// <summary>Called once when a gesture begins.</summary>
    protected virtual void GestureStarted(string gesture, bool isRightHand)
    {
        OnGestureStart?.Invoke(gesture, isRightHand);

        // ---- Default game actions — customise or remove these ----
        switch (gesture)
        {
            case "fist":
                Debug.Log($"[Player] {(isRightHand ? "Right" : "Left")} fist — could trigger attack!");
                // Example: GetComponent<Animator>()?.SetTrigger("Attack");
                break;

            case "pinch":
                Debug.Log($"[Player] {(isRightHand ? "Right" : "Left")} pinch — could grab object!");
                // Example: TryGrabNearestObject(isRightHand);
                break;

            case "open":
                Debug.Log($"[Player] {(isRightHand ? "Right" : "Left")} open hand — could cast spell!");
                break;

            case "point":
                Debug.Log($"[Player] {(isRightHand ? "Right" : "Left")} pointing — could select target!");
                break;
        }
    }

    /// <summary>Called once when a gesture ends.</summary>
    protected virtual void GestureEnded(string gesture, bool isRightHand)
    {
        OnGestureEnd?.Invoke(gesture, isRightHand);

        // Example: release grab on pinch end
        // if (gesture == "pinch") ReleaseGrabbedObject(isRightHand);
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------

    /// <summary>
    /// Returns the right-hand wrist as a world-space position, mapped to a
    /// rectangular play area. Useful for cursor or pointer-based games.
    /// </summary>
    public Vector3 GetWristWorldPosition(bool rightHand, float areaWidth = 20f, float areaHeight = 12f)
    {
        Vector2 norm = handReceiver.GetWristPosition(rightHand);   // 0-1 normalized
        return new Vector3(
            (norm.x - 0.5f) * areaWidth,
            (norm.y - 0.5f) * areaHeight,
            transform.position.z
        );
    }

    // -----------------------------------------------------------------------
    // Gizmos
    // -----------------------------------------------------------------------
    private void OnDrawGizmosSelected()
    {
        if (!showDebugGizmos || !enforceBounds) return;

        Gizmos.color = Color.cyan;
        Vector3 center = (movementBoundsMin + movementBoundsMax) * 0.5f;
        Vector3 size   = movementBoundsMax - movementBoundsMin;
        Gizmos.DrawWireCube(center, size);
    }
}
