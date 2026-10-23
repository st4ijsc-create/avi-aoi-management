/**
 * ★★★ BẢO MẬT (2026-10-23, dieu-phoi) — handler `subscribe` KHÔNG kiểm PHẠM VI NHÀ MÁY khi vào phòng.
 *
 * Lỗ: bất kỳ socket NGƯỜI DÙNG nào cũng `join` được `factory:{id}` / `workshop:{id}` / `line:{id}` / `machine:{id}` (cùng `robot:` · `device:` ·
 * `telemetry:all`) bằng id TỰ KHAI — nên người dùng nhà máy B nhận `telemetry:sample` / `machine:*` / `andon:event` của nhà máy A.
 * Chỉ `twin:` có kiểm. Cùng lớp IDOR đã vá ở Luồng AI.
 *
 * ★ ĐO BẰNG socket.io THẬT + CSDL `_test` THẬT: `initializeSocket` thật, handshake thật (chỉ giả `sdk.authenticateRequest` theo cookie),
 *   phạm vi do `trongPhamVi` / `resolveTenantFactoryScope` THẬT đọc `user_factory_assignments`. Hàng riêng tiền tố `skpv` + người dùng riêng
 *   (bài học: dùng chung "người đầu tiên" làm các tệp song song giẫm gán nhà máy của nhau).
 * ★ Mỗi ca âm tính có ĐỐI CHỨNG DƯƠNG cùng ca (socket được phép NHẬN cùng gói) để "không nhận gì" không xanh vì bộ phát hỏng.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { sql } from "drizzle-orm";

const NGUOI = vi.hoisted(() => ({ ds: {} as Record<number, { id: number; role: string; name: string }> }));
vi.mock("./sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(async (req: any) => {
      const m = /phien=(\d+)/.exec(String(req?.headers?.cookie ?? ""));
      return m ? (NGUOI.ds[Number(m[1])] ?? null) : null;
    }),
  },
}));

// Hạ tầng KHÁC: rỗng/tắt (tệp này đo PHẠM VI PHÒNG). KHÔNG mock `../db`, `../db/connection`, `../db/hierarchy`, `../db/reportAggregators`.
vi.mock("./socketRedisAdapter", () => ({ attachRedisAdapter: vi.fn(async () => false) }));
vi.mock("./machinePresenceStore", () => ({
  getMachinePresenceStore: () => ({
    setOnline: vi.fn(async () => undefined),
    setOffline: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    listOnline: vi.fn(async () => []),
    listOnlineCodes: vi.fn(async () => []),
  }),
}));
vi.mock("./eventBus", () => ({
  eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), publish: vi.fn(), subscribe: vi.fn(() => () => {}) },
  EventTypes: {},
}));
vi.mock("../services/ecosystem/ecosystemEvents", () => ({ toEcosystemEvent: () => null, isAlertKind: () => false }));
vi.mock("../services/stateStore/stateStore", () => ({ stateStoreEnabled: () => false }));
vi.mock("../services/stateStore/ingest", () => ({
  stateStoreOnMachineStatus: vi.fn(),
  stateStoreOnMachineSocketDisconnect: vi.fn(),
  trackMachineSocket: vi.fn(),
}));
vi.mock("../services/stateStore/unsStreamGateway", () => ({ registerUnsStreamHandlers: vi.fn() }));
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => []) }));
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

import { getDb } from "../db/connection";
import { phatMangTheoNhaMay, phatTheoNhaMay, thongKePhat, __datLaiPhatTheoNhaMay } from "./socketPhatTheoNhaMay";

const TT = `skpv${Date.now().toString(36)}`;
type SocketMod = typeof import("./socket");
let socketMod: SocketMod;
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];

interface HangNhaMay { fid: number; wid: number; lid: number; sid: number; mid: number; robotId: number; code: string }
let A!: HangNhaMay;
let B!: HangNhaMay;
let uA = 0;
let uB = 0;
let uAdmin = 0;
let uAB = 0;
const idsDon: { users: number[]; robots: number[]; factories: string[] } = { users: [], robots: [], factories: [] };

const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dung(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function seedNhaMay(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, ten: string): Promise<HangNhaMay> {
  const code = `${TT}${ten}`;
  const [f] = await dung(db, sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(db, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(db, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(db, sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(db, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`);
  const [r] = await dung(db, sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId", "stationId") VALUES (${code}, ${code + " r"}, 'sim', 'sim://x', ${l.id}, ${s.id}) RETURNING id`);
  idsDon.robots.push(Number(r.id));
  idsDon.factories.push(code);
  return { fid: Number(f.id), wid: Number(w.id), lid: Number(l.id), sid: Number(s.id), mid: Number(m.id), robotId: Number(r.id), code };
}

async function seedNguoi(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, ten: string, role: string, factoryCode: string | null): Promise<number> {
  const [u] = await dung(
    db,
    sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
        VALUES (${`${TT}-${ten}`}, ${`${TT}_${ten}`}, ${"SKPV " + ten}, 'password', ${role}, true, false, now()) RETURNING id`,
  );
  const id = Number(u.id);
  idsDon.users.push(id);
  if (factoryCode) await dung(db, sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${id}, ${factoryCode})`);
  // QUYỀN xem engineering (machine_monitoring/canView) — để ca engineering tách riêng PHẠM VI khỏi QUYỀN: cả A lẫn B đều CÓ quyền.
  if (role !== "admin") await dung(db, sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${id}, 'machine_monitoring', 'machine_status', true)`);
  NGUOI.ds[id] = { id, role, name: `SKPV ${ten}` };
  return id;
}

function ketNoi(phien: number | null, may = false): Promise<ClientSocket> {
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: may ? { clientType: "machine" } : {},
    extraHeaders: phien != null ? { cookie: `phien=${phien}` } : {},
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once("connect", () => resolve(c));
    c.once("connect_error", (e) => reject(e));
  });
}

function phongCua(c: ClientSocket): string[] {
  const sk = socketMod.getIO()!.sockets.sockets.get(c.id!);
  if (!sk) throw new Error(`không thấy socket server ${c.id}`);
  return [...sk.rooms].filter((r) => r !== c.id).sort();
}

function ghiNhan(c: ClientSocket, evt: string): unknown[] {
  const arr: unknown[] = [];
  c.on(evt, (g: unknown) => arr.push(g));
  return arr;
}

const mau = (machineId: number) => ({ machineId, deviceId: null, protocol: "x", metric: "temp", numValue: 1, textValue: null, boolValue: null, unit: null, quality: "good", ts: new Date().toISOString() });

beforeAll(async () => {
  delete process.env.SOCKET_MACHINE_AUTH_MODE;
  const db = await getDb();
  if (!db) throw new Error("test cần CSDL _test");
  A = await seedNhaMay(db, "a");
  B = await seedNhaMay(db, "b");
  uA = await seedNguoi(db, "ua", "engineer", A.code);
  uB = await seedNguoi(db, "ub", "engineer", B.code);
  uAdmin = await seedNguoi(db, "admin", "admin", null);
  uAB = await seedNguoi(db, "uab", "engineer", A.code);
  await dung(db, sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uAB}, ${B.code})`);
  socketMod = await import("./socket");
  http = createServer();
  socketMod.initializeSocket(http);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  await import("../services/notificationService");
  await cho(50);
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  socketMod?.stopTwinBroadcaster();
  socketMod?.stopOeeBroadcaster();
  socketMod?.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => (socketMod?.getIO() ? socketMod.getIO()!.close(() => r()) : r()));
  const db = await getDb();
  if (db) {
    try {
      if (idsDon.robots.length) await db.execute(sql`DELETE FROM robots WHERE id IN (${sql.join(idsDon.robots.map((i) => sql`${i}`), sql`, `)})`);
      for (const code of idsDon.factories) {
        await db.execute(sql`DELETE FROM machines WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM stations WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM production_lines WHERE code = ${code}`);
        await db.execute(sql`DELETE FROM workshops WHERE code = ${code}`);
      }
      if (idsDon.users.length) {
        const u = sql.join(idsDon.users.map((i) => sql`${i}`), sql`, `);
        await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN (${u})`);
        await db.execute(sql`DELETE FROM permissions WHERE "userId" IN (${u})`);
        await db.execute(sql`DELETE FROM users WHERE id IN (${u})`).catch(() => undefined);
      }
      for (const code of idsDon.factories) await db.execute(sql`DELETE FROM factories WHERE code = ${code}`);
    } catch (e) {
      console.warn("[skpv] dọn dữ liệu:", (e as Error).message);
    }
  }
}, 60_000);

afterEach(() => {
  while (clients.length) clients.pop()!.disconnect();
});

/** Một vòng "B vào phòng của A": trả {phong, nhan} của B và của A (đối chứng) sau khi phát một gói tới phòng ấy. */
async function doRoomCuaA(tenPhong: string, payloadSub: Record<string, unknown>, phatSuKien: () => void, tenSuKien: string) {
  const a = await ketNoi(uA);
  const b = await ketNoi(uB);
  const nhanA = ghiNhan(a, tenSuKien);
  const nhanB = ghiNhan(b, tenSuKien);
  a.emit("subscribe", payloadSub);
  b.emit("subscribe", payloadSub);
  await vi.waitFor(() => expect(phongCua(a)).toContain(tenPhong), { timeout: 5000 });
  await cho(300);
  phatSuKien();
  await vi.waitFor(() => expect(nhanA.length).toBe(1), { timeout: 5000 });
  await cho(150);
  return { phongB: phongCua(b), nhanB, nhanA };
}

