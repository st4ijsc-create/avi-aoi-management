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

import { quetChamDb, tepTestTrongLenh } from "./theViec";

describe("quetChamDb — quét NỘI DUNG (luật 2026-11-02), không chỉ tên .db.test", () => {
  it("★ test tên thường nhưng import getDb / postgres / drizzle / db/* / mock db / DATABASE_URL ⇒ chạm DB", () => {
    const co = (s: string) => quetChamDb("x.test.ts", s).length > 0;
    expect(co(`import { getDb } from "../db/connection";`)).toBe(true);
    expect(co("const x = await getDb();")).toBe(true); // chỉ getDb, không import đường db
    expect(co(`import postgres from "postgres";`)).toBe(true);
    expect(co(`import { eq } from 'drizzle-orm';`)).toBe(true);
    expect(co(`import * as d from "../../server/db";`)).toBe(true);
    expect(co(`vi.mock("../db/connection", () => ({}));`)).toBe(true);
    expect(co(`const u = process.env.DATABASE_URL;`)).toBe(true);
    expect(co(`await db.delete(users).where(x)`)).toBe(true);
    expect(co(`const m = await import("postgres");`)).toBe(true);
  });
  it("tên .db.test luôn là DB; test thuần không dấu hiệu ⇒ sạch", () => {
    expect(quetChamDb("a.db.test.ts", "")).toEqual(["tên .db.test"]);
    expect(quetChamDb("a.test.ts", `import { it, expect } from "vitest";\nimport { relativeTime } from "./relativeTime";\nit("x", () => expect(relativeTime(0, 1)).toBe("now"));`)).toEqual([]);
    expect(quetChamDb("a.test.ts", `import { tinhDb } from "./dbHelper";`)).toEqual([]); // "db" nằm trong tên khác, không phải thư mục db
  });
  it("tepTestTrongLenh lấy đường test trong lệnh kiểm", () => {
    expect(tepTestTrongLenh("npx vitest run client/src/lib/a.test.ts server\\b.test.tsx --reporter=dot")).toEqual(["client/src/lib/a.test.ts", "server/b.test.tsx"]);
    expect(tepTestTrongLenh("npm test")).toEqual([]);
  });
});
