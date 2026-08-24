using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Fleet;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the
/// connector-id-keyed registry that replaces <c>FleetHost</c>'s old per-driver-kind hardcoding: one
/// dedicated optional constructor parameter (<c>Func&lt;IDeviceDriver&gt;? modbusDriverFactory</c>,
/// <c>OpcUaDriverFactory? opcUaDriverFactory</c>) and one copy-pasted <c>FleetCore.StartLocked</c>
/// block per driver kind. Onboarding a new connector kind used to mean editing three files (FleetHost's
/// ctor, StartLocked, and Program.cs's wiring); with this registry it means calling <see cref="Register"/>
/// once, with no <c>FleetHost</c> change at all — <c>FleetHost</c> only ever asks this
/// registry "what connector ids are configured" and "build me a driver for this one."
///
/// <para>🔴 <b>Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §9.1) — this file
/// MOVED from <c>St4i.EngineApi/Fleet/</c> to <c>St4i.EdgeCore/Fleet/</c>, and the paragraph that used to
/// stand here (<i>"Why this lives in St4i.EngineApi, not St4i.EdgeCore"</i>) is reversed rather than
/// deleted, because its own closing sentence is what made the move cheap.</b> That paragraph argued the
/// registry was a host COMPOSITION-ROOT concept with exactly one real consumer (<c>FleetHost</c>), so
/// putting it in EdgeCore would be speculative generality — and then wrote: <i>"Should a future host need
/// the same registry shape, moving it is a one-file relocation with no design change — this class has zero
/// dependency on anything EngineApi-specific precisely so that move stays cheap."</i> Đợt E is that future:
/// <c>St4i.EdgeService</c> is the process that owns the RS-485 port, the N-driver lifecycle core
/// (<see cref="FleetCore"/>) moved down to be reachable from it, and <see cref="FleetCore.StartLocked"/>
/// builds one pipeline slot per registered instance from this registry while
/// <see cref="FleetCore.ResolveWritableDriver"/> routes every write off its bindings. A lifecycle core that
/// cannot see this type is not a lifecycle core (blueprint §9.1/§9.6(b): it is read at FOUR sites, not two).
/// The relocation was indeed one file, zero design change, and zero new dependencies — this class still
/// references only <c>St4i.Connector.Abstractions</c>.</para>
///
/// <para><b>Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — this registry
/// is keyed by CONNECTOR INSTANCE, not by protocol kind.</b> Until D-1 the key WAS
/// <see cref="IConnectorFactory.Kind"/>, which meant this build could run exactly ONE Modbus connector and
/// ONE OPC-UA connector system-wide: a second <see cref="Register"/> for the same kind silently replaced the
/// first. That is the structural reason RS-485 multidrop (N logical devices, N slave addresses, N machines,
/// one bus) could not be expressed at all, and it is the reason Đợt B had to add
/// <see cref="MachineDriverAvailability.AmbiguousDriver"/>: several roster machines resolved to one slot and
/// nothing could tell which physical device the single live driver was talking to.</para>
///
/// <para>An INSTANCE ID is now the key. It is a free-form, operator-meaningful string, independent of the
/// protocol <see cref="Entry.Kind"/> the instance speaks. <see cref="Register"/>'s <c>instanceId</c>
/// parameter is OPTIONAL and defaults to the factory's own normalized <see cref="IConnectorFactory.Kind"/> —
/// which is EXACTLY the key this class used before D-1, so every pre-existing call site, every
/// pre-existing slot label, and every migrated <c>St4i.EngineApi.Fleet.ConnectorConfigStore</c> row behaves byte-for-byte
/// as it did (see that store's migration v4 for the on-disk half of the same decision). "One Modbus
/// connector" is now a special case of "N Modbus connectors", not a law of the type system.</para>
///
/// <para><b>The machine binding is what makes routing possible — and what makes
/// <see cref="MachineDriverAvailability.AmbiguousDriver"/> unreachable.</b> An instance MAY declare the
/// machine code it serves (<see cref="Register"/>'s <c>machineCode</c>). Every production registration path
/// does (they all start from a parsed register/node map, which carries <c>machineCode</c> as a required
/// field — see <c>St4i.EngineApi.Fleet.ConnectorConfigValidation</c>). A registration whose machine code is ALREADY
/// claimed by a DIFFERENT instance is REFUSED (<see cref="Register"/> returns <see langword="false"/> and
/// mutates nothing) — that refusal is the structural uniqueness gate <c>FleetCore.ResolveWritableDriver</c>
/// relies on: because at most one instance can ever claim a given machine code, a machine that IS claimed
/// resolves to exactly one identifiable driver, and a write can never be handed to a sibling's device.
/// An UNBOUND instance (<c>machineCode</c> null — only reachable from test code and from a third-party
/// registration path that has no parsed map to read a code from) claims nothing and leaves
/// <c>FleetHost</c>'s pre-D-1, kind-based resolution rule in force for every machine, including its
/// <see cref="MachineDriverAvailability.AmbiguousDriver"/> guard.</para>
///
/// <para><b>Why one machine code per instance, and why that does not preclude multidrop.</b> D-4's multidrop
/// is N driver instances sharing one physical bus, each at its own slave address, each its own machine — so
/// N instances × 1 machine each, which this shape expresses directly: the instance id is independent of the
/// protocol AND of the transport, so two RTU instances naming the same COM port are just two ordinary
/// entries here. What this shape does NOT express is the inverse (ONE instance serving N machine codes), and
/// that is deliberate: <see cref="St4i.Connector.Abstractions.Models.SetpointWriteRequest"/> still carries no
/// machine code, so a driver serving several machines could not tell which one a write was for — precisely
/// the condition <see cref="MachineDriverAvailability.AmbiguousDriver"/> exists to refuse. If D-4 chooses that
/// inverse shape it must extend the WRITE REQUEST first; this registry would then need a plural claim, which
/// is a change to this class and to one store column, not to the identity model.</para>
///
/// <para><b>Id comparison semantics:</b> every id this class is given (via <see cref="Register"/> or
/// looked up via <see cref="TryCreateDriver"/>) is folded through <see cref="DriverKinds.Normalize"/> —
/// the SAME rule GP-3 established (a case-insensitive fold for the five built-in ids only; a third-party
/// id is left byte-for-byte alone, so <c>"vendor.acme.weld"</c> and <c>"Vendor.Acme.Weld"</c> stay two
/// distinct entries). This registry does not invent a second casing rule — a registry that treated
/// <c>"modbus"</c> and <c>"Modbus"</c> as different entries would be exactly the nasty debugging
/// experience GP-3's own rule exists to prevent, and reusing <see cref="DriverKinds.Normalize"/> here
/// (rather than, say, an <see cref="StringComparer.OrdinalIgnoreCase"/> dictionary, which would ALSO fold
/// two different third-party ids that merely happen to share a casing) is what keeps that guarantee in
/// exactly one place in the codebase.</para>
///
/// <para><b>Unknown-id behavior:</b> <see cref="TryCreateDriver"/> returns <see langword="false"/> with a
/// descriptive <c>error</c> for an id nothing was ever <see cref="Register"/>ed under — never throws, and
/// never silently no-ops without a way for the caller to notice. This is deliberately the SAME shape as a
/// registered connector whose own <see cref="IConnectorFactory.TryCreate"/> rejects its configuration —
/// from <c>FleetHost</c>'s point of view "no factory for this id" (an operator typo, or a plugin
/// that failed to load) and "a factory rejected its own config" are the same class of problem: this
/// connector cannot start right now, log it, and do not let it stop any sibling connector or the
/// simulated fleet from starting.</para>
/// </summary>
public sealed class ConnectorRegistry
{
    private sealed record Entry(IConnectorFactory Factory, string Config, string Kind, string? MachineCode);

