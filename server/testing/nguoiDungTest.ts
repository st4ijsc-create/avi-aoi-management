/**
 * ★ Tiện ích TEST dùng chung (2026-10-23) — TẠO NGƯỜI DÙNG TEST VÀ TỰ DỌN.
 *
 * Vì sao: nhiều tệp `*.test.ts` tự `insert(users)` mà KHÔNG xoá ⇒ CSDL `_test` chất 5.196 người dùng (1.951 admin/supervisor hoạt động). Mọi cảnh báo "gửi cho mọi
 * admin/supervisor" (vd. quét lệch nhà máy edge) nhân hàng theo số người này: 1,86 triệu hàng `notifications`, instance e2e nghẽn. Xem backlog ở
 * `docs/superpowers/audits/2026-10-23-socket-phat-theo-nha-may.md`.
 *
 * Cách dùng (thay cho \`mkUser\` tự viết):
 *   const u = await taoNguoiDungTest("admin", "admin", { tienTo: "acs", ten: "access scope admin", ts });
 * Helper TỰ đăng ký \`afterAll\` (ở cấp tệp test đã import nó) dọn LẦN LƯỢT, chỉ cho id nó tạo:
 *   user_factory_assignments → permissions → notifications → user_sessions → user_secrets → users.
 * FK chặn xoá \`users\` ⇒ đặt \`isActive=false\` và GHI LÝ DO (console.warn) — người dùng bị vô hiệu hoá không còn là "người nhận" của cảnh báo hoạt động.
 * Census \`nguoiDungTest.census.test.ts\` cấm \`insert(users)\` / \`INSERT INTO users\` trong *.test.ts ngoài helper (danh sách MIỄN chỉ được GIẢM).
 */
import { afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { users, type InsertUser, type User } from "../../drizzle/schema";

export interface TuyChonNguoiDungTest {
  /** Tiền tố `openId`/`username` (mặc định `tnd`). */
  tienTo?: string;
  /** Tên hiển thị (mặc định `người dùng test <tag>`). */
  ten?: string;
  /** Hậu tố làm khoá duy nhất theo tệp (mặc định: mốc thời gian của tiến trình). */
  ts?: string | number;
  /** Ghi đè cột tuỳ ý (vd. `isActive`, `email`). */
  extra?: Partial<InsertUser>;
}

const HAU_TO_TIEN_TRINH = Date.now().toString(36);
const daTao = new Set<number>();

/** Bảng phụ thuộc theo thứ tự dọn; tên cố định (không nhận từ ngoài). Bảng không tồn tại ⇒ bỏ qua. */
const BANG_PHU_THUOC = ["user_factory_assignments", "permissions", "notifications", "user_sessions", "user_secrets"] as const;

/** Số id người dùng helper đang giữ (cho test của chính helper). */
export function __idNguoiDungDangGiu(): number[] {
  return [...daTao];
}

/** Dọn mọi người dùng đã tạo trong tệp này. Không bao giờ ném. Trả số xoá thật / số bị vô hiệu hoá. */
export async function donNguoiDungTest(): Promise<{ daXoa: number; voHieuHoa: number }> {
  const ids = [...daTao];
  daTao.clear();
  if (ids.length === 0) return { daXoa: 0, voHieuHoa: 0 };
  const db = await getDb();
  if (!db) return { daXoa: 0, voHieuHoa: 0 };
  const ds = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  const donPhuThuoc = async () => {
   for (const b of BANG_PHU_THUOC) {
    try {
      await db.execute(sql`DELETE FROM ${sql.raw(`public."${b}"`)} WHERE "userId" IN (${ds})`);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/does not exist/i.test(msg)) console.warn(`[nguoiDungTest] không dọn được ${b}: ${msg.slice(0, 160)}`);
    }
   }
  };
  // Phiên khác chạy chung _test có thể chèn thông báo gửi "mọi admin/supervisor" (gồm người vừa tạo) GIỮA bước xoá thông báo và bước xoá users ⇒ FK chặn thoáng qua. Thử lại tối đa 3 lần trước khi rơi về isActive=false.
  let loi: unknown;
  for (let lan = 0; lan < 3; lan++) {
    await donPhuThuoc();
    try {
      await db.execute(sql`DELETE FROM public.users WHERE id IN (${ds})`);
      return { daXoa: ids.length, voHieuHoa: 0 };
    } catch (e) {
      loi = e;
    }
  }
  {
    const e = loi;
    // FK chặn xoá (bảng khác còn trỏ tới người dùng này) ⇒ vô hiệu hoá để không còn là người nhận cảnh báo hoạt động
    const ly = String((e as { cause?: Error })?.cause?.message ?? (e as Error)?.message ?? e).replace(/\s+/g, " ").slice(0, 200); // drizzle bọc: lý do thật (tên ràng buộc FK) nằm ở `cause`
    console.warn(`[nguoiDungTest] FK chặn xoá users (${ly}) ⇒ đặt isActive=false cho ${ids.length} người`);
    try {
      await db.execute(sql`UPDATE public.users SET "isActive" = false WHERE id IN (${ds})`);
    } catch {
      /* không còn cách nào — để lại */
    }
    return { daXoa: 0, voHieuHoa: ids.length };
  }
}

// Đăng ký MỘT lần ở cấp tệp test đã import helper (module được nạp lúc thu thập ca ⇒ hook thuộc tệp đó).
afterAll(async () => {
  await donNguoiDungTest();
}, 60_000);

/** Tạo một người dùng test (đã đăng ký dọn). Trả hàng đầy đủ. */
export async function taoNguoiDungTest(tag: string, role: NonNullable<InsertUser["role"]>, opts: TuyChonNguoiDungTest = {}): Promise<User> {
  const db = await getDb();
  if (!db) throw new Error("taoNguoiDungTest: không có CSDL test");
  const tienTo = (opts.tienTo ?? "tnd").replace(/[^A-Za-z0-9_-]/g, "");
  const ts = opts.ts ?? HAU_TO_TIEN_TRINH;
  const [u] = await db
    .insert(users)
    .values({
      openId: `${tienTo}_${tag}_${ts}`,
      username: `${tienTo}_${tag}_${ts}`,
      name: opts.ten ?? `người dùng test ${tag}`,
      role,
      loginMethod: "local",
      ...opts.extra,
    })
    .returning();
  daTao.add(u.id);
  return u as User;
}
