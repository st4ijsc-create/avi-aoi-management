/**
 * SCADA R1b-2b-2a T6b (dieu-phoi 2026-11-01) — kết quả "không rõ" của STOP KHÔNG BAO GIỜ chờ đọc lại.
 *
 * T6 fix 1 bỏ đọc lại cả lô khi có write `mat_lien_ket`. T2 vẫn cho đọc lại ở lô trộn write acked + write `qua_han_driver` (driver / thư viện tự hết
 * hạn) ⇒ một STOP với đọc lại BẮT BUỘC (HMI, `docLai:"bat_buoc"`) báo "không rõ" muộn thêm tới hạn đọc lại. T6b: MỘT hàm thuần `lyDoBoDocLai` quyết
 * cho mọi loại "không rõ" — lô có ≥ 1 write `ok:false` mang `ketCucKhongRo` KHÁC null (mat_lien_ket, qua_han_driver, hay giá trị lạ của driver plugin —
 * polish m1) ⇒ không `readTags`, write acked ⇒ `acked_unverified`
 * với câu lý do; lô vẫn cuộn lên `timeout` (T2).
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { ModbusDriver } from "./drivers/modbusDriver";
import { executeOtDeviceWrite, lyDoBoDocLai, LY_DO_BO_DOC_LAI_KHONG_RO, LY_DO_BO_DOC_LAI_MAT_LIEN_KET, LY_DO_BO_DOC_LAI_QUA_HAN } from "./otDeviceWrite";
import { ketCucLo } from "./motPhan";
import { batDauDoLag } from "../../testing/doLagBucleSuKien";

describe("T6b — lyDoBoDocLai (MỘT nơi quyết, hàm thuần)", () => {
  it("write `qua_han_driver` ⇒ bỏ đọc lại, câu riêng 'driver request timed out in this batch' (polish m1)", () => {
    expect(lyDoBoDocLai([{ ok: true }, { ok: false, ketCucKhongRo: "qua_han_driver" }])).toBe(LY_DO_BO_DOC_LAI_QUA_HAN);
    expect(LY_DO_BO_DOC_LAI_QUA_HAN).toBe("readback skipped: driver request timed out in this batch");
  });
  it("write `mat_lien_ket` ⇒ câu 'link lost in this batch' (ưu tiên khi lô có cả hai loại)", () => {
    expect(lyDoBoDocLai([{ ok: true }, { ok: false, ketCucKhongRo: "mat_lien_ket" }])).toBe(LY_DO_BO_DOC_LAI_MAT_LIEN_KET);
    expect(lyDoBoDocLai([{ ok: false, ketCucKhongRo: "qua_han_driver" }, { ok: false, ketCucKhongRo: "mat_lien_ket" }])).toBe(LY_DO_BO_DOC_LAI_MAT_LIEN_KET);
    expect(LY_DO_BO_DOC_LAI_MAT_LIEN_KET).toBe("readback skipped: link lost in this batch");
  });
  it("polish m1: giá trị `ketCucKhongRo` LẠ (driver plugin) ⇒ vẫn bỏ đọc lại, câu chung 'outcome unknown in this batch'; mat_lien_ket > qua_han > lạ", () => {
    expect(lyDoBoDocLai([{ ok: true }, { ok: false, ketCucKhongRo: "khac" }])).toBe(LY_DO_BO_DOC_LAI_KHONG_RO);
    expect(LY_DO_BO_DOC_LAI_KHONG_RO).toBe("readback skipped: outcome unknown in this batch");
    expect(lyDoBoDocLai([{ ok: false, ketCucKhongRo: "khac" }, { ok: false, ketCucKhongRo: "qua_han_driver" }])).toBe(LY_DO_BO_DOC_LAI_QUA_HAN);
    expect(lyDoBoDocLai([{ ok: false, ketCucKhongRo: "khac" }, { ok: false, ketCucKhongRo: "mat_lien_ket" }])).toBe(LY_DO_BO_DOC_LAI_MAT_LIEN_KET);
  });
  it("kiem-dinh b9: luật chọn câu KHÔNG phụ thuộc thứ tự — câu của loại ĐÃ BIẾT thắng câu chung: qua_han rồi lạ, lạ rồi qua_han ⇒ đều câu qua_han; lạ ở bất kỳ đâu không ghi đè mat_lien_ket", () => {
    const QH = { ok: false, ketCucKhongRo: "qua_han_driver" };
    const LA = { ok: false, ketCucKhongRo: "khac" };
    const LA2 = { ok: false, ketCucKhongRo: "plugin_rieng" };
    const ML = { ok: false, ketCucKhongRo: "mat_lien_ket" };
    expect(lyDoBoDocLai([QH, LA])).toBe(LY_DO_BO_DOC_LAI_QUA_HAN); // qua_han TRƯỚC lạ (đột biến b9 ⇒ câu chung)
    expect(lyDoBoDocLai([LA, QH])).toBe(LY_DO_BO_DOC_LAI_QUA_HAN); // lạ TRƯỚC qua_han
    expect(lyDoBoDocLai([{ ok: true }, QH, LA, LA2])).toBe(LY_DO_BO_DOC_LAI_QUA_HAN);
    expect(lyDoBoDocLai([LA, QH, LA2])).toBe(LY_DO_BO_DOC_LAI_QUA_HAN);
    expect(lyDoBoDocLai([ML, LA])).toBe(LY_DO_BO_DOC_LAI_MAT_LIEN_KET);
    expect(lyDoBoDocLai([QH, LA, ML])).toBe(LY_DO_BO_DOC_LAI_MAT_LIEN_KET);
    expect(lyDoBoDocLai([LA, LA2])).toBe(LY_DO_BO_DOC_LAI_KHONG_RO); // chỉ loại lạ ⇒ câu chung
  });
  it("lô RÕ (acked + failed, hoặc toàn acked, hoặc rỗng) ⇒ null — đọc lại như thường", () => {
    expect(lyDoBoDocLai([{ ok: true }, { ok: false }])).toBeNull();
    expect(lyDoBoDocLai([{ ok: true }, { ok: true }])).toBeNull();
    expect(lyDoBoDocLai([])).toBeNull();
    expect(lyDoBoDocLai([{ ok: true, ketCucKhongRo: "qua_han_driver" }])).toBeNull(); // ok thắng (không thể có — phòng thủ)
  });
});

// ───────────────────────── Modbus THẬT (modbus-serial) trên peer giả ─────────────────────────

/**
 * Server Modbus TCP tối giản: FC5 tới coil `coilImLang` ⇒ IM LẶNG (không trả lời, không đóng) — modbus-serial tự hết hạn (`cfg.timeoutMs`);
 * FC5 khác ⇒ trả lời echo (acked); FC1 (đọc coil — đọc lại) ⇒ IM LẶNG (đọc lại, nếu chạy, phải chờ hết hạn của từng lượt đọc) và được ĐẾM.
 */
