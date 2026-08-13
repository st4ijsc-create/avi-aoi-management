using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using St4i.EdgeCore.Config;

namespace St4i.SettingsAclProbe;

/// <summary>
/// Task M-1 — <b>the SECOND instrument for the startup-failure posture list.</b>
///
/// <para><c>docs/startup-failure-posture.md</c> enumerates the startup-path configuration decisions and says
/// in as many words that its instrument was a READ and that <b>nothing was executed</b>. That list has now
/// been wrong twice in the same direction, and two of its statements are decided by behaviour no reading has
/// settled: what <see cref="File.Exists(string)"/> answers when access is curtailed, and whether an exception
/// out of an <c>ApplicationStarted</c> handler ends the host. This executable is where those are MEASURED.</para>
///
/// <para><b>The property, stated in words that contain neither of the two cases that provoked it.</b>
/// <i>For every distinct way this process's access along the path to the persisted settings can be curtailed
/// — at any component of that path, withholding any subset of the rights an open or an attribute lookup
/// consumes, arriving before or after the store is constructed — which of the store's observable outcomes
/// results (the constructor throwing, the read throwing, the read yielding null, the read yielding the
/// triple), and therefore which arm the composition root takes and what becomes of the operator's file.</i>
/// A directory whose contents cannot be listed and a file whose bytes cannot be read are two MEMBERS of that
/// population, not its definition; the shapes below include the ones that sit between them, because a
/// Windows ACL withholds rights individually and "unreadable" is not one state.</para>
///
/// <para><b>It is not a test project</b>, for the reason <c>tools/serial-bench</c>'s csproj already records
/// and this task inherits: making a directory unreadable is exactly what no suite can do without making
/// <c>Skipped</c> environment-dependent, and <c>scripts/verify-suites.sh</c>'s whole value is that its totals
/// mean the same thing on every machine. It is committed for the other half of that lesson: a measurement
/// that cannot be re-run is a paragraph, and a paragraph is the instrument this task exists to escape.</para>
///
/// <para><b>It never touches the real <c>%ProgramData%\ST4I</c>.</b> Every path goes through
/// <see cref="SandboxGate"/>; the store is pointed at a temp root through <see cref="FleetSettingsStore.EnvVarDir"/>,
/// the same environment seam <c>St4i.EngineApi/Program.cs</c>'s <c>settingsStore</c> construction reads; and
/// two positive controls prove the gate refuses the real root before any measurement runs.</para>
///
/// <code>
///   dotnet run --project tools/settings-acl-probe
///   dotnet run --project tools/settings-acl-probe -- --only acl        # skip the host experiment
///   dotnet run --project tools/settings-acl-probe -- --only started    # only the host experiment
///   dotnet run --project tools/settings-acl-probe -- --keep            # leave the sandbox for inspection
/// </code>
/// </summary>
internal static class Program
{
    private const string OperatorJson =
        """{"ServerUrl":"https://operator.example.invalid:8443","MachineCode":"OPERATOR-EDIT-01","VerifyTls":false}""";

    private const string MalformedJson = "{ this is not json";

    private static int _problems;

    private static int Main(string[] args)
    {
        var options = ProbeOptions.Parse(args);
        if (options is null) return 2;

        var gate = SandboxGate.Create();
        AppDomain.CurrentDomain.ProcessExit += (_, _) => AclLease.DrainOutstanding();

        Preamble(gate);
        if (!SafetyControls(gate))
        {
            Console.Error.WriteLine("the sandbox gate failed its own positive controls — NOTHING was measured.");
            return 3;
        }

        try
        {
            if (options.Acl)
            {
                PassOne(gate);
                PassTwo(gate);
                PassThree(gate);
            }

            if (options.Started) StartedHandlerExperiment();
        }
        finally
        {
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, null);
            AclLease.DrainOutstanding();
            RestorationEvidence();
            Teardown(gate, options.Keep);
            Summary(gate);
        }

