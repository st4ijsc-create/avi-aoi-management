using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EdgeCore.Identity;

/// <summary>
/// GĐ3 EC-1 — load-or-creates the machine's durable device identity: a self-signed ECDSA P-256 X.509
/// certificate (with private key) the northbound bridge (EC-2) will present for mTLS when it federates to
/// a SYNAPSE Site. Persisted DPAPI-sealed + ACL-locked under <c>%ProgramData%\ST4I\sim\identity</c> (env
/// override <see cref="EnvVarDir"/>) — the exact same idiom <see cref="CredentialStore"/> already uses for
/// the <c>mk_</c> API key (<see cref="ProtectedData"/> under <see cref="DataProtectionScope.LocalMachine"/>
/// + <see cref="SecurityDirAcl"/>), plus the explicit&gt;env&gt;default directory-resolution idiom
/// <see cref="St4i.EdgeCore.Config.FleetSettingsStore"/> uses for its own leaf directory.
///
/// <para><b>Why LocalMachine-scoped DPAPI, not CurrentUser:</b> same rationale as
/// <see cref="CredentialStore"/> — the device may be onboarded interactively but later run as a Windows
/// Service/LocalSystem account, and <c>CurrentUser</c> scope would make the service unable to decrypt what
/// an interactive session wrote. The confidentiality boundary is therefore the ACL on the identity
/// directory (<see cref="SecurityDirAcl.Apply"/>, applied on every write), not the DPAPI scope.</para>
///
/// <para><b>Persistence layout:</b> two files under the resolved directory —
/// <c>device-identity.bin</c> (the PFX bytes, DPAPI-protected, atomic temp-file-then-move) and
/// <c>device-node.txt</c> (the plaintext <c>nodeId</c> the cert was created with, so a later load can
/// report it without having to parse the certificate's CN). Neither file is secret on its own without the
/// other: the node id is not sensitive, and the PFX bytes are DPAPI-sealed besides.</para>
///
/// <para><b>Corrupt/foreign blob handling:</b> <see cref="TryLoad"/> treats ANY exception while reading
/// (missing file, garbage bytes, a blob DPAPI-protected under different entropy/scope, a malformed PKCS12)
/// as "no stored identity" — logs via the ctor's <c>logError</c> callback and returns <see langword="null"/>
/// — never lets a bad file crash the caller. <see cref="LoadOrCreate"/> then regenerates a brand new
/// identity in that case, exactly like a fresh install. A device must always end up with a usable
/// identity; there is no "half-working" state.</para>
///
/// <para><b>Load flag: <see cref="X509KeyStorageFlags.PersistKeySet"/>, NOT
/// <see cref="X509KeyStorageFlags.EphemeralKeySet"/> (EC-1 review C-1):</b> empirically verified (Win11 +
/// .NET 10, a real <see cref="System.Net.Security.SslStream"/> client-auth handshake, loopback) that a
/// certificate loaded with <c>EphemeralKeySet</c> FAILS mutual-TLS on Windows/schannel —
/// <c>AuthenticateAsClientAsync</c> throws <c>AuthenticationException</c> (<c>SEC_E_UNKNOWN_CREDENTIALS</c>)
/// and the server never receives the client certificate at all — even though <c>HasPrivateKey</c> reports
/// <see langword="true"/> the whole time. <c>PersistKeySet</c> is the verified-working fix (only that flag
/// changed). This is EC-1's entire reason to exist — EC-2's northbound bridge presents this certificate to
/// a Site broker (MQTTnet's <c>WithClientCertificates</c>, which is <c>SslStream</c>/schannel underneath) —
/// so an unusable-for-TLS certificate is a correctness bug, not a style choice.
/// <para><b>Trade-off knowingly reintroduced:</b> <c>PersistKeySet</c> creates a CNG/CAPI key-store entry
/// (under the loading account's own key store) on every load — the exact on-disk residue
/// <c>EphemeralKeySet</c> exists to avoid — but this is unavoidable for client-certificate auth under
/// schannel. Works uniformly for both an interactive host account and a Windows Service/LocalSystem
/// account, each loading into its own account-scoped key store. Deliberately NOT <c>MachineKeySet</c>:
/// that requires administrator privilege to write, which would break the non-admin interactive host
/// scenario — plain <c>PersistKeySet</c> is the least-privileged, verified-working choice. See
/// <c>DeviceIdentityStoreTests.Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake</c> for the
/// regression test that would have caught this (and must keep passing — it fails outright under
/// <c>EphemeralKeySet</c>).</para></para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class DeviceIdentityStore
{
    /// <summary>Relocates the whole store — same "tests get a throwaway root instead of polluting
    /// %ProgramData%" rationale as <see cref="St4i.EdgeCore.Config.FleetSettingsStore.EnvVarDir"/>.</summary>
    public const string EnvVarDir = "ST4I_IDENTITY_DIR";

    private const string PfxFileName = "device-identity.bin";
    private const string NodeIdFileName = "device-node.txt";

    /// <summary>Defense-in-depth only, NOT the confidentiality boundary — the PFX bytes are DPAPI-sealed
    /// (<see cref="DataProtectionScope.LocalMachine"/>) and the containing directory is ACL-locked
    /// (<see cref="SecurityDirAcl"/>) before this password would ever matter. A fixed constant (like
    /// <see cref="CredentialStore"/>'s fixed <c>Entropy</c>) rather than a per-device secret, since the PFX
    /// container format requires SOME password and there is nothing more secret than the DPAPI+ACL layers
    /// already protecting the bytes on disk.</summary>
    private const string PfxPassword = "st4i.edgecore.deviceidentitystore.v1";

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("st4i.edgecore.deviceidentitystore.v1.entropy");

    // A conservative DNS-label-ish charset for the optional SAN — nodeId values that don't match this are
    // still accepted (the SAN is a nice-to-have, not load-bearing for mTLS), they just don't get a SAN
    // entry, rather than risking SubjectAlternativeNameBuilder.AddDnsName throwing on an unusual nodeId.
    private static readonly Regex SafeDnsNamePattern = new("^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$", RegexOptions.Compiled);

    private readonly string _dir;
    private readonly Action<Exception, string> _logError;

    /// <summary>The resolved identity directory (after explicit/env/default resolution).</summary>
    public string RootDirectory => _dir;

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/>.</param>
    /// <param name="logError">Called (never throws past this class) whenever a stored identity can't be
    /// read/decrypted/persisted; defaults to a stderr line, mirroring <see cref="CredentialStore"/>/
    /// <see cref="SecurityDirAcl"/>'s own best-effort logging convention.</param>
    public DeviceIdentityStore(string? directory = null, Action<Exception, string>? logError = null)
    {
        _dir = ResolveRoot(directory);
        Directory.CreateDirectory(_dir);
        _logError = logError ?? ((ex, message) =>
            Console.Error.WriteLine($"[deviceidentity] {message}: {ex.GetType().Name}: {ex.Message}"));

        SecurityDirAcl.Apply(_dir, msg => Console.Error.WriteLine($"[deviceidentity] {msg}"));
    }

    /// <summary>The default identity root: <c>%ProgramData%\ST4I\sim\identity</c> — a SIBLING of
    /// <c>...\sim\creds</c>/<c>...\sim\settings</c>/<c>...\sim\historian</c>, never the same directory as
    /// any of those.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "identity");

    /// <summary>Resolves the effective identity directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk (the ctor does that).</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    /// <summary>Idempotent: returns the persisted identity if one exists, or (first run / after a corrupt
    /// blob was discarded) generates a self-signed ECDSA P-256 cert with <c>CN=&lt;nodeId&gt;</c>, seals +
    /// persists it, and returns it. <paramref name="nodeId"/> is used ONLY when creating — a subsequent
    /// call (any nodeId) returns the already-persisted cert unchanged.</summary>
    public DeviceIdentity LoadOrCreate(string nodeId)
    {
        ArgumentException.ThrowIfNullOrEmpty(nodeId);
        return TryLoad() ?? Create(nodeId);
    }

    /// <summary>Returns the persisted identity, or <see langword="null"/> if none exists yet, or if the
    /// stored blob can't be read/decrypted/parsed for any reason (see this class's own doc comment). Never
    /// creates or persists anything — safe for read endpoints that must not accidentally mint an
    /// identity.</summary>
    public DeviceIdentity? TryLoad()
    {
        var pfxPath = Path.Combine(_dir, PfxFileName);
        if (!File.Exists(pfxPath)) return null;

        try
        {
            var protectedBytes = File.ReadAllBytes(pfxPath);
            var pfxBytes = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.LocalMachine);
            // PersistKeySet, not EphemeralKeySet — see this class's own doc comment (EC-1 review C-1):
            // an ephemeral-keyset cert is unusable for a real SslStream/schannel client-auth handshake.
            var cert = X509CertificateLoader.LoadPkcs12(pfxBytes, PfxPassword, X509KeyStorageFlags.PersistKeySet);
            var nodeId = ReadNodeId() ?? ExtractCommonName(cert) ?? "unknown";
            return ToView(cert, nodeId);
        }
        catch (Exception ex)
        {
            // Missing/corrupt bytes, a blob DPAPI-protected under a different scope/entropy (e.g. copied
            // in from another machine), or a malformed PKCS12 all land here — treated identically as "no
            // usable stored identity" so LoadOrCreate's caller gets a fresh regenerated identity instead
            // of an unhandled crash.
            _logError(ex, "Stored device identity is corrupt or unreadable; it will be regenerated");
            return null;
        }
    }

    /// <summary>GĐ3 closeout WI-4 — mints a brand-new self-signed identity (same algorithm/validity window
    /// as <see cref="Create"/> — ECDSA P-256, SHA-256, 10-year validity, same <c>PersistKeySet</c> load
    /// flag) and persists it atomically, REPLACING whatever identity was there before — an explicit,
    /// operator-triggered re-key (<c>POST /v1/site/identity/rotate</c>), not the "first run" path.
    ///
    /// <para><b>Unlike <see cref="LoadOrCreate"/>, this does NOT swallow a persistence failure into a
    /// degraded in-memory-only fallback</b> — a rotation is a deliberate operator action; silently handing
    /// back an identity that was never actually written to disk (so it vanishes on the next restart) would
    /// be worse than a loud failure the caller (the rotate endpoint) can report. Whatever
    /// <see cref="Persist"/> throws propagates unchanged.</para>
    ///
    /// <para><b>Never leaves a half-written identity on disk</b> — <see cref="Persist"/> already writes
    /// both <c>device-identity.bin</c>/<c>device-node.txt</c> via a temp-file-then-<see
    /// cref="File.Move(string, string, bool)"/> atomic rename (see that method's own doc comment). The
    /// PREVIOUS files are therefore only ever touched by the FINAL, atomic rename — a failure anywhere
    /// before that (minting, DPAPI-protecting, or writing the temp file) never touches the existing
    /// <c>device-identity.bin</c>/<c>device-node.txt</c> at all, so <see cref="TryLoad"/> keeps returning
    /// the pre-rotation identity exactly as it did before this call was ever made.</para></summary>
    public DeviceIdentity Rotate(string nodeId)
    {
        ArgumentException.ThrowIfNullOrEmpty(nodeId);

        var pfxBytes = MintPfxBytes(nodeId);

        // NOT wrapped in a try/catch (unlike Create) — see this method's own doc comment: a rotation
        // failure must propagate to the caller, not degrade to an unpersisted in-memory identity.
        Persist(pfxBytes, nodeId);

        return TryLoad() ?? throw new InvalidOperationException(
            "DeviceIdentityStore.Rotate: the newly persisted identity was written but could not be reloaded from disk.");
    }

    /// <summary>Shared by <see cref="Create"/> and <see cref="Rotate"/> — the ECDSA P-256/SHA-256 mint
    /// step, factored out so both paths use the EXACT same algorithm/validity window/<c>PersistKeySet</c>
    /// posture (see this class's own doc comment for why <c>PersistKeySet</c> is non-negotiable).</summary>
    private static byte[] MintPfxBytes(string nodeId)
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = BuildRequest(nodeId, ecdsa);
        using var cert = request.CreateSelfSigned(
            DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
        return cert.Export(X509ContentType.Pfx, PfxPassword);
    }

    private DeviceIdentity Create(string nodeId)
    {
        var pfxBytes = MintPfxBytes(nodeId);

        try
        {
            Persist(pfxBytes, nodeId);
            var reloaded = TryLoad();
            if (reloaded is not null) return reloaded;
        }
        catch (Exception ex)
        {
            _logError(ex, "Could not persist the newly generated device identity; continuing with an " +
                          "in-memory-only identity for this process");
        }

        // Persistence failed, or (shouldn't happen, but defensively) the immediate reload of what was
        // just written came back empty — hand back a usable, unpersisted identity for THIS process
        // rather than throwing the caller (the bridge) into a crash. An unwritable identity directory is
        // an operational problem to fix on disk, not a reason the device can't come up at all. Re-import
        // (rather than reusing the disposed `cert` above) so the returned certificate's private-key
        // handle has its own independent lifetime. PersistKeySet here too (EC-1 review C-1) — same
        // schannel-usability requirement as TryLoad's own load call.
        var fallback = X509CertificateLoader.LoadPkcs12(pfxBytes, PfxPassword, X509KeyStorageFlags.PersistKeySet);
        return ToView(fallback, nodeId);
    }

    private void Persist(byte[] pfxBytes, string nodeId)
    {
        var protectedBytes = ProtectedData.Protect(pfxBytes, Entropy, DataProtectionScope.LocalMachine);
        WriteAllBytesAtomic(Path.Combine(_dir, PfxFileName), protectedBytes);
        WriteAllTextAtomic(Path.Combine(_dir, NodeIdFileName), nodeId);

        // Self-heal the ACL after every write, same rationale as CredentialStore.Save — an install
        // upgraded from a build that predates this hardening gets locked down on the very next write, not
        // just a fresh one.
        SecurityDirAcl.Apply(_dir, msg => Console.Error.WriteLine($"[deviceidentity] {msg}"));
    }

    private static CertificateRequest BuildRequest(string nodeId, ECDsa ecdsa)
    {
        // EC-1 review M-1: nodeId is caller-supplied (the machine's own config) and gets interpolated
        // into an X.500 DN string ("CN=<nodeId>"), which CertificateRequest's string-subject constructor
        // parses as RFC 2253-ish name syntax. DN metacharacters (',', '=', '"', a trailing '\') in a raw
        // nodeId would either produce a WRONG subject (extra bogus RDNs) or throw out of the parser,
        // either of which breaks LoadOrCreate's never-throw promise. Sanitize to a safe CN value instead
        // of interpolating nodeId directly.
        var commonName = SanitizeForCommonName(nodeId);
        var request = new CertificateRequest($"CN={commonName}", ecdsa, HashAlgorithmName.SHA256);

        // Not a CA (can't sign other certs); DigitalSignature is exactly what a TLS client-auth
        // certificate needs (RFC 5280 keyUsage for the TLS handshake's signature).
        request.CertificateExtensions.Add(
            new X509BasicConstraintsExtension(certificateAuthority: false, hasPathLengthConstraint: false, pathLengthConstraint: 0, critical: true));
        request.CertificateExtensions.Add(
            new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, critical: true));

        if (SafeDnsNamePattern.IsMatch(nodeId))
        {
            var sanBuilder = new SubjectAlternativeNameBuilder();
            sanBuilder.AddDnsName(nodeId);
            request.CertificateExtensions.Add(sanBuilder.Build());
        }

        return request;
    }

    /// <summary>EC-1 review M-1 — reduces an arbitrary <c>nodeId</c> to a value safe to interpolate into
    /// an X.500 <c>CN=</c> DN string: trims surrounding whitespace, keeps
    /// <c>[A-Za-z0-9._-]</c>, replaces every other character (DN metacharacters like <c>,</c> <c>=</c>
    /// <c>"</c>, a trailing <c>\</c>, embedded whitespace, ...) with <c>_</c>, and falls back to a fixed
    /// constant if that leaves nothing at all (e.g. a whitespace-only <c>nodeId</c>) — so
    /// <see cref="Create"/> can never throw out of the DN parser, upholding <see cref="LoadOrCreate"/>'s
    /// never-throw contract regardless of what a caller passes as <c>nodeId</c>.</summary>
    private static string SanitizeForCommonName(string nodeId)
    {
        var trimmed = nodeId.Trim();
        if (trimmed.Length == 0) return "st4i-device";

        var sb = new StringBuilder(trimmed.Length);
        foreach (var c in trimmed)
        {
            sb.Append(char.IsLetterOrDigit(c) || c is '.' or '_' or '-' ? c : '_');
        }

        return sb.Length == 0 ? "st4i-device" : sb.ToString();
    }

    private static DeviceIdentity ToView(X509Certificate2 cert, string nodeId) =>
        new(cert, cert.ExportCertificatePem(), cert.GetCertHashString(HashAlgorithmName.SHA256), nodeId);

    private string? ReadNodeId()
    {
        var path = Path.Combine(_dir, NodeIdFileName);
        if (!File.Exists(path)) return null;

        try
        {
            var text = File.ReadAllText(path).Trim();
            return string.IsNullOrEmpty(text) ? null : text;
        }
        catch (IOException)
        {
            return null;
        }
    }

    private static string? ExtractCommonName(X509Certificate2 cert)
    {
        var commonName = cert.GetNameInfo(X509NameType.SimpleName, forIssuer: false);
        return string.IsNullOrEmpty(commonName) ? null : commonName;
    }

    /// <summary>Same crash-safety rationale as <see cref="St4i.EdgeCore.Config.FleetSettingsStore"/>'s own
    /// copy of this pattern (there, for text) — write to a temp file in the same directory then atomically
    /// rename over the real target, so a crash mid-write leaves the old content intact rather than a
    /// truncated/partial PFX blob.</summary>
    private static void WriteAllBytesAtomic(string path, byte[] bytes)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllBytes(tempPath, bytes);
        File.Move(tempPath, path, overwrite: true);
    }

    private static void WriteAllTextAtomic(string path, string content)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }
}
