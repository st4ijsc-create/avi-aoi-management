using System.Runtime.Versioning;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — where the licence file lives, and the only thing that reads or writes it.
///
/// <para><c>%ProgramData%\ST4I\sim\license\license.json</c>, relocatable by <see cref="EnvVarDir"/>,
/// resolved explicit &gt; env &gt; default. Not a new idea — the twenty-first instance of an idiom every
/// other store in this tree already enforces, and a store that LACKS the seam is called out in-tree as a
/// defect (<c>CredentialStore</c>'s own doc comment records ~3,000 DPAPI blobs written into this
/// machine's real credential directory by test suites, because it was the one store without a redirect).</para>
///
/// <para>🔴 <b>The licence file is NOT secret and is deliberately not DPAPI-sealed.</b> It is signed, and
/// its confidentiality is worth nothing: it contains a customer name, an edition and four hashes, all of
/// which the customer already knows. Sealing it would make it unreadable to the support engineer who has
/// to read it over the phone during an incident, and unusable as a paste-in activation artifact, while
/// protecting nothing — the signature, not secrecy, is what stops it being forged.
/// <see cref="SecurityDirAcl"/> is still applied to the directory, as defence in depth against casual
/// tampering that would then show up as <see cref="LicenseState.Invalid"/> rather than silently.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LicenseStore
{
    /// <summary>Relocates the whole store — same rationale as
    /// <see cref="St4i.EdgeCore.Identity.DeviceIdentityStore.EnvVarDir"/>, and required by
    /// <c>PerHostDataRootsTests.EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName</c>, which
    /// derives the expected NAME from the directory rather than merely counting variables.</summary>
    public const string EnvVarDir = "ST4I_LICENSE_DIR";

    private const string FileName = "license.json";

    private readonly string _dir;

    /// <summary>The resolved licence directory.</summary>
    public string RootDirectory => _dir;

    /// <summary>The full path to the licence file, whether or not it exists — quoted in diagnostics so a
    /// support engineer can say where to put the file.</summary>
    public string LicensePath => Path.Combine(_dir, FileName);

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/>.</param>
    public LicenseStore(string? directory = null)
    {
        _dir = ResolveRoot(directory);
        Directory.CreateDirectory(_dir);
        SecurityDirAcl.Apply(_dir, msg => Console.Error.WriteLine($"[license] {msg}"));
    }

    /// <summary>The default licence root: <c>%ProgramData%\ST4I\sim\license</c>.</summary>
    /// <returns>The default directory path.</returns>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "license");

    /// <summary>Resolves the effective licence directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic.</summary>
    /// <param name="directory">Explicit override, or <see langword="null"/>.</param>
    /// <returns>The resolved directory.</returns>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    /// <summary>
    /// 🔴 Reads the licence file, distinguishing <b>THREE</b> outcomes, not two.
    ///
    /// <para><b>Why three.</b> A read that answers the same value for "there is nothing here" and "there
    /// is something here I could not read" leaves its caller unable to branch, so the host comes up and
    /// says nothing — the exact failure mode that destroyed <c>fleet-settings.json</c> and
    /// <c>site-link.json</c> before task Q-1 and <c>oee-settings.json</c> before V-1, and which
    /// <c>OperatorDataRemovalCensusTests.NoStoreAnswersAbsentForAnArtifactThatIsPresent</c> now polices
    /// as a law. This store obeys the law rather than taking an exception to it, and the distinction is
    /// worth having on its own merits: an ENGINEER seeing "no licence installed" goes and installs one,
    /// while an engineer seeing "the licence file is present but unreadable" goes and looks at the disk.
    /// Collapsing those two sends half of them to the wrong place.</para>
    ///
    /// <para>🔴 Never throws, in any of the three cases. This runs on the engine startup path, and a
    /// licence problem must never stop a machine — both non-content outcomes still leave the appliance
    /// running on Core features.</para>
    /// </summary>
    /// <param name="content">The file contents when the outcome is <see cref="LicenseFileRead.Present"/>,
    /// else <see langword="null"/>.</param>
    /// <returns>Which of the three outcomes occurred.</returns>
    public LicenseFileRead Read(out string? content)
    {
        content = null;

        try
        {
            if (!File.Exists(LicensePath)) return LicenseFileRead.Absent;
        }
        catch (Exception ex) when (IsExpectedIoFailure(ex))
        {
            // Even the EXISTENCE check can fail (an ACL on the directory, a disconnected mount). That is
            // "present and unreadable" as far as a caller can tell — never "absent", which would let an
            // unreadable licence read as an unlicensed machine.
            return LicenseFileRead.Unreadable;
        }

        try
        {
            content = File.ReadAllText(LicensePath);
            return LicenseFileRead.Present;
        }
        catch (Exception ex) when (IsExpectedIoFailure(ex))
        {
            return LicenseFileRead.Unreadable;
        }
    }

    /// <summary>
    /// Convenience over <see cref="Read(out string?)"/> for callers that genuinely do not need the
    /// distinction. 🔴 Returns the CONTENT for <see cref="LicenseFileRead.Present"/> and
    /// <see langword="null"/> for both other outcomes — so a caller that needs to tell an absent licence
    /// from an unreadable one must use <see cref="Read(out string?)"/>, and
    /// <see cref="LicenseEvaluator"/> does.
    /// </summary>
    /// <returns>The file contents, or <see langword="null"/>.</returns>
    public string? TryRead() => Read(out var content) == LicenseFileRead.Present ? content : null;

    /// <summary>The I/O failures a licence read may absorb. Deliberately not a bare <c>catch</c>: an
    /// <see cref="OutOfMemoryException"/> is not a licence problem.</summary>
    /// <param name="ex">The caught exception.</param>
    /// <returns><see langword="true"/> when this is an expected read failure.</returns>
    private static bool IsExpectedIoFailure(Exception ex) =>
        ex is IOException or UnauthorizedAccessException or System.Security.SecurityException
            or NotSupportedException or ArgumentException;

    /// <summary>
    /// Writes a licence atomically — temp-file-then-rename, <c>DeviceIdentityStore</c>'s idiom — so a
    /// crash mid-write leaves the PREVIOUS licence intact rather than a truncated file. 🔴 The caller must
    /// have VERIFIED the licence first: <c>POST /v1/license/activate</c> does, so a bad paste can never
    /// displace a good licence.
    /// </summary>
    /// <param name="envelopeJson">The verified licence envelope.</param>
    public void Save(string envelopeJson)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(envelopeJson);
        Directory.CreateDirectory(_dir);

        var tempPath = LicensePath + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, envelopeJson);
        File.Move(tempPath, LicensePath, overwrite: true);

        SecurityDirAcl.Apply(_dir, msg => Console.Error.WriteLine($"[license] {msg}"));
    }
}
