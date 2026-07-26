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

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/auth/bootstrap-status", async (IUserStore userStore, CancellationToken ct) =>
        {
            var count = await userStore.CountAsync(ct).ConfigureAwait(false);
            return Results.Ok(new BootstrapStatusDto(count == 0));
        }).AllowAnonymous();

        app.MapPost("/v1/auth/bootstrap", async (BootstrapRequestDto body, IUserStore userStore, HttpContext http, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password))
            {
                return Results.BadRequest(new ApiErrorDto("username and password are required"));
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

                // TODO(D3/D4): audit "auth.bootstrap" once the audit store exists — not blocking this task
                // (brief: "do not block on audit not existing yet").

                await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, BuildPrincipal(user)).ConfigureAwait(false);

                return Results.Ok(new AuthUserDto(user.Username, user.Role, user.DisplayName));
            }
            finally
            {
                BootstrapLock.Release();
            }
        }).AllowAnonymous();

        app.MapPost("/v1/auth/login", async (LoginRequestDto body, IUserStore userStore, HttpContext http, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password))
            {
                return Results.Unauthorized();
            }

            var user = await userStore.GetByUsernameAsync(body.Username, ct).ConfigureAwait(false);
            if (user is null || user.Disabled)
            {
                return Results.Unauthorized();
            }

            var hasher = new PasswordHasher<AppUser>();
            var verification = hasher.VerifyHashedPassword(AppUser.Instance, user.PasswordHash, body.Password);
            if (verification == PasswordVerificationResult.Failed)
            {
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
            await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, BuildPrincipal(user)).ConfigureAwait(false);

            return Results.Ok(new AuthUserDto(user.Username, user.Role, user.DisplayName));
        }).AllowAnonymous();

        app.MapPost("/v1/auth/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme).ConfigureAwait(false);
            return Results.Ok();
        });

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
        });

        app.MapPost("/v1/auth/change-password", async (ChangePasswordRequestDto body, HttpContext http, IUserStore userStore, CancellationToken ct) =>
        {
            var username = http.User.Identity?.Name;
            if (string.IsNullOrEmpty(username))
            {
                return Results.Unauthorized();
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

            return Results.Ok();
        });
    }

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
