using St4i.Connector.Abstractions.Models; using St4i.EdgeCore.Drivers.Mqtt; using MQTTnet; using Xunit;

public class MqttDriverTests {
  [Fact] public async Task Broker_publish_reaches_driver() {
    int port = 18830;
    await using var broker = new InProcessBroker();
    await broker.StartAsync(port);

    await using var drv = new MqttDriver("localhost", port, new[] { "st4i/+/telemetry" },
      (topic, payload) => new DeviceReading {
        MachineCode = "ESP-01", Kind = ReadingKind.Telemetry, SerialNumber = "ESP-01",
        Telemetry = new() { new TelemetrySample("temperature", 31.4, "C") },
      });

    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
    var readTask = Task.Run(async () => {
      await foreach (var r in drv.ReadAsync(cts.Token)) return r;
      return (DeviceReading?)null;
    });

    await Task.Delay(500); // let the driver connect + subscribe before we publish

    using var pub = new MqttClientFactory().CreateMqttClient();
    await pub.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("localhost", port).Build());
    await pub.PublishStringAsync("st4i/ESP-01/telemetry", "{\"temperature\":31.4}");

    var got = await readTask;
    Assert.NotNull(got);
    Assert.Equal(ReadingKind.Telemetry, got!.Kind);
    Assert.Equal("ESP-01", got.SerialNumber);
    Assert.Equal(DriverKinds.Mqtt, drv.Kind);
    Assert.Equal(DriverHealthState.Connected, drv.Health);
  }

  [Fact] public async Task Mapper_returning_null_is_dropped_and_next_message_still_arrives() {
    int port = 18831;
    await using var broker = new InProcessBroker();
    await broker.StartAsync(port);

    await using var drv = new MqttDriver("localhost", port, new[] { "st4i/+/telemetry" },
      (topic, payload) => payload.Contains("skip")
        ? null
        : new DeviceReading { MachineCode = "ESP-02", Kind = ReadingKind.Telemetry, SerialNumber = "ESP-02" });

    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
    var readTask = Task.Run(async () => {
      await foreach (var r in drv.ReadAsync(cts.Token)) return r;
      return (DeviceReading?)null;
    });

    await Task.Delay(500);

    using var pub = new MqttClientFactory().CreateMqttClient();
    await pub.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("localhost", port).Build());
    await pub.PublishStringAsync("st4i/ESP-02/telemetry", "skip-me");
    await pub.PublishStringAsync("st4i/ESP-02/telemetry", "{\"temperature\":1}");

    var got = await readTask;
    Assert.NotNull(got);
    Assert.Equal("ESP-02", got!.SerialNumber);
  }
}
