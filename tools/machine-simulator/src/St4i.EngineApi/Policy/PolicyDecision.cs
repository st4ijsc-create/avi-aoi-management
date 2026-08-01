namespace St4i.EngineApi.Policy;

public enum PolicyEffect { Permit, Deny }

/// <summary>The canonical policy reason codes (SYNAPSE WS-G). Internal enum for type-safe rule logic;
/// <see cref="PolicyReasonCodeExtensions.ToWireCode"/> is the SCREAMING_SNAKE string a client/audit sees.</summary>
public enum PolicyReasonCode { Ok, NotReady, SafetyBlocked, PolicyDenied, InvalidArgs, Unsupported, Busy }

public static class PolicyReasonCodeExtensions
{
    public static string ToWireCode(this PolicyReasonCode r) => r switch
    {
        PolicyReasonCode.Ok => "OK",
        PolicyReasonCode.NotReady => "NOT_READY",
        PolicyReasonCode.SafetyBlocked => "SAFETY_BLOCKED",
        PolicyReasonCode.PolicyDenied => "POLICY_DENIED",
        PolicyReasonCode.InvalidArgs => "INVALID_ARGS",
        PolicyReasonCode.Unsupported => "UNSUPPORTED",
        PolicyReasonCode.Busy => "BUSY",
        _ => throw new ArgumentOutOfRangeException(nameof(r), r, "Unknown reason code"),
    };
}

/// <summary>The result of evaluating a <see cref="PolicyRequest"/>: a permit, or a deny carrying a
/// machine-readable <see cref="Reason"/> + a human message.</summary>
public sealed record PolicyDecision(PolicyEffect Effect, PolicyReasonCode Reason, string Message)
{
    public bool IsPermitted => Effect == PolicyEffect.Permit;
    public static PolicyDecision Permit() => new(PolicyEffect.Permit, PolicyReasonCode.Ok, "OK");
    public static PolicyDecision Deny(PolicyReasonCode reason, string message) => new(PolicyEffect.Deny, reason, message);
}
