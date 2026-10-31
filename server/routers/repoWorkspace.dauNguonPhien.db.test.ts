/**
 * ★ Đợt 10.4b L2 — dấu nguồn PHIÊN lập trình (`repoWorkspace.luuPhien`, turns do client ghi): `ngoaiCallIds` máy chủ XÁC MINH (đúng
 * người + ok + băm khớp NGUYÊN VĂN một turn assistant) ⇒ `coLuotNgoai`; lệch ⇒ BAD_REQUEST dau-nguon-lech, KHÔNG lưu; không id ⇒ tự dò 24 h.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { readAppErrorMeta } from "../_core/appError";
import { repoWorkspaceRouter } from "./repoWorkspaceRouter";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { bamCauTraLoi } from "../services/ai/ngoai/soNgoai";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));
let U = 0;
let V = 0;
const goi = (id: number) => repoWorkspaceRouter.createCaller({ user: { id, role: "admin" } } as never);

async function luotNgoai(userId: number, traLoi: string): Promise<number> {
  const [y] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "userId", "tuDong", "nhaCungCap", model, "mucDich", "bamNoiDung")
    VALUES (1, 'y-dinh', ${userId}, false, 'anthropic', 'claude-x', 'coding', ${"d".repeat(64)}) RETURNING id`);
  await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "ketCuc", "bamTraLoi")
    VALUES (1, 'ket-qua', ${y!.id}, ${userId}, false, 'anthropic', 'claude-x', 'coding', 'ok', ${bamCauTraLoi(traLoi)})`);
  return Number(y!.id);
}
const co = async (id: string) => (await exec(sql`SELECT "coLuotNgoai" AS c FROM ai_coding_sessions WHERE id = ${id}`))[0]?.c;
const lyDo = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const m = readAppErrorMeta(e) as { appParams?: { reason?: string } } | null;
    return `${(e as { code?: string }).code}:${m?.appParams?.reason ?? ""}`;
  }
};

beforeAll(async () => {
  U = (await taoNguoiDungTest("rwdnU", "admin")).id;
  V = (await taoNguoiDungTest("rwdnV", "admin")).id;
});
afterAll(async () => {
  for (const id of [U, V]) await exec(sql`DELETE FROM ai_coding_sessions WHERE "userId" = ${id}`);
});

describe("luuPhien — dấu nguồn phiên lập trình", () => {
  it("ngoaiCallIds đúng người + khớp NGUYÊN VĂN một turn ⇒ lưu + coLuotNgoai true", async () => {
    const tl = `Trả lời ngoài coding ${Date.now()} — ệ 中`;
    const id = await luotNgoai(U, tl);
    const r = await goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "hỏi" }, { role: "assistant", content: tl }], ngoaiCallIds: [id] });
    expect(r.ok).toBe(true);
    expect(await co(r.id!)).toBe(true);
    // luong-ui (render an toàn khi tải lại) — moPhien + danhSachPhien trả coLuotNgoai
    const mo = await goi(U).moPhien({ sessionId: r.id! });
    expect(mo.session).toMatchObject({ coLuotNgoai: true });
    const ds = await goi(U).danhSachPhien({ projectId: "repo" });
    expect(ds.sessions.find((s) => s.id === r.id)).toMatchObject({ coLuotNgoai: true });
    const cucBo = await goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "h" }, { role: "assistant", content: `cb ${Date.now()}` }] });
    expect((await goi(U).moPhien({ sessionId: cucBo.id! })).session).toMatchObject({ coLuotNgoai: false });
  });
  it("id của NGƯỜI KHÁC / turn đã SỬA (băm lệch) ⇒ BAD_REQUEST dau-nguon-lech, KHÔNG tạo phiên", async () => {
    const truoc = Number((await exec(sql`SELECT count(*)::int AS n FROM ai_coding_sessions WHERE "userId" = ${U}`))[0]!.n);
    const cuaV = await luotNgoai(V, "trả lời của V");
    expect(await lyDo(goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "h" }, { role: "assistant", content: "trả lời của V" }], ngoaiCallIds: [cuaV] }))).toBe("BAD_REQUEST:dau-nguon-lech");
    const cuaU = await luotNgoai(U, "bản gốc coding");
    expect(await lyDo(goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "h" }, { role: "assistant", content: "bản ĐÃ SỬA" }], ngoaiCallIds: [cuaU] }))).toBe("BAD_REQUEST:dau-nguon-lech");
    expect(Number((await exec(sql`SELECT count(*)::int AS n FROM ai_coding_sessions WHERE "userId" = ${U}`))[0]!.n)).toBe(truoc);
  });
  it("KHÔNG gửi id nhưng một turn trùng băm lượt ngoài của CHÍNH người đó (24 h) ⇒ vẫn đánh dấu; turn cục bộ ⇒ không", async () => {
    const tl = `Tự dò coding ${Date.now()}`;
    await luotNgoai(U, tl);
    const r1 = await goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "h" }, { role: "assistant", content: tl }] });
    expect(await co(r1.id!)).toBe(true);
    const r2 = await goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "h" }, { role: "assistant", content: `cục bộ ${Date.now()}` }] });
    expect(await co(r2.id!)).toBe(false);
    // lượt ngoài của NGƯỜI KHÁC cùng chữ ⇒ không đánh dấu phiên của U
    const cuaV = `Tự dò V ${Date.now()}`;
    await luotNgoai(V, cuaV);
    const r3 = await goi(U).luuPhien({ projectId: "repo", turns: [{ role: "user", content: "h" }, { role: "assistant", content: cuaV }] });
    expect(await co(r3.id!)).toBe(false);
  });
});
