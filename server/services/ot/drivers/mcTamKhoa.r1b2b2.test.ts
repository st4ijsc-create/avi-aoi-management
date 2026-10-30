/**
 * SCADA R1b-2b-2a T3B-0 (backlog 84) — Mitsubishi MC TẠM KHOÁ GHI (fail-closed) tới khi có 3B.
 *
 * Driver THẬT + mcprotocol 0.1.2 THẬT + máy chủ 1E nhị phân giả trong tiến trình:
 *   • khung ghi (subheader 02 bit / 03 word) ⇒ trả ack ĐÚNG 2 byte `83 00` — chính những byte làm thư viện ném ERR_OUT_OF_RANGE trong handler
 *     socket (đọc end code ở byte 9) ⇒ uncaughtException ⇒ tiến trình thoát (hiện trạng trước bản vá, thăm dò T3);
 *   • khung đọc word (01) ⇒ `81 00 2A 00` (D100 = 42); đọc bit (00) ⇒ `80 00 10`.
 * Đếm khung ghi nhận được ⇒ "không gói nào" là số đo, không phải lời khai.
 */
import net from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MitsubishiMcDriver, MA_MC_TAM_KHOA, LY_DO_MC_TAM_KHOA, mcGhiTamKhoa, __moKhoaGhiMcChoTest } from "./mitsubishiMcDriver";
import { executeOtDeviceWrite } from "../otDeviceWrite";
import { maLoiCua } from "../../../routers/_chiTietKyThuat";

interface May1E {
  port: number;
  khungGhi: () => number;
  khungDoc: () => number;
  close: () => Promise<void>;
}

