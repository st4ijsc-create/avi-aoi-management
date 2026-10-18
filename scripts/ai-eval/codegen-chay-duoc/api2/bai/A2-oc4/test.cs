using Sol;
using System.Net;
using System.Net.Sockets;
using NModbus;
public sealed class KhoDem : IPointSource<ushort> {
  readonly ushort[] _o = new ushort[65536];
  public readonly List<(ushort Dau, int SoLuong)> LanGhi = new();
  public ushort[] ReadPoints(ushort startAddress, ushort numberOfPoints) { lock (_o) return _o.Skip(startAddress).Take(numberOfPoints).ToArray(); }
  public void WritePoints(ushort startAddress, ushort[] points) { lock (_o) { LanGhi.Add((startAddress, points.Length)); Array.Copy(points, 0, _o, startAddress, points.Length); } }
}
public sealed class KhoCoil : IPointSource<bool> {
  readonly bool[] _o = new bool[65536];
  public readonly List<(ushort Dau, bool GiaTri, long Luc)> LanGhi = new();
  public bool[] ReadPoints(ushort startAddress, ushort numberOfPoints) { lock (_o) return _o.Skip(startAddress).Take(numberOfPoints).ToArray(); }
  public void WritePoints(ushort startAddress, bool[] points) { lock (_o) { foreach (var p in points) LanGhi.Add((startAddress, p, System.Diagnostics.Stopwatch.GetTimestamp())); Array.Copy(points, 0, _o, startAddress, points.Length); } }
}
public sealed class Kho : ISlaveDataStore {
  public KhoDem Hr { get; } = new();
  public KhoCoil Co { get; } = new();
  public IPointSource<bool> CoilDiscretes => Co;
  public IPointSource<bool> CoilInputs { get; } = new KhoCoil();
  public IPointSource<ushort> HoldingRegisters => Hr;
  public IPointSource<ushort> InputRegisters { get; } = new KhoDem();
}
public static class T {
  static void Kiem(bool d, string m) { if (!d) throw new Exception("TRUOT: " + m); }
  public static int Main() {
    try {
      var factory = new ModbusFactory();
      var listener = new TcpListener(IPAddress.Loopback, 0);
      listener.Start();
      int port = ((IPEndPoint)listener.LocalEndpoint).Port;
      using var network = factory.CreateSlaveNetwork(listener);
      var kho = new Kho();
      network.AddSlave(factory.CreateSlave(3, kho));
      using var cts = new CancellationTokenSource();
      _ = network.ListenAsync(cts.Token);
      var gt = Enumerable.Range(0, 90).Select(i => (short)(i * 731 - 30000)).ToList();
      gt[1] = -1; gt[2] = short.MinValue; gt[3] = short.MaxValue;
      GhiModbus.GhiCongThuc("127.0.0.1", port, 3, 500, gt, 42);
      Kiem(kho.Hr.LanGhi.Count == 1, "phai ghi bang MOT lenh FC16, thay " + kho.Hr.LanGhi.Count + " lan ghi");
      Kiem(kho.Hr.LanGhi[0] == (500, 90), "lenh ghi " + kho.Hr.LanGhi[0]);
      var doc = kho.Hr.ReadPoints(500, 90);
      for (int i = 0; i < 90; i++) Kiem(doc[i] == unchecked((ushort)gt[i]), $"thanh ghi {i}: {doc[i]} != {unchecked((ushort)gt[i])}");
      Kiem(kho.Co.LanGhi.Count == 1 && kho.Co.LanGhi[0].Dau == 42 && kho.Co.LanGhi[0].GiaTri, "coil 42 phai ON bang MOT lenh");
      try { GhiModbus.GhiCongThuc("127.0.0.1", port, 3, 0, new List<short>(), 1); Kiem(false, "rong phai nem ArgumentException"); } catch (ArgumentException) { }
      Kiem(kho.Hr.LanGhi.Count == 1 && kho.Co.LanGhi.Count == 1, "rong khong duoc ghi gi");
      cts.Cancel();
      Console.WriteLine("OK"); return 0;
    } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
  }
}
