/**
 * mucNgamSongSotDungLaiControls.unit.test.ts — MỤC NGẮM PHẢI SỐNG SÓT QUA MỘT LẦN DỰNG LẠI
 * `OrbitControls`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT — ĐO SỐNG, VÀ NÓ ĐÃ NẤP SAU MỘT SỰ TÌNH CỜ
 * ════════════════════════════════════════════════════════════════════════════
 * `DieuKhien` dựng `OrbitControls` mới mỗi khi `banKinhToiDa`/`onCameraDoi` đổi tham chiếu. Một
 * `OrbitControls` mới mặc định `target = (0,0,0)`, và lần `update()` kế tiếp **giữ nguyên VỊ TRÍ
 * camera nhưng quay nó về gốc toạ độ**.
 *
 * Đo ở `/twin/line/526`, bố cục sơ đồ, khi dữ liệu WIP/andon về ở giây thứ ~5:
 *
 *   | | vị trí camera | hướng nhìn | khối đo được | đích ≥24×24 |
 *   |---|---|---|---|---|
 *   | đúng | (124; 27,9; 132,8) | (0; −0,970; −0,243) | 39 | 39/39 |
 *   | sau khi dựng lại | (124; 27,9; 132,8) — **y hệt** | (−0,675; −0,152; −0,723) | 36 | cảnh trống |
 *
 * Giải ngược hướng sai ⇒ mục ngắm rơi về **(0,1; 0; 0,1)**, tức gốc toạ độ. Ảnh chụp: chỉ còn
 * sàn, 39 máy ngoài khung, **không một lỗi nào nổ**.
 *
 * ⚠⚠ VÌ SAO NÓ CHỈ LỘ RA BÂY GIỜ — và đây mới là bài học: trước đây `khungNhin` đổi GIÁ TRỊ mỗi
 *    khi dữ liệu sống về, nên một tween mới luôn chạy ngay sau đó và **vô tình ngắm lại**. Bố
 *    cục sơ đồ làm `khungNhin` ổn định theo giá trị ⇒ tween thôi chạy lại ⇒ khuyết tật hết chỗ
 *    nấp. Một hành vi tình cờ đang che một khuyết tật là một bản vá **không ai biết mình có**,
 *    và nó hết hiệu lực đúng vào lúc có người dọn cái tình cờ ấy đi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ HẠNG PHÉP ĐO — nói thẳng
 * ════════════════════════════════════════════════════════════════════════════
 * Logic nằm trong `useEffect`/`useFrame` của một component R3F có `<Canvas>` WebGL, không dựng
 * nổi ở `environment: "node"`. Nên tệp này là **hạng B** (đo VĂN BẢN của mã) — thấp hơn đo bằng
 * giá trị, và là hạng cao nhất có được ở chỗ này. Bằng chứng nhân quả thật sự là **ablation
 * sống** ghi ở bảng trên: gỡ đúng khối khôi phục ⇒ 36 khối, cảnh trống, bấm không đi đâu;
 * hoàn nguyên ⇒ 39/39 và bấm mở `/twin/may/:id`.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

const MA = docMaNguon(
  resolve(__dirname, "CanhVanHanh.tsx"),
);

describe("★★★ mục ngắm sống sót qua một lần dựng lại OrbitControls", () => {
  it("★★★ khối KHÔI PHỤC có mặt, và chạy TRƯỚC khi `controlsRef` được công bố", () => {
    const iKhoi = MA.indexOf("controls.target.copy(mucRef.current)");
    expect(iKhoi, "không thấy khối khôi phục mục ngắm").toBeGreaterThan(-1);
    const iCongBo = MA.indexOf("controlsRef.current = controls;");
    expect(iCongBo).toBeGreaterThan(-1);
    // Công bố trước rồi mới ngắm lại ⇒ có một khoảng mà tầng trên thấy controls ngắm về gốc.
    expect(iKhoi).toBeLessThan(iCongBo);
  });

  it("★★★ khôi phục xong phải `update()` — copy suông thì ma trận camera chưa đổi", () => {
    const i = MA.indexOf("controls.target.copy(mucRef.current)");
    const doan = MA.slice(i, i + 200);
    expect(doan).toContain("controls.update()");
  });

  it("★★★ `mucRef` được GHI ở CẢ HAI nhánh của `useFrame` — không chỉ nhánh đang tween", () => {
    // Nhánh không tween là nhánh quan trọng hơn: sau khi tween xong, đó là nhánh duy nhất chạy.
    const soLanGhi = [...MA.matchAll(/mucRef\.current \?\?= new THREE\.Vector3\(\)/g)].length;
    expect(soLanGhi).toBeGreaterThanOrEqual(2);
  });

  it("★ `mucRef` khởi tạo `null` — KHÔNG phải `(0,0,0)`", () => {
    // Khởi tạo bằng gốc toạ độ thì khối khôi phục sẽ ngắm về gốc ngay lần dựng ĐẦU TIÊN,
    // tức là tự tay cài đúng khuyết tật đang vá.
    expect(MA).toContain("const mucRef = useRef<THREE.Vector3 | null>(null);");
  });
});
