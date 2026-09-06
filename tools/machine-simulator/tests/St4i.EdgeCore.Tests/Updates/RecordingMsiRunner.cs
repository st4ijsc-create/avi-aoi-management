using St4i.EdgeCore.Updates;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴 WS-F4 Task 2 — an <see cref="IMsiRunner"/> that <b>records instead of running</b>.
///
/// <para>Its purpose is a NEGATIVE assertion: <see cref="Invocations"/> being empty is the proof that
/// <c>msiexec</c> was never invoked. A real runner cannot support that test — you cannot assert an
/// installer did not run by running it — which is precisely why the production code has no other route to
/// a process.</para>
/// </summary>
internal sealed class RecordingMsiRunner : IMsiRunner
{
    /// <summary>Every argument list this runner was handed, in order. 🔴 Empty means the installer was
    /// never reached.</summary>
    public List<IReadOnlyList<string>> Invocations { get; } = [];

    /// <summary>The exit code to report. Defaults to success so a test about arguments is not also a test
    /// about failure handling.</summary>
    public int ExitCodeToReturn { get; init; }

    /// <inheritdoc />
    public (int ExitCode, string Output) Run(IReadOnlyList<string> arguments)
    {
        Invocations.Add(arguments);
        return (ExitCodeToReturn, "recorded");
    }
}
