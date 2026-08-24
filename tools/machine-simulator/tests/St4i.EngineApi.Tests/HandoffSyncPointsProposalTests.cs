using System.Text.Json;
using St4i.EdgeCore.Config;
using St4i.EngineApi.Config;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// BV-1, 2026-08-24 — the witness for <c>docs/handoff/2026-08-24-sync-points-push-fields.json</c>, the
/// ONE artefact this repository has ever produced that is read by an engineer on ANOTHER product's
/// server team. A handoff file has no compiler, no consumer in this tree and no reviewer who already
/// knows the domain, so without something that RUNS it is prose that rots silently — and it rots in the
/// one direction that costs days: a field is added to <see cref="MeasurementPoint"/>, the proposal keeps
/// listing the old set, and the far team implements a schema that is short by one key.
///
/// <para><b>WHAT IT MEASURES.</b> Two things, and both are DERIVED at run time rather than pasted:
/// <list type="number">
///   <item>The file PARSES as JSON. A sample request body that cannot be parsed is not a deliverable,
///   and this is the cheapest possible way to be sure the shipped bytes are the bytes that parse.</item>
///   <item>The set of per-point keys in the sample that are NOT already in the published push contract
///   is EXACTLY the set of drift-key properties that <c>sync-points</c> has no slot for — computed from
///   <see cref="MeasurementPoint"/>, <see cref="SyncPointDto"/> and the production canonicalizer, never
///   from a literal list. Twenty-eight today; if that number moves because the domain type moved, this
///   goes red and names the difference in both directions.</item>
/// </list></para>
///
/// <para>🔴 <b>WHAT IT DOES NOT MEASURE, said here because the result is read here.</b>
/// <list type="bullet">
///   <item>It says NOTHING about whether the SYNAPSE server accepts, or will ever accept, any of these
///   keys. The proposal is an ASK; a green run means the ask is internally consistent, not agreed.</item>
///   <item>It does not read the accompanying <c>.md</c> at all. Every unit, range and convention
///   described there is unchecked prose — this instrument only pins the KEY SETS.</item>
///   <item>It does not check VALUES. A key carrying a nonsensical number passes here.</item>
///   <item>It cannot see the push path's own code. The "already in the contract" side is read off
///   <see cref="SyncPointDto"/>'s serialized shape, so a key that DTO declares but
///   <c>ConfigSyncEngine.ToWireDto</c> never fills still counts as present.</item>
/// </list></para>
/// </summary>
public sealed class HandoffSyncPointsProposalTests
{
    /// <summary>The proposal document's own name for itself, so a failure message can be pasted into a
    /// path bar. Kept beside the locator rather than inline for the same reason the locator throws with
    /// the search root in it: a test that cannot find its subject must say where it looked.</summary>
    private const string ProposalRelativePath = "docs/handoff/2026-08-24-sync-points-push-fields.json";

    /// <summary>The ONE key whose name differs between the domain type and the push contract:
    /// <see cref="MeasurementPoint.ReferenceImageUrl"/> travels as <c>imageUrl</c>
    /// (CONFIG_SYNC_SERVER_CONTRACT.md §"Push up"). It is a RENAME, not an absence, so it must be
    /// subtracted by hand — and it is spelled out here rather than folded into a literal list so that
    /// the exception stays one line and stays visible.</summary>
    private const string RenamedOnTheWire = "referenceImageUrl";

