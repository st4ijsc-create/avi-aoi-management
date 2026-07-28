using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Infrastructure;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.ServiceHost;

/// <summary>
/// Task WI-5 (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-5-brief.md, fix round 1
/// per review) — the out-of-band Admin-account recovery verb: <c>St4i.EngineApi.exe
/// --reset-admin-password &lt;username&gt; [--password &lt;pw&gt;]</c>. Exists because EVERY
/// password-change path this product ships today (<c>AuthEndpoints.change-password</c>,
/// <c>UserEndpoints.ResetPasswordAsync</c>) sits behind an already-authenticated Admin session — lose every
/// enabled Admin account and there is otherwise no way back into the app short of editing
/// <c>security.db</c> by hand.
///
/// Mirrors <see cref="ServiceInstallVerbs"/>'s exact shape (a SIBLING class, deliberately NOT bolted onto
/// it — that file is about the Windows Service, this is about account recovery) and its dependency-free
/// style: raw <paramref name="args"/> scanning, no CLI-parser library, no DI container, no host.
/// <see cref="TryHandle"/> is called from <c>Program.cs</c>'s FIRST lines, immediately after
/// <see cref="ServiceInstallVerbs.TryHandle"/> and strictly BEFORE <c>WebApplication.CreateBuilder</c> — a
/// recovery invocation must never spin up Kestrel, DataProtection, or any other part of the composition
/// root. It only ever opens <c>security.db</c> directly via <see cref="SqliteUserStore"/>/
/// <see cref="SqliteAuditStore"/> — the exact same raw-ADO.NET stores the running host itself uses, pointed
/// at the exact same directory (<see cref="RunAsync"/> resolves it once via <c>SecurityDb.ResolveRoot()</c>
/// and, like <c>Program.cs</c>, creates it and applies <see cref="SecurityDirAcl.Apply"/> BEFORE either
/// store is constructed — see the fix-round note below).
///
/// This tool and a LIVE host CAN safely share the same <c>users</c> table at once (every write there is a
/// single self-contained UPDATE/INSERT with no explicit-id assignment). The hash-chained <c>audit_log</c>
/// is a narrower case: both this verb and a live host compute their next row's explicit <c>id</c>/
/// <c>prev_hash</c> under their OWN in-process lock only (<c>SqliteAuditStore</c>'s own doc comment is
/// explicit that its lock is in-process, not cross-process) — running this verb against a file a live host
/// is ALSO actively writing to can, rarely, race two processes onto the same next <c>id</c>; the loser gets
/// a UNIQUE-constraint <see cref="SqliteException"/> from SQLite. <see cref="AppendAuditRowAsync"/> retries
/// a bounded number of times specifically for that case (a retry re-reads the now-advanced last row and
/// computes a fresh id) before giving up and swallowing/logging — see that method's own doc comment.
///
/// <b>THREAT MODEL — read this before treating the verb as "just another CLI flag" (task-5-report.md
/// carries the full write-up, including the fix-round corrections; WI-7's README is meant to lift that
/// paragraph nearly verbatim):</b> anyone who can execute this exe on this machine can take over the
/// application — mint themselves Admin, or promote an existing account to Admin, with no login and no
/// existing session required. That is the INTENDED semantics of an out-of-band recovery tool, not an
/// oversight to be hedged away. The real security boundary this verb relies on is the OS-level ACL on
/// <c>%ProgramData%\ST4I\sim\security</c> (<see cref="SecurityDirAcl"/> — SYSTEM, Administrators, and the
/// directory's current owner only) plus ordinary Windows login/administrator rights to this machine — NOT
/// the application's own cookie/RBAC layer, which this verb exists specifically to bypass. This tool
/// deliberately does NOT add its own elevation (UAC) requirement on top of that ACL — see task-5-report.md
/// for the reasoning (and its fix-round correction on exactly what the ACL does/doesn't guarantee on an
/// interactive, non-service install).
///
/// Every successful invocation appends exactly ONE row to the SAME hash-chained <c>audit_log</c> the
/// running host writes to (actor <see cref="AuditActorUsername"/>), so a completed recovery is never
/// invisible — see <see cref="AppendAuditRowAsync"/>. Appending that row can never masquerade as an
/// HTTP-originated row: <see cref="Auth.AuditAppend.CorrelationId"/>/<see cref="Auth.AuditAppend.ClientIp"/>
/// are always <see langword="null"/> here (there is no <c>HttpContext</c> to take them from), and the
/// actor/role are the fixed <see cref="AuditActorUsername"/>/<see cref="AuditActorRole"/> literals, never a
/// real username/role pulled from a claims principal that doesn't exist in this process.
/// </summary>
public static class AdminRecoveryVerbs
{
    public const string VerbName = "--reset-admin-password";
    private const string PasswordOptionName = "--password";