        return _problems == 0 ? 0 : 1;
    }

    // ── the sandbox, and the proof it is one ────────────────────────────────────────────────────────────

    private static void Preamble(SandboxGate gate)
    {
        using var identity = WindowsIdentity.GetCurrent();
        Console.WriteLine("St4i settings-ACL probe — task M-1, the second instrument for docs/startup-failure-posture.md");
        Console.WriteLine($"  runtime        {Environment.Version} on {Environment.OSVersion}");
        Console.WriteLine($"  identity       {identity.Name}  (elevated={new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator)})");
        Console.WriteLine($"  sandbox root   {gate.Root}");
        Console.WriteLine($"  seam           {FleetSettingsStore.EnvVarDir} — the same variable the composition root's store construction reads");
        Console.WriteLine(new string('-', 118));
    }

    /// <summary>🔴 The gate's own calibration, and it runs BEFORE anything is measured. A count of zero
    /// refusals is what a gate that refuses nothing also reports, so the two paths this probe must never
    /// touch are pushed through it on purpose and are required to bounce.</summary>
    private static bool SafetyControls(SandboxGate gate)
    {
        var realRoot = SandboxGate.RealProductRoot();
        var defaultSettingsRoot = FleetSettingsStore.DefaultRoot();

        var refusesRealRoot = gate.Refuses(realRoot);
        var refusesDefaultRoot = gate.Refuses(defaultSettingsRoot);

        Console.WriteLine("SAFETY CONTROLS — the two roots this probe must never reach, pushed through the gate on purpose:");
        Console.WriteLine($"  {(refusesRealRoot ? "REFUSED" : "ADMITTED !!")}  {realRoot}");
        Console.WriteLine($"  {(refusesDefaultRoot ? "REFUSED" : "ADMITTED !!")}  {defaultSettingsRoot}   ({nameof(FleetSettingsStore)}.{nameof(FleetSettingsStore.DefaultRoot)}())");
        Console.WriteLine("  Both are STRINGS here: no filesystem call is issued on either, then or ever.");
        Console.WriteLine();

        if (refusesRealRoot && refusesDefaultRoot) return true;
        _problems++;
        return false;
    }

    private static void Teardown(SandboxGate gate, bool keep)
    {
        if (keep)
        {
            Console.WriteLine($"--keep given: the sandbox is left at {gate.Root}");
            return;
        }

        try
        {
            Directory.Delete(gate.Root, recursive: true);
            Console.WriteLine($"sandbox removed: {gate.Root}");
        }
        catch (Exception ex)
        {
            _problems++;
            Console.Error.WriteLine($"!! the sandbox could not be removed ({ex.GetType().Name}: {ex.Message}) — {gate.Root}");
        }
    }

    private static void RestorationEvidence()
    {
        Console.WriteLine();
        Console.WriteLine("ACL RESTORATION EVIDENCE — one line per rule applied; the verdict is an SDDL comparison,");
        Console.WriteLine("not the fact that a dispose ran.");
        foreach (var line in AclLease.RestorationEvidence) Console.WriteLine($"  {line}");
        if (AclLease.RestorationEvidence.Count == 0) Console.WriteLine("  (no ACL rule was applied in this run)");
        if (AclLease.NotRestored > 0) _problems += AclLease.NotRestored;
    }

    private static void Summary(SandboxGate gate)
    {
        Console.WriteLine();
        Console.WriteLine(new string('-', 118));
        Console.WriteLine($"paths admitted by the gate: {gate.Admitted}; paths refused: {gate.Refused.Count}");
        foreach (var refusal in gate.Refused) Console.WriteLine($"  refused: {refusal}");
        Console.WriteLine($"ACL rules applied: {AclLease.RestorationEvidence.Count}; not restored: {AclLease.NotRestored}");
        Console.WriteLine(_problems == 0
            ? "PROBE OK — every ACL was restored and no path outside the sandbox was ever issued to the filesystem."
            : $"PROBE PROBLEMS: {_problems}. The measurements above are still printed; treat them as suspect and read the stderr lines.");
    }

    // ── the restriction shapes ──────────────────────────────────────────────────────────────────────────

    private enum FixtureKind
    {
        ValidFile,
        NoFile,
        MalformedFile,

        /// <summary>The parent exists and the settings root does NOT, so the constructor's own
        /// <c>Directory.CreateDirectory</c> has real work to do. Only pass 1 uses it: passes 2 and 3 build
        /// the store before the restriction, which would create the very directory this shape withholds.</summary>
        NoRootDirectory,
    }

    private sealed record Fixture(SandboxGate Gate, string ParentDir, string SettingsRoot, string SettingsFile)
    {
        public static Fixture Create(SandboxGate gate, string caseId, FixtureKind kind)
        {
            var parent = gate.Admit(Path.Combine(gate.Root, caseId));
            Directory.CreateDirectory(parent);

            var settingsRoot = gate.Admit(Path.Combine(parent, "settings"));
            if (kind != FixtureKind.NoRootDirectory) Directory.CreateDirectory(settingsRoot);

            var file = gate.Admit(Path.Combine(settingsRoot, "fleet-settings.json"));
            if (kind is FixtureKind.ValidFile or FixtureKind.MalformedFile)
            {
                File.WriteAllText(file, kind == FixtureKind.MalformedFile ? MalformedJson : OperatorJson);
            }

            return new Fixture(gate, parent, settingsRoot, file);
        }

        public bool FilePresent => File.Exists(SettingsFile);
    }

    private sealed record Shape(string Id, string Withheld, Func<Fixture, IDisposable?> Apply, FixtureKind Kind = FixtureKind.ValidFile);

    /// <summary>🔴 The population, derived from the property above rather than from the two cases that
    /// provoked the task. Rows R1 and R5 are those two cases; everything else is a member the property
    /// admits and neither case names — and the rows that decide the answer turned out to be among them.
    ///
    /// <para><b>R11 is the constructor column's positive control</b>, and without it "ctor: ok" on every
    /// other row would be evidence about nothing: a column that cannot report a throw is not a measurement.
    /// C1/C2/C3 are the read column's, in the same way.</para></summary>
    private static IReadOnlyList<Shape> Shapes() =>
    [
        new("R1  dir: all read + traverse", "the settings DIRECTORY: ReadData/ReadAttributes/ReadEA/ReadPermissions + Traverse, that object only",
            f => AclLease.Deny(f.Gate, f.SettingsRoot, true, FileSystemRights.Read | FileSystemRights.Traverse)),
        new("R1i dir: same, INHERITED", "the settings DIRECTORY: the same rights, propagated to its children — what a folder-properties deny actually writes",
            f => AclLease.Deny(f.Gate, f.SettingsRoot, true, FileSystemRights.Read | FileSystemRights.Traverse, inherit: true)),
        new("R2  dir: list only", "the settings DIRECTORY: ListDirectory only — traverse and attributes still allowed",
            f => AclLease.Deny(f.Gate, f.SettingsRoot, true, FileSystemRights.ListDirectory)),
        new("R3  dir: attributes only", "the settings DIRECTORY: ReadAttributes only",
            f => AclLease.Deny(f.Gate, f.SettingsRoot, true, FileSystemRights.ReadAttributes)),
        new("R4  dir: traverse only", "the settings DIRECTORY: Traverse only",
            f => AclLease.Deny(f.Gate, f.SettingsRoot, true, FileSystemRights.Traverse)),
        new("R5  file: all read", "the FILE: ReadData/ReadAttributes/ReadEA/ReadPermissions",
            f => AclLease.Deny(f.Gate, f.SettingsFile, false, FileSystemRights.Read)),
        new("R6  file: data only", "the FILE: ReadData only — its attributes are still readable",
            f => AclLease.Deny(f.Gate, f.SettingsFile, false, FileSystemRights.ReadData)),
        new("R7  file: attributes only", "the FILE: ReadAttributes only — its bytes are still readable",
            f => AclLease.Deny(f.Gate, f.SettingsFile, false, FileSystemRights.ReadAttributes)),
        new("R8  parent: read + traverse", "the PARENT of the settings root: read + traverse",
            f => AclLease.Deny(f.Gate, f.ParentDir, true, FileSystemRights.Read | FileSystemRights.Traverse)),
        new("R9  lock: FileShare.None", "no ACL — a handle held with FileShare.None (an editor, an AV scanner)",
            f => ShareLock.Hold(f.Gate, f.SettingsFile, FileShare.None)),
        new("R10 lock: FileShare.Read", "no ACL — a handle held with FileShare.Read (a well-behaved reader)",
            f => ShareLock.Hold(f.Gate, f.SettingsFile, FileShare.Read)),
        new("R11 parent: cannot create", "the PARENT: Write withheld AND the settings root absent, so the ctor's own Directory.CreateDirectory must really create it",
            f => AclLease.Deny(f.Gate, f.ParentDir, true, FileSystemRights.Write), FixtureKind.NoRootDirectory),
        new("C1  control: no file", "nothing withheld; no settings file at all", _ => null, FixtureKind.NoFile),
        new("C2  control: readable", "nothing withheld; a valid settings file", _ => null),
        new("C3  control: malformed", "nothing withheld; a present but malformed settings file", _ => null, FixtureKind.MalformedFile),
    ];

    // ── pass 1: the boot sequence, in the composition root's own order ──────────────────────────────────

    /// <summary>🔴 Construct, then read — the order <c>St4i.EngineApi/Program.cs</c> executes, so a shape
    /// that ends the process at the constructor never gets to answer the read's question. That ordering is
    /// itself one of the claims under measurement.</summary>
    private static void PassOne(SandboxGate gate)
    {
        Banner("PASS 1 — the boot sequence: `new FleetSettingsStore()` then `Load()`, restriction already in place");
        var rows = new List<string[]>();

        foreach (var shape in Shapes())
        {
            var fixture = Fixture.Create(gate, "p1-" + Slug(shape.Id), shape.Kind);
            var present = fixture.FilePresent;
            string ctor;
            string load;
            string arm;

            using (shape.Apply(fixture))
            {
                Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, fixture.SettingsRoot);
                var (ctorOutcome, store) = Attempt(() => new FleetSettingsStore());
                ctor = ctorOutcome;

                if (store is null)
                {
                    load = "—";
                    arm = "PROCESS ENDS at the ctor";
                }
                else
                {
                    gate.Admit(store.RootDirectory);
                    var (loadOutcome, loaded) = Attempt(store.Load);
                    load = Describe(loadOutcome, loaded);
                    arm = Arm(ctorOutcome, loadOutcome, loaded, present);
                }
            }

            rows.Add([shape.Id, present ? "yes" : "no", ctor, load, arm]);
        }

        Table(["restriction", "file?", "ctor", "Load()", "what the composition root then does"], rows);
    }

    // ── pass 2: the read in isolation, with the denial's own calibration ────────────────────────────────

    /// <summary>🔴 The store is built BEFORE the restriction here, so a constructor that ends the process in
    /// pass 1 cannot hide what the read would have done. The first two columns are the CALIBRATION: without
    /// them a row reading "Load() → triple" is indistinguishable from a deny rule that never bit.</summary>
    private static void PassTwo(SandboxGate gate)
    {
        Banner("PASS 2 — the read alone: store constructed first, restriction applied second");
        var rows = new List<string[]>();

        foreach (var shape in Shapes())
        {
            if (shape.Kind == FixtureKind.NoRootDirectory) continue;

            var fixture = Fixture.Create(gate, "p2-" + Slug(shape.Id), shape.Kind);
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, fixture.SettingsRoot);
            var store = new FleetSettingsStore();
            gate.Admit(store.RootDirectory);

            string enumerate;
            string open;
            string exists;
            string load;
            string delete;

            using (shape.Apply(fixture))
            {
                enumerate = Attempt(() => Directory.EnumerateFileSystemEntries(fixture.SettingsRoot).Count()).Outcome;
                open = Attempt(() =>
                {
                    using var handle = File.OpenRead(fixture.SettingsFile);
                    return handle.Length;
                }).Outcome;
                exists = Attempt(() => File.Exists(fixture.SettingsFile)).Value.ToString();
                var (loadOutcome, loaded) = Attempt(store.Load);
                load = Describe(loadOutcome, loaded);
                delete = Attempt(store.Delete).Outcome;
            }

            var survived = File.Exists(fixture.SettingsFile);
            rows.Add([shape.Id, enumerate, open, exists, load, delete, survived ? "yes" : "NO"]);
        }

        Table(
            ["restriction", "enumerate dir", "open file", "File.Exists", "Load()", "Delete()", "file survives"],
            rows);
        Console.WriteLine("  `enumerate dir` and `open file` are the probe's own calls, not the store's: they say whether the");
        Console.WriteLine("  restriction actually bit. `File.Exists` is the same BCL call Load()'s own gate makes, reproduced");
        Console.WriteLine("  rather than observed — Load()'s return is the load-bearing column and the two must agree.");
        Console.WriteLine();
        Console.WriteLine("  TWO WINDOWS MECHANISMS DECIDE MOST OF THIS TABLE, and both are measured IN it rather than asserted:");
        Console.WriteLine("  * a deny on a DIRECTORY does not reach a file inside it. R4 withholds Traverse on the file's own");
        Console.WriteLine("    parent and `open file` still reports ok — which is what traverse-check bypass");
        Console.WriteLine("    (SeChangeNotifyPrivilege) looks like from outside. The BYPASS itself is not measured here: the");
        Console.WriteLine("    mechanism is inferred from the outcome, on the ONE token named in this run's header.");
        Console.WriteLine("  * File.Exists answers off the FILE, and every ACL row above reports True. A deny that stops the");
        Console.WriteLine("    directory being LISTED does not stop the file being NAMED.");
    }

    // ── pass 3: what the seed arm does to the operator's file ──────────────────────────────────────────

    /// <summary>🔴 The consequence chain the posture list argues about and nothing has run: when
    /// <c>Load()</c> yields null with a file PRESENT, the composition root takes the seed arm — the
    /// environment floor is applied, <c>FleetHost.UpdateSettings</c> persists unconditionally
    /// (<see cref="FleetSettingsStore.Save"/>), and if that activation failed the discard block calls
    /// <see cref="FleetSettingsStore.Delete"/> while logging that nothing an operator wrote was deleted.
    /// This pass runs both of those against the operator's own file and reports what is left of it.</summary>
    private static void PassThree(SandboxGate gate)
    {
        Banner("PASS 3 — the seed arm, run against a file that is present: Save() then Delete(), and what survives");
        var rows = new List<string[]>();
        var floor = new PersistedFleetSettings
        {
            ServerUrl = "http://floor.example.invalid:5000",
            MachineCode = "ENV-FLOOR-01",
            VerifyTls = true,
        };

        foreach (var shape in Shapes())
        {
            if (shape.Kind is FixtureKind.NoFile or FixtureKind.NoRootDirectory) continue;

            var fixture = Fixture.Create(gate, "p3-" + Slug(shape.Id), shape.Kind);
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, fixture.SettingsRoot);
            var store = new FleetSettingsStore();
            gate.Admit(store.RootDirectory);

            string load;
            string save;
            string delete;

            using (shape.Apply(fixture))
            {
                var (loadOutcome, loaded) = Attempt(store.Load);
                load = Describe(loadOutcome, loaded);
                if (load == "null")
                {
                    save = Attempt(() => store.Save(floor)).Outcome;
                    delete = Attempt(store.Delete).Outcome;
                }
                else
                {
                    save = "arm not taken";
                    delete = "arm not taken";
                }
            }

            var survives = File.Exists(fixture.SettingsFile);
            var content = survives
                ? Attempt(() => File.ReadAllText(fixture.SettingsFile)).Value?.Contains("OPERATOR-EDIT-01", StringComparison.Ordinal) == true
                    ? "the OPERATOR's"
                    : "the ENV FLOOR's"
                : "GONE";

            // 🔴 What the directory holds once the restriction lifts. FleetSettingsStore.Save writes a
            // temp file and renames over the target; a rename that fails leaves the temp file behind, and
            // nothing in the product ever looks at that directory again to notice.
            var leftovers = string.Join(
                ", ",
                Attempt(() => Directory.GetFiles(fixture.SettingsRoot).Select(Path.GetFileName).ToArray()).Value
                ?? ["<could not enumerate>"]);

            rows.Add([shape.Id, load, save, delete, survives ? "yes" : "NO", content, leftovers]);
        }

        Table(
            ["restriction", "Load()", "Save(floor)", "Delete()", "file survives", "whose triple is on disk", "what the directory holds afterwards"],
            rows);
    }

    // ── the second question: does a throwing ApplicationStarted handler end the host? ───────────────────

    /// <summary>
    /// 🔴 The experiment <c>docs/startup-failure-posture.md</c> §2 ceiling 3 names verbatim as the one that
    /// settles its single UNSETTLED row: <i>throw from an <c>ApplicationStarted</c> handler and report
    /// whether the host serves.</i> Registered exactly as the composition root registers its own — an
    /// <c>app.Lifetime.ApplicationStarted.Register(...)</c> before <c>app.Run()</c> — because the question is
    /// whether <c>NotifyStarted</c> wraps handler execution, and that is a property of the call site's shape.
    ///
    /// <para><b>The control is half the experiment.</b> An identical host whose handler does NOT throw runs
    /// first. Without it, "the host served" would be evidence about the rig rather than about the throw, and
    /// "the host did not serve" could be a port, a firewall or a content root.</para>
    /// </summary>
    private static void StartedHandlerExperiment()
    {
        Banner("PASS 4 — an exception out of an ApplicationStarted handler: does the host serve? (posture list row 40)");
        Console.WriteLine($"  ASP.NET Core assembly version: {typeof(WebApplication).Assembly.GetName().Version}");
        Console.WriteLine();

        var control = new CapturingLoggerProvider();
        var thrower = new CapturingLoggerProvider();
        var rows = new List<string[]>
        {
            RunHostArm("control — the handler returns normally", throws: false, control),
            RunHostArm("the handler THROWS", throws: true, thrower),
        };

        Table(["arm", "handler fired", "app.Run() returned", "GET answered", "verdict"], rows);

        // 🔴 The rule in docs/startup-failure-posture.md §1 is not "does it come up" alone — it is whether the
        // loss can be NAMED where somebody reads it. A row that comes up silently and a row that comes up and
        // says so are different postures, so what the framework logged is measured here rather than assumed.
        Console.WriteLine();
        Console.WriteLine("  WHAT EACH ARM SAID (Warning and above, captured from the host's own logging pipeline):");
        Report("control", control);
        Report("throwing", thrower);

        static void Report(string label, CapturingLoggerProvider capture)
        {
            if (capture.Lines.Count == 0)
            {
                Console.WriteLine($"    {label}: NOTHING at Warning or above.");
                return;
            }

            foreach (var line in capture.Lines) Console.WriteLine($"    {label}: {line}");
        }
    }

    private static string[] RunHostArm(string label, bool throws, CapturingLoggerProvider capture)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(capture);
        builder.Logging.SetMinimumLevel(LogLevel.Warning);
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        var app = builder.Build();
        app.MapGet("/probe", () => Results.Text("alive"));

        var fired = false;
        app.Lifetime.ApplicationStarted.Register(() =>
        {
            fired = true;
            if (throws) throw new InvalidOperationException("M-1 probe: an ApplicationStarted handler throwing on purpose");
        });

        Exception? runFailure = null;
        var runReturned = new ManualResetEventSlim(false);
        var thread = new Thread(() =>
        {
            try
            {
                app.Run();
            }
            catch (Exception ex)
            {
                runFailure = ex;
            }
            finally
            {
                runReturned.Set();
            }
        })
        {
            IsBackground = true,
        };
        thread.Start();

        var served = "not attempted";
        var settled = runReturned.Wait(TimeSpan.FromSeconds(10));
        if (!settled)
        {
            served = Probe(app);
            try
            {
                app.StopAsync().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                served += $" (StopAsync: {ex.GetType().Name})";
            }

            runReturned.Wait(TimeSpan.FromSeconds(10));
        }

        var ran = runFailure is null
            ? settled ? "returned cleanly" : "still serving until stopped"
            : $"threw {runFailure.GetType().Name}";

        var verdict = runFailure is not null
            ? "S — the process ends"
            : served.StartsWith("200", StringComparison.Ordinal)
                ? "U — the host comes up and serves"
                : "INCONCLUSIVE — read the columns";

        return [label, fired ? "yes" : "no", ran, served, verdict];
    }

    private static string Probe(WebApplication app)
    {
        try
        {
            var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses;
            var address = addresses?.FirstOrDefault();
            if (address is null) return "no bound address";

            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
            using var response = client.GetAsync($"{address}/probe").GetAwaiter().GetResult();
            var body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return $"{(int)response.StatusCode} {body}";
        }
        catch (Exception ex)
        {
            return $"{ex.GetType().Name}";
        }
    }

    // ── plumbing ────────────────────────────────────────────────────────────────────────────────────────

    private static (string Outcome, T? Value) Attempt<T>(Func<T> body)
    {
        try
        {
            return ("ok", body());
        }
        catch (Exception ex)
        {
            return (ex.GetType().Name, default);
        }
    }

    private static (string Outcome, bool Ran) Attempt(Action body)
    {
        try
        {
            body();
            return ("ok", true);
        }
        catch (Exception ex)
        {
            return (ex.GetType().Name, false);
        }
    }

    private static string Describe(string outcome, PersistedFleetSettings? loaded) => outcome != "ok"
        ? $"throws {outcome}"
        : loaded is null
            ? "null"
            : $"triple ({loaded.MachineCode})";

    private static string Arm(string ctorOutcome, string loadOutcome, PersistedFleetSettings? loaded, bool filePresent)
    {
        if (ctorOutcome != "ok") return "PROCESS ENDS at the ctor";
        if (loadOutcome != "ok") return "PROCESS ENDS at the read";
        if (loaded is not null) return "RESTORE arm — the persisted triple wins";
        return filePresent
            ? "SEED arm — WITH A FILE PRESENT"
            : "SEED arm — correctly (no file)";
    }

    private static string Slug(string id) =>
        new(id.Select(c => char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-').ToArray());

    private static void Banner(string title)
    {
        Console.WriteLine();
        Console.WriteLine(new string('=', 118));
        Console.WriteLine(title);
        Console.WriteLine(new string('=', 118));
    }

    private static void Table(string[] headers, List<string[]> rows)
    {
        var widths = headers.Select((h, i) => Math.Max(h.Length, rows.Count == 0 ? 0 : rows.Max(r => r[i].Length))).ToArray();
        Console.WriteLine(string.Join("  ", headers.Select((h, i) => h.PadRight(widths[i]))).TrimEnd());
        Console.WriteLine(string.Join("  ", widths.Select(w => new string('-', w))));
        foreach (var row in rows)
        {
            Console.WriteLine(string.Join("  ", row.Select((c, i) => c.PadRight(widths[i]))).TrimEnd());
        }
    }
}

/// <summary>
/// Captures the host's own log output so the ApplicationStarted arms can be judged on the posture rule's
/// actual test — <i>can the loss be named where somebody reads it</i> — and not only on whether a socket
/// answered. Deliberately the ONLY provider on those hosts, so nothing reaches the console and nothing the
/// framework emits is missed.
/// </summary>
internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly List<string> _lines = [];

    public IReadOnlyList<string> Lines => _lines;

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _lines);

    public void Dispose()
    {
        // Nothing to release: the sink is a list this provider hands out by reference.
    }

    private sealed class CapturingLogger(string category, List<string> sink) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Warning;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;

            var suffix = exception is null ? string.Empty : $" [{exception.GetType().Name}: {exception.Message}]";
            lock (sink)
            {
                sink.Add($"{logLevel} {category}: {formatter(state, exception)}{suffix}");
            }
        }
    }
}

