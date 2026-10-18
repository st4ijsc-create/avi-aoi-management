import ModbusRTU from "modbus-serial";

// SAI (lỗi điển hình): đọc theo thứ tự "ABCD" (thanh ghi đầu là 16 bit CAO) — sai với thiết bị CDAB.
export async function docNhietDo(host: string, port: number, unitId: number, diaChi: number, soKenh: number): Promise<number[]> {
  const c = new ModbusRTU();
  await c.connectTCP(host, { port });
  try {
    c.setID(unitId);
    c.setTimeout(2000);
    const kq: number[] = [];
    const toiDaKenh = 62;
    for (let k = 0; k < soKenh; k += toiDaKenh) {
      const n = Math.min(toiDaKenh, soKenh - k);
      const r = await c.readHoldingRegisters(diaChi + 2 * k, 2 * n);
      for (let i = 0; i < n; i++) {
        const bf = Buffer.alloc(4);
        bf.writeUInt16BE(r.data[2 * i], 0);
        bf.writeUInt16BE(r.data[2 * i + 1], 2);
        kq.push(Math.round(bf.readFloatBE(0) * 100) / 100);
      }
    }
    return kq;
  } finally {
    await new Promise<void>((ok) => c.close(() => ok()));
  }
}
