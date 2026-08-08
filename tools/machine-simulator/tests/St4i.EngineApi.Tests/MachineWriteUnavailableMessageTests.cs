using St4i.EngineApi.Policy;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task E-4 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §12) — the operator-facing
/// explanation for a write that was never attempted, asserted BY CONTENT, on every path that produces
/// it.</b>
///
/// <para><b>Why this file exists at all.</b> The four not-available cases have been "distinguished, never
/// collapsed" since Đợt B and there were tests saying so — but every one of them asserted the STATUS and the
/// REASON CODE, and the closest any came to the message was
/// <c>Assert.False(string.IsNullOrWhiteSpace(body.Error))</c>, which is true of every string including the
/// wrong one. Three of the four strings had drifted into stating something false, and no test could have
/// noticed:</para>
/// <list type="bullet">
/// <item><description><c>NO_LIVE_DRIVER</c> read "the fleet may be stopped, the HALT latch may be engaged,
/// or this machine's connector failed to start this run … then retry". A roster machine with <b>no connector
/// configured at all</b> satisfies none of those three, and it is the state the existing
/// <c>Setpoint_MachineKnownButFleetNeverStarted_409_NoLiveDriver</c> test itself constructs.</description></item>
/// <item><description><c>READ_ONLY</c> read "this connector declares no writable points or commands". Its
/// most common producer is a machine driven by the built-in <b>simulated group</b>, which has no connector
/// at all — again the very state that case's own test constructs.</description></item>
/// <item><description>The <c>404</c> read <c>machine "X" not found</c>, naming a typo or a machine never
/// onboarded, and omitting the producing path this batch exists to make visible.</description></item>
/// </list>
///
/// <para>🔴 <b>The producing path this batch is about, and the honest limit on it.</b> A machine driven by a
/// <c>St4i.EdgeService</c> edge agent is read-only from this engine (blueprint §3: <c>ITransport</c> is
/// upload-only, so there is no downlink a write could travel on). This engine <b>cannot detect</b> that
/// state — an edge agent pushes northbound to the platform (<c>ST4I_SERVER_URL</c>) and never calls this
/// engine, which serves no ingest route, so nothing here ever learns that an edge agent exists. These tests
/// therefore do NOT assert that the two paths are told apart; they assert that <b>both are NAMED</b>, which
/// is what makes one string true on both. A test asserting discrimination would be asserting a fact that
/// does not exist.</para>
///
/// <para><b>What breaks these tests.</b> Collapsing any two cases into one string
/// (<see cref="EveryNotAvailableCase_HasItsOwnExplanation_AndNoTwoAreTheSameString"/>); dropping either half
/// of a two-path case (<see cref="NoLiveDriver_NamesTheNoConnectorAtAllPath_NotOnlyTheThreeThatAssumeOne"/>,
/// <see cref="ReadOnly_NamesTheSimulatedGroupPath_NotOnlyAConnectorWithNoWritablePoints"/>); restoring the
/// bare "then retry" advice (<see cref="NoLiveDriver_DoesNotAdviseABareRetry_NorInvitingASecondProcessOntoTheDevice"/>);
/// or adding a <see cref="MachineDriverAvailability"/> member with no arm, which throws rather than falling
/// into a soothing default.</para>
///
/// <para><b>Deliberately no <see cref="Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory{TEntryPoint}"/>
/// here.</b> These are properties of the TEXT. That the two surfaces which render it actually use it is a
/// different claim with its own witnesses, and both are assertions against
/// <see cref="MachineWriteGate.ExplainUnavailable"/> rather than against literals, so neither half can be
/// green while the other is stale: <c>MachineWriteEndpointsTests</c>' four not-available cases (the HTTP
/// body an operator reads at the write button) and <c>RelayNotificationChannelTests</c>'
/// <c>TheFourUnavailableCases_AreDistinguished_AndNoneIsCollapsed</c> (the warning an operator reads when
/// the ANNUNCIATOR did not light — a second rendering site found by enumerating what turns a
/// <see cref="MachineDriverAvailability"/> into prose, rather than by looking at the write endpoint).</para>
/// </summary>
public sealed class MachineWriteUnavailableMessageTests
{
    private const string Code = "MW-EXPLAIN-01";

