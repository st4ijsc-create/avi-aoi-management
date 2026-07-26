using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D1 — <c>/v1/auth/*</c>: bootstrap-status/bootstrap/login (anonymous — see the
/// <c>.AllowAnonymous()</c> chains below) and logout/me/change-password (require the cookie session the
/// default-deny fallback policy now demands everywhere else). RBAC per-route ROLE policies (who besides
/// "authenticated" is allowed where) are D2 — this task only needs the account lifecycle itself.
/// </summary>
public static class AuthEndpoints
{
    /// <summary>Custom claim type carrying the user's CURRENT <c>security_stamp</c> at sign-in time —
    /// baked into the encrypted auth cookie so <c>Program</c>'s <c>OnValidatePrincipal</c> event can
    /// detect "this cookie was minted before a password/role/disable change invalidated it" without a
    /// second username lookup on every request.</summary>
    public const string SecurityStampClaimType = "st4i:security_stamp";

    /// <summary>Custom claim carrying the display name at sign-in time, so <c>GET /v1/auth/me</c> can
    /// answer straight from <see cref="ClaimsPrincipal"/> with no extra store round trip.</summary>
    public const string DisplayNameClaimType = "st4i:display_name";

    // Serializes "is this the first user ever" check-then-create so two concurrent bootstrap requests
    // can't both observe CountAsync()==0 and both try to insert the first admin.
    private static readonly SemaphoreSlim BootstrapLock = new(1, 1);

    /// <summary>D1-carried hardening minor #1 — a precomputed <c>PasswordHasher</c> digest of a random,
    /// never-used password, computed once at class-init. <c>login</c>'s unknown-user and disabled-user
    /// paths run a THROWAWAY <see cref="PasswordHasher{TUser}.VerifyHashedPassword"/> against THIS hash
    /// (result discarded — always <see cref="PasswordVerificationResult.Failed"/>, since nothing was ever
    /// hashed FROM the caller's actual password) before returning 401, so the real login path's PBKDF2
    /// work factor is paid on every rejected attempt alike. Without this, a caller could distinguish "no
    /// such username"/"disabled account" from "wrong password for a real, enabled account" purely by
    /// response latency (the real path's <c>VerifyHashedPassword</c> call is the expensive part) — a
    /// classic username-enumeration side channel.</summary>
    private static readonly string DummyPasswordHash =
        new PasswordHasher<AppUser>().HashPassword(AppUser.Instance, Guid.NewGuid().ToString("N"));

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/auth/bootstrap-status", async (IUserStore userStore, CancellationToken ct) =>
        {
            var count = await userStore.CountAsync(ct).ConfigureAwait(false);
            return Results.Ok(new BootstrapStatusDto(count == 0));
        }).AllowAnonymous();

        app.MapPost("/v1/auth/bootstrap", async (BootstrapRequestDto body, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Username))
            {
                return Results.BadRequest(new ApiErrorDto("username and password are required"));
            }

            // WS-D final-security-review M-1 — the FIRST Admin account minted on a fresh deployment used to
            // only reject a null/blank password, unlike change-password/user.create which both already
            // enforce MinPasswordLength (below) — meaning a one-character bootstrap password was previously
            // accepted for the single most privileged account on the box. Reuses the SAME floor/constant the
            // other two paths already established (see MinPasswordLength's own doc comment).
            if (string.IsNullOrWhiteSpace(body.Password) || body.Password.Length < MinPasswordLength)
            {
                return Results.BadRequest(new ApiErrorDto($"password is required and must be at least {MinPasswordLength} characters."));
            }

            await BootstrapLock.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                if (await userStore.CountAsync(ct).ConfigureAwait(false) != 0)
                {
                    return Results.Conflict(new ApiErrorDto("this deployment has already been bootstrapped"));
                }

                var hasher = new PasswordHasher<AppUser>();
                var hash = hasher.HashPassword(AppUser.Instance, body.Password);
                var user = await userStore.CreateAsync(
                    body.Username, hash, Roles.Admin, body.DisplayName, createdBy: "bootstrap", ct).ConfigureAwait(false);

                var principal = BuildPrincipal(user);
                await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal).ConfigureAwait(false);
                // SignInAsync only takes effect starting with the NEXT request (it just writes a
                // Set-Cookie header) — same gotcha DemoAutoLoginMiddleware's own doc comment documents.
                // Without also assigning http.User here, the RecordAsync call below would see the
                // ORIGINAL (anonymous) principal this request came in with and log actor="(anonymous)"
                // for the very account that just bootstrapped.
                http.User = principal;

                // WS-D-D4 — recorded AFTER bootstrap + sign-in succeed. NEVER logs body.Password (only the
                // resulting username/role — the account-lifecycle fact "this deployment was bootstrapped",
                // never the secret itself).
                await recorder.RecordAsync(http, "auth.bootstrap", "username", user.Username, null, new { user.Username, user.Role }, ct)
                    .ConfigureAwait(false);

                return Results.Ok(new AuthUserDto(user.Username, user.Role, user.DisplayName));
            }
            finally
            {
                BootstrapLock.Release();
            }
        }).AllowAnonymous();

        app.MapPost("/v1/auth/login", async (LoginRequestDto body, IUserStore userStore, HttpContext http, AuditRecorder recorder, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password))
            {
                return Results.Unauthorized();
            }

            var user = await userStore.GetByUsernameAsync(body.Username, ct).ConfigureAwait(false);
            var hasher = new PasswordHasher<AppUser>();
            if (user is null || user.Disabled)
            {
                // D1-carried hardening minor #1 — see DummyPasswordHash's doc comment: pay the same
                // PBKDF2 cost the real verification below pays, even though this result is discarded.
                _ = hasher.VerifyHashedPassword(AppUser.Instance, DummyPasswordHash, body.Password);
                // WS-D-D4 — auth.login_failed is its own action, audited even though the mutation itself
                // is "rejected" (401) — see AuditRecorder's own doc comment / the D4 ordering rule's
                // explicit carve-out for this action. NEVER logs body.Password.
                await recorder.RecordAsync(http, "auth.login_failed", "username", body.Username, null, null, ct).ConfigureAwait(false);
                return Results.Unauthorized();
            }

            var verification = hasher.VerifyHashedPassword(AppUser.Instance, user.PasswordHash, body.Password);
            if (verification == PasswordVerificationResult.Failed)
            {
                await recorder.RecordAsync(http, "auth.login_failed", "username", body.Username, null, null, ct).ConfigureAwait(false);
                return Results.Unauthorized();
            }

            if (verification == PasswordVerificationResult.SuccessRehashNeeded)
            {
                // Housekeeping only (e.g. the hasher's default iteration count/algorithm moved on) — not a
                // security-relevant change, so no other session should be invalidated over it.
                var rehash = hasher.HashPassword(AppUser.Instance, body.Password);
                await userStore.SetPasswordHashAsync(user.Id, rehash, bumpStamp: false, ct).ConfigureAwait(false);
            }

            await userStore.SetLastLoginAsync(user.Id, DateTimeOffset.UtcNow, ct).ConfigureAwait(false);
            var principal = BuildPrincipal(user);
            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal).ConfigureAwait(false);
            // See the bootstrap handler's own comment above — SignInAsync alone doesn't update http.User
            // for THIS request, so the RecordAsync call below needs it assigned explicitly first.
            http.User = principal;

            await recorder.RecordAsync(http, "auth.login_success", "username", user.Username, null, null, ct).ConfigureAwait(false);

            return Results.Ok(new AuthUserDto(user.Username, user.Role, user.DisplayName));
        }).AllowAnonymous();

        app.MapPost("/v1/auth/logout", async (HttpContext http, AuditRecorder recorder, CancellationToken ct) =>
        {
            var username = http.User.Identity?.Name;
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme).ConfigureAwait(false);
            await recorder.RecordAsync(http, "auth.logout", "username", username, null, null, ct).ConfigureAwait(false);
            return Results.Ok();
        }).RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/auth/me", (HttpContext http) =>
        {
            // The default-deny fallback policy already blocks this route with a 401 before the handler
            // ever runs, but the SPA relies on a JSON 401 body-shape-free response here specifically (not
            // a redirect) — the explicit check keeps that contract obvious at the call site too.
            if (http.User.Identity?.IsAuthenticated != true)
            {
                return Results.Unauthorized();
            }

            var username = http.User.Identity.Name ?? string.Empty;
            var role = http.User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;
            var displayName = http.User.FindFirst(DisplayNameClaimType)?.Value;
            return Results.Ok(new AuthUserDto(username, role, displayName));
        }).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/auth/change-password", async (ChangePasswordRequestDto body, HttpContext http, IUserStore userStore, AuditRecorder recorder, CancellationToken ct) =>
        {
            var username = http.User.Identity?.Name;
            if (string.IsNullOrEmpty(username))
            {
                return Results.Unauthorized();
            }

            // D1-carried hardening minor #2 — reject a null/empty/whitespace-only NewPassword with a
            // real 400 BEFORE ever touching the user store or PasswordHasher: PasswordHasher.HashPassword
            // throws ArgumentNullException on a null password (an uncaught 500, not a friendly error),
            // and an empty/whitespace string would otherwise hash and persist "successfully" as a
            // (functionally unusable) empty password. A minimal length floor (8, matching the bootstrap/
            // demo-admin passwords already in use elsewhere in this file) is enough here — full password-
            // policy strength rules are out of this task's scope.
            if (string.IsNullOrWhiteSpace(body.NewPassword) || body.NewPassword.Length < MinPasswordLength)
            {
                return Results.BadRequest(new ApiErrorDto($"newPassword is required and must be at least {MinPasswordLength} characters."));
            }

            var user = await userStore.GetByUsernameAsync(username, ct).ConfigureAwait(false);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            var hasher = new PasswordHasher<AppUser>();
            var verification = hasher.VerifyHashedPassword(AppUser.Instance, user.PasswordHash, body.CurrentPassword);
            if (verification == PasswordVerificationResult.Failed)
            {
                return Results.BadRequest(new ApiErrorDto("current password is incorrect"));
            }

            var newHash = hasher.HashPassword(AppUser.Instance, body.NewPassword);
            // Always bumps the stamp — a self-service password change should invalidate every OTHER
            // outstanding session (including, as a side effect, THIS one on its next cookie validation).
            await userStore.SetPasswordHashAsync(user.Id, newHash, bumpStamp: true, ct).ConfigureAwait(false);

            // WS-D-D4 — NEVER logs body.CurrentPassword/body.NewPassword, only the account-lifecycle fact
            // that this username's password changed.
            await recorder.RecordAsync(http, "auth.change_password", "username", username, null, null, ct).ConfigureAwait(false);

            return Results.Ok();
        }).RequireAuthorization(Policies.Operator);
    }

    /// <summary>D1-carried hardening minor #2's minimal length floor — originally just <c>NewPassword</c>
    /// (see the <c>change-password</c> handler's own comment for why this is deliberately simple, not a
    /// full password-strength policy); WS-D final-security-review M-1 reuses the SAME constant for the
    /// bootstrap handler's initial <c>Password</c>, so the very first (most privileged) account on a
    /// deployment is held to the identical floor as every later password set/change. Matches
    /// <c>UserEndpoints.MinPasswordLength</c>'s value (kept as a separate constant there — see that file's
    /// own doc comment on why the two aren't shared across files).</summary>
    private const int MinPasswordLength = 8;

    /// <summary>Builds the <see cref="ClaimsPrincipal"/> every sign-in path (bootstrap/login/demo
    /// auto-login) hands to <c>SignInAsync</c> — kept in one place so the claim SHAPE (which is also what
    /// <c>Program</c>'s <c>OnValidatePrincipal</c> and <c>/v1/auth/me</c> read back) can't drift between
    /// call sites.</summary>
    internal static ClaimsPrincipal BuildPrincipal(UserRecord user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, user.Username),
            new(ClaimTypes.Role, user.Role),
            new(SecurityStampClaimType, user.SecurityStamp),
        };
        if (!string.IsNullOrEmpty(user.DisplayName))
        {
            claims.Add(new Claim(DisplayNameClaimType, user.DisplayName));
        }

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        return new ClaimsPrincipal(identity);
    }
}

public sealed record BootstrapStatusDto(bool NeedsBootstrap);

public sealed record BootstrapRequestDto(string Username, string Password, string? DisplayName = null);

public sealed record LoginRequestDto(string Username, string Password);

public sealed record AuthUserDto(string Username, string Role, string? DisplayName);

public sealed record ChangePasswordRequestDto(string CurrentPassword, string NewPassword);
