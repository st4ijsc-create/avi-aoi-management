/**
 * SCADA R0 Task 8 - `scada:subscribe` qua socket.io THAT + CSDL `_test` THAT: nguoi dung nha may A chi nhan gia tri tag cua nha may A,
 * KHONG nhan tag nha may B (snapshot lan delta). Pham vi do `trongPhamVi` / `idsTrongPhamVi` THAT doc `user_factory_assignments`;
 * quyen do `checkPermission` THAT doc `permissions`. Khuon `server/_core/socketPhamViPhong.db.test.ts`.
 * Bo dem nuoi bang `datThongTinAdapter` + `napTuOt` (Task 7). Moi ca am tinh co DOI CHUNG DUONG cung ca.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { sql } from "drizzle-orm";

const NGUOI = vi.hoisted(() => ({ ds: {} as Record<number, { id: number; role: string; name: string }> }));
vi.mock("../../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      return m ? (NGUOI.ds[Number(m[1])] ?? null) : null;
    }),
  },
}));

// Ha tang KHAC: rong/tat (tep nay do KENH SCADA). KHONG mock `db`, `db/connection`, `db/hierarchy`, `_core/accessControl`.
vi.mock("../../_core/socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("../../_core/machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({
    setOnline: vi.fn(async () => undefined),
    setOffline: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    listOnline: vi.fn(async () => []),
    listOnlineCodes: vi.fn(async () => []),
  }),
}));
vi.mock("../../_core/eventBus", () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), publish: vi.fn(), subscribe: vi.fn(() => () => {}) },
  EventTypes: {},
}));
vi.mock("../ecosystem/ecosystemEvents", () => ({ toEcosystemEvent: () => null, isAlertKind: () => false }));
vi.mock("../stateStore/stateStore", () => ({ stateStoreEnabled: () => false }));
vi.mock("../stateStore/ingest", () => ({
  stateStoreOnMachineStatus: vi.fn(),
  stateStoreOnMachineSocketDisconnect: vi.fn(),
  trackMachineSocket: vi.fn(),
}));
vi.mock("../stateStore/unsStreamGateway", () => ({ registerUnsStreamHandlers: vi.fn() }));
vi.mock("../../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => []) }));
vi.mock("../../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
vi.mock("../oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));
vi.mock("../../db/otTelemetry", () => ({ layMoiNhatTheoThietBi: vi.fn(async () => []) }));

import { getDb } from "../../db/connection";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { __datLaiBoDemHienTai, datThongTinAdapter, napTuOt } from "./boDemHienTai";
import { __datLaiScadaSocket, __vongDangChay } from "./scadaSocket";

const TT = `sksc${Date.now().toString(36)}`;
type SocketMod = typeof import("../../_core/socket");
let socketMod: SocketMod;
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];

interface HangNhaMay { fid: number; mid: number; code: string }
let A!: HangNhaMay;
let B!: HangNhaMay;
let uA = 0;
let uB = 0;
let uAdmin = 0;
let uAB = 0;
let uKhongQuyen = 0;
let adapterDbB = 0; // adapter CO trong DB (gan may B) nhung KHONG do trung tam quan
const ADAPTER_A = 910_001; // do trung tam quan, may A
const ADAPTER_B = 910_002; // do trung tam quan, may B
const idsDon: { factories: string[]; adapters: number[] } = { factories: [], adapters: [] };

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
async function dung(db: Db, q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function seedNhaMay(db: Db, ten: string): Promise<HangNhaMay> {
  const code = `${TT}${ten}`;
  const [f] = await dung(db, sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(db, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(db, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(db, sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(db, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  idsDon.factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), code };
}

/** Nguoi dung qua `taoNguoiDungTest` + gan nha may (ma) + quyen xem (machine_monitoring/canView) tru khi `khongQuyen`. */
async function seedNguoi(db: Db, ten: string, role: "engineer" | "admin", factoryCodes: string[], khongQuyen = false): Promise<number> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "sksc", ts: TT, ten: `SKSC ${ten}` });
  for (const code of factoryCodes) await dung(db, sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin" && !khongQuyen) {
    await dung(db, sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u.id}, 'machine_monitoring', 'machine_status', true)`);
  }
  NGUOI.ds[u.id] = { id: u.id, role, name: `SKSC ${ten}` };
  return u.id;
}

function ketNoi(phien: number): Promise<ClientSocket> {
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: {},
    extraHeaders: { cookie: `phien=${phien}` },
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once("connect", () => resolve(c));
    c.once("connect_error", (e) => reject(e));
  });
}

function ghiNhan(c: ClientSocket, evt: string): any[] {
  const arr: any[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}

const mau = (tagKey: string, value: number) => ({ tagKey, raw: value, value, quality: "good" as const, timestamp: new Date() });

beforeAll(async () => {
  vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  delete process.env.SOCKET_MACHINE_AUTH_MODE;
  const db = await getDb();
  if (!db) throw new Error("test can CSDL _test");
  A = await seedNhaMay(db, "a");
  B = await seedNhaMay(db, "b");
  uA = await seedNguoi(db, "ua", "engineer", [A.code]);
  uB = await seedNguoi(db, "ub", "engineer", [B.code]);
  uAdmin = await seedNguoi(db, "admin", "admin", []);
  uAB = await seedNguoi(db, "uab", "engineer", [A.code, B.code]);
  uKhongQuyen = await seedNguoi(db, "kq", "engineer", [A.code], true);
  const [ad] = await dung(
    db,
    sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled") VALUES (${B.mid}, ${TT + "adb"}, ${TT + " adb"}, 'stub', 'stub://x', false) RETURNING id`,
  );
  adapterDbB = Number(ad.id);
  idsDon.adapters.push(adapterDbB);
  __datLaiBoDemHienTai();
  datThongTinAdapter(ADAPTER_A, { pollMs: 1000, coDeadband: false, machineId: A.mid, code: `${TT}-pa` });
  datThongTinAdapter(ADAPTER_B, { pollMs: 1000, coDeadband: false, machineId: B.mid, code: `${TT}-pb` });
  socketMod = await import("../../_core/socket");
  http = createServer();
  socketMod.initializeSocket(http);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  await import("../notificationService");
  await cho(50);
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  __datLaiScadaSocket();
  __datLaiBoDemHienTai();
  vi.unstubAllEnvs();
  socketMod?.stopTwinBroadcaster();
  socketMod?.stopOeeBroadcaster();
  socketMod?.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => (socketMod?.getIO() ? socketMod.getIO()!.close(() => r()) : r()));
  const db = await getDb();
  if (db) {
    try {
      for (const id of idsDon.adapters) await db.execute(sql`DELETE FROM device_adapters WHERE id = ${id}`);
      for (const code of idsDon.factories) {
        await db.execute(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
        await db.execute(sql`DELETE FROM machines WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM stations WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM production_lines WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM workshops WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM factories WHERE code = ${code}`);
      }
    } catch (e) {
      console.warn("[sksc] don du lieu:", (e as Error).message);
    }
  }
}, 60_000);

