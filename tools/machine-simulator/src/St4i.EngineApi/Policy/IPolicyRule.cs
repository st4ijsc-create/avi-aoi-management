namespace St4i.EngineApi.Policy;

/// <summary>A single policy rule. Returns <see langword="null"/> when the rule does not apply to this
/// request (it neither permits nor denies), else an explicit permit/deny.</summary>
public interface IPolicyRule
{
    PolicyDecision? Evaluate(PolicyRequest request);
}
