namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — 🔴🔴 <b>THE DRY RUN. Steps 1 to 5 of the apply sequence, and it changes NOTHING.</b>
///
/// <para><b>Why a dry run is a product feature and not a debugging aid.</b> A maintenance window is short,
/// scheduled, and expensive to reopen. Discovering inside it that the stick was copied while the operator
/// pulled it out — the single most likely corruption in this product's real life — costs the whole window.
/// <see cref="Run"/> answers every question that can be answered from files alone: is this bundle signed
/// by ST4I, is it for this product, does it move the version forward, may it be applied over what is
/// installed, and are the payload bytes intact. An engineer runs it at their desk on Tuesday.</para>
///
/// <para>🔴 <b>NOTHING HERE MAY CHANGE THE MACHINE, and that is a structural property rather than a
/// promise.</b> This type has no reference to any process launcher, no writable path, and no
/// <c>msiexec</c> anywhere in its dependency cone — it is in the same assembly as the verifier and knows
/// nothing about applying anything. That is what lets <c>UpdateApplier</c> hold the sequence gate and be
/// tested for it independently.</para>
///
/// <para>🔴 <b>ORDER IS THE SECURITY PROPERTY, not merely tidiness.</b> The signature is verified over the
/// manifest's raw bytes FIRST; the manifest is parsed only after; and <b>the MSI is not opened, not
/// parsed, not sized for a UI field and not handed to anything until its SHA-256 matches the verified
/// manifest.</b> A pre-flight that read the installer's own ProductVersion "just to show the engineer what
/// they are about to install" would be parsing unverified bytes with a privileged process, which is the
/// exact hole this whole design exists to close.</para>
/// </summary>
public static class UpdatePreflight
{
    /// <summary>
    /// Runs steps 1 to 5 against a bundle. Pure computation on files.
    /// </summary>
    /// <param name="bundle">The candidate bundle.</param>
    /// <param name="installedVersion">The version currently installed, as
    /// <c>GET /v1/capabilities</c> reports it.</param>
    /// <param name="verifier">The verifier — the production one by default; tests inject one holding a
    /// key they minted in memory.</param>
    /// <returns>A verdict naming every step that ran and the first that failed.</returns>
    public static UpdatePreflightResult Run(
        UpdateBundle bundle, string installedVersion, UpdateManifestVerifier? verifier = null)
    {
        ArgumentNullException.ThrowIfNull(bundle);
        verifier ??= new UpdateManifestVerifier();

        // ── STEP 1. Read the manifest and its signature as BYTES, and verify before parsing. ──────────
        var manifestBytes = bundle.ReadManifestBytes();
        var signature = bundle.ReadSignatureText();

        var state = verifier.Verify(manifestBytes, signature, out var manifest, out var diagnostic);

        // ── STEP 2. An unsupported manifest version is a readable refusal, folded into Verify. ────────
        if (state != UpdateVerificationState.Verified || manifest is null)
        {
            return UpdatePreflightResult.Refused(state, diagnostic ?? "The update manifest did not verify.");
        }

        // ── Everything below this line is reading a document ST4I signed. ─────────────────────────────

        // ── STEP 3a. The right product. ───────────────────────────────────────────────────────────────
        if (!string.Equals(manifest.Product, ExpectedProduct, StringComparison.OrdinalIgnoreCase))
        {
            return UpdatePreflightResult.Refused(
                UpdateVerificationState.Verified,
                $"This bundle is signed by ST4I but is for '{manifest.Product}', not " +
                $"'{ExpectedProduct}'. It cannot be installed on this machine.");
        }

        // ── STEP 3b. Forward only. 🔴 Refused HERE, in our own code, with our own message — never left
        //    to MajorUpgrade's DowngradeErrorMessage, because by the time MSI says it, msiexec is
        //    already running and the engineer has already committed to the window. ─────────────────────
        if (!TryCompareVersions(manifest.Version, installedVersion, out var comparison, out var versionError))
        {
            return UpdatePreflightResult.Refused(UpdateVerificationState.Verified, versionError!);
        }

        if (comparison == 0)
        {
            return UpdatePreflightResult.Refused(
                UpdateVerificationState.Verified,
                $"Version {manifest.Version} is already installed. There is nothing to do.");
        }

        if (comparison < 0)
        {
            return UpdatePreflightResult.Refused(
                UpdateVerificationState.Verified,
                $"This bundle installs version {manifest.Version}, which is OLDER than the installed " +
                $"version {installedVersion}. Windows Installer cannot downgrade this product, and going " +
                "back to an earlier version is a decommission-and-reinstall, not an update. Nothing has " +
                "been changed.");
        }

        // ── STEP 4. minUpgradableFrom — the escape hatch for a release that cannot skip a step. ───────
        if (!string.IsNullOrWhiteSpace(manifest.MinUpgradableFrom))
        {
            if (!TryCompareVersions(installedVersion, manifest.MinUpgradableFrom, out var floor, out var floorError))
            {
                return UpdatePreflightResult.Refused(UpdateVerificationState.Verified, floorError!);
            }

            if (floor < 0)
            {
                return UpdatePreflightResult.Refused(
                    UpdateVerificationState.Verified,
                    $"This bundle may only be installed over version {manifest.MinUpgradableFrom} or " +
                    $"newer; this machine is on {installedVersion}. Install an intermediate version " +
                    "first. Nothing has been changed.");
            }
        }

        // ── STEP 5. Hash the payload, streaming, and compare to the SIGNED manifest. ──────────────────
        //    🔴 THIS IS THE GATE. Until it passes, the MSI is a file of unknown bytes and nothing in this
        //    product may open it, parse it, or hand it to msiexec.
        if (manifest.Artifacts is null || manifest.Artifacts.Count == 0)
        {
            return UpdatePreflightResult.Refused(
                UpdateVerificationState.Verified,
                "The signed manifest names no payload files, so there is nothing this bundle could install.");
        }

        string? payloadPath = null;
        foreach (var artifact in manifest.Artifacts)
        {
            if (!bundle.TryResolveArtifactPath(artifact.Name, out var path) || path is null)
            {
                return UpdatePreflightResult.Refused(
                    UpdateVerificationState.Verified,
                    $"The manifest names a payload '{artifact.Name}' that is not a plain file name inside " +
                    "the bundle. Refused: a payload path that can leave the bundle directory could point " +
                    "at bytes this manifest never covered.");
            }

            if (!File.Exists(path))
            {
                return UpdatePreflightResult.Refused(
                    UpdateVerificationState.Verified,
                    $"The bundle is incomplete: the manifest names '{artifact.Name}' but that file is not " +
                    "present. The copy to this media was probably interrupted — recopy the whole folder.");
            }

            var actualSize = new FileInfo(path).Length;
            if (artifact.Size > 0 && actualSize != artifact.Size)
            {
                // Size before hash ONLY so truncation is diagnosed as truncation. The hash is the control.
                return UpdatePreflightResult.Refused(
                    UpdateVerificationState.Verified,
                    $"'{artifact.Name}' is {actualSize} bytes; the signed manifest says {artifact.Size}. " +
                    "The file is truncated or was modified — recopy the whole folder from the original " +
                    "media. Nothing has been installed.");
            }

            var actualHash = UpdateBundle.ComputeSha256(path);
            if (actualHash is null)
            {
                return UpdatePreflightResult.Refused(
                    UpdateVerificationState.Verified,
                    $"'{artifact.Name}' could not be read to the end. If it is on removable media, the " +
                    "media may be failing. Nothing has been installed.");
            }

            if (!string.Equals(actualHash, artifact.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                return UpdatePreflightResult.Refused(
                    UpdateVerificationState.Verified,
                    $"'{artifact.Name}' does not match the signed manifest. Expected SHA-256 " +
                    $"{artifact.Sha256}, found {actualHash}. These are NOT the bytes ST4I signed: the file " +
                    "is damaged or has been replaced. It has NOT been opened and NOT been installed.");
            }

            payloadPath ??= path;
        }

        return UpdatePreflightResult.Passed(manifest, payloadPath!);
    }

    /// <summary>The product identity a bundle must declare. A bundle for anything else is refused before
    /// any version arithmetic happens.</summary>
    public const string ExpectedProduct = "st4i-machine-simulator";

    /// <summary>
    /// Compares two version strings field by field.
    ///
    /// <para>🔴 Compares at most the FIRST THREE fields, because that is what Windows Installer compares
    /// in <c>ProductVersion</c>: two builds differing only in a fourth field are the same product to MSI
    /// and <c>MajorUpgrade</c> will not fire. Measured on this tree, the trap is currently absent rather
    /// than merely dormant — <c>Directory.Build.props</c> carries the three-field <c>1.0.0</c> and
    /// <c>build-installer.ps1</c> passes it straight through — so this method agreeing with MSI keeps it
    /// absent instead of quietly reintroducing a disagreement.</para>
    /// </summary>
    /// <param name="left">The left version.</param>
    /// <param name="right">The right version.</param>
    /// <param name="comparison">Negative, zero or positive as <paramref name="left"/> orders against
    /// <paramref name="right"/>.</param>
    /// <param name="error">Why the comparison could not be made.</param>
    /// <returns><see langword="true"/> when both parsed.</returns>
    public static bool TryCompareVersions(
        string? left, string? right, out int comparison, out string? error)
    {
        comparison = 0;
        error = null;

        if (!TryParseFields(left, out var l))
        {
            error = $"'{left}' is not a version this product can read (expected a form like 1.4.0).";
            return false;
        }

        if (!TryParseFields(right, out var r))
        {
            error = $"'{right}' is not a version this product can read (expected a form like 1.4.0).";
            return false;
        }

        for (var i = 0; i < 3; i++)
        {
            var diff = l[i].CompareTo(r[i]);
            if (diff != 0)
            {
                comparison = diff < 0 ? -1 : 1;
                return true;
            }
        }

        return true;
    }

    private static bool TryParseFields(string? version, out int[] fields)
    {
        fields = [0, 0, 0];
        if (string.IsNullOrWhiteSpace(version)) return false;

        var parts = version.Trim().Split('.');
        if (parts.Length is < 1 or > 4) return false;

        for (var i = 0; i < Math.Min(3, parts.Length); i++)
        {
            if (!int.TryParse(parts[i], out var value) || value < 0) return false;
            fields[i] = value;
        }

        // A fourth field is tolerated in the INPUT (an assembly version may carry one) and ignored in the
        // comparison, which is exactly what Windows Installer does.
        if (parts.Length == 4 && (!int.TryParse(parts[3], out var fourth) || fourth < 0)) return false;

        return true;
    }
}
