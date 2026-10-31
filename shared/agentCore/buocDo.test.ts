/**
 * Đợt 12 · H0.2/H0.3 — CENSUS khối chèn: mọi khối vòng agent thêm vào hội thoại phải có MÃ trong `MA_KHOI_CHEN` và đi qua
 * `chenNhac` (hoặc `nhacCho.push`), để `buoc-do.nhacDaChen` không bao giờ bỏ sót. Khối chèn MỚI mà thiếu mã ⇒ đỏ ở đây.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bamNgan, MA_KHOI_CHEN, soDoDuoc } from "./buocDo";

const THU_MUC = import.meta.dirname;
const vong = readFileSync(join(THU_MUC, "vongAgent.ts"), "utf8");
const loiNhac = readFileSync(join(THU_MUC, "loiNhac.ts"), "utf8");

/** tên hằng/hàm lời nhắc chèn giữa hội thoại → mã. Thêm lời nhắc mới ⇒ phải thêm dòng ở đây VÀ mã ở MA_KHOI_CHEN. */
const MA_THEO_TEN: Record<string, (typeof MA_KHOI_CHEN)[number]> = {
  cauNhacTomTatNguCanh: "tom-tat-ngu-canh",
  CAU_QUAN_SAT_TOOL_CALL_HONG_KHUON: "tool-call-hong",
  CAU_NHAC_LUOT_CAT_KHONG_TOOL: "cat-khong-tool",
  CAU_NHAC_KIEM_DAC_TA: "kiem-dac-ta",
  cauNhacGhiChuaTest: "ghi-chua-test",
};

describe("census khối chèn", () => {
  it("vongAgent chỉ có MỘT chỗ đẩy tin user giữa hội thoại (trong chenNhac)", () => {
    expect([...vong.matchAll(/tinNhan\.push\(\{ role: "user"/g)].length).toBe(1);
  });

  it("mọi lời nhắc xuất khẩu của loiNhac.ts có trong bảng mã (không sót lời nhắc mới)", () => {
    const ten = [...loiNhac.matchAll(/^export (?:const|function) (CAU_\w+|cauNhac\w+)/gm)].map((m) => m[1]!);
    for (const t of ten) expect(MA_THEO_TEN, `lời nhắc ${t} thiếu mã khối chèn`).toHaveProperty(t);
  });

  it("mỗi lời nhắc trong bảng được dùng đúng với mã của nó trong vongAgent", () => {
    for (const [ten, ma] of Object.entries(MA_THEO_TEN)) {
      const mau = ma === "ghi-chua-test" ? `${ten}(` : `chenNhac("${ma}", ${ten}`;
      expect(vong.includes(mau), `${ten} → ${ma}`).toBe(true);
    }
    expect(vong).toMatch(/nhacCho\.push\("ghi-chua-test"\)/);
  });

  it("bảng mã và MA_KHOI_CHEN khớp nhau 1–1", () => {
    expect([...Object.values(MA_THEO_TEN)].sort()).toEqual([...MA_KHOI_CHEN].sort());
  });
});

describe("tiện ích", () => {
  it("bamNgan ổn định, 8 hex, nhạy với 1 ký tự", () => {
    expect(bamNgan("abc")).toBe(bamNgan("abc"));
    expect(bamNgan("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(bamNgan("abc")).not.toBe(bamNgan("abd"));
    expect(bamNgan("")).toBe("811c9dc5");
  });
  it("soDoDuoc: chỉ số hữu hạn ≥ 0", () => {
    expect(soDoDuoc(0)).toBe(0);
    expect(soDoDuoc(5)).toBe(5);
    for (const v of [undefined, null, "5", -1, NaN, Infinity]) expect(soDoDuoc(v)).toBeUndefined();
  });
});
