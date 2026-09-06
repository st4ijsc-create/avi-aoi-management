namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — 🔴🔴 <b>THE ONLY PATH FROM A FILE ON A USB STICK TO <c>msiexec</c>.</b>
///
/// <para>🔴 <b>NO TIMER REACHES THIS TYPE.</b> A human being with a name and a role starts every update.
/// There is no scheduled call, no background poll, no "apply when idle" — the machine never updates on
/// its own initiative. A maintenance window is a PERMISSION an update needs, never a TRIGGER that starts
/// one, and the difference is the whole of boundary 1: a line that reboots itself at 3am because a timer
/// fired is the outage this design exists to prevent.</para>
///
/// <para>🔴 <b>THE GATE, and it is structural rather than procedural.</b> <see cref="Apply"/> takes an
/// <see cref="UpdatePreflightResult"/>, not a path. A refused verdict carries
/// <see cref="UpdatePreflightResult.VerifiedPayloadPath"/> as <see langword="null"/> and
/// <see cref="UpdatePreflightResult.Ok"/> as <see langword="false"/>, and this method refuses both before
/// it touches <see cref="IMsiRunner"/>. So the installer cannot be reached with unverified bytes by
/// forgetting a check — there is no overload that accepts a bare file path, which is the point. The
/// falsification is <c>MsiexecIsNeverInvokedOnUnverifiedBytesTests</c>: a bundle with ONE flipped byte in
/// the MSI, asserting the runner recorded zero invocations.</para>
///
/// <para>🔴 <b>AND THE MSI IS NEVER OPENED EITHER.</b> Not to read its ProductVersion for a nicer
/// confirmation screen, not to size it for a progress bar, not for anything. Every field an operator sees
/// before they commit comes from the SIGNED MANIFEST, which is why the manifest carries version, channel
/// and size at all. Parsing an unverified installer with a privileged process would break the property
/// while the design still claimed to hold it.</para>
/// </summary>
public sealed class UpdateApplier
{
    private readonly IMsiRunner _runner;

    /// <summary>Builds an applier over an installer seam.</summary>
    /// <param name="runner">The only route to <c>msiexec</c>.</param>
    public UpdateApplier(IMsiRunner runner)
    {
        ArgumentNullException.ThrowIfNull(runner);
        _runner = runner;
    }

    /// <summary>
    /// Applies a bundle that has ALREADY passed the dry run.
    /// </summary>
    /// <param name="preflight">The verdict from <see cref="UpdatePreflight.Run"/>. 🔴 A refusal here
    /// returns without the installer being invoked at all.</param>
    /// <param name="installedFeatures">🔴 The feature set currently installed, read from the installed
    /// product. See <see cref="BuildArguments"/> for why omitting it silently breaks the machine.</param>
    /// <returns>The exit code and output, or a refusal with exit code -1 and no invocation.</returns>
    public (int ExitCode, string Output) Apply(
        UpdatePreflightResult preflight, IReadOnlyList<string> installedFeatures)
    {
        ArgumentNullException.ThrowIfNull(preflight);
        ArgumentNullException.ThrowIfNull(installedFeatures);

        // 🔴 THE GATE. Both halves are checked, not one: Ok is the verdict and VerifiedPayloadPath is the
        // artefact of it, and a future edit that broke either alone must not open the door.
        if (!preflight.Ok || preflight.VerifiedPayloadPath is null)
        {
            return (-1,
                "REFUSED: this update package did not pass verification, so it has NOT been opened and " +
                "NOT been installed. " + (preflight.Reason ?? "No reason was recorded."));
        }

        return _runner.Run(BuildArguments(preflight.VerifiedPayloadPath, installedFeatures));
    }

    /// <summary>
    /// Builds the <c>msiexec</c> argument list.
    ///
    /// <para>🔴🔴 <b>THE <c>ADDLOCAL</c> RE-PASS, AND IT IS THE SECOND-MOST DANGEROUS LINE IN THIS
    /// WORKSTREAM.</b> Measured at <c>packaging/installer/Package.wxs:178-191</c>: <c>MainFeature</c> is
    /// <c>Level="1"</c>, but <c>ServiceFeature</c>, <c>StartupFeature</c> and <c>ExhibitionFeature</c> are
    /// all <c>Level="1000"</c> — authored, but excluded unless explicitly requested. A
    /// <c>MajorUpgrade</c> removes the old product and installs the new one, and the new install
    /// <b>re-evaluates <c>Level</c> from scratch</b>. So an upgrade run WITHOUT <c>ADDLOCAL</c> installs
    /// at the default level, <c>ServiceFeature</c> is not selected, and <b>the background service
    /// silently disappears.</b></para>
    ///
    /// <para>🔴 <b>Why that is worse than a loud failure.</b> The machine comes back. The installer
    /// reports success. The desktop shell starts. And the engine that was running as a service is simply
    /// gone — so the symptom is "the line stopped working after the update", which every engineer on site
    /// will read as a software regression in the new version. They will roll back, which will appear to
    /// fix it, and the real cause — one missing argument — is invisible from every direction. Hence
    /// <c>AddLocalIsRePassedOnUpgradeTests</c>.</para>
    /// </summary>
    /// <param name="verifiedPayloadPath">The payload whose hash matched the signed manifest.</param>
    /// <param name="installedFeatures">The features currently installed. When empty, no <c>ADDLOCAL</c>
    /// is emitted — the correct behaviour for a machine that genuinely has only the default feature,
    /// since <c>ADDLOCAL=</c> with nothing after it is not the same statement.</param>
    /// <returns>The argument list.</returns>
    public static IReadOnlyList<string> BuildArguments(
        string verifiedPayloadPath, IReadOnlyList<string> installedFeatures)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(verifiedPayloadPath);
        ArgumentNullException.ThrowIfNull(installedFeatures);

        var args = new List<string> { "/i", verifiedPayloadPath, "/qb" };

        if (installedFeatures.Count > 0)
        {
            // MSI takes a comma-separated list in ONE token. Ordered so the argument is reproducible and
            // a diff between two upgrades of the same machine is readable.
            args.Add($"ADDLOCAL={string.Join(",", installedFeatures.OrderBy(f => f, StringComparer.Ordinal))}");
        }

        return args;
    }
}