    /// <summary>Every value except <see cref="MachineDriverAvailability.Writable"/> — derived from the enum
    /// itself rather than listed, so a member added later is covered without anyone remembering to add it
    /// here (it lands in <see cref="MachineWriteGate.ExplainUnavailable"/>'s throwing default and this test
    /// goes red naming it).</summary>
    private static IEnumerable<MachineDriverAvailability> NotAvailableCases() =>
        Enum.GetValues<MachineDriverAvailability>().Where(v => v != MachineDriverAvailability.Writable);

    /// <summary>🔴 <b>The collapse witness.</b> The requirement is not "each case has A message" but "no two
    /// cases share one" — a single generic "this machine is not available for writing right now" would
    /// satisfy every content assertion below taken individually, and it is exactly the shape B-6's brief
    /// forbade and that this batch found the drifted remains of. Pairwise, not merely distinct-count, so the
    /// failure message names WHICH two collapsed.</summary>
    [Fact]
    public void EveryNotAvailableCase_HasItsOwnExplanation_AndNoTwoAreTheSameString()
    {
        var cases = NotAvailableCases().ToList();
        Assert.Equal(4, cases.Count);   // MachineNotFound, NoLiveDriver, ReadOnly, AmbiguousDriver

        var byCase = cases.ToDictionary(c => c, c => MachineWriteGate.ExplainUnavailable(c, Code));

        foreach (var (availability, text) in byCase)
        {
            Assert.False(string.IsNullOrWhiteSpace(text));
            Assert.Contains(Code, text, StringComparison.Ordinal);
        }

        foreach (var a in cases)
        {
            foreach (var b in cases)
            {
                if (a == b) continue;
                Assert.False(
                    string.Equals(byCase[a], byCase[b], StringComparison.Ordinal),
                    $"{a} and {b} produce the SAME operator explanation — the four cases have collapsed into " +
                    "one string, which is the defect B-6 refused and E-4 found the drifted remains of.");
            }
        }
    }

    /// <summary>🔴 The path the old three-cause sentence had no room for, and the path this batch is about,
    /// in one message because this engine genuinely cannot tell them apart. The three causes that DO assume
    /// a connector are still named — narrowing is not the fix, completeness is.</summary>
    [Fact]
    public void NoLiveDriver_NamesTheNoConnectorAtAllPath_NotOnlyTheThreeThatAssumeOne()
    {
        var text = MachineWriteGate.ExplainUnavailable(MachineDriverAvailability.NoLiveDriver, Code);

        // The two causes the old string named, kept.
        Assert.Contains("HALT latch is engaged", text, StringComparison.Ordinal);
        Assert.Contains("failed to start this run", text, StringComparison.Ordinal);

        // The cause it did not name — and the one the existing 409 test's own scenario actually is.
        Assert.Contains("NO connector for this machine is configured in this engine at all", text, StringComparison.Ordinal);

        // The producing path this batch exists to make visible, named rather than guessed at.
        Assert.Contains("edge agent", text, StringComparison.Ordinal);
    }

