using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using St4i.EdgeCore.Identity;
using Xunit;

namespace St4i.EdgeCore.Tests.Identity;

/// <summary>
/// GĐ3 EC-1 — <see cref="DeviceIdentityStore"/>: <c>LoadOrCreate</c> is idempotent (a second store
/// instance pointed at the same directory sees the SAME persisted cert, not a freshly regenerated one),
/// the exported PEM round-trips through an independent parse, <see cref="DeviceIdentityStore.TryLoad"/>
/// never mints an identity as a side effect, a corrupted stored blob is tolerated (regenerate rather than
/// throw — same "never crash the caller over a bad file" stance as
/// <see cref="St4i.EdgeCore.Infrastructure.CredentialStore"/> and
/// <see cref="St4i.EdgeCore.Config.FleetSettingsStore"/>), and <c>nodeId</c> only matters on the very
/// first (create) call — a later <c>LoadOrCreate</c> with a different nodeId still returns the originally
/// persisted identity.
/// </summary>
public sealed class DeviceIdentityStoreTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-device-identity-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void LoadOrCreate_FirstCall_GeneratesAPersistedIdentityWithAPrivateKeyAndTheGivenNodeId()
    {
        var store = new DeviceIdentityStore(NewTempDir());

        var identity = store.LoadOrCreate("NODE-1");

        Assert.True(identity.Certificate.HasPrivateKey);
        Assert.Contains("NODE-1", identity.Certificate.Subject);
        Assert.Equal("NODE-1", identity.NodeId);
        Assert.NotEmpty(identity.Fingerprint);
    }

    [Fact]
    public void LoadOrCreate_SecondCallFromANewStoreInstance_ReturnsTheSamePersistedCertificate()
    {
        var dir = NewTempDir();
        var first = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1");

        var second = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1"); // simulates a process restart

        Assert.Equal(first.Fingerprint, second.Fingerprint);
        Assert.True(second.Certificate.HasPrivateKey);
    }

    [Fact]
    public void CertificatePem_StartsWithThePemHeader_AndReparsesToTheSameFingerprint()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-1");

        Assert.StartsWith("-----BEGIN CERTIFICATE-----", identity.CertificatePem);

        using var reparsed = X509Certificate2.CreateFromPem(identity.CertificatePem);
        Assert.Equal(identity.Fingerprint, reparsed.GetCertHashString(HashAlgorithmName.SHA256));
    }

    [Fact]
    public void TryLoad_BeforeAnyCreate_ReturnsNull()
    {
        var store = new DeviceIdentityStore(NewTempDir());

        Assert.Null(store.TryLoad());
    }

    [Fact]
    public void TryLoad_AfterLoadOrCreate_ReturnsTheSamePersistedIdentity_WithoutMintingANewOne()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var created = store.LoadOrCreate("NODE-1");

        var loaded = store.TryLoad();

        Assert.NotNull(loaded);
        Assert.Equal(created.Fingerprint, loaded!.Fingerprint);
    }

    [Fact]
    public void LoadOrCreate_CorruptStoredBlob_RegeneratesAFreshIdentityInsteadOfThrowing()
    {
        var dir = NewTempDir();
        var original = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1");

        File.WriteAllBytes(Path.Combine(dir, "device-identity.bin"), new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });

        var regenerated = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1");

        Assert.True(regenerated.Certificate.HasPrivateKey);
        Assert.NotEmpty(regenerated.Fingerprint);
        Assert.NotEqual(original.Fingerprint, regenerated.Fingerprint);
    }

    [Fact]
    public void LoadOrCreate_NodeIdIsUsedOnlyAtCreate_ALaterCallWithADifferentNodeIdReturnsThePersistedIdentity()
    {
        var dir = NewTempDir();
        var createdAsNodeA = new DeviceIdentityStore(dir).LoadOrCreate("NODE-A");

        var loadedAsNodeB = new DeviceIdentityStore(dir).LoadOrCreate("NODE-B");

        Assert.Equal(createdAsNodeA.Fingerprint, loadedAsNodeB.Fingerprint);
        Assert.Equal("NODE-A", loadedAsNodeB.NodeId);
    }

    [Fact]
    public void Fingerprint_MatchesTheCertificatesOwnSha256HashString()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-1");

        Assert.Equal(identity.Certificate.GetCertHashString(HashAlgorithmName.SHA256), identity.Fingerprint);
        Assert.Matches("^[0-9A-F]+$", identity.Fingerprint);
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var previous = Environment.GetEnvironmentVariable(DeviceIdentityStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, Path.Combine(Path.GetTempPath(), "st4i-identity-env-should-not-win"));
            var explicitDir = Path.Combine(Path.GetTempPath(), "st4i-identity-explicit-" + Guid.NewGuid().ToString("N"));

            Assert.Equal(explicitDir, DeviceIdentityStore.ResolveRoot(explicitDir));
        }
        finally
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable(DeviceIdentityStore.EnvVarDir);
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-identity-env-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, tempDir);

            Assert.Equal(tempDir, DeviceIdentityStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void DefaultRoot_IsSiblingOfCredsDefaultDir_NotTheSameDirectory()
    {
        var credsDefaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "creds");

        var identityDefaultRoot = DeviceIdentityStore.DefaultRoot();

        Assert.NotEqual(credsDefaultRoot, identityDefaultRoot);
        Assert.Equal(Path.GetDirectoryName(credsDefaultRoot), Path.GetDirectoryName(identityDefaultRoot));
    }

    // EC-1 review C-1/I-1 — the regression test that would have caught the EphemeralKeySet bug: a
    // real SslStream mutual-TLS loopback handshake using the EXACT certificate DeviceIdentityStore hands
    // out. Under EphemeralKeySet this fails on Windows/schannel with an AuthenticationException
    // (SEC_E_UNKNOWN_CREDENTIALS) even though Certificate.HasPrivateKey reports true — HasPrivateKey alone
    // is NOT proof the key is usable for a TLS handshake. Uses the store's own generated cert as BOTH the
    // server and client certificate (self-signed; a permissive RemoteCertificateValidationCallback accepts
    // it on both sides) — this test is about key USABILITY for schannel, not chain-of-trust validation.
    /// <summary>
    /// 🔴 <b>The timeout here CANCELS both sides; it does not abandon them, and that distinction is the whole
    /// fix.</b> (C-7 review round 2. This test was the direct generator of the orphaned-<c>testhost</c> trap
    /// <c>scripts/verify-suites.sh</c> exists to catch.)
    ///
    /// <para><b>What it used to do.</b> The server ended with <c>await ssl.ReadAsync(buffer)</c> — no token,
    /// no timeout — and the body waited with <c>Task.WhenAny(both, Task.Delay(15s))</c>, which on the timeout
    /// branch <b>never awaited <c>both</c> and never cancelled anything</b>. <c>listener.Stop()</c> stops
    /// ACCEPTING; it does not close a connection that was already accepted. So a timeout failed the test AND
    /// left a thread-pool task parked forever on an I/O completion that would never arrive, holding a
    /// <see cref="TcpClient"/>, an <see cref="SslStream"/> and a certificate.</para>
    ///
    /// <para>🔴 <b>The failure variant and the HANG variant were the same event.</b> The leak happens only on
    /// the timeout path, so whether the runner showed a red test or a wedged host depended purely on whether
    /// it happened to exit around the orphan. A wedged host is worse than a red test in a way that is easy to
    /// miss: it is "stopped but not idle" — the parked process still emits a background heartbeat of a few
    /// milliseconds of CPU per minute, which is enough to defeat a "flat CPU means hung" detector, so the
    /// run does not fail, it simply never ends.</para>
    ///
    /// <para><b>Widening the deadline would have made the flake rarer and left the mechanism completely
    /// intact</b> — which is why the deadline is now GENEROUS (60 s) rather than tight. It is not measuring
    /// anything: the assertion is "a real handshake completes", not "it completes quickly". Every await on
    /// both sides takes the token, so a timeout unwinds both tasks through their own <c>using</c> blocks
    /// instead of stranding them, and <c>await both</c> is unconditional.</para>
    /// </summary>
    [Fact]
    public async Task Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-MTLS");

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        // 🔴 ONE deadline for the whole exchange, threaded into every await on both sides. Generous, because
        // it bounds a hang rather than measuring a handshake.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var ct = cts.Token;

        Exception? serverError = null;
        Exception? clientError = null;
        var serverSawClientCert = false;

        var serverTask = Task.Run(async () =>
        {
            try
            {
                using var connection = await listener.AcceptTcpClientAsync(ct);
                using var ssl = new SslStream(connection.GetStream(), leaveInnerStreamOpen: false);
                var options = new SslServerAuthenticationOptions
                {
                    ServerCertificate = identity.Certificate,
                    ClientCertificateRequired = true,
                    EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
                    RemoteCertificateValidationCallback = (_, _, _, _) => true,
                };
                await ssl.AuthenticateAsServerAsync(options, ct);
                serverSawClientCert = ssl.RemoteCertificate is not null;

                // 🔴 The read that used to park forever. With the token it unwinds, and the `using` blocks
                // above then actually close the socket and the stream.
                var buffer = new byte[1];
                _ = await ssl.ReadAsync(buffer, ct);
            }
            catch (Exception ex)
            {
                serverError = ex;
            }
        });

        var clientTask = Task.Run(async () =>
        {
            try
            {
                using var tcp = new TcpClient();
                await tcp.ConnectAsync(IPAddress.Loopback, port, ct);
                using var ssl = new SslStream(tcp.GetStream(), leaveInnerStreamOpen: false);
                var options = new SslClientAuthenticationOptions
                {
                    TargetHost = "localhost",
                    ClientCertificates = new X509CertificateCollection { identity.Certificate },
                    EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
                    RemoteCertificateValidationCallback = (_, _, _, _) => true,
                };
                await ssl.AuthenticateAsClientAsync(options, ct);
                await ssl.WriteAsync(new byte[] { 42 }, ct);
            }
            catch (Exception ex)
            {
                clientError = ex;
            }
        });

        try
        {
            // 🔴 UNCONDITIONAL, and it cannot hang: the token completes both tasks, and both swallow their
            // own exceptions into the fields asserted below. This is what replaces WhenAny-and-walk-away.
            await Task.WhenAll(serverTask, clientTask);
        }
        finally
        {
            listener.Dispose();
        }

        // Reported before the exception assertions, because "it timed out" is a different diagnosis from
        // "schannel rejected the key" and this is the one that used to strand a process.
        Assert.False(ct.IsCancellationRequested, "mTLS handshake did not complete within 60s");
        Assert.True(clientError is null, $"client-side handshake threw: {clientError}");
        Assert.True(serverError is null, $"server-side handshake threw: {serverError}");
        Assert.True(serverSawClientCert, "server did not receive a client certificate during the handshake");
    }

    // ─────────────────────────────────────────────────────────────────────
    // GĐ3 closeout WI-4 — Rotate: mints+persists a fresh identity, replacing the old one.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Rotate_YieldsADifferentFingerprint_AndTheNewIdentityLoadsBackFromDisk()
    {
        var dir = NewTempDir();
        var store = new DeviceIdentityStore(dir);
        var original = store.LoadOrCreate("NODE-1");

        var rotated = store.Rotate("NODE-1");

        Assert.NotEqual(original.Fingerprint, rotated.Fingerprint);
        Assert.True(rotated.Certificate.HasPrivateKey);

        // The old one is gone — a fresh load off the SAME directory sees only the rotated identity.
        var reloaded = new DeviceIdentityStore(dir).TryLoad();
        Assert.NotNull(reloaded);
        Assert.Equal(rotated.Fingerprint, reloaded!.Fingerprint);
        Assert.NotEqual(original.Fingerprint, reloaded.Fingerprint);
    }

    [Fact]
    public void Rotate_PreservesTheNodeId()
    {
        var dir = NewTempDir();
        var store = new DeviceIdentityStore(dir);
        store.LoadOrCreate("NODE-PRESERVE");

        var rotated = store.Rotate("NODE-PRESERVE");

        Assert.Equal("NODE-PRESERVE", rotated.NodeId);
        Assert.Contains("NODE-PRESERVE", rotated.Certificate.Subject);
    }

    // GĐ3 closeout WI-4 — a rotation is an explicit operator action: unlike LoadOrCreate/Create, a
    // persistence failure must propagate (not degrade to an unpersisted in-memory identity) AND must not
    // leave a half-written identity on disk. Simulated here by holding an exclusive (no-share) read handle
    // on the CURRENT device-identity.bin, so Persist's atomic File.Move(overwrite:true) — which must
    // replace that exact file — fails partway through Rotate, before anything is actually replaced.
    [Fact]
    public void Rotate_FailureMidRotation_PropagatesAndLeavesThePreviousIdentityLoadable()
    {
        var dir = NewTempDir();
        var store = new DeviceIdentityStore(dir);
        var original = store.LoadOrCreate("NODE-1");

        var pfxPath = Path.Combine(dir, "device-identity.bin");
        Exception? thrown;
        using (new FileStream(pfxPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            thrown = Record.Exception(() => store.Rotate("NODE-1"));
        }

        Assert.NotNull(thrown);

        var stillThere = new DeviceIdentityStore(dir).TryLoad();
        Assert.NotNull(stillThere);
        Assert.Equal(original.Fingerprint, stillThere!.Fingerprint);
    }

    // EC-1 review M-1 — nodeId is interpolated into an X.500 "CN=<nodeId>" DN string; raw DN
    // metacharacters (',', '=', '"') or a whitespace-only nodeId must not throw out of Create (breaking
    // LoadOrCreate's never-throw promise) or silently corrupt the subject into extra bogus RDNs.
    [Theory]
    [InlineData("a,b=c\"d ")]
    [InlineData("   ")]
    public void LoadOrCreate_NodeIdWithDnMetacharactersOrWhitespaceOnly_DoesNotThrow_AndYieldsAUsableCert(string weirdNodeId)
    {
        var store = new DeviceIdentityStore(NewTempDir());

        var exception = Record.Exception(() => store.LoadOrCreate(weirdNodeId));

        Assert.Null(exception);
        var identity = store.TryLoad();
        Assert.NotNull(identity);
        Assert.True(identity!.Certificate.HasPrivateKey);
        Assert.NotEmpty(identity.Fingerprint);
    }
}
