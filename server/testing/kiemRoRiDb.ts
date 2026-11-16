/**
 * Phát hiện RÒ RỈ ra ngoài giao dịch ROLLBACK của ca phát lại: đếm hàng mang `userId` của NGƯỜI DÙNG THỬ (chỉ tồn tại TRONG giao dịch) ở các bảng KHÔNG có khoá ngoại tới `users`
 * (`audit_logs`, `ai_pending_actions`) bằng một KẾT NỐI RIÊNG (khác kết nối của giao dịch). Hàng của giao dịch chưa commit KHÔNG nhìn thấy từ kết nối khác ⇒ mọi hàng đếm được = đã ghi NGOÀI giao dịch.
 * Chỉ SELECT; chỉ chạy trên CSDL có tên chứa `aoi_management_test`; kết nối riêng đóng ngay.
 * (Ghi chú đo thật 16/11: bản cổng sai cwd để lại 6 cặp audit_logs + ai_pending_actions mang đúng userId của người dùng thử đã rollback — bảng không có FK nên ghi vẫn thành công.)
 */
import postgres from "postgres";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { tomTatGoi, type KenhGiaoDich } from "./kenhGiaoDich";

export interface HangRoRi {
  audit_logs: number;
  ai_pending_actions: number;
  tong: number;
}

/** Bộ thực thi truy vấn thô — một giao dịch drizzle (`tx`) thoả. Có nó thì ĐẾM TRONG giao dịch (thấy cả hàng chưa commit): dùng để chứng minh bộ đếm KHÔNG mù. */
export interface BoThucThiDem {
  execute: (truyVan: SQL) => PromiseLike<unknown>;
}

/** Kết quả `execute` của drizzle/postgres-js là mảng hàng; bản khác trả `{ rows }`. */
function docSo(kq: unknown): number {
  const hang = Array.isArray(kq) ? kq : ((kq as { rows?: unknown[] } | null)?.rows ?? []);
  return Number((hang[0] as { n?: unknown } | undefined)?.n ?? 0);
}

/** MỘT nguồn SQL cho cả hai đường đo: hai truy vấn đếm theo userId, qua BẤT KỲ bộ thực thi nào (tx của ca kiểm, hoặc kết nối riêng bọc ở dưới). */
async function demQua(thucThi: BoThucThiDem, userId: number): Promise<HangRoRi> {
  const audit_logs = docSo(await thucThi.execute(sql`select count(*)::int as n from audit_logs where "userId" = ${userId}`));
  const ai_pending_actions = docSo(await thucThi.execute(sql`select count(*)::int as n from ai_pending_actions where "userId" = ${userId}`));
  return { audit_logs, ai_pending_actions, tong: audit_logs + ai_pending_actions };
}

/**
 * Mặc định (không `thucThi`): kết nối RIÊNG ⇒ chỉ thấy hàng ĐÃ commit ⇒ mọi hàng đếm được mang userId của người dùng thử = rò rỉ.
 * Có `thucThi` (tx): đếm trong chính giao dịch ⇒ thấy hàng chưa commit (ca kiểm bộ đếm: chèn 1 + 1 rồi đếm phải ra 1 + 1).
 * ★ Hai đường chạy CÙNG `demQua` (một nguồn SQL): ca {1,1} qua tx kiểm đúng mã mà đường đo rò thật chạy — kết nối riêng chỉ là bộ thực thi bọc `postgres`.
 */
export async function demHangRoRi(userId: number, url: string | undefined = process.env.DATABASE_URL, thucThi?: BoThucThiDem): Promise<HangRoRi> {
  if (!url || !/aoi_management_test/.test(url)) throw new Error("demHangRoRi: chỉ chạy trên CSDL aoi_management_test (DATABASE_URL)");
  if (thucThi) return demQua(thucThi, userId);
  const kn = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => undefined });
  try {
    const phuongNgu = new PgDialect();
    return await demQua(
      {
        execute: async (truyVan) => {
          const q = phuongNgu.sqlToQuery(truyVan);
          return await kn.unsafe(q.sql, q.params as never[]);
        },
      },
      userId,
    );
  } finally {
    await kn.end({ timeout: 5 });
  }
}

/** Câu báo lỗi cho một lần rò (đưa vào `kenh.lot` ⇒ `kiemKhongLot` làm ca ĐỎ). `goi` = bản tóm tắt "ai gọi getDb qua kênh" để thấy module nào KHÔNG đi qua mock. */
export function cauBaoRoRi(r: HangRoRi, userId: number, tomTatGoi: string): string {
  return `RÒ RỈ: ${r.audit_logs} hàng audit_logs + ${r.ai_pending_actions} hàng ai_pending_actions mang userId=${userId} (người dùng thử, chỉ có trong giao dịch) đã được ghi NGOÀI giao dịch. Nơi đã đi qua kênh getDb: ${tomTatGoi || "(không lời gọi nào)"}`;
}

/**
 * Khối dùng chung ở `finally` của mọi ca phát lại (TRƯỚC khi trả kênh về null): đếm rò rỉ của `userId` và GHI vào `kenh.lot` để `kiemKhongLot` làm ca ĐỎ.
 * Đếm > 0 ⇒ `cauBaoRoRi`; bộ đếm NÉM ⇒ "KHÔNG chạy được" (không nuốt: ca không đo được thì ĐỎ, không xanh giả). `dem` tiêm được để kiểm bằng bộ đếm giả.
 */
export async function ghiNhanRoRi(kenh: KenhGiaoDich, userId: number, dem: (userId: number) => Promise<HangRoRi> = (id) => demHangRoRi(id)): Promise<void> {
  const r = await dem(userId).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  if (r instanceof Error) kenh.lot.push(`kiểm rò rỉ KHÔNG chạy được (${r.message.slice(0, 160)}) — không đo được ca này`);
  else if (r.tong > 0) kenh.lot.push(cauBaoRoRi(r, userId, tomTatGoi(kenh)));
}
