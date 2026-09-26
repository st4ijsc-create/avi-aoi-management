/**
 * LƯỚI vị từ chặn thẻ duyệt hiện sai chế độ. Hàng rào cuối trước khi người dùng lỡ tay ghi lên
 * SERVER trong khi tưởng đang ở LOCAL — xem docblock `kiemTraCheDo.ts` để biết vì sao trường hợp
 * này "không nên xảy ra" nhưng vẫn phải chặn.
 */
import { describe, it, expect } from "vitest";
import { coDuocHienTheDuyet, suyCheDo } from "./kiemTraCheDo";
import { gopDanhSachDuAn } from "./duAn";

describe("coDuocHienTheDuyet", () => {
  it("★★★ chế độ SERVER ⇒ được hiện thẻ duyệt", () => {
    expect(coDuocHienTheDuyet("server")).toBe(true);
  });

  it("★★★ chế độ LOCAL ⇒ KHÔNG được hiện thẻ duyệt", () => {
    expect(coDuocHienTheDuyet("local")).toBe(false);
  });
});

/**
 * ★★★ I-5 — "KHÔNG BIẾT" KHÔNG ĐƯỢC DỊCH THÀNH "LOCAL".
 *
 * LOCAL là chế độ mà EXTENSION tự cưỡng chế (máy chủ không với tới đĩa máy dev) và là chế độ MỞ
 * CỬA cho một lượt ghi vào máy người dùng. Rơi-về-LOCAL ở trạng thái không xác định là chọn đúng
 * nhánh có hậu quả nặng nhất.
 */
describe("suyCheDo — fail-closed khi KHÔNG xác định được chế độ", () => {
  const ds = gopDanhSachDuAn(["C:\\ws"], [{ id: "p1", name: "Demo Csharp" }]);

  it("★★★ danh sách RỖNG (chưa nạp xong / nạp hỏng) ⇒ undefined — KHÔNG rơi về LOCAL", () => {
    expect(suyCheDo([], undefined)).toBeUndefined();
    expect(suyCheDo([], "local:C:\\ws")).toBeUndefined();
  });

  it("★★★ `duAnChon` KHÔNG khớp mục nào (desync) ⇒ undefined — KHÔNG rơi về mục đầu", () => {
    // Bản cũ `find(...) ?? ds[0]` khai "LOCAL · C:\\ws" cho một id không tồn tại.
    expect(suyCheDo(ds, "server:da-bi-xoa")).toBeUndefined();
    expect(suyCheDo(ds, "")).toBeUndefined();
  });

  it("★★★ chọn dự án SERVER ⇒ {loai:'server', projectId} — projectId bóc đúng tiền tố", () => {
    expect(suyCheDo(ds, "server:p1")).toEqual({ loai: "server", projectId: "p1", nhan: "SERVER · Demo Csharp" });
  });

  it("★★★ chọn thư mục LOCAL ⇒ {loai:'local'} với nhãn THẬT, không phải chữ 'workspace' trần", () => {
    const r = suyCheDo(ds, "local:C:\\ws");
    expect(r).toEqual({ loai: "local", nhan: "LOCAL · C:\\ws" });
  });

  it("★★ `duAnChon` chưa đặt NHƯNG danh sách có mục ⇒ suy theo mục ĐẦU TIÊN (đúng thứ ô chọn đang hiện)", () => {
    expect(suyCheDo(ds, undefined)).toEqual({ loai: "local", nhan: "LOCAL · C:\\ws" });
  });

  it("★★ danh sách CHỈ có dự án SERVER, `duAnChon` chưa đặt ⇒ SERVER, tuyệt đối không LOCAL", () => {
    const chiServer = gopDanhSachDuAn([], [{ id: "p9", name: "Chi Server" }]);
    expect(suyCheDo(chiServer, undefined)).toEqual({
      loai: "server",
      projectId: "p9",
      nhan: "SERVER · Chi Server",
    });
  });
});
