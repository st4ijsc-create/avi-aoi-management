using St4i.Connector.Abstractions.Models;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0c Task 3 — the one place that decides whether a connector kind can put a REAL value behind a
/// tag, i.e. whether <c>TagDescriptor.IsBackedByDriver</c> is allowed to be <see langword="true"/> for a
/// tag whose source names that kind.
///
/// <para><b>Why this type exists at all.</b> <c>isBackedByDriver</c> is one word that a UI shows an
/// operator to mean "this number came off the machine". The blueprint's own lesson block records the trap
/// this repository has already paid for once: <c>dispense_program</c> and <c>weld_profile</c> were fully
/// declared, domain-checked, persisted, and served over a real route — and no simulator ever read them.
/// Every mechanical signal said the feature worked; the only thing missing was the part that used it.
/// A flag that is merely COPIED from a connector's own declaration has exactly that shape: it would be
/// carried, stored and rendered faithfully, and it would still be a claim nothing checked. This type makes
/// the flag an answer this codebase COMPUTES about a kind, rather than a field a declaration asserts about
/// itself.</para>
///
/// <para><b>What "can back" means here — a necessary condition, not a sufficient one.</b> This answers a
/// question about the KIND only: can this build construct an <see cref="St4i.Connector.Abstractions.IConnectorFactory"/>
/// for that kind at all, so that some tag address could be read through it. It deliberately does NOT
/// answer "does THIS tag's address resolve on THIS device" — that depends on a register map, a live
/// session and a device that answers, none of which exist at the time a tag namespace is declared. So
/// <see langword="false"/> is a hard fact (nothing in this build can read that kind, so no tag naming it
/// is backed), while <see langword="true"/> means "not excluded by kind" and remains subject to the
/// address actually resolving at read time. Read that asymmetry before using this to make a stronger
/// promise to an operator than it supports.</para>
///
/// <para><b>Why the factory population is the right truth, rather than the driver population.</b> Five
/// driver kinds exist (<see cref="DriverKinds"/>), and only two of them have a connector factory. That gap
/// is not an oversight — it is the distinction this predicate needs. A factory is what turns an operator's
/// opaque <c>connectors.json</c> settings blob into a live driver instance bound to a machine, which is
/// the only route by which a declared tag address ever reaches a device. <c>MqttDriver</c> and
/// <c>HotFolderAoiDriver</c> are real (<see cref="DriverKinds.IsFabricated"/> is <see langword="false"/>
/// for both) yet neither is addressable in the sense a tag map needs: one delivers whatever a broker
/// publishes on a topic, the other parses documents a machine drops in a folder. Neither takes an address
/// and returns that address's value. <see cref="DriverKinds.IsFabricated"/> is therefore NOT the predicate
/// to reuse here — "not fabricated" and "readable by address" are two different questions, and three of
/// the five kinds answer them differently.</para>
///
/// <para><b><see cref="DriverKinds.Simulated"/> is <see langword="false"/>, unconditionally — including
/// under <c>ST4I_DEMO_ENABLED</c>.</b> A simulated reading is manufactured, so a tag backed by one is
/// precisely the false claim this type exists to prevent; and mechanically there is no
/// <c>SimulatedConnectorFactory</c> in any build — <c>SimulatedDriver</c> is constructed directly by the
/// in-process fleet paths, never dispatched to from a connector kind. The demo gate changes which machines
/// a roster spins up; it does not give the simulated kind a connector factory, so there is no build in
/// which this answer differs.</para>
/// </summary>
public static class DriverTagSupport
{
    /// <summary>
    /// The connector kinds this build declares a tag may be backed by. This is the DECLARED side of the
    /// pair: <c>DriverTagSupportTests</c> holds it against a truth side derived by reflection over the
    /// <see cref="St4i.Connector.Abstractions.IConnectorFactory"/> implementations this product actually
    /// ships, and fails in BOTH directions — a kind listed here with no factory behind it, and a factory
    /// whose kind nobody added here, are each a red test rather than a silent divergence.
    ///
    /// <para>Ordinal-sorted so the comparison against a sorted reflected set is order-insensitive by
    /// construction rather than by the test remembering to sort.</para>
    /// </summary>
    public static IReadOnlyList<string> DeclaredKinds { get; } = new[]
    {
        DriverKinds.Modbus,
        DriverKinds.OpcUa,
    };

    /// <summary>
    /// Whether a tag whose source names <paramref name="connectorKind"/> may be reported as backed by a
    /// driver. Goes through <see cref="DriverKinds.Normalize"/> first, so any casing (or surrounding
    /// whitespace) of a built-in id is recognised — the same one folding rule every other built-in
    /// comparison in this codebase uses, rather than a second spelling policy stated here.
    ///
    /// <para><see langword="null"/>, empty or whitespace answers <see langword="false"/>: a tag that names
    /// no kind has nothing behind it, and this is the fail-CLOSED direction — the failure mode of guessing
    /// wrong here is telling an operator a number is real when it is not.</para>
    ///
    /// <para>🔴 <b>The blank-kind guard below is deliberately kept even though deleting it does not redden
    /// any test — measured, not assumed (Task 3 sweep row D6).</b> Without it the answer is still
    /// <see langword="false"/> for <see langword="null"/>/empty/whitespace, but only because two OTHER
    /// pieces of code happen to tolerate it: <see cref="DriverKinds.Normalize"/> returns a null/empty id
    /// unchanged rather than throwing, and <c>Contains</c> compares a null against the list without
    /// dereferencing it. The guard makes this method's fail-closed contract its own rather than a
    /// consequence of a collaborator's null tolerance. <c>CanBack_FailsClosedOnAMissingKind</c> pins the
    /// BEHAVIOUR — including a regression in that tolerance — but it does not pin this LINE, and this
    /// paragraph exists so nobody later reads the sweep's green D6 row as evidence the line is dead.</para>
    ///
    /// <para>A third-party kind also answers <see langword="false"/>. That is a statement about this
    /// build, not a judgment about the connector: <c>ConnectorsJsonRegistration.RegisterAll</c> has no
    /// in-process plugin-loading mechanism, so it can construct no factory for such a kind and skips the
    /// entry with a named warning. When that mechanism arrives, this predicate is one of the places that
    /// has to learn about it, and the reverse-direction test is what will say so.</para>
    /// </summary>
    public static bool CanBack(string? connectorKind)
    {
        if (string.IsNullOrWhiteSpace(connectorKind)) return false;

        var normalized = DriverKinds.Normalize(connectorKind);
        return DeclaredKinds.Contains(normalized, StringComparer.Ordinal);
    }
}
