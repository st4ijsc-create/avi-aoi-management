using System.Text.Json;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Edge-local, JSON-file-backed store for the machine operating-configuration feature
/// (docs/MACHINE_CONFIG_DESIGN.md §2) — one <see cref="MachineOperatingConfig"/> per machine, holding
/// the 3-layer <c>baseline ⊕ machine-scoped adjustments ⊕ machine×product-scoped adjustments</c> model
/// and resolving them into an <see cref="EffectiveConfig"/> with per-parameter provenance.
///
/// Same shape as <see cref="ProductConfigStore"/> — single coarse lock, whole-file rewrite on every
/// mutation, atomic temp-file-then-rename persistence, deep-clone in/out so a caller mutating a returned
/// <see cref="MachineOperatingConfig"/> can never corrupt this store's live state — chosen for the same
/// reason: small in practice (a handful of machines, a handful of parameters each), so simplicity beats
/// fine-grained concurrency.
///
/// A machine's config is created lazily via <see cref="Ensure"/> (idempotent — first call seeds
/// <see cref="MachineOperatingConfig.Baseline"/> from <see cref="MachineParameterSchema"/>'s defaults,
/// version 1) or <see cref="PullBaseline"/> (also creates on first call). Every write
/// (<see cref="SetAdjustment"/>) is guardrail-checked via <see cref="MachineParameterSchema.ValidateRange"/>
/// BEFORE it is applied — an out-of-range value is rejected, never clamped, and the store never reaches
/// a persisted state with an out-of-range adjustment.
///
/// <para>🔴 <b>TASK H-1c — THIS STORE IS IN THE SECOND POPULATION, AND THAT IS THE FIRST THING TO KNOW
/// ABOUT ITS ROOT.</b> F-1 made every directory the product creates under
/// <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> relocatable by a derivable <c>ST4I_*_DIR</c> variable —
/// THIRTEEN of them — so two hosts on one machine can be given separate roots. <b>This store is not one
/// of the thirteen.</b> Its default is <see cref="AppContext.BaseDirectory"/>, beside the built binary,
/// and the product has exactly THREE such stores:</para>
/// <list type="bullet">
/// <item><see cref="MachineConfigStore"/> — <c>machine-operating-config.json</c> (this type).</item>
/// <item><see cref="ProductConfigStore"/> — <c>products.json</c> + <c>recipes.json</c>.</item>
/// <item><c>St4i.EngineApi.Config.SimulatedEcosystem</c> — <c>ecosystem/ecosystem-products.json</c> +
/// <c>ecosystem/ecosystem-recipes.json</c>. (Named as a string, not a <c>cref</c>: it lives in a
/// downstream assembly this one does not reference.)</item>
/// </list>
/// <para>🔴 <b>THE CONSEQUENCE FOR TWO HOSTS, AND IT IS ACCIDENTAL RATHER THAN GUARANTEED.</b> For the
/// thirteen machine-wide stores, isolation is a MECHANISM: set the variable, get your own root. For these
/// three it is a SIDE EFFECT of where the installer happened to put the exe. Two hosts installed into two
/// directories do not share these files — but that is an accident of layout, not a promise, and
/// <b>two hosts launched from ONE install directory share every one of them</b>. The same distinction
/// E-5 had to draw for COM ports: a resource that is separate today because nothing has asked it to be
/// shared is not an isolated resource.</para>
/// <para>🔴 <b>WHICH two hosts, measured — because the sentence above is broader than the measurement and
/// was left that way for two rounds (whole-branch review I-7).</b> All three stores are constructed in
/// exactly ONE place: <c>St4i.EngineApi/Program.cs</c>'s DI registrations. <c>St4i.EdgeService</c> and the
/// WPF shell construct none of them. So the sharing hazard is REAL for two <c>St4i.EngineApi</c> instances
/// installed into one directory, and VACUOUS for the <c>EngineApi</c> + <c>EdgeService</c> pair that
/// README §15.9 is actually written about. It is worth stating rather than deleting for the reason §15.9
/// exists at all: "only one host constructs it" is a property of today's call sites, and the second host
/// gaining one of these stores is precisely the change that would make it bite.</para>
/// <para><b>What H-1c changed and what it deliberately did not.</b> It added the seam —
/// <see cref="EnvVarDir"/> + <see cref="ResolveRoot"/>, the <c>explicit path &gt; environment variable
/// &gt; default</c> order F-1 established — so THIS store can at least be pointed somewhere on purpose.
/// It did NOT move the default: relocating a store's default is a deployment change and was out of scope.
/// The other two members of the population still have no seam at all. And note what the new variable is
/// NOT: it is not one of F-1's thirteen, it has no <c>%ProgramData%</c> directory behind it, and
/// <c>packaging/remove-data.ps1</c> — which purges <c>%ProgramData%</c> — cannot reach it. Relocating
/// this root puts data somewhere the decommissioning wipe does not look; README §15.9 says so where an
/// operator reads.</para>
///
/// <para>📎 <b>THE PARAGRAPH DIRECTLY ABOVE IS RETRACTED, 2026-08-23 (BF-1), and kept VERBATIM rather than
/// edited, in this file's own house style.</b> Every clause of it was true from H-1c until the owner's
/// ruling of 2026-08-23(a), and each is now false for the same single reason: the default moved.
/// <c>machine-config</c> IS a <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> leaf; <see cref="EnvVarDir"/> IS
/// one of the machine-wide variables (its name was already derivable from that leaf, which is why the
/// literal did not have to change); <c>packaging/remove-data.ps1</c> DOES reach it, through a
/// <c>-MachineConfigDir</c> parameter the same script's <c>.NOTES</c> used to argue against. What survives
/// unretracted is the sentence's last clause in a NEW form: relocating this root still puts data somewhere
/// the wipe does not look unless the operator passes the parameter, because this script reads only its own
/// shell's environment.</para>
///
/// <para>🔴 <b>And the two other members of the population no longer have "no seam at all" either</b> —
/// <see cref="ProductConfigStore.EnvVarDir"/> and <c>SimulatedEcosystem.EnvVarDir</c> were added by the same
/// ruling, because twenty <c>WebApplicationFactory</c> test classes resolve all three through the real DI
/// graph and a moved default without a seam would have had every suite writing into the REAL
/// <c>%ProgramData%</c>.</para>
/// </summary>
public sealed class MachineConfigStore
{
    /// <summary>🔴 H-1c — relocates this store, same <c>explicit &gt; env &gt; default</c> contract as
    /// <see cref="FleetSettingsStore.EnvVarDir"/> and <c>AssetRegistryStore.EnvVarDir</c>.
    ///
    /// <para><b>Read this class's own remarks before treating it as a fourteenth sibling of those.</b> It
    /// is deliberately NOT derivable from a <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> directory name,
    /// because this store has no such directory: the default is beside the binary. <c>PerHostDataRootsTests</c>
    /// partitions the <c>ST4I_*_DIR</c> population on exactly that property, so a reader who finds
    /// FOURTEEN variables and THIRTEEN machine-wide directories is looking at two populations rather than
    /// at an off-by-one.</para>
    ///
    /// <para>📎 <b>THE PARAGRAPH ABOVE IS RETRACTED, 2026-08-23 (BF-1), verbatim.</b> The literal is
    /// unchanged and always was derivable — <c>machine-config</c> → <c>ST4I_MACHINE_CONFIG_DIR</c> — but
    /// there was no such directory for it to be derivable FROM until the owner's 2026-08-23(a) ruling created
    /// one. There are now SIXTEEN machine-wide directories and SIXTEEN <c>ST4I_*_DIR</c> variables, the
    /// beside-the-binary variable population is EMPTY, and the two-populations reading this paragraph taught
    /// is the thing to unlearn. 🔴 The emptiness is asserted rather than assumed, because an empty set
    /// satisfies every universal claim made about it: <c>PerHostDataRootsTests</c> pins the partition's
    /// second half at exactly zero members, so a store rejoining that population reddens rather than
    /// vanishes.</para></summary>
    public const string EnvVarDir = "ST4I_MACHINE_CONFIG_DIR";

