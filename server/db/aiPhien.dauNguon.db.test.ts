/**
 * G1 + G3 trên CSDL THẬT (`_test`) — bộ xác minh THẬT (`xacMinhPhienCoLuotNgoai` trên bảng `ai_external_calls`) và câu UPDATE thật của `themLuot`.
 * Mọi fixture nằm trong MỘT giao dịch bị hoàn tác (`BEGIN` … `ROLLBACK` trên kết nối riêng, không DELETE, không owner `aoi`); `getDb` trỏ vào kết nối đó.
 * Ghi chú: tệp đơn vị `aiPhien.dauNguon.test.ts` đã khoá HÌNH DẠNG (một UPDATE duy nhất, cờ đơn điệu); tệp này chứng minh nó chạy được trên postgres.js thật.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const DB_URL = process.env.DATABASE_URL;
const holder: { db: unknown } = { db: null };
vi.mock("./connection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDb: async () => holder.db,
}));

import { themLuot, duAnCuaPhien, mo } from "./aiPhien";
import { bamCauTraLoi } from "../services/ai/ngoai/soNgoai";

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;
let phien: ReturnType<typeof postgres>;
const ID: Record<string, number> = {};
const PH: Record<string, string> = {};

async function mkUser(k: string): Promise<void> {
  const [r] = await phien`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`dn-${k}-${RUN}`}, ${`dn-${k}-${RUN}`}, ${k}, 'engineer', true) RETURNING id`;
  ID[k] = Number(r.id);
}
async function mkPhien(k: string, userKey: string, projectId: string | null): Promise<void> {
  const [r] = await phien`INSERT INTO ai_coding_sessions ("userId", "projectId", title, turns, "turnCount", kind, source)
    VALUES (${ID[userKey]}, ${projectId}, 't', '[]'::jsonb, 0, 'coding', 'vscode') RETURNING id`;
  PH[k] = String(r.id);
}
/** Một lượt model ngoài trong sổ (ý định + kết quả) của `userKey` với câu trả lời `traLoi` ⇒ id ý định. */
async function luotNgoai(userKey: string, traLoi: string, ketCuc = "ok"): Promise<number> {
  const [y] = await phien`INSERT INTO ai_external_calls ("factoryId", loai, "userId", "tuDong", "nhaCungCap", model, "mucDich", "bamNoiDung", "taoLuc")
    VALUES (1, 'y-dinh', ${ID[userKey]}, false, 'anthropic', 'claude-x', 'coding', ${"e".repeat(64)}, now()) RETURNING id`;
  await phien`INSERT INTO ai_external_calls ("factoryId", loai, "yDinhId", "userId", "tuDong", "nhaCungCap", model, "mucDich", "ketCuc", "bamTraLoi", "taoLuc")
    VALUES (1, 'ket-qua', ${y.id}, ${ID[userKey]}, false, 'anthropic', 'claude-x', 'coding', ${ketCuc}, ${bamCauTraLoi(traLoi)}, now())`;
  return Number(y.id);
}
const doc = async (k: string) => {
  const [r] = await phien`SELECT version, "turnCount", "coLuotNgoai" AS co FROM ai_coding_sessions WHERE id = ${PH[k]}`;
  return { version: Number(r.version), turnCount: Number(r.turnCount), co: r.co === true };
};
const luot = (traLoi: string) => [{ role: "user", content: "hỏi" }, { role: "assistant", content: traLoi }];

