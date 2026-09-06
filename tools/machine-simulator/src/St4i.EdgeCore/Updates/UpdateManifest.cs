using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — the signed document at the centre of an update bundle. 🔴 <b>This is the ONLY thing
/// verified cryptographically, and it is deliberately small.</b>
///
/// <para><b>Why the signature covers this and not the MSI.</b> Signing a ~200 MB installer directly would
/// mean streaming the whole payload through <c>Ed25519Signer</c> on an appliance before anything could be
/// said about it. Signing a ~400-byte manifest that NAMES the installer's SHA-256 gives identical
/// security — an attacker who cannot forge the signature cannot change the hash, and cannot change the
/// bytes the hash names — with a digest that can be computed streaming, in chunks, with a progress bar,
/// and cancelled. That is the one structural decision in the delivery path, and it is why one signature
/// stack is enough for both licences and updates.</para>
///
/// <para>🔴 <b><c>RELEASE-NOTES.txt</c> is deliberately NOT named here and is deliberately NOT signed.</b>
/// It is prose for a human, it changes for reasons that have nothing to do with the payload, and putting
/// it inside the signature would mean a typo fix required a re-signing ceremony. The cost of that choice
/// is that its contents are UNTRUSTED INPUT: any surface that renders it must render it as inert text —
/// never executed, never interpreted as markup, and never styled so it can imitate a product prompt.
/// <see cref="UpdateBundle.ReleaseNotes"/> carries that warning at the point of use.</para>
/// </summary>
public sealed class UpdateManifest
{
    /// <summary>Manifest format version. A value above
    /// <see cref="UpdateManifestVerifier.SupportedManifestVersion"/> is a readable refusal, never a
    /// best-effort parse.</summary>
    [JsonPropertyName("v")]
    public int V { get; init; }

    /// <summary>Product identity. A bundle for another product is refused before anything else is read.</summary>
    [JsonPropertyName("product")]
    public string? Product { get; init; }

    /// <summary>The version this bundle installs, as the three-field string
    /// <c>Directory.Build.props</c> carries.</summary>
    [JsonPropertyName("version")]
    public string? Version { get; init; }

    /// <summary>The release line — <c>lts-1.0</c> or <c>current</c>. Cross-checked against
    /// <see cref="Version"/> so a mislabelled bundle cannot move a machine between lines silently.</summary>
    [JsonPropertyName("channel")]
    public string? Channel { get; init; }

    /// <summary>The oldest installed version this bundle may be applied over. The escape hatch for a
    /// release that cannot safely skip an intermediate schema step.</summary>
    [JsonPropertyName("minUpgradableFrom")]
    public string? MinUpgradableFrom { get; init; }

    /// <summary>
    /// 🔴 The <c>PRAGMA user_version</c> each SQLite store will be at AFTER this update, keyed by store
    /// name. <b>This is Task 1's discovery moved into pre-flight.</b>
    ///
    /// <para>Task 1 gave ten stores a ceiling that refuses a database from the future, which turned a
    /// silent 3am corruption into a loud 3am refusal. This field turns the loud 3am refusal into a
    /// DAYLIGHT one: pre-flight compares these numbers to what is on disk and tells the engineer, before
    /// the maintenance window opens, which stores this update migrates and therefore which ones a
    /// rollback will not simply undo.</para>
    /// </summary>
    [JsonPropertyName("schemaCeiling")]
    public Dictionary<string, int>? SchemaCeiling { get; init; }

    /// <summary>The payload files this manifest vouches for. Exactly one MSI in practice; a list because
    /// the format should not have to change to carry a second file.</summary>
    [JsonPropertyName("artifacts")]
    public List<UpdateArtifact>? Artifacts { get; init; }

    /// <summary>When ST4I issued this bundle. Informational — never a validity window, because an
    /// air-gapped machine's clock is not evidence about anything.</summary>
    [JsonPropertyName("issued")]
    public string? Issued { get; init; }
}

/// <summary>One payload file named by the manifest, bound to it by SHA-256.</summary>
public sealed class UpdateArtifact
{
    /// <summary>File name, relative to the bundle directory. 🔴 Verified to contain no directory
    /// separator and no <c>..</c> — a manifest is attacker-influenced input and a name like
    /// <c>..\..\Windows\System32\evil.msi</c> would otherwise escape the bundle.</summary>
    [JsonPropertyName("name")]
    public string? Name { get; init; }

    /// <summary>Expected size in bytes. Checked before the hash purely so a truncated copy is diagnosed
    /// as truncation rather than as a hash mismatch — it is not a security control, the hash is.</summary>
    [JsonPropertyName("size")]
    public long Size { get; init; }

    /// <summary>Lower-case hex SHA-256 of the file's bytes. 🔴 <b>This is what stands between an
    /// unverified 200 MB file and <c>msiexec</c>.</b></summary>
    [JsonPropertyName("sha256")]
    public string? Sha256 { get; init; }
}
