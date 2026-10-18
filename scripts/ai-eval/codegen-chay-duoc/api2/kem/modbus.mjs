// Máy chủ Modbus TCP GIẢ (modbus-serial ServerTCP, in-process, 127.0.0.1, cổng trống ngẫu nhiên) cho bộ tasks-api2.
// Thi hành giới hạn THẬT của giao thức mà ServerTCP bỏ qua: đọc > 125 thanh ghi ⇒ ngoại lệ 0x03 (Illegal data value).
import net from "node:net";
import ModbusRTU from "modbus-serial";

function congTrong() {
  return new Promise((ok, loi) => {
    const s = net.createServer();
    s.on("error", loi);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

export async function batModbus({ unitID = 1, soThanhGhi = 1000 } = {}) {
  const hr = new Uint16Array(soThanhGhi);
  const coils = new Array(soThanhGhi).fill(false);
  const nhatKy = []; // { fc, dia, n }
  const vector = {
    getMultipleHoldingRegisters(dia, n, unit, cb) {
      nhatKy.push({ fc: 3, dia, n });
      if (n > 125 || dia + n > soThanhGhi) return cb({ modbusErrorCode: 0x03, msg: "Illegal data value" });
      cb(null, Array.from(hr.slice(dia, dia + n)));
    },
    getHoldingRegister(dia, unit, cb) { nhatKy.push({ fc: 3, dia, n: 1 }); cb(null, hr[dia]); },
    getInputRegister(dia, unit, cb) { cb(null, 0); },
    getCoil(dia, unit, cb) { cb(null, coils[dia]); },
    getDiscreteInput(dia, unit, cb) { cb(null, false); },
    setRegister(dia, v, unit, cb) { nhatKy.push({ fc: 6, dia, n: 1 }); hr[dia] = v; cb(null); },
    setCoil(dia, v, unit, cb) { nhatKy.push({ fc: 5, dia, n: 1 }); coils[dia] = !!v; cb(null); },
  };
  const port = await congTrong();
  const server = new ModbusRTU.ServerTCP(vector, { host: "127.0.0.1", port, unitID });
  await new Promise((ok) => server.on("initialized", ok));
  const soKetNoi = () => new Promise((ok) => server._server.getConnections((e, n) => ok(e ? -1 : n)));
  const tat = () => new Promise((ok) => server.close(() => ok()));
  return { port, host: "127.0.0.1", hr, coils, nhatKy, soKetNoi, tat };
}
