/**
 * Đợt 10.2 (extension 0.4.0) — Ô CHỌN MODEL ở khung chat: logic THUẦN (không biết `vscode`).
 *
 * Hợp đồng máy chủ: `server/services/ai/chonModel/kieu.ts` — mã `auto | vai-tro:<id> | ho-so:<profileId> | ngoai:<ncc>:<model>`.
 * Danh mục lấy qua tRPC `aiChonModel.danhMuc` (cùng cách `repoWorkspace.listProjects`, bằng cookie phiên). Extension KHÔNG tự dựng mã:
 * chỉ gửi mã nằm trong danh mục máy chủ trả (hoặc `auto`). `auto` ⇒ KHÔNG gửi trường (payload không đổi một byte).
 *   • Trợ lý (KB): `context.chonModel` trong thân `/api/ai/local-kb/stream`.
 *   • Agent: trường `model` của `/v1/chat/completions` nhận đúng mã danh mục (kiemModelV1.ts); `auto` ⇒ giữ `aviAiLocal.agentModel`.
 */
export const KHOA_CHON_MODEL = "aviAiLocal.chonModel";

/** Bản sao hình dạng hợp lệ của máy chủ — `census.unit.test.ts`/`chonModel.unit.test.ts` so khớp NGUỒN hai phía. */
export const CHON_MODEL_RE =
  /^(auto|vai-tro:[a-z][a-z0-9]*(\.[a-z0-9-]+)?|ho-so:[A-Za-z0-9._@-]{1,96}|ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:-]{1,96})$/;

/** Vai KHÔNG sinh chữ — ẩn khỏi ô (máy chủ cũng từ chối). */
export const VAI_KHONG_SINH_CHU: ReadonlySet<string> = new Set(["embed", "rerank", "vision", "fim"]);

export type TrangThaiMuc = "san-sang" | "can-doi-khe" | "tat";
export interface MucModel {
  ma: string;
  loai: "auto" | "vai-tro" | "ho-so" | "ngoai";
  nhan: string;
  moTa: string;
  trangThai: TrangThaiMuc;
  uocTinhDoiKheGiay?: number;
  duocDungO?: string[];
}

const LOAI = new Set(["auto", "vai-tro", "ho-so", "ngoai"]);
const TRANG_THAI = new Set(["san-sang", "can-doi-khe", "tat"]);

/** Mục `ngoai:*` chỉ vào ô của extension khi máy chủ khai phục vụ CẢ Trợ lý (`chat`) lẫn Agent (`agent`) — ô là MỘT điều khiển cho cả hai đường (10.4 T0). */
export function duocDungOExtension(duocDungO: readonly string[] | undefined): boolean {
  return Array.isArray(duocDungO) && duocDungO.includes("chat") && duocDungO.includes("agent");
}

/** Phản hồi tRPC (đã bóc superjson) → danh mục sạch. Phần tử sai hình dạng / mã ngoài regex / vai không sinh chữ bị BỎ; luôn có "auto" đứng đầu. */
export function chuanHoaDanhMuc(tho: unknown): MucModel[] {
  const mang = Array.isArray(tho) ? tho : [];
  const ra: MucModel[] = [{ ma: "auto", loai: "auto", nhan: "Tự động", moTa: "", trangThai: "san-sang" }];
  const thay = new Set<string>(["auto"]);
  for (const p of mang) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const ma = typeof o.ma === "string" ? o.ma : "";
    if (!CHON_MODEL_RE.test(ma) || thay.has(ma)) continue;
    if (typeof o.loai !== "string" || !LOAI.has(o.loai) || o.loai === "auto") continue;
    if (ma.startsWith("vai-tro:") && VAI_KHONG_SINH_CHU.has(ma.slice("vai-tro:".length))) continue;
    const duocDungO = Array.isArray(o.duocDungO) ? o.duocDungO.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
    if (o.loai === "ngoai" && !duocDungOExtension(duocDungO)) continue;
    const trangThai = typeof o.trangThai === "string" && TRANG_THAI.has(o.trangThai) ? (o.trangThai as TrangThaiMuc) : "tat";
    thay.add(ma);
    ra.push({
      ma,
      loai: o.loai as MucModel["loai"],
      nhan: typeof o.nhan === "string" && o.nhan.trim() ? o.nhan.slice(0, 120) : ma,
      moTa: typeof o.moTa === "string" ? o.moTa.slice(0, 300) : "",
      trangThai,
      ...(typeof o.uocTinhDoiKheGiay === "number" && Number.isFinite(o.uocTinhDoiKheGiay) ? { uocTinhDoiKheGiay: o.uocTinhDoiKheGiay } : {}),
    });
  }
  return ra;
}

/** Giá trị đã lưu → mã hợp lệ hoặc "auto". */
export function chuanHoaChon(gt: unknown): string {
  return typeof gt === "string" && CHON_MODEL_RE.test(gt) ? gt : "auto";
}

/** Mã còn dùng được theo danh mục? Danh mục chưa tải (chỉ "auto") ⇒ KHÔNG kết luận (giữ nguyên). */
export function xacThucChon(ma: string, dm: readonly MucModel[]): string {
  if (ma === "auto" || dm.length <= 1) return ma;
  const m = dm.find((x) => x.ma === ma);
  return !m || m.trangThai === "tat" ? "auto" : ma;
}

/** `model` gửi cho `/v1` của Agent: chọn cụ thể ⇒ mã đó; auto/lạ ⇒ cấu hình `aviAiLocal.agentModel`. */
export function modelChoAgent(chon: string | undefined, cauHinh: string): string {
  const c = chuanHoaChon(chon);
  return c === "auto" ? cauHinh : c;
}

/** Hậu tố trạng thái cho nhãn `<option>` (chữ thuần, không HTML). */
export function hauToTrangThai(m: Pick<MucModel, "trangThai" | "uocTinhDoiKheGiay">): string {
  if (m.trangThai === "san-sang") return "";
  if (m.trangThai === "tat") return " — tắt";
  return m.uocTinhDoiKheGiay !== undefined ? ` — cần đổi khe ~${Math.round(m.uocTinhDoiKheGiay)} s` : " — cần đổi khe (chưa đo)";
}
