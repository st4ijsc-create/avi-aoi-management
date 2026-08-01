namespace St4i.EngineApi.Auth;

// ─────────────────────────────────────────────────────────────────────────
// WS-D-D7 — /v1/users wire shapes. UserDto deliberately omits PasswordHash/SecurityStamp/
// MustChangePassword/CreatedBy — see UserEndpoints.cs's own doc comment: the password hash (and
// anything derived from it, like the stamp) must NEVER reach the client, only the account-lifecycle
// facts an Admin actually needs to manage the roster.
// ─────────────────────────────────────────────────────────────────────────

public sealed record UserDto(
    int Id, string Username, string Role, string? DisplayName, bool Disabled, DateTimeOffset? LastLoginAtUtc);

public sealed record CreateUserRequestDto(string Username, string Password, string Role, string? DisplayName = null);

public sealed record SetUserRoleRequestDto(string Role);

public sealed record ResetPasswordRequestDto(string NewPassword);