async function startSim(coilImLang: number): Promise<{ port: number; fc5: () => number; fc1: () => number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  let n5 = 0;
  let n1 = 0;
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) return;
        const frame = buf.subarray(0, 6 + len);
        buf = buf.subarray(6 + len);
        const tid = frame.readUInt16BE(0);
        const unit = frame[6];
        const fc = frame[7];
        const reply = (pdu: Buffer) => {
          const h = Buffer.alloc(7);
          h.writeUInt16BE(tid, 0);
          h.writeUInt16BE(0, 2);
          h.writeUInt16BE(pdu.length + 1, 4);
          h[6] = unit;
          if (!sock.destroyed) sock.write(Buffer.concat([h, pdu]));
        };
        if (fc === 1) {
          n1 += 1;
          continue; // đọc lại: im lặng
        }
        if (fc !== 5) {
          reply(Buffer.from([fc | 0x80, 1]));
          continue;
        }
        n5 += 1;
        if (frame.readUInt16BE(8) === coilImLang) continue; // write này: thiết bị không trả lời
        reply(frame.subarray(7, 12));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    fc5: () => n5,
    fc1: () => n1,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

let dong: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of dong.reverse()) await f();
  dong = [];
});

/** Hạn giao dịch của modbus-serial (`cfg.timeoutMs` ⇒ `client.setTimeout`) = "hạn write" của lô. */
const HAN_WRITE_MS = 300;

