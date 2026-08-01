using System.Net;
using System.Net.Sockets;
using NModbus;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// G2-6 (WS-H) — the protocol-level proof: stands up a REAL in-process NModbus TCP slave (no actual
/// hardware) bound to a DYNAMIC free port (<see cref="TcpListener"/> on port 0, then reading the assigned
/// port back — never a fixed port, to avoid the repo's known fixed-port MQTT flakiness) and drives a real
/// <see cref="ModbusTcpDriver"/> against it. All waits are bounded polling (<see cref="WaitUntilAsync"/>),
/// never a fixed <c>Task.Delay</c> for correctness, so this stays deterministic under CI load.
/// </summary>
public class ModbusTcpDriverLoopbackTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    // GP-6 (task-6-report.md): BuildMap/the "stand up a real slave" setup moved to ModbusLoopbackHarness
    // (unchanged in behavior — a mechanical extraction) so ModbusTcpDriverConformanceTests can reuse the
    // exact same real-server harness rather than hand-rolling a second one.

    [Fact]
    public async Task ReadAsync_AgainstLoopbackSlave_YieldsDecodedTelemetry_HealthConnected()
    {
        // raw 235 decoded UInt16 * scale 1.0 -> 235.0 ; raw 0xFFFF decoded Int16 (-1) * scale 0.1 -> -0.1
        var slave = ModbusLoopbackHarness.Start(235, 0xFFFF);
        var listener = slave.Listener;
        var network = slave.Network;
        var networkCts = slave.ListenCts;
        var listenTask = slave.ListenTask;
        var port = slave.Port;

        await using var driver = new ModbusTcpDriver("127.0.0.1", port, ModbusLoopbackHarness.BuildMap("PLC-LOOPBACK"));

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        DeviceReading? firstReading = null;
        var readTask = Task.Run(async () =>
        {
            await foreach (var reading in driver.ReadAsync(readCts.Token))
            {
                firstReading = reading;
                return;
            }
        });

        try
        {
            await WaitUntilAsync(() => firstReading is not null, "the driver to yield its first decoded reading");

            Assert.NotNull(firstReading);
            Assert.Equal("PLC-LOOPBACK", firstReading!.MachineCode);
            Assert.Equal(ReadingKind.Telemetry, firstReading.Kind);
            // Telemetry carries no pass/fail — Verdict MUST be Skip so it can never inflate the fleet-wide
            // FPY/pass KPIs in FleetHost.OnPipelineCommitted (whole-branch review fix).
            Assert.Equal(Verdict.Skip, firstReading.Verdict);
            Assert.Equal(2, firstReading.Telemetry.Count);

            var temperature = firstReading.Telemetry.Single(t => t.Metric == "temperature");
            Assert.Equal(235.0, (double)temperature.Value!, precision: 10);
            Assert.Equal("C", temperature.Unit);
            Assert.Equal("good", temperature.Quality);

            var pressure = firstReading.Telemetry.Single(t => t.Metric == "pressure");
            Assert.Equal(-0.1, (double)pressure.Value!, precision: 10);
            Assert.Equal("bar", pressure.Unit);

            await WaitUntilAsync(() => driver.Health == DriverHealthState.Connected, "driver Health to reach Connected after a successful poll");
            Assert.Equal(DriverKinds.Modbus, driver.Kind);
        }
        finally
        {
            readCts.Cancel();
            try { await readTask; } catch (OperationCanceledException) { }

            networkCts.Cancel();
            try { await listenTask; }
            catch (OperationCanceledException) { }
            catch { /* best-effort teardown */ }

            try { network.Dispose(); } catch { /* best-effort teardown */ }
            try { listener.Stop(); } catch { /* best-effort teardown */ }
            networkCts.Dispose();
        }
    }

    /// <summary>Health-on-fault (kept light + deterministic, per the brief): after a successful read, the
    /// slave network/listener is torn down out from under the driver, and we assert (bounded) that
    /// <see cref="ModbusTcpDriver.Health"/> degrades to <see cref="DriverHealthState.Degraded"/> — NOT
    /// <see cref="DriverHealthState.Connected"/> — and, the load-bearing assertion, that the background
    /// <c>ReadAsync</c> enumeration task is STILL RUNNING (not faulted/completed): a resilient driver must
    /// never throw a non-cancellation exception out of its iterator. Does not depend on precise reconnect
    /// timing.</summary>
    [Fact]
    public async Task ReadAsync_SlaveGoesAway_HealthDegrades_AndIteratorKeepsRunning_NoThrow()
    {
        var slave = ModbusLoopbackHarness.Start(1, 2);
        var listener = slave.Listener;
        var network = slave.Network;
        var networkCts = slave.ListenCts;
        var listenTask = slave.ListenTask;
        var port = slave.Port;

        await using var driver = new ModbusTcpDriver("127.0.0.1", port, ModbusLoopbackHarness.BuildMap("PLC-FAULT"));

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var readingCount = 0;
        var readTask = Task.Run(async () =>
        {
            await foreach (var _ in driver.ReadAsync(readCts.Token))
            {
                Interlocked.Increment(ref readingCount);
            }
        });

        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref readingCount) > 0, "at least one successful poll before killing the slave");
            await WaitUntilAsync(() => driver.Health == DriverHealthState.Connected, "driver Health to reach Connected before killing the slave");

            // Kill the slave network/listener out from under the driver — the NEXT poll's connect/read
            // must fail, degrading Health rather than throwing out of the iterator.
            networkCts.Cancel();
            try { await listenTask; }
            catch (OperationCanceledException) { }
            catch { /* best-effort teardown */ }

            try { network.Dispose(); } catch { /* best-effort teardown */ }
            try { listener.Stop(); } catch { /* best-effort teardown */ }

            await WaitUntilAsync(() => driver.Health == DriverHealthState.Degraded, "driver Health to degrade after the slave disappears");

            // The load-bearing assertion: the background enumeration task must still be running (not
            // faulted/completed) — a resilient driver never throws a non-cancellation exception out of
            // ReadAsync; it degrades and keeps looping/reconnecting instead.
            Assert.False(readTask.IsCompleted, "ReadAsync must keep looping (not throw/complete) after a poll failure");
        }
        finally
        {
            readCts.Cancel();
            try { await readTask; } catch (OperationCanceledException) { }
            networkCts.Dispose();
        }
    }
}
