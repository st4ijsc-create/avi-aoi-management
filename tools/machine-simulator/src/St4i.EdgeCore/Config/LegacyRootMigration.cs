namespace St4i.EdgeCore.Config;

/// <summary>
/// 🔴 <b>Task BF-1, owner ruling 2026-08-23(a) — the one-time COPY that carries an existing install's
/// beside-the-binary configuration across to the machine-wide root, and NEVER deletes the bytes it read.</b>
///
/// <para><b>Why a copy and not a move.</b> <c>docs/owner-decisions.md</c> exempts exactly one item — item 10 —
/// from the rule against relocating an operator's bytes, and that exemption is written to apply to item 10
/// alone. So this reads the old root and writes the new one, and the old file stays on disk untouched: a
/// deployment that rolls back to a build without this change finds its own configuration exactly where it
/// left it. The price of that choice is stated in the other direction too, because half a truth here is the
/// expensive kind: <b>after the first write to the new root the two copies DIVERGE, and nothing converges
/// them.</b> An operator who keeps hand-editing the old path sees no effect and no error. README §15.9 says
/// so where an operator reads.</para>
///
/// <para>🔴 <b>THE TRAP THIS METHOD DOES NOT CLOSE, and the caller must.</b> The legacy root is
/// <see cref="AppContext.BaseDirectory"/>, which no environment variable can move. A store that copied
/// unconditionally would, in every test process, suck whatever <c>products.json</c> a previous build left in
/// its OWN bin directory into the redirected root — a non-deterministic input sourced from build residue.
/// So every caller gates this on the resolved root being the machine-wide DEFAULT, and the three callers
/// spell that gate as an equality against their own <c>DefaultRoot()</c> rather than as a provenance flag:
/// an equality is a measurement on the value that will actually be written to, and a provenance flag is a
/// second copy of <c>ResolveRoot</c>'s precedence rules that can drift away from it.</para>
///
/// <para><b>What is deliberately NOT reused from <c>CredentialStore</c>.</b> Only its root arithmetic —
/// <c>DefaultRoot</c>/<c>EnvVarDir</c>/<c>ResolveRoot</c>. <b>Not</b> <c>SecurityDirAcl.Apply</c>: that tool
/// strips inheritance and leaves three FullControl grants, whose stated purpose is removing
/// <c>Authenticated Users</c> read. Applied to files this repository's own gate calls
/// <i>operator-editable</i> it would lock the operator out of the very files they are meant to edit. It is
/// the tool for credential-bearing directories, and these are not that.</para>
/// </summary>
public static class LegacyRootMigration
{
    /// <summary>Copies each of <paramref name="fileNames"/> from <paramref name="legacyRoot"/> into
    /// <paramref name="newRoot"/>, skipping any name the new root already holds, and emits one line per file
    /// actually copied plus nothing at all when there was nothing to do.
    ///
    /// <para><b>Idempotent by construction, not by a marker file.</b> The "have I run before?" question is
    /// answered by the destination file's own existence, so a half-finished copy (power loss between two
    /// files) completes on the next start rather than being recorded as done. A marker would have had to be
    /// written to the same root that may not be writable yet.</para>
    ///
    /// <para><b>Best-effort per file.</b> A copy that throws is logged and skipped rather than allowed to
    /// escape: this runs inside a store constructor which for two of the three callers sits on the DI
    /// startup path, and a migration that could not read a legacy file must not be the thing that stops a
    /// host that would otherwise seed itself perfectly well. The store then behaves exactly as it does on a
    /// machine that never had a legacy root — it seeds.</para></summary>
    /// <param name="legacyRoot">The beside-the-binary directory an earlier build wrote to.</param>
    /// <param name="newRoot">The resolved machine-wide root, already created by the caller.</param>
    /// <param name="fileNames">The file names this store persists, from the store's own constants.</param>
    /// <param name="tag">Short store name used as the log prefix, e.g. <c>productconfigstore</c>.</param>
    /// <returns>The names actually copied, in the order given — empty when there was nothing to carry.</returns>
    public static IReadOnlyList<string> CopyOnce(
        string legacyRoot, string newRoot, IReadOnlyList<string> fileNames, string tag)
    {
        var copied = new List<string>();

        // A legacy root that does not exist is the ordinary case on a fresh machine, and it is not worth a
        // line of output: silence here is "nothing to carry", which is different from "carried nothing".
        if (!Directory.Exists(legacyRoot) || PathsAreSame(legacyRoot, newRoot))
        {
            return copied;
        }

        foreach (var name in fileNames)
        {
            var source = Path.Combine(legacyRoot, name);
            var destination = Path.Combine(newRoot, name);

            if (!File.Exists(source) || File.Exists(destination))
            {
                continue;
            }

            try
            {
                // 🔴 THE TWO-ARGUMENT OVERLOAD, DELIBERATELY, and it is not a style choice.
                // File.Copy/3 — even called with overwrite:false — is classified Effect.Replace by
                // OperatorDataRemovalCensusTests, because that census reads the shipped IL and IL carries
                // arity, not argument values. Calling the overload that CANNOT overwrite says the same
                // thing to the compiler, to a reader, and to the census, instead of saying it to two of
                // the three. It also throws rather than overwriting if a second host wins a race to the
                // same destination between the File.Exists above and here — which the catch below turns
                // into a logged skip, i.e. the operator's bytes survive on both sides.
                File.Copy(source, destination);
                copied.Add(name);
                Console.Error.WriteLine(
                    $"[{tag}] migrated \"{source}\" -> \"{destination}\" (one-time copy; the original was " +
                    "NOT deleted and is no longer read once this file exists).");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"[{tag}] could not migrate \"{source}\" -> \"{destination}\": " +
                    $"{ex.GetType().Name}: {ex.Message}. The original is untouched; this store will seed or " +
                    "load from the new root as if there had been no legacy data.");
            }
        }

        return copied;
    }

    /// <summary>Whether two directory paths name the same place, so a deployment whose legacy and new roots
    /// coincide is a no-op rather than a self-copy. Compared on the full path with the trailing separator
    /// removed, because <see cref="AppContext.BaseDirectory"/> carries one and a composed root does
    /// not.</summary>
    private static bool PathsAreSame(string a, string b) =>
        string.Equals(
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(a)),
            Path.TrimEndingDirectorySeparator(Path.GetFullPath(b)),
            StringComparison.OrdinalIgnoreCase);
}
