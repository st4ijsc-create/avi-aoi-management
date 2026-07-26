using System.Globalization;
using Microsoft.AspNetCore.Identity;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D7 — <c>/v1/users/*</c>: the Admin-only account-management surface D3 deferred (see
/// <see cref="IUserStore"/>'s own doc comment — Create/SetRole/SetDisabled/SetPasswordHash/List already
/// existed; this task is the first thing that actually calls them from an HTTP handler). Every route
/// below is <see cref="Policies.Admin"/> — an Operator/Engineer gets a real 403, never a 200 with the
/// roster or a mutation applied (see <c>RbacPolicyTests</c>'s metadata sweep, extended by this task).
///
/// <see cref="UserDto"/> NEVER carries <c>PasswordHash</c>/<c>SecurityStamp</c> — see that record's own
/// doc comment. Every mutating handler here bumps the target's <c>security_stamp</c> (via
/// <see cref="IUserStore.SetRoleAsync"/>/<see cref="IUserStore.SetDisabledAsync"/>/
/// <see cref="IUserStore.SetPasswordHashAsync"/>, all of which already do this per D1's own contract) so
/// <c>Program</c>'s <c>OnValidatePrincipal</c> revokes every one of the target's existing cookie
/// sessions the next time any of them makes a request — a disabled/demoted/password-reset user can't
/// keep riding an already-signed-in session.
///
/// Last-admin lock-out guard: neither <c>disable</c> nor a role change AWAY from Admin is allowed to
/// leave a deployment with zero enabled Admins — both would have the identical practical effect (no one
/// left who can administer the system, including undoing the very mutation that caused it), so both
/// share the same <see cref="IsLastEnabledAdmin"/> check. The brief only calls out
/// <c>disable</c> explicitly, but a role-change demotion of the sole Admin is the same lock-out by a
/// different door, and there's no user-management surface yet to re-promote anyone once it happens.
///
/// Every mutation is audited via <see cref="AuditRecorder"/> — <c>user.create</c> (new = {username,role},
/// NEVER the password), <c>user.role_change</c> (old→new role), <c>user.disable</c>/<c>user.enable</c>
/// (old→new disabled flag), <c>user.password_reset</c> (no old/new at all — see
/// <c>AuthEndpoints.change-password</c>'s identical choice). Actor is always the AUTHENTICATED admin
/// (<see cref="AuditRecorder.RecordAsync"/> reads it off <see cref="HttpContext"/> itself), never a
/// client-supplied value.
///
/// WS-D-D7 review fix — <see cref="MutationLock"/> serializes every check-then-act critical section
/// below (create's duplicate-username check, both lock-out guards) across concurrent requests. Without
/// it, two concurrent handler invocations each open their OWN <c>SqliteConnection</c>
/// (<see cref="SqliteUserStore"/> — no transaction spans "read the roster, decide, write" across
/// separate calls), so two racing requests can each read the SAME pre-mutation roster, each see the
/// OTHER as "the remaining enabled Admin" (or each see the username as not-yet-taken), and both commit
/// — e.g. disabling Admin A while demoting Admin B, concurrently, could leave ZERO enabled Admins even
/// though each request's OWN guard check passed. Same "serialize the check-then-act instead of trusting
/// a single connection's transaction" fix <c>AuthEndpoints.BootstrapLock</c> already established for
/// bootstrap's own check-then-create race (see that field's doc comment) — this is single-process-host
/// software, so an in-process <see cref="SemaphoreSlim"/> is sufficient; a multi-instance deployment
/// would need a real database-level lock/transaction instead.
/// </summary>
public static class UserEndpoints
{
    /// <summary>Same minimal length floor <c>AuthEndpoints.change-password</c> already established —
    /// kept as its own constant here (not shared) since the two files have no other coupling and
    /// duplicating one literal is cheaper than introducing a cross-file dependency for it.</summary>
    private const int MinPasswordLength = 8;

    /// <summary>Serializes create/role-change/disable-enable against each other — see this class's own
    /// doc comment for the race it closes. Deliberately does NOT also cover <see cref="ResetPasswordAsync"/>
    /// or <see cref="GetUsersAsync"/>: neither has a check-then-act invariant that depends on any OTHER
    /// row (a password reset only ever touches its own target row; the list read has nothing to
    /// serialize against), so locking them too would only add contention with no correctness benefit.</summary>
    private static readonly SemaphoreSlim MutationLock = new(1, 1);

    public static void MapUserEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/users", GetUsersAsync).RequireAuthorization(Policies.Admin);
        app.MapPost("/v1/users", CreateUserAsync).RequireAuthorization(Policies.Admin);
        app.MapPut("/v1/users/{id}/role", SetRoleAsync).RequireAuthorization(Policies.Admin);
        app.MapPost("/v1/users/{id}/disable", DisableUserAsync).RequireAuthorization(Policies.Admin);
        app.MapPost("/v1/users/{id}/enable", EnableUserAsync).RequireAuthorization(Policies.Admin);
        app.MapPost("/v1/users/{id}/reset-password", ResetPasswordAsync).RequireAuthorization(Policies.Admin);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/users
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetUsersAsync(IUserStore userStore, CancellationToken ct)
    {
        var all = await userStore.ListAsync(ct).ConfigureAwait(false);
        return Results.Ok(all.Select(ToDto).ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/users
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> CreateUserAsync(
        CreateUserRequestDto body, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Username))
        {
            return Results.BadRequest(new ApiErrorDto("username is required"));
        }

        if (!IsValidRole(body.Role))
        {
            return Results.BadRequest(new ApiErrorDto($"role must be one of: {Roles.Operator}, {Roles.Engineer}, {Roles.Admin}"));
        }

        if (string.IsNullOrWhiteSpace(body.Password) || body.Password.Length < MinPasswordLength)
        {
            return Results.BadRequest(new ApiErrorDto($"password is required and must be at least {MinPasswordLength} characters."));
        }

        // WS-D-D7 review fix — the check-then-create below is now serialized under MutationLock: two
        // concurrent creates for the SAME username used to each read "not found" off their own
        // connection, then both call CreateAsync, and the SECOND one's INSERT would throw the store's
        // raw UNIQUE-constraint SqliteException (an unhandled 500), not a clean 409. Holding the lock
        // across the whole check-then-act makes the second caller's GetByUsernameAsync see the FIRST
        // caller's already-committed row.
        await MutationLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Same case-insensitive semantics the `users.username` column's own COLLATE NOCASE
            // enforces, checked BEFORE the insert so the common case gets a clean 409, not a raw
            // constraint-violation exception.
            var existing = await userStore.GetByUsernameAsync(body.Username, ct).ConfigureAwait(false);
            if (existing is not null)
            {
                return Results.Conflict(new ApiErrorDto($"username \"{body.Username}\" already exists."));
            }

            var hasher = new PasswordHasher<AppUser>();
            var hash = hasher.HashPassword(AppUser.Instance, body.Password);
            var createdBy = http.User.Identity?.Name;
            var user = await userStore.CreateAsync(body.Username, hash, body.Role, body.DisplayName, createdBy, ct).ConfigureAwait(false);

            // WS-D-D7 — new = {username, role} ONLY. NEVER body.Password, never the hash.
            await recorder.RecordAsync(
                http, "user.create", "user", IdOf(user.Id), null, new { user.Username, user.Role }, ct).ConfigureAwait(false);

            return Results.Ok(ToDto(user));
        }
        finally
        {
            MutationLock.Release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/users/{id}/role
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> SetRoleAsync(
        int id, SetUserRoleRequestDto body, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct)
    {
        if (!IsValidRole(body.Role))
        {
            return Results.BadRequest(new ApiErrorDto($"role must be one of: {Roles.Operator}, {Roles.Engineer}, {Roles.Admin}"));
        }

        // WS-D-D7 review fix — the guard's read (ListAsync) → decide → write (SetRoleAsync) is now
        // atomic under MutationLock. See this class's own doc comment for the exact race this closes:
        // without the lock, a concurrent disable-of-A + demote-of-B (the only 2 enabled Admins) could
        // each read the SAME pre-mutation roster, each see the OTHER as the safety net, and both commit.
        await MutationLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await userStore.ListAsync(ct).ConfigureAwait(false);
            var user = all.FirstOrDefault(u => u.Id == id);
            if (user is null)
            {
                return Results.NotFound(new ApiErrorDto($"no such user id {id}"));
            }

            if (!user.Disabled
                && string.Equals(user.Role, Roles.Admin, StringComparison.Ordinal)
                && !string.Equals(body.Role, Roles.Admin, StringComparison.Ordinal)
                && IsLastEnabledAdmin(all, user.Id))
            {
                return Results.BadRequest(new ApiErrorDto(
                    "cannot change the role of the last enabled Admin away from Admin — this would lock out all administration."));
            }

            var oldRole = user.Role;
            await userStore.SetRoleAsync(id, body.Role, ct).ConfigureAwait(false);

            await recorder.RecordAsync(http, "user.role_change", "user", IdOf(id), oldRole, body.Role, ct).ConfigureAwait(false);

            return Results.Ok(ToDto(user with { Role = body.Role }));
        }
        finally
        {
            MutationLock.Release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/users/{id}/disable, POST /v1/users/{id}/enable
    // ─────────────────────────────────────────────────────────────────────
    internal static Task<IResult> DisableUserAsync(int id, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct) =>
        SetDisabledAsync(id, disabled: true, userStore, http, recorder, ct);

    internal static Task<IResult> EnableUserAsync(int id, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct) =>
        SetDisabledAsync(id, disabled: false, userStore, http, recorder, ct);

    private static async Task<IResult> SetDisabledAsync(
        int id, bool disabled, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct)
    {
        // WS-D-D7 review fix — same atomic read-decide-write as SetRoleAsync above, same lock (they
        // guard the SAME invariant — "at least one enabled Admin remains" — so they must serialize
        // against EACH OTHER too, not just against themselves).
        await MutationLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var all = await userStore.ListAsync(ct).ConfigureAwait(false);
            var user = all.FirstOrDefault(u => u.Id == id);
            if (user is null)
            {
                return Results.NotFound(new ApiErrorDto($"no such user id {id}"));
            }

            if (disabled && !user.Disabled
                && string.Equals(user.Role, Roles.Admin, StringComparison.Ordinal)
                && IsLastEnabledAdmin(all, user.Id))
            {
                return Results.BadRequest(new ApiErrorDto(
                    "cannot disable the last enabled Admin — this would lock out all administration."));
            }

            await userStore.SetDisabledAsync(id, disabled, ct).ConfigureAwait(false);

            var action = disabled ? "user.disable" : "user.enable";
            await recorder.RecordAsync(http, action, "user", IdOf(id), user.Disabled, disabled, ct).ConfigureAwait(false);

            return Results.Ok(ToDto(user with { Disabled = disabled }));
        }
        finally
        {
            MutationLock.Release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/users/{id}/reset-password
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ResetPasswordAsync(
        int id, ResetPasswordRequestDto body, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.NewPassword) || body.NewPassword.Length < MinPasswordLength)
        {
            return Results.BadRequest(new ApiErrorDto($"newPassword is required and must be at least {MinPasswordLength} characters."));
        }

        var all = await userStore.ListAsync(ct).ConfigureAwait(false);
        var user = all.FirstOrDefault(u => u.Id == id);
        if (user is null)
        {
            return Results.NotFound(new ApiErrorDto($"no such user id {id}"));
        }

        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, body.NewPassword);
        // Always bumps the stamp — an Admin-initiated reset should invalidate every session the target
        // currently holds, exactly like a self-service change-password does.
        await userStore.SetPasswordHashAsync(id, hash, bumpStamp: true, ct).ConfigureAwait(false);

        // WS-D-D7 — NEVER body.NewPassword, never the hash; no old/new value at all (same choice
        // AuthEndpoints.change-password already made for the identical reason).
        await recorder.RecordAsync(http, "user.password_reset", "user", IdOf(id), null, null, ct).ConfigureAwait(false);

        return Results.Ok(ToDto(user));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────

    private static bool IsValidRole(string? role) => role is Roles.Operator or Roles.Engineer or Roles.Admin;

    private static string IdOf(int id) => id.ToString(CultureInfo.InvariantCulture);

    private static UserDto ToDto(UserRecord user) =>
        new(user.Id, user.Username, user.Role, user.DisplayName, user.Disabled, user.LastLoginAtUtc);

    /// <summary>True iff no user OTHER than <paramref name="targetId"/> is an enabled Admin — i.e.
    /// <paramref name="targetId"/> (already known by both call sites to itself be an enabled Admin
    /// right now) is the LAST one. Both call sites only reach this after confirming the target is
    /// currently an enabled Admin about to stop being one (disabled, or demoted away from Admin) —
    /// this helper only ever needs to answer "is anyone else left".</summary>
    private static bool IsLastEnabledAdmin(IReadOnlyList<UserRecord> all, int targetId) =>
        !all.Any(u => u.Id != targetId && !u.Disabled && string.Equals(u.Role, Roles.Admin, StringComparison.Ordinal));
}
