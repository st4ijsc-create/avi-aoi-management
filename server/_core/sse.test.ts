/**
 * ★★★ SSE `/api/stream` (kiểm định 2026-10-25, F1): phải có PHIÊN; sự kiện lọc theo nhà máy của người nghe; trần kết nối mỗi người; kênh "all" không bỏ qua lọc.
 */
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const xacThuc = vi.hoisted(() => ({ kq: { ok: false, ma: 401, user: null } as any }));
const phamVi = vi.hoisted(() => ({ ids: null as number[] | null, loi: false }));
vi.mock("../routes/_xacThucRest", () => ({
  thuXacThucRest: async () => xacThuc.kq,
  thanTuChoiRest: () => ({ error: "x", code: "UNAUTHORIZED" }),
}));
vi.mock("../db/hierarchy", () => ({
  idsTrongPhamVi: async () => {
    if (phamVi.loi) throw new Error("no db");
    return phamVi.ids;
  },
}));

import { sseBroadcast, sseClientCount, sseHandler } from "./sse";

function gia(query: Record<string, string> = {}) {
  const req = Object.assign(new EventEmitter(), { query }) as any;
  const res = { status: 0, body: undefined as unknown, ghi: [] as string[], daDong: false } as any;
  res.status = (m: number) => ((res.ma = m), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.writeHead = (m: number) => ((res.ma = m), res);
  res.write = (c: string) => (res.ghi.push(c), true);
  res.end = () => (res.daDong = true);
  return { req, res };
}
const user = (id: number, role = "supervisor") => ({ ok: true, user: { id, role } });
async function noi(id: number, ids: number[] | null, query: Record<string, string> = {}) {
  xacThuc.kq = user(id);
  phamVi.ids = ids;
  const k = gia(query);
  await sseHandler(k.req, k.res);
  return k;
}
const nhanDuoc = (k: ReturnType<typeof gia>) => k.res.ghi.filter((x: string) => x.startsWith("event:"));

beforeEach(() => {
  process.env.SSE_ENABLED = "true";
  delete process.env.SSE_MAX_PER_USER;
  phamVi.loi = false;
});

describe("SSE /api/stream", () => {
  it("không phiên ⇒ 401, KHÔNG mở luồng, không đăng ký client", async () => {
    xacThuc.kq = { ok: false, ma: 401, user: null };
    const truoc = sseClientCount();
    const k = gia();
    await sseHandler(k.req, k.res);
    expect(k.res.ma).toBe(401);
    expect(k.res.ghi).toEqual([]);
    expect(sseClientCount()).toBe(truoc);
  });
  it("tắt cờ ⇒ 404", async () => {
    process.env.SSE_ENABLED = "false";
    const k = gia();
    await sseHandler(k.req, k.res);
    expect(k.res.ma).toBe(404);
  });
  it("phạm vi không xác định được ⇒ 503, không mở luồng (fail-closed)", async () => {
    xacThuc.kq = user(900);
    phamVi.loi = true;
    const k = gia();
    await sseHandler(k.req, k.res);
    expect(k.res.ma).toBe(503);
    expect(k.res.ghi).toEqual([]);
  });
  it("lọc nhà máy: client nhà máy A không nhận sự kiện B; toàn quyền nhận cả hai; kênh 'all' không bỏ qua lọc; factoryId null ⇒ chỉ toàn quyền", async () => {
    const a = await noi(101, [1]);
    const b = await noi(102, [2]);
    const adm = await noi(103, null);
    const kenh = await noi(104, [1], { channels: "andon" });
    sseBroadcast("andon", "x", { n: 1 }, 1);
    sseBroadcast("andon", "x", { n: 2 }, 2);
    sseBroadcast("khac", "x", { n: 3 }, null);
    expect(nhanDuoc(a)).toHaveLength(1); // chỉ n=1
    expect(a.res.ghi.join("")).toContain('"n":1');
    expect(a.res.ghi.join("")).not.toContain('"n":2');
    expect(nhanDuoc(b)).toHaveLength(1); // chỉ n=2
    expect(b.res.ghi.join("")).not.toContain('"n":1');
    expect(nhanDuoc(adm)).toHaveLength(3); // toàn quyền: cả ba (kể cả factoryId null)
    expect(nhanDuoc(kenh)).toHaveLength(1); // kênh andon + nhà máy 1 ⇒ n=1 (kênh 'khac' bị loại)
    expect(nhanDuoc(a).join("")).not.toContain('"n":3'); // null không tới người có phạm vi
  });
  it("phạm vi rỗng ([]) ⇒ không nhận sự kiện nhà máy nào", async () => {
    const k = await noi(110, []);
    sseBroadcast("andon", "x", { n: 9 }, 1);
    expect(nhanDuoc(k)).toHaveLength(0);
  });
  it("trần kết nối mỗi người: vượt ⇒ 429; người khác vẫn vào; đóng bớt ⇒ vào lại được", async () => {
    process.env.SSE_MAX_PER_USER = "2";
    const k1 = await noi(200, [1]);
    await noi(200, [1]);
    const k3 = await noi(200, [1]);
    expect(k3.res.ma).toBe(429);
    expect(k3.res.ghi).toEqual([]);
    expect((await noi(201, [1])).res.ma).toBe(200);
    k1.req.emit("close");
    expect((await noi(200, [1])).res.ma).toBe(200);
  });
});