describe("★★★ B vào phòng của A — KHÔNG được vào, KHÔNG được nhận", () => {
  it("machine:{máy của A}: B không vào, không nhận telemetry:sample (đối chứng: A nhận)", async () => {
    const r = await doRoomCuaA(`machine:${A.mid}`, { machineId: A.mid }, () => socketMod.emitTelemetrySamples([mau(A.mid)]), "telemetry:sample");
    expect(r.phongB).not.toContain(`machine:${A.mid}`);
    expect(r.nhanB).toEqual([]);
  });

  it("factory:/workshop:/line: của A: B không vào, không nhận (đối chứng: A nhận)", async () => {
    for (const [phong, sub] of [
      [`factory:${A.fid}`, { factoryId: A.fid }],
      [`workshop:${A.wid}`, { workshopId: A.wid }],
      [`line:${A.lid}`, { lineId: A.lid }],
    ] as const) {
      const r = await doRoomCuaA(phong, sub, () => socketMod.getIO()!.to(phong).emit("probe:phong", { phong }), "probe:phong");
      expect(r.phongB, phong).not.toContain(phong);
      expect(r.nhanB, phong).toEqual([]);
      while (clients.length) clients.pop()!.disconnect();
    }
  });

  it("robot:/device: của A: B không vào, không nhận (đối chứng: A nhận)", async () => {
    for (const [phong, sub] of [
      [`robot:${A.robotId}`, { robotId: A.robotId }],
      [`device:machine:${A.mid}`, { deviceStreamId: `machine:${A.mid}` }],
      [`device:robot:${A.robotId}`, { deviceStreamId: `robot:${A.robotId}` }],
    ] as const) {
      const r = await doRoomCuaA(phong, sub, () => socketMod.getIO()!.to(phong).emit("probe:phong", { phong }), "probe:phong");
      expect(r.phongB, phong).not.toContain(phong);
      expect(r.nhanB, phong).toEqual([]);
      while (clients.length) clients.pop()!.disconnect();
    }
  });

  it("telemetry:all (firehose MỌI máy) chỉ cho người toàn quyền: A (phạm vi hẹp) không vào; admin vào", async () => {
    const a = await ketNoi(uA);
    const ad = await ketNoi(uAdmin);
    const nhanA = ghiNhan(a, "telemetry:sample");
    const nhanAd = ghiNhan(ad, "telemetry:sample");
    a.emit("subscribe", { telemetryAll: true });
    ad.emit("subscribe", { telemetryAll: true });
    await vi.waitFor(() => expect(phongCua(ad)).toContain("telemetry:all"), { timeout: 5000 });
    await cho(300);
    socketMod.emitTelemetrySamples([mau(B.mid)]); // máy của B — A không thuộc phạm vi
    await vi.waitFor(() => expect(nhanAd.length).toBe(1), { timeout: 5000 });
    await cho(150);
    expect(phongCua(a)).not.toContain("telemetry:all");
    expect(nhanA).toEqual([]);
  });
});

