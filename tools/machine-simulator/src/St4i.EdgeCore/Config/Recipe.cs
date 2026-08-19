using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>Publish state of a recipe version — mirrors <c>machine_recipes.status</c>
/// (<c>draft|active|archived</c>). Note: this is System A's recipe row, a config-domain concept —
/// unrelated to (and, importantly, a different CLR type from) the small submission-time
/// <c>St4i.DeviceClient.Recipe</c> DTO <c>LiveTransport</c> attaches to a process-result POST. Files
/// that need both must qualify one of them; nothing under <c>Config/</c> takes a
/// <c>using St4i.DeviceClient;</c> for exactly this reason.</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum RecipeStatus
{
    /// <summary>Wire value <c>"draft"</c> — the value a newly constructed <see cref="Recipe"/> starts
    /// at. A draft is still addressable by exact <see cref="Recipe.Code"/>, but it is INVISIBLE to the
    /// machine-type fallback: the Demo ecosystem's <c>resolvedBy:"machineType"</c> search requires
    /// <see cref="Active"/>, so a draft recipe silently never becomes any machine's recipe.</summary>
    Draft,

    /// <summary>Wire value <c>"active"</c> — the published version, and the only status the machine-type
    /// fallback will resolve to (see <see cref="Recipe.MachineType"/>). The server enforces at most one
    /// active row per code with a partial unique index; nothing on this side does, so a locally-seeded
    /// or hand-edited <c>recipes.json</c> can hold two.</summary>
    Active,

    /// <summary>Wire value <c>"archived"</c> — retired, kept for history. Treated exactly like
    /// <see cref="Draft"/> by everything here: findable by code, never resolved by machine type. The
    /// distinction between the two is meaning for a human, not behaviour.</summary>
    Archived,
}

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
    /// <summary>Natural key, mirroring <c>machine_recipes.code</c>, and the store's dictionary key
    /// (case-insensitive). It is also the FIRST of the contract's two resolution paths: a lookup that
    /// supplies a code and finds it answers <c>resolvedBy:"machine"</c>, ahead of the
    /// <see cref="MachineType"/> fallback below. The server keys uniqueness on
    /// <c>(code, version)</c> and keeps every version; this type holds ONE version of one code, so a
    /// re-pull replaces the row rather than accumulating history beside it.</summary>
    public string Code { get; set; } = "";

    /// <summary>Operator-facing label, mirroring <c>machine_recipes.name</c>. Carried through to the
    /// HMI's recipe list; nothing resolves or matches on it.</summary>
    public string Name { get; set; } = "";

    /// <summary>The machine class this recipe is written for, matched against a machine's
    /// <see cref="Models.MachineDescriptor.MachineType"/> from <c>fleet.json</c> (<c>SCREWDRIVE</c>,
    /// <c>IOT_SENSOR</c>, …). It is the SECOND resolution path — the contract's
    /// <c>resolvedBy:"machineType"</c> — reached only when no exact <see cref="Code"/> was supplied or
    /// found. 🔴 That search is an ordinal-ignore-case match on this field AND
    /// <see cref="Status"/> being <see cref="RecipeStatus.Active"/>, and it takes the FIRST hit out of
    /// a dictionary's value order: two active recipes claiming the same machine type resolve
    /// arbitrarily, and neither this type nor the store rejects that pairing. Null means "resolvable by
    /// code only".</summary>
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

    /// <summary>Publish state, mirroring <c>machine_recipes.status</c>. Its one behavioural
    /// consequence in this solution is the machine-type resolution gate described on
    /// <see cref="MachineType"/> and on each <see cref="RecipeStatus"/> member: only
    /// <see cref="RecipeStatus.Active"/> can be reached that way. Defaults to
    /// <see cref="RecipeStatus.Draft"/>, so a recipe constructed and stored without setting this is
    /// unreachable by every machine that does not name it by code.</summary>
    public RecipeStatus Status { get; set; } = RecipeStatus.Draft;

    /// <summary>Increments <see cref="Version"/> by one — the whole of what "a new recipe version"
    /// means locally. 🔴 It does NOT refresh <see cref="Checksum"/>, and it does not have to: the
    /// checksum is a digest of <see cref="Payload"/> alone, so a version bump with unchanged settings
    /// correctly leaves the drift key where it was. Bumping and editing <see cref="Payload"/> are
    /// separate acts, and the second one is what
    /// <see cref="ProductConfigStore.UpsertRecipe"/>'s <see cref="RecomputeChecksum"/> call
    /// covers.</summary>
    public void BumpVersion() => Version++;

    /// <summary>Recomputes <see cref="Checksum"/> from the current <see cref="Payload"/> via
    /// <see cref="ConfigChecksum"/> and stores it. Returns the new value.</summary>
    public string RecomputeChecksum()
    {
        Checksum = ConfigChecksum.Compute(Payload);
        return Checksum;
    }
}
