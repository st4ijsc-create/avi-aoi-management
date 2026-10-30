/**
 * ★ Đợt 10.4b L0a' — DẤU NGUỒN tin chat do model NGOÀI sinh (CSDL `_test` thật, caller tRPC thật). Rà kiem-dinh (B1):
 * `nguonModel` / `ngoaiCallId` CHỈ do máy chủ ghi sau khi xác minh (callId đúng người + ketCuc ok + băm khớp); client gửi `nguonModel` giả ⇒ bị bỏ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { readAppErrorMeta } from "../_core/appError";
import { aiChatRouter } from "./aiChatRouter";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { bamCauTraLoi } from "../services/ai/ngoai/soNgoai";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));

let U = 0;
let V = 0;
const goi = (id: number) => aiChatRouter.createCaller({ user: { id, role: "admin", name: "t" } } as never);

/** Một lượt ngoài trong sổ cổng (ý định + kết quả ok) của `userId` cho câu trả lời `traLoi` ⇒ callId (id ý định). */
async function luotNgoai(userId: number, traLoi: string, ketCuc = "ok"): Promise<number> {
  const [y] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "userId", "tuDong", "nhaCungCap", model, "mucDich", "bamNoiDung")
    VALUES (1, 'y-dinh', ${userId}, false, 'anthropic', 'claude-x', 'chat', ${"a".repeat(64)}) RETURNING id`);
  await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "tokenVao", "tokenRa", "chiPhiUocUsd", "ketCuc", "bamTraLoi")
    VALUES (1, 'ket-qua', ${y!.id}, ${userId}, false, 'anthropic', 'claude-x', 'chat', 120, 45, 0.0021, ${ketCuc}, ${bamCauTraLoi(traLoi)})`);
  return Number(y!.id);
}
const hoiThoai = async (id: number) => (await goi(id).createConversation({ title: "dn" } as never)) as unknown as { id: number };
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
  U = (await taoNguoiDungTest("dnU", "admin")).id;
  V = (await taoNguoiDungTest("dnV", "admin")).id;
});
afterAll(async () => {
  for (const id of [U, V]) await exec(sql`DELETE FROM ai_chat_conversations WHERE "userId" = ${id}`);
});