describe("engineering:subscribe — QUYỀN xem chưa đủ, còn phải TRONG PHẠM VI", () => {
  it("B (có quyền machine_monitoring) vào engineering:{máy của A} ⇒ KHÔNG vào, KHÔNG nhận giá trị PLC; A (cùng quyền, đúng nhà máy) NHẬN", async () => {
    const a = await ketNoi(uA);
    const b = await ketNoi(uB);
    const nhanA = ghiNhan(a, "engineering:samples");
    const nhanB = ghiNhan(b, "engineering:samples");
    a.emit("engineering:subscribe", { machineId: A.mid });
    b.emit("engineering:subscribe", { machineId: A.mid });
    await vi.waitFor(() => expect(phongCua(a)).toContain(`engineering:${A.mid}`), { timeout: 5000 });
    await cho(300);
    socketMod.emitEngineeringSamples(A.mid, [{ symbol: "D100", value: 1, ts: Date.now() }]);
    await vi.waitFor(() => expect(nhanA.length).toBe(1), { timeout: 5000 });
    await cho(150);
    expect(phongCua(b)).not.toContain(`engineering:${A.mid}`);
    expect(nhanB).toEqual([]);
  });
});

describe("đối chiếu DƯƠNG — người dùng hợp lệ KHÔNG bị vỡ", () => {
  it("B vào ĐÚNG phòng của B (factory/workshop/line/machine/robot/device) và nhận gói; admin vào phòng của cả A lẫn B", async () => {
    const b = await ketNoi(uB);
    const ad = await ketNoi(uAdmin);
    const nhanB = ghiNhan(b, "probe:phong");
    const nhanAd = ghiNhan(ad, "probe:phong");
    const dsB = [`factory:${B.fid}`, `workshop:${B.wid}`, `line:${B.lid}`, `machine:${B.mid}`, `robot:${B.robotId}`, `device:machine:${B.mid}`];
    b.emit("subscribe", { factoryId: B.fid, workshopId: B.wid, lineId: B.lid, machineId: B.mid, robotId: B.robotId, deviceStreamId: `machine:${B.mid}` });
    ad.emit("subscribe", { factoryId: A.fid, machineId: B.mid });
    await vi.waitFor(() => {
      for (const p of dsB) expect(phongCua(b)).toContain(p);
      expect(phongCua(ad)).toEqual(expect.arrayContaining([`factory:${A.fid}`, `machine:${B.mid}`]));
    }, { timeout: 5000 });
    for (const p of dsB) socketMod.getIO()!.to(p).emit("probe:phong", { p });
    socketMod.getIO()!.to(`factory:${A.fid}`).emit("probe:phong", { p: "A" });
    await vi.waitFor(() => expect(nhanB.length).toBe(dsB.length), { timeout: 5000 });
    expect(nhanAd.length).toBeGreaterThanOrEqual(2);
  });

  it("`subscribe {}` (các trang chỉ cần phòng chung) vẫn vào `global` như cũ", async () => {
    const b = await ketNoi(uB);
    b.emit("subscribe", {});
    await vi.waitFor(() => expect(phongCua(b)).toContain("global"), { timeout: 5000 });
  });
});

