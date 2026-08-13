using System.Security.AccessControl;
using System.Security.Principal;

namespace St4i.SettingsAclProbe;

/// <summary>
/// The probe's ONE filesystem choke point, and the reason a run of this tool can be trusted near a machine
/// that has a real <c>%ProgramData%\ST4I</c> on it.
///
/// <para><b>What it measures, and it measures rather than declares.</b> Every path this probe names is
/// resolved and admitted here first. A path outside the sandbox is REFUSED before any syscall is issued, and
/// the refusal is counted. <c>Admitted</c> plus <c>Refused</c> is therefore the whole population of paths the
/// probe ever put in front of the operating system — with one deliberate exception, stated here rather than
/// left to be found: <see cref="St4i.EdgeCore.Config.FleetSettingsStore"/>'s OWN I/O does not go through this
/// gate, because that store is the thing under measurement. What closes that hole is that the store's
/// resolved <c>RootDirectory</c> is itself put through <see cref="Admit"/> on every case, so the store can
/// only ever have been pointed inside the sandbox.</para>
///
/// <para><b>Zero refusals is not evidence on its own</b> — a gate that admits everything also reports zero.
/// <c>Program.SafetyControls</c> therefore fires two POSITIVE controls through it before any measurement
/// runs, and a run whose controls do not both refuse exits non-zero without measuring anything.</para>
///
/// <para>🔴 <b>Two more stated limits, because a completeness claim is the dangerous kind.</b> First,
/// <see cref="IsUnder"/> is a resolved-path PREFIX test with <b>no link resolution</b>, deliberately: reading
/// a reparse point's target is a syscall, and this gate's whole value is that it decides BEFORE one is
/// issued. A junction planted under the machine's temp directory would defeat it. Second, the
/// <c>ApplicationStarted</c> arm builds a real web host, which resolves a content root and runs
/// configuration providers without passing through here — nowhere near the product's data root, so this is a
/// completeness point about the claim rather than a safety one, but the claim is "every path", so it is
/// said.</para>
/// </summary>
internal sealed class SandboxGate
{
    private readonly List<string> _refused = [];

    private SandboxGate(string root) => Root = root;

    /// <summary>The one directory this probe is allowed to touch. Everything else is refused.</summary>
    public string Root { get; }

    public int Admitted { get; private set; }

    public IReadOnlyList<string> Refused => _refused;

