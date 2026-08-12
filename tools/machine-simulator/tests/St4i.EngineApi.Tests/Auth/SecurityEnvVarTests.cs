using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D3 — the shared xUnit collection name for every test class that boots a real
/// <c>WebApplicationFactory&lt;Program&gt;</c> by mutating REAL process environment variables
/// (<c>ST4I_SECURITY_DIR</c>/<c>ST4I_DEMO_ENABLED</c>/<c>ST4I_HISTORIAN_DIR</c>/<c>ST4I_WAL_DIR</c>/
/// <c>ASPNETCORE_ENVIRONMENT</c>) around the eager <c>_ = factory.Server</c> build (<see cref="AuthPipelineTests"/>,
/// <see cref="RbacPolicyTests"/>, <c>AuditEndpointsTests</c>). <c>Program.cs</c> reads these straight off
/// <see cref="System.Environment"/> with no <c>IConfiguration</c> seam, so there is no way to isolate one
/// factory build's env vars from another's except by ensuring no TWO such builds ever run at the same
/// wall-clock instant — each class's own private <c>EnvLock</c> only ever serialized calls against
/// itself, which is NOT enough once more than one class does this (xUnit parallelizes different test
/// classes against each other by default, one implicit collection per class). Tagging every such class
/// with <c>[Collection(CollectionName)]</c> puts them all in ONE xUnit collection, which xUnit always
/// runs sequentially internally — a stronger, structural guarantee than any in-process lock these classes
/// could add on their own. This file carries no test itself — just the shared name every affected class's
/// <c>[Collection(...)]</c> attribute references.
///
/// <para>🔴 <b>Task L-1 — THIS COLLECTION NOW OWNS TWO PROPERTIES, AND ITS NAME ONLY DESCRIBES THE
/// FIRST.</b> The membership rule is no longer "mutates a process environment variable". It is the more
/// general thing the env-var case was one instance of:</para>
///
/// <para><b>MEMBERSHIP RULE: a test class belongs here if it PERTURBS state whose lifetime is the test
/// PROCESS rather than the test instance, or if it OBSERVES state that another class in this assembly
/// perturbs.</b> Both halves are required. Serializing only the perturbers against each other leaves the
/// race fully alive and makes the suite LOOK serialized, which is worse than not serializing at all.</para>
///
/// <para>The second instance, added by L-1: <b>the process-wide SQLite connection pool.</b> Seven classes
/// in this assembly call <c>SqliteConnection.ClearAllPools()</c> — an API that is process-global by its own
/// contract, clearing every pool for every connection string in the process, not just the caller's own
/// database — while other classes in the same process hold <c>Microsoft.Data.Sqlite</c> connections. None of
/// the seven carried a <c>[Collection]</c>. L-1 put all of them here, and with them <b>every test class in
/// this assembly that can cause a SQLite connection to be OPENED — 45 classes, all 45 in this collection</b>
/// — because the observers are the other half of the rule.</para>
///
/// <para>🔴 <b>That sentence said "every class that REFERENCES a SQLite-backed store", and it was FALSE BY
/// ONE, in the file that defines the membership rule.</b> Recorded rather than quietly corrected, because the
/// way it was false is the finding. The first census keyed on a hand-written list of SQLite-opening TYPE
/// NAMES, so it saw <c>SqliteAuditStoreTests</c> and missed its sibling <c>SqliteUserStoreTests</c> —
/// <b>same <c>security.db</c></b> — whose only difference is that the sibling writes
/// <c>using Microsoft.Data.Sqlite;</c> while this one reaches SQLite through
/// <c>SqliteUserStore -&gt; SecurityDb</c> and names no SQLite type at all. An instrument whose domain came
/// from a TOKEN rather than from the property: §8.1(f), one level below the same error in the brief that
/// commissioned the fix.</para>
///
/// <para><b>What is NOT claimed:</b> that this fixes a specific reported failure. The reported symptom (a
/// full-suite run failing on <c>ObjectDisposedException: SQLitePCL.sqlite3</c>, green on the runs either
/// side of it) was NOT reproduced by L-1, and the disposal path inside Microsoft.Data.Sqlite that would
/// produce it from a concurrent <c>ClearAllPools</c> was not established. What IS established, by census:
/// after L-1 no class in this assembly calls a process-global SQLite pool mutator while an unserialized
/// class holds a SQLite connection. Read that as closing a named hazard, not as a fix with a mechanism.</para>
///
/// <para><b>Why the name was not changed.</b> <c>CollectionName</c>'s VALUE is the collection's identity in
/// xUnit; changing it would be safe but would touch every referencing file for no behavioural gain, and the
/// guarantee lives in this rule rather than in the string. Named here rather than left for a reader to trip
/// over: the string says "security env-var tests" and the membership no longer does.</para>
///
/// <para><b>The instrument, and what it cannot see (L-1).</b> The observer half is now DERIVED FROM THE
/// PROPERTY rather than from a list of type names, because a list of type names is what got it wrong the
/// first time. The census computes, over <c>src/</c>, the TRANSITIVE CLOSURE of "types whose own body
/// contains <c>new SqliteConnection(</c>" under construction/static-use/field-type edges — 7 seeds close to
/// 14 types, and <c>SqliteUserStore</c> arrives in that closure without anyone naming it — then closes again
/// inside the test assembly over base classes and helper types, and reports every test class that reaches it.
/// Run at three widths (construction-only, construction plus static calls, then any mention at all of any
/// closure type), all three converge on the same answer: <b>domain 45, exactly one class outside the
/// collection</b> before this round, none after. Convergence across widths is the completeness argument;
/// it is not a proof.
/// There is still NO test that can enforce membership: dropping a <c>[Collection]</c> attribute changes
/// SCHEDULING, not behaviour, so it compiles and every test still passes, which means MUTATION CANNOT KILL IT
/// and neither can the gate.
/// The census is also only as complete as its list of process-scope state KINDS; a kind nobody has thought of
/// is invisible to it. <b>TEN kinds were swept</b>, one per row of the table in
/// <c>.superpowers/sdd/gate-determinism/task-1-report.md</c> §2.3, which also records what each sweep
/// returned:
/// <list type="number">
/// <item>the process environment block;</item>
/// <item>the SQLite connection pool;</item>
/// <item>the process console / standard streams;</item>
/// <item>the process current directory;</item>
/// <item><c>AppContext</c> switches, default thread culture, <c>Trace.Listeners</c>, thread-pool minimums;</item>
/// <item>mutable statics in the test assemblies;</item>
/// <item><c>AppDomain</c> handlers;</item>
/// <item>fixed TCP ports;</item>
/// <item>named mutexes and named pipes;</item>
/// <item>machine-wide directories.</item>
/// </list>
/// That list is a measurement of what was looked for, not a proof that it is all there is.
/// (🔴 It previously ran as prose that bundled rows 8 and 9 into one clause, so it READ as nine while the
/// commit message beside it said ten — a count and the list it is a count OF disagreeing, which is the
/// defect <c>TestHarnessIsolationTests</c> already carries a paragraph about. Enumerated now, so the two
/// cannot drift apart again without the list itself changing.)</para>
/// </summary>
[CollectionDefinition(CollectionName)]
public sealed class SecurityEnvVarTests
{
    public const string CollectionName = "St4i.EngineApi security env-var tests (serialized)";
}
