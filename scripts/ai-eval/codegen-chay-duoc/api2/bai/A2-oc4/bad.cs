using System.Net.Sockets;
using NModbus;

// SAI (lỗi điển hình): ghi từng thanh ghi một bằng FC06 — công thức nửa vời nếu đứt giữa chừng; đặc tả đòi MỘT lệnh FC16.
namespace Sol {
  public static class GhiModbus {
    public static void GhiCongThuc(string host, int port, byte slaveId, ushort diaChi, IReadOnlyList<short> giaTri, ushort coilKichHoat) {
      if (giaTri == null || giaTri.Count == 0) throw new ArgumentException("giaTri rong", nameof(giaTri));
      using var tcp = new TcpClient(host, port);
      using IModbusMaster master = new ModbusFactory().CreateMaster(tcp);
      master.Transport.ReadTimeout = 2000;
      for (int i = 0; i < giaTri.Count; i++) master.WriteSingleRegister(slaveId, (ushort)(diaChi + i), unchecked((ushort)giaTri[i]));
      master.WriteSingleCoil(slaveId, coilKichHoat, true);
    }
  }
}