internal sealed record ProbeOptions(bool Acl, bool Started, bool Keep)
{
    public static ProbeOptions? Parse(string[] args)
    {
        var acl = true;
        var started = true;
        var keep = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--only":
                    if (++i >= args.Length) { Console.Error.WriteLine("--only needs a value: acl or started"); return null; }
                    switch (args[i])
                    {
                        case "acl": started = false; break;
                        case "started": acl = false; break;
                        default: Console.Error.WriteLine($"--only takes acl or started, not \"{args[i]}\""); return null;
                    }

                    break;
                case "--keep": keep = true; break;
                case "--help" or "-h": Usage(); return null;
                default:
                    Console.Error.WriteLine($"unknown argument: {args[i]}");
                    Usage();
                    return null;
            }
        }

        return new ProbeOptions(acl, started, keep);
    }

    private static void Usage() => Console.WriteLine(
        """
        St4i settings-ACL probe — task M-1, the second instrument for docs/startup-failure-posture.md.

          --only acl        measure only the settings-root/settings-file access shapes (passes 1-3)
          --only started    measure only the ApplicationStarted-handler experiment (pass 4)
          --keep            leave the sandbox directory in place for inspection

        It creates its own temp sandbox, points FleetSettingsStore at it through ST4I_SETTINGS_DIR, and
        refuses — before any filesystem call — every path outside that sandbox. It never reads, writes,
        re-permissions or deletes anything under the real %ProgramData%\\ST4I.

        Exit code 0 when every ACL was restored and no path outside the sandbox was ever issued. A non-zero
        exit means the RUN is suspect, not that the product misbehaved: this is a probe, not a test, and
        every measurement it makes is printed either way.
        """);
}
