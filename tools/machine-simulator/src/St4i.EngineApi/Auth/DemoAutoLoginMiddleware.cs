using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using St4i.EngineApi.Config;

namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D1 — keeps a Demo-flagged deployment (exhibition <c>.exe</c>, the Playwright test engine) usable
/// once the default-deny fallback policy (<c>Program</c>'s <c>AddAuthorization</c>) requires an
/// authenticated principal on every route that isn't explicitly <c>AllowAnonymous</c>. Without this, every
/// pre-existing test/exhibition flow that hits e.g. <c>GET /v1/fleet</c> with no login step at all would
/// start failing with 401 the moment default-deny landed.
///
/// When <see cref="DemoModeGate.Enabled"/> is <see langword="true"/> and the incoming request has no
/// authenticated user yet, this ensures a REAL (not bypassed/fake) <c>demo-admin</c> Admin account exists
/// — created once, idempotently, under a lock — signs it in through the exact same cookie
/// <c>SignInAsync</c> every other login path uses, AND sets <c>context.User</c> for the CURRENT request:
/// the cookie <c>SignInAsync</c> writes only takes effect starting with the NEXT request that reads it
/// back, so without also assigning <c>context.User</c> here, <c>UseAuthorization</c> (which runs later in
/// THIS SAME request's pipeline) would still see an unauthenticated principal and 401 the very request
/// that just auto-logged-in.
///
/// On a product build (<c>ST4I_DEMO_ENABLED</c> unset/false) <see cref="DemoModeGate.Enabled"/> is
/// <see langword="false"/> and this middleware is a complete no-op — it never even touches
/// <see cref="IUserStore"/>, exactly like every other <see cref="DemoModeGate"/> seam in this codebase.
/// </summary>
public static class DemoAutoLoginMiddleware
{
    public const string DemoUsername = "demo-admin";

    // Serializes the check-then-create so two concurrent requests racing to auto-login before demo-admin
    // exists can't both try to INSERT the same username (users.username is UNIQUE COLLATE NOCASE).
    private static readonly SemaphoreSlim CreateLock = new(1, 1);

    public static IApplicationBuilder UseDemoAutoLogin(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var demoGate = context.RequestServices.GetRequiredService<DemoModeGate>();
            if (demoGate.Enabled && context.User.Identity?.IsAuthenticated != true)
            {
                var userStore = context.RequestServices.GetRequiredService<IUserStore>();
                var user = await EnsureDemoAdminAsync(userStore, context.RequestAborted).ConfigureAwait(false);

                if (!user.Disabled)
                {
                    var principal = AuthEndpoints.BuildPrincipal(user);
                    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal).ConfigureAwait(false);
                    context.User = principal;
                }
            }

            await next(context).ConfigureAwait(false);
        });

    private static async Task<UserRecord> EnsureDemoAdminAsync(IUserStore userStore, CancellationToken ct)
    {
        var existing = await userStore.GetByUsernameAsync(DemoUsername, ct).ConfigureAwait(false);
        if (existing is not null) return existing;

        await CreateLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Re-check inside the lock — another request may have created it while this one waited.
            existing = await userStore.GetByUsernameAsync(DemoUsername, ct).ConfigureAwait(false);
            if (existing is not null) return existing;

            var hasher = new PasswordHasher<AppUser>();
            // Nobody ever logs in AS demo-admin with a password — this account is only ever reached
            // through this auto-login seam — so the "password" is a throwaway random value. It's still
            // hashed one-way like any other password (never stored/transmitted in the clear, never
            // DPAPI'd), it's just never intended to be typed by anyone.
            var randomPassword = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
            var hash = hasher.HashPassword(AppUser.Instance, randomPassword);

            return await userStore.CreateAsync(
                    DemoUsername, hash, Roles.Admin, displayName: "Demo Admin", createdBy: "system:demo-auto-login", ct)
                .ConfigureAwait(false);
        }
        finally
        {
            CreateLock.Release();
        }
    }
}
