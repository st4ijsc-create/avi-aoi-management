using MQTTnet;
using MQTTnet.Formatter;
using MQTTnet.Protocol;

namespace Sol {
  public static class NhanMqtt {
    public static async Task<List<(string Topic, string Payload)>> NhanN(string host, int port, string boLoc, int n, TimeSpan han) {
      var factory = new MqttClientFactory();
      using var client = factory.CreateMqttClient();
      var ds = new List<(string, string)>();
      var du = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
      client.ApplicationMessageReceivedAsync += e => {
        lock (ds) {
          if (ds.Count < n) ds.Add((e.ApplicationMessage.Topic, e.ApplicationMessage.ConvertPayloadToString()));
          if (ds.Count >= n) du.TrySetResult();
        }
        return Task.CompletedTask;
      };
      await client.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer(host, port).WithProtocolVersion(MqttProtocolVersion.V500).Build());
      try {
        var so = factory.CreateSubscribeOptionsBuilder()
          .WithTopicFilter(f => f.WithTopic(boLoc).WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce))
          .Build();
        await client.SubscribeAsync(so);
        var xong = await Task.WhenAny(du.Task, Task.Delay(han));
        if (xong != du.Task) throw new TimeoutException($"chua du {n} ban tin sau {han}");
        lock (ds) return new List<(string Topic, string Payload)>(ds);
      } finally {
        await client.DisconnectAsync();
      }
    }
  }
}
