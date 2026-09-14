// @vitest-environment jsdom
//
/**
 * ĐỢT 15 LÔ R — **P-3: LUẬT ẨN-KHÔNG-DISABLE, VI PHẠM CUỐI CÙNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT ĐANG ĐO
 * ══════════════════════════════════════════════════════════════════════════════
 * `nganXuLyLogic.ts:102-111`: **thiếu QUYỀN ⇒ ẨN; bị chặn TẠM THỜI ⇒ disable +
 * giải thích.** Hai trục tách hẳn nhau (`duocPhep` ≠ `lyDoChan`,
 * `nganXuLyLogic.ts:93-99`).
 *
 * Bảng đo §12b.1.3 của spec liệt kê 9 phần tử; 8 phần tử theo đúng luật, và
 * **`RobotCockpit.tsx` "Lưu vào project robot-tm"** là **vi phạm DUY NHẤT** —
 * nút vẫn render, chỉ `disabled` + `title`. Nó **với tới được từ `/twin`** qua
 * ngăn nhúng, nên nó nằm trong phạm vi đợt này.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHIỀU — VÌ MỘT BẢN VÁ "ẨN LUÔN" CŨNG LÀM CHIỀU (−) XANH
 * ══════════════════════════════════════════════════════════════════════════════
 *   (−) KHÔNG có quyền  ⇒ nút **KHÔNG CÓ TRONG DOM** (không phải "có mà mờ")
 *   (+) CÓ quyền        ⇒ nút **CÓ**, và **bấm được** (không `disabled`)
 *
 * Thiếu chiều (+) thì `return null` vô điều kiện xanh hoàn hảo mà đã giết chức
 * năng cho cả người có quyền — đúng lớp lỗi "vá quá tay thành chặn tất cả".
 *
 * ★ Ô thứ ba tách **QUYỀN** khỏi **TRẠNG THÁI**: khi có quyền mà đang `saving`,
 *   nút vẫn PHẢI hiện (chỉ `disabled`) — nếu bản vá gộp hai trục lại và ẩn luôn
 *   lúc đang lưu, người dùng mất phản hồi thị giác giữa chừng.
 *
 * ★ G20 — import CHÍNH `RobotCockpit.tsx` của module giao hàng (`TeachJogBuffer`
 *   được xuất riêng cho lưới này; nó là ĐÚNG hàm mà `RobotCockpit` render ở
 *   `:833`, không phải một bản chép).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// `TeachJogPanel` kéo theo cả cây jog/OT; lưới này chỉ đo QUYẾT ĐỊNH RENDER của
// nút lưu, nên thay nó bằng một ô trống. Mọi thứ khác của module giao hàng giữ
// nguyên (G20 — không mock chính thứ đang đo).
vi.mock("@/components/engineering/TeachJogPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="teach-jog-panel" />,
  TeachJogPanel: () => <div data-testid="teach-jog-panel" />,
}));

// ⚠ `RobotCockpit` kéo theo `LanguageSwitcher` → `i18n/index.ts`, nơi gọi
//   `.use(initReactI18next)` ở tầng module. Mock thiếu ô ấy thì tệp CHẾT LÚC
//   NẠP và lưới báo "0 test" — xanh-giả kiểu tệ nhất (không ô nào chạy mà cũng
//   không ô nào đỏ). Nên mock phải mang đủ cả `initReactI18next`.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, d?: string) => d ?? _k,
    i18n: { language: "vi", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

import { TeachJogBuffer } from "./RobotCockpit";

const NHAN_NUT = "Lưu vào project robot-tm";

function ve(canSave: boolean, saving = false) {
  return render(
    <TeachJogBuffer
      value="// tmscript"
      onChange={() => {}}
      onSave={() => {}}
      canSave={canSave}
      saving={saving}
    />,
  );
}

describe("P-3 — `RobotCockpit` nút lưu teach buffer theo luật ẩn-không-disable", () => {
  beforeEach(() => cleanup());

  it("★★★ CHIỀU (−) — KHÔNG có quyền ⇒ nút KHÔNG CÓ TRONG DOM (không phải 'có mà mờ')", () => {
    ve(false);
    // ⚠ `queryByRole` chứ không `toBeDisabled`: đo SỰ VẮNG MẶT, vì "hiện rồi
    //   chặn" chính là hình dạng đang phải loại bỏ.
    expect(screen.queryByRole("button", { name: NHAN_NUT })).toBeNull();
  });

  it("★★★ CHIỀU (+) — CÓ quyền ⇒ nút CÓ, và KHÔNG bị disable", () => {
    // Đối chứng bắt buộc: `return null` vô điều kiện làm ô trên xanh hoàn hảo.
    ve(true);
    const nut = screen.getByRole("button", { name: NHAN_NUT });
    expect(nut).toBeTruthy();
    expect((nut as HTMLButtonElement).disabled).toBe(false);
  });

  it("★★★ QUYỀN ≠ TRẠNG THÁI — có quyền + đang lưu ⇒ VẪN HIỆN, chỉ `disabled`", () => {
    // Vế thứ hai của luật. Nếu bản vá gộp hai trục và ẩn luôn lúc `saving`,
    // người dùng mất phản hồi thị giác giữa chừng — và ô này bắt được.
    ve(true, true);
    const nut = screen.getByRole("button", { name: NHAN_NUT });
    expect(nut).toBeTruthy();
    expect((nut as HTMLButtonElement).disabled).toBe(true);
  });

  it("phần XEM buffer giữ nguyên cho MỌI vai — bản vá không được cắt mất chức năng đọc", () => {
    // `RobotCockpit` là màn KHÔNG ĐƯỢC XOÁ và có người dùng ngoài Twin: ẩn nút
    // GHI không được kéo theo phần ĐỌC.
    ve(false);
    expect(screen.getByTestId("teach-jog-panel")).toBeTruthy();
    expect(screen.getByText("// tmscript")).toBeTruthy();
  });
});
