/**
 * Phát hiện RÒ RỈ ra ngoài giao dịch ROLLBACK của ca phát lại: đếm hàng mang `userId` của NGƯỜI DÙNG THỬ (chỉ tồn tại TRONG giao dịch) ở các bảng KHÔNG có khoá ngoại tới `users`
 * (`audit_logs`, `ai_pending_actions`) bằng một KẾT NỐI RIÊNG (khác kết nối của giao dịch). Hàng của giao dịch chưa commit KHÔNG nhìn thấy từ kết nối khác ⇒ mọi hàng đếm được = đã ghi NGOÀI giao dịch.
 * Chỉ SELECT; chỉ chạy trên CSDL có tên chứa `aoi_management_test`; kết nối riêng đóng ngay.
 * (Ghi chú đo thật 16/11: bản cổng sai cwd để lại 6 cặp audit_logs + ai_pending_actions mang đúng userId của người dùng thử đã rollback — bảng không có FK nên ghi vẫn thành công.)
 */
import postgres from "postgres";

export interface HangRoRi {
  audit_logs: number;
  ai_pending_actions: number;
  tong: number;
}

export async function demHangRoRi(userId: number, url: string | undefined = process.env.DATABASE_URL): Promise<HangRoRi> {
  if (!url || !/aoi_management_test/.test(url)) throw new Error("demHangRoRi: chỉ chạy trên CSDL aoi_management_test (DATABASE_URL)");
  const sql = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => undefined });
  try {
    const [a] = await sql`select count(*)::int as n from audit_logs where "userId" = ${userId}`;
    const [p] = await sql`select count(*)::int as n from ai_pending_actions where "userId" = ${userId}`;
    const audit_logs = Number(a?.n ?? 0);
    const ai_pending_actions = Number(p?.n ?? 0);
    return { audit_logs, ai_pending_actions, tong: audit_logs + ai_pending_actions };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Câu báo lỗi cho một lần rò (đưa vào `kenh.lot` ⇒ `kiemKhongLot` làm ca ĐỎ). `goi` = bản tóm tắt "ai gọi getDb qua kênh" để thấy module nào KHÔNG đi qua mock. */
export function cauBaoRoRi(r: HangRoRi, userId: number, tomTatGoi: string): string {
  return `RÒ RỈ: ${r.audit_logs} hàng audit_logs + ${r.ai_pending_actions} hàng ai_pending_actions mang userId=${userId} (người dùng thử, chỉ có trong giao dịch) đã được ghi NGOÀI giao dịch. Nơi đã đi qua kênh getDb: ${tomTatGoi || "(không lời gọi nào)"}`;
}
