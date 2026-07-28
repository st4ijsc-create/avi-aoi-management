using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.ServiceHost;

/// <summary>
/// Task WI-5 (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-5-brief.md) — the
/// out-of-band Admin-account recovery verb: <c>St4i.EngineApi.exe --reset-admin-password &lt;username&gt;
/// [--password &lt;pw&gt;]</c>. Exists because EVERY password-change path this product ships today
/// (<c>AuthEndpoints.change-password</c>, <c>UserEndpoints.ResetPasswordAsync</c>) sits behind an
/// already-authenticated Admin session — lose every enabled Admin account and there is otherwise no way
/// back into the app short of editing <c>security.db</c> by hand.
///
/// Mirrors <see cref="ServiceInstallVerbs"/>'s exact shape (a SIBLING class, deliberately NOT bolted onto
/// it — that file is about the Windows Service, this is about account recovery) and its dependency-free
/// style: raw <paramref name="args"/> scanning, no CLI-parser library, no DI container, no host.
/// <see cref="TryHandle"/> is called from <c>Program.cs</c>'s FIRST lines, immediately after
/// <see cref="ServiceInstallVerbs.TryHandle"/> and strictly BEFORE <c>WebApplication.CreateBuilder</c> — a
/// recovery invocation must never spin up Kestrel, DataProtection, or any other part of the composition
/// root. It only ever opens <c>security.db</c> directly via <see cref="SqliteUserStore"/>/
/// <see cref="SqliteAuditStore"/> — the exact same raw-ADO.NET stores the running host itself uses (this
/// tool and a live host CAN safely point at the same file at once; both use short-lived SQLite connections
/// under WAL mode, same as every other store in this codebase).
///
/// <b>THREAT MODEL — read this before treating the verb as "just another CLI flag" (task-5-report.md
/// carries the full write-up; WI-7's README is meant to lift this paragraph nearly verbatim):</b> anyone
/// who can execute this exe on this machine can take over the application — mint themselves Admin, or
/// promote an existing account to Admin, with no login and no existing session required. That is the
/// INTENDED semantics of an out-of-band recovery tool, not an oversight to be hedged away. The real
/// security boundary this verb relies on is the OS-level ACL on <c>%ProgramData%\ST4I\sim\security</c>
/// (see <c>SecurityDirAcl.Apply</c> in <c>Program.cs</c>, which restricts that directory to
/// owner+SYSTEM+Administrators) plus ordinary Windows login/administrator rights to this machine — NOT the
/// application's own cookie/RBAC layer, which this verb exists specifically to bypass. This tool
/// deliberately does NOT add its own elevation (UAC) requirement on top of that ACL — see task-5-report.md
/// for the reasoning.
///
/// Every successful invocation appends exactly ONE row to the SAME hash-chained <c>audit_log</c> the
/// running host writes to (actor <see cref="AuditActorUsername"/>), so a completed recovery is never
/// invisible — see <see cref="AppendAuditRowAsync"/>. Appending that row can never masquerade as an
/// HTTP-originated row: <see cref="Auth.AuditAppend.CorrelationId"/>/<see cref="Auth.AuditAppend.ClientIp"/>
/// are always <see langword="null"/> here (there is no <c>HttpContext</c> to take them from), and the
/// actor/role are the fixed <see cref="AuditActorUsername"/>/<see cref="AuditActorRole"/> literals, never a
/// real username/role pulled from a claims principal that doesn't exist in this process. A failure to
/// append the row is logged to stderr and swallowed — same "never let the audit subsystem undo/block an
/// already-committed real mutation" policy <see cref="Auth.AuditRecorder"/> applies for every HTTP path —
/// because by the time the append is attempted, the password reset/promotion has already committed.
/// </summary>
public static class AdminRecoveryVerbs
{
    public const string VerbName = "--reset-admin-password";
    private const string PasswordOptionName = "--password";

    private const int GeneratedPasswordLength = 24;

    // Upper+lower+digit+punctuation, ~74 symbols — no character excluded for "looks like O/0/l/1"
    // ambiguity on purpose: this password is only ever generated when the operator did NOT supply their
    // own via --password, so it's never meant to be hand-typed/read off a screen by a human; trading away
    // entropy for that usability property would buy nothing here. 24 symbols from a 74-symbol alphabet is
    // ~149 bits of entropy (24 * log2(74)).
    private const string GeneratedPasswordAlphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+";

    /// <summary>The fixed <c>audit_log.actor_username</c> for every row this verb appends — the brief's
    /// exact literal, distinct from any real account name, so a review of the audit trail can immediately
    /// tell "this was the out-of-band recovery tool," never a real, already-authenticated Admin.</summary>
    internal const string AuditActorUsername = "console-recovery";

