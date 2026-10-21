/**
 * ★ Đợt 9 (audit bảo mật kiem-dinh M4 — tranh khe; dieu-phoi duyệt 2026-10-21) — TRẦN ĐỔI KHE THEO TOKEN `/v1`.
 *
 * Một token `/v1` luân phiên model nặng ép llama-server đổi khe liên tục (15–50 s mỗi lần) ⇒ mọi người khác chờ. Trần:
 * `TRAN_DOI_KHE` = 3 lần đổi khe THỰC do yêu cầu của token gây ra trong `CUA_SO_MS` = 10 phút TRƯỢT. Vượt trần ⇒ yêu cầu
 * của token đó KHÔNG được kéo đổi khe (mọi vai trò): đi model khe đang giữ (openaiGateway), nhãn `tran-doi-khe-token`.
 * Lý do N = 3: 3 × 50 s = 150 s / 600 s ⇒ một token chiếm tối đa ~25 % thời gian khe vào việc nạp; một client IDE hợp lệ
 * (code.plc ↔ code.software ↔ chat) đi trọn một vòng + quay lại một lần không chạm trần.
 *
 * Đếm khi đổi khe THỰC xảy ra (bộ lập lịch `KheNang.cho(..., khiDoiKhe)` báo lượt được vào SAU một lần đổi lúc nó chờ),
 * không đếm lúc định tuyến. Ngữ cảnh token đi qua AsyncLocalStorage (`chayVoiTokenKhe`) — lời gọi ngoài `/v1` (app,
 * Luồng) không có ngữ cảnh ⇒ không đếm, không bị trần.
 * ⚠ Trạng thái TRONG BỘ NHỚ của tiến trình: khởi động lại ⇒ reset (chấp nhận — trần chống lạm dụng ngắn hạn, không phải sổ).
 * ⚠ Xô `key-chung` DÙNG CHUNG cho mọi người dùng bearer chung (key không gắn người): một người lạm dụng thì cả nhóm bị ghim
 *   vào model khe đang giữ (vẫn được phục vụ, chỉ không ép đổi khe) — chấp nhận (dieu-phoi 2026-10-21); token cá nhân tách xô.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const TRAN_DOI_KHE = 3;
export const CUA_SO_MS = 10 * 60_000;

const kho = new AsyncLocalStorage<{ token: string }>();
const lanDoi = new Map<string, number[]>();
/** token ⇒ mốc hết cửa sổ đã log (log MỘT lần mỗi cửa sổ khi chạm trần). */
const daLogToi = new Map<string, number>();

function cat(token: string, bayGio: number): number[] {
  const ds = (lanDoi.get(token) ?? []).filter((t) => bayGio - t < CUA_SO_MS);
  if (ds.length) lanDoi.set(token, ds);
  else lanDoi.delete(token);
  return ds;
}

/** Chạy `fn` trong ngữ cảnh của một token `/v1` (khoá: `token:<id>` hoặc `key-chung`). */
export function chayVoiTokenKhe<T>(token: string, fn: () => T): T {
  return kho.run({ token }, fn);
}

/** Token của ngữ cảnh hiện tại (`undefined` = không phải lời gọi /v1). */
export function tokenKheHienTai(): string | undefined {
  return kho.getStore()?.token;
}

/** Bộ lập lịch khe báo: lượt của ngữ cảnh hiện tại vừa được vào nhờ một lần đổi khe THỰC. */
export function ghiDoiKheTheoNguCanh(): void {
  const token = kho.getStore()?.token;
  if (!token) return;
  const bayGio = Date.now();
  const ds = cat(token, bayGio);
  ds.push(bayGio);
  lanDoi.set(token, ds);
}

/** Token đã gây ≥ TRAN_DOI_KHE lần đổi khe trong cửa sổ trượt? (log một lần mỗi cửa sổ khi chạm trần) */
export function vuotTranDoiKhe(token: string | undefined): boolean {
  if (!token) return false;
  const bayGio = Date.now();
  const ds = cat(token, bayGio);
  if (ds.length < TRAN_DOI_KHE) return false;
  const hetCuaSo = ds[0] + CUA_SO_MS;
  if ((daLogToi.get(token) ?? 0) <= bayGio) {
    daLogToi.set(token, hetCuaSo);
    console.warn(
      `[khe-nang] tran-doi-khe-token: ${token} đã gây ${ds.length} lần đổi khe trong ${CUA_SO_MS / 60_000} phút — ` +
        `không cho kéo đổi khe tới ${new Date(hetCuaSo).toISOString()} (đi model khe đang giữ).`,
    );
  }
  return true;
}

/** Chỉ lưới. */
export function __xoaTranDoiKhe(): void {
  lanDoi.clear();
  daLogToi.clear();
}

/**
 * Vượt trần: model NẶNG khác model khe đang giữ ⇒ thay bằng model khe đang giữ (không kéo đổi khe), cho MỌI vai trò.
 * `model` undefined ⇒ engine sẽ dùng `modelMacDinh` ⇒ xét nó. Khe không đọc được (`giu` null) ⇒ không đoán, giữ nguyên.
 */
export function chonModelKhiVuotTran(
  model: string | undefined,
  y: { giu: string | null; laKheNang: (m: string) => boolean; modelMacDinh: string | undefined },
): { model: string | undefined; doi: boolean } {
  const se = model ?? y.modelMacDinh;
  if (!y.giu || !se || !y.laKheNang(se) || se === y.giu) return { model, doi: false };
  return { model: y.giu, doi: true };
}
