using System.Text;
using MQTTnet;
using MQTTnet.Formatter;
using MQTTnet.Protocol;

// SAI (lỗi điển hình): QoS mặc định 0 (AtMostOnce) — quên đặt AtLeastOnce.
namespace Sol {
  public static class GuiMqtt {
    public static async Task<int> GuiLo(string host, int port, string clientId, IReadOnlyList<(string Topic, string Payload)> banTin) {
      var factory = new MqttClientFactory();
      using var client = factory.CreateMqttClient();
      var opt = new MqttClientOptionsBuilder()
        .WithTcpServer(host, port)
        .WithClientId(clientId)
        .WithProtocolVersion(MqttProtocolVersion.V500)
        .WithCleanStart(true)
        .Build();
      await client.ConnectAsync(opt);
      int dem = 0;
      foreach (var (topic, payload) in banTin) {
        var msg = new MqttApplicationMessageBuilder()
          .WithTopic(topic)
          .WithPayload(Encoding.UTF8.GetBytes(payload))
          .WithRetainFlag(false)
          .WithUserProperty("nguon", "aoi")
          .WithContentType("text/plain")
          .Build();
        var r = await client.PublishAsync(msg);
        if (r.IsSuccess) dem++;
      }
      await client.DisconnectAsync(new MqttClientDisconnectOptionsBuilder().WithReason(MqttClientDisconnectOptionsReason.NormalDisconnection).Build());
      return dem;
    }
  }
}
