/**
 * ★ Đợt 10.4 (D5) — nguồn của nút kiểm định ĐỌC KHO theo ID, CHỈ chủ lượt, tự suy mức (thiếu provenance ⇒ van-hanh). CSDL `_test` thật.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { donNguoiDungTest, taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { taoHangLuotChay, capNhatHangLuotChay } from "../../../db/aiAgentRuns";
import { luuPhien } from "../../../db/aiCodingSessions";
import { docNguonKiemDinh, mucCuaLuotAgent } from "./nguonKiemDinh";

const TT = `nkd${Date.now().toString(36)}`;
let A = 0;
let B = 0;
const exec = async (q: ReturnType<typeof sql>) => (await (await getDb())!.execute(q)) as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  A = (await taoNguoiDungTest("a", "user", { tienTo: TT })).id;
  B = (await taoNguoiDungTest("b", "user", { tienTo: TT })).id;
});
afterAll(async () => {
  await exec(sql`DELETE FROM ai_chat_messages WHERE "conversationId" IN (SELECT id FROM ai_chat_conversations WHERE "userId" IN (${A}, ${B}))`);
  await exec(sql`DELETE FROM ai_chat_conversations WHERE "userId" IN (${A}, ${B})`);
  await donNguoiDungTest();
});

const ev = (suKien: unknown) => ({ seq: 1, suKien });

describe("mucCuaLuotAgent", () => {
  it("chỉ tool đọc mã / tra tài liệu mã ⇒ ky-thuat; run_command / ghi tệp / tool lạ / sự kiện hỏng ⇒ van-hanh", () => {
    const doc = [ev({ loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 }), ev({ loai: "ket-qua-tool", ten: "search_docs" }), ev({ loai: "chu", noiDung: "x" })];
    expect(mucCuaLuotAgent(doc)).toBe("ky-thuat");
    expect(mucCuaLuotAgent([])).toBe("ky-thuat");
    for (const ten of ["run_command", "write_file", "query_db", 5]) expect(mucCuaLuotAgent([...doc, ev({ loai: "goi-tool", goi: { ten }, luot: 2 })]), String(ten)).toBe("van-hanh");
    expect(mucCuaLuotAgent("x")).toBe("van-hanh");
    expect(mucCuaLuotAgent([null])).toBe("van-hanh");
  });
});

describe("docNguonKiemDinh — CSDL", () => {
  it("chat: câu trả lời ASSISTANT + câu hỏi user trước nó; LUÔN van-hanh; người khác / tin user / id lạ ⇒ null", async () => {
    const [cv] = await exec(sql`INSERT INTO ai_chat_conversations ("userId", title) VALUES (${A}, ${TT}) RETURNING id`);
    const c = Number(cv!.id);
    const [u] = await exec(sql`INSERT INTO ai_chat_messages ("conversationId", role, content) VALUES (${c}, 'user', 'OEE máy 7 hôm nay?') RETURNING id`);
    const [a] = await exec(sql`INSERT INTO ai_chat_messages ("conversationId", role, content) VALUES (${c}, 'assistant', 'OEE 81%') RETURNING id`);
    expect(await docNguonKiemDinh(A, { loai: "chat", cuocTroChuyenId: c, tinNhanId: Number(a!.id) })).toEqual({ cauHoi: "OEE máy 7 hôm nay?", traLoi: "OEE 81%", muc: "van-hanh", beMat: "chat" });
    expect(await docNguonKiemDinh(B, { loai: "chat", cuocTroChuyenId: c, tinNhanId: Number(a!.id) })).toBeNull();
    expect(await docNguonKiemDinh(A, { loai: "chat", cuocTroChuyenId: c, tinNhanId: Number(u!.id) })).toBeNull();
    expect(await docNguonKiemDinh(A, { loai: "chat", cuocTroChuyenId: c, tinNhanId: 2_000_000_000 })).toBeNull();
  });

  it("agent: chủ ⇒ cauHoi + tomTat; mức theo tool; tomTat rỗng ⇒ chữ cuối; người khác / id sai dạng ⇒ null", async () => {
    const id = randomUUID();
    expect(await taoHangLuotChay({ id, userId: A, projectId: "du-an-thu", cheDo: "hoi", cauHoi: "tìm lỗi hàm cong" })).toBe(true);
    await capNhatHangLuotChay(A, id, { suKien: [ev({ loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 }), ev({ loai: "chu", noiDung: "chữ cuối" })] } as never);
    expect(await docNguonKiemDinh(A, { loai: "agent", runId: id })).toEqual({ cauHoi: "tìm lỗi hàm cong", traLoi: "chữ cuối", muc: "ky-thuat", beMat: "agent-turn" });
    await capNhatHangLuotChay(A, id, { tomTat: "kết luận", suKien: [ev({ loai: "goi-tool", goi: { ten: "run_command" }, luot: 1 })] } as never);
    expect(await docNguonKiemDinh(A, { loai: "agent", runId: id })).toMatchObject({ traLoi: "kết luận", muc: "van-hanh" });
    expect(await docNguonKiemDinh(B, { loai: "agent", runId: id })).toBeNull();
    expect(await docNguonKiemDinh(A, { loai: "agent", runId: "khong-phai-uuid" })).toBeNull();
  });

  it("coding: lượt ASSISTANT theo chỉ số + câu hỏi user gần nhất; van-hanh mặc định; lượt user / ngoài mảng / người khác ⇒ null", async () => {
    const l = await luuPhien(A, { projectId: "du-an-thu", turns: [{ role: "user", content: "viết hàm cộng" }, { role: "assistant", content: "function f(a,b){return a+b}" }] });
    expect(l.ok).toBe(true);
    expect(await docNguonKiemDinh(A, { loai: "coding", phienId: l.id!, chiSoLuot: 1 })).toEqual({ cauHoi: "viết hàm cộng", traLoi: "function f(a,b){return a+b}", muc: "van-hanh", beMat: "coding" });
    expect(await docNguonKiemDinh(A, { loai: "coding", phienId: l.id!, chiSoLuot: 0 })).toBeNull();
    expect(await docNguonKiemDinh(A, { loai: "coding", phienId: l.id!, chiSoLuot: 9 })).toBeNull();
    expect(await docNguonKiemDinh(B, { loai: "coding", phienId: l.id!, chiSoLuot: 1 })).toBeNull();
  });
});
