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
import { docNguonKiemDinh, mucCuaLuotAgent, TRAN_SU_KIEN_LUU_AGENT } from "./nguonKiemDinh";
import { noiVaoDem, suKienDeLuu, TRAN_SU_KIEN_LUU } from "../agent/quanLyLuotChay";

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

let SEQ = 0;
const ev = (suKien: unknown) => ({ seq: ++SEQ, suKien });
const nhatKy = (...ds: unknown[]) => {
  SEQ = 0;
  return ds.map(ev);
};

describe("mucCuaLuotAgent", () => {
  const DOC = [{ loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 }, { loai: "ket-qua-tool", ten: "search_docs" }, { loai: "chu", noiDung: "x" }];
  it("chỉ tool đọc mã / tra tài liệu mã ⇒ ky-thuat; run_command / ghi tệp / tool lạ / sự kiện hỏng ⇒ van-hanh", () => {
    expect(mucCuaLuotAgent(nhatKy(...DOC))).toBe("ky-thuat");
    for (const ten of ["run_command", "write_file", "query_db", 5]) expect(mucCuaLuotAgent(nhatKy(...DOC, { loai: "goi-tool", goi: { ten }, luot: 2 })), String(ten)).toBe("van-hanh");
    expect(mucCuaLuotAgent("x")).toBe("van-hanh");
    expect(mucCuaLuotAgent([null])).toBe("van-hanh");
  });

  it("rà kiem-dinh T1 — KHÔNG có bằng chứng ≠ kỹ thuật: rỗng / chạm trần lưu / seq hở / goi-tool hay ket-qua-tool thiếu tên ⇒ van-hanh", () => {
    expect(mucCuaLuotAgent([])).toBe("van-hanh");
    expect(TRAN_SU_KIEN_LUU_AGENT).toBe(TRAN_SU_KIEN_LUU);
    // nhật ký thật qua suKienDeLuu: 3 500 mục đọc mã + MỘT run_command ở giữa ⇒ bị cắt mất ⇒ vẫn phải van-hanh
    const dem = Array.from({ length: 3500 }, (_, i) => ({ seq: i + 1, suKien: i === 1000 ? { loai: "goi-tool", goi: { ten: "run_command" }, luot: 1 } : { loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 } }));
    const luu = suKienDeLuu(dem as never);
    expect(luu.some((m) => (m.suKien as { goi?: { ten?: string } }).goi?.ten === "run_command")).toBe(false); // đúng là đã mất
    expect(mucCuaLuotAgent(luu)).toBe("van-hanh");
    // đúng trần, seq liền, toàn đọc mã ⇒ vẫn van-hanh (nhật ký chạm trần không chứng minh được đầy đủ)
    expect(mucCuaLuotAgent(Array.from({ length: TRAN_SU_KIEN_LUU }, (_, i) => ({ seq: i + 1, suKien: { loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 } })))).toBe("van-hanh");
    expect(mucCuaLuotAgent(Array.from({ length: TRAN_SU_KIEN_LUU - 1 }, (_, i) => ({ seq: i + 1, suKien: { loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 } })))).toBe("ky-thuat");
    // khe trước mục KHÔNG phải chữ (vd tool) = mất sự kiện ⇒ van-hanh; seq lùi ⇒ van-hanh
    const hoSeq = nhatKy(...DOC);
    hoSeq[1]!.seq = 5; // khe 1→5 trước ket-qua-tool, seq vẫn tăng
    hoSeq[2]!.seq = 6;
    expect(mucCuaLuotAgent(hoSeq)).toBe("van-hanh");
    const lui = nhatKy(...DOC);
    lui[2]!.seq = 1;
    expect(mucCuaLuotAgent(lui)).toBe("van-hanh");
    expect(mucCuaLuotAgent(nhatKy(...DOC, { loai: "goi-tool", goi: {}, luot: 2 }))).toBe("van-hanh");
    expect(mucCuaLuotAgent(nhatKy(...DOC, { loai: "goi-tool", luot: 2 }))).toBe("van-hanh");
    expect(mucCuaLuotAgent(nhatKy(...DOC, { loai: "ket-qua-tool", ok: true }))).toBe("van-hanh");
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
    await capNhatHangLuotChay(A, id, { suKien: nhatKy({ loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 }, { loai: "chu", noiDung: "chữ cuối" }) } as never);
    // lượt CHƯA xong (dang-chay) ⇒ nhật ký chưa đủ ⇒ van-hanh
    expect(await docNguonKiemDinh(A, { loai: "agent", runId: id })).toMatchObject({ muc: "van-hanh" });
    await capNhatHangLuotChay(A, id, { trangThai: "xong" } as never);
    expect(await docNguonKiemDinh(A, { loai: "agent", runId: id })).toEqual({ cauHoi: "tìm lỗi hàm cong", traLoi: "chữ cuối", muc: "ky-thuat", beMat: "agent-turn" });
    await capNhatHangLuotChay(A, id, { tomTat: "kết luận", suKien: nhatKy({ loai: "goi-tool", goi: { ten: "run_command" }, luot: 1 }) } as never);
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

describe("rà kiem-dinh — nhật ký THẬT (noiVaoDem gộp delta chữ ⇒ seq có khe hợp lệ) → suKienDeLuu → JSON", () => {
  const that = (ds: unknown[]) => {
    const dem: Parameters<typeof noiVaoDem>[0] = [];
    ds.forEach((e, i) => noiVaoDem(dem, { seq: i + 1, suKien: e } as never));
    return JSON.parse(JSON.stringify(suKienDeLuu(dem)));
  };
  const KHUNG = (giua: unknown[]) => [
    { loai: "bat-dau", runId: "r", cheDo: "hoi" },
    { loai: "chu", noiDung: "Để tôi " },
    { loai: "chu", noiDung: "đọc tệp." },
    ...giua,
    { loai: "chu", noiDung: "Kết " },
    { loai: "chu", noiDung: "luận." },
    { loai: "xong", lyDo: "hoan-thanh" },
  ];
  it("chỉ đọc mã ⇒ ky-thuat (log thật có khe trước mục chữ gộp)", () => {
    const luu = that(KHUNG([{ loai: "goi-tool", goi: { ten: "read_file" }, luot: 1 }, { loai: "ket-qua-tool", id: "1", ten: "read_file", ok: true, tomTat: "x" }]));
    expect(luu.map((m: { seq: number }) => m.seq)).not.toEqual(luu.map((_: unknown, i: number) => i + 1)); // đúng là có khe
    expect(mucCuaLuotAgent(luu)).toBe("ky-thuat");
  });
  it("có tool ghi (giữa các mục chữ gộp) ⇒ van-hanh", () => {
    const luu = that(KHUNG([{ loai: "goi-tool", goi: { ten: "write_file" }, luot: 1 }, { loai: "ket-qua-tool", id: "1", ten: "write_file", ok: true, tomTat: "x" }]));
    expect(mucCuaLuotAgent(luu)).toBe("van-hanh");
  });
});
