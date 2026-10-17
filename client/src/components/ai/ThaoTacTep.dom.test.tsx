// @vitest-environment jsdom
//
// ★★★ Đợt 3b — NÚT TỆP: mỗi nút chỉ gọi MỘT callback đề xuất (trang dựng thẻ duyệt); kiểm đường gõ sai; khoá khi thiếu
// quyền hoặc chưa mở tệp; thư mục = <thư mục>/<tệp đầu>; nội dung khởi đầu không rỗng (apply_diff từ chối rỗng→rỗng).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { ThaoTacTep, kiemDuongTepMoi, noiDuong, noiDungTepMoi, type ThaoTacTepProps } from "./ThaoTacTep";

afterEach(cleanup);
const q = (c: HTMLElement, s: string) => c.querySelector(s) as HTMLElement | null;

function dung(p: Partial<ThaoTacTepProps> = {}) {
  const props: ThaoTacTepProps = {
    thuMucHienTai: "src",
    tepDangChon: "src/a.ts",
    coQuyen: true,
    dangBan: false,
    onTaoTep: vi.fn(),
    onDoiTen: vi.fn(),
    onXoa: vi.fn(),
    ...p,
  };
  return { ...render(<ThaoTacTep {...props} />), props };
}

describe("ThaoTacTep", () => {
  it("★★★ Tạo tệp: mặc định trong thư mục đang chọn; gửi ⇒ onTaoTep(đường, nội dung KHÔNG rỗng)", () => {
    const { container, props } = dung();
    fireEvent.click(q(container, "[data-nut-tao-tep]")!);
    const o = q(container, "[data-o-duong]") as HTMLInputElement;
    expect(o.value).toBe("src/");
    fireEvent.change(o, { target: { value: "src/b.ts" } });
    fireEvent.click(q(container, "[data-nut-de-xuat]")!);
    expect(props.onTaoTep).toHaveBeenCalledWith("src/b.ts", "\n");
    expect(q(container, "[data-form-tep]")).toBeNull();
  });

  it("★★ Tạo thư mục ⇒ <thư mục>/README.md với tiêu đề", () => {
    const { container, props } = dung({ thuMucHienTai: "" });
    fireEvent.click(q(container, "[data-nut-tao-thu-muc]")!);
    fireEvent.change(q(container, "[data-o-duong]")!, { target: { value: "docs/huong-dan" } });
    fireEvent.click(q(container, "[data-nut-de-xuat]")!);
    expect(props.onTaoTep).toHaveBeenCalledWith("docs/huong-dan/README.md", "# README\n");
  });

  it("★★★ đường xấu ('..', tuyệt đối) ⇒ câu lỗi + nút Đề xuất khoá, KHÔNG gọi callback", () => {
    const { container, props } = dung();
    fireEvent.click(q(container, "[data-nut-tao-tep]")!);
    for (const xau of ["../ngoai.ts", "C:/x.ts", "/etc/passwd", "a/./b.ts"]) {
      fireEvent.change(q(container, "[data-o-duong]")!, { target: { value: xau } });
      expect(q(container, "[data-loi-duong]"), xau).not.toBeNull();
      expect(q(container, "[data-nut-de-xuat]")).toBeDisabled();
    }
    expect(props.onTaoTep).not.toHaveBeenCalled();
  });

  it("★★ Đổi tên ⇒ onDoiTen(tệp đang mở, đường mới); trùng tên cũ ⇒ khoá. Xoá ⇒ onXoa(tệp đang mở)", () => {
    const { container, props } = dung();
    fireEvent.click(q(container, "[data-nut-doi-ten-tep]")!);
    expect(q(container, "[data-nut-de-xuat]")).toBeDisabled();
    fireEvent.change(q(container, "[data-o-duong]")!, { target: { value: "src/c.ts" } });
    fireEvent.click(q(container, "[data-nut-de-xuat]")!);
    expect(props.onDoiTen).toHaveBeenCalledWith("src/a.ts", "src/c.ts");
    fireEvent.click(q(container, "[data-nut-xoa-tep]")!);
    expect(props.onXoa).toHaveBeenCalledWith("src/a.ts");
  });

  it("★★ thiếu quyền ⇒ mọi nút khoá; chưa mở tệp ⇒ Đổi tên/Xoá khoá", () => {
    const a = dung({ coQuyen: false });
    for (const s of ["[data-nut-tao-tep]", "[data-nut-tao-thu-muc]", "[data-nut-doi-ten-tep]", "[data-nut-xoa-tep]"]) expect(q(a.container, s)).toBeDisabled();
    cleanup();
    const b = dung({ tepDangChon: null });
    expect(q(b.container, "[data-nut-tao-tep]")).not.toBeDisabled();
    expect(q(b.container, "[data-nut-doi-ten-tep]")).toBeDisabled();
    expect(q(b.container, "[data-nut-xoa-tep]")).toBeDisabled();
  });

  it("hàm thuần", () => {
    expect(kiemDuongTepMoi("a/b.ts")).toBe("ok");
    expect(kiemDuongTepMoi("")).toBe("rong");
    expect(kiemDuongTepMoi("a/")).toBe("rong");
    expect(kiemDuongTepMoi("a\\..\\b")).toBe("thoat");
    expect(kiemDuongTepMoi("a?.ts")).toBe("ky_tu");
    expect(noiDuong("", "x.ts")).toBe("x.ts");
    expect(noiDuong("src/", "/x.ts")).toBe("src/x.ts");
    expect(noiDungTepMoi("a/b.json")).toBe("{}\n");
    expect(noiDungTepMoi("Ghi-chu.MD")).toBe("# Ghi-chu\n");
  });
});
