/**
 * D2 lượt sửa 1 — `docCsdlDichStop()`: tên CSDL mà pool của `getDb()` THẬT SỰ dùng (DATABASE_URL, server/db/connection.ts:38/:44),
 * đọc theo đúng chuỗi lùi của postgres.js, và ba trạng thái `chac-la-test` / `chac-khong-phai-test` / `khong-xac-dinh`.
 *
 * Mỗi ca SO VỚI postgres.js THẬT (phiên bản 3.4.9): gọi `postgres(url, …)` (không kết nối — chưa có truy vấn nào thì không mở
 * socket) rồi dựng tên CSDL của gói khởi động như `src/connection.js:996-1005` (`Object.assign({ user, database }, options.connection)`,
 * bỏ giá trị rỗng; thiếu `database` ⇒ máy chủ PG lấy tên user). Nguồn chuỗi lùi: `src/index.js:440` (user = url.username ||
 * PGUSERNAME || PGUSER || osUsername()), `:469` (database = url.pathname.slice(1) || PGDATABASE || user), `:437`/`:487` (tham số
 * query không thuộc mặc định ⇒ options.connection), `:537-558` (parseUrl). Bảng ca lấy từ D2\ra\tam\bang-url.md (người rà đo).
 * Nâng postgres.js ⇒ ca phiên bản đỏ ⇒ đo lại bảng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import postgres from "postgres";
import { docCsdlDichStop } from "./csdlDichStop";

const PG_ENV = ["DATABASE_URL", "PGDATABASE", "PGUSERNAME", "PGUSER", "PGHOST", "PGPORT"] as const;
let luu: Record<string, string | undefined> = {};
beforeEach(() => {
  luu = Object.fromEntries(PG_ENV.map((k) => [k, process.env[k]]));
  for (const k of PG_ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of PG_ENV) {
    if (luu[k] === undefined) delete process.env[k];
    else process.env[k] = luu[k];
  }
  vi.restoreAllMocks();
});

/** Tên CSDL mà postgres.js THẬT đưa vào gói khởi động (null = postgres() ném ⇒ getDb() không có client). */
async function tenThatCuaPostgresJs(url: string): Promise<string | null> {
  let sql: ReturnType<typeof postgres>;
  try {
    sql = postgres(url, { connection: { statement_timeout: 30_000 }, max: 1 }); // như connection.ts:44 (không truyền database / user)
  } catch {
    return null;
  }
  const o = sql.options as unknown as { user: string; database: string; connection: Record<string, unknown> };
  const goi = Object.fromEntries(Object.entries(Object.assign({ user: o.user, database: o.database }, o.connection)).filter(([, v]) => v));
  await sql.end({ timeout: 0 });
  return String(goi.database ?? goi.user ?? "") || null;
}

