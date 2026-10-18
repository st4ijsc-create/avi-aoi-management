using System.Net.Sockets;
using NModbus;

namespace Sol {
  public static class GhiModbus {
    public static void GhiCongThuc(string host, int port, byte slaveId, ushort diaChi, IReadOnlyList<short> giaTri, ushort coilKichHoat) {
      if (giaTri == null || giaTri.Count == 0) throw new ArgumentException("giaTri rong", nameof(giaTri));
      var thanhGhi = giaTri.Select(v => unchecked((ushort)v)).ToArray();
      using var tcp = new TcpClient(host, port);
      using IModbusMaster master = new ModbusFactory().CreateMaster(tcp);
      master.Transport.ReadTimeout = 2000;
      master.Transport.WriteTimeout = 2000;
      master.WriteMultipleRegisters(slaveId, diaChi, thanhGhi);
      master.WriteSingleCoil(slaveId, coilKichHoat, true);
    }
  }
}