    /// <summary>Same floor <c>AuthEndpoints.change-password</c>/<c>UserEndpoints.CreateUserAsync</c>/
    /// <c>ResetPasswordAsync</c> already enforce for every in-app password set — fix-round I2. An explicit
    /// <c>--password</c> below this length (or blank) is a usage error, not a silently-accepted weak
    /// credential: unlike this verb's own local-execution requirement, a password it sets works over the
    /// network via <c>POST /v1/auth/login</c> exactly like any other — there is no "local-only" carve-out
    /// once the credential exists in <c>security.db</c>.</summary>
    private const int MinPasswordLength = 8;

    /// <summary>Bounded retry count for the audit append's UNIQUE-constraint race — fix-round M1. See this
    /// class' own doc comment for why the race is possible at all (the in-process append lock does not
    /// cover a second, concurrent process/host writing the same file) and <see cref="AppendAuditRowAsync"/>
    /// for the retry itself. Not a distributed-lock guarantee (no upper bound is theoretically airtight
    /// under adversarial scheduling) — a small, generous headroom over what real-world thread/process
    /// scheduling jitter needs, proven under genuine concurrent load by
    /// <c>AdminRecoveryVerbsTests.AppendAuditRowAsync_ConcurrentInvocations_...</c>.</summary>
    private const int MaxAuditAppendAttempts = 8;

    private const int GeneratedPasswordLength = 24;

    // Upper+lower+digit+punctuation, ~74 symbols — no character excluded for "looks like O/0/l/1"
    // ambiguity on purpose: this password is only ever generated when the operator did NOT supply their
    // own via --password, so it's never meant to be hand-typed/read off a screen by a human; trading away
    // entropy for that usability property would buy nothing here. 24 symbols from a 74-symbol alphabet is
    // ~149 bits of entropy (24 * log2(74)). No character-CLASS composition is guaranteed by construction
    // (each character is drawn independently/uniformly) — the product has no class-composition password
    // policy, so this deliberately isn't tested for either (see AdminRecoveryVerbsTests' own comment on
    // this, fix-round I3).
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
        if (IsMissingOperand(username))
        {
            PrintUsage($"{VerbName}: a username is required.");
            return 1;
        }

        var passwordOptionIndex = IndexOfIgnoreCase(args, PasswordOptionName);
        string password;
        bool passwordWasGenerated;

        if (passwordOptionIndex < 0)
        {
            // --password omitted entirely -> generate. This is the ONLY case that generates: fix-round
            // I4/M2 below make a --password flag that IS present, but unusable, a usage error instead.
            passwordWasGenerated = true;
            password = GenerateStrongPassword();
        }
        else
        {
            var explicitPassword = passwordOptionIndex + 1 < args.Length ? args[passwordOptionIndex + 1] : null;

            // Fix-round I4/M2 — a --password flag the caller DID type, but with no usable value (missing,
            // blank, or itself another flag, e.g. `--password --force`), is a usage ERROR, consistent with
            // how a missing/flag-shaped username is already treated (IsMissingOperand covers both). Quietly
            // falling back to generation here would mean an operator/script that explicitly asked to set a
            // KNOWN password ends up with an unknown, only-ever-printed-once one instead — the exact
            // automation trap where the script believes the account has $PW, but the real credential only
            // ever existed in stdout that may already be discarded, leaving the original lock-out unsolved.
            if (IsMissingOperand(explicitPassword))
            {
                PrintUsage($"{VerbName}: {PasswordOptionName} requires a value.");
                return 1;
            }

            // Fix-round I2 — same floor every in-app password-set path already enforces.
            if (explicitPassword!.Length < MinPasswordLength)
            {
                PrintUsage($"{VerbName}: password must be at least {MinPasswordLength} characters.");
                return 1;
            }

            passwordWasGenerated = false;
            password = explicitPassword;
        }