    /// <summary>Denormalized <c>actor_role</c> for every row this verb appends. There is no real,
    /// authenticated <see cref="System.Security.Claims.ClaimsPrincipal"/> here (unlike every HTTP-triggered
    /// audit row) — this is a fixed placeholder, in the same spirit as
    /// <see cref="Auth.AuditRecorder.RecordSystemAsync"/>'s <c>"(system)"</c> actor/role for events with no
    /// <c>HttpContext</c> at all.</summary>
    internal const string AuditActorRole = "(console)";

    internal const string AuditAction = "console.reset_admin_password";

    /// <summary>Recognizes <see cref="VerbName"/> anywhere in <paramref name="args"/> (same
    /// case-insensitive scan idiom as <see cref="ServiceInstallVerbs.TryHandle"/>) and, if present, handles
    /// the WHOLE request itself — including printing usage/errors and returning a non-zero
    /// <paramref name="exitCode"/> for a malformed invocation — so <c>Program.cs</c> can unconditionally
    /// early-return without ever calling <c>WebApplication.CreateBuilder</c>. Returns
    /// <see langword="false"/> with zero I/O for every other argument shape (normal engine startup,
    /// <see cref="ServiceInstallVerbs"/>' own verbs, <c>--urls</c>, etc).</summary>
    public static bool TryHandle(string[] args, out int exitCode)
    {
        var verbIndex = IndexOfIgnoreCase(args, VerbName);
        if (verbIndex < 0)
        {
            exitCode = 0;
            return false;
        }

        exitCode = Run(args, verbIndex);
        return true;
    }

    private static int Run(string[] args, int verbIndex)
    {
        var username = verbIndex + 1 < args.Length ? args[verbIndex + 1] : null;
        // A token that itself looks like another flag (e.g. the caller wrote
        // `--reset-admin-password --password x` with the username actually omitted) is treated the same as
        // a genuinely missing username — never silently consumed as a literal username.
        if (string.IsNullOrWhiteSpace(username) || username.StartsWith("--", StringComparison.Ordinal))
        {
            PrintUsage();
            return 1;
        }

        var explicitPassword = FindOptionValue(args, PasswordOptionName);
        var passwordWasGenerated = string.IsNullOrEmpty(explicitPassword);
        var password = passwordWasGenerated ? GenerateStrongPassword() : explicitPassword!;

        try
        {
            return RunAsync(username, password, passwordWasGenerated).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Deliberately NOT an elevation *requirement* up front (see this class' own doc comment /
            // task-5-report.md) — but a permission failure opening security.db (the single most likely
            // real-world failure, if the ACL Program.cs applies at startup is doing its job) should still
            // surface as a clear, actionable message rather than a raw, unhandled exception/stack trace.
            Console.Error.WriteLine($"{VerbName}: failed: {ex.Message}");
            Console.Error.WriteLine(
                $"{VerbName}: if this looks like an access-denied/permission error, re-run this command " +
                "from an elevated (\"Run as administrator\") command prompt, or as a Windows account with " +
                "write access to the ST4I security directory.");
            return 1;
        }
    }

    private static async Task<int> RunAsync(string username, string password, bool passwordWasGenerated)
    {
        // Both stores resolve their directory exactly the way the real host does
        // (SecurityDb.ResolveRoot(): ST4I_SECURITY_DIR if set, else %ProgramData%\ST4I\sim\security) — no
        // directory-override lever exists here on purpose. This verb has nothing but `args` to work with
        // (no builder, no DI, no config), so "honour ST4I_SECURITY_DIR" is exactly what passing no explicit
        // directory to either constructor already achieves.
        var userStore = new SqliteUserStore();
        var auditStore = new SqliteAuditStore();

        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, password);

        var existing = await userStore.GetByUsernameAsync(username).ConfigureAwait(false);

        int userId;
        bool created;
        bool promoted;
        bool reEnabled;
        string previousRole;

        if (existing is null)
        {
            var createdUser = await userStore.CreateAsync(
                username, hash, Roles.Admin, displayName: null, createdBy: AuditActorUsername).ConfigureAwait(false);
            userId = createdUser.Id;
            created = true;
            promoted = true; // there was no prior role at all — a brand-new Admin account.
            reEnabled = false;
            previousRole = "(none — new account)";
        }
        else
        {
            userId = existing.Id;
            created = false;
            previousRole = existing.Role;
            promoted = !string.Equals(existing.Role, Roles.Admin, StringComparison.Ordinal);
            reEnabled = existing.Disabled;

            // Always bump the security stamp — every existing session for this account (the very sessions
            // a lock-out recovery is trying to route around) must stop being valid the instant this
            // completes; see IUserStore.SetPasswordHashAsync's own doc comment.
            await userStore.SetPasswordHashAsync(existing.Id, hash, bumpStamp: true).ConfigureAwait(false);
            if (promoted)
            {
                await userStore.SetRoleAsync(existing.Id, Roles.Admin).ConfigureAwait(false);
            }

            // A locked-out operator's last remaining account could be disabled as well as non-Admin — a
            // recovery that resets/promotes but leaves it disabled would still leave login blocked, which
            // defeats the whole point of this verb. Not explicitly called out by the brief's branch list,
            // but squarely inside "restores Admin access" (the brief's own acceptance criterion).
            if (reEnabled)
            {
                await userStore.SetDisabledAsync(existing.Id, false).ConfigureAwait(false);
            }
        }

        await AppendAuditRowAsync(auditStore, username, userId, created, promoted, reEnabled, previousRole).ConfigureAwait(false);

        PrintOutcome(username, created, promoted, reEnabled, passwordWasGenerated, password);
        return 0;
    }