    private const string FileName = "machine-operating-config.json";

    private static readonly JsonSerializerOptions PersistenceOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
    };

    private readonly object _gate = new();
    private readonly Dictionary<string, MachineOperatingConfig> _configs = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Directory holding <c>machine-operating-config.json</c>.</summary>
    public string RootDirectory { get; }

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (<see cref="EnvVarDir"/>, then <see cref="DefaultRoot"/>). Tests pass
    /// a temp directory so runs don't share state.</param>
    public MachineConfigStore(string? directory = null)
    {
        RootDirectory = ResolveRoot(directory);
        Directory.CreateDirectory(RootDirectory);

        // 🔴 Gated on the resolved root BEING the machine-wide default — see ProductConfigStore's ctor for
        // why that equality is preferred to a provenance flag. This store's constructor does not otherwise
        // write, and the copy does not change that for any root but the default one.
        if (string.Equals(RootDirectory, DefaultRoot(), StringComparison.OrdinalIgnoreCase))
        {
            LegacyRootMigration.CopyOnce(LegacyRoot(), RootDirectory, [FileName], "machineconfigstore");
        }

        Load();
    }

    /// <summary>🔴 <b>The machine-config root — <c>%ProgramData%\ST4I\sim\machine-config</c> — as of the
    /// owner's ruling of 2026-08-23(a).</b>
    ///
    /// <para><b>What that ruling reversed, kept here rather than deleted because the reasoning was sound and
    /// only the decision changed.</b> H-1c added this store's seam and deliberately did NOT move the default,
    /// on the ground that moving it relocates live customer data on the next start and is a deployment
    /// decision rather than a seam. That reading was correct; the owner took the deployment decision on
    /// 2026-08-23, having been told that an existing install stops seeing its data at the old root, and
    /// <see cref="LegacyRootMigration"/> is the mitigation that came with it — a one-time COPY that deletes
    /// nothing.</para>
    ///
    /// <para><b>And it is why this store stopped being a second-population member.</b> <c>machine-config</c>
    /// is now a <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> leaf whose relocation variable is derivable from
    /// its own directory name, so <see cref="EnvVarDir"/> — unchanged since H-1c — is now one of the
    /// MACHINE-WIDE variables rather than the sole exception to that pairing.</para></summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "ST4I", "sim", "machine-config");

    /// <summary>The root an install written before the owner's 2026-08-23(a) ruling used —
    /// <see cref="AppContext.BaseDirectory"/> — and the source of the one-time copy.</summary>
    public static string LegacyRoot() => AppContext.BaseDirectory;

    /// <summary>Resolves the effective machine-config directory: <paramref name="directory"/> if given,
    /// else <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does
    /// not create anything on disk (the ctor does that). Byte-identical behaviour to the pre-H-1c
    /// constructor whenever <c>ST4I_MACHINE_CONFIG_DIR</c> is unset, which is every existing deployment
    /// and every existing test.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Ensure / read
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Returns this machine's config, creating it (baseline seeded from
    /// <see cref="MachineParameterSchema.ParametersFor"/>'s defaults, version 1, no adjustments) if this
    /// is the first time it's been seen. Idempotent — a machine already configured with a DIFFERENT
    /// <paramref name="configKind"/> throws <see cref="InvalidOperationException"/> rather than silently
    /// reinterpreting its stored adjustments under a new parameter vocabulary.
    ///
    /// <para>🔴 <b>ITEM 75, BR-1, 2026-08-24 — THE SEED IS NOT COMMITTED IN MEMORY UNTIL IT IS ON DISK.</b>
    /// All six <c>Save()</c> call sites in this class mutate first and persist second, so a throw out of
    /// <c>Save()</c> leaves memory ahead of the file in all six. FOUR of them are LOUD on every subsequent
    /// attempt — the caller repeats the operation and reaches <c>Save()</c> again. This one is not: its
    /// idempotency guard is <c>_configs.TryGetValue</c>, computed from the very map the failed attempt
    /// already mutated, so the SECOND call takes the fast path, returns 200, and never writes. The method
    /// whose whole contract is "safe to call repeatedly" was the one that could not repair itself.</para>
    ///
    /// <para>🔴 <b>"FOUR", NOT FIVE — and the correction is recorded because the first draft of this very
    /// paragraph got it wrong and the doc-absolutes scanner is what surfaced the sentence for re-reading.</b>
    /// <see cref="RemoveAdjustment"/> is a SECOND member of this shape, by the identical mechanism: its
    /// <c>removed</c> flag is decided by a lookup in the map its own failed attempt already mutated, so a
    /// retry after a throwing <c>Save()</c> finds nothing left to remove, skips the write entirely, and hands
    /// the caller a 200 for a delete the file never received — and the adjustment returns at the next process
    /// restart, when <c>Load()</c> reads the row that was never deleted. <b>NAMED, NOT CHANGED, and the
    /// reason is a measurement rather than a schedule:</b> undoing it means restoring the removed entry,
    /// possibly re-creating a product bucket that was dropped when it emptied, AND unwinding an appended
    /// history row — three restorations where this method needs one, with no witness in this tree for any of
    /// them. A half-rollback there would be a worse defect than the one it replaced. See
    /// <c>docs/owner-decisions.md</c> item 75.</para>
    ///
    /// <para><b>The observable that made it visible, and what it actually was:</b> the first
    /// <c>POST /v1/fleet/start</c> on a cold process returned 500 (this <c>Save()</c> throwing
    /// <see cref="UnauthorizedAccessException"/> out of the atomic rename) and every later one returned 200.
    /// That is not a machine being cold and it is not a race — "cold" here is this dictionary being EMPTY,
    /// which is true exactly once per process per machine code. The fleet then ran for the life of the
    /// process on a configuration that exists only in RAM and disappears at the next restart, with nobody
    /// told.</para>
    ///
    /// <para><b>The price, stated because it is real:</b> a deployment whose config root genuinely cannot be
    /// written now fails EVERY start instead of only the first. That is louder and it is the point — the
    /// alternative on offer was a fleet running on a config no file holds. 📎 The other five sites are named
    /// rather than changed: they are already loud every time, and rolling them back is a larger change with
    /// its own history semantics (a retried <c>SetAdjustment</c> appends a second history entry) that no
    /// measurement here covers.</para></summary>
    public MachineOperatingConfig Ensure(string machineCode, string configKind)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(configKind);

        lock (_gate)
        {
            if (_configs.TryGetValue(machineCode, out var existing))
            {
                if (!string.Equals(existing.ConfigKind, configKind, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        $"Machine \"{machineCode}\" is already configured as \"{existing.ConfigKind}\" — cannot re-ensure as \"{configKind}\".");
                }

                return DeepClone(existing);
            }

            var created = SeedConfig(machineCode, configKind);
            _configs[machineCode] = created;

            try
            {
                Save();
            }
            catch
            {
                // Item 75. The entry is removed, not left behind: keeping it turns one loud failure into a
                // silent, permanent divergence between this map and the file, because the guard above would
                // then answer "already configured" forever. Only THIS call's own seed is undone — the map is
                // otherwise untouched, so a failure here cannot lose an entry some earlier successful call
                // put there.
                _configs.Remove(machineCode);
                throw;
            }

            return DeepClone(created);
        }
    }

    /// <summary>🔴 <b>OWNER ITEM 49, SECOND CLAUSE — owner's ruling of 2026-08-25 (<i>"narrow the fix,
    /// delete the record"</i>). THIS METHOD DELETES OPERATOR-AUTHORED BYTES, and everything about its shape
    /// is chosen to keep that deletion as small and as loud as it can be made.</b>
    ///
    /// <para><b>What it removes:</b> exactly ONE dictionary entry — the record filed under
    /// <paramref name="machineCode"/> — and only when that record's <see cref="MachineOperatingConfig.ConfigKind"/>
    /// is <paramref name="supersededKind"/>. It then rewrites <c>machine-operating-config.json</c> through the
    /// same <see cref="Save"/> every other mutation uses. <b>It never touches a directory, never matches a file
    /// name against a pattern, and cannot reach another machine's record</b>: the only key it can remove is the
    /// one it was handed, and the only value it will accept is the one kind it was told to supersede. Every
    /// other machine's baseline, adjustments and history are re-serialised byte-for-byte by the same
    /// <see cref="Save"/> that already runs on every ordinary write.</para>
    ///
    /// <para>🔴 <b>Why a deletion at all, and why the alternative was refused.</b> A machine whose type now
    /// resolves to a different simulator class carries a record seeded under the OLD parameter vocabulary, and
    /// <see cref="Ensure"/> refuses to re-ensure it under the new one — it throws, so that machine cannot start.
    /// The two repairs on offer were <i>delete the stored record</i> and <i>teach <see cref="Ensure"/> to re-key
    /// one</i>. The owner took the first on 2026-08-25. Re-keying was NOT taken and is not implemented here: it
    /// would have to decide what an operator's <c>torqueTarget</c> adjustment means under a vocabulary that has
    /// no such parameter, and there is no answer to that which is not an invention.</para>
    ///
    /// <para>🔴 <b>Why it is not silent, and why <paramref name="report"/> is not optional.</b> This file has a
    /// history of exactly this failure mode: item 45 exists because a constructor overwrote the one file the
    /// decommissioning wipe deliberately KEEPS, and item 64 because a removal left no trace. A caller that
    /// could pass <see langword="null"/> here would be able to delete an operator's record silently, so the
    /// parameter is non-nullable and the message is composed from the record's own contents BEFORE it is
    /// dropped — counts of adjustments and history rows cannot be recovered afterwards. 📌 The callback is
    /// invoked AFTER <see cref="Save"/> returns and OUTSIDE <see cref="_gate"/>: it reports bytes that are
    /// already gone rather than bytes that are about to go, and a slow or throwing sink cannot be holding this
    /// store's lock while it does.</para>
    ///
    /// <para><b>Failure leaves nothing removed.</b> A throw out of <see cref="Save"/> puts the entry back
    /// before rethrowing — the same item-75 discipline <see cref="Ensure"/> follows in the opposite direction,
    /// and for the same reason: this map and that file must not disagree, because the guard that decides
    /// whether a record exists is computed from the map.</para></summary>
    /// <param name="machineCode">The ONE machine whose record may be dropped. No other key is read or written.</param>
    /// <param name="supersededKind">The kind the stored record must already carry for the drop to happen. A
    /// record under any other kind is left exactly as it is and <see langword="false"/> is returned — so a
    /// caller that has mis-identified the transition removes nothing.</param>
    /// <param name="replacementKind">The kind the caller is about to <see cref="Ensure"/>. Used only to
    /// refuse a no-op (equal kinds drop nothing, because there is nothing blocking) and to say in the report
    /// what the record is being cleared FOR.</param>
    /// <param name="report">Where the completed deletion is announced. Required — see the remarks. Receives one
    /// line naming the machine, the kind, how much was in the record, and why it went.</param>
    /// <returns><see langword="true"/> when a record was removed and persisted; <see langword="false"/> when
    /// there was nothing to remove (no record, a record under a different kind, or equal kinds).</returns>
    public bool DropSupersededRecord(
        string machineCode, string supersededKind, string replacementKind, Action<string> report)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(supersededKind);
        ArgumentException.ThrowIfNullOrEmpty(replacementKind);
        ArgumentNullException.ThrowIfNull(report);

        if (string.Equals(supersededKind, replacementKind, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        string message;
        lock (_gate)
        {
            if (!_configs.TryGetValue(machineCode, out var existing) ||
                !string.Equals(existing.ConfigKind, supersededKind, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            message =
                $"[machineconfigstore] DELETED the persisted \"{existing.ConfigKind}\" operating-config record of " +
                $"machine \"{existing.MachineCode}\" from \"{Path.Combine(RootDirectory, FileName)}\" " +
                $"(baseline version {existing.Baseline.Version}, {existing.MachineAdjustments.Count} machine-scoped adjustment(s), " +
                $"{existing.ProductAdjustments.Count} product bucket(s), {existing.History.Count} history row(s)). " +
                $"REASON: this machine now resolves to a simulator whose configuration kind is " +
                $"\"{replacementKind}\", and Ensure refuses to re-key one record across two vocabularies, so " +
                "the machine could not start until the old record went. Owner ruling 2026-08-25, " +
                "docs/owner-decisions.md item 49. Those bytes are gone and this store cannot restore them; " +
                "no other machine's record was read or written.";

            _configs.Remove(machineCode);

            try
            {
                Save();
            }
            catch
            {
                _configs[machineCode] = existing;
                throw;
            }
        }

        report(message);
        return true;
    }

    /// <summary>This machine's config, or null if <see cref="Ensure"/>/<see cref="PullBaseline"/> has
    /// never been called for it. A deep clone.</summary>
    public MachineOperatingConfig? GetConfig(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            return _configs.TryGetValue(machineCode, out var cfg) ? DeepClone(cfg) : null;
        }
    }

    private static MachineOperatingConfig SeedConfig(string machineCode, string configKind)
    {
        var defs = MachineParameterSchema.ParametersFor(configKind);
        var values = defs.ToDictionary(d => d.Key, d => d.Default, StringComparer.OrdinalIgnoreCase);

        return new MachineOperatingConfig
        {
            MachineCode = machineCode,
            ConfigKind = configKind,
            Baseline = new BaselineSnapshot
            {
                Version = 1,
                Values = values,
                Checksum = ConfigChecksum.Compute(values),
                PulledAt = DateTimeOffset.UtcNow,
            },
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Resolve — baseline ⊕ machine ⊕ machine×product, with provenance
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Resolves this machine's effective configuration for <paramref name="productCode"/> (pass
    /// null for a machine that runs no single product right now, or for any machine whose
    /// <c>configKind</c> doesn't support the product layer at all — see
    /// <see cref="MachineParameterSchema.SupportsProductScope"/>). Resolution order per
    /// docs/MACHINE_CONFIG_DESIGN.md §2: baseline, then overwritten by a machine-scoped adjustment if one
    /// exists for that key, then overwritten AGAIN by a machine×product-scoped adjustment if one exists.
    /// A <paramref name="productCode"/> is silently ignored (never throws) for a machine whose
    /// <c>configKind</c> has no product dimension — <see cref="EffectiveConfig.ProductCode"/> comes back
    /// null either way, so "IoT has no product dimension" is enforced by the resolver itself, not left to
    /// every caller to remember.</summary>
    public EffectiveConfig Resolve(string machineCode, string? productCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            var defs = MachineParameterSchema.ParametersFor(cfg.ConfigKind);
            var scopedProductCode = MachineParameterSchema.SupportsProductScope(cfg.ConfigKind) ? productCode : null;

            var parameters = new List<EffectiveParameter>(defs.Count);
            foreach (var def in defs)
            {
                var baselineValue = cfg.Baseline.Values.TryGetValue(def.Key, out var bv) ? bv : def.Default;
                var value = baselineValue;
                var source = ConfigProvenance.Baseline;

                cfg.MachineAdjustments.TryGetValue(def.Key, out var machineAdj);
                if (machineAdj is not null)
                {
                    value = machineAdj.Value;
                    source = ConfigProvenance.Machine;
                }

                ParameterAdjustment? productAdj = null;
                if (!string.IsNullOrEmpty(scopedProductCode) &&
                    cfg.ProductAdjustments.TryGetValue(scopedProductCode, out var byKey) &&
                    byKey.TryGetValue(def.Key, out productAdj))
                {
                    value = productAdj!.Value;
                    source = ConfigProvenance.MachineProduct;
                }

                parameters.Add(new EffectiveParameter(def, value, source, baselineValue, machineAdj, productAdj));
            }

            return new EffectiveConfig(machineCode, scopedProductCode, cfg.ConfigKind, parameters);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Write — hard-guardrailed, scoped adjustments
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Sets (creates or replaces) one adjustment. Guardrail-checked against
    /// <see cref="MachineParameterSchema.ValidateRange"/> BEFORE anything is mutated — an out-of-range
    /// <paramref name="value"/> throws <see cref="ArgumentOutOfRangeException"/> (message names the
    /// allowed range) and leaves the store untouched. Throws <see cref="KeyNotFoundException"/> for an
    /// unknown <paramref name="key"/>, <see cref="InvalidOperationException"/> for a product-scoped write
    /// on a <c>configKind</c> with no product dimension, and <see cref="ArgumentException"/> for a
    /// product-scoped write with no <paramref name="productCode"/>.</summary>
    public MachineOperatingConfig SetAdjustment(
        string machineCode, string key, double value, AdjustmentScope scope,
        string? productCode, string? by, string? note)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(key);

        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            var def = MachineParameterSchema.ParameterFor(cfg.ConfigKind, key)
                ?? throw new KeyNotFoundException($"\"{key}\" is not a known parameter for config kind \"{cfg.ConfigKind}\".");

            MachineParameterSchema.ValidateRange(def, value);

            var adjustment = new ParameterAdjustment { Value = value, By = by, At = DateTimeOffset.UtcNow, Note = note };
            double? oldValue;

            if (scope == AdjustmentScope.Machine)
            {
                oldValue = cfg.MachineAdjustments.TryGetValue(key, out var existing) ? existing.Value : null;
                cfg.MachineAdjustments[key] = adjustment;
            }
            else
            {
                if (!MachineParameterSchema.SupportsProductScope(cfg.ConfigKind))
                {
                    throw new InvalidOperationException(
                        $"Machine \"{machineCode}\" (config kind \"{cfg.ConfigKind}\") has no product dimension — product-scoped adjustments are not supported.");
                }

                if (string.IsNullOrWhiteSpace(productCode))
                {
                    throw new ArgumentException("productCode is required for a product-scoped adjustment.", nameof(productCode));
                }

                if (!cfg.ProductAdjustments.TryGetValue(productCode, out var byKey))
                {
                    byKey = new Dictionary<string, ParameterAdjustment>(StringComparer.OrdinalIgnoreCase);
                    cfg.ProductAdjustments[productCode] = byKey;
                }

                oldValue = byKey.TryGetValue(key, out var existingProduct) ? existingProduct.Value : null;
                byKey[key] = adjustment;
            }

            AppendHistoryLocked(cfg, "set", key, scope, scope == AdjustmentScope.Product ? productCode : null, by, note, oldValue, value,
                BuildSetSummary(key, value, def.Unit, scope, productCode));

            Save();
            return DeepClone(cfg);
        }
    }

    /// <summary>Removes one adjustment, falling that key back to the layer below (product-scoped falls
    /// to machine-scoped or baseline; machine-scoped falls to baseline) — docs/MACHINE_CONFIG_DESIGN.md
    /// §5's "nút về mặc định". A no-op (still returns the current config, no history entry, no save) if
    /// nothing was actually set at that scope. Throws <see cref="KeyNotFoundException"/> if the machine
    /// has no config yet.</summary>
    public MachineOperatingConfig RemoveAdjustment(string machineCode, string key, AdjustmentScope scope, string? productCode, string? by)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(key);

        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            var removed = false;
            double? oldValue = null;

            if (scope == AdjustmentScope.Machine)
            {
                if (cfg.MachineAdjustments.TryGetValue(key, out var existing))
                {
                    oldValue = existing.Value;
                    cfg.MachineAdjustments.Remove(key);
                    removed = true;
                }
            }
            else if (!string.IsNullOrWhiteSpace(productCode) &&
                     cfg.ProductAdjustments.TryGetValue(productCode, out var byKey) &&
                     byKey.TryGetValue(key, out var existingProduct))
            {
                oldValue = existingProduct.Value;
                byKey.Remove(key);
                if (byKey.Count == 0) cfg.ProductAdjustments.Remove(productCode);
                removed = true;
            }

            if (removed)
            {
                AppendHistoryLocked(cfg, "delete", key, scope, scope == AdjustmentScope.Product ? productCode : null, by, null, oldValue, null,
                    $"{key} reset to the layer below ({DescribeScope(scope, productCode)}).");
                Save();
            }

            return DeepClone(cfg);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Baseline pull — never discards adjustments
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Refreshes <see cref="MachineOperatingConfig.Baseline"/> — creating the machine's config
    /// on first call (a "first install", version 1) or replacing the whole baseline snapshot and bumping
    /// <see cref="BaselineSnapshot.Version"/> on a later call. <see cref="MachineOperatingConfig.MachineAdjustments"/>/
    /// <see cref="MachineOperatingConfig.ProductAdjustments"/> are NEVER touched here — this is the
    /// docs/MACHINE_CONFIG_DESIGN.md §2 guarantee ("kéo baseline mới không xóa điều chỉnh tại máy") this
    /// whole layered design exists to make possible. <paramref name="newValues"/> lets a real backend
    /// (a later task) hand in server-fetched numbers; when null/empty, the schema's own defaults are used
    /// (this task has no live server yet — see docs/plans/2026-07-21-machine-config.md Task 6/7). Any key
    /// present in <paramref name="newValues"/> but not in the schema is ignored; any schema key absent
    /// from <paramref name="newValues"/> falls back to that parameter's own default.</summary>
    public MachineOperatingConfig PullBaseline(string machineCode, string configKind, IReadOnlyDictionary<string, double>? newValues, string? by)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(configKind);

        lock (_gate)
        {
            if (!_configs.TryGetValue(machineCode, out var cfg))
            {
                cfg = SeedConfig(machineCode, configKind);
                if (newValues is { Count: > 0 })
                {
                    var (values, rejected) = BuildValidatedBaselineValues(configKind, newValues);
                    cfg.Baseline.Values = values;
                    cfg.Baseline.OutOfRangeRejected = rejected;
                    cfg.Baseline.Checksum = ConfigChecksum.Compute(cfg.Baseline.Values);
                }

                _configs[machineCode] = cfg;
                AppendHistoryLocked(cfg, "pull", null, null, null, by, null, null, null,
                    BuildPullSummary($"Initial baseline pulled (v{cfg.Baseline.Version}).", cfg.Baseline.OutOfRangeRejected));
                Save();
                return DeepClone(cfg);
            }

            if (!string.Equals(cfg.ConfigKind, configKind, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"Machine \"{machineCode}\" is configured as \"{cfg.ConfigKind}\" — cannot pull a \"{configKind}\" baseline onto it.");
            }

            Dictionary<string, double> refreshedValues;
            Dictionary<string, double> refreshedRejected;
            if (newValues is { Count: > 0 })
            {
                (refreshedValues, refreshedRejected) = BuildValidatedBaselineValues(configKind, newValues);
            }
            else
            {
                var schemaDefs = MachineParameterSchema.ParametersFor(configKind);
                refreshedValues = schemaDefs.ToDictionary(d => d.Key, d => d.Default, StringComparer.OrdinalIgnoreCase);
                refreshedRejected = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
            }

            cfg.Baseline = new BaselineSnapshot
            {
                Version = cfg.Baseline.Version + 1,
                Values = refreshedValues,
                OutOfRangeRejected = refreshedRejected,
                Checksum = ConfigChecksum.Compute(refreshedValues),
                PulledAt = DateTimeOffset.UtcNow,
            };

            AppendHistoryLocked(cfg, "pull", null, null, null, by, null, null, null,
                BuildPullSummary($"Baseline refreshed to v{cfg.Baseline.Version}.", refreshedRejected));
            Save();
            return DeepClone(cfg);
        }
    }

    /// <summary>I-2 (mc-feature-review.md) — <see cref="PullBaseline"/> used to write server-fetched
    /// <paramref name="newValues"/> straight into <see cref="BaselineSnapshot.Values"/> with NO range
    /// check at all (unlike <see cref="SetAdjustment"/>, which always validates an operator edit via
    /// <see cref="MachineParameterSchema.ValidateRange"/> first) — an out-of-range server recipe (e.g.
    /// <c>torqueTarget=50</c> against the schema's own hard 0.10–20.00 range) became the effective value a
    /// simulator actually runs on, shown to an operator as a normal "recommended" value. This validates
    /// each incoming value the same way an operator edit already is: in-range values pass through
    /// unchanged; an out-of-range value falls back to that parameter's schema DEFAULT (never clamped to
    /// the nearest bound, never the raw out-of-range number — the machine must never silently run on a
    /// value outside its own declared hard range) and is recorded in the returned <c>rejected</c> map so
    /// the caller can flag it as a distinct state rather than a normal recommendation (see
    /// <see cref="BaselineSnapshot.OutOfRangeRejected"/>'s doc comment). A key present in the schema but
    /// absent from <paramref name="newValues"/> still falls back to its default, exactly as before — this
    /// only changes behaviour for a key that WAS supplied but fell outside its own range.</summary>
    private static (Dictionary<string, double> Values, Dictionary<string, double> Rejected) BuildValidatedBaselineValues(
        string configKind, IReadOnlyDictionary<string, double> newValues)
    {
        var defs = MachineParameterSchema.ParametersFor(configKind);
        var values = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        var rejected = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);

        foreach (var def in defs)
        {
            if (!newValues.TryGetValue(def.Key, out var incoming))
            {
                values[def.Key] = def.Default;
                continue;
            }

            try
            {
                MachineParameterSchema.ValidateRange(def, incoming);
                values[def.Key] = incoming;
            }
            catch (ArgumentOutOfRangeException)
            {
                values[def.Key] = def.Default;
                rejected[def.Key] = incoming;
            }
        }

        return (values, rejected);
    }

    private static string BuildPullSummary(string baseSummary, IReadOnlyDictionary<string, double> rejected) =>
        rejected.Count == 0
            ? baseSummary
            : baseSummary + $" {rejected.Count} value(s) outside the parameter's own hard range were REJECTED and fell back to schema defaults: " +
              string.Join(", ", rejected.Select(kv => $"{kv.Key}={kv.Value}")) + ".";

    // ─────────────────────────────────────────────────────────────────────
    // Push (report actual config) — history only, never mutates baseline or adjustments
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Records a history entry for a "reported actual configuration to the server" event
    /// (docs/MACHINE_CONFIG_DESIGN.md §2: "Đẩy lên server = báo cáo cấu hình THỰC TẾ của máy này, KHÔNG
    /// phải ghi đè baseline chung"). Deliberately does NOT touch <see cref="MachineOperatingConfig.Baseline"/>
    /// or either adjustment map — a push is pure reporting, the caller (<c>St4i.EngineApi</c>'s settings
    /// endpoints, Task 2) has already computed what to report via <see cref="Resolve"/>.</summary>
    public MachineOperatingConfig RecordPush(string machineCode, string? productCode, string? by, string summary)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            AppendHistoryLocked(cfg, "push", null, null, productCode, by, null, null, null, summary);
            Save();
            return DeepClone(cfg);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Checksum + history
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Stable, key-order-independent checksum of THIS machine's adjustments (both scopes) via
    /// <see cref="ConfigChecksum.Compute(object?)"/> — deliberately over adjustment VALUES only (not the
    /// by/at/note audit metadata), so re-saving the identical value under a different note/timestamp
    /// doesn't change the checksum. This is the drift/content key a settings-response or a push report
    /// surfaces (Task 2).</summary>
    public string ComputeAdjustmentsChecksum(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        lock (_gate)
        {
            var cfg = RequireConfigLocked(machineCode);
            return ComputeAdjustmentsChecksumLocked(cfg);
        }
    }

    private static string ComputeAdjustmentsChecksumLocked(MachineOperatingConfig cfg)
    {
        var canonical = new Dictionary<string, object?>
        {
            ["machine"] = cfg.MachineAdjustments.ToDictionary(kv => kv.Key, kv => (object?)kv.Value.Value, StringComparer.OrdinalIgnoreCase),
            ["product"] = cfg.ProductAdjustments.ToDictionary(
                kv => kv.Key,
                kv => (object?)kv.Value.ToDictionary(k2 => k2.Key, k2 => (object?)k2.Value.Value, StringComparer.OrdinalIgnoreCase),
                StringComparer.OrdinalIgnoreCase),
        };
        return ConfigChecksum.Compute(canonical);
    }

    /// <summary>This machine's full audit trail, newest first. Empty (not an error) for a machine with no
    /// config yet.</summary>
    public IReadOnlyList<MachineConfigHistoryEntry> History(string machineCode)
    {
        var cfg = GetConfig(machineCode);
        return cfg is null
            ? Array.Empty<MachineConfigHistoryEntry>()
            : cfg.History.OrderByDescending(h => h.Seq).ToList();
    }

    private static void AppendHistoryLocked(
        MachineOperatingConfig cfg, string op, string? key, AdjustmentScope? scope, string? productCode,
        string? by, string? note, double? oldValue, double? newValue, string summary)
    {
        var seq = cfg.History.Count == 0 ? 1L : cfg.History.Max(h => h.Seq) + 1;
        cfg.History.Add(new MachineConfigHistoryEntry
        {
            Seq = seq,
            At = DateTimeOffset.UtcNow,
            Op = op,
            Key = key,
            Scope = scope,
            ProductCode = productCode,
            By = by,
            Note = note,
            OldValue = oldValue,
            NewValue = newValue,
            Summary = summary,
        });
    }

    private static string BuildSetSummary(string key, double value, string unit, AdjustmentScope scope, string? productCode) =>
        $"{key} set to {value} {unit} ({DescribeScope(scope, productCode)}).";

    private static string DescribeScope(AdjustmentScope scope, string? productCode) =>
        scope == AdjustmentScope.Machine ? "machine-scoped" : $"product-scoped/{productCode}";

    // ─────────────────────────────────────────────────────────────────────
    // Persistence
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Discards all in-memory state and re-reads <c>machine-operating-config.json</c> from
    /// <see cref="RootDirectory"/> — the mechanism <c>MachineConfigStoreTests</c>'s
    /// restart-survival test uses (a fresh instance pointed at the same directory is the more realistic
    /// "process restarted" case; this method is the in-process equivalent).</summary>
    public void Reload()
    {
        lock (_gate)
        {
            _configs.Clear();
            Load();
        }
    }

    private void Load()
    {
        var path = Path.Combine(RootDirectory, FileName);
        if (!File.Exists(path)) return;

        var loaded = JsonSerializer.Deserialize<List<MachineOperatingConfig>>(File.ReadAllText(path), PersistenceOptions) ?? new();
        foreach (var cfg in loaded) _configs[cfg.MachineCode] = cfg;
    }

    /// <summary>Always called with <see cref="_gate"/> already held.</summary>
    private void Save()
    {
        var path = Path.Combine(RootDirectory, FileName);
        var json = JsonSerializer.Serialize(
            _configs.Values.OrderBy(c => c.MachineCode, StringComparer.OrdinalIgnoreCase).ToList(), PersistenceOptions);
        WriteAllTextAtomic(path, json);
    }

    /// <summary>Same crash-safety rationale as <see cref="ProductConfigStore"/>'s own copy of this method
    /// — writes to a temp file in the same directory then atomically renames over the real target, so
    /// <paramref name="path"/> is always either the complete old content or the complete new content,
    /// never a partial write.</summary>
    private static void WriteAllTextAtomic(string path, string content)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }

    private static T DeepClone<T>(T value) =>
        JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(value, PersistenceOptions), PersistenceOptions)!;

    private MachineOperatingConfig RequireConfigLocked(string machineCode)
    {
        if (!_configs.TryGetValue(machineCode, out var cfg))
        {
            throw new KeyNotFoundException(
                $"Machine \"{machineCode}\" has no operating configuration yet (call Ensure/pull first).");
        }

        return cfg;
    }
}
