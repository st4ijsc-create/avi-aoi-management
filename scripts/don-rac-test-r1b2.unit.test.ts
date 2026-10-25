/**
 * R1b-2a T14 — chốt an toàn của scripts/don-rac-test-r1b2.mjs (phán quyết K14). KHÔNG chạm CSDL thật: kết nối là seam giả đếm số lần mở.
 * Phần chạy-thật trên `_test` ở don-rac-test-r1b2.db.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — .mjs không có khai báo kiểu
import { chay, laDbTest, tenDbLaTest, MUC_TIEU } from "./don-rac-test-r1b2.mjs";

const DEV = "postgresql://avi_app:x@127.0.0.1:5434/aoi_management";
const TEST = "postgresql://avi_app:x@127.0.0.1:5434/aoi_management_test";
const KHOA = ["TEST_DATABASE_URL", "DATABASE_URL", "MIGRATION_DB_URL", "MIGRATION_DB_USER", "MIGRATION_DB_PASSWORD"] as const;
const goc: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KHOA) goc[k] = process.env[k];
  delete process.env.MIGRATION_DB_URL;
  delete process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL = DEV; // máy chủ chuẩn 127.0.0.1:5434
});
afterEach(() => {
  for (const k of KHOA) {
    if (goc[k] === undefined) delete process.env[k];
    else process.env[k] = goc[k];
  }
});

/** Kết nối giả: ghi lại số lần mở và mọi câu lệnh; `current_database()` trả về `tenDb`. */
function gia(tenDb: string) {
  const st = { mo: 0, cau: [] as string[], url: "" };
  const connect = (url: string) => {
    st.mo++;
    st.url = url;
    const tx: any = (s: TemplateStringsArray | string) => {
      const text = typeof s === "string" ? s : s.join("?");
      st.cau.push(text);
      return Promise.resolve(/current_database/.test(text) ? [{ d: tenDb }] : []);
    };
    return { begin: async (fn: (t: any) => Promise<unknown>) => fn(tx), end: async () => undefined };
  };
  return { st, connect };
}
const chayVoi = (argv: string[], connect: any) => chay({ argv, connect, log: () => undefined, err: () => undefined });

describe("laDbTest / tenDbLaTest", () => {
  it("chỉ true khi tên CSDL kết thúc _test", () => {
    expect(laDbTest(DEV)).toBe(false);
    expect(laDbTest(TEST)).toBe(true);
    expect(laDbTest("postgresql://h/aoi_test_x")).toBe(false); // chứa test nhưng KHÔNG kết thúc _test
    expect(laDbTest("postgresql://h/aoi_management_test?sslmode=disable")).toBe(true);
    expect(laDbTest("không phải url")).toBe(false);
    expect(laDbTest("postgresql://h:5434/db/x_test")).toBe(true); // đường dẫn lạ: lớp 1 cho qua, lớp 2 (current_database) quyết
    expect(laDbTest("postgresql://h:5434/aoi_management?x=_test")).toBe(false); // _test chỉ ở query
    expect(laDbTest("postgresql://h:5434/aoi_management?options=-c%20search_path=_test")).toBe(false);
    expect(tenDbLaTest("aoi_management")).toBe(false);
    expect(tenDbLaTest("aoi_management_test")).toBe(true);
    expect(tenDbLaTest(undefined)).toBe(false);
  });
});