    /// <summary>Walks up from the test binary to <c>tools/machine-simulator</c>, matching
    /// <c>InstallerHarvestExclusionTests.MachineSimulatorRoot</c>'s established shape (three markers, not
    /// one, so a coincidentally-named parent cannot satisfy it).</summary>
    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "docs")) &&
                Directory.Exists(Path.Combine(dir.FullName, "src")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (fleet.json + docs/ + src/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". With no tree this instrument has measured NOTHING, so it " +
            "fails rather than reporting a clean run.");
    }

    private static JsonDocument ReadProposal()
    {
        var path = Path.Combine(MachineSimulatorRoot(), ProposalRelativePath.Replace('/', Path.DirectorySeparatorChar));
        Assert.True(
            File.Exists(path),
            $"The handoff proposal is missing at \"{path}\". This file is the deliverable an engineer on " +
            "another product's team reads; deleting it without deleting this witness is the failure this " +
            "witness exists to catch.");

        var text = File.ReadAllText(path);
        try
        {
            return JsonDocument.Parse(text);
        }
        catch (JsonException ex)
        {
            throw new Xunit.Sdk.XunitException(
                $"\"{path}\" is not parseable JSON: {ex.Message}. It is handed to a third party to paste " +
                "into a request body, so a parse failure here is a broken deliverable, not a style issue. " +
                "NOTE: JSON has no comment syntax — if an explanatory line was added, it belongs in the " +
                "accompanying .md, not in this file.");
        }
    }

    /// <summary>The camelCase wire keys of ONE point as the domain type serializes it — i.e. the shape
    /// <c>get-points</c> fills, since <c>LiveConfigSyncWireDtos</c> deserializes straight into
    /// <see cref="MeasurementPoint"/>.</summary>
    private static HashSet<string> DomainPointKeys() =>
        JsonSerializer.SerializeToElement(new MeasurementPoint(), ConfigJson.Options)
            .EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

    /// <summary>The camelCase wire keys the PUSH contract already carries, read off the contract-faithful
    /// DTO itself rather than off a list.</summary>
    private static HashSet<string> PushContractKeys() =>
        JsonSerializer.SerializeToElement(
                new SyncPointDto(
                    Code: "", Name: "", Description: null, MeasurementType: "", Unit: null,
                    LowerLimit: null, UpperLimit: null, NominalValue: null,
                    PositionX: 0, PositionY: 0, Radius: null,
                    NormalizedX: null, NormalizedY: null, NormalizedRadius: null,
                    CropWidth: null, CropHeight: null, OrderIndex: null,
                    WorkstationCode: null, IsActive: null,
                    ImageBase64: null, ImageMimeType: null, ImageUrl: null,
                    Shape: null, Geometry: null, ExpectedUpdatedAt: null),
                ConfigJson.Options)
            .EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

    /// <summary>The audit fields <see cref="ConfigChecksum.CanonicalizePoint(MeasurementPoint)"/> strips
    /// before hashing — read from the PRODUCTION canonicalizer, so this set cannot drift away from the
    /// drift key it is meant to describe.</summary>
    private static HashSet<string> DriftKeyPointKeys()
    {
        var canonical = ConfigChecksum.CanonicalizePoint(new MeasurementPoint());
        return canonical.Keys.Select(ToCamel).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>The canonicalizer serializes with no naming policy, so its keys are PascalCase while the
    /// wire is camelCase. One ASCII-safe lowering of the first character is the whole of the difference —
    /// every property name on this type is ASCII, which is why this is sufficient rather than merely
    /// convenient.</summary>
    private static string ToCamel(string s) =>
        string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s[1..];

    /// <summary>The measured population: in the drift key, and with no slot on the push path.</summary>
    private static HashSet<string> MissingPushSlots()
    {
        var missing = DriftKeyPointKeys();
        missing.ExceptWith(PushContractKeys());
        missing.Remove(RenamedOnTheWire);
        return missing;
    }

    [Fact]
    public void The_handoff_proposal_is_parseable_json_with_one_product_and_one_point()
    {
        using var doc = ReadProposal();

        Assert.Equal(JsonValueKind.Object, doc.RootElement.ValueKind);
        Assert.True(
            doc.RootElement.TryGetProperty("productModelCode", out _),
            "The sample is meant to be a complete POST /api/machine/sync-points body; without " +
            "productModelCode it is not one, and the far team cannot curl it.");
        Assert.True(doc.RootElement.TryGetProperty("points", out var points));
        Assert.Equal(JsonValueKind.Array, points.ValueKind);
        Assert.Equal(1, points.GetArrayLength());
    }

    /// <summary>
    /// 🔴 THE ASSERTION THIS FILE EXISTS FOR. The population is DERIVED — drift-key properties of
    /// <see cref="MeasurementPoint"/> minus the keys <see cref="SyncPointDto"/> already carries minus the
    /// single documented rename — so a property added to the domain type moves this set and reddens the
    /// proposal that no longer lists it. The count is asserted SECOND and separately: the SET is the
    /// claim, and 28 is a consequence of it, which is the order this repository's records require.
    /// </summary>
    [Fact]
    public void The_proposed_keys_are_exactly_the_measured_fields_with_no_push_slot()
    {
        using var doc = ReadProposal();
        var point = doc.RootElement.GetProperty("points")[0];

        var sampleKeys = point.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        var contract = PushContractKeys();
        var proposed = sampleKeys.Where(k => !contract.Contains(k)).ToHashSet(StringComparer.Ordinal);
        var measured = MissingPushSlots();

        var absent = measured.Except(proposed).OrderBy(k => k, StringComparer.Ordinal).ToList();
        var extra = proposed.Except(measured).OrderBy(k => k, StringComparer.Ordinal).ToList();

        Assert.True(
            absent.Count == 0 && extra.Count == 0,
            $"\"{ProposalRelativePath}\" no longer proposes the measured population.\n" +
            $"  MEASURED but NOT in the sample ({absent.Count}): {string.Join(", ", absent)}\n" +
            $"  IN the sample but NOT measured ({extra.Count}): {string.Join(", ", extra)}\n" +
            "Both directions are listed because a proposal that is SHORT makes the far team build a " +
            "schema that still loses operator edits, and a proposal that is LONG makes them build slots " +
            "for fields this machine never sends. Fix the JSON, and re-read the .md beside it — the " +
            "field table there is prose and nothing checks it.");

        Assert.Equal(28, measured.Count);
    }

    /// <summary>
    /// The leaf level, pinned because the accompanying document COMMITS to one: 27 scalar/JSON keys on
    /// the point plus 12 leaves inside each <c>lighting</c> element = 39. A schema that is vague about
    /// depth is a schema nobody can implement, so the depth claim gets a witness too.
    /// </summary>
    [Fact]
    public void The_lighting_element_carries_every_leaf_of_the_domain_type()
    {
        using var doc = ReadProposal();
        var lighting = doc.RootElement.GetProperty("points")[0].GetProperty("lighting");
        Assert.Equal(JsonValueKind.Array, lighting.ValueKind);

        var domainLeaves = JsonSerializer.SerializeToElement(new LightingShot(), ConfigJson.Options)
            .EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        Assert.Equal(12, domainLeaves.Count);

        var union = new HashSet<string>(StringComparer.Ordinal);
        foreach (var shot in lighting.EnumerateArray())
        {
            foreach (var leaf in shot.EnumerateObject())
            {
                Assert.True(
                    domainLeaves.Contains(leaf.Name),
                    $"lighting[] carries \"{leaf.Name}\", which is not a LightingShot leaf. The far team " +
                    "would build a column for a field this machine cannot produce.");
                union.Add(leaf.Name);
            }
        }

        var uncovered = domainLeaves.Except(union).OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.True(
            uncovered.Count == 0,
            $"The sample's lighting shots never demonstrate: {string.Join(", ", uncovered)}. Every leaf " +
            "needs a typed example somewhere in the array, or the far team is guessing at that key's " +
            "type from prose alone.");

        // 27 on the point + 12 in the shot = the 39 the document commits to. Asserted as an arithmetic
        // identity over the two measured sets rather than as a literal, so it cannot disagree with them.
        Assert.Equal(39, MissingPushSlots().Count - 1 + domainLeaves.Count);
    }
}
