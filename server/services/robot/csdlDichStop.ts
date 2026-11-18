/**
 * D2 (chủ dự án duyệt 14/11, phương án (x) của HST) — CSDL mà pool của `getDb()` THẬT SỰ dùng, đọc KHÔNG I/O mạng từ đúng nguồn:
 * `process.env.DATABASE_URL` (server/db/connection.ts:38/:44, không truyền `database` / `user`), theo đúng postgres.js 3.4.9:
 *   • src/index.js:537-558 parseUrl — phần host cắt tới `/` hoặc `?` đầu, bỏ `user@`, giải mã, nhiều host ⇒ host đầu; `new URL`;
 *     username / password giải mã (`%` lẻ ⇒ ném, như postgres.js);
 *   • :440 user = url.username || PGUSERNAME || PGUSER || os.userInfo().username (lỗi ⇒ USERNAME || USER || LOGNAME);
 *   • :469 database = url.pathname.slice(1) (KHÔNG giải mã) || PGDATABASE || user;
 *   • :437/:487 + src/connection.js:996-1005 — tham số query (giải mã) không thuộc mặc định, gồm `database` / `user`, ghi đè trong gói
 *     khởi động; giá trị rỗng bị bỏ ⇒ thiếu `database` thì máy chủ PG dùng tên user.
 * Tên phân biệt hoa thường như PG (tên trong gói khởi động dùng nguyên văn): `_test` phải ở CUỐI (`/_test$/`, không cờ i).
 * `khong-xac-dinh` chỉ khi URL thiếu / rỗng (getDb() không dựng client) hoặc postgres.js sẽ ném, hoặc không ra được user.
 * Mô-đun không có trạng thái, không có cửa mở: test thay nó bằng vi.mock.
 */
import os from "node:os";

export type TrangThaiCsdlDich = "chac-la-test" | "chac-khong-phai-test" | "khong-xac-dinh";

export function docCsdlDichStop(): { trangThai: TrangThaiCsdlDich; ten: string | null; lyDo: string | null } {
  const url = process.env.DATABASE_URL;
  if (!url) return { trangThai: "khong-xac-dinh", ten: null, lyDo: "DATABASE_URL is not set" };
  try {
    const env = process.env;
    let host = url.slice(url.indexOf("://") + 3).split(/[?/]/)[0];
    host = decodeURIComponent(host.slice(host.indexOf("@") + 1));
    const u = new URL(url.replace(host, host.split(",")[0]));
    decodeURIComponent(u.password); // postgres.js giải mã mật khẩu — `%` lẻ ném ở đó, nên ném ở đây
    const tenOs = () => {
      try {
        return os.userInfo().username; // postgres.js osUsername() — chỉ khi URL và PG* không có user
      } catch {
        return env.USERNAME || env.USER || env.LOGNAME;
      }
    };
    const user = decodeURIComponent(u.username) || env.PGUSERNAME || env.PGUSER || tenOs();
    const query = Object.fromEntries(u.searchParams);
    const goi: Record<string, string | undefined> = { user, database: u.pathname.slice(1) || env.PGDATABASE || user };
    if ("user" in query) goi.user = query.user;
    if ("database" in query) goi.database = query.database;
    const ten = goi.database || goi.user || null;
    if (!ten) return { trangThai: "khong-xac-dinh", ten: null, lyDo: "no database / user name in DATABASE_URL or the PG* environment" };
    return { trangThai: /_test$/.test(ten) ? "chac-la-test" : "chac-khong-phai-test", ten, lyDo: null };
  } catch (err) {
    return { trangThai: "khong-xac-dinh", ten: null, lyDo: `DATABASE_URL could not be parsed (${String((err as Error)?.name ?? "error")})` };
  }
}
