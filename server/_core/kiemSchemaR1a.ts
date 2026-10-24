/**
 * kiem-dinh P1-6 (2026-10-24) — KIỂM SCHEMA LÚC KHỞI ĐỘNG cho SCADA R1a, CHẠY TRƯỚC `startOt()`.
 *
 * Vì sao: R1a đọc cột / bảng của mig 0431 và 0432 ở đường nóng.
 *   · Thiếu 0431 ⇒ MỌI đường OT gãy (drizzle `select()` liệt kê mọi cột của `device_tags` — đo ở báo cáo nghiệm thu §4, M-1); `startOt`
 *     chạy trên một DB như vậy thì không nạp được adapter nào ⇒ trông như "không có thiết bị", KHÔNG ai biết vì sao.
 *   · Thiếu 0432 ⇒ bộ đếm TOTP sai không hỏi được ⇒ mọi lượt xác minh TOTP trả `TOTP_KHONG_KIEM_DUOC` (fail-closed) — đúng về an toàn,
 *     nhưng người dùng chỉ thấy "lỗi hệ thống".
 *
 * Hợp đồng:
 *   · Truy vấn CHỈ ĐỌC `information_schema` (không DDL, không áp migration): 7 cột R1a của `device_tags`, 3 bảng `scada_kenh_che_do` /
 *     `scada_khoa_chon` / `scada_command_attempts` (0431), bảng `totp_khoa_sai` + cột `loai` (0432).
 *   · Thiếu 0431 ⇒ một KHỐI `console.error` nổi bật gọi đúng tên migration, `/health` báo `status:"degraded"` + `schemaR1a` (lý do rõ),
 *     và KHÔNG gọi `startOt` (ghi rõ vì sao). Áp 0431 xong phải KHỞI ĐỘNG LẠI tiến trình (OT không tự nạp lại).
 *   · Thiếu 0432 ⇒ `startOt` vẫn chạy; lỗi được log lặp lại mỗi `CHU_KY_NHAC_MS` (5 phút) tới khi bảng có mặt; `/health` degraded; mỗi
 *     lần bộ đếm TOTP hỏng, log mang nguyên nhân "thiếu migration 0432" (`nguyenNhanBoDemHong`, totpKhoaSai.ts / totpOnce.ts).
 *   · Không kiểm được (DB chưa sẵn / truy vấn lỗi) ⇒ ghi cảnh báo và để `startOt` chạy như trước (nó tự thất bại nếu DB hỏng) — trạng
 *     thái `khong_kiem_duoc`, `/health` không vì thế mà degraded.
 * Không kéo DB lúc import: `chay` do người gọi truyền (test giả `information_schema`).
 */
import { sql, type SQL } from "drizzle-orm";

/** 7 cột R1a của `device_tags` (mig 0431). */
export const COT_DEVICE_TAGS_0431 = Object.freeze([
  "channel_kind",
  "display_name",
  "display_format",
  "write_min",
  "write_max",
  "write_step",
  "actuation_level",
] as const);
/** 3 bảng của mig 0431. */
export const BANG_0431 = Object.freeze(["scada_kenh_che_do", "scada_khoa_chon", "scada_command_attempts"] as const);

/** Nhắc lại lỗi thiếu 0432 mỗi 5 phút. */
export const CHU_KY_NHAC_MS = 5 * 60 * 1000;

export type ChayTruyVan = (q: SQL) => Promise<ReadonlyArray<Record<string, unknown>>>;

export interface KetQuaSchemaR1a {
  /** đối tượng còn thiếu của 0431 (`device_tags.<cột>` | `<bảng>`) — rỗng = đủ */
  thieu0431: string[];
  /** đối tượng còn thiếu của 0432 (`totp_khoa_sai` | `totp_khoa_sai.loai`) — rỗng = đủ */
  thieu0432: string[];
}

