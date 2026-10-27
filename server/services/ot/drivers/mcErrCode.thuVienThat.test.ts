/**
 * R1b-2b-1 T4 (muc 58) - THAM DO thu vien THAT `mcprotocol` 0.1.2 voi may chu TCP gia trong tien trinh (khung 1E nhi phan).
 * Chung minh hinh dang ma `phanLoaiLoiDocMc` dua vao: readPacketArray[*].itemList[*] mang valid/errCode.
 *   (a) PLC im  => errCode === MC_ERRCODE_QUA_HAN_GOI
 *   (b) PLC tra end code loi (0x81 0x5B ...) => errCode bat dau "MC Error Response"
 */
import net from "node:net";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { MC_ERRCODE_QUA_HAN_GOI, phanLoaiLoiDocMc } from "./mitsubishiMcDriver";

const require_ = createRequire(import.meta.url);

type Item = { valid?: boolean; errCode?: string };
type Conn = {
  globalTimeout: number;
  isoConnectionState: number;
  readPacketArray: Array<{ itemList: Item[] }>;
  initiateConnection(p: unknown, cb: (e?: unknown) => void): void;
  setTranslationCB(f: (t: string) => string | undefined): void;
  addItems(k: string[]): void;
  readAllItems(cb: (bad: boolean, v: Record<string, unknown>) => void): void;
  dropConnection(): void;
};

const don: Array<() => void> = [];
afterEach(() => {
  while (don.length) don.pop()!();
});

async function dung(traLoi: ((s: net.Socket) => void) | null) {
  const socks: net.Socket[] = [];
  const srv = net.createServer((s) => {
    socks.push(s);
    s.on("error", () => {});
    if (traLoi) s.on("data", () => traLoi(s));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  don.push(() => {
    for (const s of socks) s.destroy();
    srv.close();
  });
  return (srv.address() as net.AddressInfo).port;
}

async function doc(port: number) {
  const MC = require_("mcprotocol");
  const conn: Conn = new MC();
  conn.globalTimeout = 300;
  don.push(() => conn.dropConnection());
  await new Promise<void>((res, rej) => conn.initiateConnection({ port, host: "127.0.0.1", ascii: false, frame: "1E" }, (e) => (e ? rej(e) : res())));
  conn.setTranslationCB((t) => (t === "a" ? "D100" : t === "b" ? "M100" : undefined));
  conn.addItems(["a", "b"]);
  const t0 = performance.now();
  const kq = await new Promise<{ bad: boolean; v: Record<string, unknown> }>((res) => conn.readAllItems((bad, v) => res({ bad, v })));
  return { conn, kq, ms: performance.now() - t0 };
}

describe("T4 thuong do mcprotocol 0.1.2 that (1E nhi phan)", () => {
  it("(a) PLC im: moi item valid=false va errCode = MC_ERRCODE_QUA_HAN_GOI sau globalTimeout; lib giu state 4", async () => {
    const port = await dung(null);
    const { conn, kq, ms } = await doc(port);
    const items = conn.readPacketArray.flatMap((p) => p.itemList);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.valid).toBe(false);
      expect(it.errCode).toBe(MC_ERRCODE_QUA_HAN_GOI);
    }
    expect(kq.bad).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(conn.isoConnectionState).toBe(4);
    expect(phanLoaiLoiDocMc(conn)).toBe("qua_han_goi");
  });

  it("(b) PLC tra end code loi 0x81 0x5B: errCode bat dau 'MC Error Response', tra loi NHANH", async () => {
    const port = await dung((s) => s.write(Buffer.from([0x81, 0x5b, 0x00, 0x00])));
    const { conn, kq, ms } = await doc(port);
    const items = conn.readPacketArray.flatMap((p) => p.itemList);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.valid).toBe(false);
      expect(String(it.errCode)).toMatch(/^MC Error Response/);
    }
    expect(kq.bad).toBe(true);
    expect(ms).toBeLessThan(250);
    expect(phanLoaiLoiDocMc(conn)).toBe("plc_tra_loi_loi");
  });
});
