using Sol;
using System.Net;
using System.Net.Sockets;
using NModbus;
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  public static int Main() {
    try {
      var factory = new ModbusFactory();
      var listener = new TcpListener(IPAddress.Loopback, 0);
      listener.Start();
      int port = ((IPEndPoint)listener.LocalEndpoint).Port;
      using var network = factory.CreateSlaveNetwork(listener);
      var slave = factory.CreateSlave(17);
      network.AddSlave(slave);
      using var cts = new CancellationTokenSource();
      _ = network.ListenAsync(cts.Token);
      var kyVong = new uint[180];
      var reg = new ushort[360];
      for (int i = 0; i < kyVong.Length; i++) {
        kyVong[i] = i == 5 ? 0xFFFF0001u : (uint)((ulong)i * 2654435761UL % 4294967296UL);
        reg[2 * i] = (ushort)(kyVong[i] >> 16);
        reg[2 * i + 1] = (ushort)(kyVong[i] & 0xFFFF);
      }
      slave.DataStore.HoldingRegisters.WritePoints(1000, reg);
      slave.DataStore.HoldingRegisters.WritePoints(10, new ushort[] { 0x0001, 0x0002, 0xFFFF, 0xFFFF });
      var a = DocModbus.DocBoDem("127.0.0.1", port, 17, 10, 2);
      Kiem(a.Length == 2 && a[0] == 0x00010002u && a[1] == 0xFFFFFFFFu, "2 bo dem tai 10: " + string.Join(",", a));
      var b = DocModbus.DocBoDem("127.0.0.1", port, 17, 1000, 180);
      Kiem(b.Length == 180, "so bo dem " + b.Length);
      for (int i = 0; i < 180; i++) Kiem(b[i] == kyVong[i], $"bo dem {i}: {b[i]} != {kyVong[i]}");
      cts.Cancel();
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
