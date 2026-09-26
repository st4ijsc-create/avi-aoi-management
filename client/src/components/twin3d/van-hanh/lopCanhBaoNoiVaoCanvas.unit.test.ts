/**
 * lopCanhBaoNoiVaoCanvas.unit.test.ts — ★★★ ĐỢT 47 (N1 gốc rễ): LỚP BADGE PHẢI TRÙNG CANVAS, NHƯ LỚP NHÃN TỪ ĐỢT 31.
 *
 * Đo được (`.qa-dot47/run-probe-lop47.log`, dist, `e2e_tai_loE`): lớp `lop-canh-bao` lệch canvas (−57,−96) ở
 * `/twin` 1600 — đúng con số Đợt 31 từng đo cho lớp NHÃN — và (−443,−142) ở `/twin/line/2` 1600. Đợt 31 vá
 * `calculatePosition={TAM_CANVAS}` cho `LopNhan` và ghim bằng D-1 `lopTrungCanvas` — cho lớp nhãn; lớp badge
 * cùng kit, cùng lỗi, không ai quét (G110). Hậu quả: badge vẽ lệch khỏi máy của nó suốt 16 đợt; "badge bị thẻ
 * Chỉ số che" (QA Đợt 46 N1) là hệ quả của lệch lớp.
 *
 * TẦNG 1 — VĂN BẢN chỗ nối (khuôn `cheNhan.unit.test.ts`): `LopCanhBao` phải đi qua `TAM_CANVAS` của `LopNhan`
 * (một hàm, không hai bản). TẦNG 2 — hành vi thật đo ở e2e `twin-dot47-bam-canh.spec.ts` (lớp badge rect = canvas rect).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../../../..");
const LOP_CANH_BAO = readFileSync(resolve(GOC, "src/components/twin3d/van-hanh/LopCanhBao.tsx"), "utf8");
const LOP_NHAN = readFileSync(resolve(GOC, "src/components/twin3d/loi/LopNhan.tsx"), "utf8");

describe("★★★ Đợt 47 — LopCanhBao: lớp `fullscreen` neo vào TÂM canvas qua CÙNG `TAM_CANVAS` với LopNhan", () => {
  it("`TAM_CANVAS` là export của LopNhan (một hàm cho mọi `<Html fullscreen>` của kit)", () => {
    expect(LOP_NHAN).toMatch(/export const TAM_CANVAS = \(/);
  });
  it("LopCanhBao import `TAM_CANVAS` từ `../loi/LopNhan` và truyền `calculatePosition={TAM_CANVAS}` cho `<Html fullscreen`", () => {
    expect(LOP_CANH_BAO).toMatch(/import \{ TAM_CANVAS, layVungCam \} from "\.\.\/loi\/LopNhan"/);
    expect(LOP_CANH_BAO).toMatch(/<Html fullscreen calculatePosition=\{TAM_CANVAS\}/);
  });
  it("prop drei là HẰNG MODULE (G114 — prop mới mỗi render = đổi props ở mọi commit): zIndexRange, style", () => {
    expect(LOP_CANH_BAO).toMatch(/const Z_INDEX_BADGE: \[number, number\] = \[30, 10\];/);
    expect(LOP_CANH_BAO).toMatch(/const KIEU_LOP_BADGE = \{ pointerEvents: "none", userSelect: "none" \} as const;/);
    expect(LOP_CANH_BAO).toMatch(/zIndexRange=\{Z_INDEX_BADGE\} style=\{KIEU_LOP_BADGE\}/);
    expect(LOP_CANH_BAO).not.toMatch(/zIndexRange=\{\[30, 10\]\}/);
  });
  it("div trong lớp phủ chiếm trọn lớp (`position: relative`, 100%×100%) để `left/top` của badge là toạ độ canvas", () => {
    expect(LOP_CANH_BAO).toMatch(/data-testid="lop-canh-bao"[\s\S]*?style=\{\{ position: "relative", width: "100%", height: "100%" \}\}/);
  });
});
