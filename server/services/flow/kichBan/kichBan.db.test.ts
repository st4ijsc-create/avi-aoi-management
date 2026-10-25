/**
 * ★★★ Lô B7-E — chạy MỌI kịch bản `kichBan/*.json` bằng động cơ thật (`_test`) + kiểm chính BỘ CHẠY (bắt kỳ vọng sai, so tập con, AI ngoài kịch bản).
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inArray, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlows } from "../../../../drizzle/schema";
import { taoNguoiDungTest } from "../../../testing/nguoiDungTest";
import { chayKichBan, docKichBan, lechTapCon, type KichBan } from "./chayKichBan";

const TT = `t9kb${Math.floor(Math.random() * 1e5)}`;
const AQUI = dirname(fileURLToPath(import.meta.url));
let chu = 0;
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;

beforeAll(async () => {
  db = (await getDb())!;
  chu = (await taoNguoiDungTest("admin", "admin", { tienTo: "kb", ts: TT })).id;
}, 120_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

describe("kịch bản luồng (kichBan/*.json)", () => {
  const tep = readdirSync(AQUI).filter((f) => f.endsWith(".json")).sort();
  it("có ít nhất 6 kịch bản (chống 'xanh vì quét trúng 0 tệp')", () => {
    expect(tep.length).toBeGreaterThanOrEqual(6);
  });
  for (const f of tep) {
    it(`${f}`, async () => {
      const kb = docKichBan(f);
      const kq = await chayKichBan(kb, chu, TT);
      expect(kq.sai, `${kb.ten}: ${kq.sai.join(" | ")}`).toEqual([]);
      expect(kq.dat).toBe(true);
    });
  }
});

describe("chính bộ chạy", () => {
  it("lechTapCon: tập con sâu; mảng khớp độ dài; thiếu khoá; khác giá trị; kiểu khác", () => {
    expect(lechTapCon({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } })).toBeNull();
    expect(lechTapCon({ a: [{ x: 1, y: 2 }] }, { a: [{ x: 1 }] })).toBeNull();
    expect(lechTapCon({ a: [1, 2] }, { a: [1] })).toMatch(/độ dài/);
    expect(lechTapCon({ a: 1 }, { b: 1 })).toMatch(/THIẾU/);
    expect(lechTapCon({ a: 1 }, { a: 2 })).toMatch(/≠/);
    expect(lechTapCon({ a: "1" }, { a: 1 })).toMatch(/≠/);
    expect(lechTapCon(null, { a: 1 })).toMatch(/không phải đối tượng/);
    expect(lechTapCon({ a: null }, { a: null })).toBeNull();
  });

  it("★ BẮT kỳ vọng sai: đổi trạng thái / nhãn / khongChay / soLanGoiAi / dauVao ⇒ dat=false kèm lý do (không im lặng xanh)", async () => {
    const goc = docKichBan("mau5-chac-tao-phieu.json");
    const sai: KichBan = {
      ...goc,
      ten: "mau5 ky vong sai co chu y",
      kyVong: { trangThai: "loi", soLanGoiAi: 3, khongChay: ["tao-phieu"], buoc: { "tao-phieu": { dauVao: { main: [{ json: { nhan: "co-khi" } }] } }, "node-khong-co": { trangThai: "xong" } } },
    };
    const kq = await chayKichBan(sai, chu, TT);
    expect(kq.dat).toBe(false);
    expect(kq.sai.join("\n")).toMatch(/trạng thái lượt: thực «xong» ≠ kỳ vọng «loi»/);
    expect(kq.sai.join("\n")).toMatch(/số lần gọi AI: thực 1 ≠ kỳ vọng 3/);
    expect(kq.sai.join("\n")).toMatch(/«tao-phieu» KHÔNG được chạy nhưng đã chạy/);
    expect(kq.sai.join("\n")).toMatch(/node «tao-phieu» dauVao.*≠/);
    expect(kq.sai.join("\n")).toMatch(/«node-khong-co»: KHÔNG có bước nào/);
  });

  it("★ AI gọi NGOÀI kịch bản (không luật khớp) ⇒ lượt lỗi rõ, kỳ vọng 'xong' bị bắt", async () => {
    const goc = docKichBan("mau5-chac-tao-phieu.json");
    const kq = await chayKichBan({ ...goc, ten: "mau5 ai ngoai kich ban", ai: [{ khop: "khong-bao-gio-khop", tra: "dien" }] }, chu, TT);
    expect(kq.dat).toBe(false);
    expect(kq.trangThai).toBe("loi");
  });

  it("kịch bản thiếu luong và mau ⇒ ném (kịch bản hỏng không được xanh)", async () => {
    await expect(chayKichBan({ ten: "rong", kyVong: {} }, chu, TT)).rejects.toThrow(/cần luong hoặc mau/);
  });
});
