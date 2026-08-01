namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D1 — the "user" type-tag <see cref="Microsoft.AspNetCore.Identity.PasswordHasher{TUser}"/>'s
/// generic parameter needs. The in-box hasher never reads anything off the instance you pass to
/// <c>HashPassword</c>/<c>VerifyHashedPassword</c> — it only distinguishes hasher configurations by the
/// <c>TUser</c> TYPE, not by instance state — so this is a pure marker with no fields: every call site
/// just passes <see cref="Instance"/> instead of allocating a fresh one.
/// </summary>
public sealed record AppUser
{
    public static readonly AppUser Instance = new();
}
