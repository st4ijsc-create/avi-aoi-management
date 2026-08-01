namespace St4i.EngineApi.Auth;

/// <summary>A single <c>users</c> row (see <see cref="SecurityDb"/>'s migration ladder for the exact
/// DDL). <see cref="PasswordHash"/> is a one-way <c>Microsoft.AspNetCore.Identity.PasswordHasher</c>
/// digest — never a reversible/DPAPI-protected secret (contrast
/// <see cref="St4i.EdgeCore.Infrastructure.CredentialStore"/>, which DOES need the plaintext
/// <c>mk_</c> key back and DPAPI-protects it for that reason; a login password never needs to be
/// recovered, only verified).</summary>
public sealed record UserRecord(
    int Id,
    string Username,
    string PasswordHash,
    string Role,
    string? DisplayName,
    bool Disabled,
    bool MustChangePassword,
    string SecurityStamp,
    DateTimeOffset CreatedAtUtc,
    string? CreatedBy,
    DateTimeOffset? LastLoginAtUtc);

/// <summary>WS-D-D1 — async CRUD over the <c>users</c> table, implemented by <see cref="SqliteUserStore"/>
/// via raw parameterized ADO.NET (see its own doc comment). <see cref="SecurityStamp"/> is bumped (a
/// fresh GUID) whenever a password/role/disabled change should invalidate every OTHER outstanding cookie
/// session for that user — <see cref="Program"/>'s cookie <c>OnValidatePrincipal</c> event re-reads the
/// row on (in principle) every request and signs the caller out the moment the cookie's baked-in stamp
/// stops matching the row's current one.</summary>
public interface IUserStore
{
    Task<int> CountAsync(CancellationToken ct = default);

    /// <summary>Case-insensitive lookup (the <c>users.username</c> column is
    /// <c>COLLATE NOCASE</c>) — <c>null</c> if no such user exists.</summary>
    Task<UserRecord?> GetByUsernameAsync(string username, CancellationToken ct = default);

    /// <summary>Inserts a new row with <c>disabled=0</c>, <c>must_change_password=0</c>, a freshly-minted
    /// <see cref="UserRecord.SecurityStamp"/>, and <c>created_at_utc</c> = now. Throws (propagates the
    /// underlying unique-constraint violation) if <paramref name="username"/> already exists —
    /// callers that need "create iff absent" (bootstrap, demo auto-login) serialize the
    /// check-then-create themselves under a lock rather than relying on this to swallow the race.</summary>
    Task<UserRecord> CreateAsync(string username, string passwordHash, string role, string? displayName, string? createdBy, CancellationToken ct = default);

    /// <summary>Updates <c>password_hash</c>; also mints a fresh <c>security_stamp</c> when
    /// <paramref name="bumpStamp"/> is <see langword="true"/> (the normal case for an operator-initiated
    /// change-password — it should invalidate every other session). A rehash performed transparently by
    /// <c>PasswordHasher</c> (e.g. after a successful login whose stored hash used an older algorithm
    /// version) is the one case that legitimately wants <paramref name="bumpStamp"/><c>: false</c> — it
    /// isn't a security-relevant change, just a housekeeping upgrade of the stored digest.</summary>
    Task SetPasswordHashAsync(int id, string passwordHash, bool bumpStamp, CancellationToken ct = default);

    /// <summary>Updates <c>role</c> and always bumps <c>security_stamp</c> (a role change is
    /// security-relevant — every other session for this user should re-validate against it).</summary>
    Task SetRoleAsync(int id, string role, CancellationToken ct = default);

    /// <summary>Updates <c>disabled</c> and always bumps <c>security_stamp</c> — disabling a user must
    /// invalidate any session that's already signed in, not just block future logins.</summary>
    Task SetDisabledAsync(int id, bool disabled, CancellationToken ct = default);

    Task SetLastLoginAsync(int id, DateTimeOffset atUtc, CancellationToken ct = default);

    Task<IReadOnlyList<UserRecord>> ListAsync(CancellationToken ct = default);

    /// <summary>True iff <paramref name="username"/> exists, is not disabled, and its CURRENT
    /// <c>security_stamp</c> equals <paramref name="stamp"/>.</summary>
    Task<bool> VerifySecurityStampAsync(string username, string stamp, CancellationToken ct = default);
}
