using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>Publish state of a recipe version — mirrors <c>machine_recipes.status</c>
/// (<c>draft|active|archived</c>). Note: this is System A's recipe row, a config-domain concept —
/// unrelated to (and, importantly, a different CLR type from) the small submission-time
/// <c>St4i.DeviceClient.Recipe</c> DTO <c>LiveTransport</c> attaches to a process-result POST. Files
/// that need both must qualify one of them; nothing under <c>Config/</c> takes a
/// <c>using St4i.DeviceClient;</c> for exactly this reason.</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum RecipeStatus { Draft, Active, Archived }

/// <summary>
/// One automation/IoT recipe version (System A: <c>device_settings</c>/<c>recipe</c> config-sync) —
/// the edge-local mirror of a <c>machine_recipes</c> row. Per
/// CONFIG_SYNC_SERVER_CONTRACT.md, System A is server-authoritative and pull-only (machines cannot
/// author recipes against the real server — human-authored in SYNAPSE UI, 2-person approve), so this
/// type exists in EdgeCore mainly so the Demo backend (C2) can simulate authoring locally and Live
/// (C3) can hold a pulled recipe.
/// </summary>
public sealed class Recipe
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? MachineType { get; set; }

    /// <summary>Incrementing integer, string-serialized on the wire per the contract
    /// (<c>version:"&lt;int&gt;"</c>) — kept as a real <see cref="int"/> here since this is the
    /// internal domain model, not the wire DTO; a later transport layer does that string
    /// conversion.</summary>
    public int Version { get; set; } = 1;

    /// <summary>The recipe's actual settings, e.g. <c>{speedRpm,angleTarget,torqueTarget,
    /// torqueTolerance}</c> for a SCREWDRIVE machine. Keys/values are open — different
    /// <see cref="MachineType"/>s use different shapes — so this stays a plain dictionary rather than
    /// a typed payload class.</summary>
    public Dictionary<string, object?> Payload { get; set; } = new();

    /// <summary>sha256 of <see cref="Payload"/>'s stable-stringified form — the authoritative drift
    /// key per the contract. Kept in sync with <see cref="Payload"/> via <see cref="RecomputeChecksum"/>
    /// (which <see cref="ProductConfigStore.UpsertRecipe"/> always calls) rather than being settable
    /// independently, so a stored <see cref="Recipe"/> can never carry a checksum that doesn't
    /// actually match its payload.</summary>
    public string? Checksum { get; set; }

    public RecipeStatus Status { get; set; } = RecipeStatus.Draft;

    public void BumpVersion() => Version++;

    /// <summary>Recomputes <see cref="Checksum"/> from the current <see cref="Payload"/> via
    /// <see cref="ConfigChecksum"/> and stores it. Returns the new value.</summary>
    public string RecomputeChecksum()
    {
        Checksum = ConfigChecksum.Compute(Payload);
        return Checksum;
    }
}
