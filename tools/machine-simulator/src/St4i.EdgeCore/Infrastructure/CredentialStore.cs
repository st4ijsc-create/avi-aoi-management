using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Linq;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// Persists a machine's <c>mk_</c> API key on disk, DPAPI-encrypted to the local MACHINE
/// (<see cref="DataProtectionScope.LocalMachine"/> — FF-2) so the plaintext key never touches disk
/// and so it can be decrypted back by any principal on this same machine, not just whichever
/// Windows user originally ran <see cref="Save"/>. This matters because a machine is often
/// onboarded interactively (as a logged-in operator) but later run as a different account (e.g. a
/// Windows Service/LocalSystem) — <see cref="DataProtectionScope.CurrentUser"/> would make that
/// re-decrypt fail. The confidentiality boundary this relies on instead is filesystem ACLs on the
/// containing directory tree — same rationale as WS-D's DataProtection key-ring
/// <c>protectToLocalMachine: true</c>. A <c>LocalMachine</c>-scoped blob is decryptable by ANY local
/// account, so — unlike under the old <c>CurrentUser</c> scope, where a "wrong Windows account" was
/// itself a (accidental) backstop — the ACL on the creds directory is now the ENTIRE confidentiality
/// boundary. <see cref="Save"/> therefore applies <see cref="SecurityDirAcl.Apply"/> to the creds
/// directory every time it (re-)creates/ensures it exists (FF-2 review fix), so this class enforces its
/// own boundary rather than depending on a caller to have hardened it separately.
///
/// One file per machine under the resolved creds directory — explicit argument, else
/// <see cref="EnvVarDir"/> (<c>ST4I_CREDS_DIR</c>), else <see cref="DefaultRoot"/>
/// (<c>%ProgramData%\ST4I\sim\creds</c>) — so the WPF app/edge service can hold credentials for an
/// entire simulated fleet side by side.
///
/// <para><b>Why the directory is redirectable (test-hygiene batch).</b> This class used to resolve its
/// directory straight from <see cref="Environment.SpecialFolder.CommonApplicationData"/> with no
/// override, which made it the ONLY store in this product that a test could not point somewhere
/// harmless — every sibling (<c>AlarmStore</c>, <c>ConnectorConfigStore</c>,
/// <c>NotificationConfigStore</c>, <c>BridgeSpool</c>, <c>FleetSettingsStore</c>,
/// <c>DeviceIdentityStore</c>, ...) already resolved explicit&gt;env&gt;default. The consequence was
/// not theoretical: the xunit suites and the Playwright e2e harness between them had written ~3,000
/// DPAPI-sealed <c>.bin</c> blobs into the REAL credential directory of this machine — the exact
/// directory <c>packaging/remove-data.ps1</c> exists to purge on decommissioning, and the exact
/// directory an operator is told holds device credentials. Giving this class the same seam its
/// siblings already had is what lets a test run write somewhere disposable instead.</para>
///
/// <para><b>Resolution is per-call, not cached</b> — same as every sibling store's
/// <c>ResolveRoot</c>. A test that sets <see cref="EnvVarDir"/> after this class has already been
/// touched still gets the redirect, which matters because this is a STATIC class with no
/// construction point a fixture could hook.</para>
///
/// <para><b>Keep <see cref="DefaultRoot"/>'s <c>"ST4I", "sim", "creds"</c> literal intact:</b>
/// <c>NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript</c>
/// discovers the set of directories a decommissioning wipe must purge by scanning <c>src/</c> for
/// exactly that literal shape. Inlining or computing the segment names would make this store
/// invisible to that scan and silently drop it from the wipe.</para>
///
/// NOTE (FF-2, breaking): this switches the DPAPI scope from <c>CurrentUser</c> to <c>LocalMachine</c>,
/// so a <c>.bin</c> file written by a pre-FF-2 build can no longer be decrypted here — <see cref="Load"/>
/// treats that (and any other corrupt/foreign blob) as "no stored key" rather than throwing, so the
/// caller's normal empty-credential path (re-claim) kicks in instead of a crash.
///
/// <para>🔴 <b>Task Z-1 — THE RE-CLAIM PATH NO LONGER DESTROYS THE BLOB IT COULD NOT READ</b> (owner
/// decision file, item 10, decided by the OWNER on 2026-08-18: <i>keep the old blob under another name</i>,
/// explicitly NOT the other option that item named, which was to make <see cref="Load"/> throw).</para>
///
/// <para><b>What was measured (V-1).</b> <see cref="Load"/> answers <see langword="null"/> both for
/// <i>there is no file</i> and for <i>there is a file this process cannot unprotect</i>, and the second is
/// usually a RECOVERABLE environment fault: a pre-FF-2 <c>CurrentUser</c> blob, or one copied from another
/// machine, becomes readable again the moment the environment is put back — <b>while it still exists</b>.
/// The caller cannot branch, so it takes the re-claim path, and the re-claim path calls <see cref="Save"/>,
/// which used to overwrite. A repairable fault was silently converted into an unrecoverable loss.</para>
///
/// <para><b>Where the law is applied, and why HERE rather than at the read.</b> The law
/// (<c>docs/startup-failure-posture.md</c> §3.6) is that only <i>there is nothing here</i> entitles a caller
/// to establish a value of its own and persist it. The value being established is the NEW <c>mk_</c> key and
/// the statement that persists it is <see cref="Save"/>, so that is the statement the licence belongs to —
/// and it is the one place in this static class that can classify the target without changing a signature
/// several projects call. <see cref="Save"/> now distinguishes three outcomes at the moment of the write:
/// <list type="bullet">
/// <item><description><b>nothing at the path</b> — write, exactly as before.</description></item>
/// <item><description><b>a blob this process CAN unprotect</b> — write, exactly as before. Nothing
/// recoverable is at stake: whoever is calling holds a key and is deliberately re-keying a credential this
/// machine can already read.</description></item>
/// <item><description><b>a blob that is there and this process cannot use</b> — the old file is MOVED to a
/// sibling name that says what it is, and only then is the new one written. Nothing is deleted and nothing
/// is overwritten.</description></item>
/// </list></para>
///
/// <para><b>The name is the discoverable record, and that is deliberate</b>: the old blob is renamed to
/// <c>&lt;machine code&gt;.bin.unreadable-&lt;UTC timestamp&gt;</c> beside the live one, so an operator
/// listing the creds directory sees which machine it belonged to, that it could not be read, and when. It is
/// NOT reported through any logger seam, because this class is <see langword="static"/> and has none — it
/// announces the move on the same <c>[credentialstore]</c> standard-error channel it already uses for its
/// ACL warning, and that channel is not the Windows Event Log under <c>AddWindowsService</c>. So the FILE is
/// the record an operator can rely on finding, which is why its name carries the whole story.</para>
///
/// <para><b>What the sideline is NOT.</b> It does not make the store readable again — the environment fault
/// still has to be fixed, by hand, and then the kept blob decrypted by whatever repaired it. It is not
/// pruned, ever, by anything in this product: a decommissioning wipe removes it because
/// <c>packaging/remove-data.ps1</c> removes the whole <c>creds</c> directory, and nothing else does. And it
/// never appears in <see cref="ListMachineCodes"/>, which enumerates <c>*.bin</c> — a machine whose only
/// remaining file is a sidelined one has NO stored credential, which is the truth.</para>
/// </summary>
public static class CredentialStore
{
    /// <summary>Relocates the whole store — the same "tests (and a decommissioning wipe) get an
    /// explicit, redirectable directory instead of the real one" seam every sibling store already
    /// exposes (<see cref="St4i.EdgeCore.Config.FleetSettingsStore.EnvVarDir"/>,
    /// <see cref="St4i.EdgeCore.Identity.DeviceIdentityStore.EnvVarDir"/>, ...). Unset or blank means
    /// "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_CREDS_DIR";

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("st4i.edgecore.credentialstore.v1");