        try
        {
            return RunAsync(username!, password, passwordWasGenerated).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            // Deliberately NOT an elevation *requirement* up front (see this class' own doc comment /
            // task-5-report.md) — but a permission failure opening security.db should still surface as a
            // clear, actionable message rather than a raw, unhandled exception/stack trace.
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
        // Fix-round I1 (the most serious finding) — resolve the SAME directory the real host would
        // (SecurityDb.ResolveRoot(): ST4I_SECURITY_DIR if set, else %ProgramData%\ST4I\sim\security),
        // create it, and lock its ACL down BEFORE either store (or security.db itself) is created —
        // mirroring Program.cs's own startup sequence (Directory.CreateDirectory then
        // SecurityDirAcl.Apply, BEFORE AddDataProtection/the IUserStore/IAuditStore registrations touch
        // it) and CredentialStore/DeviceIdentityStore's identical pattern. Without this, a FIRST-EVER
        // invocation of this verb on a machine where the host has never started (a legitimate use of this
        // tool — e.g. pre-seeding the very first Admin before the product's first real boot) would create
        // the directory inheriting %ProgramData%'s permissive default (Authenticated Users: Read),
        // exposing the PBKDF2 hashes and the whole audit log to any local account — and per
        // SecurityDirAcl's own doc comment, a LATER host start does not retroactively re-ACL pre-existing
        // children, so this does not self-heal on its own.
        var securityDir = SecurityDb.ResolveRoot();
        Directory.CreateDirectory(securityDir);
        SecurityDirAcl.Apply(securityDir, msg => Console.Error.WriteLine($"{VerbName}: {msg}"));

        var userStore = new SqliteUserStore(securityDir);
        var auditStore = new SqliteAuditStore(securityDir);

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

            // Fix-round M3 — the password hash is written LAST among the three possible mutations
            // (role promotion / re-enable / password), deliberately reordered from an earlier draft that
            // set the password FIRST. If SetRoleAsync/SetDisabledAsync throws AFTER the password had
            // already been committed, a (possibly GENERATED, never-yet-printed) password would be the
            // account's only working credential with no way for the operator to ever learn it short of
            // re-running the whole verb again — an unrecoverable-except-by-retry state for something whose
            // entire point is recovery. With the password LAST, any throw here leaves the account's
            // password exactly as it was before this run (the OLD, still-known-if-it-was-known password);
            // only once every prior step has succeeded does the LAST call change the credential, and
            // PrintOutcome (which prints a generated password) runs immediately afterward, before anything
            // else that could still fail (the audit append, which — see AppendAuditRowAsync — can never
            // throw back out to here).
            if (promoted)
            {
                await userStore.SetRoleAsync(existing.Id, Roles.Admin).ConfigureAwait(false);
            }

            // A locked-out operator's last remaining account could be disabled as well as non-Admin — a
            // recovery that resets/promotes but leaves it disabled would still leave login blocked, which
            // defeats the whole point of this verb. Not explicitly called out by the brief's branch list,
            // but squarely inside "restores Admin access" (the brief's own acceptance criterion) — reviewed
            // and upheld in fix round 1.
            if (reEnabled)
            {
                await userStore.SetDisabledAsync(existing.Id, false).ConfigureAwait(false);
            }

            // Always bump the security stamp — every existing session for this account (the very sessions
            // a lock-out recovery is trying to route around) must stop being valid the instant this
            // completes; see IUserStore.SetPasswordHashAsync's own doc comment. LAST on purpose — see the
            // comment above.
            await userStore.SetPasswordHashAsync(existing.Id, hash, bumpStamp: true).ConfigureAwait(false);
        }

