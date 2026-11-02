import { describe, it, expect } from "vitest";
import { docTheViec, docGioiHan, kiemDiffTheoThe, chuanDuong, vungCamCua } from "./theViec";

const THE = `MÃ: TC-01
MỤC TIÊU: viết unit test cho relativeTime
TỆP ĐƯỢC PHÉP SỬA/TẠO: client/src/lib/relativeTime.test.ts
NGỮ CẢNH ĐỌC:
- client/src/lib/relativeTime.ts
LỆNH KIỂM: npx vitest run client/src/lib/relativeTime.test.ts
GIỚI HẠN: 10 phút, 8 vòng`;

describe("docTheViec", () => {
  it("đọc thẻ đủ trường (khoá có/không dấu, danh sách gạch đầu dòng)", () => {
    const r = docTheViec(THE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.the.ma).toBe("TC-01");
    expect(r.the.tepDuocPhep).toEqual(["client/src/lib/relativeTime.test.ts"]);
    expect(r.the.nguCanhDoc).toEqual(["client/src/lib/relativeTime.ts"]);
    expect(r.the.lenhKiem).toBe("npx vitest run client/src/lib/relativeTime.test.ts");
    expect(r.the.gioiHan).toEqual({ giay: 600, vong: 8 });
    expect(docTheViec(THE.replace("MÃ:", "MA:").replace("MỤC TIÊU:", "MUC TIEU:")).ok).toBe(true);
  });
  it("★ thiếu trường bắt buộc ⇒ từ chối, nói rõ trường nào", () => {
    expect(docTheViec(THE.replace(/^MÃ:.*\n/, ""))).toMatchObject({ ok: false });
    expect(docTheViec(THE.replace(/^TỆP ĐƯỢC PHÉP.*\n/m, ""))).toMatchObject({ ok: false, loi: expect.stringContaining("TỆP") });
    expect(docTheViec(THE.replace(/^LỆNH KIỂM:.*\n/m, ""))).toMatchObject({ ok: false, loi: expect.stringContaining("LỆNH KIỂM") });
  });
  it("★ thẻ cho phép tệp VÙNG CẤM / thoát worktree / ký tự đại diện giữa đường ⇒ từ chối", () => {
    for (const xau of ["server/services/ot/commandDispatcher.ts", "drizzle/0450_x.sql", "server/_core/socket.ts", "../ngoai.ts", "/etc/passwd", "C:\\x.ts", "a/*/b.ts", ".env"]) {
      const r = docTheViec(THE.replace("client/src/lib/relativeTime.test.ts\nNGỮ", `${xau}\nNGỮ`));
      expect(r.ok, xau).toBe(false);
    }
  });
  it("MÃ có ký tự lạ (dùng để đặt tên nhánh) ⇒ từ chối", () => {
    expect(docTheViec(THE.replace("TC-01", "TC 01;rm -rf")).ok).toBe(false);
  });
});

describe("docGioiHan", () => {
  it("mặc định và kẹp trần", () => {
    expect(docGioiHan(undefined)).toEqual({ giay: 900, vong: 12 });
    expect(docGioiHan("999 phút, 999 vòng")).toEqual({ giay: 3600, vong: 40 });
    expect(docGioiHan("45 giây")).toEqual({ giay: 45, vong: 12 });
  });
});

describe("kiemDiffTheoThe — chỉ sửa tệp được phép", () => {
  const phep = ["client/src/lib/a.test.ts", "client/src/i18n/locales/*", "tai-lieu/**"];
  it("đúng danh sách ⇒ 0 vi phạm (kể cả dir/* và dir/**)", () => {
    expect(kiemDiffTheoThe(["client/src/lib/a.test.ts", "client/src/i18n/locales/vi.json", "tai-lieu/x/y.md"], phep)).toEqual([]);
  });
  it("★ tệp ngoài danh sách ⇒ ngoai-danh-sach; dir/* không ăn thư mục con", () => {
    expect(kiemDiffTheoThe(["client/src/lib/b.ts", "client/src/i18n/locales/sub/x.json"], phep).map((v) => v.loai)).toEqual(["ngoai-danh-sach", "ngoai-danh-sach"]);
  });
  it("★ vùng cấm bị đánh dấu DÙ có trong danh sách phép (phòng thẻ sai)", () => {
    const v = kiemDiffTheoThe(["server/services/ot/x.ts", "drizzle/0450.sql", "server/_core/socket.ts", ".env"], ["server/services/ot/x.ts", "drizzle/**", "server/_core/socket.ts", ".env"]);
    expect(v.map((x) => x.loai)).toEqual(["vung-cam", "vung-cam", "vung-cam", "vung-cam"]);
  });
  it("đường không hợp lệ (.. / tuyệt đối) ⇒ duong-khong-hop-le", () => {
    expect(kiemDiffTheoThe(["../x.ts", "/abs.ts"], phep).map((v) => v.loai)).toEqual(["duong-khong-hop-le", "duong-khong-hop-le"]);
  });
  it("chuanDuong & vungCamCua cơ bản", () => {
    expect(chuanDuong("./a\\b/c.ts")).toBe("a/b/c.ts");
    expect(chuanDuong("a/../b")).toBeNull();
    expect(vungCamCua("client/src/lib/relativeTime.ts")).toBeNull();
    expect(vungCamCua("server/db/auth.ts")).toBe("auth/quyen");
  });
});
