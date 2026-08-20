using System.Text.Json;

namespace St4i.EdgeCore.Mapping;

/// <summary>
/// Per-device (or per-device-class) mapping configuration consumed by <see cref="Normalizer"/>.
/// Kept intentionally small for Task 4 — later tasks may extend with richer field-level overrides.
/// </summary>
public class MappingProfile
{
    /// <summary>🔴 Carried, not consumed. It is round-tripped out of the preset file and the only thing
    /// in the repository that reads it is the packaging test that asserts each shipped preset's
    /// <c>name</c> equals its own FILE NAME — no code on the normalization path branches on it, and the
    /// resolver keys its map on the machine code rather than on this. So a preset whose <c>name</c>
    /// disagrees with its filename changes nothing at runtime and fails only that test.</summary>
    public string Name { get; set; } = "default";

    /// <summary>🔴 A free string, NOT the <see cref="St4i.Connector.Abstractions.Models.DeviceClass"/>
    /// enum, and — like <see cref="Name"/> — read by nothing except the packaging test. Nothing
    /// reconciles it with the class of the machine the profile is applied to: the resolver chooses the
    /// FILE by the descriptor's own <c>mappingProfile</c> field, so a machine registered as
    /// <c>Automation</c> whose fleet entry names <c>aoi</c> is normalized with a profile that declares
    /// <c>AoiAvi</c> here, silently and with no warning. It is documentation for whoever opens the JSON,
    /// not a constraint.</summary>
    public string DeviceClass { get; set; } = "";

    /// <summary>The step type to stamp on a PROCESS-RESULT payload when the reading did not carry one.
    /// Consulted on that path only — telemetry and inspection payloads have no step type at all — and it
    /// is the middle of three: the reading's own value wins, this is the fallback, and the literal
    /// <c>"process"</c> is what is sent when this is <see langword="null"/> too. That last case is
    /// reachable from <see cref="ForClass"/>, whose default arm leaves this unset.</summary>
    public string? DefaultStepType { get; set; }

    /// <summary>The recipe code to stamp on a PROCESS-RESULT payload when the reading did not carry one.
    /// Same process-result-only scope and same precedence as <see cref="DefaultStepType"/>, but the
    /// bottom of the chain is different: when neither the reading nor this supplies a code, the
    /// <c>recipe</c> object is OMITTED from the payload entirely rather than sent empty. Five of the
    /// seven shipped presets set a code here, so for those machines a driver that reports no recipe still
    /// produces results attributed to one. The two that leave it unset are the IoT presets, whose
    /// readings are telemetry and never reach the path that reads this at all.</summary>
    public string? DefaultRecipeCode { get; set; }

    /// <summary>Unit rewrites applied on the way out, keyed by the unit string the DRIVER produced.
    /// It reaches every unit the normalizer emits — metric, waveform, telemetry sample and inspection
    /// measurement — and is a plain dictionary lookup: an unmapped unit is passed through unchanged, a
    /// null unit stays null, and the match is exact and case-sensitive, so <c>c</c> and <c>C</c> are two
    /// different keys. It is not decorative today: three of the seven shipped presets use it to rewrite
    /// <c>C</c> to <c>°C</c>, i.e. to put a character into the payload that a driver would otherwise have
    /// to emit itself.</summary>
    public Dictionary<string, string> UnitMap { get; set; } = new();

    /// <summary>Parses one preset file's contents. Property matching is case-INSENSITIVE, so a preset
    /// may spell its keys either way; a JSON <c>null</c> document yields a default profile rather than a
    /// null reference. It does NOT swallow bad input — malformed JSON throws, and the only production
    /// caller catches that and falls back to <see cref="ForClass"/>, which is where the
    /// "one bad preset can never take the fleet down" property actually lives. Unknown keys are ignored
    /// silently, so a preset that misspells <c>defaultStepType</c> parses cleanly and does
    /// nothing.</summary>
    public static MappingProfile FromJson(string json)
    {
        var profile = JsonSerializer.Deserialize<MappingProfile>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        return profile ?? new MappingProfile();
    }

    /// <summary>The built-in profile for a device class — what a machine gets when its fleet entry names
    /// no preset, or names one that is missing, unreadable or malformed. Each of the three arms sets only
    /// a <see cref="Name"/>, a <see cref="DeviceClass"/> and a <see cref="DefaultStepType"/>; a built-in
    /// profile therefore carries NO <see cref="DefaultRecipeCode"/> and an EMPTY
    /// <see cref="UnitMap"/>, which is the substantive difference between falling back and loading the
    /// matching preset file — units stop being rewritten and results stop carrying a recipe.
    ///
    /// <para>The <c>_</c> arm is unreachable for any declared value: this enum has exactly three members
    /// and all three are matched above. It answers only an out-of-range cast, and it is the one arm that
    /// leaves <see cref="DefaultStepType"/> null, which is what makes the literal <c>"process"</c> in the
    /// normalizer reachable at all.</para></summary>
    public static MappingProfile ForClass(St4i.Connector.Abstractions.Models.DeviceClass c) => c switch
    {
        St4i.Connector.Abstractions.Models.DeviceClass.Automation => new MappingProfile
        {
            Name = "automation-default",
            DeviceClass = nameof(St4i.Connector.Abstractions.Models.DeviceClass.Automation),
            DefaultStepType = "process",
        },
        St4i.Connector.Abstractions.Models.DeviceClass.AoiAvi => new MappingProfile
        {
            Name = "aoi-avi-default",
            DeviceClass = nameof(St4i.Connector.Abstractions.Models.DeviceClass.AoiAvi),
            DefaultStepType = "inspection",
        },
        St4i.Connector.Abstractions.Models.DeviceClass.Iot => new MappingProfile
        {
            Name = "iot-default",
            DeviceClass = nameof(St4i.Connector.Abstractions.Models.DeviceClass.Iot),
            DefaultStepType = "telemetry",
        },
        _ => new MappingProfile { Name = "default", DeviceClass = c.ToString() },
    };
}
