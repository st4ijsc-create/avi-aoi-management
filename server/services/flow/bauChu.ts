/**
 * ★★ Đợt 8.0 — BẦU CHỦ cho bộ kích hoạt (lịch, poll): chỉ MỘT tiến trình bắn trigger dù có nhiều tiến trình API/worker
 * (lỗ đã biết: 12 bộ lập lịch node-cron không bầu chủ ⇒ chạy đôi). `pg_try_advisory_lock` trên MỘT kết nối giữ riêng:
 * khoá sống theo kết nối ⇒ tiến trình chết ⇒ Postgres tự nhả, tiến trình khác giành được ở lượt thử kế.
 */
import { openSessionClient } from "../../db/connection";

export interface QuyenChu {
  la: boolean;
  nha(): Promise<void>;
}

export async function giuQuyenChu(ten: string, url = process.env.DATABASE_URL): Promise<QuyenChu> {
  if (!url) return { la: false, nha: async () => {} };
  // Phiên riêng qua nhà máy client có bẫy edge (không import driver ở đây). Edge / không cấu hình ⇒ null ⇒ KHÔNG ai là chủ (Luồng không chạy trên edge), không treo.
  const sql = openSessionClient("bau-chu", url);
  if (!sql) return { la: false, nha: async () => {} };
  try {
    const [r] = await sql`SELECT pg_try_advisory_lock(hashtext(${`ai-flow:${ten}`})) AS la`;
    if (!r.la) {
      await sql.end();
      return { la: false, nha: async () => {} };
    }
    let daNha = false;
    return {
      la: true,
      async nha() {
        if (daNha) return;
        daNha = true;
        try {
          await sql`SELECT pg_advisory_unlock(hashtext(${`ai-flow:${ten}`}))`;
        } finally {
          await sql.end();
        }
      },
    };
  } catch {
    await sql.end().catch(() => {});
    return { la: false, nha: async () => {} };
  }
}
