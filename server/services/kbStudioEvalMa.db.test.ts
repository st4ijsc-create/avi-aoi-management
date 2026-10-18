/**
 * ★ Đợt 5.2 — lượt eval mã ghi SỔ THẬT (`kb_eval_ma_runs`, mig 0397) trên `_test` bằng vai `avi_app`; model + bộ chấm
 * vẫn GIẢ (không gọi :8091, không biên dịch). Canh: hàng `dang-chay` → `xong` (CHECK: ketThuc + tongHop), % = 100, kết
 * quả từng lượt đọc lại được; hàng `dang-chay` mồ côi của CHÍNH tiến trình này hiển thị `gian-doan`.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { kbEvalMaRuns } from "../../drizzle/schema";
import { batDauEvalMa, choXongEvalMa, danhSachEvalMa, type PhuThuocEvalMa } from "./kbStudioEvalMa";
import { soEvalMaThat } from "./kbStudioEvalMaSo";

const CORPUS = `t52-${Date.now().toString(36)}`;

afterAll(async () => {
  delete process.env.KB_STUDIO_EVAL_MA_ENABLED;
  const db = await getDb();
  if (db) await db.delete(kbEvalMaRuns).where(eq(kbEvalMaRuns.corpus, CORPUS));
});

const pt: PhuThuocEvalMa = {
  docBoBai: () => ({ bai: [{ id: "T1", lang: "ts", prompt: "cong", test: "x" }], hash: "0123456789abcdef" }),
  truyHoi: vi.fn(async () => [{ sourceRef: "a.md", text: "doan", score: 0.9 }]),
  sinh: vi.fn(async () => ({ text: "```ts\nx\n```", cut: false })),
  cham: vi.fn(async (v: { dir: string }) => ({ sinhDuocMa: true, dat: v.dir.endsWith("-tat"), loi: null })),
  so: soEvalMaThat,
  thuMucLam: "D:/khong-dung",
  systemPrompt: "SYS",
};

describe("sổ eval mã — CSDL _test thật", () => {
  it("lượt chạy trọn ⇒ hàng 'xong', tienDo 100, ketThuc có, tongHop + ketQua đọc lại được", async () => {
    const db = (await getDb())!;
    const [d] = (await db.execute(sql`SELECT current_database() AS d`)) as unknown as Array<{ d: string }>;
    expect(d!.d).toMatch(/_test$/);
    process.env.KB_STUDIO_EVAL_MA_ENABLED = "true";
    const { id } = await batDauEvalMa({ corpus: CORPUS, boBai: "tasks-gia", soLap: 2, userId: null }, pt);
    await choXongEvalMa(id);
    const [h] = await db.select().from(kbEvalMaRuns).where(eq(kbEvalMaRuns.id, id));
    expect(h).toMatchObject({ trangThai: "xong", tienDo: 100, soBai: 1, soLap: 2 });
    expect(h!.ketThuc).toBeInstanceOf(Date);
    // 1 bài × 2 lặp ⇒ tập con 2 lượt < 6 ⇒ kết luận chính "khong-du-bai-co-doan"; thước cũ (toàn bộ) vẫn "tut" và đọc lại được.
    expect(h!.tongHop).toMatchObject({ n: 2, tat: { dat: 2 }, bat: { dat: 0 }, ketLuanToanBo: "tut", tapCoDoan: { n: 2 }, ketLuan: "khong-du-bai-co-doan", tut: false });
    expect(h!.ketQua).toHaveLength(4);
    const ds = await danhSachEvalMa(CORPUS, 10, pt);
    expect(ds[0]).toMatchObject({ id, trangThai: "xong", dangSong: false });
  });

  it("hàng 'dang-chay' của tiến trình NÀY mà không còn sống ⇒ đọc ra 'gian-doan'", async () => {
    const id = randomUUID();
    await soEvalMaThat.tao({ id, corpus: CORPUS, boBai: "tasks", boBaiHash: "0123456789abcdef", soBai: 1, soLap: 1, tienTrinh: `${os.hostname().slice(0, 60)}:${process.pid}`, createdBy: null });
    const ds = await danhSachEvalMa(CORPUS, 10, pt);
    expect(ds.find((h) => h.id === id)).toMatchObject({ trangThai: "gian-doan", dangSong: false });
  });
});
