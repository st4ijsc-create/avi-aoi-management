namespace St4i.EngineApi.Auth;

/// <summary>WS-D-D2 — the three named authorization policies every non-anonymous route below attaches
/// via <c>.RequireAuthorization(Policies.X)</c>. Each is a role-based OR (see <c>Program</c>'s
/// <c>AddAuthorization</c> registration): <see cref="Operator"/> is satisfied by ANY of the three
/// <see cref="Roles"/> (the least-privileged tier — Operator/Engineer/Admin can all reach it),
/// <see cref="Engineer"/> by Engineer or Admin, and <see cref="Admin"/> by Admin alone. Kept as bare
/// string constants (not an enum) because <c>RequireAuthorization</c>/<c>AuthorizeAttribute</c> take the
/// registered policy NAME as a string.</summary>
public static class Policies
{
    public const string Operator = "Operator";
    public const string Engineer = "Engineer";
    public const string Admin = "Admin";
}