    /// <summary>Keyed by the NORMALIZED INSTANCE id (see the class doc comment) — <see cref="StringComparer.Ordinal"/>
    /// deliberately, not <see cref="StringComparer.OrdinalIgnoreCase"/>: casing tolerance is
    /// <see cref="DriverKinds.Normalize"/>'s job alone, applied once on the way in and once on the way out,
    /// never re-applied a second time by this dictionary's own comparer.</summary>
    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.Ordinal);

    /// <summary>Task D-1 — serializes <see cref="Register"/>'s check-then-write. The machine-code claim is a
    /// CROSS-ENTRY invariant ("no two instances claim the same code"), which a per-key
    /// <see cref="ConcurrentDictionary{TKey,TValue}"/> operation cannot enforce on its own: two concurrent
    /// registrations for two DIFFERENT instance ids naming the SAME machine code would each scan, each find
    /// nothing, and each write. Registration is a startup/HTTP-mutation path (never a hot path), so a plain
    /// lock is the right cost. <see cref="TryCreateDriver"/>/<see cref="RegisteredIds"/>/
    /// <see cref="TryGetInstanceIdForMachine"/> deliberately do NOT take it — they read the concurrent
    /// dictionary directly, exactly as they did before this task.</summary>
    private readonly object _registerGate = new();

    /// <summary>Registers (or replaces) the factory + configuration for one connector INSTANCE — keyed by
    /// <paramref name="instanceId"/>, which defaults to <see cref="IConnectorFactory.Kind"/> (the pre-D-1
    /// key, so an omitted id reproduces this method's previous behaviour exactly).
    /// <paramref name="config"/> is stored verbatim and opaque — this method never parses it, only hands it
    /// back to <paramref name="factory"/> unchanged on every future <see cref="TryCreateDriver"/> call for
    /// this id. Re-registering the same instance id — <b>named explicitly</b> — replaces the previous entry
    /// (last write wins) rather than throwing: a host is free to reconfigure a connector and register again,
    /// and <c>ConnectorEndpoints</c>' upsert, <c>RtuBusConfiguration.TryRegisterAll</c> and
    /// <c>ModbusMultidropRegistration.RegisterAll</c> all depend on that.
    ///
    /// <para>🔴 <b>OWNER'S RULING 2026-08-23, docs/owner-decisions.md item 47 — A REGISTRATION THAT DID NOT
    /// NAME AN INSTANCE ID AND LANDS ON AN OCCUPIED KEY NOW THROWS, NAMING BOTH SIDES.</b> That is the whole
    /// change, and its shape comes from the measured failure rather than from the word "duplicate":
    /// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusConnectorFactory"/> and
    /// <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusRtuConnectorFactory"/> both report
    /// <see cref="DriverKinds.Modbus"/> as their <see cref="IConnectorFactory.Kind"/>, so two DIFFERENT
    /// connectors that each let this method DEFAULT their key both derive <c>"Modbus"</c> — and whichever
    /// registered second used to retire the first with no message at all, making the survivor a function of
    /// registration ORDER, a variable nobody declares. The same shape applies to two TCP endpoints, whose
    /// host/port are baked into the adapter at construction. An id the caller CHOSE is a different act: the
    /// caller named the thing it meant to replace, and every path that does so already carries its own
    /// collision message.</para>
    ///
    /// <para>🔴 <b>THE PRICE, RECORDED HERE BECAUSE THIS IS WHERE IT IS PAID.</b> A host that wires two
    /// default-keyed connectors of one kind used to start, run on one of them, and say nothing. It now
    /// FAILS LOUDLY AT STARTUP: production calls this from inside a DI singleton factory lambda, so the
    /// exception faults <c>GetRequiredService&lt;FleetHost&gt;()</c> and the process does not come up. That
    /// is the outcome the owner chose over a silent one.</para>
    ///
    /// <para>🔴 <b>WHAT THIS CHECK DOES NOT MEASURE, said where its result shows up.</b> (1) It says nothing
    /// about two registrations under the SAME EXPLICIT id — those still replace, by design, and what guards
    /// them is <c>ConnectorsConfig.ResolveEntries</c>' first-entry-per-registration-key rule, which skips the
    /// later entry with a warning naming both. (2) Measured over both shipped composition roots at
    /// <c>47862d2a</c>, <b>no path reaches this throw today</b>: <c>St4i.EngineApi/Program.cs</c> guards its
    /// three default-keyed sources with <c>alreadyConfiguredKinds</c> (env vars, then unioned with every
    /// connectors.json key before the persisted rows are replayed), and <c>St4i.EdgeService/EdgeConnectors</c>
    /// has no env-var route at all and passes an explicit key. So this is a guard on the API's CONTRACT, not
    /// a repair of a live wiring — a third-party host, or a future source added to either root, is what it
    /// exists for.</para>
    ///
    /// <para>🔴 <b>CLAUSE (1)'S SECOND SENTENCE IS RETRACTED, 2026-08-24 (BP-1, docs/owner-decisions.md item
    /// 63) — kept verbatim above because it is a claim made inside this method's own "what I do not measure"
    /// block, the one place that must not overstate its own coverage.</b>
    /// <c>ConnectorsConfig.ResolveEntries</c>' first-entry-per-key rule guards the <c>connectors.json</c>
    /// PARSE path and nothing else. Five call sites in <c>src/</c> pass an explicit id —
    /// <c>ConnectorEndpoints</c>' upsert, <c>RtuBusConfiguration.TryRegisterAll</c>,
    /// <c>ModbusMultidropRegistration.RegisterAll</c>, <c>EdgeConnectors</c> and <c>Program.cs</c>'s
    /// persisted-row replay — and <c>ResolveEntries</c> is upstream of none of them. So "what guards them"
    /// named a guard that reaches a path none of the five take. Listed, then counted: four of the five are
    /// unguarded by it entirely, and the fifth reaches this method only after <c>ResolveEntries</c> has
    /// already collapsed duplicates, which is a different question from two SEPARATE sources landing on one
    /// id.</para>
    ///
    /// <para>🔴 <b>And the successor sentence is narrower than the obvious one, because the obvious one was
    /// built and measured false.</b> Item 63 read <c>ModbusMultidropRegistration</c>'s own out-of-lock check
    /// as evidence that this method should refuse such a replacement globally. It must not: task B-6
    /// deliberately made an env-var-SEEDED registration overwritable by an operator's <c>POST</c> naming a
    /// DIFFERENT machine under the same defaulted id, and pins it with
    /// <c>ConnectorEndpointsEnvSeedingSideEffectsTests.
    /// PostConnector_ForADifferentMachine_SucceedsOverwritingTheSeededRow_NoLongerFalsely409s</c>, while
    /// <c>ModbusMultidropRegistration</c> refuses the same shape. Two production callers, opposite answers,
    /// separated by a fact — PROVENANCE — that this class does not hold. What is true is that a
    /// same-explicit-id replacement is guarded by whatever the CALLER guards it with, and by nothing here;
    /// the callers that guard it do so by policy, not by oversight. See the block inside the gate.</para>
    ///
    /// <para><b>Review finding (fix round 1) — this is the one unguarded third-party entry point.</b>
    /// <paramref name="factory"/>'s <see cref="IConnectorFactory.Kind"/> getter is vendor-implemented code,
    /// read here with no try/catch in the original version of this method: a throwing or blank
    /// <c>Kind</c> getter would have propagated straight out of this call. Production calls this from
    /// inside a DI singleton factory lambda (<c>Program.cs</c>), so an uncaught exception here would have
    /// faulted <c>GetRequiredService&lt;FleetHost&gt;()</c> — a full STARTUP CRASH, not a disabled-for-this-
    /// run connector. Not reachable today (env vars are the only config source, and both shipped factories'
    /// <c>Kind</c> getters are trivial constant returns), but GP-5's <c>connectors.json</c> makes a
    /// vendor-supplied factory reachable here, so the guard belongs with the registry — the first point of
    /// contact with third-party code — rather than with whichever future caller loads that config. Returns
    /// <see langword="false"/> (never throws) for a <c>Kind</c> getter that throws OR returns
    /// null/blank/whitespace; <paramref name="factory"/> itself being <see langword="null"/> is a distinct,
    /// ordinary local-caller bug (this codebase's own code passing a literal <see langword="null"/>, not
    /// something a vendor's <see cref="IConnectorFactory"/> implementation can trigger) and still
    /// throws <see cref="ArgumentNullException"/>, same as any other .NET API.</para>
    /// </summary>
    /// <param name="factory">The connector's factory. Its <see cref="IConnectorFactory.Kind"/> is still read
    /// here (it is what <paramref name="instanceId"/> defaults to, and it is recorded as the instance's
    /// protocol) and is still guarded — see the remarks above.</param>
    /// <param name="config">Stored verbatim and opaque; see the remarks above.</param>
    /// <param name="instanceId">Task D-1 — this connector INSTANCE's own id, the key this registry uses.
    /// <see langword="null"/>/blank (the default) means "use the factory's own normalized
    /// <see cref="IConnectorFactory.Kind"/>", which is byte-for-byte the key this method used before D-1.
    /// Pass a distinct id to run two connectors of the SAME kind side by side (the whole point of D-1).
    /// Normalized through <see cref="DriverKinds.Normalize"/> like every other id in this codebase, which is
    /// also what keeps an operator-chosen id of <c>"modbus"</c> from becoming a SECOND entry alongside the
    /// built-in <c>"Modbus"</c>.
    ///
    /// <para>🔴 <b>OWNER'S RULING 2026-08-23, item 47 — OMITTING THIS ARGUMENT ONTO AN OCCUPIED KEY IS NOW AN
    /// ERROR, NOT A REPLACEMENT.</b> See <see cref="Register"/>'s own remarks for the whole statement,
    /// including the price. The sentence that used to stand here — "so every pre-existing call site keeps its
    /// exact previous behaviour, including last-write-wins for a second registration of the same kind" — is
    /// quoted rather than deleted because it is exactly the behaviour the ruling removed, and only for the
    /// half of it that concerns an OMITTED id. Naming an id explicitly still replaces.</para></param>
    /// <param name="machineCode">Task D-1 — the machine code this instance serves, if it knows it. This is
    /// the binding <c>FleetHost</c> routes a write on; see the class doc comment for why a claim that
    /// another instance already holds is REFUSED rather than allowed to overwrite. <see langword="null"/>
    /// (the default) means "this instance declares no machine binding" — every pre-existing call site, so
    /// their behaviour is unchanged.</param>
    /// <returns><see langword="true"/> if <paramref name="factory"/> was registered; <see langword="false"/>
    /// if its <see cref="IConnectorFactory.Kind"/> getter threw or returned null/blank/whitespace, or if
    /// <paramref name="machineCode"/> is already claimed by a DIFFERENT instance id (in which case nothing
    /// is mutated — the existing claim wins, and the caller can name the incumbent via
    /// <see cref="TryGetInstanceIdForMachine"/> to log a message an operator can act on).</returns>
    /// <exception cref="InvalidOperationException">🔴 Item 47 — <paramref name="instanceId"/> was omitted (or
    /// blank) and the key derived from <paramref name="factory"/>'s own <see cref="IConnectorFactory.Kind"/>
    /// is already registered. The message names BOTH connectors. Nothing is mutated.</exception>
    public bool Register(IConnectorFactory factory, string config, string? instanceId = null, string? machineCode = null)
    {
        ArgumentNullException.ThrowIfNull(factory);

        string kind;
        try
        {
            kind = DriverKinds.Normalize(factory.Kind);
        }
        catch
        {
            // A vendor-implemented property getter throwing is exactly the class of third-party
            // misbehavior IConnectorFactory.TryCreate is guarded against — Kind gets the same guard.
            return false;
        }

        if (string.IsNullOrWhiteSpace(kind))
        {
            return false;
        }

        // The instance id defaults to the kind — the pre-D-1 key, verbatim. A blank/whitespace explicit id is
        // treated the same as omitting it rather than rejected: an empty key is never a useful identity, and
        // silently keying on "" would be strictly worse than falling back to the one sensible default.
        var keyWasDefaulted = string.IsNullOrWhiteSpace(instanceId);
        var id = keyWasDefaulted ? kind : DriverKinds.Normalize(instanceId!.Trim());
        if (string.IsNullOrWhiteSpace(id))
        {
            return false;
        }

        var claim = string.IsNullOrWhiteSpace(machineCode) ? null : machineCode.Trim();

        lock (_registerGate)
        {
            // 🔴 Item 47's whole fix. Inside the gate, because "is this key free" and "take this key" are one
            // question about one moment — asked outside it, two concurrent default-keyed registrations would
            // each look, each find the key free, and one would still vanish silently.
            if (keyWasDefaulted && _entries.TryGetValue(id, out var incumbent))
            {
                throw new InvalidOperationException(
                    $"Two connectors both claim the default registration key '{id}'. " +
                    $"INCUMBENT: factory '{incumbent.Factory.GetType().FullName}' (kind '{incumbent.Kind}', machine " +
                    $"'{incumbent.MachineCode ?? "(unbound)"}'). " +
                    $"REJECTED: factory '{factory.GetType().FullName}' (kind '{kind}', machine " +
                    $"'{claim ?? "(unbound)"}'). " +
                    "A registration that does not name an instanceId keys on its factory's Kind, and this build " +
                    "has more than one factory per kind — so which of these two survives would be decided by " +
                    "registration ORDER and the other would disappear with no message. Give at least one of them " +
                    "an explicit instanceId (ConnectorRegistry.Register's third argument), or remove one of the " +
                    "two configuration sources. See docs/owner-decisions.md item 47.");
            }

            // 🔴 ITEM 63 WAS MEASURED HERE ON 2026-08-24 (BP-1) AND ITS FIX WAS REFUSED, WITH A PRICE THAT
            // THE ITEM DID NOT NAME. The item proposed extending item 47's refusal to the EXPLICIT-id path,
            // reasoning from ModbusMultidropRegistration having built such a refusal for itself outside this
            // gate. Both shapes were built and both were priced against the suite:
            //
            //   * a THROW on any duplicate explicit id turns every connector EDIT into a 500 —
            //     ConnectorEndpoints reaches this method with an explicit id on the path its own comment
            //     calls "the ordinary idempotent-update path";
            //   * a REFUSAL (return false) narrowed to "the incumbent under this id serves a DIFFERENT
            //     machine" — exactly ModbusMultidropRegistration.OwnedBySomethingElse's rule — reddens
            //     ConnectorEndpointsEnvSeedingSideEffectsTests.
            //     PostConnector_ForADifferentMachine_SucceedsOverwritingTheSeededRow_NoLongerFalsely409s,
            //     because task B-6 deliberately made an env-var-SEEDED row overwritable by an operator's
            //     POST naming a different machine under the same defaulted id, and that test exists to keep
            //     it that way.
            //
            // So TWO production callers want OPPOSITE answers to one question, and the fact that separates
            // them is PROVENANCE (Seeded vs Operator) — which this class does not hold and should not: it
            // stores factories and opaque configuration strings. ConnectorEndpoints already forks on
            // provenance before it gets here. The out-of-lock check in ModbusMultidropRegistration is
            // therefore a LOCAL POLICY rather than a workaround for a missing global rule, and it cannot be
            // made redundant by anything written at this line. Recorded rather than left to be rediscovered.
            //
            // ══ THE THIRD DIRECTION, PRICED — BR-1, 2026-08-24, item 63 ══════════════════════════════════
            // The paragraph above says provenance is "a fact this class does not hold and should not" and
            // stops there, which reads as a preference. It was taken seriously and measured, because the
            // rule it implies is COHERENT: refuse when the incumbent under this id is an OPERATOR row
            // serving a DIFFERENT machine, allow when it is a SEEDED one. That reproduces both callers'
            // answers — B-6's overwrite of an env-seeded row, and ModbusMultidropRegistration's refusal.
            // It still does not go, and here is what it costs rather than why it is disliked:
            //
            //   (1) THE TYPE CANNOT REACH THIS LINE. ConnectorConfigSource is declared in St4i.EngineApi
            //       (Fleet/ConnectorConfigStore.cs). This assembly ProjectReferences only
            //       St4i.Connector.Abstractions. Of the FIVE call sites that pass an explicit id, TWO are in
            //       assemblies that cannot name the type at all — ModbusMultidropRegistration (this
            //       assembly) and EdgeConnectors (St4i.EdgeService, which also references only EdgeCore).
            //   (2) THE VOCABULARY HAS NO VALUE FOR THREE OF THE FIVE. The enum has exactly two members and
            //       both name a PERSISTENCE event in ConnectorConfigStore: an operator POST, or a
            //       visibility seed. A bus-map device, a connectors.json entry and an env-var registration
            //       are none of those. So this is not "pass a value you already have"; it is "invent the
            //       missing members and decide a precedence matrix over them", and nothing in this tree
            //       states that matrix.
            //   (3) A DEFAULTED PARAMETER RE-CREATES THIS METHOD'S OWN OPENING DEFECT. Register has 8
            //       production and 126 test call sites. Required breaks all 134; optional fuses "did not
            //       declare" with a real value at a SECOND parameter, which is precisely what
            //       `keyWasDefaulted` above does to four distinct states and what item 63's first paragraph
            //       is about.
            //   (4) 🔴 AND IT DOES NOT DECIDE THE ITEM'S OWN HEADLINE CASE. Item 63 §63.1/§63.3 is about two
            //       registrations under one id THE OPERATOR TYPED. Provenance is EQUAL on both sides there,
            //       so a registry holding it still cannot arbitrate them, and last-write-wins survives for
            //       exactly the population §63.3 calls the likelier one. The third direction answers a
            //       question the item did not ask.
            if (claim is not null)
            {
                foreach (var (existingId, existingEntry) in _entries)
                {
                    if (string.Equals(existingId, id, StringComparison.Ordinal)) continue;
                    if (existingEntry.MachineCode is null) continue;
                    if (!string.Equals(existingEntry.MachineCode, claim, StringComparison.OrdinalIgnoreCase)) continue;

                    // Task D-1 — the structural gate. Two live connector instances claiming ONE machine code
                    // is exactly the state MachineDriverAvailability.AmbiguousDriver was built to refuse a
                    // write in; refusing the second REGISTRATION means that state can never be constructed
                    // through this registry in the first place. Ordinal-ignore-case because every machine-code
                    // comparison in this codebase is (FleetCore.RegisterMachine's own duplicate guard,
                    // ResolveWritableDriver's roster lookup, ConnectorEndpoints' collision checks) — a claim
                    // that differed only by casing would slip past this and reintroduce the ambiguity.
                    return false;
                }
            }

            _entries[id] = new Entry(factory, config ?? string.Empty, kind, claim);
            return true;
        }
    }

    /// <summary>
    /// 🔴 Task D-7a — <b>the removal path this class spent three tasks not having.</b> Removes the entry
    /// registered under <paramref name="instanceId"/> and, with it, <b>that instance's machine-code claim</b>,
    /// so another instance can claim the same machine afterwards. Returns <see langword="false"/> (mutating
    /// nothing) for an id nothing is registered under.
    ///
    /// <para><b>Why this had to exist before multidrop could ship.</b> <see cref="Register"/> refuses a second
    /// claim on a machine code — that refusal is the structural gate
    /// <c>FleetCore.ResolveWritableDriver</c> rests on. With no removal, a device deleted from a bus map
    /// (or a connector deleted through <c>DELETE /v1/connectors/{instanceId}</c>) left a GHOST entry still
    /// holding that machine's claim until the process restarted: the machine could not be re-served by
    /// anything, and the refusal named an instance the operator had already deleted from their file.
    /// <c>ModbusMultidropRegistration</c>'s own doc comment recorded the whole failure as D-7's to close, and
    /// D-4's review carried it as <c>m6</c>.</para>
    ///
    /// <para><b>🔴 This method performs NO I/O and disposes NOTHING, and that is the design, not an
    /// omission.</b> This registry holds <see cref="IConnectorFactory"/> objects and opaque configuration
    /// strings — it has never held a driver. The live <see cref="IDeviceDriver"/> built from an entry belongs
    /// to a <c>FleetHost</c> pipeline slot, and <c>FleetHost</c> already disposes slots
    /// <b>outside</b> its <c>_gate</c>, under a bounded per-driver budget
    /// (<c>WaitAndDisposeOldPipeline</c>/<c>DisposeOrphanedConnectorDrivers</c>, both invoked only after the
    /// lock block closes — that constraint predates this batch and is absolute). So removal here is a pure
    /// dictionary mutation that cannot block a caller holding any lock, and the driver it orphans is reclaimed
    /// by the pipeline restart that <c>FleetHost</c> already owns. <b>An in-flight read is therefore
    /// completely unaffected by this call</b> — it keeps its lease, keeps the shared RTU bus, and finishes
    /// normally; what it loses is only its right to be rebuilt on the next start.</para>
    ///
    /// <para><b>What an operator sees between this call and the next start:</b> the removed instance's driver
    /// keeps polling and keeps emitting readings for its machine. That is unchanged from before this method
    /// existed (nothing ever stopped it) — what changes is that the machine's CLAIM is now free, so a
    /// replacement connector can be configured immediately instead of after a restart. A write for that
    /// machine in the window resolves to the NEW instance, which has no running slot yet, and is refused with
    /// <see cref="MachineDriverAvailability.NoLiveDriver"/> — it is never handed to the orphaned driver, which
    /// is the property that matters.</para>
    /// </summary>
    /// <param name="instanceId">The instance id to remove. Normalized through <see cref="DriverKinds.Normalize"/>
    /// exactly like every id this class is given, so <c>"modbus"</c> removes the <c>"Modbus"</c> entry.</param>
    /// <returns><see langword="true"/> if an entry was removed; <see langword="false"/> for a null/blank id or
    /// an id nothing is registered under. Never throws.</returns>
    public bool Unregister(string? instanceId)
    {
        if (string.IsNullOrWhiteSpace(instanceId)) return false;

        var id = DriverKinds.Normalize(instanceId.Trim());
        if (string.IsNullOrWhiteSpace(id)) return false;

        // Under the SAME gate Register takes. Not for the dictionary's sake (ConcurrentDictionary.TryRemove is
        // atomic on its own) but for the CROSS-ENTRY invariant Register enforces: a removal that landed in the
        // middle of Register's claim scan could let a claim be refused against an entry that no longer exists
        // by the time the scan finished. Serialising the two removes the interleaving instead of reasoning
        // about it — the same argument SnapshotBindings' own doc comment makes for resolution.
        lock (_registerGate)
        {
            return _entries.TryRemove(id, out _);
        }
    }

    /// <summary>Every currently-registered connector INSTANCE id, normalized. A point-in-time snapshot.
    ///
    /// <para>🔴 Task D-7a — <b>this used to say "this task never removes entries once added, so there is no
    /// torn-read hazard to guard against", and <see cref="Unregister"/> made that sentence false.</b> The
    /// conclusion survives the premise, and the reason is worth stating rather than deleting: the hazard a
    /// removal introduces is a torn ENUMERATION, and <see cref="ConcurrentDictionary{TKey,TValue}.Keys"/>
    /// materialises a snapshot list under the dictionary's own locks, so an id removed mid-enumeration either
    /// appears in the returned list or does not — never a corrupt read. What a caller CAN now see is a
    /// returned id that is already gone by the time it is used, and that is exactly the shape
    /// <see cref="TryCreateDriver"/> was already built for: it answers an unknown id with
    /// <see langword="false"/> plus a descriptive error, the same way it answers a factory that rejected its
    /// own configuration. <c>FleetCore.StartLocked</c> reports that as a per-connector start issue and starts
    /// every sibling — which is the correct behaviour for "this connector was removed while the fleet was
    /// starting", not a defect to guard against.</para></summary>
    public IReadOnlyList<string> RegisteredIds => _entries.Keys.ToList();

    /// <summary>Task D-1 — the protocol kind an instance speaks (<see cref="IConnectorFactory.Kind"/>,
    /// normalized), or <see langword="null"/> for an id nothing is registered under. Distinct from the
    /// instance id itself the moment two connectors of one kind coexist.</summary>
    public string? KindOf(string instanceId) =>
        _entries.TryGetValue(DriverKinds.Normalize(instanceId), out var entry) ? entry.Kind : null;

    /// <summary>
    /// Task D-1 — the ONE lookup that makes per-machine write routing possible: which registered connector
    /// instance declared that it serves <paramref name="machineCode"/>? Returns <see langword="false"/> when
    /// no instance claims this code (the machine is simulated, or driven by an instance that never declared
    /// a binding, or not connector-backed at all).
    ///
    /// <para>At most ONE instance can ever claim a given code — <see cref="Register"/> refuses a second
    /// claim outright (see its own remarks) — so this is genuinely a lookup, not a "pick the first of
    /// several". That is the property <c>FleetCore.ResolveWritableDriver</c> depends on to report
    /// <see cref="MachineDriverAvailability.Writable"/> without needing Đợt B's roster-sharing count: a
    /// claimed machine resolves to exactly one identifiable driver by construction.</para>
    ///
    /// <para>Case-insensitive on <paramref name="machineCode"/>, matching every other machine-code
    /// comparison in this codebase (<c>FleetCore.RegisterMachine</c>'s duplicate guard,
    /// <c>ConnectorEndpoints</c>' collision checks). Never throws; a null/blank code simply matches
    /// nothing.</para>
    /// </summary>
    public bool TryGetInstanceIdForMachine(string? machineCode, [NotNullWhen(true)] out string? instanceId)
    {
        instanceId = null;
        if (string.IsNullOrWhiteSpace(machineCode)) return false;

        var wanted = machineCode.Trim();
        foreach (var (id, entry) in _entries)
        {
            if (entry.MachineCode is not null
                && string.Equals(entry.MachineCode, wanted, StringComparison.OrdinalIgnoreCase))
            {
                instanceId = id;
                return true;
            }
        }

        return false;
    }

    /// <summary>Task D-1 — <see langword="true"/> if <paramref name="instanceId"/> is registered AND declared
    /// a machine binding. Tells "this connector slot belongs to a specific, identified machine (and therefore
    /// serves no other roster member)" from "this slot is unbound, so the pre-D-1 kind-based rule — ambiguity
    /// guard included — still governs it."
    ///
    /// <para>Prefer <see cref="SnapshotBindings"/> when asking more than one question in a row — see its own
    /// remarks. This overload is for single, standalone queries.</para>
    ///
    /// <para><b>Census (D-1 re-review, m-B): this member has NO production caller.</b>
    /// <c>FleetHost</c> used it until m3 replaced its three independent registry reads with one
    /// <see cref="SnapshotBindings"/> call, and nothing else in <c>src/</c> asks the question. It is kept
    /// rather than deleted for one reason, stated so the next census does not have to re-derive it: it is
    /// the readable way for a TEST to assert that a registration is bound (the alternative,
    /// <c>SnapshotBindings().Any(b =&gt; b.InstanceId == id &amp;&amp; b.MachineCode is not null)</c>, restates
    /// the predicate at every call site), and "is this connector bound to a machine?" is a first-class fact
    /// about this type rather than an accident of one caller. If a future census wants it gone, the four
    /// tests using it are the whole blast radius.</para></summary>
    public bool IsBoundToAMachine(string instanceId) =>
        _entries.TryGetValue(DriverKinds.Normalize(instanceId), out var entry) && entry.MachineCode is not null;

    /// <summary>Task D-1 — one registered connector instance's identity and machine binding, as carried by
    /// <see cref="SnapshotBindings"/>. Deliberately carries no factory/config: a caller asking "who serves
    /// this machine, and which slots belong to a bound instance" has no business reaching the factory.</summary>
    public readonly record struct ConnectorBinding(string InstanceId, string? MachineCode);

    /// <summary>
    /// 🔴 D-1 review, m3 — ONE consistent point-in-time view of every registered instance's binding.
    ///
    /// <para><c>FleetCore.ResolveWritableDriver</c> asks three separate questions per resolution
    /// ("who claims this machine", "does a bound instance own this slot label", and the same first question
    /// again for every roster member while counting slot-sharers). Asked as three independent reads they are
    /// three independent points in time: <c>FleetCore</c> holds its own <c>_gate</c> during
    /// resolution, but <see cref="Register"/> takes <see cref="_registerGate"/> and nothing else, so a
    /// concurrent registration CAN land between them. No interleaving produces a wrong-machine write today —
    /// but only because every path that can register without a machine binding also fails to build a driver,
    /// so no writable slot exists for it, which is a property of today's five call sites rather than of the
    /// resolution method. Resting a safety invariant on that is exactly the kind of reasoning this project
    /// has been burned by; taking one snapshot removes the question instead of answering it.</para>
    ///
    /// <para>A snapshot, not a lock: this is a copy of the dictionary's entries at one moment, so it can be
    /// stale the instant it returns. That is fine and is the point — resolution needs an internally
    /// CONSISTENT view, not a fresh one, because a registration that lands mid-resolution is
    /// indistinguishable from one that lands immediately after it.</para>
    /// </summary>
    public IReadOnlyList<ConnectorBinding> SnapshotBindings()
    {
        var snapshot = new List<ConnectorBinding>(_entries.Count);
        foreach (var (id, entry) in _entries)
        {
            snapshot.Add(new ConnectorBinding(id, entry.MachineCode));
        }

        return snapshot;
    }

    /// <summary>
    /// Attempts to build a fresh <see cref="IDeviceDriver"/> for <paramref name="id"/> — called anew every
    /// time <c>FleetCore.StartLocked</c> needs one (never cached/reused; see
    /// <see cref="IConnectorFactory.TryCreate"/>'s own remarks on why a fresh instance every restart is
    /// required). Never throws: an id nothing was <see cref="Register"/>ed under is reported the same way a
    /// registered factory rejecting its own configuration is (see the class doc comment's "Unknown-id
    /// behavior" section) — <see langword="false"/> plus a descriptive <paramref name="error"/>, never an
    /// exception, and never a silent no-op.
    ///
    /// <para>Review note (fix round 1): "never throws" is enforced HERE, not left as something the caller
    /// has to also guard against — <see cref="IConnectorFactory.TryCreate"/>'s own contract says a factory
    /// must not throw, but this method's doc comment promises the same thing unconditionally, so a
    /// misbehaving factory's exception is caught right here rather than relying on
    /// <c>FleetCore.StartLocked</c>'s OWN defensive catch to be the only thing standing between a
    /// rogue factory and a propagated exception. <c>FleetHost</c> still keeps its own catch around
    /// this call too — deliberate, doubled defense in depth for the one place third-party code runs while
    /// <c>_gate</c> is held, not redundancy to be trimmed.</para>
    ///
    /// <para><b>Catching here must not re-introduce the leak this whole seam guards against.</b> A factory
    /// that assigns its <c>out driver</c> parameter and THEN throws (instead of returning) has already made
    /// that assignment visible through the reference — an <see langword="out"/> parameter is pass-by-
    /// reference, so the write survives the throw. The catch below therefore does NOT reset the built
    /// driver to <see langword="null"/> — it forwards whatever was assigned (a real instance, or
    /// <see langword="null"/> if the factory never got that far) unchanged, so <c>FleetHost</c> can
    /// still see and dispose an orphaned driver rather than the reference silently vanishing here.</para>
    /// </summary>
    public bool TryCreateDriver(string id, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
    {
        var normalized = DriverKinds.Normalize(id);
        if (!_entries.TryGetValue(normalized, out var entry))
        {
            driver = null;
            error = $"No connector factory is registered for connector id '{id}'.";
            return false;
        }

        // builtDriver/builtError (plain locals, pre-initialized) rather than writing straight into the
        // `out` parameters from inside the try: if entry.Factory.TryCreate assigns its own out parameter
        // and THEN throws, that assignment is already visible here (out is pass-by-reference) — the catch
        // below must forward it, not overwrite it back to null, or the leak-prevention this method exists
        // to support would defeat itself.
        IDeviceDriver? builtDriver = null;
        string? builtError = null;
        bool ok;
        try
        {
            ok = entry.Factory.TryCreate(entry.Config, out builtDriver, out builtError);
        }
        catch (Exception ex)
        {
            ok = false;
            builtError = ex.Message;
        }

        driver = builtDriver;
        error = builtError;
        return ok;
    }
}
