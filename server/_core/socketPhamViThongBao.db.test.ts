/**
 * socketPhamViThongBao.db.test.ts — ★★★ F5 đầy đủ, ĐẦU-CUỐI THẬT: COMMIT một hàng ⇒ trigger 0435 ⇒ NOTIFY `socket_pham_vi` ⇒ bộ nhận
 * (LISTEN THẬT trên `_test`, `batDauNgheSocketPhamVi`) ⇒ socket trình duyệt THẬT bị ngắt.
 *
 * ⚠⚠ TỆP NÀY COMMIT HÀNG — MIỄN TRỪ CÓ HẠN (2026-11-03, phiên điều phối, phán quyết (a)): `server/testing/nguoiDungTest.census.test.ts`
 *    `MIEN_COMMIT_NOTIFY` cho ĐÚNG tệp này — "NOTIFY chỉ giao lúc COMMIT, ROLLBACK không thể kiểm". Bằng chứng: tài liệu Postgres (NOTIFY) +
 *    ca hoàn tác `ROLLBACK_KHONG_GIAO_THONG_BAO` trong `socketPhamVi0435.db.test.ts`. Điều kiện (census kiểm): tiền tố `skpvtb`, vai ứng dụng,
 *    không id tường minh, dọn bằng UPDATE về trơ, KHÔNG DELETE / TRUNCATE.
 *   • vai ỨNG DỤNG (`getDb()`), KHÔNG owner `aoi`; tiền tố riêng `skpvtb<thời gian base36>` cho mọi hàng; KHÔNG id tường minh;
 *   • hàng commit: 2 `users`, 3 `user_sessions`, 1 `user_factory_assignments` (mã nhà máy treo `<tiền tố>-F`, không có nhà máy nào khớp);
 *   • DỌN BẰNG UPDATE VỀ TRẠNG THÁI TRƠ — KHÔNG BAO GIỜ DELETE / TRUNCATE: users `isActive=false, role='user'`; phiên `isActive=false` + hết hạn;
 *     phân công `factoryCode = '<tiền tố>-tro'`. (Các UPDATE dọn cũng bắn NOTIFY — vô hại: mọi socket đã đóng.)
 *   • cần 0435 đã áp lên `_test` (`node scripts/apply-migration-0435.mjs --test-only`).
 * Chỉ giả `sdk.authenticateRequest` (cookie `phien=<id>` → hàng người dùng vừa đọc từ DB) như socketPhamViPhong.db.test.ts; khoá phiên đọc
 * THẬT qua `db.getSessionByToken` (vé cookie `app_session_id`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
vi.mock("../services/ecosystem/ecosystemEvents", () => ({ toEcosystemEvent: () => null, isAlertKind: () => false, publishAnomalyDetected: vi.fn() }));
vi.mock("../services/stateStore/stateStore", () => ({ stateStoreEnabled: () => false }));
vi.mock("../services/stateStore/ingest", () => ({ stateStoreOnMachineStatus: vi.fn(), stateStoreOnMachineSocketDisconnect: vi.fn(), trackMachineSocket: vi.fn() }));
vi.mock("../services/stateStore/unsStreamGateway", () => ({ registerUnsStreamHandlers: vi.fn() }));
vi.mock("../db/twin", () => ({ getWipByStation: vi.fn(async () => []), traBanDoTramNhaMay: vi.fn(async () => []) }));
vi.mock("../db/twinCanh", () => ({ traTrangThaiHangLoat: vi.fn(async () => []) }));
vi.mock("../services/oeeService", () => ({ getAllMachinesOEELive: vi.fn(async () => []) }));

import { getDb } from "../db/connection";

const TT = `skpvtb${Date.now().toString(36)}`;
type SocketMod = typeof import("./socket");
let socketMod: SocketMod;
let xl: typeof import("./socketXetLaiQuyen");
let kenh: { stop(): Promise<void> } | null = null;
let http: HttpServer;
let url: string;
const clients: ClientSocket[] = [];
const don = { users: [] as number[], sessions: [] as number[], ufa: [] as number[] };
let U = 0;
let V = 0;
const ve: Record<string, { id: number; token: string }> = {};
const cho = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hang = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? []));

async function chay(q: ReturnType<typeof sql>): Promise<any[]> {
  const db = await getDb();
  if (!db) throw new Error("cần CSDL _test");
  return hang(await db.execute(q));
}
async function taoNguoi(ten: string, role: string): Promise<number> {
  const [u] = await chay(sql`INSERT INTO users ("openId", username, name, "loginMethod", role, "isActive", two_factor_enabled, "passwordChangedAt")
    VALUES (${`${TT}-${ten}`}, ${`${TT}_${ten}`}, ${`SKPVTB ${ten}`}, 'password', ${role}, true, false, now()) RETURNING id`);
  const id = Number(u.id);
  don.users.push(id);
  NGUOI.ds[id] = { id, role, name: `SKPVTB ${ten}` };
  return id;
}
async function taoPhien(userId: number, nhan: string): Promise<void> {
  const token = `${TT}.${nhan}.${Math.random().toString(36).slice(2)}`;
  const [s] = await chay(sql`INSERT INTO user_sessions ("userId", "sessionToken", "isActive", "expiresAt") VALUES (${userId}, ${token}, true, now() + interval '1 hour') RETURNING id`);
  don.sessions.push(Number(s.id));
  ve[nhan] = { id: Number(s.id), token };
}
function ketNoi(userId: number, nhan: string): Promise<ClientSocket> {
  const c = ioClient(url, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: { cookie: `phien=${userId}; app_session_id=${encodeURIComponent(ve[nhan].token)}` },
  });
  clients.push(c);
  return new Promise((resolve, reject) => {
    c.once("connect", () => resolve(c));
    c.once("connect_error", (e) => reject(e));
  });
}
const lyDoNgat = (c: ClientSocket) => new Promise<string>((r) => c.once("disconnect", (l) => r(String(l))));
const conSong = (c: ClientSocket) => socketMod.getIO()!.sockets.sockets.has(c.id ?? "?");
const phongCua = (c: ClientSocket) => [...(socketMod.getIO()!.sockets.sockets.get(c.id!)?.rooms ?? [])];

beforeAll(async () => {
  delete process.env.SOCKET_MACHINE_AUTH_MODE;
  U = await taoNguoi("u", "engineer");
  V = await taoNguoi("v", "engineer");
  await taoPhien(U, "u1");
  await taoPhien(U, "u2");
  await taoPhien(V, "v1");
  socketMod = await import("./socket");
  xl = await import("./socketXetLaiQuyen");
  http = createServer();
  socketMod.initializeSocket(http);
  socketMod.stopTwinBroadcaster();
  socketMod.stopOeeBroadcaster();
  socketMod.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  kenh = await xl.batDauNgheSocketPhamVi({ alert: () => undefined }); // LISTEN THẬT (client NOTIFY riêng của connection.ts)
  await cho(300);
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await kenh?.stop();
  socketMod?.stopTwinBroadcaster();
  socketMod?.stopOeeBroadcaster();
  socketMod?.stopTwinTrangThaiBroadcaster();
  await new Promise<void>((r) => (socketMod?.getIO() ? socketMod.getIO()!.close(() => r()) : r()));
  // DỌN = UPDATE VỀ TRƠ (KHÔNG DELETE)
  try {
    if (don.ufa.length) await chay(sql`UPDATE user_factory_assignments SET "factoryCode" = ${`${TT}-tro`} WHERE id IN (${sql.join(don.ufa.map((i) => sql`${i}`), sql`, `)})`);
    if (don.sessions.length) await chay(sql`UPDATE user_sessions SET "isActive" = false, "expiresAt" = now() WHERE id IN (${sql.join(don.sessions.map((i) => sql`${i}`), sql`, `)})`);
    if (don.users.length) await chay(sql`UPDATE users SET "isActive" = false, role = 'user' WHERE id IN (${sql.join(don.users.map((i) => sql`${i}`), sql`, `)}) AND username LIKE ${`${TT}_%`}`);
  } catch (e) {
    console.warn("[skpvtb] dọn (UPDATE về trơ):", (e as Error).message);
  }
}, 60_000);

describe("★★★ F5 đầu-cuối: COMMIT ⇒ NOTIFY ⇒ socket rớt (LISTEN thật, trigger thật)", () => {
  it("handshake đọc khoá phiên THẬT: socket ở kiem:user:{U} và kiem:phien:{id phiên}", async () => {
    const a = await ketNoi(U, "u1");
    await vi.waitFor(() => expect(phongCua(a)).toEqual(expect.arrayContaining([`kiem:user:${U}`, `kiem:phien:${ve.u1.id}`])), { timeout: 5000 });
    a.disconnect();
  });

  it("thu hồi phiên u1 (UPDATE isActive=false, COMMIT) ⇒ socket u1 rớt; socket u2 của CÙNG người còn sống", async () => {
    const s1 = await ketNoi(U, "u1");
    const s2 = await ketNoi(U, "u2");
    await cho(200);
    const ngat = lyDoNgat(s1);
    await chay(sql`UPDATE user_sessions SET "isActive" = false WHERE id = ${ve.u1.id}`);
    expect(await ngat).toBe("io server disconnect");
    await cho(300);
    expect(conSong(s2)).toBe(true);
  }, 20_000);

  it("ROLLBACK không bắn: đổi vai V trong giao dịch HOÀN TÁC ⇒ socket V KHÔNG rớt (NOTIFY chỉ giao lúc COMMIT)", async () => {
    const v = await ketNoi(V, "v1");
    await cho(200);
    const db = await getDb();
    const HT = new Error("ht");
    await db!.transaction(async (tx) => {
      await tx.execute(sql`UPDATE users SET role = 'operator' WHERE id = ${V}`);
      throw HT;
    }).catch((e) => {
      if (e !== HT) throw e;
    });
    await cho(800);
    expect(conSong(v)).toBe(true);
  }, 20_000);

  it("gán nhà máy cho U (INSERT, COMMIT) ⇒ socket u2 rớt; V còn sống. Rồi đổi vai V (COMMIT) ⇒ V rớt", async () => {
    const s2 = await ketNoi(U, "u2");
    const v = await ketNoi(V, "v1");
    await cho(200);
    const ngatU = lyDoNgat(s2);
    const [g] = await chay(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U}, ${`${TT}-F`}) RETURNING id`);
    don.ufa.push(Number(g.id));
    expect(await ngatU).toBe("io server disconnect");
    await cho(300);
    expect(conSong(v)).toBe(true);
    const ngatV = lyDoNgat(v);
    await chay(sql`UPDATE users SET role = 'operator' WHERE id = ${V}`);
    expect(await ngatV).toBe("io server disconnect");
  }, 20_000);
});
