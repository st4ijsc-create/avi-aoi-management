namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — the outcome of verifying an update manifest. The deliberate twin of
/// <c>LicenseState</c>, and the distinctions carry the same meaning they do there, because an engineer
/// reading a refusal needs to know WHICH KIND of wrong it is before they know what to do about it.
/// </summary>
public enum UpdateVerificationState
{
    /// <summary>🔴 The bundle is malformed as a BUNDLE — a missing file, empty bytes, unparseable
    /// base64, or JSON that will not parse. Points the engineer at the media: a truncated copy to a USB
    /// stick is by far the most likely cause in this product's actual life.</summary>
    Corrupt = 0,

    /// <summary>🔴 The bytes are well-formed and the signature DOES NOT VERIFY. This is the serious one:
    /// the bundle was not signed by ST4I, or it was modified after signing. Never "try anyway".</summary>
    Invalid = 1,

    /// <summary>🔴 The signature verified — these really are ST4I's bytes — but the manifest declares a
    /// format version this build does not understand. A readable refusal, never a best-effort parse of a
    /// format that may have changed meaning. The exact <c>LicenseState.Unsupported</c> pattern.</summary>
    Unsupported = 2,

    /// <summary>The signature verified against this build's key and the manifest parsed at a supported
    /// version. 🔴 <b>This does not mean the bundle may be installed here</b> — product, version,
    /// <c>minUpgradableFrom</c>, the payload hash and pre-flight all still have to agree.</summary>
    Verified = 3,
}
