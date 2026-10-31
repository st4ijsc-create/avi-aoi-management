/**
 * Kiểm schema CHUNG lúc khởi động: mọi cột Drizzle khai phải có trên DB (CHỈ ĐỌC `information_schema`, không ghi gì, không chặn khởi động).
 * Thiếu ⇒ `console.error` nêu rõ `bang.cot` + `/readyz` báo `schema:"thieu-cot"` (HTTP vẫn theo DB; cờ này không gỡ pod khỏi traffic — migration thiếu
 * không chữa được bằng khởi động lại). Cùng hàm so với lưới cổng (`schemaCotDiff.ts`).
 *
 * Tắt: `SCHEMA_KIEM_CHUNG_ENABLED=false`, hoặc tiến trình edge (`AVI_PROCESS_ROLE=edge` — không có DB trung tâm; `getDb` đã qua bẫy `edgeDbRefused`
 * nên ở edge `chay` là null ⇒ trạng thái "tat", không dựng client nào).
 *
 * `/readyz` không xác thực ⇒ chỉ lộ cờ, KHÔNG lộ tên bảng/cột (nằm ở log).
 */
import { sql, type SQL } from "drizzle-orm";
import * as schemaBarrel from "../../drizzle/schema";
import * as schemaSecurity from "../../drizzle/schema/security";
import * as schemaSynapseObs from "../../drizzle/schema/synapseObservability";
import { bangKhaiTuModule, gomCotDb, tinhThieu } from "./schemaCotDiff";
import { isEdgeProcessRole } from "./edgeDbTrap";

/**
 * Nguồn bảng của tiến trình chạy thật. Barrel `index.ts` KHÔNG export mọi tệp (security, synapseObservability nằm ngoài) — liệt kê thêm ở đây;
 * `drizzleSchemaVsDb.db.test.ts` canh: bảng nào tìm thấy qua glob mà không có trong danh sách này ⇒ đỏ (tệp schema mới quên thêm).
 */
export const NGUON_SCHEMA_RUNTIME: ReadonlyArray<Record<string, unknown>> = [schemaBarrel, schemaSecurity, schemaSynapseObs];

export type ChaySql = (q: SQL) => Promise<ReadonlyArray<Record<string, unknown>>>;

export type TrangThaiSchemaChung =
  | { kieu: "chua_kiem" }
  | { kieu: "tat" }
  | { kieu: "khong_kiem_duoc" }
  | { kieu: "du"; soBang: number }
  | { kieu: "thieu_cot"; thieu: string[] };

let trangThai: TrangThaiSchemaChung = { kieu: "chua_kiem" };
export function trangThaiSchemaChung(): TrangThaiSchemaChung { return trangThai; }
/** CHỈ cho test. */
export function __datTrangThaiSchemaChung(t: TrangThaiSchemaChung): void { trangThai = t; }

/** Giá trị cho `/readyz`: "thieu-cot" khi đã thấy thiếu, ngược lại null (khoá vắng). */
export function schemaChoReadyz(): "thieu-cot" | null {
  return trangThai.kieu === "thieu_cot" ? "thieu-cot" : null;
}

export function kiemSchemaChungBat(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.SCHEMA_KIEM_CHUNG_ENABLED ?? "").trim().toLowerCase() !== "false" && !isEdgeProcessRole(env);
}

const GIOI_HAN_LOG = 60;

/**
 * Chạy MỘT lần. `chay` null ⇒ không có DB ("khong_kiem_duoc", fail-open, không ném). Không bao giờ ném.
 */
export async function kiemSchemaChungKhiKhoiDong(opts: {
  chay: ChaySql | null;
  env?: NodeJS.ProcessEnv;
  modules?: ReadonlyArray<Record<string, unknown>>;
  log?: (msg: string) => void;
}): Promise<TrangThaiSchemaChung> {
  const log = opts.log ?? ((m: string) => console.error(m));
  if (!kiemSchemaChungBat(opts.env)) return (trangThai = { kieu: "tat" });
  if (!opts.chay) return (trangThai = { kieu: "khong_kiem_duoc" });
  try {
    const rows = await opts.chay(sql`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`);
    const khai = bangKhaiTuModule(opts.modules ?? NGUON_SCHEMA_RUNTIME);
    const thieu = tinhThieu(khai, gomCotDb(rows as ReadonlyArray<{ t: unknown; c: unknown }>));
    if (thieu.length === 0) return (trangThai = { kieu: "du", soBang: khai.length });
    trangThai = { kieu: "thieu_cot", thieu };
    log(
      `[Schema] ⛔ ${thieu.length} cột/bảng Drizzle khai mà DB CHƯA CÓ (mã lên trước migration?) — mọi câu INSERT/select() chạm bảng đó sẽ nổ: ` +
        thieu.slice(0, GIOI_HAN_LOG).join(", ") + (thieu.length > GIOI_HAN_LOG ? ` … (+${thieu.length - GIOI_HAN_LOG})` : "") +
        ". Áp migration tương ứng; /readyz báo schema:\"thieu-cot\".",
    );
    return trangThai;
  } catch (err) {
    console.error("[Schema] không kiểm được cột Drizzle ⊆ DB lúc khởi động:", (err as Error)?.message || err);
    return (trangThai = { kieu: "khong_kiem_duoc" });
  }
}
