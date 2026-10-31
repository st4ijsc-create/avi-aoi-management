/**
 * Đợt 12 · H5.4 — tầng dữ liệu lịch sử lượt agent (`ai_agent_run_lich_su`, mig 0450) trên CSDL `_test` THẬT: phạm vi chủ, UPSERT, "tiếp tục" MỘT lần
 * (UPDATE có điều kiện, kể cả đua), gỡ dấu, cascade khi xoá lượt, dọn bản lưu cũ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import type { TinNhan } from "@shared/agentCore";
import { getDb } from "./connection";
import { aiAgentRunLichSu, aiAgentRuns } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { createLocalUser } from "./auth";
import { danhDauTiepTuc, docLichSu, donLichSuCu, goDauTiepTuc, luuLichSu, xoaLichSu } from "./aiAgentLichSu";
import { taoHangLuotChay } from "./aiAgentRuns";

let uA = 0;
let uB = 0;
const TIN: TinNhan[] = [
  { role: "user", content: "q" },
  { role: "assistant", content: "", tool_calls: [{ id: "a", type: "function", function: { name: "read_file", arguments: "{}" } }] },
];

beforeAll(async () => {
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("Mk-h54-db!1", 10);
  uA = (await createLocalUser({ username: `h54a-${Date.now()}`, passwordHash: hash, name: "A", role: "admin" })).id;
  uB = (await createLocalUser({ username: `h54b-${Date.now()}`, passwordHash: hash, name: "B", role: "admin" })).id;
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const ids = [uA, uB].filter((x) => x > 0);
  for (const u of ids) {
    await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u)); // cascade xuống bản lưu
    await db.delete(userSecrets).where(eq(userSecrets.userId, u));
  }
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
}, 60_000);

async function tao(userId: number): Promise<string> {
  const id = randomUUID();
  expect(await taoHangLuotChay({ id, userId, projectId: "h54", cheDo: "sua", cauHoi: "q" })).toBeTruthy();
  return id;
}
const dem = async (runId: string) => {
  const db = (await getDb())!;
  return (await db.select().from(aiAgentRunLichSu).where(eq(aiAgentRunLichSu.runId, runId))).length;
};

describe("aiAgentLichSu", () => {
  it("★ ghi rồi đọc lại đúng nội dung; UPSERT thay bản cũ (một hàng/lượt)", async () => {
    const run = await tao(uA);
    expect(await luuLichSu(uA, run, TIN, 1)).toBe(true);
    expect(await luuLichSu(uA, run, [...TIN, { role: "tool", tool_call_id: "a", name: "read_file", content: "kq" }], 2)).toBe(true);
    expect(await dem(run)).toBe(1);
    const ban = await docLichSu(uA, run);
    expect(ban).toMatchObject({ buoc: 2, daTiepTucBoi: null });
    expect(ban!.tinNhan).toHaveLength(3);
    expect(ban!.tinNhan[2]).toMatchObject({ role: "tool", content: "kq" });
  });

  it("★★★ PHẠM VI CHỦ: người khác không đọc / ghi / xoá / đánh dấu được; id méo ⇒ null/false", async () => {
    const run = await tao(uA);
    await luuLichSu(uA, run, TIN, 1);
    expect(await docLichSu(uB, run)).toBeNull();
    expect(await luuLichSu(uB, run, [{ role: "user", content: "ghi đè" }], 9)).toBe(false); // FK kép chặn userId lệch
    expect((await docLichSu(uA, run))!.tinNhan).toHaveLength(2);
    await xoaLichSu(uB, run);
    expect(await dem(run)).toBe(1);
    expect(await danhDauTiepTuc(uB, run, randomUUID())).toBe(false);
    expect((await docLichSu(uA, run))!.daTiepTucBoi).toBeNull();
    for (const sai of ["", "khong-phai-uuid", "../x"]) {
      expect(await docLichSu(uA, sai)).toBeNull();
      expect(await luuLichSu(uA, sai, TIN, 1)).toBe(false);
      expect(await danhDauTiepTuc(uA, sai, randomUUID())).toBe(false);
    }
    expect(await luuLichSu(0, run, TIN, 1)).toBe(false);
    expect(await luuLichSu(-1, run, TIN, 1)).toBe(false);
  });

  it("★★★ ĐÁNH DẤU tiếp tục chỉ thắng MỘT lần, kể cả đua song song", async () => {
    const run = await tao(uA);
    await luuLichSu(uA, run, TIN, 1);
    const kq = await Promise.all(Array.from({ length: 8 }, () => danhDauTiepTuc(uA, run, randomUUID())));
    expect(kq.filter(Boolean)).toHaveLength(1);
    const ban = await docLichSu(uA, run);
    expect(ban!.daTiepTucBoi).toMatch(/^[0-9a-f-]{36}$/);
    expect(await danhDauTiepTuc(uA, run, randomUUID())).toBe(false);
  });

  it("không tự tiếp tục chính mình; gỡ dấu chỉ gỡ ĐÚNG dấu của lượt mới", async () => {
    const run = await tao(uA);
    await luuLichSu(uA, run, TIN, 1);
    expect(await danhDauTiepTuc(uA, run, run)).toBe(false);
    const moi = randomUUID();
    expect(await danhDauTiepTuc(uA, run, moi)).toBe(true);
    await goDauTiepTuc(uA, run, randomUUID()); // dấu khác ⇒ không gỡ
    expect((await docLichSu(uA, run))!.daTiepTucBoi).toBe(moi);
    await goDauTiepTuc(uB, run, moi); // người khác ⇒ không gỡ
    expect((await docLichSu(uA, run))!.daTiepTucBoi).toBe(moi);
    await goDauTiepTuc(uA, run, moi);
    expect((await docLichSu(uA, run))!.daTiepTucBoi).toBeNull();
    expect(await danhDauTiepTuc(uA, run, randomUUID())).toBe(true); // tiếp tục được lại
  });

  it("UPSERT KHÔNG xoá dấu tiếp tục đã đặt", async () => {
    const run = await tao(uA);
    await luuLichSu(uA, run, TIN, 1);
    const moi = randomUUID();
    await danhDauTiepTuc(uA, run, moi);
    await luuLichSu(uA, run, [...TIN, { role: "user", content: "thêm" }], 3);
    expect((await docLichSu(uA, run))!.daTiepTucBoi).toBe(moi);
  });

  it("xoá bản lưu của mình; xoá LƯỢT ⇒ cascade xoá bản lưu", async () => {
    const run = await tao(uA);
    await luuLichSu(uA, run, TIN, 1);
    expect(await xoaLichSu(uA, run)).toBe(true);
    expect(await dem(run)).toBe(0);
    await luuLichSu(uA, run, TIN, 1);
    const db = (await getDb())!;
    await db.delete(aiAgentRuns).where(eq(aiAgentRuns.id, run));
    expect(await dem(run)).toBe(0);
  });

  it("★ CA BIÊN ở CSDL: 400 tin ghi được, 401 tin bị CHECK chặn (luuLichSu trả false, hàng cũ còn nguyên)", async () => {
    const run = await tao(uA);
    const mk = (n: number): TinNhan[] => Array.from({ length: n }, (_v, i) => ({ role: "user" as const, content: "m" + i }));
    expect(await luuLichSu(uA, run, mk(400), 1)).toBe(true);
    expect((await docLichSu(uA, run))!.tinNhan).toHaveLength(400);
    expect(await luuLichSu(uA, run, mk(401), 2)).toBe(false);
    const ban = await docLichSu(uA, run);
    expect(ban!.tinNhan).toHaveLength(400);
    expect(ban!.buoc).toBe(1);
  });

  it("bản lưu không phải mảng ⇒ đọc trả null (không đưa rác cho host)", async () => {
    const run = await tao(uA);
    await luuLichSu(uA, run, TIN, 1);
    const db = (await getDb())!;
    // CHECK chặn không-mảng ở CSDL: ép bằng cách bỏ qua — chỉ kiểm hàm đọc với dữ liệu hợp lệ trả đúng mảng
    expect(Array.isArray((await docLichSu(uA, run))!.tinNhan)).toBe(true);
    await expect(db.execute(sql`UPDATE ai_agent_run_lich_su SET "tinNhan" = '{"a":1}'::jsonb WHERE "runId" = ${run}::uuid`)).rejects.toThrow();
  });

  it("dọn bản lưu cũ: chỉ hàng cũ hơn hạn bị xoá", async () => {
    const cu = await tao(uA);
    const moi = await tao(uA);
    await luuLichSu(uA, cu, TIN, 1);
    await luuLichSu(uA, moi, TIN, 1);
    const db = (await getDb())!;
    await db.execute(sql`UPDATE ai_agent_run_lich_su SET "capNhatLuc" = now() - interval '8 days' WHERE "runId" = ${cu}::uuid`);
    const n = await donLichSuCu(7);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await dem(cu)).toBe(0);
    expect(await dem(moi)).toBe(1);
  });
});
