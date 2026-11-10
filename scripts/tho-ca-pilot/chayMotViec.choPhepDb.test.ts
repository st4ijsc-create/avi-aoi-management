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
    expect(kiemChoPhepDb({ csdl: DONG_CSDL }, "postgresql://aoi:x@h/aoi_management_test")).toContain("owner aoi");
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
      const lenh = `node -p "process.env.TEST_DATABASE_URL + ' | ' + process.env.DATABASE_URL"`;
      const co = await taoChayLenhKiem({ testDbUrl: URL_TEST })(lenh, cwd, 60);
      expect(co.duoi).toContain(URL_TEST);
      expect(co.duoi).toContain("127.0.0.1:9/aoi_management");
      const khong = await taoChayLenhKiem()(lenh, cwd, 60);
      expect(khong.duoi).not.toContain(URL_TEST);
      expect(khong.duoi).toContain("127.0.0.1:9/aoi_management_test");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 150_000);
});