export type TrangThaiSchemaR1a =
  | { kieu: "chua_kiem" }
  | { kieu: "khong_kiem_duoc"; loi: string }
  | ({ kieu: "da_kiem"; luc: string } & KetQuaSchemaR1a);

let trangThai: TrangThaiSchemaR1a = { kieu: "chua_kiem" };

/** Trạng thái lần kiểm gần nhất của tiến trình này (cho `/health` và log của bộ đếm TOTP). */
export function trangThaiSchemaR1a(): TrangThaiSchemaR1a {
  return trangThai;
}

/** CHỈ cho test. */
export function __datTrangThaiSchemaR1a(t: TrangThaiSchemaR1a): void {
  trangThai = t;
}

/** Tiến trình này đã thấy thiếu 0432? (log nguyên nhân của bộ đếm TOTP.) */
export function biet0432Thieu(): boolean {
  return trangThai.kieu === "da_kiem" && trangThai.thieu0432.length > 0;
}

/** Truy vấn CHỈ ĐỌC information_schema ⇒ đối tượng còn thiếu của 0431 / 0432. */
export async function kiemSchemaR1a(chay: ChayTruyVan): Promise<KetQuaSchemaR1a> {
  const cot = await chay(sql`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'device_tags' AND column_name IN (${sql.join(
        COT_DEVICE_TAGS_0431.map((c) => sql`${c}`),
        sql`, `,
      )}))
      OR (table_name = 'totp_khoa_sai' AND column_name = 'loai'))`);
  const bang = await chay(sql`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (${sql.join(
      [...BANG_0431, "totp_khoa_sai"].map((b) => sql`${b}`),
      sql`, `,
    )})`);
  const coCot = new Set(cot.map((r) => `${String(r.table_name)}.${String(r.column_name)}`));
  const coBang = new Set(bang.map((r) => String(r.table_name)));
  const thieu0431 = [
    ...COT_DEVICE_TAGS_0431.filter((c) => !coCot.has(`device_tags.${c}`)).map((c) => `device_tags.${c}`),
    ...BANG_0431.filter((b) => !coBang.has(b)),
  ];
  const thieu0432 = !coBang.has("totp_khoa_sai") ? ["totp_khoa_sai"] : !coCot.has("totp_khoa_sai.loai") ? ["totp_khoa_sai.loai"] : [];
  return { thieu0431, thieu0432 };
}

/** Lý do một dòng cho `/health` (null = không có gì để báo). */
export function lyDoSchemaR1a(t: TrangThaiSchemaR1a = trangThai): { ok: false; thieuMigration: string[]; lyDo: string } | null {
  if (t.kieu !== "da_kiem") return null;
  const thieu: string[] = [];
  const phan: string[] = [];
  if (t.thieu0431.length) {
    thieu.push("0431");
    phan.push(`thiếu migration 0431 (${t.thieu0431.join(", ")}) — OT KHÔNG khởi động`);
  }
  if (t.thieu0432.length) {
    thieu.push("0432");
    phan.push(`thiếu migration 0432 (${t.thieu0432.join(", ")}) — mọi xác minh TOTP bị từ chối (TOTP_KHONG_KIEM_DUOC)`);
  }
  return thieu.length ? { ok: false, thieuMigration: thieu, lyDo: phan.join("; ") } : null;
}

function khoiLoi(dong: string[]): string {
  const vien = "█".repeat(100);
  return ["", vien, ...dong.map((d) => `█  ${d}`), vien, ""].join("\n");
}

export interface DepsKhoiDongOt {
  /** chạy một câu SQL chỉ đọc (index.ts: `db.execute`) */
  chay: ChayTruyVan | null;
  startOt: () => Promise<void>;
  /** việc chạy SAU startOt (bộ đệm giá trị hiện tại) — bỏ qua khi startOt bị bỏ qua */
  sauStartOt?: () => Promise<void>;
  logLoi?: (msg: string) => void;
  /** hẹn giờ nhắc (test truyền giả) */
  datNhac?: (fn: () => void, ms: number) => { unref?: () => void } | unknown;
  boNhac?: (h: unknown) => void;
}

