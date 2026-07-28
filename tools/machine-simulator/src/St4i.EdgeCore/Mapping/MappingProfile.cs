using System.Text.Json;

namespace St4i.EdgeCore.Mapping;

/// <summary>
/// Per-device (or per-device-class) mapping configuration consumed by <see cref="Normalizer"/>.
/// Kept intentionally small for Task 4 — later tasks may extend with richer field-level overrides.
/// </summary>
public class MappingProfile
{
    public string Name { get; set; } = "default";
    public string DeviceClass { get; set; } = "";
    public string? DefaultStepType { get; set; }
    public string? DefaultRecipeCode { get; set; }
    public Dictionary<string, string> UnitMap { get; set; } = new();

    public static MappingProfile FromJson(string json)
    {
        var profile = JsonSerializer.Deserialize<MappingProfile>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        return profile ?? new MappingProfile();
    }

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