    /// <summary>DPAPI-protects <paramref name="mkKey"/> and writes it to this machine's credential file
    /// (creating the containing directory tree if needed, and locking down its ACL — see this class's
    /// own doc comment and <see cref="SecurityDirAcl"/> — every time, so an install upgraded from a
    /// pre-FF-2 build gets self-healed on the very next credential save, not just a fresh one).
    ///
    /// <para>🔴 <b>Task Z-1 — a blob already at the path that this process CANNOT UNPROTECT is moved aside
    /// first, never overwritten.</b> See this class's own doc comment for the decision, the three outcomes
    /// and the name the old blob is kept under. A blob this process CAN unprotect is still replaced, because
    /// that is an ordinary re-key and nothing recoverable is at stake.</para>
    ///
    /// <para><b>New failure mode, stated because it is a widening of what this method can throw.</b> If the
    /// old blob has to be kept and keeping it FAILS — the file is locked, or the ACL refuses the rename —
    /// the exception propagates and the new credential is NOT written. That is the correct end: the
    /// alternative is to destroy the bytes this method exists to preserve. It is reachable only when a blob
    /// is present AND unusable AND unmovable; with nothing at the path, or a usable blob at it, this method
    /// throws exactly what it always did.</para></summary>
    public static void Save(string machineCode, string mkKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(mkKey);

        var path = PathFor(machineCode);
        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);

