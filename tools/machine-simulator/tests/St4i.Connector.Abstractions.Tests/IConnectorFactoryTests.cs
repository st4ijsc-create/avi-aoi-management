using System.Reflection;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) —
/// <see cref="IConnectorFactory"/> is the whole public contract a third-party connector implements to
/// register itself with a host's connector registry; every member is a permanent commitment. This test
/// project references ONLY <c>St4i.Connector.Abstractions</c> itself (see this project's own csproj
/// comment) — exactly the shape a real third-party driver author's own test suite would have, with no
/// <c>St4i.EdgeCore</c>/<c>EngineApi</c> host code in reach. The fake factory below is written the way a
/// vendor unfamiliar with this codebase's internals would write one: it never sees a
/// <c>ModbusRegisterMap</c>, an <c>OpcUaNodeMap</c>, or a <c>ConnectorRegistry</c> — only
/// <see cref="IConnectorFactory"/> and <see cref="IDeviceDriver"/> themselves.
/// </summary>
public class IConnectorFactoryTests
{
    /// <summary>Keeps the contract's surface honest: exactly two members
    /// (<see cref="IConnectorFactory.Kind"/>, <see cref="IConnectorFactory.TryCreate"/>) — the brief's own
    /// "keep it small, every member is a permanent commitment" instruction, enforced structurally so a
    /// future addition to this interface has to consciously touch this assertion, not slip in silently.</summary>
    [Fact]
    public void Contract_HasExactlyTwoMembers_KindAndTryCreate()
    {
        var members = typeof(IConnectorFactory).GetMembers(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);

        // A property compiles down to a get_Kind method + the property itself, so this counts DISTINCT
        // member "concepts" rather than raw reflection member count.
        var names = members.Select(m => m.Name).Where(n => !n.StartsWith("get_", StringComparison.Ordinal)).ToArray();

        Assert.Equal(new[] { "Kind", "TryCreate" }, names.OrderBy(n => n, StringComparer.Ordinal));
    }

    [Fact]
    public void ThirdPartyStyleFactory_ValidConfig_ReturnsTrueAndADriver()
    {
        var factory = new ThirdPartyWidgetFactory();

        var ok = factory.TryCreate(config: "widget-address=10.0.0.5", out var driver, out var error);

        Assert.True(ok);
        Assert.NotNull(driver);
        Assert.Null(error);
        Assert.Equal("vendor.acme.widget", driver!.Kind);
    }

    [Fact]
    public void ThirdPartyStyleFactory_InvalidConfig_ReturnsFalseWithError_NeverThrows()
    {
        var factory = new ThirdPartyWidgetFactory();

        var exception = Record.Exception(() =>
        {
            var ok = factory.TryCreate(config: "not a valid widget config", out var driver, out var error);
            Assert.False(ok);
            Assert.Null(driver);
            Assert.False(string.IsNullOrWhiteSpace(error));
        });

        // The load-bearing point: a well-behaved factory reports failure through the return value/out
        // params alone — a caller checking the bool never needs a try/catch for THIS class of failure.
        Assert.Null(exception);
    }

    [Fact]
    public void Kind_IsAFreeFormThirdPartyId_NotOneOfTheBuiltIns()
    {
        // Proves the contract genuinely allows an id this codebase has never heard of — the whole point of
        // opening DriverKind into a string (GP-3) was to make THIS possible.
        var factory = new ThirdPartyWidgetFactory();

        Assert.Equal("vendor.acme.widget", factory.Kind);
        Assert.DoesNotContain(factory.Kind, new[] { DriverKinds.Simulated, DriverKinds.HotFolderAoi, DriverKinds.Mqtt, DriverKinds.Modbus, DriverKinds.OpcUa });
    }

    /// <summary>A hand-written, third-party-style <see cref="IConnectorFactory"/> — deliberately naive
    /// "config" parsing (a <c>key=value</c> string, not JSON) to prove the contract does not assume any
    /// particular config format, only that it's a plain string.</summary>
    private sealed class ThirdPartyWidgetFactory : IConnectorFactory
    {
        public string Kind => "vendor.acme.widget";

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            if (!config.StartsWith("widget-address=", StringComparison.Ordinal))
            {
                driver = null;
                error = $"ThirdPartyWidgetFactory: expected 'widget-address=<ip>', got '{config}'.";
                return false;
            }

            driver = new ThirdPartyWidgetDriver(config["widget-address=".Length..]);
            error = null;
            return true;
        }
    }

    /// <summary>A minimal, never-actually-streaming <see cref="IDeviceDriver"/> — enough to prove
    /// <see cref="IConnectorFactory.TryCreate"/> can hand back a real driver instance; this test suite has
    /// no need to exercise <see cref="ReadAsync"/> itself (that is <see cref="IDeviceDriver"/>'s own
    /// contract, covered elsewhere).</summary>
    private sealed class ThirdPartyWidgetDriver : IDeviceDriver
    {
        public ThirdPartyWidgetDriver(string address) => Id = $"widget:{address}";

        public string Id { get; }

        public string Kind => "vendor.acme.widget";

        public DriverHealthState Health => DriverHealthState.Down;

        public IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct) => throw new NotSupportedException("test double — not exercised here");

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
