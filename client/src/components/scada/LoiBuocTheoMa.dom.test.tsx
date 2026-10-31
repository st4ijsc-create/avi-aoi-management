// @vitest-environment jsdom
//
// C2 — lỗi BƯỚC orchestration dạng MÃ ⇒ câu dịch (vi/en/zh THẬT). Mã đứng đầu chuỗi: chỉ-mã, kèm tham số, hoặc `MÃ: chi tiết` (kỹ sư).
// Mã không có câu dịch / văn bản không bắt đầu bằng mã ⇒ không hiện gì (như trước C2).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { LoiBuocTheoMa } from "./LoiBuocTheoMa";
import { maDauChuoiLoi } from "./nhanMaLoi";

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_, true, true);
  i18next.addResourceBundle("en", "translation", en_, true, true);
  i18next.addResourceBundle("zh", "translation", zh_, true, true);
  await i18next.changeLanguage("vi");
});
afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("vi");
});

const vi = vi_ as unknown as { scada: { orchestration: { maLoi: Record<string, string> } }; commandAudit: { maLoi: Record<string, string> } };

describe("maDauChuoiLoi", () => {
  it("lấy mã đứng đầu; không có mã ⇒ null", () => {
    expect(maDauChuoiLoi("FOE_OUTCOME_UNKNOWN")).toBe("FOE_OUTCOME_UNKNOWN");
    expect(maDauChuoiLoi("EDGE_OUTCOME_UNKNOWN(a,b): chi tiết")).toBe("EDGE_OUTCOME_UNKNOWN");
    expect(maDauChuoiLoi("TIMEOUT: connect ECONNREFUSED 10.0.0.5:502")).toBe("TIMEOUT");
    expect(maDauChuoiLoi("robotId required for robot command")).toBeNull();
    // mã GIỮA chuỗi không tính (kiem-dinh u26): chỉ mã đứng ĐẦU chuỗi lỗi
    expect(maDauChuoiLoi("step failed: TIMEOUT")).toBeNull();
    expect(maDauChuoiLoi("Parallel branch failed: FOE_OUTCOME_UNKNOWN: x")).toBeNull();
    expect(maDauChuoiLoi(null)).toBeNull();
    expect(maDauChuoiLoi(undefined)).toBeNull();
  });
});

describe("LoiBuocTheoMa", () => {
  it("★ dạng chỉ-mã (người bị che) ⇒ câu dịch, data-code", () => {
    render(<LoiBuocTheoMa error="FOE_OUTCOME_UNKNOWN" />);
    const p = screen.getByTestId("step-error-code");
    expect(p).toHaveAttribute("data-code", "FOE_OUTCOME_UNKNOWN");
    expect(p.textContent).toBe(vi.scada.orchestration.maLoi.FOE_OUTCOME_UNKNOWN);
  });

  it("mã dùng chung với màn lệnh (TIMEOUT) ⇒ câu của commandAudit.maLoi", () => {
    render(<LoiBuocTheoMa error="TIMEOUT" />);
    expect(screen.getByTestId("step-error-code").textContent).toBe(vi.commandAudit.maLoi.TIMEOUT);
  });

  it("kỹ sư: 'MÃ: chi tiết driver' ⇒ vẫn chỉ hiện câu dịch của mã, KHÔNG in chi tiết", () => {
    render(<LoiBuocTheoMa error="EDGE_OUTCOME_UNKNOWN(1,2): edge node E7 at 10.0.0.9 timed out" />);
    const p = screen.getByTestId("step-error-code");
    expect(p.textContent).toBe(vi.scada.orchestration.maLoi.EDGE_OUTCOME_UNKNOWN);
    expect(p.textContent).not.toMatch(/10\.0\.0\.9/);
  });

  it("mã không có câu / văn bản thường / null ⇒ không render", () => {
    const { container, rerender } = render(<LoiBuocTheoMa error="MA_LA_CHUA_BIET" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LoiBuocTheoMa error="robotId required for robot command" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LoiBuocTheoMa error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("en / zh: câu đổi theo ngôn ngữ, không còn chữ Việt", async () => {
    for (const lng of ["en", "zh"]) {
      await i18next.changeLanguage(lng);
      const { unmount } = render(<LoiBuocTheoMa error="REJECTED" />);
      const s = screen.getByTestId("step-error-code").textContent ?? "";
      expect(s).not.toBe(vi.scada.orchestration.maLoi.REJECTED);
      expect(s).not.toMatch(/[ạảãàáâấầẩẫậăắằẳẵặẹẻẽèéêếềểễệịỉĩìíọỏõòóôốồổỗộơớờởỡợụủũùúưứừửữựỳỵỷỹýđ]/i);
      unmount();
    }
  });
});