describe("T6b — Modbus THẬT: write acked + write hết hạn của CHÍNH modbus-serial, đọc lại BẮT BUỘC", () => {
  it("★ STOP 4 coil (3 acked, coil 4 im lặng), docLai bat_buoc ⇒ 'không rõ' trong (hạn write 300 + 500) ms, KHÔNG gồm hạn đọc lại; 0 lượt đọc; acked ⇒ acked_unverified", async () => {
    const sim = await startSim(3); // "00004" ⇒ coil 3 (0-based)
    const d = new ModbusDriver();
    dong.push(() => sim.close(), () => d.disconnect());
    await d.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs: HAN_WRITE_MS, options: { unitId: 1 } } as any);
    const ws = [1, 2, 3, 4].map((i) => ({ tagKey: `stop_${i}`, address: `0000${i}`, value: true, dataType: "bool" as const }));
    const lag = batDauDoLag();
    const t0 = performance.now();
    const o = await executeOtDeviceWrite({
      input: {
        adapterId: 995_000 + Math.floor(Math.random() * 1000),
        machineId: null,
        commandType: "stop",
        idempotencyKey: `t6b-${Math.random()}`,
        writes: ws.map((w) => ({ tagKey: w.tagKey, value: w.value })),
        docLai: "bat_buoc",
      } as any,
      driver: d,
      resolved: ws.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
      driverWrites: ws.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
      timeoutMs: 5000,
      stopTyped: true,
      bumpStopEpoch: true,
      ledger: { intentIds: [1, 2, 3, 4], confirmedBy: 1 },
    });
    const troi = performance.now() - t0;
    const lagMs = await lag.dung(200);
    expect(troi, `trả lời sau ${Math.round(troi)} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_WRITE_MS + 500 + lagMs);
    expect(troi).toBeGreaterThanOrEqual(HAN_WRITE_MS - 10); // write 4 thật sự chờ hết hạn của thư viện
    expect(sim.fc5()).toBe(4);
    expect(sim.fc1()).toBe(0); // ★ không lượt đọc nào của thư viện
    expect(o.timedOut).toBe(false);
    expect(o.outcomes.map((x) => x.status)).toEqual(["acked_unverified", "acked_unverified", "acked_unverified", "timeout"]);
    for (const x of o.outcomes.slice(0, 3)) expect(x).toMatchObject({ ok: true, errorText: LY_DO_BO_DOC_LAI_QUA_HAN, readBackValue: null });
    expect(o.outcomes[3].errorText).toMatch(/outcome unknown: the write may have been applied on the device$/);
    // lô vẫn cuộn lên `timeout` (T2 thắng một phần)
    expect(ketCucLo(o.outcomes.map((x, i) => ({ tagKey: ws[i].tagKey, ok: x.ok, status: x.status })), o.timedOut)).toMatchObject({ ok: false, status: "timeout", motPhan: null });
  }, 15_000);

  it("đối chứng: lô RÕ (4 coil acked) + docLai bat_buoc ⇒ đọc lại VẪN chạy (FC1 được gửi) — luật chỉ áp cho lô 'không rõ'", async () => {
    const sim = await startSim(0xffff); // không coil nào im lặng
    const d = new ModbusDriver();
    dong.push(() => sim.close(), () => d.disconnect());
    await d.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs: HAN_WRITE_MS, options: { unitId: 1 } } as any);
    const ws = [1, 2].map((i) => ({ tagKey: `stop_${i}`, address: `0000${i}`, value: true, dataType: "bool" as const }));
    const o = await executeOtDeviceWrite({
      input: { adapterId: 995_500, machineId: null, commandType: "stop", idempotencyKey: `t6b-dc-${Math.random()}`, writes: ws.map((w) => ({ tagKey: w.tagKey, value: w.value })), docLai: "bat_buoc" } as any,
      driver: d,
      resolved: ws.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
      driverWrites: ws.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
      timeoutMs: 5000,
      stopTyped: true,
      bumpStopEpoch: true,
      ledger: { intentIds: [1, 2], confirmedBy: 1 },
    });
    expect(sim.fc1()).toBeGreaterThan(0); // đọc lại đã chạy
    expect(o.outcomes.every((x) => x.ok)).toBe(true);
    for (const x of o.outcomes) expect(x.errorText ?? "").not.toMatch(/readback skipped/);
  }, 15_000);
});

describe("T6b polish (review m1) — driver plugin trả `ketCucKhongRo` lạ qua cầu nối (không kiểm)", () => {
  it("★ kết quả kiểu plugin [{ok:true}, {ok:false, ketCucKhongRo:'khac'}] + docLai bat_buoc ⇒ write 2 'timeout', write 1 acked_unverified câu chung, 0 lượt readTags", async () => {
    let soDoc = 0;
    const driver = {
      protocol: "plugin:demo",
      writeTags: async () => [
        { tagKey: "a", ok: true },
        { tagKey: "b", ok: false, error: "sidecar: device did not confirm", ketCucKhongRo: "khac" },
      ],
      readTags: async () => {
        soDoc += 1;
        return [];
      },
    } as any;
    const ws = [
      { tagKey: "a", address: "A", value: 1, dataType: "int" as const },
      { tagKey: "b", address: "B", value: 2, dataType: "int" as const },
    ];
    const o = await executeOtDeviceWrite({
      input: { adapterId: 995_900, machineId: null, commandType: "set_value", idempotencyKey: `t6b-pl-${Math.random()}`, writes: ws.map((w) => ({ tagKey: w.tagKey, value: w.value })), docLai: "bat_buoc" } as any,
      driver,
      resolved: ws.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
      driverWrites: ws.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
      timeoutMs: 5000,
      stopTyped: false,
      bumpStopEpoch: false,
      ledger: { intentIds: [1, 2], confirmedBy: 1 },
    });
    expect(soDoc).toBe(0); // ★ không đọc lại
    expect(o.outcomes.map((x) => x.status)).toEqual(["acked_unverified", "timeout"]);
    expect(o.outcomes[0]).toMatchObject({ ok: true, errorText: LY_DO_BO_DOC_LAI_KHONG_RO });
  });
});
