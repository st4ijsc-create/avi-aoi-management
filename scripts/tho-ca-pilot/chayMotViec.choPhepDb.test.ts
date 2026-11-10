import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chayMotViec, ghepLenh, kiemChoPhepDb, thamSoDbTuDongLenh, type Driver } from "./chayMotViec";
import { docTheViec } from "./theViec";
import { ENV_DB_CHET, envSachChoTienTrinhCon, taoChayLenhKiem, type ChayKiem } from "./kiemChung";

const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();

const URL_TEST = "postgresql://avi_app:matkhau@127.0.0.1:5434/aoi_management_test";
const TEP_DB = "server/db/statisticsScope.test.ts";
const DONG_CSDL = "CSDL: chạm aoi_management_test (CHỈ CSDL _test; mọi ghi nằm trong giao dịch ROLLBACK; bộ chạy chạy với --cho-phep-db)";
const the = (csdl: string | null = DONG_CSDL) => `MÃ: TC-97
MỤC TIÊU: chuyển test DB sang giao dịch hoàn tác
TỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP_DB}
${csdl ? `${csdl}\n` : ""}LỆNH KIỂM: npx vitest run ${TEP_DB}
GIỚI HẠN: 1 phút, 3 vòng`;

const TEST_MOI = `import { it } from "vitest";\nit("x", () => {});\n`;
const chayKiemXanh: ChayKiem = async (lenh) => ({
  lenh,
  exit: 0,
  hetGio: false,
  giay: 1,
  duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 1, hong: 0, boQua: 0, tong: 1 } },
});

let goc: string;
let wt: string;
let ra: string;

beforeEach(() => {
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "tcd-"));
  wt = path.join(goc, "_tho_ca_wt_thu");
  ra = path.join(goc, "ra");
  fs.mkdirSync(path.join(wt, "server/db"), { recursive: true });
  git(wt, "init", "-q");
  git(wt, "config", "user.email", "t@t");
  git(wt, "config", "user.name", "t");
  git(wt, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(wt, TEP_DB), `import { getDb } from "./connection";\nimport { it } from "vitest";\nit("cu", () => { void getDb; });\n`);
  git(wt, "add", ".");
  git(wt, "commit", "-q", "-m", "init");
});
afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

const chay = (over: Partial<Parameters<typeof chayMotViec>[0]> = {}) =>
  chayMotViec({ van: the(), wt, base: "HEAD", driver: "kho", ra, choPhepKhoRieng: true, luat: "# l\n", chayKiem: chayKiemXanh, khoGhi: { [TEP_DB]: TEST_MOI }, ...over });

