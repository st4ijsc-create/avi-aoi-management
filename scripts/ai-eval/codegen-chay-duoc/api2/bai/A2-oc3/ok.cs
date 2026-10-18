using System.Net.Sockets;
using NModbus;

namespace Sol {
  public static class DocModbus {
    public static uint[] DocBoDem(string host, int port, byte slaveId, ushort batDau, int soBoDem) {
      using var tcp = new TcpClient(host, port);
      var factory = new ModbusFactory();
      using IModbusMaster master = factory.CreateMaster(tcp);
      master.Transport.ReadTimeout = 2000;
      var kq = new uint[soBoDem];
      const int toiDaBoDem = 62; // 124 thanh ghi <= 125
      for (int k = 0; k < soBoDem; k += toiDaBoDem) {
        int n = Math.Min(toiDaBoDem, soBoDem - k);
        ushort[] r = master.ReadHoldingRegisters(slaveId, (ushort)(batDau + 2 * k), (ushort)(2 * n));
        for (int i = 0; i < n; i++) kq[k + i] = ((uint)r[2 * i] << 16) | r[2 * i + 1];
      }
      return kq;
    }
  }
}