afterEach(() => {
  while (clients.length) clients.pop()!.disconnect();
});

const TAG_A = { adapterId: ADAPTER_A, tagKey: "nhietDo" };
const TAG_B = { adapterId: ADAPTER_B, tagKey: "nhietDo" };

describe("scada:subscribe qua socket.io that - chi nhan tag trong pham vi nha may", () => {
  it("A dang ky tag cua A va B: snapshot CHI co gia tri A, B vao denied; delta CHI mang tag A (doi chung: B nhan tag B)", async () => {
    napTuOt({ adapterId: ADAPTER_A, machineId: A.mid }, [mau("nhietDo", 111)]);
    napTuOt({ adapterId: ADAPTER_B, machineId: B.mid }, [mau("nhietDo", 222)]);
    const a = await ketNoi(uA);
    const b = await ketNoi(uB);
    const snA = ghiNhan(a, "scada:snapshot");
    const snB = ghiNhan(b, "scada:snapshot");
    const dA = ghiNhan(a, "scada:delta");
    const dB = ghiNhan(b, "scada:delta");
    const loiA = ghiNhan(a, "scada:error");
    a.emit("scada:subscribe", { subId: "s", tags: [TAG_A, TAG_B] });
    b.emit("scada:subscribe", { subId: "s", tags: [TAG_A, TAG_B] });
    await vi.waitFor(() => {
      expect(snA.length).toBe(1);
      expect(snB.length).toBe(1);
    }, { timeout: 5000 });
    expect(loiA).toEqual([]);
    // A: chi gia tri A
    expect(snA[0].values.map((v: any[]) => [v[0], v[1], v[2]])).toEqual([[ADAPTER_A, "nhietDo", 111]]);
    expect(snA[0].denied).toEqual([TAG_B]);
    expect(JSON.stringify(snA[0])).not.toContain("222");
    // B (doi xung): chi gia tri B
    expect(snB[0].values.map((v: any[]) => [v[0], v[1], v[2]])).toEqual([[ADAPTER_B, "nhietDo", 222]]);
    expect(snB[0].denied).toEqual([TAG_A]);
    expect(JSON.stringify(snB[0])).not.toContain("111");

    napTuOt({ adapterId: ADAPTER_A, machineId: A.mid }, [mau("nhietDo", 333)]);
    napTuOt({ adapterId: ADAPTER_B, machineId: B.mid }, [mau("nhietDo", 444)]);
    await vi.waitFor(() => {
      expect(dA.length).toBe(1);
      expect(dB.length).toBe(1);
    }, { timeout: 5000 });
    await cho(600);
    expect(dA.length).toBe(1);
    expect(dB.length).toBe(1);
    expect(dA[0].values.map((v: any[]) => [v[0], v[2]])).toEqual([[ADAPTER_A, 333]]);
    expect(dB[0].values.map((v: any[]) => [v[0], v[2]])).toEqual([[ADAPTER_B, 444]]);
    expect(JSON.stringify(dA)).not.toContain("444");
    expect(JSON.stringify(dB)).not.toContain("333");
  });

  it("nguoi duoc gan ca hai nha may nhan ca hai; admin (toan quyen) nhan ca hai", async () => {
    napTuOt({ adapterId: ADAPTER_A, machineId: A.mid }, [mau("nhietDo", 5)]);
    napTuOt({ adapterId: ADAPTER_B, machineId: B.mid }, [mau("nhietDo", 6)]);
    const ab = await ketNoi(uAB);
    const ad = await ketNoi(uAdmin);
    const snAB = ghiNhan(ab, "scada:snapshot");
    const snAd = ghiNhan(ad, "scada:snapshot");
    ab.emit("scada:subscribe", { subId: "s", tags: [TAG_A, TAG_B] });
    ad.emit("scada:subscribe", { subId: "s", tags: [TAG_A, TAG_B] });
    await vi.waitFor(() => {
      expect(snAB.length).toBe(1);
      expect(snAd.length).toBe(1);
    }, { timeout: 5000 });
    for (const sn of [snAB[0], snAd[0]]) {
      expect(sn.denied).toEqual([]);
      expect(sn.values.map((v: any[]) => v[2]).sort()).toEqual([5, 6]);
    }
  });

  it("co phamvi nhung KHONG co quyen machine_monitoring/canView => tat ca denied", async () => {
    napTuOt({ adapterId: ADAPTER_A, machineId: A.mid }, [mau("nhietDo", 7)]);
    const kq = await ketNoi(uKhongQuyen);
    const sn = ghiNhan(kq, "scada:snapshot");
    kq.emit("scada:subscribe", { subId: "s", tags: [TAG_A] });
    await vi.waitFor(() => expect(sn.length).toBe(1), { timeout: 5000 });
    expect(sn[0]).toEqual({ subId: "s", values: [], denied: [TAG_A] });
  });

  it("adapter co trong DB nhung khong do trung tam quan: nguoi B xet theo machineId DB (v:null bad stale); A bi denied; adapter khong ton tai denied", async () => {
    const a = await ketNoi(uA);
    const b = await ketNoi(uB);
    const snA = ghiNhan(a, "scada:snapshot");
    const snB = ghiNhan(b, "scada:snapshot");
    const tagDb = { adapterId: adapterDbB, tagKey: "x" };
    const khongCo = { adapterId: 999_999_999, tagKey: "x" };
    a.emit("scada:subscribe", { subId: "s", tags: [tagDb, khongCo] });
    b.emit("scada:subscribe", { subId: "s", tags: [tagDb, khongCo] });
    await vi.waitFor(() => {
      expect(snA.length).toBe(1);
      expect(snB.length).toBe(1);
    }, { timeout: 5000 });
    expect(snA[0]).toEqual({ subId: "s", values: [], denied: [tagDb, khongCo] });
    expect(snB[0].denied).toEqual([khongCo]);
    expect(snB[0].values).toEqual([[adapterDbB, "x", null, "bad", 0, -1, true, "stale"]]);
  });

  it("socket ngat => vong day dung; huy dang ky cuoi => vong dung", async () => {
    const a = await ketNoi(uA);
    const sn = ghiNhan(a, "scada:snapshot");
    a.emit("scada:subscribe", { subId: "s", tags: [TAG_A] });
    await vi.waitFor(() => expect(sn.length).toBe(1), { timeout: 5000 });
    expect(__vongDangChay()).toBe(true);
    a.emit("scada:unsubscribe", { subId: "s" });
    await vi.waitFor(() => expect(__vongDangChay()).toBe(false), { timeout: 5000 });
    a.emit("scada:subscribe", { subId: "t", tags: [TAG_A] });
    await vi.waitFor(() => expect(__vongDangChay()).toBe(true), { timeout: 5000 });
    a.disconnect();
    await vi.waitFor(() => expect(__vongDangChay()).toBe(false), { timeout: 5000 });
  });

  it("co tat => scada:error DISABLED qua duong dang ky THAT cua socket.ts (khong im lang), khong snapshot, khong vong", async () => {
    vi.stubEnv("SCADA_SOCKET_ENABLED", "false");
    try {
      const a = await ketNoi(uA);
      const loi = ghiNhan(a, "scada:error");
      const sn = ghiNhan(a, "scada:snapshot");
      a.emit("scada:subscribe", { subId: "s", tags: [TAG_A] });
      await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 5000 });
      await cho(200);
      expect(loi).toEqual([{ code: "DISABLED" }]);
      expect(sn).toEqual([]);
      expect(__vongDangChay()).toBe(false);
      // bat lai nong (cung ket noi): handler doc co luc subscribe
      vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
      a.emit("scada:subscribe", { subId: "s", tags: [TAG_A] });
      await vi.waitFor(() => expect(sn.length).toBe(1), { timeout: 5000 });
    } finally {
      vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
    }
  });

  it("co bo dem tat (SCADA_LIVE_CACHE_ENABLED=false) => DISABLED", async () => {
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
    try {
      const a = await ketNoi(uA);
      const loi = ghiNhan(a, "scada:error");
      a.emit("scada:subscribe", { subId: "s", tags: [TAG_A] });
      await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 5000 });
      expect(loi).toEqual([{ code: "DISABLED" }]);
    } finally {
      vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    }
  });

  it("quá 500 tag => scada:error TOO_MANY_TAGS, khong snapshot", async () => {
    const a = await ketNoi(uA);
    const sn = ghiNhan(a, "scada:snapshot");
    const loi = ghiNhan(a, "scada:error");
    a.emit("scada:subscribe", { subId: "s", tags: Array.from({ length: 501 }, (_, i) => ({ adapterId: ADAPTER_A, tagKey: `t${i}` })) });
    await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 5000 });
    await cho(200);
    expect(loi).toEqual([{ code: "TOO_MANY_TAGS" }]);
    expect(sn).toEqual([]);
  });
});
