namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — the seam through which, and <b>only</b> through which, this product invokes
/// <c>msiexec</c>.
///
/// <para>🔴 <b>Why this interface exists at all, since one call site could just start a process.</b> The
/// load-bearing property of the whole update path is negative: <b>the installer is never invoked on bytes
/// that have not been verified.</b> A negative property about a side effect cannot be tested against a
/// method that really launches an installer — so the side effect is put behind one interface, the apply
/// path is given no other way to reach a process, and a test can then hand it a bundle with a single
/// flipped byte and assert that this interface was <b>never called</b>. Without the seam that assertion
/// is unwritable and the property would be a comment.</para>
///
/// <para>🔴 The production implementation is deliberately absent from <c>EdgeCore</c>. Nothing in the
/// engine's own assembly can start an installer; the process-launching implementation belongs to whatever
/// host actually performs maintenance, which keeps discovery and application in different reference cones
/// exactly as the design requires.</para>
/// </summary>
public interface IMsiRunner
{
    /// <summary>
    /// Runs <c>msiexec</c> with the given arguments.
    /// </summary>
    /// <param name="arguments">The argument list, passed one element at a time — never a hand-joined
    /// command line, matching <c>ServiceInstallVerbs</c>'s existing discipline for <c>sc.exe</c>.</param>
    /// <returns>The process exit code and its combined output.</returns>
    (int ExitCode, string Output) Run(IReadOnlyList<string> arguments);
}