async function startMay1E(chamDocMs = 0): Promise<May1E> {
  const socks = new Set<net.Socket>();
  let ghi = 0;
  let doc = 0;
  const srv = net.createServer((s) => {
    socks.add(s);
    s.on("close", () => socks.delete(s));
    s.on("error", () => undefined);
    s.on("data", (d) => {
      const sub = d[0];
      if (sub === 0x02 || sub === 0x03) {
        ghi += 1;
        s.write(Buffer.from([sub | 0x80, 0x00])); // ack 1E ĐÚNG (2 byte) — làm mcprotocol 0.1.2 ném
      } else if (sub === 0x01) {
        doc += 1;
        const tl = Buffer.from([0x81, 0x00, 0x2a, 0x00]);
        if (chamDocMs > 0) setTimeout(() => !s.destroyed && s.write(tl), chamDocMs);
        else s.write(tl);
      } else if (sub === 0x00) {
        doc += 1;
        s.write(Buffer.from([0x80, 0x00, 0x10]));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return {
    port: (srv.address() as net.AddressInfo).port,
    khungGhi: () => ghi,
    khungDoc: () => doc,
    close: () =>
      new Promise<void>((r) => {
        for (const s of socks) s.destroy();
        srv.close(() => r());
      }),
  };
}

let dong: Array<() => unknown> = [];
let loiTienTrinh: unknown[] = [];
const nghe = (e: unknown) => loiTienTrinh.push(e);
beforeEach(() => {
  loiTienTrinh = [];
  process.on("uncaughtException", nghe);
});
afterEach(async () => {
  for (const f of dong.reverse()) await f();
  dong = [];
  process.off("uncaughtException", nghe);
});

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mcTren(chamDocMs = 0): Promise<{ may: May1E; d: MitsubishiMcDriver }> {
  const may = await startMay1E(chamDocMs);
  const d = new MitsubishiMcDriver();
  dong.push(() => may.close(), () => d.disconnect());
  await d.connect({ endpoint: `127.0.0.1:${may.port}`, timeoutMs: 2000 });
  return { may, d };
}

const LOI_KHOA = `${MA_MC_TAM_KHOA}: ${LY_DO_MC_TAM_KHOA}`;

describe("T3B-0 — MC tạm khoá GHI (mcprotocol 0.1.2 thật, máy chủ 1E giả gửi ack 2 byte)", () => {
  it("hằng + mã ổn định", () => {
    expect(MA_MC_TAM_KHOA).toBe("OT_MC_TAM_KHOA");
    expect(mcGhiTamKhoa()).toBe(true);
  });

  it("cờ mở khoá chỉ-test: NGOÀI vitest bị bỏ qua (khoá giữ nguyên); trong vitest mở/đóng được", () => {
    const cu = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(__moKhoaGhiMcChoTest(true)).toBe(false);
      expect(mcGhiTamKhoa()).toBe(true);
    } finally {
      if (cu !== undefined) process.env.VITEST = cu;
      __moKhoaGhiMcChoTest(false);
    }
    expect(process.env.VITEST).toBeTruthy();
    expect(__moKhoaGhiMcChoTest(true)).toBe(true);
    expect(mcGhiTamKhoa()).toBe(false);
    expect(__moKhoaGhiMcChoTest(false)).toBe(true);
    expect(mcGhiTamKhoa()).toBe(true);
  });

  it("★ writeTags (STOP M100 + D100) ⇒ mọi write ok:false OT_MC_TAM_KHOA, 0 khung ghi tới PLC, không uncaughtException", async () => {
    const { may, d } = await mcTren();
    const out = await d.writeTags([
      { tagKey: "stop", address: "M100", value: true, dataType: "bool", dungGhim: true },
      { tagKey: "sp", address: "D100", value: 5, dataType: "int" },
    ]);
    expect(out).toEqual([
      { tagKey: "stop", ok: false, error: LOI_KHOA },
      { tagKey: "sp", ok: false, error: LOI_KHOA },
    ]);
    await cho(300); // đủ để một ack (nếu có khung) quay về và thư viện xử lý
    expect(may.khungGhi()).toBe(0);
    expect(loiTienTrinh).toEqual([]);
  }, 15_000);

  it("★ STOP qua executeOtDeviceWrite ⇒ 'failed' (không bao giờ ok / timeout), mã OT_MC_TAM_KHOA hiện được qua maLoiCua, 0 khung", async () => {
    const { may, d } = await mcTren();
    const o = await executeOtDeviceWrite({
      input: { adapterId: 994_000 + Math.floor(Math.random() * 1000), machineId: null, commandType: "stop", idempotencyKey: `mc-khoa-${Math.random()}`, writes: [{ tagKey: "stop", value: true }] } as any,
      driver: d,
      resolved: [{ write: { tagKey: "stop", value: true }, address: "M100", dataType: "bool" }] as any,
      driverWrites: [{ tagKey: "stop", address: "M100", value: true, dataType: "bool" as any }],
      timeoutMs: 2000,
      stopTyped: true,
      bumpStopEpoch: true,
      ledger: { intentIds: [1], confirmedBy: 1 },
    });
    expect(o.timedOut).toBe(false);
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed", errorText: LOI_KHOA });
    expect(maLoiCua(o.outcomes[0].errorText, "failed")).toBe("OT_MC_TAM_KHOA");
    await cho(300);
    expect(may.khungGhi()).toBe(0);
    expect(loiTienTrinh).toEqual([]);
  }, 15_000);

  it("chưa kết nối ⇒ VẪN trả lý do khoá (không ném unreachable), không gửi", async () => {
    const d = new MitsubishiMcDriver();
    const out = await d.writeTags([{ tagKey: "stop", address: "M100", value: true, dataType: "bool" }]);
    expect(out).toEqual([{ tagKey: "stop", ok: false, error: LOI_KHOA }]);
  });

  it("phòng thủ thứ hai: gọi thẳng writeItems của instance thư viện (bỏ qua writeTags) ⇒ không khung nào", async () => {
    const { may, d } = await mcTren();
    const conn = (d as any).conn;
    conn.setTranslationCB((t: string) => ({ a: "D100" })[t]);
    let goiLai = false;
    const rc = conn.writeItems(["a"], [5], () => (goiLai = true));
    expect(rc).toBeUndefined();
    await cho(300);
    expect(may.khungGhi()).toBe(0);
    expect(goiLai).toBe(false);
    expect(loiTienTrinh).toEqual([]);
  }, 15_000);
});

describe("T3B-0 — ĐỌC được giữ; handler của thư viện được CÔ LẬP", () => {
  it("đọc D100 vẫn good 42 khi ghi khoá; health: connected + lastError mang OT_MC_TAM_KHOA", async () => {
    const { may, d } = await mcTren();
    const s = await d.readTags([{ tagKey: "sp", address: "D100", dataType: "int" }]);
    expect(s[0]).toMatchObject({ tagKey: "sp", quality: "good", value: 42 });
    expect(may.khungDoc()).toBeGreaterThanOrEqual(1);
    const h = await d.health();
    expect(h.connected).toBe(true);
    expect(h.lastError).toBe(LOI_KHOA);
  }, 15_000);

  it("★ cô lập: ai đó đẩy được một lời ghi qua thư viện (prototype, bỏ cả hai lớp khoá) ⇒ ack 2 byte làm thư viện ném TRONG handler ⇒ bị bắt, KHÔNG uncaughtException; phiên bị hạ", async () => {
    const { may, d } = await mcTren();
    const conn = (d as any).conn;
    conn.setTranslationCB((t: string) => ({ a: "D100" })[t]);
    const goc = Object.getPrototypeOf(conn).writeItems as (...a: unknown[]) => unknown;
    goc.call(conn, ["a"], [5], () => undefined); // lời ghi THẬT lên dây (mô phỏng lỗ hổng — để đo lớp cô lập)
    await cho(400);
    expect(may.khungGhi()).toBe(1); // ack `83 00` đã về
    expect(loiTienTrinh).toEqual([]); // trước bản vá: ERR_OUT_OF_RANGE ⇒ uncaughtException ⇒ tiến trình thoát mã 1
    expect(d.isConnected()).toBe(false); // phiên bị hạ (trạng thái thư viện không còn tin được) ⇒ supervisor nối lại
    const h = await d.health();
    expect(h.lastError).toContain(MA_MC_TAM_KHOA);
    expect(h.lastError).toMatch(/library onResponse threw.*ERR_OUT_OF_RANGE/);
  }, 15_000);
});

describe("T3B-0 fix 1 (m1) — vòng thử lại 100 ms của readAllItems cũng được cô lập", () => {
  it("★ hai lượt đọc chồng nhau, bản dịch tag thiếu khoá ⇒ readAllItems ném TypeError TRONG hẹn giờ thư viện ⇒ bị bắt: không uncaughtException, phiên bị hạ, đọc kế ⇒ unreachable (bad)", async () => {
    const { d } = await mcTren(400); // PLC trả lời đọc chậm 400 ms ⇒ lượt A còn bay khi lượt B xếp hàng
    const conn = (d as any).conn;
    const A = d.readTags([{ tagKey: "sp", address: "D100", dataType: "int" }]).then(
      () => "xong",
      (e: unknown) => String((e as Error)?.message ?? e),
    ); // lượt A đang bay bị hạ cùng phiên (mất liên kết khi đang gửi) — không được treo, không rơi ra ngoài
    await cho(80);
    // lượt B: bản dịch không ánh xạ khoá "zz" ⇒ addItemsNow ném TypeError (split của undefined) khi hẹn giờ 100 ms chạy
    conn.setTranslationCB(() => undefined);
    conn.removeItems();
    conn.addItems(["zz"]);
    conn.readAllItems(() => undefined);
    await cho(700);
    expect(await A).toMatch(/link lost|xong/);
    expect(loiTienTrinh).toEqual([]); // bỏ bọc ⇒ TypeError uncaughtException ⇒ tiến trình thoát
    expect(d.isConnected()).toBe(false); // phiên bị hạ
    const h = await d.health();
    expect(h.lastError).toMatch(/library readAllItems threw/);
    // đọc kế: phiên đã hạ ⇒ driver ném unreachable (vòng poll ghi mẫu bad) — không bao giờ trả giá trị tốt
    await expect(d.readTags([{ tagKey: "sp", address: "D100", dataType: "int" }])).rejects.toThrow(/unreachable|not connected|mitsubishi-mc/i);
  }, 20_000);
});

describe("T3B-0 fix 1 (m2) — người đọc mcGhiTamKhoa đòi VITEST", () => {
  it("cờ toàn cục đặt tay (ngoài vitest) KHÔNG mở khoá; trong vitest thì có", () => {
    const g = globalThis as Record<symbol, unknown>;
    const co = Symbol.for("scada.ot.mc.moKhoaGhiChoTest");
    const cu = process.env.VITEST;
    g[co] = true;
    try {
      delete process.env.VITEST;
      expect(mcGhiTamKhoa()).toBe(true);
      process.env.VITEST = cu ?? "true";
      expect(mcGhiTamKhoa()).toBe(false);
    } finally {
      delete g[co];
      if (cu !== undefined) process.env.VITEST = cu;
    }
    expect(mcGhiTamKhoa()).toBe(true);
  });
});

describe("T3B-0 — i18n vi/en/zh cho mã khoá (sổ lệnh che chi tiết: commandAudit.maLoi.<MÃ>)", () => {
  it("khoá commandAudit.maLoi.OT_MC_TAM_KHOA có ở cả ba ngôn ngữ, khác nhau, nhắc E-STOP cứng", () => {
    const goc = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "client", "src", "i18n", "locales");
    const chu = ["vi", "en", "zh"].map((l) => (JSON.parse(readFileSync(join(goc, `${l}.json`), "utf8")) as any).commandAudit?.maLoi?.OT_MC_TAM_KHOA);
    for (const c of chu) expect(typeof c === "string" && c.length > 20).toBe(true);
    expect(new Set(chu).size).toBe(3);
    expect(chu[1]).toMatch(/E-STOP/);
  });
});