describe("--cho-phep-db — mặc định TẮT", () => {
  it("★★★ không cờ ⇒ tệp test chạm DB vẫn bị TỪ CHỐI, dù thẻ có dòng CSDL và URL đúng", async () => {
    const r = await chay({ testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("pilot không chạy test DB");
    expect("choPhepDb" in r).toBe(false);
  });
  it("★★ choPhepDb:false tường minh cũng TẮT", async () => {
    const r = await chay({ choPhepDb: false, testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("tu-choi");
  });
});

describe("--cho-phep-db — nhánh tệp test CHƯA CÓ", () => {
  const TEP_MOI_DB = "server/db/moiTao.db.test.ts";
  const theMoi = () => the().split(TEP_DB).join(TEP_MOI_DB);
  it("★★★ LỆNH KIỂM trỏ tệp .db.test CHƯA tồn tại: không cờ ⇒ từ chối; có cờ đủ điều kiện ⇒ qua", async () => {
    const khong = await chay({ van: theMoi(), khoGhi: { [TEP_MOI_DB]: TEST_MOI } });
    expect(khong.ketCuc).toBe("tu-choi");
    expect(khong.loi).toContain("tệp .db.test");
    const co = await chay({ van: theMoi(), choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [TEP_MOI_DB]: TEST_MOI } });
    expect(co.ketCuc).toBe("xong");
  });
});

describe("--cho-phep-db — điều kiện 2: dòng CSDL của thẻ", () => {
  it("★★★ có cờ mà thẻ KHÔNG có dòng CSDL ⇒ từ chối", async () => {
    const r = await chay({ van: the(null), choPhepDb: true, testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("dòng CSDL");
  });
  it("★★★ dòng CSDL không nêu aoi_management_test ⇒ từ chối", async () => {
    const r = await chay({ van: the("CSDL: chạm cơ sở dữ liệu"), choPhepDb: true, testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("aoi_management_test");
  });
  it("★★ dòng CSDL nêu CSDL khác (aoi_management) ⇒ từ chối", async () => {
    const r = await chay({ van: the("CSDL: chạm aoi_management"), choPhepDb: true, testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("tu-choi");
  });
});

describe("--cho-phep-db — điều kiện 3: URL CSDL của tiến trình", () => {
  it.each([
    ["thiếu URL", undefined],
    ["URL rác", "khong-phai-url"],
    ["đúng máy nhưng CSDL aoi_management (không _test)", "postgresql://avi_app:x@127.0.0.1:5434/aoi_management"],
    ["CSDL tên gần giống aoi_management_test2", "postgresql://avi_app:x@127.0.0.1:5434/aoi_management_test2"],
    ["owner aoi", "postgresql://aoi:x@127.0.0.1:5434/aoi_management_test"],
    ["owner AOI viết hoa", "postgresql://AOI:x@127.0.0.1:5434/aoi_management_test"],
    ["owner aoi mã hoá %61oi", "postgresql://%61oi:x@127.0.0.1:5434/aoi_management_test"],
  ] as const)("★★★ %s ⇒ từ chối", async (_t, url) => {
    const r = await chay({ choPhepDb: true, testDbUrl: url });
    expect(r.ketCuc).toBe("tu-choi");
    expect(r.loi).toContain("--cho-phep-db");
  });

  it("★★ kiemChoPhepDb thuần: đủ điều kiện ⇒ null; lý do nêu đúng điều kiện hỏng", () => {
    expect(kiemChoPhepDb({ csdl: DONG_CSDL }, URL_TEST)).toBeNull();
    expect(kiemChoPhepDb({}, URL_TEST)).toContain("dòng CSDL");
    expect(kiemChoPhepDb({ csdl: DONG_CSDL }, undefined)).toContain("thiếu URL");
    expect(kiemChoPhepDb({ csdl: DONG_CSDL }, "postgresql://u:x@h/aoi_management")).toContain("không trỏ aoi_management_test");
    expect(kiemChoPhepDb({ csdl: DONG_CSDL }, "postgresql://aoi:x@127.0.0.1:5434/aoi_management_test")).toContain("owner aoi");
  });
});

describe("--cho-phep-db — máy chủ, cổng, vai (danh sách trắng) và token tên CSDL", () => {
  const M = (url: string) => kiemChoPhepDb({ csdl: DONG_CSDL }, url);
  it.each([
    ["127.0.0.1", "postgresql://avi_app:x@127.0.0.1:5434/aoi_management_test"],
    ["localhost", "postgresql://avi_app:x@localhost:5434/aoi_management_test"],
    ["LOCALHOST viết hoa", "postgresql://avi_app:x@LOCALHOST:5434/aoi_management_test"],
    ["::1", "postgresql://avi_app:x@[::1]:5434/aoi_management_test"],
  ])("★★ máy chủ %s ⇒ được", (_t, url) => {
    expect(M(url)).toBeNull();
  });
  it.each([
    ["10.9.9.9", "postgresql://avi_app:x@10.9.9.9:5434/aoi_management_test"],
    ["tên miền ngoài", "postgresql://avi_app:x@db.noi-bo.local:5434/aoi_management_test"],
    ["127.0.0.2", "postgresql://avi_app:x@127.0.0.2:5434/aoi_management_test"],
    ["0.0.0.0", "postgresql://avi_app:x@0.0.0.0:5434/aoi_management_test"],
    ["localhost.evil.com", "postgresql://avi_app:x@localhost.evil.com:5434/aoi_management_test"],
  ])("★★★ máy chủ %s ⇒ từ chối", (_t, url) => {
    expect(M(url)).toContain("máy chủ CSDL");
  });
  it.each([
    ["cổng 5432", "postgresql://avi_app:x@127.0.0.1:5432/aoi_management_test"],
    ["cổng 5433", "postgresql://avi_app:x@127.0.0.1:5433/aoi_management_test"],
    ["không nêu cổng", "postgresql://avi_app:x@127.0.0.1/aoi_management_test"],
    ["cổng 54340", "postgresql://avi_app:x@127.0.0.1:54340/aoi_management_test"],
  ])("★★★ %s ⇒ từ chối", (_t, url) => {
    expect(M(url)).toContain("cổng CSDL");
  });
  it.each([
    ["aoi_owner", "postgresql://aoi_owner:x@127.0.0.1:5434/aoi_management_test"],
    ["avi_app2", "postgresql://avi_app2:x@127.0.0.1:5434/aoi_management_test"],
    ["AVI_APP viết hoa", "postgresql://AVI_APP:x@127.0.0.1:5434/aoi_management_test"],
    ["postgres", "postgresql://postgres:x@127.0.0.1:5434/aoi_management_test"],
    ["không có vai", "postgresql://127.0.0.1:5434/aoi_management_test"],
    ["aoi", "postgresql://aoi:x@127.0.0.1:5434/aoi_management_test"],
    ["avi_app mã hoá thêm", "postgresql://avi_app%20:x@127.0.0.1:5434/aoi_management_test"],
  ])("★★★ vai %s ⇒ từ chối (danh sách trắng chỉ avi_app)", (_t, url) => {
    expect(M(url)).toContain("avi_app");
  });
  it("★★ avi_app mã hoá %61vi_app ⇒ giải mã rồi khớp danh sách trắng (được)", () => {
    expect(M("postgresql://%61vi_app:x@127.0.0.1:5434/aoi_management_test")).toBeNull();
  });
  it.each([
    ["aoi_management_test_x", "CSDL: chạm aoi_management_test_x"],
    ["x_aoi_management_test", "CSDL: chạm x_aoi_management_test"],
    ["aoi_management_testing", "CSDL: chạm aoi_management_testing"],
    ["aoi_management_test2", "CSDL: chạm aoi_management_test2"],
    ["hậu tố số", "CSDL: aoi_management_test9"],
  ])("★★★ dòng CSDL %s ⇒ từ chối (phải là token nguyên)", (_t, csdl) => {
    expect(kiemChoPhepDb({ csdl }, URL_TEST)).toContain("dòng CSDL");
  });
  it.each([
    ["đứng cuối", "CSDL: chạm aoi_management_test"],
    ["trong ngoặc", "CSDL: chạm (aoi_management_test)"],
    ["sau dấu phẩy", "CSDL: aoi_management_test, chỉ _test"],
    ["đầu dòng", "aoi_management_test"],
    ["có dấu chấm", "CSDL: chạm aoi_management_test."],
  ])("★★ dòng CSDL %s ⇒ được", (_t, csdl) => {
    expect(kiemChoPhepDb({ csdl }, URL_TEST)).toBeNull();
  });
});

describe("--cho-phep-db — chayKiem tới driver (vòng tự chạy trong lượt)", () => {
  it("★★★ có cờ ⇒ driver nhận đúng hàm do nhà máy dựng với testDbUrl; không cờ và không tiêm ⇒ driver KHÔNG nhận chayKiem (giữ DB chết mặc định)", async () => {
    const dung = async (van: string, co: boolean) => {
      let nhan: ChayKiem | undefined | "chua" = "chua";
      const tuNhaMay: ChayKiem[] = [];
      const taoChayKiem = ((opt: { testDbUrl?: string } = {}) => {
        const f: ChayKiem = async (l, w, h) => chayKiemXanh(l, w, h);
        tuNhaMay.push(f);
        void opt;
        return f;
      }) as never;
      const drv: Driver = async (v) => {
        nhan = v.chayKiem;
        return { ghiChu: [], vong: 1, token: null, hetGio: false } as never;
      };
      await chayMotViec({ van, wt, base: "HEAD", driver: drv, ra, choPhepKhoRieng: true, luat: "# l\n", taoChayKiem, choPhepDb: co, testDbUrl: URL_TEST, khoGhi: { [TEP_DB]: TEST_MOI, "client/src/lib/a.test.ts": TEST_MOI } });
      return { nhan, tuNhaMay };
    };
    const bat = await dung(the(), true);
    expect(bat.nhan).not.toBe("chua");
    expect(bat.nhan).toBeDefined();
    expect(bat.tuNhaMay).toContain(bat.nhan as ChayKiem);

    const khong = await dung(the(null).split(TEP_DB).join("client/src/lib/a.test.ts"), false);
    expect(khong.nhan).toBeUndefined();
  });
});

describe("--cho-phep-db — miễn theo ĐƯỜNG tệp từ gốc repo, không theo tên cuối", () => {
  const TEST_DB = `import { getDb } from "./connection";\nimport { it } from "vitest";\nit("x", () => { void getDb; });\n`;
  const A = "server/db/trung.test.ts";
  const B = "server/khac/trung.test.ts";
  const vanHaiTep = (lenh: string) => `MÃ: TC-95\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${A}, ${B}\n${DONG_CSDL}\nLỆNH KIỂM: ${lenh}\nGIỚI HẠN: 1 phút, 3 vòng`;
  it("★★★ hai tệp CÙNG TÊN ở hai thư mục: LỆNH KIỂM chỉ nêu A ⇒ A được miễn, B (cùng tên cuối) vẫn vi-pham cham-db", async () => {
    const r = await chay({ van: vanHaiTep(`npx vitest run ${A}`), choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [A]: TEST_DB, [B]: TEST_DB } });
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.viPham?.map((v) => v.duong)).toEqual([B]);
  });
  it("★★ LỆNH KIỂM nêu đường dạng ./server/db/... hoặc gạch ngược ⇒ vẫn khớp đúng tệp A (chuẩn hoá đường)", async () => {
    for (const lenh of [`npx vitest run ./${A}`, `npx vitest run ${A.replace(/\//g, "\\")}`]) {
      const r = await chay({ van: vanHaiTep(lenh), choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [A]: TEST_DB, [B]: TEST_MOI } });
      expect(r.viPham, lenh).toEqual([]);
    }
  });
  it("★★★ đường trong LỆNH KIỂM thoát gốc (../) không bao giờ miễn tệp nào", async () => {
    const r = await chay({ van: vanHaiTep(`npx vitest run ../${A}`), choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [A]: TEST_DB, [B]: TEST_MOI } });
    expect(r.viPham?.map((v) => v.duong)).toEqual([A]);
  });
});

describe("--cho-phep-db — kiểm SAU lượt: tệp test do model viết chạm DB", () => {
  const TEST_DB_MOI = `import { getDb } from "./connection";\nimport { it } from "vitest";\nit("x", () => { void getDb; });\n`;
  it("★★★ không cờ: model viết tệp chạm DB vào đúng tệp LỆNH KIỂM ⇒ vi-pham cham-db (hành vi cũ)", async () => {
    const van = the(null).split(TEP_DB).join("client/src/lib/a.test.ts");
    const r = await chay({ van, khoGhi: { "client/src/lib/a.test.ts": TEST_DB_MOI } });
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.viPham?.some((v) => v.loai === "cham-db")).toBe(true);
  });
  it("★★★ có cờ đủ điều kiện: tệp test trong LỆNH KIỂM chạm DB ⇒ KHÔNG vi phạm, lượt xong", async () => {
    const r = await chay({ choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [TEP_DB]: TEST_DB_MOI } });
    expect(r.ketCuc).toBe("xong");
    expect(r.viPham).toEqual([]);
  });
  it("★★★ có cờ: tệp test KHÁC (không trong LỆNH KIỂM) chạm DB vẫn là vi-pham cham-db", async () => {
    const khac = "server/db/khac.test.ts";
    const van = the().replace(`SỬA/TẠO: ${TEP_DB}`, `SỬA/TẠO: ${TEP_DB}, ${khac}`);
    const r = await chay({ van, choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [TEP_DB]: TEST_MOI, [khac]: TEST_DB_MOI } });
    expect(r.ketCuc).toBe("vi-pham");
    expect(r.viPham?.map((v) => v.duong)).toEqual([khac]);
  });
});

describe("--cho-phep-db — nhà máy hàm chạy lệnh kiểm và dòng lệnh", () => {
  const taoSpy = () => {
    const goi: Array<{ testDbUrl?: string }> = [];
    const taoChayKiem = ((opt: { testDbUrl?: string } = {}) => {
      goi.push(opt);
      return chayKiemXanh;
    }) as never;
    return { goi, taoChayKiem };
  };
  it("★★★ có cờ ⇒ nhà máy nhận testDbUrl; không cờ ⇒ nhận {} (không bao giờ lộ URL _test)", async () => {
    const co = taoSpy();
    await chay({ chayKiem: undefined, taoChayKiem: co.taoChayKiem, choPhepDb: true, testDbUrl: URL_TEST });
    expect(co.goi).toEqual([{ testDbUrl: URL_TEST }]);

    const khong = taoSpy();
    const van = the(null).split(TEP_DB).join("client/src/lib/a.test.ts");
    await chay({ van, chayKiem: undefined, taoChayKiem: khong.taoChayKiem, testDbUrl: URL_TEST, khoGhi: { "client/src/lib/a.test.ts": TEST_MOI } });
    expect(khong.goi).toEqual([{}]);
  });
  it("★★★ không cờ, thẻ không chạm DB ⇒ JSON KHÔNG có khoá choPhepDb", async () => {
    const van = the(null).split(TEP_DB).join("client/src/lib/a.test.ts");
    const r = await chay({ van, khoGhi: { "client/src/lib/a.test.ts": TEST_MOI } });
    expect(r.ketCuc).toBe("xong");
    expect("choPhepDb" in r).toBe(false);
  });
  it("★★ thamSoDbTuDongLenh: --cho-phep-db (có hoặc không giá trị) ⇒ true; vắng ⇒ false; URL lấy từ DATABASE_URL", () => {
    expect(thamSoDbTuDongLenh({ "cho-phep-db": "1" }, { DATABASE_URL: URL_TEST })).toEqual({ choPhepDb: true, testDbUrl: URL_TEST });
    expect(thamSoDbTuDongLenh({}, { DATABASE_URL: URL_TEST })).toEqual({ choPhepDb: false, testDbUrl: URL_TEST });
    expect(thamSoDbTuDongLenh({ "cho-phep-db": "1" }, {}).testDbUrl).toBeUndefined();
  });
});

describe("--cho-phep-db — đủ điều kiện", () => {
  it("★★★ cờ + dòng CSDL + URL đúng ⇒ không bị từ chối, JSON ghi choPhepDb:true", async () => {
    const r = await chay({ choPhepDb: true, testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("xong");
    expect(r.choPhepDb).toBe(true);
    expect(r.tepDoi).toEqual([TEP_DB]);
  });

  it("★★★ cờ CHỈ bỏ đúng một kiểm: ghi ngoài TỆP ĐƯỢC PHÉP vẫn là vi-pham", async () => {
    const r = await chay({ choPhepDb: true, testDbUrl: URL_TEST, khoGhi: { [TEP_DB]: TEST_MOI, "server/db/khac.ts": "export const a = 1;\n" } });
    expect(r.ketCuc).toBe("vi-pham");
  });

  it("★★ cờ không mở vùng cấm: TỆP ĐƯỢC PHÉP trỏ vào vùng cấm vẫn bị từ chối từ thẻ", async () => {
    const van = the().replace(`SỬA/TẠO: ${TEP_DB}`, "SỬA/TẠO: drizzle/0001_x.sql");
    const r = await chay({ van, choPhepDb: true, testDbUrl: URL_TEST });
    expect(r.ketCuc).toBe("tu-choi");
  });

  it("★★ lệnh kiểm được gọi với hàm chayKiem tiêm vào (chayKiem tường minh thắng, không bị thay)", async () => {
    let goi = 0;
    const r = await chay({
      choPhepDb: true,
      testDbUrl: URL_TEST,
      chayKiem: async (l, w, h) => (goi++, chayKiemXanh(l, w, h)),
    });
    expect(r.ketCuc).toBe("xong");
    expect(goi).toBeGreaterThan(0);
  });
});

describe("dòng CSDL của thẻ CHỈ BỘ CHẠY đọc", () => {
  it("★★★ docTheViec đọc khoá CSDL; ghepLenh KHÔNG đưa nó vào lời nhắc; driver không nhận trường csdl", async () => {
    const d = docTheViec(the());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.the.csdl).toContain("aoi_management_test");
    const lenh = ghepLenh(d.the, "# l");
    expect(lenh).not.toContain("aoi_management_test");
    expect(lenh).not.toContain("CSDL");

    let thay: Record<string, unknown> = {};
    const drv: Driver = async (v) => {
      thay = v.the as unknown as Record<string, unknown>;
      return { ghiChu: [], vong: 1, token: null, hetGio: false } as never;
    };
    await chay({ choPhepDb: true, testDbUrl: URL_TEST, driver: drv });
    expect("csdl" in thay).toBe(false);
  });

  it("★★ the.csdl được cắt khoảng trắng hai đầu", () => {
    const d = docTheViec(the("CSDL:     chạm aoi_management_test   "));
    expect(d.ok && d.the.csdl).toBe("chạm aoi_management_test");
  });

  it("★ thẻ không có dòng CSDL ⇒ the.csdl vắng", () => {
    const d = docTheViec(the(null));
    expect(d.ok && "csdl" in d.the).toBe(false);
  });
});

describe("môi trường tiến trình con của lệnh kiểm", () => {
  it("★★★ envSachChoTienTrinhCon: có testDbUrl ⇒ TEST_DATABASE_URL thật, DATABASE_URL vẫn cổng chết; bí mật vẫn bị gỡ", () => {
    const goc = { PATH: "p", OPENAI_API_KEY: "bimat", DATABASE_URL: URL_TEST } as NodeJS.ProcessEnv;
    const e = envSachChoTienTrinhCon(goc, { testDbUrl: URL_TEST });
    expect(e.TEST_DATABASE_URL).toBe(URL_TEST);
    expect(e.DATABASE_URL).toBe(ENV_DB_CHET.DATABASE_URL);
    expect(e.OPENAI_API_KEY).toBeUndefined();
    expect(e.PATH).toBe("p");
  });
  it("★★★ không testDbUrl ⇒ cả hai URL là cổng chết (hành vi cũ không đổi)", () => {
    const e = envSachChoTienTrinhCon({ DATABASE_URL: URL_TEST, TEST_DATABASE_URL: URL_TEST } as NodeJS.ProcessEnv);
    expect(e.DATABASE_URL).toBe(ENV_DB_CHET.DATABASE_URL);
    expect(e.TEST_DATABASE_URL).toBe(ENV_DB_CHET.TEST_DATABASE_URL);
  });

  it("★★★ tiến trình con THẬT: taoChayLenhKiem({testDbUrl}) thấy URL _test; bản mặc định thấy cổng chết", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tcd-con-"));
    try {
      const lenh = `node -p "const U=function(s){const u=new URL(s);return u.host+u.pathname+' user='+u.username}; U(process.env.TEST_DATABASE_URL)+' | '+U(process.env.DATABASE_URL)"`;
      const co = await taoChayLenhKiem({ testDbUrl: URL_TEST })(lenh, cwd, 60);
      expect(co.duoi).toContain("127.0.0.1:5434/aoi_management_test user=avi_app");
      expect(co.duoi).toContain("127.0.0.1:9/aoi_management user=pilot_kiem");
      expect(co.duoi).not.toContain("matkhau");
      const khong = await taoChayLenhKiem()(lenh, cwd, 60);
      expect(khong.duoi).not.toContain("5434");
      expect(khong.duoi).toContain("127.0.0.1:9/aoi_management_test user=pilot_kiem");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 150_000);
});
