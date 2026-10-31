/**
 * SCADA R1b-2b-2a T3 (mục 66, phần 2) — Step 1 THĂM DÒ (cổng): thư viện THẬT nodes7 0.3.18 / mcprotocol 0.1.2 trên peer giả trong tiến trình.
 * Ghim hình dạng item ghi (`writePacketArray[*].itemList[*]` · `valid` · `errCode`) và chuỗi errCode khi lời ghi HẾT HẠN của thư viện,
 * so với lúc PLC TRẢ LỜI LỖI.
 *   • S7: `startS7commSim()` với `setFault("hangWrite")` (không trả lời write var) / `"writeError"` (mã trả về 0x0A), `timeout` kết nối 300 ms.
 *   • MC: máy chủ TCP 1E nhị phân giả (khuôn mcErrCode.thuVienThat.test.ts), `globalTimeout` 300 ms.
 * Chỉ đo thư viện TRẦN (không qua driver). Các ca MC đánh dấu "HIỆN TRẠNG (3B sẽ sửa)" ghi lại hành vi HỎNG hôm nay của mcprotocol 0.1.2 làm bằng chứng
 * (T3B-0 đã khoá ghi MC ở driver — OT_MC_TAM_KHOA; 3B = backlog 84) — chúng KHÔNG phải sự chấp thuận hành vi đó.
 */
import net from "node:net";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { startS7commSim, type S7commSim } from "./__s7commSim";
import { laQuaHanGhiS7, S7_ERRCODE_QUA_HAN_GHI } from "./s7Driver";

const require_ = createRequire(import.meta.url);

type Item = { addr?: string; valid?: boolean; errCode?: unknown; writeResponse?: unknown; writeQuality?: unknown };
type Goi = { itemList?: Item[] };

const don: Array<() => unknown> = [];
afterEach(async () => {
  while (don.length) await don.pop()!();
});

const hinh = (conn: { writePacketArray?: Goi[] }) =>
  (conn.writePacketArray ?? []).map((g) => (g.itemList ?? []).map((i) => ({ addr: i.addr, valid: i.valid, errCode: i.errCode, writeResponse: i.writeResponse })));

// ─── S7 (nodes7 0.3.18) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function s7Tren(fault: "hangWrite" | "writeError" | null) {
  const sim: S7commSim = await startS7commSim();
  don.push(() => sim.close());
  sim.setFault(fault);
  const NodeS7 = require_("nodes7");
  const conn: any = new NodeS7({ silent: true });
  don.push(() => new Promise<void>((r) => conn.dropConnection(() => r())));
  await new Promise<void>((res, rej) => conn.initiateConnection({ port: sim.port, host: "127.0.0.1", rack: 0, slot: 1, timeout: 300, silent: true }, (e: unknown) => (e ? rej(e) : res())));
  conn.setTranslationCB((t: string) => ({ a: "DB1,X0.0", b: "DB1,INT2" })[t]);
  return { sim, conn };
}

async function s7Ghi(conn: any, keys: string[], vals: unknown[]) {
  const t0 = performance.now();
  const kq = await new Promise<{ bad: unknown; rc: unknown }>((res) => {
    let rc: unknown;
    rc = conn.writeItems(keys, vals, (bad: unknown) => res({ bad, rc }));
  });
  return { ...kq, ms: performance.now() - t0 };
}

