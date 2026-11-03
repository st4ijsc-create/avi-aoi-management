// @vitest-environment jsdom
//
// kiem-dinh m6 — TruongTotp: ô mã bị XOÁ (lỗi mã ⇒ nhập mã MỚI) đưa tiêu điểm về ô; nếu ô còn KHOÁ (đang gửi) thì ĐỢI mở lại rồi mới focus.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { TruongTotp } from "./TruongLyDo";

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_, true, true);
  await i18next.changeLanguage("vi");
});
afterEach(cleanup);

const o = () => screen.getByLabelText(vi_.scada.kenh.dialog.totp) as HTMLInputElement;
const dung = (value: string, disabled?: boolean) => <TruongTotp id="m6" value={value} onChange={() => undefined} disabled={disabled} />;

describe("TruongTotp — tiêu điểm khi ô bị xoá", () => {
  it("ô xoá khi KHÔNG khoá ⇒ focus ngay", () => {
    const { rerender } = render(dung("123456"));
    o().blur();
    rerender(dung(""));
    expect(o()).toHaveFocus();
  });

  it("★ ô xoá khi còn KHOÁ ⇒ chưa focus; mở khoá ⇒ mới focus", () => {
    const { rerender } = render(dung("123456", true));
    rerender(dung("", true));
    expect(o()).not.toHaveFocus();
    rerender(dung("", false));
    expect(o()).toHaveFocus();
  });

  it("không xoá (đổi giá trị khác rỗng, hoặc mở khoá mà ô chưa từng bị xoá) ⇒ không cướp tiêu điểm", () => {
    const { rerender } = render(dung("123", true));
    rerender(dung("1234", false));
    expect(o()).not.toHaveFocus();
    rerender(dung("1234", true));
    rerender(dung("1234", false));
    expect(o()).not.toHaveFocus();
  });
});
