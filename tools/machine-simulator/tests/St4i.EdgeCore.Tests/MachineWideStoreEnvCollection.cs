using Xunit;

/// <summary>
/// 🔴 Task F-1 — the collection that owns the process-wide <c>ST4I_*_DIR</c> environment variables.
///
/// <para><b>Why it exists.</b> xunit runs different test CLASSES in parallel by default (an unmarked class is
/// its own implicit collection). <c>CredentialStoreTests</c> already flips <c>ST4I_CREDS_DIR</c> — a
/// PROCESS-WIDE variable — in three of its tests, and <see cref="PerHostDataRootIsolationTests"/> flips the
/// same variable twice inside a single test. Two classes doing that in parallel is a real interleaving
/// hazard, not a theoretical one: whichever restores its saved value last wins, and the loser reads a
/// directory it did not choose. Putting both classes in ONE collection makes them run sequentially relative
/// to each other, which is the whole point.</para>
///
/// <para><b>What this does NOT buy, stated because <c>SiteTestCollection</c> had to learn it the hard way:</b>
/// it says nothing about classes OUTSIDE this collection. Any future class that reads or writes a variable a
/// class in here also touches has to join this same collection, or the same race comes back silently.</para>
/// </summary>
[CollectionDefinition("St4i.EdgeCore.Tests.MachineWideStoreEnv", DisableParallelization = true)]
public sealed class MachineWideStoreEnvCollection
{
}
