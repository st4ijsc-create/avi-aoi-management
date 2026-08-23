using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Mapping;
using Xunit;

/// <summary>
/// docs/owner-decisions.md item 55, executed by BI-1 2026-08-23 under the coordinator's delegation.
///
/// <para><b>WHAT THIS IS AND IS NOT.</b> Item 55's ruling was "name the out-of-domain value, do not fold it
/// into a valid answer, and do not change one in-domain answer". Nothing in this tree can produce an
/// out-of-domain <see cref="Verdict"/> today, so the changed arms are UNREACHABLE and NO TEST CAN EXERCISE
/// THEM. This file is therefore <b>a GUARD, NOT A WITNESS</b>: it was green on both sides of the fix and it
/// is not evidence the fix did anything. It exists to make the ONE event that would matter — a fifth member
/// arriving on the enum — impossible to land silently, and to pin the in-domain answers that must not move.
///
/// <para><b>The three laws this check owes, stated where its result shows up:</b>
/// <list type="number">
/// <item>IT CAN GO RED. Adding a member to <see cref="Verdict"/> fails
/// <see cref="Verdict_has_exactly_the_four_members_the_five_folding_sites_enumerate"/>. Measured, not
/// assumed: BI-1 added a fifth member, ran this class, saw it red, and reverted.</item>
/// <item>ITS FALSE-POSITIVE RATE IS ZERO BY CONSTRUCTION — it reads the enum's own members and this
/// assembly's own output. It cannot be reddened by machine state, ordering, or another suite.</item>
/// <item>WHAT IT DOES NOT MEASURE. It does NOT check that the five sites HANDLE a fifth member sensibly —
/// it only guarantees somebody has to look at them. It does not reach
/// <c>St4iMachineSimulator.ViewModels.MachineViewModel.StatusText</c> at all (different assembly, WPF,
/// not referenced from this project), nor
/// <c>St4i.EdgeCore.Fleet.MachineState.PassRate</c>, which applies the same fold WITHOUT a switch
/// (<c>!= Skip</c> into the denominator, <c>Pass or Warn</c> into the numerator) and was deliberately left
/// alone because moving it moves a reported rate.</item>
/// </list></para></para>
///
/// <para><b>THE POPULATION, LISTED BEFORE IT IS COUNTED.</b> Switch expressions over <see cref="Verdict"/>
/// carrying a discard arm, enumerated over every <c>*.cs</c> under <c>src/</c> at 44383e23:
/// <c>MachineState.StatusText</c> · <c>MachineViewModel.StatusText</c> ·
/// <c>Normalizer.ComputeOverallResult</c> · <c>Normalizer.VerdictToResult</c> ·
/// <c>Doc28Writer.MapVerdict</c>. That is FIVE. Item 55's own table lists the first four and names the
/// fifth only as a "relative", so the item's headline count does not survive re-measurement.</para>
/// </summary>
public class VerdictFoldingCensusTests
{
    private const string SiteRoster =
        "St4i.EdgeCore.Fleet.MachineState.StatusText, " +
        "St4iMachineSimulator.ViewModels.MachineViewModel.StatusText, " +
        "St4i.EdgeCore.Mapping.Normalizer.ComputeOverallResult, " +
        "St4i.EdgeCore.Mapping.Normalizer.VerdictToResult, " +
        "St4i.EdgeCore.Drivers.HotFolder.Doc28Writer.MapVerdict";

    /// <summary>The red-able half. A fifth member reaches five discard arms that will each answer for it
    /// without being asked, so the member must not arrive without a reader.</summary>
    [Fact]
    public void Verdict_has_exactly_the_four_members_the_five_folding_sites_enumerate()
    {
        var members = Enum.GetValues<Verdict>();

        Assert.Equal(
            new[] { Verdict.Pass, Verdict.Warn, Verdict.Fail, Verdict.Skip },
            members);

        Assert.True(
            members.Length == 4,
            $"Verdict now has {members.Length} members. FIVE switch expressions fold an unenumerated " +
            $"Verdict through a discard arm and none of them will fail to compile: {SiteRoster}. " +
            "Decide what the new member means at each of the five, then update this count. " +
            "(This check does NOT verify the five handle it sensibly — only that you were made to look.)");
    }

    /// <summary>The in-domain pin for both of item 55's same-file sites, reached through the one public
    /// entry point they sit behind. These four answers are what must NOT have moved; the arm that moved is
    /// unreachable and is absent from this test on purpose.</summary>
    [Fact]
    public void Normalizer_in_domain_verdict_answers_are_unchanged_by_item_55()
    {
        // ComputeOverallResult — inspection envelope, no measurements, so the coarse Verdict decides.
        Assert.Equal("OK", InspectionOverallResultFor(Verdict.Pass));
        Assert.Equal("OK", InspectionOverallResultFor(Verdict.Warn));
        Assert.Equal("NG", InspectionOverallResultFor(Verdict.Fail));
        Assert.Equal("NTF", InspectionOverallResultFor(Verdict.Skip));

        // VerdictToResult — process-result envelope. Untouched by BI-1; pinned here so the pair cannot
        // drift apart again the way item 55 measured them apart.
        Assert.Equal("pass", ProcessResultFor(Verdict.Pass));
        Assert.Equal("warn", ProcessResultFor(Verdict.Warn));
        Assert.Equal("fail", ProcessResultFor(Verdict.Fail));
        Assert.Equal("skip", ProcessResultFor(Verdict.Skip));
    }

    private static string InspectionOverallResultFor(Verdict v)
    {
        var reading = new DeviceReading
        {
            MachineCode = "AOI-01",
            Kind = ReadingKind.Inspection,
            SerialNumber = "SN1",
            CycleCounter = 1,
            Verdict = v,
            Timestamp = DateTimeOffset.Parse("2026-08-23T10:00:00+07:00"),
        };

        var env = Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.AoiAvi));
        return (string)env.Payload["overallResult"]!;
    }

    private static string ProcessResultFor(Verdict v)
    {
        var reading = new DeviceReading
        {
            MachineCode = "SCRW-01",
            Kind = ReadingKind.ProcessResult,
            SerialNumber = "SN1",
            StepType = "screw_tightening",
            RecipeCode = "RC1",
            CycleCounter = 1,
            Verdict = v,
            Timestamp = DateTimeOffset.Parse("2026-08-23T10:00:00+07:00"),
        };

        var env = Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.Automation));
        return (string)env.Payload["result"]!;
    }
}
