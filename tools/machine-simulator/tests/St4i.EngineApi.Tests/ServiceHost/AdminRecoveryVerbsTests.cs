using System.Net;
using System.Net.Http.Json;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using St4i.EngineApi.Auth;
using St4i.EngineApi.ServiceHost;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.ServiceHost;

/// <summary>
/// Task WI-5 (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-5-brief.md, fix round 1
/// per review) — <see cref="AdminRecoveryVerbs"/>, the out-of-band <c>--reset-admin-password</c>
/// lock-out-recovery verb.
///
/// Pure argument-parsing/no-I/O cases (mirroring <c>ServiceInstallVerbsTests</c>) need no directory at all.
/// Every other case that touches <c>security.db</c> points <c>ST4I_SECURITY_DIR</c> at a FRESH temp
/// directory for the duration of one call (never the real <c>%ProgramData%\ST4I\sim\</c>), following the
/// exact same real-env-var-swap convention <see cref="SecurityEnvVarTests.CollectionName"/>'s sibling
/// classes (<c>AuthPipelineTests</c>, <c>UserEndpointsTests</c>, ...) already established for
/// <c>WebApplicationFactory&lt;Program&gt;</c> — this class joins the SAME xUnit collection because two of
/// its own tests build a real factory pointed at the SAME env var.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AdminRecoveryVerbsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static string NewTempDir() => Directory.CreateTempSubdirectory("st4i-adminrecovery-tests-").FullName;

    /// <summary>Runs <see cref="AdminRecoveryVerbs.TryHandle"/> with <c>ST4I_SECURITY_DIR</c> pointed at
    /// <paramref name="securityDir"/> for the duration of the call only, then restores whatever the real
    /// process env var held before (same window-narrowing discipline <c>AuthPipelineTests.CreateFactoryAsync</c>
    /// uses around its own eager factory build) — <see cref="EnvLock"/> plus this class' shared xUnit
    /// collection keep this serialized against every other class that touches the same real env var.</summary>
    private static async Task<int> RunVerbAsync(string securityDir, params string[] args)
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prev = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            var handled = AdminRecoveryVerbs.TryHandle(args, out var exitCode);
            Assert.True(handled, "AdminRecoveryVerbs.TryHandle must recognize --reset-admin-password and return true.");
            return exitCode;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prev);
            EnvLock.Release();
        }
    }

    /// <summary>Same as <see cref="RunVerbAsync"/>, but also captures everything written to
    /// <see cref="Console.Out"/> during the call (used by the usage-message and generated-password tests).
    /// Swaps <see cref="Console.Out"/> for the whole env-var-mutation window so no other thread's writes can
    /// interleave into the captured buffer as long as <see cref="EnvLock"/>/the shared xUnit collection keep
    /// this serialized (same reasoning that already applies to the env var swap itself).</summary>
    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunVerbCapturingConsoleAsync(string securityDir, params string[] args)
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevOut = Console.Out;
        var prevErr = Console.Error;
        using var stdout = new StringWriter();
        using var stderr = new StringWriter();
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Console.SetOut(stdout);
            Console.SetError(stderr);
            var handled = AdminRecoveryVerbs.TryHandle(args, out var exitCode);
            Assert.True(handled);
            return (exitCode, stdout.ToString(), stderr.ToString());
        }
        finally
        {
            Console.SetOut(prevOut);
            Console.SetError(prevErr);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevDir);
            EnvLock.Release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pure arg-recognition — no directory/env var touched at all (mirrors ServiceInstallVerbsTests'
    // TryHandle_ReturnsFalse_AndDoesNoIo_WhenNoServiceVerbIsPresent).
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(new object[] { new string[] { } })]
    [InlineData(new object[] { new[] { "--install" } })]
    [InlineData(new object[] { new[] { "--urls", "http://localhost:6000" } })]
    public void TryHandle_ReturnsFalse_AndDoesNoIo_WhenVerbNotPresent(string[] args)
    {
        var handled = AdminRecoveryVerbs.TryHandle(args, out var exitCode);

        Assert.False(handled);
        Assert.Equal(0, exitCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Missing/blank username — non-zero exit, usage message, and (the important part) zero mutation:
    // security.db is never even created.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(new object[] { new[] { "--reset-admin-password" } })]
    [InlineData(new object[] { new[] { "--reset-admin-password", "   " } })]
    [InlineData(new object[] { new[] { "--reset-admin-password", "--password", "Whatever123!" } })]
    public async Task TryHandle_MissingOrBlankUsername_ReturnsNonZeroExit_PrintsUsage_AndNeverTouchesTheDb(string[] args)
    {
        var securityDir = NewTempDir();

        var (exitCode, _, stderr) = await RunVerbCapturingConsoleAsync(securityDir, args);

        Assert.NotEqual(0, exitCode);
        Assert.Contains("Usage:", stderr, StringComparison.Ordinal);
        Assert.Contains(AdminRecoveryVerbs.VerbName, stderr, StringComparison.Ordinal);

        // No mutation at all: since Run() returns before ever constructing SqliteUserStore/SqliteAuditStore
        // (which would call SecurityDb's ctor -> Directory.CreateDirectory + EnsureSchema), the temp dir
        // must still be completely empty — not just "no row inserted", but "security.db was never even
        // created."
        Assert.Empty(Directory.GetFileSystemEntries(securityDir));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix-round I2/I4/M2 — a --password FLAG that IS present but unusable (missing value, blank value, too
    // short, or a value that itself looks like another flag) is a usage ERROR, exactly like a missing
    // username already is: non-zero exit, a clear message, and zero DB mutation. Falling back to silent
    // generation here would be the automation trap the fix-round review called out (I4) — a caller who
    // explicitly asked for a KNOWN password must get an error, not an unknown, only-ever-printed-once one.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(new object[] { new[] { "--reset-admin-password", "bob", "--password" } })] // value missing entirely
    [InlineData(new object[] { new[] { "--reset-admin-password", "bob", "--password", "   " } })] // blank value
    [InlineData(new object[] { new[] { "--reset-admin-password", "bob", "--password", "--force" } })] // value looks like another flag (M2)
    [InlineData(new object[] { new[] { "--reset-admin-password", "bob", "--password", "short7" } })] // below the 8-char floor (I2)
    public async Task TryHandle_UnusablePasswordFlag_ReturnsNonZeroExit_PrintsUsage_AndNeverTouchesTheDb(string[] args)
    {
        var securityDir = NewTempDir();

        var (exitCode, _, stderr) = await RunVerbCapturingConsoleAsync(securityDir, args);

        Assert.NotEqual(0, exitCode);
        Assert.Contains(AdminRecoveryVerbs.VerbName, stderr, StringComparison.Ordinal);
        Assert.Empty(Directory.GetFileSystemEntries(securityDir));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Unknown username -> a brand-new Admin account, audited.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryHandle_UnknownUsername_CreatesNewAdminAccount_AndAuditsIt()
    {
        var securityDir = NewTempDir();

        var exitCode = await RunVerbAsync(securityDir, "--reset-admin-password", "brand-new-admin", "--password", "Str0ngP@ssw0rd!1");

        Assert.Equal(0, exitCode);

        var userStore = new SqliteUserStore(securityDir);
        var user = await userStore.GetByUsernameAsync("brand-new-admin");
        Assert.NotNull(user);
        Assert.Equal(Roles.Admin, user!.Role);
        Assert.False(user.Disabled);

        var hasher = new PasswordHasher<AppUser>();
        Assert.NotEqual(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(AppUser.Instance, user.PasswordHash, "Str0ngP@ssw0rd!1"));

        var auditStore = new SqliteAuditStore(securityDir);
        var chain = await auditStore.VerifyChainAsync(CancellationToken.None);
        Assert.True(chain.Ok, chain.Detail);

        var page = await auditStore.QueryAsync(null, null, null, AdminRecoveryVerbs.AuditAction, null, 200, 0, CancellationToken.None);
        var row = Assert.Single(page.Items);
        Assert.Equal(AdminRecoveryVerbs.AuditActorUsername, row.ActorUsername);
        Assert.Equal(AdminRecoveryVerbs.AuditActorRole, row.ActorRole);
        Assert.Equal("user", row.TargetType);
        Assert.Equal(user.Id.ToString(), row.TargetId);
        Assert.Null(row.CorrelationId);
        Assert.Null(row.ClientIp);
        Assert.DoesNotContain("Str0ngP@ssw0rd", row.NewValueJson, StringComparison.Ordinal);
        Assert.Contains("\"created\":true", row.NewValueJson, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix-round I1 (the most serious finding) — the FIRST-EVER invocation against a directory that has
    // never existed before (no host has ever started here) must still lock the ACL down before anything is
    // written into it, exactly like Program.cs/CredentialStore/DeviceIdentityStore already do for every
    // OTHER creator of a security-sensitive directory under %ProgramData%\ST4I\sim\*. Same assertion shape
    // as SecurityDirAclTests.Apply_OnFreshDirectory_..., but exercised end-to-end through the verb itself
    // rather than by calling SecurityDirAcl.Apply directly.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryHandle_OnANeverBeforeSeenDirectory_LocksDownTheAclBeforeCreatingSecurityDb()
    {
        // A path that does NOT exist yet (Directory.CreateTempSubdirectory would create it) — the verb
        // itself must be the one to create it AND apply the ACL, mirroring a genuinely fresh deployment
        // where this verb runs before the host has ever started.
        var securityDir = Path.Combine(Path.GetTempPath(), "st4i-adminrecovery-acl-test-" + Guid.NewGuid().ToString("N"));
        Assert.False(Directory.Exists(securityDir));

        var exitCode = await RunVerbAsync(securityDir, "--reset-admin-password", "acl-test-admin", "--password", "Str0ngP@ssw0rd!1");
        Assert.Equal(0, exitCode);

        Assert.True(Directory.Exists(securityDir));
        var acl = new DirectoryInfo(securityDir).GetAccessControl(AccessControlSections.Access);

        // Inheritance disabled — %ProgramData%'s (or, here, temp's) default/parent ACL no longer applies.
        Assert.True(acl.AreAccessRulesProtected);

        var grantedTo = acl
            .GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier))
            .Cast<FileSystemAccessRule>()
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToArray();

        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, domainSid: null);
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, domainSid: null);
        Assert.Contains(grantedTo, sid => sid.Equals(system));
        Assert.Contains(grantedTo, sid => sid.Equals(administrators));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Existing non-Admin user -> promoted to Admin, password reset, stamp bumped.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryHandle_ExistingNonAdminUser_IsPromotedToAdmin_PasswordReset_AndStampBumped()
    {
        var securityDir = NewTempDir();
        var hasher = new PasswordHasher<AppUser>();
        var seedStore = new SqliteUserStore(securityDir);
        var seeded = await seedStore.CreateAsync(
            "op-only-account", hasher.HashPassword(AppUser.Instance, "OldPassword123!"), Roles.Operator, null, createdBy: "test");

        var exitCode = await RunVerbAsync(securityDir, "--reset-admin-password", "op-only-account", "--password", "NewPassword456!");

        Assert.Equal(0, exitCode);

        var updated = await seedStore.GetByUsernameAsync("op-only-account");
        Assert.NotNull(updated);
        Assert.Equal(Roles.Admin, updated!.Role);
        Assert.False(updated.Disabled);
        Assert.NotEqual(seeded.SecurityStamp, updated.SecurityStamp);
        Assert.NotEqual(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(AppUser.Instance, updated.PasswordHash, "NewPassword456!"));

        var auditStore = new SqliteAuditStore(securityDir);
        var page = await auditStore.QueryAsync(null, null, null, AdminRecoveryVerbs.AuditAction, null, 200, 0, CancellationToken.None);
        var row = Assert.Single(page.Items);
        Assert.Contains("\"created\":false", row.NewValueJson, StringComparison.Ordinal);
        Assert.Contains("\"promoted\":true", row.NewValueJson, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Existing DISABLED non-Admin user -> promoted, re-enabled, and password reset — a lock-out recovery
    // that left the account disabled would still leave the operator unable to log in, defeating the whole
    // point of the verb.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryHandle_ExistingDisabledNonAdminUser_IsReEnabled_Promoted_AndPasswordReset()
    {
        var securityDir = NewTempDir();
        var hasher = new PasswordHasher<AppUser>();
        var seedStore = new SqliteUserStore(securityDir);
        var seeded = await seedStore.CreateAsync(
            "disabled-account", hasher.HashPassword(AppUser.Instance, "OldPassword123!"), Roles.Operator, null, createdBy: "test");
        await seedStore.SetDisabledAsync(seeded.Id, true);

        var exitCode = await RunVerbAsync(securityDir, "--reset-admin-password", "disabled-account", "--password", "NewPassword456!");

        Assert.Equal(0, exitCode);

        var updated = await seedStore.GetByUsernameAsync("disabled-account");
        Assert.NotNull(updated);
        Assert.Equal(Roles.Admin, updated!.Role);
        Assert.False(updated.Disabled);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Generated-password path — strong, printed exactly once, and (proven via a real store lookup) actually
    // the password that got hashed in. Coverage note (fix-round precision, per review): this proves the
    // generated password round-trips through PasswordHasher.VerifyHashedPassword against the persisted
    // hash — it does NOT exercise a real HTTP login with it (that's covered, for an EXPLICIT --password,
    // by the WebApplicationFactory<Program> test further down). Accepted as-is per review.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryHandle_NoPasswordFlag_GeneratesAStrongPassword_PrintedOnce_AndUsable()
    {
        var securityDir = NewTempDir();

        var (exitCode, stdout, _) = await RunVerbCapturingConsoleAsync(securityDir, "--reset-admin-password", "generated-pw-user");
        Assert.Equal(0, exitCode);

        var lines = stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var generatedPassword = lines[^1];

        // Fix-round I3 — deterministic properties ONLY: exact length, and every character drawn from the
        // documented alphabet. The generator draws each character independently/uniformly with no
        // class-composition guarantee (upper/lower/digit/punctuation each individually has a small but
        // real chance of being entirely absent from any one 24-character draw — e.g. P(no digit) ≈ 3.1%),
        // and the product has no class-composition password policy to justify asserting one — a previous
        // version of this test asserted class presence and was consequently flaky (~4.5% failure rate per
        // run). Length + alphabet membership is what's actually guaranteed by construction.
        Assert.Equal(24, generatedPassword.Length);
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+";
        Assert.All(generatedPassword, c => Assert.Contains(c, alphabet));

        var userStore = new SqliteUserStore(securityDir);
        var user = await userStore.GetByUsernameAsync("generated-pw-user");
        Assert.NotNull(user);

        var hasher = new PasswordHasher<AppUser>();
        Assert.NotEqual(
            PasswordVerificationResult.Failed,
            hasher.VerifyHashedPassword(AppUser.Instance, user!.PasswordHash, generatedPassword));
    }

    [Fact]
    public async Task TryHandle_NoPasswordFlag_TwoIndependentInvocations_GenerateDifferentPasswords()
    {
        // Indirect proof of "cryptographically secure RNG, not a constant/predictable one": two independent
        // invocations (two different unknown usernames, so each takes the create-new-Admin branch) must
        // print two DIFFERENT generated passwords.
        var securityDir = NewTempDir();

        var (exitCode1, stdout1, _) = await RunVerbCapturingConsoleAsync(securityDir, "--reset-admin-password", "generated-pw-user-a");
        var (exitCode2, stdout2, _) = await RunVerbCapturingConsoleAsync(securityDir, "--reset-admin-password", "generated-pw-user-b");
        Assert.Equal(0, exitCode1);
        Assert.Equal(0, exitCode2);

        var password1 = stdout1.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)[^1];
        var password2 = stdout2.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)[^1];

        Assert.NotEqual(password1, password2);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Never builds a web host — fix-round M5: the observable consequence is now checked deterministically
    // (Program.cs unconditionally creates securityDir\keys\ for the DataProtection key ring the moment the
    // real host builds — see Program.cs:112-113) rather than by binding the fixed default port 5199, which
    // would spuriously fail on a developer machine that happens to have the real app already running.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryHandle_DoesNotBuildAWebHost_NeverCreatesTheDataProtectionKeysDirectory()
    {
        var securityDir = NewTempDir();

        var exitCode = await RunVerbAsync(securityDir, "--reset-admin-password", "someone", "--password", "Str0ngP@ssw0rd!1");
        Assert.Equal(0, exitCode);

        // Program.cs (only reachable once WebApplication.CreateBuilder + the composition root below it
        // run) unconditionally creates this exact subdirectory for the DataProtection key ring. Its
        // continued absence after a successful verb run is a direct, deterministic proof that no such host
        // was ever built — unlike a port-binding probe, this can't spuriously fail because of an unrelated
        // process already running on the developer's machine.
        Assert.False(Directory.Exists(Path.Combine(securityDir, "keys")));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix-round M1 (fix-round 2 review correction) — the audit-append retry. AppendAuditRowAsync is
    // `internal` specifically as a test seam (see its own doc comment) so this test can simulate N SEPARATE
    // processes/hosts racing the SAME security.db file directly: each task below constructs its OWN
    // SqliteAuditStore instance (an in-process append lock only ever serializes calls made through the SAME
    // instance — see SqliteAuditStore's own doc comment).
    //
    // Task.Run below is LOAD-BEARING, not stylistic. A fix-round-1 version of this test assigned
    // `tasks[idx] = AdminRecoveryVerbs.AppendAuditRowAsync(...)` directly (no Task.Run) — review (standalone
    // probes against this exact Microsoft.Data.Sqlite 10.0.10 package) established that this looked
    // concurrent but was NOT: those async APIs (OpenAsync/ExecuteReaderAsync/ReadAsync/
    // ExecuteNonQueryAsync/...) complete synchronously inline whenever no real OS-level wait is needed,
    // which is always true for a small local WAL-mode SQLite file — so every `await` inside
    // AppendAuditRowAsync resolved without ever yielding, meaning each bare async-method call ran to FULL
    // completion, one at a time, on the calling thread, before Task.WhenAll below was even reached. No race
    // was ever created and the retry path was never exercised. Wrapping each call in Task.Run forces it onto
    // its own thread-pool thread instead, so the 8 appends genuinely interleave at the OS level — personally
    // verified for THIS version of the test: with the retry temporarily forced off
    // (MaxAuditAppendAttempts = 1, local-only, never committed) this test FAILED 5/5 runs (only ~2 of 8 rows
    // persisted each time); restored to 8, it PASSED 8/8 runs. See task-5-report.md's "Fix round 2" section
    // for the exact observation.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendAuditRowAsync_ConcurrentInvocationsAcrossSeparateStoreInstances_AllPersist_ChainStaysValid()
    {
        var securityDir = NewTempDir();
        const int n = 8;

        var tasks = new Task[n];
        for (var i = 0; i < n; i++)
        {
            var idx = i;
            // Task.Run — see this test's own comment above for why a bare (non-Task.Run) async call here
            // would silently NOT exercise the race this test exists to cover.
            tasks[idx] = Task.Run(() => AdminRecoveryVerbs.AppendAuditRowAsync(
                new SqliteAuditStore(securityDir), // a SEPARATE instance per "process" — see this test's own comment.
                username: $"concurrent-user-{idx}",
                userId: idx,
                created: true,
                promoted: true,
                reEnabled: false,
                previousRole: "(none — new account)"));
        }

        await Task.WhenAll(tasks);

        var auditStore = new SqliteAuditStore(securityDir);
        var chain = await auditStore.VerifyChainAsync(CancellationToken.None);
        Assert.True(chain.Ok, chain.Detail);

        var page = await auditStore.QueryAsync(null, null, null, AdminRecoveryVerbs.AuditAction, null, 200, 0, CancellationToken.None);
        Assert.Equal(n, page.Total);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Real pipeline (WebApplicationFactory<Program>) — login through the WAF with the NEW password
    // succeeds, the OLD password fails, and a session cookie obtained BEFORE the reset is invalidated by
    // the very next authenticated request after it (bumpStamp's actual, observable effect).
    // ─────────────────────────────────────────────────────────────────────

    private static async Task<(WebApplicationFactory<Program> Factory, string SecurityDir)> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-settings-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-sitelink-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-alarms-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-adminrecovery-waf-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", null);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the env vars above are still set.
            return (factory, securityDir);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", prevDemoEnabled);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", prevHistorianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", prevWalDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", prevSettingsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    [Fact]
    public async Task ResetAdminPassword_ThroughRealPipeline_NewPasswordLogsIn_OldPasswordFails_AndInvalidatesThePreExistingSessionCookie()
    {
        var created = await CreateFactoryAsync();
        await using var factory = created.Factory;
        var securityDir = created.SecurityDir;

        // Bootstrap the ONLY Admin account this deployment has — the exact scenario the brief's threat
        // model describes ("lose every Admin account and the product is unrecoverable").
        var bootstrapClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "sole-admin", password = "InitialPassword123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        // Bootstrap already SignInAsync'd this client — confirm the pre-existing session actually works
        // BEFORE the reset, so the later 401 genuinely demonstrates invalidation (not just "was never
        // logged in to begin with").
        using (var meBefore = await bootstrapClient.GetAsync("/v1/auth/me"))
        {
            Assert.Equal(HttpStatusCode.OK, meBefore.StatusCode);
        }

        // Out-of-band recovery: run the console verb against the SAME security.db this running factory's
        // IUserStore/IAuditStore already point at (same file, both accessed via short-lived SQLite
        // connections under WAL mode — see AdminRecoveryVerbs' own doc comment).
        var exitCode = await RunVerbAsync(securityDir, "--reset-admin-password", "sole-admin", "--password", "RecoveredPassword456!");
        Assert.Equal(0, exitCode);

        // bumpStamp's actual, observable effect: the cookie obtained BEFORE the reset is now rejected.
        using (var meAfter = await bootstrapClient.GetAsync("/v1/auth/me"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, meAfter.StatusCode);
        }

        // The OLD password no longer works...
        using (var freshClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true }))
        using (var badLogin = await freshClient.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "sole-admin", password = "InitialPassword123!" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, badLogin.StatusCode);
        }

        // ...but the NEW one does, and the account is still (indeed, was already) Admin.
        using var recoveredClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using (var goodLogin = await recoveredClient.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "sole-admin", password = "RecoveredPassword456!" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, goodLogin.StatusCode);
        }

        using (var me = await recoveredClient.GetAsync("/v1/auth/me"))
        {
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            var body = await me.Content.ReadFromJsonAsync<AuthUserDto>(JsonOptions);
            Assert.Equal("sole-admin", body!.Username);
            Assert.Equal(Roles.Admin, body.Role);
        }

        // The recovery is visible through the REAL /v1/audit endpoint too (same file, same host) — not
        // just via a second raw SqliteAuditStore handle.
        using var auditResp = await recoveredClient.GetAsync(
            $"/v1/audit?action={Uri.EscapeDataString(AdminRecoveryVerbs.AuditAction)}&limit=200");
        Assert.Equal(HttpStatusCode.OK, auditResp.StatusCode);
        var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
        var row = Assert.Single(page!.Items);
        Assert.Equal(AdminRecoveryVerbs.AuditActorUsername, row.ActorUsername);
    }
}