describe("không lộ tồn tại + chạy đua + socket máy", () => {
  it("phòng NGOÀI phạm vi và phòng KHÔNG TỒN TẠI cho CÙNG một phản hồi chung (không lặp id, không phân biệt)", async () => {
    const b = await ketNoi(uB);
    const loi: any[] = [];
    b.on("subscribe:error", (g) => loi.push(g));
    b.emit("subscribe", { machineId: A.mid });
    await vi.waitFor(() => expect(loi.length).toBe(1), { timeout: 5000 });
    b.emit("subscribe", { machineId: 2147000000 });
    await vi.waitFor(() => expect(loi.length).toBe(2), { timeout: 5000 });
    expect(loi[0]).toEqual(loi[1]);
    expect(JSON.stringify(loi[0])).not.toContain(String(A.mid));
    expect(loi[0]).toMatchObject({ code: "SUBSCRIBE_DENIED" });
  });

  it("subscribe rồi unsubscribe NGAY (kiểm quyền còn dở) ⇒ KHÔNG vào phòng", async () => {
    const a = await ketNoi(uA);
    a.emit("subscribe", { machineId: A.mid });
    a.emit("unsubscribe", { machineId: A.mid });
    await cho(600);
    expect(phongCua(a)).not.toContain(`machine:${A.mid}`);
  });

  it("socket MÁY (không cookie) subscribe ⇒ vẫn không vào phòng nào (hành vi PLT-01 giữ nguyên)", async () => {
    const may = await ketNoi(null, true);
    may.emit("subscribe", { machineId: A.mid, factoryId: A.fid, telemetryAll: true });
    await cho(400);
    expect(phongCua(may)).toEqual([]);
  });

  it("người dùng KHÔNG gán nhà máy nào: không vào phòng máy/nhà máy nào (fail-closed)", async () => {
    const db = await getDb();
    const id = await seedNguoi(db!, "khong", "engineer", null);
    const k = await ketNoi(id);
    k.emit("subscribe", { machineId: A.mid, factoryId: B.fid, lineId: B.lid });
    await cho(500);
    const p = phongCua(k);
    expect(p.filter((x) => /^(machine|factory|line|workshop):/.test(x))).toEqual([]);
  });
});

