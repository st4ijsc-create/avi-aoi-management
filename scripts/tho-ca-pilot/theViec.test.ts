import { describe, it, expect } from "vitest";
import { docTheViec, docGioiHan, kiemDiffTheoThe, chuanDuong, vungCamCua, mucVungCam } from "./theViec";

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

describe("vùng cấm theo ĐOẠN THƯ MỤC, không theo chuỗi con tên tệp (TC-02: stateVocabulary.edge.test.ts bị gắn nhãn vung-cam)", () => {
  it("★ tên tệp ngoài server/shared chứa edge / robot / socket / device / stop… ⇒ KHÔNG phải vùng cấm", () => {
    for (const p of ["client/src/lib/stateVocabulary.edge.test.ts", "client/src/lib/robotArm.ts", "client/src/lib/socketClient.ts", "client/src/lib/deviceList.ts", "client/src/lib/stopwatch.ts", "client/src/lib/secretsMask.ts", "scripts/tho-ca-pilot/edgeCase.test.ts"]) {
      expect(vungCamCua(p), p).toBeNull();
    }
  });
  it("★ tệp ngoài thẻ mang chữ 'edge' ở client ⇒ nhãn ngoai-danh-sach (không phải vung-cam)", () => {
    expect(kiemDiffTheoThe(["client/src/lib/stateVocabulary.edge.test.ts"], ["client/src/lib/stateVocabulary.unit.test.ts"])).toEqual([
      { duong: "client/src/lib/stateVocabulary.edge.test.ts", loai: "ngoai-danh-sach" },
    ]);
  });
  it("★ THƯ MỤC cấm vẫn MẠNH ở mọi nơi: server/services/edge/**, server/edge/**, client/src/robot/**, …/ot/**, drizzle/, auth/", () => {
    for (const p of ["server/services/edge/x.ts", "server/edge/y.ts", "client/src/robot/z.ts", "server/services/ot/a.ts", "drizzle/0450.sql", "server/auth/b.ts", "client/src/devices/c.ts", "server/services/interlock/d.ts", ".env", "x/key.pem"]) {
      expect(mucVungCam(p)?.muc, p).toBe("manh");
    }
  });
  it("★ backend: socket*/auth*/trpc*/accessControl* là MẠNH; tên tệp mờ (stop, edge, robot…) ở server/shared là MỜ", () => {
    for (const p of ["server/_core/socket.ts", "server/_core/trpc.ts", "server/db/auth.ts", "shared/accessControl.ts"]) expect(mucVungCam(p)?.muc, p).toBe("manh");
    for (const p of ["server/services/foe/foeStopHangMoi.ts", "server/utils/edgeCase.ts", "server/utils/robotHelper.ts"]) expect(mucVungCam(p)?.muc, p).toBe("mo");
  });
  it("★ khớp MỜ: ngoài thẻ ⇒ ngoai-danh-sach (kèm giải thích); trong thẻ ⇒ vung-cam; MẠNH luôn vung-cam", () => {
    expect(kiemDiffTheoThe(["server/utils/edgeCase.ts"], ["server/utils/a.ts"])).toEqual([
      { duong: "server/utils/edgeCase.ts", loai: "ngoai-danh-sach", chiTiet: expect.stringContaining("khớp mờ") },
    ]);
    expect(kiemDiffTheoThe(["server/utils/edgeCase.ts"], ["server/utils/edgeCase.ts"]).map((v) => v.loai)).toEqual(["vung-cam"]);
    expect(kiemDiffTheoThe(["server/services/edge/x.ts"], ["server/utils/a.ts"]).map((v) => v.loai)).toEqual(["vung-cam"]);
    expect(kiemDiffTheoThe(["server/services/edge/x.ts"], ["server/services/edge/x.ts"]).map((v) => v.loai)).toEqual(["vung-cam"]);
  });
  it("thẻ cho phép tệp có chữ edge ở client ⇒ hợp lệ (không còn bị từ chối oan); thẻ cho server/edge ⇒ từ chối", () => {
    const the = (t: string) => docTheViec(`MÃ: T1\nMỤC TIÊU: x\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${t}\nLỆNH KIỂM: npx vitest run a.unit.test.ts`);
    expect(the("client/src/lib/stateVocabulary.edge.unit.test.ts").ok).toBe(true);
    expect(the("server/services/edge/x.ts").ok).toBe(false);
    expect(the("server/utils/edgeCase.ts").ok).toBe(false);
  });
});