describe("T3 Step 1 — nodes7 0.3.18 THẬT", () => {
  it("version", () => {
    expect(require_("nodes7/package.json").version).toBe("0.3.18");
  });

  it("(S7-a) hangWrite: callback(true) sau ~globalTimeout; item đầu valid=false + errCode 'We must have timed Out - we have no response to process'", async () => {
    const { sim, conn } = await s7Tren("hangWrite");
    const r = await s7Ghi(conn, ["a", "b"], [true, 7]);
    const h = hinh(conn);
    console.log("[T3 probe S7 hangWrite]", JSON.stringify({ bad: r.bad, ms: Math.round(r.ms), iso: conn.isoConnectionState, packets: h }));
    expect(r.bad).toBe(true);
    expect(r.ms).toBeGreaterThanOrEqual(250);
    expect(sim.pdus.some((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05)).toBe(true); // write var ĐÃ lên dây
    const items = h.flat();
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.valid === false && i.errCode === "We must have timed Out - we have no response to process").length).toBeGreaterThanOrEqual(1);
    expect(S7_ERRCODE_QUA_HAN_GHI).toBe("We must have timed Out - we have no response to process");
    expect(conn.writePacketArray.every((g: { timeoutError?: unknown }) => g.timeoutError === false)).toBe(true); // gói ĐÃ gửi
    expect(laQuaHanGhiS7(conn)).toBe(true);
  }, 10_000);

  it("(S7-d) lời ghi khi isoConnectionState ≠ 4 (thư viện đang tự nối lại sau hết hạn): KHÔNG gửi; gói timeoutError=true; CÙNG errCode; laQuaHanGhiS7 ⇒ false", async () => {
    const { sim, conn } = await s7Tren("hangWrite");
    const ghiTruoc = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;
    // lời ghi thứ hai gọi NGAY trong callback của lời ghi hết hạn (thư viện vừa connectionReset + connectNow ⇒ iso 0/1)
    const kq = await new Promise<{ iso: number; bad: unknown; ms: number; soGhiLuc: number }>((res) => {
      conn.writeItems(["a"], [true], () => {
        const iso = conn.isoConnectionState;
        const soGhiLuc = ghiTruoc();
        const t0 = performance.now();
        conn.writeItems(["b"], [9], (bad: unknown) => res({ iso, bad, ms: performance.now() - t0, soGhiLuc }));
      });
    });
    await new Promise((r) => setTimeout(r, 100));
    const h = hinh(conn);
    console.log("[T3 probe S7 khong gui]", JSON.stringify({ ...kq, ms: Math.round(kq.ms), timeoutError: conn.writePacketArray.map((g: { timeoutError?: unknown }) => g.timeoutError), packets: h, writePdus: ghiTruoc() }));
    expect(kq.iso).not.toBe(4);
    expect(kq.bad).toBe(true);
    expect(kq.ms).toBeLessThan(150); // hẹn 0 ms, không phải globalTimeout
    expect(ghiTruoc()).toBe(kq.soGhiLuc); // KHÔNG PDU ghi mới nào tới PLC
    expect(conn.writePacketArray.every((g: { timeoutError?: unknown }) => g.timeoutError === true)).toBe(true);
    expect(h.flat()[0]).toMatchObject({ valid: false, errCode: S7_ERRCODE_QUA_HAN_GHI });
    expect(laQuaHanGhiS7(conn)).toBe(false);
  }, 10_000);

  it("(S7-b) writeError (0x0A): callback(true) NHANH; không item nào mang errCode quá hạn", async () => {
    const { conn } = await s7Tren("writeError");
    const r = await s7Ghi(conn, ["a", "b"], [true, 7]);
    const h = hinh(conn);
    console.log("[T3 probe S7 writeError]", JSON.stringify({ bad: r.bad, ms: Math.round(r.ms), iso: conn.isoConnectionState, packets: h }));
    expect(r.bad).toBe(true);
    expect(r.ms).toBeLessThan(250);
    expect(h.flat().some((i) => i.errCode === "We must have timed Out - we have no response to process")).toBe(false);
    expect(laQuaHanGhiS7(conn)).toBe(false);
  }, 10_000);

  it("(S7-c) trả lời tốt: callback(false)", async () => {
    const { conn } = await s7Tren(null);
    const r = await s7Ghi(conn, ["a"], [true]);
    console.log("[T3 probe S7 ok]", JSON.stringify({ bad: r.bad, ms: Math.round(r.ms), packets: hinh(conn) }));
    expect(r.bad).toBe(false);
  }, 10_000);
});