/**
 * Kiểm schema R1a RỒI mới `startOt()` (index.ts gọi trong đuôi boot `listenThenStartOt`, sau `onListening`). Trả về kết cục (để test).
 */
export async function khoiDongOtCoKiemSchema(deps: DepsKhoiDongOt): Promise<"da_start" | "bo_qua_thieu_0431"> {
  const logLoi = deps.logLoi ?? ((m: string) => console.error(m));
  let kq: KetQuaSchemaR1a | null = null;
  if (deps.chay) {
    try {
      kq = await kiemSchemaR1a(deps.chay);
      trangThai = { kieu: "da_kiem", luc: new Date().toISOString(), ...kq };
    } catch (err) {
      trangThai = { kieu: "khong_kiem_duoc", loi: (err as Error)?.message ?? String(err) };
      logLoi(`[SCADA R1a] KHÔNG kiểm được schema (information_schema): ${trangThai.loi} — vẫn khởi động OT như trước.`);
    }
  } else {
    trangThai = { kieu: "khong_kiem_duoc", loi: "không có kết nối DB" };
    logLoi("[SCADA R1a] KHÔNG kiểm được schema: không có kết nối DB — vẫn khởi động OT như trước.");
  }

  if (kq && kq.thieu0432.length) {
    const bao = (thieu: string[]) =>
      logLoi(
        khoiLoi([
          "[SCADA R1a] THIẾU MIGRATION 0432 (bộ đếm TOTP sai).",
          `Còn thiếu: ${thieu.join(", ")}.`,
          "Hậu quả: MỌI lượt xác minh TOTP bị từ chối (TOTP_KHONG_KIEM_DUOC) — đăng nhập 2FA, lệnh SCADA mức 4–5, cấu hình kênh M12, deploy.",
          "Sửa: chạy scripts/apply-migration-0432.mjs trên DB này (log này nhắc lại mỗi 5 phút tới khi bảng có mặt).",
        ]),
      );
    bao(kq.thieu0432);
    const chay = deps.chay!;
    const datNhac = deps.datNhac ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    const boNhac = deps.boNhac ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout));
    const h = datNhac(() => {
      void kiemSchemaR1a(chay)
        .then((lai) => {
          if (trangThai.kieu === "da_kiem") trangThai = { ...trangThai, thieu0432: lai.thieu0432, luc: new Date().toISOString() };
          if (lai.thieu0432.length) bao(lai.thieu0432);
          else {
            boNhac(h);
            logLoi("[SCADA R1a] migration 0432 đã có mặt — bộ đếm TOTP sai hoạt động lại.");
          }
        })
        .catch(() => bao(trangThai.kieu === "da_kiem" ? trangThai.thieu0432 : ["totp_khoa_sai"]));
    }, CHU_KY_NHAC_MS);
    (h as { unref?: () => void } | null)?.unref?.();
  }

  if (kq && kq.thieu0431.length) {
    logLoi(
      khoiLoi([
        "[SCADA R1a] THIẾU MIGRATION 0431 (kênh SCADA / lệnh HMI).",
        `Còn thiếu: ${kq.thieu0431.join(", ")}.`,
        "Hậu quả: mọi truy vấn device_tags của OT gãy ⇒ OT KHÔNG ĐƯỢC KHỞI ĐỘNG (startOt bị BỎ QUA — không chạy với danh sách adapter rỗng).",
        "/health báo status \"degraded\" + schemaR1a.",
        "Sửa: chạy scripts/apply-migration-0431.mjs trên DB này RỒI KHỞI ĐỘNG LẠI tiến trình.",
      ]),
    );
    return "bo_qua_thieu_0431";
  }

  await deps.startOt();
  if (deps.sauStartOt) await deps.sauStartOt();
  return "da_start";
}