type Ca = { ten: string; url: string | undefined; env?: Partial<Record<(typeof PG_ENV)[number], string>>; osUser?: string; mong: "chac-la-test" | "chac-khong-phai-test" | "khong-xac-dinh" };
const LA = "chac-la-test" as const;
const KHONG = "chac-khong-phai-test" as const;
const KXD = "khong-xac-dinh" as const;
const CA: Ca[] = [
  { ten: "prod chuẩn", url: "postgres://u:p@db.prod:5432/aoi_management", mong: KHONG },
  { ten: "test chuẩn", url: "postgres://u:p@127.0.0.1:5434/aoi_management_test", mong: LA },
  { ten: "postgresql://", url: "postgresql://u:p@h/aoi_management", mong: KHONG },
  { ten: "sslmode prod", url: "postgres://u:p@h:5432/aoi_management?sslmode=require", mong: KHONG },
  { ten: "x_test?sslmode=require", url: "postgres://u:p@h:5432/x_test?sslmode=require", mong: LA },
  { ten: "%5F trong path (tên nguyên văn, CSDL khác)", url: "postgres://u:p@h/aoi_management%5Ftest", mong: KHONG },
  { ten: "%5F trong ?database= (giải mã)", url: "postgres://u:p@h/x?database=aoi_management%5Ftest", mong: LA },
  // _TEST viết HOA ⇒ chac-khong-phai-test ⇒ gửi như cũ, không thêm cảnh báo (ruling dieu-phoi 14/11): Postgres so tên CSDL trong gói
  // khởi động NGUYÊN VĂN (phân biệt hoa thường — "AOI_MANAGEMENT_TEST" là CSDL khác "aoi_management_test"), và (x) chỉ mô phỏng khi
  // CHẮC là _test. Phép so là /_test$/ KHÔNG cờ i; đột biến /_test$/i phải làm ba ca này đỏ.
  // CSDL thử phải đặt tên chữ thường kết thúc _test thì D2 mới nhận ra.
  { ten: "x_TEST (PG phân biệt hoa thường)", url: "postgres://u:p@h/x_TEST", mong: KHONG },
  { ten: "AOI_TEST", url: "postgres://u:p@h/AOI_TEST", mong: KHONG },
  { ten: "AOI_MANAGEMENT_TEST", url: "postgres://u:p@h/AOI_MANAGEMENT_TEST", mong: KHONG },
  { ten: "x_testing", url: "postgres://u:p@h/x_testing", mong: KHONG },
  { ten: "x_test2", url: "postgres://u:p@h/x_test2", mong: KHONG },
  { ten: "test", url: "postgres://u:p@h/test", mong: KHONG },
  { ten: "x_test/ (gạch cuối)", url: "postgres://u:p@h/x_test/", mong: KHONG },
  { ten: "aoi_test_backup", url: "postgres://u:p@h/aoi_test_backup", mong: KHONG },
  { ten: "x_test", url: "postgres://u:p@h/x_test", mong: LA },
  // chuỗi lùi :469 — PGDATABASE
  { ten: "không path + PGDATABASE prod", url: "postgres://u:p@db.prod:5432", env: { PGDATABASE: "aoi_management" }, mong: KHONG },
  { ten: "không path + PGDATABASE _test", url: "postgres://u:p@h:5432", env: { PGDATABASE: "aoi_management_test" }, mong: LA },
  { ten: "path '/' + PGDATABASE prod", url: "postgres://u:p@db.prod:5432/", env: { PGDATABASE: "aoi_management" }, mong: KHONG },
  { ten: "path '/' + PGDATABASE _test", url: "postgres://u:p@db.prod:5432/", env: { PGDATABASE: "aoi_management_test" }, mong: LA },
  { ten: "path prod THẮNG PGDATABASE _test (thứ tự lùi :469)", url: "postgres://u:p@db.prod:5432/aoi_management", env: { PGDATABASE: "aoi_management_test" }, mong: KHONG },
  { ten: "path _test THẮNG PGDATABASE prod", url: "postgres://u:p@db.prod:5432/aoi_management_test", env: { PGDATABASE: "aoi_management" }, mong: LA },
  { ten: "PGDATABASE prod THẮNG user _test (thứ tự lùi :469)", url: "postgres://svc_test@db.prod:5432", env: { PGDATABASE: "aoi_management" }, mong: KHONG },
  // chuỗi lùi :469 → user (:440)
  { ten: "không path, user URL prod", url: "postgres://aoi_management@db.prod:5432", mong: KHONG },
  { ten: "không path, user URL _test", url: "postgres://aoi_management_test@db.prod:5432", mong: LA },
  { ten: "không user URL ⇒ PGUSERNAME _test", url: "postgres://h:5432", env: { PGUSERNAME: "svc_test" }, mong: LA },
  { ten: "PGUSERNAME thắng PGUSER", url: "postgres://h:5432", env: { PGUSERNAME: "svc", PGUSER: "svc_test" }, mong: KHONG },
  { ten: "không user URL ⇒ PGUSER _test", url: "postgres://h:5432", env: { PGUSER: "svc_test" }, mong: LA },
  { ten: "không user URL ⇒ PGUSER prod", url: "postgres://h:5432", env: { PGUSER: "aoi_management" }, mong: KHONG },
  { ten: "không gì cả ⇒ os.userInfo() _test", url: "postgres://h:5432", osUser: "ci_test", mong: LA },
  { ten: "không gì cả ⇒ os.userInfo() prod", url: "postgres://h:5432", osUser: "ci", mong: KHONG },
  // ?database= (query ⇒ options.connection ⇒ ghi đè trong gói khởi động)
  { ten: "?database= prod ghi đè path _test", url: "postgres://u:p@h/aoi_management_test?database=aoi_management", mong: KHONG },
  { ten: "?database= _test ghi đè path prod", url: "postgres://u:p@h/aoi_management?database=aoi_management_test", mong: LA },
  { ten: "chỉ ?database= prod, không path", url: "postgres://u:p@h:5432?database=aoi_management", mong: KHONG },
  { ten: "?database= rỗng ⇒ khoá bị bỏ ⇒ máy chủ dùng tên user (u)", url: "postgres://u:p@h/aoi_management_test?database=", mong: KHONG },
  { ten: "?database= rỗng, user _test", url: "postgres://u_test:p@h/aoi_management?database=", mong: LA },
  { ten: "?dbname= (libpq) không được đọc ⇒ PGDATABASE", url: "postgres://u:p@h/?dbname=aoi_management", env: { PGDATABASE: "aoi_management_test" }, mong: LA },
  { ten: "?user= ghi đè user, database đã lùi về user cũ", url: "postgres://u:p@h:5432?user=svc_test", mong: KHONG },
  // `?database=` rỗng bị bỏ khỏi gói khởi động ⇒ máy chủ lấy tên user ĐÃ bị `?user=` ghi đè (bỏ dòng ghi đè user ⇒ ca đầu GỬI thật trên _test)
  { ten: "?user=x_test&database= ⇒ tên CSDL là user ghi đè (_test)", url: "postgres://u:p@h/aoi_management?user=x_test&database=", mong: LA },
  { ten: "?user=aoi_management&database= trên path x_test ⇒ không phải _test", url: "postgres://u:p@h/x_test?user=aoi_management&database=", mong: KHONG },
  // socket
  { ten: "socket postgres:///ten?host=… prod", url: "postgres:///aoi_management?host=/var/run/postgresql", mong: KHONG },
  { ten: "socket postgres:///ten?host=… _test", url: "postgres:///aoi_management_test?host=/var/run/postgresql", mong: LA },
  { ten: "socket %2F trong host prod", url: "postgres://%2Fvar%2Frun%2Fpostgresql/aoi_management", mong: KHONG },
  { ten: "socket %2F trong host _test", url: "postgres://%2Fvar%2Frun%2Fpostgresql/aoi_management_test", mong: LA },
  { ten: "socket postgres:///ten + PGHOST", url: "postgres:///aoi_management", env: { PGHOST: "/var/run/postgresql" }, mong: KHONG },
  { ten: "socket host rỗng u:p@/ten (postgres.js ném)", url: "postgres://u:p@/aoi_management", mong: KXD },
  // host
  { ten: "nhiều host prod", url: "postgres://u:p@h1:5432,h2:5433/aoi_management", mong: KHONG },
  { ten: "nhiều host _test", url: "postgres://u:p@h1:5432,h2:5433/aoi_management_test", mong: LA },
  { ten: "IPv6", url: "postgres://u:p@[::1]:5432/aoi_management", mong: KHONG },
  { ten: "host:port trần (không có tên)", url: "db.prod:5432", env: { PGDATABASE: "aoi_management" }, mong: KHONG },
  // mật khẩu / hỏng
  { ten: "mật khẩu %40", url: "postgres://u:p%40ss@h/aoi_management", mong: KHONG },
  { ten: "mật khẩu @ không mã hoá", url: "postgres://u:p@ss@h/aoi_management", mong: KHONG },
  { ten: "mật khẩu ? không mã hoá (ném)", url: "postgres://u:p?ss@h/aoi_management", mong: KXD },
  { ten: "mật khẩu # không mã hoá (ném)", url: "postgres://u:p#ss@h/aoi_management", mong: KXD },
  { ten: "mật khẩu %zz (ném URIError)", url: "postgres://u:p%zz@h/aoi_management", mong: KXD },
  { ten: "user mã hoá trùng host", url: "postgres://h%2C@h/aoi_management", mong: KHONG },
  { ten: "khoảng trắng cuối", url: "postgres://u:p@h/aoi_management_test ", mong: LA },
  { ten: "URL hỏng", url: "not a url", mong: KXD },
];