// ─── MC (mcprotocol 0.1.2, khung 1E nhị phân — khung mặc định; driver không truyền `frame`) ─────────────────────────────────────────────
async function mcTren(traLoi: Buffer | null) {
  const socks: net.Socket[] = [];
  const nhan: string[] = [];
  const srv = net.createServer((s) => {
    socks.push(s);
    s.on("error", () => {});
    s.on("data", (d) => {
      nhan.push(d.toString("hex"));
      if (traLoi) s.write(traLoi);
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  don.push(() => {
    for (const s of socks) s.destroy();
    srv.close();
  });
  const MC = require_("mcprotocol");
  const conn: any = new MC();
  conn.globalTimeout = 300;
  don.push(() => conn.dropConnection());
  // Bắt lỗi ném ra từ bộ xử lý 'data' của thư viện (onResponse) — nếu không, nó thành uncaughtException của tiến trình.
  const loiNem: string[] = [];
  const goc = conn.onResponse;
  conn.onResponse = function (...a: unknown[]) {
    try {
      return goc.apply(this, a);
    } catch (e) {
      loiNem.push(`${(e as { code?: string }).code}: ${(e as Error).message}`);
    }
  };
  await new Promise<void>((res, rej) => conn.initiateConnection({ port: (srv.address() as net.AddressInfo).port, host: "127.0.0.1", ascii: false }, (e: unknown) => (e ? rej(e) : res())));
  conn.setTranslationCB((t: string) => ({ a: "D100", b: "M100" })[t]);
  const t0 = performance.now();
  const r = await new Promise<{ bad: unknown; rc: unknown }>((res) => {
    let rc: unknown;
    rc = conn.writeItems(["a", "b"], [5, true], (bad: unknown) => res({ bad, rc }));
  });
  return { conn, ...r, ms: performance.now() - t0, nhan, loiNem };
}

const MC_QUA_HAN_1E = "Malformed Reply MC Packet - Less Than 2 Bytesundefined";

describe("T3 Step 1 — mcprotocol 0.1.2 THẬT (1E) — thư viện TRẦN; hành vi hỏng = HIỆN TRẠNG (3B sẽ sửa), driver đã khoá ghi (T3B-0)", () => {
  it("version + khung mặc định 1E", () => {
    expect(require_("mcprotocol/package.json").version).toBe("0.1.2");
    const MC = require_("mcprotocol");
    expect(new MC().frame).toBe("1E");
  });

  it("(MC-a) PLC IM: callback(true) sau ~globalTimeout; mọi item valid=false + errCode = 'Malformed Reply MC Packet - Less Than 2 Bytes' + undefined", async () => {
    const m = await mcTren(null);
    const h = hinh(m.conn);
    console.log("[T3 probe MC silent]", JSON.stringify({ rc: m.rc, bad: m.bad, ms: Math.round(m.ms), frames: m.nhan, packets: h, thrown: m.loiNem }));
    expect(m.bad).toBe(true);
    expect(m.ms).toBeGreaterThanOrEqual(250);
    expect(m.nhan.length).toBe(2); // 1E: một item mỗi khung — khung thứ hai VẪN được gửi sau khi khung đầu hết hạn
    for (const it of h.flat()) expect(it).toMatchObject({ valid: false, errCode: MC_QUA_HAN_1E });
  }, 10_000);

  it("(MC-b) HIỆN TRẠNG (3B sẽ sửa) — ★ PLC trả lời ĐÚNG khung 1E thành công (83 00, 2 byte) ⇒ thư viện NÉM ERR_OUT_OF_RANGE trong onResponse (đọc byte 9); gói không bao giờ 'rcvd' ⇒ hết hạn ⇒ CÙNG errCode quá hạn", async () => {
    const m = await mcTren(Buffer.from([0x83, 0x00]));
    const h = hinh(m.conn);
    console.log("[T3 probe MC ok-2byte]", JSON.stringify({ rc: m.rc, bad: m.bad, ms: Math.round(m.ms), packets: h, thrown: m.loiNem }));
    expect(m.loiNem.length).toBeGreaterThanOrEqual(1);
    expect(m.loiNem[0]).toMatch(/^ERR_OUT_OF_RANGE/);
    expect(m.bad).toBe(true);
    expect(m.ms).toBeGreaterThanOrEqual(250);
    for (const it of h.flat()) expect(it).toMatchObject({ valid: false, errCode: MC_QUA_HAN_1E });
  }, 10_000);

  it("(MC-c) HIỆN TRẠNG (3B sẽ sửa) — ★ PLC trả END CODE LỖI (83 5B 10 00, 4 byte) ⇒ cũng ném ⇒ errCode = chuỗi QUÁ HẠN (KHÔNG khác — trái với giả định của brief)", async () => {
    const m = await mcTren(Buffer.from([0x83, 0x5b, 0x10, 0x00]));
    const h = hinh(m.conn);
    console.log("[T3 probe MC endcode-4byte]", JSON.stringify({ rc: m.rc, bad: m.bad, ms: Math.round(m.ms), packets: h, thrown: m.loiNem }));
    expect(m.loiNem[0]).toMatch(/^ERR_OUT_OF_RANGE/);
    for (const it of h.flat()) expect(it).toMatchObject({ valid: false, errCode: MC_QUA_HAN_1E });
  }, 10_000);

  it("(MC-d) HIỆN TRẠNG (3B sẽ sửa) — ★ END CODE LỖI 0x5B nhưng khung ≥ 10 byte ⇒ thư viện đọc byte 9 (=0) làm end code ⇒ callback(false) = ACK GIẢ; errCode không đặt", async () => {
    const m = await mcTren(Buffer.from([0x83, 0x5b, 0x10, 0, 0, 0, 0, 0, 0, 0]));
    const h = hinh(m.conn);
    console.log("[T3 probe MC endcode-padded]", JSON.stringify({ rc: m.rc, bad: m.bad, ms: Math.round(m.ms), packets: h, thrown: m.loiNem }));
    expect(m.loiNem).toEqual([]);
    expect(m.bad).toBe(false);
    for (const it of h.flat()) expect(it.errCode).toBeUndefined();
  }, 10_000);
});
