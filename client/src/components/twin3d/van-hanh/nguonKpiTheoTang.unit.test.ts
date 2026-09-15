/**
 * nguonKpiTheoTang.unit.test.ts — ★★★ QA lần 11 · PH-06.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LỖI NẰM Ở **CHỖ GỌI**, KHÔNG Ở HÀM — NÊN LƯỚI PHẢI ĐO CHỖ GỌI
 * ════════════════════════════════════════════════════════════════════════════
 * `tinhKpiNoi(may, chuaDo)` vốn đúng: mẫu số của nó luôn bằng `may.length`
 * (`kpiNoiLogic.unit.test.ts` ghim). Thứ sai là **đầu vào**: `TwinVanHanh.tsx`
 * truyền `mayKpi` — tập của CẢ NHÀ MÁY — trong khi bảng in nhãn phạm vi chạy
 * tới cấp TẦNG. Đo được (PH-06, ảnh `AB-B4-qatd_giamdoc-tang3-trong.png`):
 * tầng 3 có 0 máy, cảnh vẽ **0 khối**, bảng vẫn nói **371 machines · Running
 * 261 · Machines w/ andon 15**.
 *
 * ★★★ GỐC RỄ (tự đọc mã, không nhận lời khai):
 *   `PHAM_VI_MAC_DINH = { cap: "tang", id: null }` (`TwinVanHanh.tsx:275`).
 *   · `dungBreadcrumb` chạy tới `pv.cap` ⇒ **3 mắt xích**, mắt cuối là "Floor"
 *     — nhãn KHAI tới cấp tầng.
 *   · `phamViCanhBao` lại mở đầu bằng `if (phamVi.id === null … ) return null`
 *     ⇒ **KHÔNG lọc gì**, `mayKpi` giữ nguyên 371 máy.
 *   Hai đường cùng đọc `phamVi` mà cho hai phạm vi khác nhau: đúng lớp G12.
 *
 * ⚠ VÌ SAO LÀ LƯỚI VĂN BẢN: `TwinVanHanh.tsx` là trang 3.800 dòng kéo theo
 *   R3F + tRPC + i18next; dựng nó trong jsdom để đọc một `useMemo` là đổi một
 *   phép đo nhỏ lấy một bộ khung mock khổng lồ (và mock chính là chỗ lời khai
 *   chui vào). Phần HÀNH VI đã được đo thật ở `kpiNoiLogic.unit.test.ts`
 *   (`locKpiTheoCanh` + `tinhKpiNoi`); tệp này chỉ đo **dây đã nối hay chưa**.
 *   Nửa còn lại — số khối thật trên cảnh — thuộc cổng Playwright.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(import.meta.dirname, "../../../..");
const TRANG = resolve(GOC, "src/pages/TwinVanHanh.tsx");

describe("★★★ PH-06 — nguồn máy cho bảng KPI phải là máy CẢNH ĐANG VẼ", () => {
  const nguon = docMaNguon(TRANG);

  it("dữ kiện nền: đọc được tệp trang và nó là trang Vận hành (không đo trên chuỗi rỗng)", () => {
    expect(nguon.length).toBeGreaterThan(50_000);
    expect(nguon).toContain("const mayKpi = useMemo<MayTongQuanKpi[]>");
    expect(nguon).toContain("<BangKpiNoi");
  });

  it("★★★ tinhKpiNoi KHÔNG được nhận thẳng tập máy của cả nhà máy", () => {
    expect(nguon).not.toMatch(/tinhKpiNoi\(\s*mayKpi\s*,/);
  });

  it("★★★ tinhKpiNoi nhận tập đã lọc theo tầng", () => {
    expect(nguon).toMatch(/tinhKpiNoi\(\s*mayKpiTang\s*,/);
  });

  it("★★★ tập lọc theo tầng được dựng từ danh sách máy VẼ TRONG CẢNH", () => {
    expect(nguon).toMatch(/const mayKpiTang\s*=/);
    // `mayVeTatCa` là TÊN THẬT của tập máy cảnh 3D/2D vẽ (`may={mayVeTatCa}` ở
    // cả `CanhVanHanh` và `CanhVanHanh2D`) — kế hoạch đoán tên `mayVeTrongCanh`,
    // trong tệp KHÔNG có biến nào tên như vậy.
    expect(nguon).toMatch(/const idMayTrongCanh\s*=[\s\S]{0,600}?mayVeTatCa/);
    expect(nguon).toMatch(/locKpiTheoCanh\(\s*mayKpi\s*,\s*idMayTrongCanh\s*\)/);
  });

  it("★ tập cảnh vẫn là tập MÀ CẢNH THẬT SỰ NHẬN — hai chỗ gọi `may={mayVeTatCa}`", () => {
    const soChoGoi = [...nguon.matchAll(/may=\{mayVeTatCa\}/g)].length;
    expect(soChoGoi).toBe(2); // CanhVanHanh (3D) + CanhVanHanh2D
  });

  it("★ CHƯA BIẾT CẢNH ⇒ `null`, không phải `new Set()` — không được làm bảng câm khi 403", () => {
    // `canhQ.data == null` ⇒ `idMayTrongCanh = null` ⇒ `locKpiTheoCanh` trả
    // nguyên tập. Viết `new Set()` ở nhánh ấy sẽ cho mẫu số 0 và bảng in `—`
    // đúng ca docblock `kpiChuaDo` bảo vệ.
    expect(nguon).toMatch(/if \(canhQ\.data == null\) return null;/);
  });

  it("★ nhãn phạm vi của bảng KPI phải nói về TẬP ĐƯỢC ĐO, không phải breadcrumb", () => {
    // Breadcrumb dừng ở `phamVi.cap` và có thể KHÔNG nhắc tới toà/tầng đang nạp
    // (`?pv=tapdoan` bị hạ cấp ⇒ "Corporate · Công ty A" trong khi cảnh chỉ vẽ
    // MỘT tầng của MỘT toà) — dùng nó làm nhãn là tái lập PH-06 theo chiều ngược.
    expect(nguon).not.toMatch(/nhanPhamVi=\{breadcrumb\.map/);
    expect(nguon).toMatch(/nhanPhamVi=\{nhanPhamViKpi\}/);
    expect(nguon).toMatch(/const nhanPhamViKpi\s*=/);
  });
});