    private static async Task AppendAuditRowAsync(
        SqliteAuditStore auditStore, string username, int userId, bool created, bool promoted, bool reEnabled, string previousRole)
    {
        // NEVER the password/hash — same discipline every HTTP-triggered user.* audit row already follows
        // (see UserEndpoints/AuthEndpoints' own comments on exactly this point).
        var newValueJson = JsonSerializer.Serialize(
            new { username, role = Roles.Admin, created, promoted, reEnabled, sessionsInvalidated = !created },
            St4i.EngineApi.ApiJson.Options);
        var oldValueJson = created ? null : JsonSerializer.Serialize(new { role = previousRole }, St4i.EngineApi.ApiJson.Options);

        var entry = new AuditAppend(
            ActorUsername: AuditActorUsername,
            ActorRole: AuditActorRole,
            Action: AuditAction,
            TargetType: "user",
            TargetId: userId.ToString(CultureInfo.InvariantCulture),
            OldValueJson: oldValueJson,
            NewValueJson: newValueJson,
            // No HttpContext exists here at all — left null rather than fabricated, so this row can never
            // be mistaken for one that came from a real HTTP request (see this class' own doc comment).
            CorrelationId: null,
            ClientIp: null,
            AtUtc: DateTimeOffset.UtcNow);

        try
        {
            await auditStore.AppendAsync(entry, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Same "never let the audit subsystem undo/block an already-committed real mutation" policy
            // AuditRecorder.RecordAsync applies for every HTTP path — by the time this runs, the password
            // reset/promotion above has ALREADY committed; losing this one audit row must not make the
            // whole recovery report failure (this verb's exitCode would otherwise wrongly tell the operator
            // the recovery itself failed).
            Console.Error.WriteLine($"{VerbName}: warning: the password reset/promotion above succeeded, but writing the audit log row failed: {ex.Message}");
        }
    }

    private static string GenerateStrongPassword()
    {
        var chars = new char[GeneratedPasswordLength];
        for (var i = 0; i < GeneratedPasswordLength; i++)
        {
            // RandomNumberGenerator.GetInt32 does unbiased rejection sampling internally — unlike
            // `alphabet[randomByte % alphabet.Length]`, which would skew towards the first
            // `256 % alphabet.Length` characters of the alphabet.
            chars[i] = GeneratedPasswordAlphabet[RandomNumberGenerator.GetInt32(GeneratedPasswordAlphabet.Length)];
        }
        return new string(chars);
    }

    private static void PrintUsage()
    {
        Console.Error.WriteLine($"Usage: St4i.EngineApi.exe {VerbName} <username> [{PasswordOptionName} <newPassword>]");
        Console.Error.WriteLine("  Out-of-band Admin-account recovery — resets an existing user's password (promoting it to");
        Console.Error.WriteLine("  Admin and re-enabling it if needed), or creates a brand-new Admin account if the username");
        Console.Error.WriteLine("  doesn't exist yet.");
        Console.Error.WriteLine($"  If {PasswordOptionName} is omitted, a strong random password is generated and printed once to stdout.");
    }

    private static void PrintOutcome(string username, bool created, bool promoted, bool reEnabled, bool passwordWasGenerated, string password)
    {
        Console.WriteLine(created
            ? $"Created new Admin account '{username}'."
            : $"Reset password for existing user '{username}'.");

        if (!created && promoted)
        {
            Console.WriteLine($"Promoted '{username}' to the {Roles.Admin} role (it was not previously an Admin).");
        }

        if (!created && reEnabled)
        {
            Console.WriteLine($"Re-enabled '{username}' (the account was previously disabled).");
        }

        if (!created)
        {
            Console.WriteLine("Any existing session cookie(s) for this account have been invalidated (security stamp bumped).");
        }

        if (passwordWasGenerated)
        {
            Console.WriteLine("Generated password (printed exactly once here — not logged or stored anywhere else):");
            Console.WriteLine(password);
        }
    }

    private static int IndexOfIgnoreCase(string[] args, string value)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (string.Equals(args[i], value, StringComparison.OrdinalIgnoreCase)) return i;
        }
        return -1;
    }

    private static string? FindOptionValue(string[] args, string optionName)
    {
        var index = IndexOfIgnoreCase(args, optionName);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
