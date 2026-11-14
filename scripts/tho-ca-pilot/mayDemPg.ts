/**
 * HA-6b (phần 1) — bộ đếm hàng bằng postgres.js cho `hauQua.ts`. CHỈ SELECT count(*) / information_schema; định danh (bảng, cột) phải khớp
 * ^[a-z_][a-z0-9_]{0,62}$ VÀ có trong information_schema.columns / tables của schema public (bảng thường HOẶC VIEW; loại khác ⇒ lý do nêu đúng loại), rồi mới trích dẫn bằng sql(…); GIÁ TRỊ LIKE/= là tham số BIND
 * (không bao giờ nội suy vào chuỗi SQL). Vai kết nối do bộ chạy quyết (tho_ca_test, đã kiểm ở kiemChoPhepDb) — module này không tự chọn URL.
 */
import { escapeLike, RE_DINH_DANH_HOP_LE, type MayDem, type MucDem } from "./hauQua";

/** Phần của postgres.js mà module dùng: thẻ mẫu → hàng; `sql(định danh)` → mảnh định danh. */
export interface SqlDem {
  (cau: TemplateStringsArray, ...giaTri: unknown[]): PromiseLike<Array<Record<string, unknown>>>;
  (dinhDanh: string): unknown;
}

/** Loại đối tượng bộ đếm đếm được bằng SELECT count(*): bảng thường và VIEW (vd `device_pending_stops` là VIEW). Vẫn CHỈ SELECT. */
const LOAI_DEM_DUOC: ReadonlySet<string> = new Set(["BASE TABLE", "VIEW"]);

function chiDinhDanhHopLe(...ds: Array<string | undefined>): void {
  for (const d of ds) if (d !== undefined && !RE_DINH_DANH_HOP_LE.test(d)) throw new Error("định danh không hợp lệ");
}

export function mayDemPostgres(sql: SqlDem): MayDem {
  return {
    async kiemDinhDanh(m: MucDem) {
      chiDinhDanhHopLe(m.bang, m.cot);
      const bang = await sql`select table_type from information_schema.tables where table_schema = 'public' and table_name = ${m.bang}`;
      // information_schema.tables chỉ liệt kê đối tượng mà vai hiện tại có quyền ⇒ rỗng = không có HOẶC không có quyền
      if (bang.length === 0) return `bảng "${m.bang}" không có trong schema public (hoặc vai không có quyền trên nó)`;
      const loai = String(bang[0]?.table_type);
      if (!LOAI_DEM_DUOC.has(loai)) return `"${m.bang}" là ${loai}, bộ đếm chỉ nhận BASE TABLE hoặc VIEW`;
      if (m.cot) {
        const cot = await sql`select 1 as ok from information_schema.columns where table_schema = 'public' and table_name = ${m.bang} and column_name = ${m.cot}`;
        if (cot.length === 0) return `cột "${m.bang}.${m.cot}" không có trong schema public`;
      }
      return null;
    },
    async dem(m: MucDem) {
      chiDinhDanhHopLe(m.bang, m.cot);
      let hang: Array<Record<string, unknown>>;
      if (!m.cot) hang = await sql`select count(*)::int as n from ${sql(m.bang)}`;
      else if (m.toanTu === "LIKE") hang = await sql`select count(*)::int as n from ${sql(m.bang)} where ${sql(m.cot)}::text like ${escapeLike(m.giaTri ?? "")} escape '\\'`;
      else hang = await sql`select count(*)::int as n from ${sql(m.bang)} where ${sql(m.cot)}::text = ${m.giaTri ?? ""}`;
      return Number(hang[0]?.n);
    },
  };
}

/** Mở kết nối đếm từ URL (vai tho_ca_test) — nạp postgres lười; trả bộ đếm + hàm đóng. KHÔNG dùng khi không có `--cho-phep-db`. */
export async function moMayDemTuUrl(url: string): Promise<{ may: MayDem; dong: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => undefined });
  return { may: mayDemPostgres(sql as unknown as SqlDem), dong: () => sql.end({ timeout: 5 }) };
}