describe("D2 — docCsdlDichStop so với postgres.js 3.4.9 thật", () => {
  it("★ phiên bản postgres.js là 3.4.9 (khác ⇒ đo lại bảng)", () => {
    const goc = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const v = JSON.parse(readFileSync(resolve(goc, "node_modules/postgres/package.json"), "utf8")).version;
    expect(v, "postgres.js đã đổi phiên bản — đo lại bảng (D2\\ra\\tam\\bang-url.md) và chuỗi lùi src/index.js:440/:469 trước khi sửa ca").toBe("3.4.9");
  });

  it.each(CA)("★ $ten ⇒ $mong, và đúng tên postgres.js dùng", async (ca) => {
    for (const [k, v] of Object.entries(ca.env ?? {})) process.env[k] = v;
    if (ca.osUser !== undefined) vi.spyOn(os, "userInfo").mockReturnValue({ username: ca.osUser } as ReturnType<typeof os.userInfo>);
    if (ca.url !== undefined) process.env.DATABASE_URL = ca.url;
    const doc = docCsdlDichStop();
    expect(doc.trangThai).toBe(ca.mong);
    const that = await tenThatCuaPostgresJs(ca.url ?? "");
    if (ca.mong === KXD) {
      expect(that).toBeNull(); // postgres() ném ⇒ getDb() không dựng được pool
      expect(doc.ten).toBeNull();
    } else {
      expect(doc.ten).toBe(that);
    }
  });

  it.each([
    ["DATABASE_URL chưa đặt", undefined],
    ["DATABASE_URL rỗng", ""],
  ])("★ %s ⇒ khong-xac-dinh (connection.ts:38 không dựng client)", (_ten, url) => {
    process.env.PGDATABASE = "aoi_management_test"; // postgres.js sẽ lùi về đây — nhưng getDb() không dựng client khi URL rỗng/thiếu
    if (url !== undefined) process.env.DATABASE_URL = url;
    expect(docCsdlDichStop()).toMatchObject({ trangThai: KXD, ten: null });
  });
});