    /// <summary>🔴 Advice is part of correctness here. "…then retry" is advice that can never work for an
    /// edge-held device, and the next move it invites — configure a connector for that machine HERE — puts a
    /// SECOND process on a device another one already drives. Blueprint §2 measured that: over a TCP gateway
    /// both processes connect normally and nothing refuses, because the machine-code claim is a
    /// single-process dictionary.</summary>
    [Fact]
    public void NoLiveDriver_DoesNotAdviseABareRetry_NorInvitingASecondProcessOntoTheDevice()
    {
        var text = MachineWriteGate.ExplainUnavailable(MachineDriverAvailability.NoLiveDriver, Code);

        Assert.DoesNotContain("then retry", text, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Retrying only helps", text, StringComparison.Ordinal);
        Assert.Contains("Do NOT add a connector here", text, StringComparison.Ordinal);
    }

    /// <summary>🔴 A machine an edge agent holds does not appear in this engine's roster at all — the two
    /// hosts share no roster and no channel — so the FIRST thing an operator meets is this 404, not the 409.
    /// The old text named only a typo and a never-onboarded machine, both of which read as "you made a
    /// mistake" for a machine that is real, running, and correctly configured somewhere else.</summary>
    [Fact]
    public void MachineNotFound_NamesTheEdgeHeldMachine_NotOnlyATypoOrANeverOnboardedOne()
    {
        var text = MachineWriteGate.ExplainUnavailable(MachineDriverAvailability.MachineNotFound, Code);

        Assert.Contains("mistyped", text, StringComparison.Ordinal);
        Assert.Contains("never onboarded here", text, StringComparison.Ordinal);
        Assert.Contains("edge agent", text, StringComparison.Ordinal);
        Assert.Contains("never appears in this roster", text, StringComparison.Ordinal);
    }

    /// <summary>🔴 Two producing paths, and the old string named only the rarer one. The common one — a
    /// <c>simulated</c> roster machine, or a third-party-kind machine with no connector registered for its
    /// kind, both of which <c>FleetCore.ResolveSlotLabelFor</c> sends to the simulated group — has no
    /// connector at all, so "this connector declares no writable points" described something that does not
    /// exist.
    ///
    /// <para>🔴 <b>Whole-branch review I3 — and the correction is sharper than the original finding, which is
    /// why this test changed rather than merely gaining an assertion.</b> The replacement string kept a
    /// second clause, "or it has a connector whose driver declares no writable points or commands", and
    /// <b>this test asserted it</b>. That clause names a producer that <b>cannot exist in this build</b>:
    /// <c>ResolveWritableDriver</c> returns <see cref="MachineDriverAvailability.ReadOnly"/> only when the
    /// slot's driver is not an <see cref="St4i.Connector.Abstractions.Models.IWritableDeviceDriver"/>, and
    /// every <c>IConnectorFactory</c> here produces one that is (there is no plugin loader). A writable
    /// driver with no matching point resolves as <c>Writable</c> and the write returns <c>Rejected</c>.
    /// <b>So the fix for "a string names producing paths it does not have" shipped with a string naming a
    /// producing path it does not have, and a test pinning it.</b> The assertion is now inverted: the clause
    /// must be ABSENT.</para></summary>
    [Fact]
    public void ReadOnly_NamesOnlyProducersThatExist_AndNotTheConnectorWithNoWritablePointsThatCannot()
    {
        var text = MachineWriteGate.ExplainUnavailable(MachineDriverAvailability.ReadOnly, Code);

        // The producers that genuinely reach this value: drivers built outside the connector path.
        Assert.Contains("built-in simulated group", text, StringComparison.Ordinal);
        Assert.Contains("hot-folder AOI demo pipeline", text, StringComparison.Ordinal);

        // 🔴 The inverted assertion. A connector with no writable points does NOT produce ReadOnly, and the
        // string must not offer it as an explanation — it would send an operator to edit a map that is not
        // the problem. Restoring the old clause turns this red.
        Assert.DoesNotContain(
            "or it has a connector whose driver declares no writable points",
            text, StringComparison.Ordinal);

        // And it must say what that state DOES do, since that is the operator's obvious next question.
        Assert.Contains("rejected", text, StringComparison.Ordinal);
    }

    /// <summary>🔴 <see cref="MachineDriverAvailability.Writable"/> means a write MAY be attempted, so there
    /// is nothing to explain and no honest string to return. It throws rather than returning a generic
    /// "unavailable" — a soothing default is how a caller that reached this by mistake ships an operator a
    /// sentence about a machine that was, in fact, writable. Both real call sites are structurally past this:
    /// each is only entered when the resolution handed back a <see langword="null"/> result.</summary>
    [Fact]
    public void Writable_HasNoExplanation_AndThrowsRatherThanReturningASoothingDefault()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => MachineWriteGate.ExplainUnavailable(MachineDriverAvailability.Writable, Code));

        Assert.Contains("Writable", ex.Message, StringComparison.Ordinal);
    }
}