describe.skipIf(!DB_URL)("aiPhien.themLuot — dấu nguồn model ngoài trên CSDL thật (G1)", () => {
  beforeAll(async () => {
    phien = postgres(DB_URL!, { max: 1, onnotice: () => undefined });
    await phien`BEGIN`;
    holder.db = drizzle(phien);
    await mkUser("a");
    await mkUser("b");
    for (const k of ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]) await mkPhien(k, "a", "du-an-1");
    await mkPhien("a-di-san", "a", null);
  }, 120_000);

  afterAll(async () => {
    holder.db = null;
    if (phien) {
      await phien`ROLLBACK`;
      await phien.end({ timeout: 5 });
    }
  }, 60_000);

  it("(a) ★ câu trả lời trùng băm một lượt ok của CHÍNH MÌNH, KHÔNG gửi id ⇒ tự dò ⇒ coLuotNgoai=true", async () => {
    const t = `tu do ${RUN}`;
    await luotNgoai("a", t);
    expect(await themLuot(ID.a, { sessionId: PH.a1, expectedVersion: 1, luot: luot(t) })).toMatchObject({ ok: true, turnCount: 2 });
    expect(await doc("a1")).toMatchObject({ co: true, turnCount: 2 });
  });

  it("(b) ★ gửi ngoaiCallIds của NGƯỜI KHÁC ⇒ DAU_NGUON_LECH, version/turns không đổi, cờ vẫn false", async () => {
    const t = `cua B ${RUN}`;
    const idB = await luotNgoai("b", t);
    expect(await themLuot(ID.a, { sessionId: PH.a2, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [idB] })).toEqual({ ok: false, ma: "DAU_NGUON_LECH" });
    expect(await doc("a2")).toEqual({ version: 1, turnCount: 0, co: false });
  });

  it("(c) ★ id của mình nhưng BĂM LỆCH (câu trả lời khác) / kết cục ≠ ok / id không tồn tại ⇒ DAU_NGUON_LECH, không ghi", async () => {
    const idA = await luotNgoai("a", `goc ${RUN}`);
    expect(await themLuot(ID.a, { sessionId: PH.a3, expectedVersion: 1, luot: luot(`khac ${RUN}`), ngoaiCallIds: [idA] })).toEqual({ ok: false, ma: "DAU_NGUON_LECH" });
    const t = `loi ${RUN}`;
    const idLoi = await luotNgoai("a", t, "loi");
    expect(await themLuot(ID.a, { sessionId: PH.a3, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [idLoi] })).toEqual({ ok: false, ma: "DAU_NGUON_LECH" });
    expect(await themLuot(ID.a, { sessionId: PH.a3, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [2_000_000_000] })).toEqual({ ok: false, ma: "DAU_NGUON_LECH" });
    expect(await doc("a3")).toEqual({ version: 1, turnCount: 0, co: false });
  });

  it("(d) lượt không liên quan model ngoài ⇒ cờ vẫn false", async () => {
    expect(await themLuot(ID.a, { sessionId: PH.a4, expectedVersion: 1, luot: luot(`cuc bo ${RUN}`) })).toMatchObject({ ok: true });
    expect(await doc("a4")).toMatchObject({ co: false, turnCount: 2 });
  });

  it("(e) ★ ĐƠN ĐIỆU: cờ đã true rồi ghi lượt cục bộ ⇒ VẪN true", async () => {
    const t = `don dieu ${RUN}`;
    const id = await luotNgoai("a", t);
    expect(await themLuot(ID.a, { sessionId: PH.a5, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [id] })).toMatchObject({ ok: true, version: 2 });
    expect((await doc("a5")).co).toBe(true);
    expect(await themLuot(ID.a, { sessionId: PH.a5, expectedVersion: 2, luot: luot(`cuc bo sau ${RUN}`) })).toMatchObject({ ok: true, version: 3 });
    expect(await doc("a5")).toMatchObject({ co: true, version: 3, turnCount: 4 });
  });

  it("(f) ★ lượt vào và cờ lên CÙNG một câu UPDATE: ghi thành công ⇒ cả hai cùng thấy; ghi bị từ chối ⇒ cả hai cùng không", async () => {
    const t = `cung giao dich ${RUN}`;
    const id = await luotNgoai("a", t);
    await themLuot(ID.a, { sessionId: PH.a6, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [id] });
    const sau = await doc("a6");
    expect(sau.turnCount === 2 && sau.co).toBe(true); // không có trạng thái "lượt vào, cờ chưa lên"
    await themLuot(ID.a, { sessionId: PH.a7, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [987_654_321] });
    expect(await doc("a7")).toEqual({ version: 1, turnCount: 0, co: false });
  });

  it("(4) B không thấy gì khác DAU_NGUON_LECH/NOT_FOUND: id của A do B gửi, và phiên của A do B ghi", async () => {
    const t = `chap B ${RUN}`;
    const idA = await luotNgoai("a", t);
    await mkPhien("b1", "b", "du-an-1");
    expect(await themLuot(ID.b, { sessionId: PH.b1, expectedVersion: 1, luot: luot(t), ngoaiCallIds: [idA] })).toEqual({ ok: false, ma: "DAU_NGUON_LECH" });
    expect(await themLuot(ID.b, { sessionId: PH.a1, expectedVersion: 2, luot: luot(t) })).toEqual({ ok: false, ma: "NOT_FOUND" });
  });
});

describe.skipIf(!DB_URL)("G3 — duAnCuaPhien trên CSDL thật", () => {
  it("trả dự án của phiên CỦA CHỦ; hàng di sản ⇒ null; phiên của người khác / không có ⇒ undefined", async () => {
    expect(await duAnCuaPhien(ID.a, PH.a1)).toBe("du-an-1");
    expect(await duAnCuaPhien(ID.a, PH["a-di-san"])).toBeNull();
    expect(await duAnCuaPhien(ID.b, PH.a1)).toBeUndefined();
    expect(await duAnCuaPhien(ID.a, "00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });
  it("mo vẫn đọc được phiên của chủ (kho không tự soát allowlist — việc của router, đã khoá ở aiPhien.duAn.test.ts)", async () => {
    expect(await mo(ID.a, PH.a1)).toMatchObject({ ok: true });
  });
});
