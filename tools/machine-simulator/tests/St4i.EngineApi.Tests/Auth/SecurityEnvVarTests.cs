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
/// </summary>
[CollectionDefinition(CollectionName)]
public sealed class SecurityEnvVarTests
{
    public const string CollectionName = "St4i.EngineApi security env-var tests (serialized)";
}
