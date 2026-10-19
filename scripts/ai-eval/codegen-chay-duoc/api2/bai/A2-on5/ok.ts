import ModbusRTU from "modbus-serial";

export async function docNhietDo(host: string, port: number, unitId: number, diaChi: number, soKenh: number): Promise<number[]> {
  const c = new ModbusRTU();
  await c.connectTCP(host, { port });
  try {
    c.setID(unitId);
    c.setTimeout(2000);
    const kq: number[] = [];
    const toiDaKenh = 62; // 124 thanh ghi <= 125, chẵn để không cắt đôi một giá trị
    for (let k = 0; k < soKenh; k += toiDaKenh) {
      const n = Math.min(toiDaKenh, soKenh - k);
      const r = await c.readHoldingRegisters(diaChi + 2 * k, 2 * n);
      for (let i = 0; i < n; i++) {
        const thap = r.data[2 * i], cao = r.data[2 * i + 1];
        const bf = Buffer.alloc(4);
        bf.writeUInt16BE(cao, 0);
        bf.writeUInt16BE(thap, 2);
        kq.push(Math.round(bf.readFloatBE(0) * 100) / 100);
      }
    }
    return kq;
  } finally {
    await new Promise<void>((ok) => c.close(() => ok()));
  }
}