describe("cờ dòng lệnh — không có đường tới DEV", () => {
  it.each([
    [[]],
    [["--ghi"]],
    [["--dev-only"]],
    [["--test-only", "--dev-only"]],
    [["--apply"]],
    [["--test-only", "--apply"]],
    [["--test-only", "tuychon"]],
  ])("%j ⇒ thoát 2, 0 kết nối", async (argv) => {
    process.env.TEST_DATABASE_URL = TEST;
    const g = gia("aoi_management_test");
    expect(await chayVoi(argv as string[], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
});

describe("guard URL (lớp 1) — trước khi mở kết nối", () => {
  it("TEST_DATABASE_URL trỏ DEV ⇒ thoát 2, 0 kết nối", async () => {
    process.env.TEST_DATABASE_URL = DEV;
    const g = gia("aoi_management");
    expect(await chayVoi(["--test-only", "--ghi"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
  it("MIGRATION_DB_URL đè URL owner sang DEV ⇒ thoát 2, 0 kết nối (asOwner bỏ qua url)", async () => {
    process.env.TEST_DATABASE_URL = TEST;
    process.env.MIGRATION_DB_URL = "postgresql://aoi:aoi@127.0.0.1:5434/aoi_management";
    const g = gia("aoi_management");
    expect(await chayVoi(["--test-only", "--ghi"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
  it("tên CSDL chứa test nhưng không kết thúc _test ⇒ thoát 2, 0 kết nối", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://avi_app:x@127.0.0.1:5434/aoi_test_backup";
    const g = gia("aoi_test_backup");
    expect(await chayVoi(["--test-only"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
});

describe("guard thời chạy (lớp 2) — current_database() trên chính kết nối ghi", () => {
  it("URL trông như _test nhưng máy chủ trả CSDL không kết thúc _test ⇒ thoát 2 sau ĐÚNG một câu lệnh", async () => {
    process.env.TEST_DATABASE_URL = TEST;
    const g = gia("aoi_management"); // đổi tên / URL trỏ sai nhưng chuỗi vẫn _test
    expect(await chayVoi(["--test-only", "--ghi"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(1);
    expect(g.st.cau).toHaveLength(1);
    expect(g.st.cau[0]).toMatch(/current_database/);
  });
  it("cũng chặn khi MIGRATION_DB_URL (đích ghi thật) dạng _test mà CSDL thật là DEV", async () => {
    process.env.TEST_DATABASE_URL = TEST;
    process.env.MIGRATION_DB_URL = "postgresql://aoi:aoi@127.0.0.1:5434/aoi_management_test";
    const g = gia("aoi_management");
    expect(await chayVoi(["--test-only", "--ghi"], g.connect)).toBe(2);
    expect(g.st.url).toBe(process.env.MIGRATION_DB_URL);
    expect(g.st.cau).toHaveLength(1);
  });
});

describe("ghim máy chủ — cùng host:port với DATABASE_URL", () => {
  it.each([
    ["MIGRATION_DB_URL máy khác, CSDL *_test", "postgresql://aoi:aoi@10.9.9.9:5434/aoi_management_test"],
    ["MIGRATION_DB_URL cùng host khác cổng", "postgresql://aoi:aoi@127.0.0.1:5999/aoi_management_test"],
  ])("%s ⇒ thoát 2, 0 kết nối", async (_ten, url) => {
    process.env.TEST_DATABASE_URL = TEST;
    process.env.MIGRATION_DB_URL = url;
    const g = gia("aoi_management_test"); // tên CSDL đúng — chỉ máy chủ sai
    expect(await chayVoi(["--test-only", "--ghi"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
  it("TEST_DATABASE_URL ở máy khác ⇒ thoát 2, 0 kết nối", async () => {
    process.env.TEST_DATABASE_URL = "postgresql://avi_app:x@db.example.com:5434/aoi_management_test";
    const g = gia("aoi_management_test");
    expect(await chayVoi(["--test-only"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
  it("DATABASE_URL chưa đặt ⇒ thoát 2, 0 kết nối", async () => {
    process.env.TEST_DATABASE_URL = TEST;
    delete process.env.DATABASE_URL;
    const g = gia("aoi_management_test");
    expect(await chayVoi(["--test-only"], g.connect)).toBe(2);
    expect(g.st.mo).toBe(0);
  });
  it("cùng host:port ⇒ mở đúng một kết nối (chạy khô giả)", async () => {
    process.env.TEST_DATABASE_URL = TEST;
    const g = gia("aoi_management_test");
    await chayVoi(["--test-only"], g.connect).catch(() => undefined); // phần in kết quả không có dữ liệu giả — chỉ đếm kết nối
    expect(g.st.mo).toBe(1);
  });
});

describe("danh sách đích", () => {
  it("tường minh, không trùng, không có LIKE tiền tố", () => {
    for (const [k, v] of Object.entries(MUC_TIEU as Record<string, number[]>)) {
      expect(new Set(v).size, k).toBe(v.length);
      expect(v.every((x) => Number.isInteger(x) && x > 0), k).toBe(true);
    }
    expect(MUC_TIEU.adapters).toEqual([26336, 26342, 26343, 27035]);
    for (const id of [56136, 56139, 56182, 56185, 56440]) expect(MUC_TIEU.machines).toContain(id);
  });
});
