// @vitest-environment jsdom
//
// Đợt 9 — thẻ KIỂM BIÊN DỊCH ST (trợ lý + Cmd+K): đủ năm trạng thái, nút xem BẢN ĐẦU, chip compile_st của dòng thời gian tác nhân.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : k) }),
}));

vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div data-testid="streamdown">{p.children}</div> }));

import { KiemBienDichCard } from "./KiemBienDichCard";
import { docKetQuaCompileSt } from "./agent/DongThoiGianAgent";
import { thamSoChinh } from "./agent/trangThaiAgent";
import type { KbKiemBienDich } from "@/hooks/useKbChatStream";

afterEach(cleanup);

const ket = (p: Partial<NonNullable<KbKiemBienDich["ketQua"]>>): KbKiemBienDich => ({
  phase: "xong",
  ketQua: { trangThai: "sach", lyDo: null, phuongNgu: "st", soVong: 0, soLoiDaSua: 0, chanDoan: [], cauTraLoiDau: null, msThem: 5, ...p },
});

describe("KiemBienDichCard", () => {
  it("null ⇒ không vẽ gì (cờ tắt)", () => {
    const { container } = render(<KiemBienDichCard kiem={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dang-kiem ⇒ chỉ báo tiến trình, role=status", () => {
    render(<KiemBienDichCard kiem={{ phase: "dang-kiem" }} />);
    const e = screen.getByTestId("kiem-bien-dich");
    expect(e).toHaveAttribute("data-trang-thai", "dang-kiem");
    expect(e).toHaveAttribute("role", "status");
    expect(e).toHaveTextContent("Đang biên dịch thử mã ST");
  });

  it("sach ⇒ nhãn 'biên dịch sạch', không nút xem bản đầu", () => {
    render(<KiemBienDichCard kiem={ket({ trangThai: "sach" })} />);
    expect(screen.getByTestId("kiem-bien-dich")).toHaveTextContent("Biên dịch sạch");
    expect(screen.queryByTestId("kiem-bien-dich-xem-dau")).toBeNull();
  });

  it("da-sua ⇒ nhãn 'đã tự sửa K lỗi'; 'xem bản đầu' mở/đóng và hiện ĐÚNG bản đầu", () => {
    render(<KiemBienDichCard kiem={ket({ trangThai: "da-sua", soLoiDaSua: 3, soVong: 2, cauTraLoiDau: "BAN_DAU_SAI" })} />);
    expect(screen.getByTestId("kiem-bien-dich")).toHaveTextContent("Đã tự sửa 3 lỗi biên dịch (RuSTy) sau 2 vòng");
    expect(screen.queryByTestId("kiem-bien-dich-ban-dau")).toBeNull();
    fireEvent.click(screen.getByTestId("kiem-bien-dich-xem-dau"));
    expect(screen.getByTestId("kiem-bien-dich-ban-dau")).toHaveTextContent("BAN_DAU_SAI");
    fireEvent.click(screen.getByTestId("kiem-bien-dich-xem-dau"));
    expect(screen.queryByTestId("kiem-bien-dich-ban-dau")).toBeNull();
  });

  it("con-loi ⇒ 'còn N lỗi' + từng chẩn đoán theo dòng (tệp:dòng:cột error[mã]: thông điệp)", () => {
    render(
      <KiemBienDichCard
        kiem={ket({
          trangThai: "con-loi",
          soVong: 2,
          chanDoan: [
            { tep: "mã", dong: 4, cot: 3, ma: "E007", thongDiep: "Unexpected token" },
            { tep: "khối 2", dong: 9, cot: null, ma: null, thongDiep: "boom" },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("kiem-bien-dich")).toHaveTextContent("còn 2 lỗi biên dịch");
    const ds = screen.getByTestId("kiem-bien-dich-loi");
    expect(ds).toHaveTextContent("mã:4:3 error[E007]: Unexpected token");
    expect(ds).toHaveTextContent("khối 2:9:? error: boom");
  });

  it("khong-kiem-duoc ⇒ báo trung thực, kèm lý do hạ tầng", () => {
    render(<KiemBienDichCard kiem={ket({ trangThai: "khong-kiem-duoc", lyDo: "docker: ảnh vắng" })} />);
    expect(screen.getByTestId("kiem-bien-dich")).toHaveTextContent("Chưa kiểm biên dịch được (docker: ảnh vắng)");
  });
});

describe("compile_st trong dòng thời gian tác nhân", () => {
  it("thamSoChinh: path ưu tiên; code dán thẳng ⇒ dấu 'code' (không lộ nội dung)", () => {
    expect(thamSoChinh("compile_st", { path: "plc/main.st" })).toBe("plc/main.st");
    expect(thamSoChinh("compile_st", { code: "FUNCTION_BLOCK A END_FUNCTION_BLOCK" })).toBe("code");
    expect(thamSoChinh("compile_st", {})).toBe("");
  });
  it("docKetQuaCompileSt: đọc khoan dung hienThi {ok, soLoi}", () => {
    expect(docKetQuaCompileSt({ tool: "compile_st", ok: true, soLoi: 0 })).toEqual({ ok: true, soLoi: 0 });
    expect(docKetQuaCompileSt({ ok: false, soLoi: 3 })).toEqual({ ok: false, soLoi: 3 });
    expect(docKetQuaCompileSt({ ok: null })).toEqual({ ok: null, soLoi: 0 });
    expect(docKetQuaCompileSt(undefined)).toBeNull();
    expect(docKetQuaCompileSt("lạ")).toBeNull();
    expect(docKetQuaCompileSt({ x: 1 })).toBeNull();
  });
});
