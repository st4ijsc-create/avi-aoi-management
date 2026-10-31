/**
 * ★ rà kiem-dinh L1 (2)(3) — `luuLuot` THẬT (CSDL `_test`): máy chủ lưu lượt ngoài NGUYÊN VĂN (Unicode dài) + dấu nguồn + coLuotNgoai trong
 * MỘT giao dịch; nội dung lưu khớp băm sổ cổng (xác minh dấu nguồn qua callId thành công); hội thoại không tồn tại ⇒ ném, KHÔNG lưu dở.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { phuThuocKbNgoaiThat } from "./kbNgoai";
import { bamCauTraLoi } from "../services/ai/ngoai/soNgoai";
import { xacMinhDauNguon } from "../services/ai/ngoai/dauNguon";

const hang = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const exec = async (q: ReturnType<typeof sql>) => hang(await ((await getDb()) as unknown as { execute(q: unknown): Promise<unknown> }).execute(q));

let U = 0;
let C = 0;
beforeAll(async () => {
  U = (await taoNguoiDungTest("kbnU", "user")).id;
  C = Number((await exec(sql`INSERT INTO ai_chat_conversations ("userId", title) VALUES (${U}, 'kbn') RETURNING id`))[0]!.id);
});
afterAll(async () => {
  await exec(sql`DELETE FROM ai_chat_conversations WHERE "userId" = ${U}`);
});

describe("luuLuot thật", () => {
  it("lưu NGUYÊN VĂN câu trả lời dài Unicode + nguonModel/ngoaiCallId + coLuotNgoai + messageCount; băm nội dung lưu = băm sổ ⇒ xác minh qua callId OK", async () => {
    const dai = "Trả lời — ệ ữ ẫ 中文 👩‍🔧\t\n".repeat(400);
    const [y] = await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "userId", "tuDong", "nhaCungCap", model, "mucDich", "bamNoiDung")
      VALUES (1, 'y-dinh', ${U}, false, 'anthropic', 'claude-x', 'chat', ${"c".repeat(64)}) RETURNING id`);
    await exec(sql`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "ketCuc", "bamTraLoi")
      VALUES (1, 'ket-qua', ${y!.id}, ${U}, false, 'anthropic', 'claude-x', 'chat', 'ok', ${bamCauTraLoi(dai)})`);
    const r = await phuThuocKbNgoaiThat.luuLuot({ conversationId: C, cauHoi: "hỏi gì đó", traLoi: dai, nguonModel: "ngoai:anthropic:claude-x", callId: Number(y!.id), tokens: 42 });
    const [tl] = await exec(sql`SELECT content, "nguonModel", "ngoaiCallId", role FROM ai_chat_messages WHERE id = ${r.tinTraLoiId}`);
    expect(tl).toMatchObject({ content: dai, nguonModel: "ngoai:anthropic:claude-x", role: "assistant" });
    expect(Number(tl!.ngoaiCallId)).toBe(Number(y!.id));
    expect(await xacMinhDauNguon((await getDb()) as never, { userId: U, traLoi: String(tl!.content), ngoaiCallId: Number(y!.id) })).toMatchObject({ nguonModel: "ngoai:anthropic:claude-x" });
    const [h] = await exec(sql`SELECT "coLuotNgoai" AS c, "messageCount" AS n FROM ai_chat_conversations WHERE id = ${C}`);
    expect(h).toMatchObject({ c: true, n: 2 });
    expect((await exec(sql`SELECT content FROM ai_chat_messages WHERE id = ${r.tinNguoiDungId}`))[0]!.content).toBe("hỏi gì đó");
  });

  it("hội thoại không tồn tại (FK) ⇒ ném và KHÔNG để lại tin dở (một giao dịch)", async () => {
    const truoc = Number((await exec(sql`SELECT count(*)::int AS n FROM ai_chat_messages WHERE content = 'mo-coi-kbn'`))[0]!.n);
    await expect(phuThuocKbNgoaiThat.luuLuot({ conversationId: 2_000_000_000, cauHoi: "mo-coi-kbn", traLoi: "mo-coi-kbn", nguonModel: "ngoai:anthropic:claude-x", callId: 1, tokens: null })).rejects.toBeTruthy();
    expect(Number((await exec(sql`SELECT count(*)::int AS n FROM ai_chat_messages WHERE content = 'mo-coi-kbn'`))[0]!.n)).toBe(truoc);
  });
});
