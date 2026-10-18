using Sol;
using System.Net;
using System.Text;
using MQTTnet;
using MQTTnet.Server;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  static int CongTrong() { var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0); l.Start(); int p = ((IPEndPoint)l.LocalEndpoint).Port; l.Stop(); return p; }
  static Task Tiem(MqttServer s, string topic, string payload) =>
    s.InjectApplicationMessage(new InjectedMqttApplicationMessage(new MqttApplicationMessageBuilder().WithTopic(topic).WithPayload(Encoding.UTF8.GetBytes(payload)).Build()) { SenderClientId = "thiet-bi" });
  public static async Task<int> Main() {
    try {
      int port = CongTrong();
      var sf = new MqttServerFactory();
      var opt = sf.CreateServerOptionsBuilder().WithDefaultEndpoint().WithDefaultEndpointPort(port).WithDefaultEndpointBoundIPAddress(IPAddress.Loopback).Build();
      using var server = sf.CreateMqttServer(opt);
      var daDangKy = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
      int soNgat = 0;
      server.ClientSubscribedTopicAsync += e => { daDangKy.TrySetResult(e.TopicFilter.Topic); return Task.CompletedTask; };
      server.ClientDisconnectedAsync += e => { Interlocked.Increment(ref soNgat); return Task.CompletedTask; };
      await server.StartAsync();
      var viec = NhanMqtt.NhanN("127.0.0.1", port, "nhamay/+/do/#", 3, TimeSpan.FromSeconds(10));
      var t = await Task.WhenAny(daDangKy.Task, Task.Delay(5000));
      Kiem(t == daDangKy.Task, "khong dang ky");
      Kiem(daDangKy.Task.Result == "nhamay/+/do/#", "bo loc " + daDangKy.Task.Result);
      await Task.Delay(100);
      await Tiem(server, "nhamay/M01/do/nhiet", "21,5 °C");
      await Tiem(server, "nhamay/M01/trangthai", "CHAY");
      await Tiem(server, "nhamay/M02/do", "7");
      await Tiem(server, "khac/M02/do", "x");
      await Tiem(server, "nhamay/M03/do/ap/suat", "1.2");
      await Tiem(server, "nhamay/M04/do/z", "thua");
      var kq = await viec;
      Kiem(kq.Count == 3, "so ban tin " + kq.Count);
      Kiem(kq[0] == ("nhamay/M01/do/nhiet", "21,5 °C"), "ban tin 1: " + kq[0]);
      Kiem(kq[1] == ("nhamay/M02/do", "7"), "ban tin 2: " + kq[1]);
      Kiem(kq[2] == ("nhamay/M03/do/ap/suat", "1.2"), "ban tin 3: " + kq[2]);
      await Task.Delay(300);
      Kiem(Volatile.Read(ref soNgat) == 1, "phai ngat ket noi sau khi nhan du");
      var t0 = DateTime.UtcNow;
      try { await NhanMqtt.NhanN("127.0.0.1", port, "im/lang", 1, TimeSpan.FromMilliseconds(700)); Kiem(false, "phai nem TimeoutException"); }
      catch (TimeoutException) { }
      Kiem((DateTime.UtcNow - t0).TotalSeconds < 5, "qua han phai ném nhanh");
      await Task.Delay(300);
      Kiem(Volatile.Read(ref soNgat) == 2, "qua han van phai ngat ket noi");
      await server.StopAsync();
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
