namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — the verdict of a dry run. 🔴 <b><see cref="Ok"/> being <see langword="true"/> is the
/// ONLY thing that entitles anything to touch the payload</b>, and <see cref="VerifiedPayloadPath"/> is
/// non-null exactly when it is — so an applier that reaches for the path cannot accidentally reach for an
/// unverified one.
/// </summary>
public sealed class UpdatePreflightResult
{
    private UpdatePreflightResult(
        bool ok, UpdateVerificationState state, string? reason, UpdateManifest? manifest, string? payloadPath)
    {
        Ok = ok;
        State = state;
        Reason = reason;
        Manifest = manifest;
        VerifiedPayloadPath = payloadPath;
    }

    /// <summary>🔴 <see langword="true"/> only when the signature verified, the manifest is for this
    /// product, the version moves forward, <c>minUpgradableFrom</c> is satisfied, and every payload's
    /// SHA-256 matched the signed manifest.</summary>
    public bool Ok { get; }

    /// <summary>How far verification got. Distinguishes "the media is damaged" from "these are not ST4I's
    /// bytes", which are different conversations with the customer.</summary>
    public UpdateVerificationState State { get; }

    /// <summary>🔴 Why it was refused, written for an engineer with no internet and no colleague. Every
    /// refusal says what was wrong, what to do, and — because the reader is under pressure — that nothing
    /// has been changed.</summary>
    public string? Reason { get; }

    /// <summary>The verified manifest, or <see langword="null"/> when verification did not complete.
    /// 🔴 Non-null means these fields came out of bytes ST4I signed.</summary>
    public UpdateManifest? Manifest { get; }

    /// <summary>
    /// 🔴🔴 The full path of the payload whose SHA-256 <b>matched the signed manifest</b>, or
    /// <see langword="null"/>. <b>This is the only path in the system that anything is permitted to hand
    /// to <c>msiexec</c>.</b> It is null on every refusal, so the apply path cannot get a path out of a
    /// failed dry run even by mistake.
    /// </summary>
    public string? VerifiedPayloadPath { get; }

    /// <summary>Builds a passing verdict. Internal to the update namespace by intent: only
    /// <see cref="UpdatePreflight"/> may declare a bundle verified.</summary>
    /// <param name="manifest">The verified manifest.</param>
    /// <param name="payloadPath">The payload whose hash matched.</param>
    /// <returns>The verdict.</returns>
    internal static UpdatePreflightResult Passed(UpdateManifest manifest, string payloadPath) =>
        new(true, UpdateVerificationState.Verified, null, manifest, payloadPath);

    /// <summary>Builds a refusal.</summary>
    /// <param name="state">How far verification got.</param>
    /// <param name="reason">The engineer-facing explanation.</param>
    /// <returns>The verdict.</returns>
    internal static UpdatePreflightResult Refused(UpdateVerificationState state, string reason) =>
        new(false, state, reason, null, null);
}
