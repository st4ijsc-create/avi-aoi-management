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
/// the seven carried a <c>[Collection]</c>. L-1 put all of them here, and with them every class in this
/// assembly that references a SQLite-backed store, because the observers are the other half of the rule.</para>
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
/// <para><b>The instrument, and what it cannot see (L-1).</b> Membership completeness was established by a
/// scripted census over the parsed test sources — class declarations, their <c>[Collection]</c> attribute if
/// any, and the process-scope perturbations each class makes — plus a read of the resulting table. There is
/// NO test that can enforce it: dropping a <c>[Collection]</c> attribute changes SCHEDULING, not behaviour,
/// so it compiles and every test still passes, which means MUTATION CANNOT KILL IT and neither can the gate.
/// The census is only as complete as its list of process-scope state kinds; a kind nobody has thought of is
/// invisible to it. The kinds swept were: process environment variables, the SQLite connection pool, the
/// process's console/standard streams, the current directory, static mutable fields in the test assemblies,
/// and fixed machine-wide paths. That list is a measurement of what was looked for, not a proof that it is
/// all there is.</para>
/// </summary>
[CollectionDefinition(CollectionName)]
public sealed class SecurityEnvVarTests
{
    public const string CollectionName = "St4i.EngineApi security env-var tests (serialized)";
}
