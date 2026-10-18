// @vitest-environment jsdom
//
// ★★ Đợt 3b — ĐẶT / ĐỔI TÊN PHIÊN trong ruột bộ chọn phiên: bút ⇒ ô tên (gieo tên cũ) ⇒ Enter/Lưu ⇒ onDoiTen(id, tên);
// Esc ⇒ huỷ; vắng `onDoiTen` ⇒ không có bút (tương thích ngược); tìm phiên theo tên vẫn chạy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k, i18n: { language: "vi" } }) }));

import { NoiDungBoChonPhien } from "./BoChonPhien";

afterEach(cleanup);
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLElement | null;
const P = [
  { id: "p1", title: "Chạy git status", turnCount: 2, updatedAt: "2026-10-17T00:00:00Z" },
  { id: "p2", title: "Sửa đăng nhập", turnCount: 4, updatedAt: "2026-10-16T00:00:00Z" },
];

function dung(onDoiTen?: (id: string, ten: string) => void, tuKhoa = "") {
  return render(
    <NoiDungBoChonPhien phien={P} dangChon="p1" dangTai={false} biTuChoi={false} tuKhoa={tuKhoa} onDoiTuKhoa={vi.fn()} onChon={vi.fn()} onXoa={vi.fn()} onDoiTen={onDoiTen} />,
  );
}

describe("Bộ chọn phiên — đổi tên", () => {
  it("★★★ bút ⇒ ô tên gieo tên cũ ⇒ Lưu ⇒ onDoiTen(id, tên mới)", () => {
    const onDoiTen = vi.fn();
    const { container } = dung(onDoiTen);
    fireEvent.click(q(container, '[data-nut-doi-ten-phien="p2"]')!);
    const o = q(container, "[data-o-ten-phien]") as HTMLInputElement;
    expect(o.value).toBe("Sửa đăng nhập");
    fireEvent.change(o, { target: { value: "Sửa đăng nhập SSO" } });
    fireEvent.click(q(container, "[data-nut-luu-ten-phien]")!);
    expect(onDoiTen).toHaveBeenCalledWith("p2", "Sửa đăng nhập SSO");
    expect(q(container, "[data-o-ten-phien]")).toBeNull();
  });

  it("★★ Esc ⇒ huỷ, không gọi; vắng onDoiTen ⇒ không có bút", () => {
    const onDoiTen = vi.fn();
    const { container } = dung(onDoiTen);
    fireEvent.click(q(container, '[data-nut-doi-ten-phien="p1"]')!);
    fireEvent.keyDown(q(container, "[data-o-ten-phien]")!, { key: "Escape" });
    expect(q(container, "[data-o-ten-phien]")).toBeNull();
    expect(onDoiTen).not.toHaveBeenCalled();
    cleanup();
    const b = dung(undefined);
    expect(q(b.container, "[data-nut-doi-ten-phien]")).toBeNull();
  });

  it("tìm phiên theo tên vẫn lọc (tên đặt tay tìm được)", () => {
    const { container } = dung(vi.fn(), "đăng nhập");
    expect(container.querySelectorAll("[data-hang-phien]").length).toBe(1);
  });
});
