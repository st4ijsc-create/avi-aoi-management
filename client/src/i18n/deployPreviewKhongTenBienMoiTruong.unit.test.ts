/**
 * Doc 80 Đợt 1 final wave (item 6) — chuỗi lý do cổng deploy (Task 5) KHÔNG được nêu tên biến môi trường.
 *
 * Task 1 đã quét tên biến `.env` khỏi mọi banner trạng thái tắt trên các trang kỹ thuật (người vận hành
 * đọc "Triển khai thật đang tắt", không đọc `DPC_DEPLOY_ENABLED`). Task 5 đưa chúng trở lại trên CÙNG trang
 * qua `engineering.deployPreview.reason.*` (`DPC_DEPLOY_ENABLED is on`, `ZMC_ENDPOINT is not configured`,
 * `ZAUXDLL_PATH (zauxdll.dll) …`, `OT_CONTROL_ENABLED is off — …`, `URSIM_HOST unset`) ở cả vi/en/zh.
 * Lưới này canh CẢ khối `engineering.deployPreview` (mọi giá trị, đệ quy) ở ba locale bằng đúng biểu thức
 * final-fix-brief nêu: `/[A-Z][A-Z0-9]+_[A-Z0-9_]+/`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCALES = ["vi", "en", "zh"] as const;
const TEN_BIEN_MOI_TRUONG = /[A-Z][A-Z0-9]+_[A-Z0-9_]+/;

function docKhoi(locale: string): Record<string, unknown> {
  const json = JSON.parse(readFileSync(resolve(__dirname, "locales", `${locale}.json`), "utf8")) as Record<string, unknown>;
  const eng = json.engineering as Record<string, unknown> | undefined;
  const khoi = eng?.deployPreview as Record<string, unknown> | undefined;
  if (!khoi) throw new Error(`${locale}.json: không thấy engineering.deployPreview — khoá đổi tên?`);
  return khoi;
}

function moiGiaTri(o: unknown, duong: string, ra: Array<[string, string]>): void {
  if (typeof o === "string") ra.push([duong, o]);
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) moiGiaTri(v, `${duong}.${k}`, ra);
}

describe("engineering.deployPreview.* — không tên biến môi trường trong chuỗi cho người dùng (vi/en/zh)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: mọi giá trị KHÔNG khớp /[A-Z][A-Z0-9]+_[A-Z0-9_]+/`, () => {
      const ra: Array<[string, string]> = [];
      moiGiaTri(docKhoi(locale), "engineering.deployPreview", ra);
      // Cầu chì: phải THẤY khối lý do (≥ 50 chuỗi), không thì khẳng định dưới đúng trên tập rỗng.
      expect(ra.length).toBeGreaterThan(50);
      const viPham = ra.filter(([, v]) => TEN_BIEN_MOI_TRUONG.test(v)).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
      expect(viPham, `${locale}.json còn tên biến môi trường:\n${viPham.join("\n")}`).toEqual([]);
    });
  }

  it("cầu chì: biểu thức phải bắt được đúng hình dạng tên biến (và bỏ qua chữ thường / từ không gạch dưới)", () => {
    for (const co of ["DPC_DEPLOY_ENABLED is on", "chưa cấu hình ZMC_ENDPOINT", "ZAUXDLL_PATH (zauxdll.dll)", "URSIM_HOST unset"]) {
      expect(TEN_BIEN_MOI_TRUONG.test(co), co).toBe(true);
    }
    for (const khong of ["has machine_control permission", "HITL authorization (OT)", "TCP reachability probed", "OpenPLC host", "zauxdll.dll"]) {
      expect(TEN_BIEN_MOI_TRUONG.test(khong), khong).toBe(false);
    }
  });
});
