namespace St4i.EngineApi.Auth;

/// <summary>WS-D-D1 — the three roles a <c>users</c> row can hold. Per-route role POLICIES (who needs
/// which role to hit which endpoint) are D2; this task only needs the role NAMES themselves, since
/// bootstrap/demo-auto-login already have to stamp a role onto the user they create.</summary>
public static class Roles
{
    public const string Operator = "Operator";
    public const string Engineer = "Engineer";
    public const string Admin = "Admin";
}
