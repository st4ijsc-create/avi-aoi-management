using Sol;
using System.Buffers;
using System.Collections.Concurrent;
using System.Net;
using System.Text;
using MQTTnet;
using MQTTnet.Formatter;
using MQTTnet.Packets;
using MQTTnet.Protocol;
using MQTTnet.Server;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  static int CongTrong() { var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0); l.Start(); int p = ((IPEndPoint)l.LocalEndpoint).Port; l.Stop(); return p; }
  public static async Task<int> Main() {
    try {
      int port = CongTrong();
      var sf = new MqttServerFactory();
      var opt = sf.CreateServerOptionsBuilder().WithDefaultEndpoint().WithDefaultEndpointPort(port).WithDefaultEndpointBoundIPAddress(IPAddress.Loopback).Build();
      using var server = sf.CreateMqttServer(opt);
      var nhan = new ConcurrentQueue<MqttApplicationMessage>();
      string? idKetNoi = null; MqttProtocolVersion? pv = null; bool? sach = null;
      var daNgat = new TaskCompletionSource<MqttClientDisconnectType>(TaskCreationOptions.RunContinuationsAsynchronously);
      server.ValidatingConnectionAsync += e => { idKetNoi = e.ClientId; pv = e.ProtocolVersion; sach = e.CleanSession; return Task.CompletedTask; };
      server.InterceptingPublishAsync += e => { nhan.Enqueue(e.ApplicationMessage); return Task.CompletedTask; };
      server.ClientDisconnectedAsync += e => { daNgat.TrySetResult(e.DisconnectType); return Task.CompletedTask; };
      await server.StartAsync();
      var ds = new List<(string, string)> { ("nhamay/M01/do", "nhiệt độ=21,5"), ("nhamay/M01/trangthai", "CHAY"), ("nhamay/M02/do", "") };
      int n = await GuiMqtt.GuiLo("127.0.0.1", port, "aoi-gui-01", ds);
      Kiem(n == 3, "so ban tin thanh cong = " + n);
      Kiem(idKetNoi == "aoi-gui-01", "clientId " + idKetNoi);
      Kiem(pv == MqttProtocolVersion.V500, "phai MQTT 5.0, thay " + pv);
      Kiem(sach == true, "phai clean start");
      var t = await Task.WhenAny(daNgat.Task, Task.Delay(5000));
      Kiem(t == daNgat.Task, "khong ngat ket noi");
      Kiem(daNgat.Task.Result == MqttClientDisconnectType.Clean, "phai ngat SACH, thay " + daNgat.Task.Result);
      var mang = nhan.ToArray();
      Kiem(mang.Length == 3, "server nhan " + mang.Length);
      for (int i = 0; i < 3; i++) {
        var m = mang[i];
        Kiem(m.Topic == ds[i].Item1, "topic " + m.Topic);
        Kiem(Encoding.UTF8.GetString(m.Payload.ToArray()) == ds[i].Item2, "payload phai UTF-8: " + Encoding.UTF8.GetString(m.Payload.ToArray()));
        Kiem(m.QualityOfServiceLevel == MqttQualityOfServiceLevel.AtLeastOnce, "QoS " + m.QualityOfServiceLevel);
        Kiem(!m.Retain, "retain phai false");
        Kiem(m.ContentType == "text/plain", "content type " + m.ContentType);
        Kiem(m.UserProperties != null && m.UserProperties.Count == 1 && m.UserProperties[0].Name == "nguon" && m.UserProperties[0].ReadValueAsString() == "aoi", "user property nguon=aoi");
      }
      Kiem(await GuiMqtt.GuiLo("127.0.0.1", port, "aoi-gui-02", new List<(string, string)>()) == 0, "lo rong ⇒ 0");
      await server.StopAsync();
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.Message); return 1; }
  }
}