        // Print BEFORE the audit append: every mutation that can meaningfully fail has already happened by
        // this point, so the operator sees the (possibly generated) password as early as structurally
        // possible. AppendAuditRowAsync below can never throw back out to here (it retries/logs/swallows
        // internally — see its own doc comment), so ordering print before it is safe, not just convenient.
        PrintOutcome(username, created, promoted, reEnabled, passwordWasGenerated, password);

        await AppendAuditRowAsync(auditStore, username, userId, created, promoted, reEnabled, previousRole).ConfigureAwait(false);

        return 0;
    }

    /// <summary>Appends one audit row, retrying up to <see cref="MaxAuditAppendAttempts"/> times if (and
    /// only if) the failure is specifically a SQLite UNIQUE-constraint violation on the explicit <c>id</c>
    /// <see cref="SqliteAuditStore.AppendAsync"/> computes — see this class' own doc comment for why that's
    /// possible at all (a live host writing the SAME file concurrently, racing this verb's own in-process
    /// lock, which by definition can't serialize against a SEPARATE process). A retry re-reads the
    /// now-advanced last row and recomputes a fresh id/prev_hash, so it either succeeds or, in the
    /// pathological case of a genuinely hot-contended file, eventually gives up. Any OTHER exception (and a
    /// UNIQUE-constraint failure that persists through every retry) is logged to stderr and swallowed —
    /// same "never let the audit subsystem undo/block an already-committed real mutation" policy
    /// <see cref="Auth.AuditRecorder.RecordAsync"/> applies for every HTTP path — because by the time this
    /// runs, the password reset/promotion has ALREADY committed and already been printed; losing this one
    /// audit row must not make the whole recovery report failure.
    ///
    /// <c>internal</c> (not <c>private</c>) as a test seam only — mirrors this codebase's existing
    /// convention (e.g. <c>UserEndpoints</c>' internal handler methods) for exercising a genuine
    /// cross-instance concurrency scenario directly, rather than needing N real separate processes.</summary>
    internal static async Task AppendAuditRowAsync(
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

        for (var attempt = 1; attempt <= MaxAuditAppendAttempts; attempt++)
        {
            try
            {
                await auditStore.AppendAsync(entry, CancellationToken.None).ConfigureAwait(false);
                return;
            }
            catch (SqliteException ex) when (IsUniqueConstraintViolation(ex) && attempt < MaxAuditAppendAttempts)
            {
                // Fix-round M1 — another writer (a live host sharing this file) won the race for the same
                // explicit id between our read-last-row and our insert; retry re-reads the now-advanced
                // last row/hash and computes a fresh one. Falls through to the next loop iteration.
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"{VerbName}: warning: the password reset/promotion above succeeded, but writing the audit log row failed: {ex.Message}");
                return;
            }
        }
    }

    private static bool IsUniqueConstraintViolation(SqliteException ex) =>
        ex.SqliteErrorCode == 19; // SQLITE_CONSTRAINT (covers SQLITE_CONSTRAINT_PRIMARYKEY/UNIQUE alike).

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

    private static void PrintUsage(string? reason = null)
    {
        if (reason is not null)
        {
            Console.Error.WriteLine(reason);
        }

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

    /// <summary>Shared "is this token usable as an operand" rule — fix-round M2 makes a <c>--password</c>
    /// value that itself looks like another flag consistent with how the username operand already treats
    /// the same shape (e.g. <c>--reset-admin-password bob --password --force</c> now rejects the missing
    /// password value the same way <c>--reset-admin-password --password x</c> already rejects the missing
    /// username, rather than silently accepting the literal string <c>"--force"</c> as a password).</summary>
    private static bool IsMissingOperand(string? token) =>
        string.IsNullOrWhiteSpace(token) || token.StartsWith("--", StringComparison.Ordinal);
}