describe("saveStreamedMessage + getMessages — dấu nguồn máy chủ xác minh", () => {
  it("callId đúng người + băm khớp ⇒ nguonModel + coLuotNgoai; getMessages trả nguonModel + vetNgoai, KHÔNG trả ngoaiCallId", async () => {
    const c = await hoiThoai(U);
    const traLoi = "Đây là câu trả lời của AI ngoài.";
    const callId = await luotNgoai(U, traLoi);
    await goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "hỏi", assistantMessage: traLoi, ngoaiCallId: callId });
    const ds = (await goi(U).getMessages({ conversationId: c.id })) as Array<Record<string, unknown>>;
    const tl = ds.find((m) => m.role === "assistant")!;
    expect(tl.nguonModel).toBe("ngoai:anthropic:claude-x");
    expect(tl.vetNgoai).toEqual({ nhaCungCap: "anthropic", model: "claude-x", tokenVao: 120, tokenRa: 45, chiPhiUocUsd: 0.0021 });
    expect(tl).not.toHaveProperty("ngoaiCallId");
    expect(ds.find((m) => m.role === "user")!.nguonModel).toBeNull();
    expect((await exec(sql`SELECT "coLuotNgoai" AS c FROM ai_chat_conversations WHERE id = ${c.id}`))[0]!.c).toBe(true);
  });

  it("KHÔNG gửi callId nhưng chữ khớp lượt ngoài của chính người đó (24 h) ⇒ vẫn đánh dấu (client bỏ callId không rửa được dấu)", async () => {
    const c = await hoiThoai(U);
    const traLoi = `Trả lời ngoài ${Date.now()}`;
    await luotNgoai(U, traLoi);
    await goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "hỏi", assistantMessage: `  ${traLoi}\n` });
    const ds = (await goi(U).getMessages({ conversationId: c.id })) as Array<Record<string, unknown>>;
    expect(ds.find((m) => m.role === "assistant")!.nguonModel).toBe("ngoai:anthropic:claude-x");
  });

  it("rà kiem-dinh (A4/A5) — tự dò CHỈ lượt của CHÍNH người lưu và trong 24 h: cùng băm với lượt ngoài của NGƯỜI KHÁC ⇒ không nhận dấu (không thành oracle); lượt cũ > 24 h ⇒ không tự dò", async () => {
    const c = await hoiThoai(U);
    const cuaV = `Trả lời ngoài của V ${Date.now()}`;
    await luotNgoai(V, cuaV);
    await goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "h", assistantMessage: cuaV });
    const cu = `Trả lời ngoài CŨ ${Date.now()}`;
    const [y] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "userId", "tuDong", "nhaCungCap", model, "mucDich", "bamNoiDung", "taoLuc")
      VALUES (1, 'y-dinh', ${U}, false, 'anthropic', 'claude-x', 'chat', ${"b".repeat(64)}, now() - interval '25 hours') RETURNING id`);
    await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "ketCuc", "bamTraLoi", "taoLuc")
      VALUES (1, 'ket-qua', ${y!.id}, ${U}, false, 'anthropic', 'claude-x', 'chat', 'ok', ${bamCauTraLoi(cu)}, now() - interval '25 hours')`);
    await goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "h", assistantMessage: cu });
    const ds = (await goi(U).getMessages({ conversationId: c.id })) as Array<Record<string, unknown>>;
    expect(ds.filter((m) => m.role === "assistant").map((m) => m.nguonModel)).toEqual([null, null]);
  });

  it("callId của NGƯỜI KHÁC / băm lệch / kết cục lỗi ⇒ BAD_REQUEST dau-nguon-lech, KHÔNG lưu gì", async () => {
    const c = await hoiThoai(U);
    const cuaV = await luotNgoai(V, "trả lời của V");
    expect(await lyDo(goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "h", assistantMessage: "trả lời của V", ngoaiCallId: cuaV }))).toBe("BAD_REQUEST:dau-nguon-lech");
    const cuaU = await luotNgoai(U, "bản gốc");
    expect(await lyDo(goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "h", assistantMessage: "bản ĐÃ SỬA", ngoaiCallId: cuaU }))).toBe("BAD_REQUEST:dau-nguon-lech");
    const loi = await luotNgoai(U, "lượt lỗi", "loi");
    expect(await lyDo(goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "h", assistantMessage: "lượt lỗi", ngoaiCallId: loi }))).toBe("BAD_REQUEST:dau-nguon-lech");
    expect(await goi(U).getMessages({ conversationId: c.id })).toHaveLength(0);
  });

  it("vetNgoaiTheoCall: CHỈ lượt của chính người xem + nhà máy trong phạm vi (callId người khác / nhà máy khác ⇒ không lộ vết)", async () => {
    const { vetNgoaiTheoCall } = await import("../services/ai/ngoai/dauNguon");
    const cuaU = await luotNgoai(U, "vết U");
    const cuaV = await luotNgoai(V, "vết V");
    const db = (await getDb()) as never;
    expect([...(await vetNgoaiTheoCall(db, U, null, [cuaU, cuaV])).keys()]).toEqual([cuaU]);
    expect((await vetNgoaiTheoCall(db, U, [1], [cuaU])).size).toBe(1);
    expect((await vetNgoaiTheoCall(db, U, [999_999], [cuaU])).size).toBe(0);
    expect((await vetNgoaiTheoCall(db, U, [], [cuaU])).size).toBe(0);
  });

  it("client tự khai nguonModel / ngoaiCallId giả trong thân ⇒ bị BỎ; tin cục bộ (không khớp sổ) ⇒ nguonModel null, hội thoại không đánh dấu", async () => {
    const c = await hoiThoai(U);
    await goi(U).saveStreamedMessage({ conversationId: c.id, userMessage: "h", assistantMessage: `cục bộ ${Date.now()}`, nguonModel: "ngoai:anthropic:gia" } as never);
    const ds = (await goi(U).getMessages({ conversationId: c.id })) as Array<Record<string, unknown>>;
    expect(ds.every((m) => m.nguonModel === null && m.vetNgoai === null)).toBe(true);
    expect((await exec(sql`SELECT "coLuotNgoai" AS c FROM ai_chat_conversations WHERE id = ${c.id}`))[0]!.c).toBe(false);
  });
});