    /// <summary>Creates a fresh sandbox under the machine's temp directory. The name carries the clock and
    /// the process id so two runs never share a root and an abandoned one is identifiable.</summary>
    public static SandboxGate Create()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "st4i-settings-acl-probe",
            $"{DateTime.Now:yyyyMMdd-HHmmss}-{Environment.ProcessId}");
        Directory.CreateDirectory(root);
        return new SandboxGate(Path.GetFullPath(root));
    }

    /// <summary>Resolves <paramref name="path"/> and returns it if it is inside <see cref="Root"/>; throws
    /// otherwise, having issued no filesystem call at all. <see cref="Path.GetFullPath(string)"/> is pure
    /// string arithmetic on the process's current directory — it does not touch the path it is given.</summary>
    public string Admit(string path)
    {
        var full = Path.GetFullPath(path);
        if (!IsUnder(full, Root))
        {
            _refused.Add(full);
            throw new InvalidOperationException(
                $"SANDBOX REFUSAL — \"{full}\" is not under \"{Root}\". No filesystem call was issued.");
        }

        Admitted++;
        return full;
    }

    /// <summary>The refusal half of <see cref="Admit"/>, for the positive controls: reports whether a path
    /// would be refused, without counting it as an admission and without issuing any filesystem call. A
    /// refusal is recorded exactly as <see cref="Admit"/> records one, so the run's refusal COUNT and the
    /// controls printed above it cannot disagree.</summary>
    public bool Refuses(string path)
    {
        var full = Path.GetFullPath(path);
        if (IsUnder(full, Root)) return false;

        _refused.Add(full);
        return true;
    }

    /// <summary>The real product root, as a STRING. Pure path arithmetic —
    /// <see cref="Environment.GetFolderPath(Environment.SpecialFolder)"/> reads the known-folder table, not
    /// the directory — so naming it here does not read, write or otherwise touch it.</summary>
    public static string RealProductRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I");

    private static bool IsUnder(string candidate, string root)
    {
        var rooted = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var probe = candidate.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return probe.StartsWith(rooted, StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>
/// One deny ACE, applied to one object inside the sandbox, and removed again on <see cref="Dispose"/> —
/// including on the throwing path, because every caller holds it in a <c>using</c>.
///
/// <para><b>The restoration is verified, not assumed.</b> The object's SDDL is captured before the rule is
/// added and re-read after it is removed, and the two are compared. The comparison — not the fact that
/// <c>Dispose</c> ran — is what <c>Program</c> prints as the restoration evidence, and a mismatch or a
/// throwing restore makes the whole run exit non-zero and say so on stderr.</para>
///
/// <para><b>Why a deny ACE on the current user's SID can always be taken back.</b> The sandbox is created by
/// this process, so this user owns every object in it, and an owner holds <c>READ_CONTROL</c> and
/// <c>WRITE_DAC</c> implicitly no matter what the DACL says. A deny rule this probe writes can therefore
/// never lock the probe out of undoing it.</para>
/// </summary>
internal sealed class AclLease : IDisposable
{
    private static readonly List<AclLease> LiveLeases = [];
    private static readonly List<string> Evidence = [];

    private readonly string _path;
    private readonly bool _isDirectory;
    private readonly FileSystemAccessRule _rule;
    private readonly string _before;
    private readonly Dictionary<string, string> _childrenBefore;
    private bool _released;

    private AclLease(
        string path,
        bool isDirectory,
        FileSystemAccessRule rule,
        string before,
        Dictionary<string, string> childrenBefore)
    {
        _path = path;
        _isDirectory = isDirectory;
        _rule = rule;
        _before = before;
        _childrenBefore = childrenBefore;
    }

    /// <summary>Every restoration attempt, in order, as one line each: verdict, path, SDDL before, SDDL
    /// after. This is the deliverable's ACL evidence.</summary>
    public static IReadOnlyList<string> RestorationEvidence => Evidence;

    public static int NotRestored { get; private set; }

    /// <summary>Withholds <paramref name="rights"/> from the CURRENT USER on one object.
    /// <paramref name="inherit"/> is load-bearing rather than a convenience: WITHOUT it a deny on a
    /// directory cannot reach the file inside it, which is what keeps the two cases this probe exists to
    /// separate apart; WITH it the rule reproduces what a folder-properties deny actually writes, and the
    /// difference between those two rows turned out to be the whole answer.</summary>
    public static AclLease Deny(
        SandboxGate gate, string path, bool isDirectory, FileSystemRights rights, bool inherit = false)
    {
        var full = gate.Admit(path);
        var sid = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("this process has no user SID to scope a deny rule to");
        var inheritance = inherit
            ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit
            : InheritanceFlags.None;
        var rule = new FileSystemAccessRule(
            sid, rights, inheritance, PropagationFlags.None, AccessControlType.Deny);

        var before = ReadSddl(full, isDirectory);

        // 🔴 Review Minor 5. An INHERITING rule changes objects this lease was not written to, and a
        // restoration check scoped to the target would report "restored" while a propagated deny sat on a
        // child. That is the shape the whole R1i finding turns on, so the children are snapshotted here and
        // compared on the way out — evidence about everything the rule REACHED, not about one object.
        var childrenBefore = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (inherit && isDirectory)
        {
            foreach (var child in Directory.GetFileSystemEntries(full))
            {
                childrenBefore[child] = ReadSddl(child, Directory.Exists(child));
            }
        }

        var lease = new AclLease(full, isDirectory, rule, before, childrenBefore);
        lock (LiveLeases)
        {
            LiveLeases.Add(lease);
        }

        Mutate(full, isDirectory, security => security.AddAccessRule(rule));
        return lease;
    }

    /// <summary>Holds several restrictions as one, so a shape can withhold rights on more than one object.
    /// Disposed in reverse order, and every member is disposed even if an earlier one throws.</summary>
    public static IDisposable All(params IDisposable[] leases) => new LeaseSet(leases);

    private sealed class LeaseSet(IDisposable[] leases) : IDisposable
    {
        public void Dispose()
        {
            List<Exception>? failures = null;
            for (var i = leases.Length - 1; i >= 0; i--)
            {
                try
                {
                    leases[i].Dispose();
                }
                catch (Exception ex)
                {
                    (failures ??= []).Add(ex);
                }
            }

            if (failures is { Count: > 0 }) throw new AggregateException(failures);
        }
    }

    /// <summary>The safety net for a path that never reaches a <c>using</c>'s dispose — an
    /// <see cref="AppDomain.ProcessExit"/> handler calls this. It is loud on purpose: a lease still live at
    /// exit is the one failure this probe cannot walk back.</summary>
    public static void DrainOutstanding()
    {
        AclLease[] outstanding;
        lock (LiveLeases)
        {
            outstanding = [.. LiveLeases];
        }

        foreach (var lease in outstanding)
        {
            Console.Error.WriteLine($"!! an ACL lease on \"{lease._path}\" was still live at teardown — releasing it now");
            lease.Dispose();
        }
    }

    public void Dispose()
    {
        if (_released) return;
        _released = true;

        string after;
        string verdict;
        try
        {
            Mutate(_path, _isDirectory, security => security.RemoveAccessRuleSpecific(_rule));
            after = ReadSddl(_path, _isDirectory);
            verdict = string.Equals(after, _before, StringComparison.Ordinal) ? "RESTORED"
                : string.Equals(AceList(after), AceList(_before), StringComparison.Ordinal) ? "RESTORED+AI"
                : "MISMATCH";

            var strayChild = FirstUnrestoredChild();
            if (strayChild is not null)
            {
                verdict = "CHILD MISMATCH";
                after += $"  [child not restored: {strayChild}]";
            }
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException)
        {
            // 🔴 Not a failure, and reported rather than swallowed: a measurement in this sandbox removed the
            // object the rule was written to, and a DACL cannot outlive its object. The only way this line is
            // reached is a Delete() this probe itself performed, inside its own temp root.
            after = "<the object was removed by a measurement in this sandbox>";
            verdict = "OBJECT GONE";
        }
        catch (Exception ex)
        {
            after = "<could not be re-read>";
            verdict = $"NOT RESTORED ({ex.GetType().Name}: {ex.Message})";
        }

        var clean = verdict is "RESTORED" or "RESTORED+AI" or "OBJECT GONE";
        lock (LiveLeases)
        {
            LiveLeases.Remove(this);
            Evidence.Add($"{verdict,-11} {_path}\n              before {_before}\n              after  {after}");
            if (!clean) NotRestored++;
        }

        if (!clean)
        {
            Console.Error.WriteLine($"!! ACL NOT RESTORED on \"{_path}\": {verdict}");
        }
    }

    /// <summary>🔴 The ACE list with the DACL's own control flags stripped, and the reason a second verdict
    /// exists at all. Windows sets <c>SE_DACL_AUTO_INHERITED</c> (<c>AI</c> in SDDL) on ANY
    /// <c>SetSecurityInfo</c> call, so an object whose DACL this probe touched and put back verbatim still
    /// reports a different SDDL string than it started with. That flag grants nothing and denies nothing;
    /// the ACEs are what confer access. <c>RESTORED+AI</c> therefore means "every ACE is identical and the
    /// only residue is that flag" — named in the output rather than normalised away, because a restoration
    /// check that quietly widens its own tolerance is worth nothing.</summary>
    private static string AceList(string sddl)
    {
        var firstAce = sddl.IndexOf('(', StringComparison.Ordinal);
        return firstAce < 0 ? sddl : sddl[firstAce..];
    }

    /// <summary>The first child whose ACE list did not come back to what it was, or null if every one did.
    /// A child that a measurement deleted is not a failure — its DACL went with it.</summary>
    private string? FirstUnrestoredChild()
    {
        foreach (var (child, before) in _childrenBefore)
        {
            var stillThere = File.Exists(child) || Directory.Exists(child);
            if (!stillThere) continue;

            string nowSddl;
            try
            {
                nowSddl = ReadSddl(child, Directory.Exists(child));
            }
            catch (Exception ex)
            {
                return $"{child} ({ex.GetType().Name})";
            }

            if (!string.Equals(AceList(nowSddl), AceList(before), StringComparison.Ordinal)) return child;
        }

        return null;
    }

    private static string ReadSddl(string path, bool isDirectory) => isDirectory
        ? new DirectoryInfo(path).GetAccessControl(AccessControlSections.Access)
            .GetSecurityDescriptorSddlForm(AccessControlSections.Access)
        : new FileInfo(path).GetAccessControl(AccessControlSections.Access)
            .GetSecurityDescriptorSddlForm(AccessControlSections.Access);

    private static void Mutate(string path, bool isDirectory, Action<FileSystemSecurity> change)
    {
        if (isDirectory)
        {
            var info = new DirectoryInfo(path);
            var security = info.GetAccessControl(AccessControlSections.Access);
            change(security);
            info.SetAccessControl(security);
        }
        else
        {
            var info = new FileInfo(path);
            var security = info.GetAccessControl(AccessControlSections.Access);
            change(security);
            info.SetAccessControl(security);
        }
    }
}

/// <summary>
/// An open handle on the settings file with a chosen share mode — the OTHER way this process's access to a
/// readable file is curtailed, and the one <c>docs/startup-failure-posture.md</c> §3.1a calls the reachable
/// vector. Held here so it sits in the same table as the ACL shapes rather than in a paragraph beside it.
/// </summary>
internal sealed class ShareLock : IDisposable
{
    private readonly FileStream _stream;

    private ShareLock(FileStream stream) => _stream = stream;

    public static ShareLock Hold(SandboxGate gate, string path, FileShare share) =>
        new(new FileStream(gate.Admit(path), FileMode.Open, FileAccess.Read, share));

    public void Dispose() => _stream.Dispose();
}