describe("★★★ P-S1b — sự kiện máy phát theo PHÒNG NHÀ MÁY (không `global`)", () => {
  /**
   * Một sự kiện của máy/chuyền/trạm thuộc nhà máy A: người A (cùng người A+B và admin) NHẬN đúng MỘT bản; người B, người KHÔNG gán nhà máy, và socket
   * MÁY không nhận gì. Mọi socket người dùng chỉ `connect` — KHÔNG gửi `subscribe` (tự vào phòng theo phạm vi ngay khi nối, nên trang nào đang nghe cũng nhận).
   */
  async function doSuKien(ten: string, phat: () => void): Promise<void> {
    const db = await getDb();
    const uKhong = await seedNguoi(db!, `kh${Math.random().toString(36).slice(2, 7)}`, "engineer", null);
    const [a, b, ab, ad, kh] = await Promise.all([ketNoi(uA), ketNoi(uB), ketNoi(uAB), ketNoi(uAdmin), ketNoi(uKhong)]);
    const may = await ketNoi(null, true);
    const nhan = [a, b, ab, ad, kh, may].map((c) => ghiNhan(c, ten));
    await vi.waitFor(() => {
      expect(phongCua(a)).toContain(`factory:${A.fid}`);
      expect(phongCua(b)).toContain(`factory:${B.fid}`);
      expect(phongCua(ab)).toEqual(expect.arrayContaining([`factory:${A.fid}`, `factory:${B.fid}`]));
      expect(phongCua(ad)).toContain("scope:all");
    }, { timeout: 5000 });
    phat();
    await vi.waitFor(() => {
      expect(nhan[0].length, "A").toBe(1);
      expect(nhan[2].length, "A+B").toBe(1);
      expect(nhan[3].length, "admin").toBe(1);
    }, { timeout: 5000 });
    await cho(300);
    expect(nhan[0].length, "A đúng một bản").toBe(1);
    expect(nhan[1], "B (nhà máy khác)").toEqual([]);
    expect(nhan[4], "người KHÔNG gán nhà máy").toEqual([]);
    expect(nhan[5], "socket MÁY").toEqual([]);
    while (clients.length) clients.pop()!.disconnect();
  }

  const mon = Date.now();
  const io = () => socketMod.getIO()!;

  it("inspection:alert (machineId + machineCode)", () => doSuKien("inspection:alert", () => socketMod.emitInspectionAlert({ type: "NG_ALERT", machineId: A.mid, machineName: "m", machineCode: A.code, timestamp: new Date(), message: "m" } as never)));
  it("dashboard:update (machineId)", () => doSuKien("dashboard:update", () => socketMod.emitDashboardUpdate({ machineId: A.mid } as never)));
  it("andon:event chỉ có machineId", () => doSuKien("andon:event", () => socketMod.emitAndonEvent({ id: 1, state: "red", reason: "x", status: "raised", title: "t", machineId: A.mid, raisedBySystem: false, raisedAt: new Date() } as never)));
  it("andon:event chỉ có stationId ⇒ tra ngược lên nhà máy qua trạm → chuyền → xưởng", () => doSuKien("andon:event", () => socketMod.emitAndonEvent({ id: 2, state: "red", reason: "x", status: "raised", title: "t", stationId: A.sid, raisedBySystem: false, raisedAt: new Date() } as never)));
  it("andon:event chỉ có lineId", () => doSuKien("andon:event", () => socketMod.emitAndonEvent({ id: 3, state: "red", reason: "x", status: "raised", title: "t", lineId: A.lid, raisedBySystem: false, raisedAt: new Date() } as never)));
  it("safety:event (lineId)", () => doSuKien("safety:event", () => socketMod.emitSafetyEvent({ id: 4, eventType: "estop", lineId: A.lid, outcome: "x", isNearMiss: false, createdAt: new Date() } as never)));
  it("safety:event chỉ có robotId ⇒ tra qua chuyền/trạm của robot", () => doSuKien("safety:event", () => socketMod.emitSafetyEvent({ id: 5, eventType: "estop", robotId: A.robotId, outcome: "x", isNearMiss: false, createdAt: new Date() } as never)));
  it("spc:violation (machineId)", () => doSuKien("spc:violation", () => socketMod.emitSpcViolationAlert({ machineId: A.mid, machineCode: A.code, severity: "warning", ruleName: "r", metric: "m", pointIndices: [], violationCount: 1, detectedAt: new Date(), message: "m" } as never)));
  it("alert:escalation (machineId)", () => doSuKien("alert:escalation", () => socketMod.emitAlertEscalation({ alertId: 1, alertTitle: "t", fromLevel: 1, toLevel: 2, severity: "high", reason: "r", machineId: A.mid, escalatedAt: new Date() } as never)));
  it("mqtt:message chỉ có mã máy ⇒ tra theo machines.code", () => doSuKien("mqtt:message", () => socketMod.emitMqttMessage({ topic: "t", payload: "{}", machineCode: A.code, timestamp: new Date() } as never)));
  it("machine:model_available (machineId)", () => doSuKien("machine:model_available", () => socketMod.emitMachineModelAvailable({ machineId: A.mid, deviceId: "d", deploymentId: 1 })));
  it("machine:status_change / status_update (mã máy · id máy) qua bộ phát", async () => {
    await doSuKien("machine:status_change", () => phatTheoNhaMay(io(), "machine:status_change", { machineCode: A.code, status: "online" }, { machineId: A.mid, machineCode: A.code }));
    await doSuKien("machine:status_update", () => phatTheoNhaMay(io(), "machine:status_update", { machineId: A.mid, status: "running" }, { machineId: A.mid }));
  });

  it("oee:update (mảng mọi máy): A chỉ thấy máy của A, B chỉ thấy máy của B, admin thấy cả hai", async () => {
    const [a, b, ad] = await Promise.all([ketNoi(uA), ketNoi(uB), ketNoi(uAdmin)]);
    const lay = (c: ClientSocket) => {
      const g: any[] = [];
      c.on("oee:update", (x) => g.push(x));
      return g;
    };
    const [nhanA, nhanB, nhanAd] = [lay(a), lay(b), lay(ad)];
    await vi.waitFor(() => {
      expect(phongCua(a)).toContain(`factory:${A.fid}`);
      expect(phongCua(ad)).toContain("scope:all");
    }, { timeout: 5000 });
    phatMangTheoNhaMay(io(), "oee:update", [{ machineId: A.mid, v: "a" }, { machineId: B.mid, v: "b" }], (m) => ({ machineId: m.machineId }), (sub) => ({ metrics: sub, at: "t" }));
    await vi.waitFor(() => {
      expect(nhanA.length).toBe(1);
      expect(nhanB.length).toBe(1);
      expect(nhanAd.length).toBe(1);
    }, { timeout: 5000 });
    expect(nhanA[0].metrics.map((m: any) => m.v)).toEqual(["a"]);
    expect(nhanB[0].metrics.map((m: any) => m.v)).toEqual(["b"]);
    expect(nhanAd[0].metrics.map((m: any) => m.v).sort()).toEqual(["a", "b"]);
  });

  it("sự kiện TRA KHÔNG RA nhà máy ⇒ KHÔNG ai ngoài toàn quyền nhận; được ĐẾM + cảnh báo (không phát vào global)", async () => {
    __datLaiPhatTheoNhaMay();
    const [a, b, ad] = await Promise.all([ketNoi(uA), ketNoi(uB), ketNoi(uAdmin)]);
    const nhan = [a, b, ad].map((c) => ghiNhan(c, "andon:event"));
    await vi.waitFor(() => expect(phongCua(ad)).toContain("scope:all"), { timeout: 5000 });
    await vi.waitFor(() => expect(phongCua(a)).toContain(`factory:${A.fid}`), { timeout: 5000 });
    const truoc = thongKePhat().theoSuKien["andon:event"] ?? 0;
    socketMod.emitAndonEvent({ id: 9, state: "red", reason: "x", status: "raised", title: "t", machineId: 2_147_000_000, raisedBySystem: false, raisedAt: new Date() } as never);
    await vi.waitFor(() => expect(nhan[2].length).toBe(1), { timeout: 5000 });
    await vi.waitFor(() => expect(thongKePhat().theoSuKien["andon:event"] ?? 0).toBe(truoc + 1), { timeout: 5000 });
    await cho(300);
    expect(nhan[0]).toEqual([]);
    expect(nhan[1]).toEqual([]);
  });

  it("đúng một bản: người A+B (ở cả hai phòng nhà máy) nhận ĐÚNG MỘT bản dù sự kiện thuộc A và có phòng máy/chuyền (hợp phòng + loại trừ)", async () => {
    const ab = await ketNoi(uAB);
    const nhan = ghiNhan(ab, "andon:event");
    ab.emit("subscribe", { machineId: A.mid, lineId: A.lid, factoryId: A.fid });
    await vi.waitFor(() => expect(phongCua(ab)).toEqual(expect.arrayContaining([`machine:${A.mid}`, `line:${A.lid}`, `factory:${A.fid}`])), { timeout: 5000 });
    socketMod.emitAndonEvent({ id: 10, state: "red", reason: "x", status: "raised", title: "t", machineId: A.mid, lineId: A.lid, raisedBySystem: false, raisedAt: new Date() } as never);
    await vi.waitFor(() => expect(nhan.length).toBeGreaterThanOrEqual(1), { timeout: 5000 });
    await cho(400);
    expect(nhan.length).toBe(1);
  });

  void mon;
});