        // FF-2 review fix — restrict the creds directory to SYSTEM/Administrators/owner only, the exact
        // same lock-down St4i.EngineApi's Program.cs already applies to the security directory. Runs
        // unconditionally on every Save (self-healing, best-effort, never throws — see
        // SecurityDirAcl.Apply's own doc comment), not just when the directory is first created.
        SecurityDirAcl.Apply(dir, msg => Console.Error.WriteLine($"[credentialstore] {msg}"));

        // 🔴 TASK Z-1 — item 10. Ordered BEFORE the write and after the directory exists, so the write below
        // can only ever land on a path that holds nothing or held something this process could read.
        KeepAnUnusableBlobAside(path);

        var plain = Encoding.UTF8.GetBytes(mkKey);
        var protectedBytes = ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine);
        File.WriteAllBytes(path, protectedBytes);
    }

    /// <summary>What the old blob is renamed to, between the <c>.bin</c> and the UTC stamp. Kept as a
    /// constant because it is the string an operator greps the creds directory for.</summary>
    private const string KeptAsideMarker = ".unreadable-";

    /// <summary>🔴 Task Z-1 — the three-outcome classification of what is already at
    /// <paramref name="path"/>, taken at the moment of the write. Returns having done nothing when there is
    /// nothing there, and when what is there unprotects cleanly; moves the file aside otherwise.
    ///
    /// <para><b>There is no existence probe</b>, for the reason <c>docs/startup-failure-posture.md</c>
    /// §3.1a-now gives at every other store in this product: the open IS the classifier, and only the
    /// filesystem's own missing-file / missing-directory answers mean <i>absent</i>. Any other read failure
    /// means something is there that this process cannot use, which is the outcome that must NOT be
    /// overwritten. Being wrong in the other direction is the one that costs bytes.</para></summary>
    private static void KeepAnUnusableBlobAside(string path)
    {
        try
        {
            var existing = File.ReadAllBytes(path);
            try
            {
                _ = ProtectedData.Unprotect(existing, Entropy, DataProtectionScope.LocalMachine);
                return; // Present and usable: an ordinary re-key. Replacing it is what the caller asked for.
            }
            catch (CryptographicException)
            {
                // Present and NOT usable — wrong DPAPI scope, another machine, or corrupt. Fall through.
            }
        }
        catch (FileNotFoundException)
        {
            return; // Absent. The one outcome that entitles the caller to establish a value here.
        }
        catch (DirectoryNotFoundException)
        {
            return; // Absent, same reasoning.
        }
        catch (Exception)
        {
            // Two different arms land here and the comment must cover both (review M-2):
            //   * the READ failed for a reason that is not "absent" — something is at the path and this
            //     process could not even get its bytes; and
            //   * the read SUCCEEDED and Unprotect threw something other than CryptographicException
            //     (PlatformNotSupportedException off Windows is the concrete one).
            // Neither is "nothing here", so both fall through to the move rather than to the write. Being
            // wrong in this direction costs a rename; being wrong in the other direction costs the bytes.
        }

        var kept = ReserveKeptAsidePath(path);
        // File.Move WITHOUT the overwrite flag, deliberately: it THROWS if the destination exists, so a
        // stale answer from the probe inside ReserveKeptAsidePath can cost a failed Save but can never cost
        // a kept blob. The probe picks a readable name; this overload is what makes the guarantee.
        File.Move(path, kept);

        Console.Error.WriteLine(
            $"[credentialstore] The stored credential at \"{path}\" is present and this process could NOT " +
            $"decrypt it (wrong DPAPI scope, a different machine, or corrupt). It was NOT overwritten — it " +
            $"was kept at \"{kept}\" and a freshly claimed credential was written in its place. If the cause " +
            "was an environment change, that file becomes readable again once the environment is put back; " +
            "nothing in this product ever deletes it.");
    }

    /// <summary>A free sibling path for a blob being kept aside:
    /// <c>&lt;machine code&gt;.bin.unreadable-&lt;yyyyMMddTHHmmssZ&gt;</c>, with <c>-2</c>, <c>-3</c>… only
    /// if that exact name is already taken (two unusable blobs kept aside for the same machine inside one
    /// second). The extension deliberately does NOT end in <c>.bin</c>, so
    /// <see cref="ListMachineCodes"/> cannot report a kept-aside blob as a stored credential.</summary>
    private static string ReserveKeptAsidePath(string path)
    {
        var stamp = DateTime.UtcNow.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        var baseName = path + KeptAsideMarker + stamp;

        var candidate = baseName;
        for (var n = 2; File.Exists(candidate); n++)
        {
            candidate = $"{baseName}-{n}";
        }

        return candidate;
    }

    /// <summary>Lists the machine codes that currently have a saved credential file — the raw filename
    /// stems under the creds directory (Task 19a: Settings' stored-credentials view), NOT their
    /// decrypted mk_ values. Returns an empty list (not an exception) if the creds directory doesn't
    /// exist yet, e.g. a fresh install that has never called <see cref="Save"/>.
    ///
    /// <para>🔴 Task Z-1 — a blob <see cref="Save"/> kept aside is deliberately NOT listed here: its name
    /// does not end in <c>.bin</c>, and a machine whose only remaining file is a kept-aside one genuinely has
    /// no stored credential. Pinned rather than reasoned about —
    /// <c>CredentialStoreTests.ListMachineCodes_DoesNotReportABlobThatWasKeptAside</c>, because
    /// <c>*.bin</c> is a three-character extension and Windows pattern matching treats those specially.
    /// <b>That sentence was FALSE when it was first published (review I-1): the test it names asserted a
    /// FILTERED <c>Assert.Single</c>, which survives an extra member whose spelling the filter does not
    /// describe — and the stem of a kept-aside blob is exactly such a member. The test now compares the
    /// WHOLE list; the claim is a pin again.</b> Its ceiling is one volume's 8.3-name configuration, stated
    /// on the test itself.</para></summary>
    public static IReadOnlyList<string> ListMachineCodes()
    {
        var dir = CredsDir();
        if (!Directory.Exists(dir)) return Array.Empty<string>();

        return Directory.EnumerateFiles(dir, "*.bin")
            .Select(Path.GetFileNameWithoutExtension)
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Reads and DPAPI-unprotects the stored key for <paramref name="machineCode"/>, or
    /// <c>null</c> if no credential file exists for it OR its bytes can't be unprotected (FF-2: a
    /// corrupt file, one encrypted under a different DPAPI scope/entropy — e.g. a pre-FF-2
    /// <c>CurrentUser</c>-encrypted <c>.bin</c> — or one copied in from a different machine all throw
    /// <see cref="CryptographicException"/> from <see cref="ProtectedData.Unprotect"/>; all of those are
    /// treated the same as "no stored key" so a caller's normal empty-credential path (forcing a
    /// re-claim) runs instead of an unhandled crash).
    ///
    /// <para>🔴 <b>Task Z-1 — this <see langword="null"/> IS STILL AMBIGUOUS, ON PURPOSE, AND THAT IS THE
    /// DECIDED SHAPE.</b> Item 10 of <c>docs/owner-decisions.md</c> named two repairs and the owner chose the
    /// one that is NOT here: making this method throw would have changed the contract of a
    /// <see langword="static"/> method several projects call, so the loss is stopped at
    /// <see cref="Save"/> instead, which keeps the unusable blob under another name rather than overwriting
    /// it. A caller still cannot tell the two cases apart from this return value, and it no longer has to:
    /// taking the re-claim path can no longer destroy the bytes that would have come back once the
    /// environment was repaired. What this method's <see langword="null"/> costs after Z-1 is that the
    /// operator is not TOLD at read time — they find out from the kept-aside file, or from the line
    /// <see cref="Save"/> writes when it keeps one.</para>
    ///
    /// <para>🔴 <b>And one narrower thing that is NOT the decided exception:</b> the
    /// <see cref="File.Exists(string)"/> probe below is a second surface answering a question this read could
    /// answer itself, which every other store in this product removed at task Q-1. It makes an unreadable
    /// directory or a locked file throw out of this method rather than return <see langword="null"/> — a
    /// different outcome from the one this doc comment describes, at a site nothing measures. Item 10 decided
    /// the OVERWRITE; it did not decide this, and Z-1 did not take it.</para></summary>
    public static string? Load(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);

        var path = PathFor(machineCode);
        if (!File.Exists(path)) return null;

        var protectedBytes = File.ReadAllBytes(path);
        byte[] plain;
        try
        {
            plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.LocalMachine);
        }
        catch (CryptographicException)
        {
            return null;
        }
        return Encoding.UTF8.GetString(plain);
    }

    private static string PathFor(string machineCode) =>
        Path.Combine(CredsDir(), SanitizeFileName(machineCode) + ".bin");

    private static string CredsDir() => ResolveRoot();

    /// <summary>The default creds root: <c>%ProgramData%\ST4I\sim\creds</c> — a SIBLING of
    /// <c>...\sim\identity</c>/<c>...\sim\settings</c>/<c>...\sim\alarms</c>, never the same directory
    /// as any of those. See this class's own doc comment before changing the literal.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "creds");

    /// <summary>Resolves the effective creds directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk (<see cref="Save"/> does that). Identical shape to every sibling store's
    /// <c>ResolveRoot</c>, deliberately, so there is one idiom to learn rather than two.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    /// <summary>Strips characters that aren't valid in a Windows filename so an arbitrary
    /// <c>machineCode</c> can't escape the creds directory or collide with reserved names.
    /// <c>internal</c> (not <c>private</c>) so other St4i.EdgeCore path-resolution code — e.g.
    /// WS-C's <see cref="St4i.EdgeCore.Transport.WalOptions.ResolveQueueFile"/> — can reuse the exact
    /// same sanitization instead of re-implementing it; behavior is unchanged.</summary>
    internal static string SanitizeFileName(string machineCode)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(machineCode.Length);
        foreach (var c in machineCode)
        {
            sb.Append(invalid.Contains(c) ? '_' : c);
        }
        return sb.ToString();
    }
}
