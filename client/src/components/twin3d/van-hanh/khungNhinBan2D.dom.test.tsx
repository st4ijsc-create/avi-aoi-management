// @vitest-environment jsdom
/**
 * khungNhinBan2D.dom.test.tsx — **BẢN 2D KHỚP KHUNG THEO NỘI DUNG, KHÔNG THEO SÀN KHAI BÁO.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUYẾT TẬT ĐƯỢC GHIM — đo trên trình duyệt thật, `/twin` FUYU-F
 * ════════════════════════════════════════════════════════════════════════════
 * `viewBox` của bản 2D là **3004 × 2004 mét** trong khi máy chỉ chiếm **51 × 200 m** — nội dung
 * lấp **1,7 %** bề rộng. Hậu quả đo được, không suy đoán:
 *   · tỉ lệ vẽ **0,244 px/mét** ⇒ một đích bấm 24 px đòi một vật **98 mét**, rộng gần gấp đôi
 *     toàn bộ vùng máy;
 *   · cả **6/6** biểu tượng cụm dồn vào một góc và rơi trúng ô `hang-tong-quan` của panel trái
 *     ⇒ **không bấm được cái nào**.
 * Bản 3D thì tự khớp khung theo nội dung, nên hai bề mặt trả lời khác nhau về cùng một nhà máy —
 * đúng lớp lỗi *"hai nút, hai thứ"* mà Task 20 đã ghi.
 *
 * Sau khi khớp theo nội dung: **0,244 → 2,369 px/mét**, và bấm cụm ⇒ `/twin/line/:id` ĐẠT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ CA NGHỊCH LÀ PHẦN QUAN TRỌNG NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * Một bản cài "luôn khớp chặt quanh máy" cũng thoả ca thuận. Nên tệp này còn đòi:
 *   · máy rải rộng ⇒ khung PHẢI nới ra theo (không phải một hằng số);
 *   · không có máy nào ⇒ quay về khung theo SÀN (không được chia cho 0, không được khung rỗng);
 *   · khung luôn ÔM TRỌN mọi máy — khớp chặt tới mức cắt mất máy thì tệ hơn khung rộng.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanhVanHanh2D } from "./CanhVanHanh2D";
import type { MayTrongLo } from "../loi/LoBatchMay";

const SAN_RONG_M = 3000;
const SAN_SAU_M = 2000;

/**
 * ★ `coM` MẶC ĐỊNH 20 m, KHÔNG phải 1 m — và đây là một sửa chữa CỦA CHÍNH LƯỚI NÀY.
 *
 * Bản đầu dùng máy 1 m và chỉ kiểm TÂM máy có nằm trong khung. Đột biến lật dấu lề
 * (`xMin - bien` → `xMin + bien`) **sống sót**: lề `LE_M = 2 m` của component lớn hơn `bien = 1 m`
 * nên nó che mất phép lật. Một phép canh mà không đột biến nào bắt được là một phép canh chưa ai
 * chứng minh là còn sống. ⇒ máy đủ to để `bien` vượt `LE_M`, và ca kiểm **thân máy**, không kiểm tâm.
 */
function khoi(
  ds: ReadonlyArray<{ id: number; x: number; z: number }>,
  coM = 20,
): MayTrongLo[] {
  return ds.map((m) => ({
    machineId: m.id,
    khoi: "tram_chung" as MayTrongLo["khoi"],
    kichThuocMm: { rongMm: coM * 1_000, sauMm: coM * 1_000, caoMm: 1_800 },
    viTri: { x: m.x, y: 0, z: m.z },
    gocXoayRad: 0,
    mau: "#22c55e",
  }));
}

function ve(may: MayTrongLo[]) {
  const r = render(
    <CanhVanHanh2D
      may={may}
      trangThaiTheoMay={new Map(may.map((m) => [m.machineId, "running"]))}
      maTheoMay={new Map(may.map((m) => [m.machineId, `M${m.machineId}`]))}
      machineIdChon={null}
      onChonMay={() => {}}
      sanRongM={SAN_RONG_M}
      sanSauM={SAN_SAU_M}
      nhanTrangThai={(tt) => tt}
      ariaLabel="cảnh 2D"
    />,
  );
  const svg = r.container.querySelector('[data-testid="canh-van-hanh-2d"]')!;
  const [x, z, rong, sau] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
  return { r, khung: { x, z, rong, sau } };
}

describe("khung nhìn bản 2D", () => {
  it("★★★ khớp theo NỘI DUNG: máy chiếm 50 m trên sàn 3.000 m ⇒ khung ~50 m, KHÔNG ~3.000 m", () => {
    const { khung } = ve(khoi([{ id: 1, x: 20, z: 10 }, { id: 2, x: 70, z: 10 }]));
    expect(khung.rong).toBeLessThan(SAN_RONG_M / 10);
    // …và vẫn đủ rộng để ôm trọn 50 m khoảng cách giữa hai máy.
    expect(khung.rong).toBeGreaterThanOrEqual(50);
  });

  it("★★★ CA NGHỊCH — máy rải RỘNG ⇒ khung phải NỚI RA (không phải một hằng số)", () => {
    const hep = ve(khoi([{ id: 1, x: 20, z: 10 }, { id: 2, x: 70, z: 10 }])).khung;
    const rong = ve(khoi([{ id: 1, x: 20, z: 10 }, { id: 2, x: 620, z: 10 }])).khung;
    expect(rong.rong).toBeGreaterThan(hep.rong * 5);
  });

  it("★★★ khung ÔM TRỌN THÂN máy, không chỉ tâm — cắt mất máy còn tệ hơn khung rộng", () => {
    const CO_M = 20;                      // ← lớn hơn `LE_M` của component, để lề không che khuyết tật
    const ds = [
      { id: 1, x: 120, z: 110 },
      { id: 2, x: 170, z: 360 },
      { id: 3, x: 145, z: 70 },
    ];
    const { khung } = ve(khoi(ds, CO_M));
    for (const m of ds) {
      // Mép THÂN máy (tâm ± nửa cạnh), không phải tâm.
      expect(m.x - CO_M / 2).toBeGreaterThanOrEqual(khung.x);
      expect(m.x + CO_M / 2).toBeLessThanOrEqual(khung.x + khung.rong);
      expect(m.z - CO_M / 2).toBeGreaterThanOrEqual(khung.z);
      expect(m.z + CO_M / 2).toBeLessThanOrEqual(khung.z + khung.sau);
    }
  });

  it("★★★ KHÔNG có máy nào ⇒ quay về khung theo SÀN (không khung rỗng, không chia cho 0)", () => {
    const { khung } = ve([]);
    expect(khung.rong).toBeGreaterThanOrEqual(SAN_RONG_M);
    expect(khung.sau).toBeGreaterThanOrEqual(SAN_SAU_M);
    expect(Number.isFinite(khung.x)).toBe(true);
    expect(Number.isFinite(khung.z)).toBe(true);
  });

  it("★ một máy duy nhất ⇒ khung vẫn có bề rộng DƯƠNG (sàn tối thiểu, không co về 0)", () => {
    const { khung } = ve(khoi([{ id: 1, x: 100, z: 100 }]));
    expect(khung.rong).toBeGreaterThan(0);
    expect(khung.sau).toBeGreaterThan(0);
  });
});
