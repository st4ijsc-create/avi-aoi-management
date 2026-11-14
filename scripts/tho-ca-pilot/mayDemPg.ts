/**
 * HA-6b (phần 1) — bộ đếm hàng bằng postgres.js cho `hauQua.ts`. CHỈ SELECT count(*) / information_schema; định danh (bảng, cột) phải khớp
 * ^[a-z_][a-z0-9_]{0,62}$ VÀ có trong information_schema.columns / tables của schema public (bảng thường HOẶC VIEW; loại khác ⇒ lý do nêu đúng loại), rồi mới trích dẫn bằng sql(…); GIÁ TRỊ LIKE/= là tham số BIND
 * (không bao giờ nội suy vào chuỗi SQL). Vai kết nối do bộ chạy quyết (tho_ca_test, đã kiểm ở kiemChoPhepDb) — module này không tự chọn URL.
 */
import { escapeLike, RE_DINH_DANH_HOP_LE, type MayDem, type MucDem } from "./hauQua";
import type { MayQuet } from "./quetRong";

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
      if (bang.length === 0) {
        // materialized view KHÔNG nằm trong information_schema.tables (ở pg_matviews, hiển thị cho mọi vai) ⇒ nói đúng loại thay vì "không có"
        const matview = await sql`select 1 as ok from pg_matviews where schemaname = 'public' and matviewname = ${m.bang}`;
        if (matview.length > 0) return `"${m.bang}" là MATERIALIZED VIEW, bộ đếm chỉ nhận BASE TABLE hoặc VIEW`;
        return `bảng "${m.bang}" không có trong schema public (hoặc vai không có quyền trên nó)`;
      }
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
      if (!m.cot) hang = await sql`select count(*)::int as n from ${sql("public")}.${sql(m.bang)}`;
      else if (m.toanTu === "LIKE") hang = await sql`select count(*)::int as n from ${sql("public")}.${sql(m.bang)} where ${sql(m.cot)}::text like ${escapeLike(m.giaTri ?? "")} escape '\\'`;
      else hang = await sql`select count(*)::int as n from ${sql("public")}.${sql(m.bang)} where ${sql(m.cot)}::text = ${m.giaTri ?? ""}`;
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

/** Trần thời gian MỖI bảng khi quét rộng (ms): bảng quá lớn ⇒ `null` thay vì treo lượt (HA-6d). */
export const HAN_MOI_BANG_QUET_MS = 15_000;

/**
 * HA-6d — bộ quét rộng bằng postgres.js: liệt kê bảng thường của schema public (information_schema.tables, loại BASE TABLE) và `count(*)` từng bảng. CHỈ SELECT; phiên đặt CHỈ-ĐỌC
 * (`default_transaction_read_only`) và trần thời gian mỗi câu (`statement_timeout`, mã 57014 ⇒ số `null`). Tên bảng lấy từ danh mục hệ thống và luôn đi qua `sql(…)` (trích dẫn định danh).
 */
export function mayQuetRongPostgres(sql: SqlDem, hanMs: number = HAN_MOI_BANG_QUET_MS): MayQuet {
  let daDat = false;
  const datPhien = async () => {
    if (daDat) return;
    await sql`select set_config('default_transaction_read_only', 'on', false), set_config('statement_timeout', ${String(Math.max(1, Math.floor(hanMs)))}, false)`;
    daDat = true;
  };
  return {
    async lietKe() {
      await datPhien();
      const hang = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;
      return hang.map((h) => String(h.table_name));
    },
    /** bảng public có RLS bật đối với vai hiện tại: relrowsecurity, vai không phải superuser / BYPASSRLS, và (bảng ép RLS cả chủ HOẶC vai không thuộc vai chủ bảng) */
    async bangRls() {
      await datPhien();
      const hang = await sql`select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and not exists (select 1 from pg_roles r where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)) and (c.relforcerowsecurity or not pg_has_role(current_user, c.relowner, 'MEMBER')) order by c.relname`;
      return hang.map((h) => String(h.table_name));
    },
    async dem(bang: string) {
      await datPhien();
      try {
        const hang = await sql`select count(*)::text as n from ${sql("public")}.${sql(bang)}`;
        return Number(hang[0]?.n);
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code === "57014") return null; // query_canceled (statement_timeout)
        throw e;
      }
    },
  };
}

/** Mở kết nối quét rộng từ URL (vai tho_ca_test) — chỉ khi `--quet-rong` + `--cho-phep-db`. */
export async function moMayQuetTuUrl(url: string): Promise<{ may: MayQuet; dong: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, onnotice: () => undefined });
  return { may: mayQuetRongPostgres(sql as unknown as SqlDem), dong: () => sql.end({ timeout: 5 }) };
}
