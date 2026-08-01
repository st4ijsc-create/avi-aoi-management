namespace St4i.EngineApi.Policy;

/// <summary>The error body for a policy-denied mutation: the human message + the machine-readable reason code.</summary>
public sealed record PolicyDenyDto(string Error, string Reason);
