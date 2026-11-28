// URGENT bền của A2(n) (H37 và các kind khác) — logic thuần cho thẻ ở vùng URGENT (hợp đồng scada-master 13/11, hop-dong-scada-ui-urgent.md).
// Nguồn bền DUY NHẤT: bảng `notifications`, MỘT hàng mỗi người nhận (`notification.list`, chỉ hàng của chính người đăng nhập).
// Nhận diện: priority "URGENT" + entityType "orchestration_run" + metadata.kind bắt đầu bằng `foe_outcome_unknown_` HOẶC thuộc KIND_URGENT_P2.
// Luật: thẻ KHÔNG tự rời; "đã đọc" chỉ là markAsRead của chính người xem (không phải "đã xử lý"); không có nút xoá / "đánh dấu tất cả".

export const TIEN_TO_KIND = "foe_outcome_unknown_";

/** Kind URGENT, soi gương CANH_BAO_KHONG_RO_KIND (foeKetCucKhongRo.ts, tìm theo tên). Mỗi kind một nhãn `urgent.kind.<kind>` vi/en/zh. */
export const KIND_URGENT_A2N = [
  "compensation_held",
  "stop_compensation_sent",
  "stop_compensation_simulated",
  "stop_compensation_unconfirmed",
  "stop_compensation_not_handed",
  "no_compensation",
  "approved_compensation_unconfirmed",
  "approved_compensation_not_sent",
  "compensation_not_sent_run_failed",
  "compensation_outcome_unknown",
  "write_in_flight_at_latch",
  "forward_not_sent",
  "run_end",
  "stop_untaken_branch",
  "stop_not_sent",
  "stop_unconfirmed_read",
  "stop_pin_mismatch",
  "stop_pin_mismatch_not_sent",
  "abort_stop_not_sent",
  "abort_definition_unread",
  "abort_sweep_unfinished",
  "stop_ended_unswept",
  "edge_stream_stuck",
  "edge_sync_refused",
  "boot_stop_not_sent_held",
  "boot_run_unconfirmed",
].map((k) => `${TIEN_TO_KIND}${k}`);

/** Bốn kind URGENT của P2 (bù trừ bị ngắt lúc boot; nguồn canhBaoBuTruBiNgat, foeEngine.ts) — danh sách ĐÓNG, so NGUYÊN TÊN, không so tiền tố
 *  (tên audit cùng họ như foe_stop_compensation_boot KHÔNG thuộc). Mỗi kind một nhãn `urgent.kind.<kind>` vi/en/zh. */
export const KIND_URGENT_P2: readonly string[] = [
  "foe_compensation_interrupted_held",
  "foe_compensation_interrupted_failed",
  "foe_stop_compensation_resent_at_boot",
  "foe_stop_compensation_pending_at_boot",
];

/** X-EDGE-ABORT-TUOI — kind URGENT của lượt quét STOP bị giữ ở nút (abort trung tâm đã quá cửa sổ / không rõ giờ; nguồn edgeConfigCentral.alertAbortStopsWithheld).
 *  Danh sách ĐÓNG, so NGUYÊN TÊN. Một nhãn `urgent.kind.<kind>` vi/en/zh. */
export const KIND_URGENT_EDGE_ABORT: readonly string[] = ["edge_abort_stops_withheld"];

/** Kind có nhắc "ghim" (kind 16–18): vùng URGENT hiện chú giải "ghim" MỘT lần khi có ít nhất một thẻ thuộc nhóm này. */
export const KIND_NHAC_GHIM: readonly string[] = ["stop_unconfirmed_read", "stop_pin_mismatch", "stop_pin_mismatch_not_sent"].map((k) => `${TIEN_TO_KIND}${k}`);

export type HangThongBao = {
  id: number;
  type?: string | null;
  priority?: string | null;
  title?: string | null;
  message?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  isRead?: boolean | null;
  readAt?: string | Date | null;
  createdAt?: string | Date | null;
  metadata?: unknown;
};

export type TheUrgent = {
  id: number;
  runId: number | null;
  kind: string;
  /** khoá nhãn đã biết ⇒ `urgent.kind.<kind>`; kind lạ ⇒ null (hiện `title` của server, KHÔNG BAO GIỜ ẩn). */
  khoaNhan: string | null;
  title: string;
  message: string;
  isRead: boolean;
  readAt: number | null;
  createdAt: number | null;
  nhacGhim: boolean;
};

const ms = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const n = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

export function kindCuaHang(h: HangThongBao): string | null {
  const m = h.metadata;
  if (m && typeof m === "object" && "kind" in m) {
    const k = (m as { kind?: unknown }).kind;
    if (typeof k === "string") return k;
  }
  return null;
}

/** Hàng có thuộc vùng URGENT bền không: kind đúng tiền tố A2(n) (kể cả kind lạ ⇒ hiện bằng `title`) hoặc đúng một trong KIND_URGENT_P2. */
export function laUrgentA2n(h: HangThongBao): boolean {
  if (h.priority !== "URGENT" || h.entityType !== "orchestration_run") return false;
  const k = kindCuaHang(h);
  return k != null && (k.startsWith(TIEN_TO_KIND) || KIND_URGENT_P2.includes(k) || KIND_URGENT_EDGE_ABORT.includes(k));
}

export function thanhThe(h: HangThongBao): TheUrgent {
  const kind = kindCuaHang(h) ?? "";
  return {
    id: h.id,
    runId: typeof h.entityId === "number" ? h.entityId : null,
    kind,
    khoaNhan: KIND_URGENT_A2N.includes(kind) || KIND_URGENT_P2.includes(kind) || KIND_URGENT_EDGE_ABORT.includes(kind) ? `urgent.kind.${kind}` : null,
    title: h.title ?? "",
    message: h.message ?? "",
    isRead: h.isRead === true,
    readAt: ms(h.readAt),
    createdAt: ms(h.createdAt),
    nhacGhim: KIND_NHAC_GHIM.includes(kind),
  };
}

export type PhanNhomUrgent = { chuaDoc: TheUrgent[]; daDoc: TheUrgent[] };

/** Lọc + tách nhóm; MỚI NHẤT trên cùng (createdAt giảm dần, hoà ⇒ id giảm dần). KHÔNG bao giờ bỏ thẻ vì đã đọc. */
export function phanNhomUrgent(rows: readonly HangThongBao[]): PhanNhomUrgent {
  const the = rows.filter(laUrgentA2n).map(thanhThe);
  the.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id - a.id);
  return { chuaDoc: the.filter((x) => !x.isRead), daDoc: the.filter((x) => x.isRead) };
}

/** Tối đa 3 thẻ chưa đọc hiện đủ; phần còn lại gộp "+N URGENT khác" (mở danh sách). */
export const TOI_DA_THE_HIEN = 3;

export function catTheHien(chuaDoc: readonly TheUrgent[], moHet: boolean): { hien: TheUrgent[]; conLai: number } {
  if (moHet || chuaDoc.length <= TOI_DA_THE_HIEN) return { hien: [...chuaDoc], conLai: 0 };
  return { hien: chuaDoc.slice(0, TOI_DA_THE_HIEN), conLai: chuaDoc.length - TOI_DA_THE_HIEN };
}

/** Đường tới run (thẻ tự dựng từ entityId; actionUrl của server là null). Trang Orchestration chưa đọc ?run= — xem ghi chú bàn giao. */
export function duongToiRun(runId: number): string {
  return `/orchestration-studio?run=${runId}`;
}

export type TuoiNgan = { loai: "giay"; n: number } | { loai: "phut"; m: number; s: number } | { loai: "gio"; h: number; m: number } | { loai: "ngay"; d: number; h: number };

/** Tuổi bản ghi thành các phần để dịch (urgent.tuoi.*). Âm (đồng hồ lệch) ⇒ 0 giây — không bao giờ in số âm. */
export function tuoiNgan(msTuoi: number): TuoiNgan {
  const t = Math.max(0, Math.floor(msTuoi / 1000));
  if (t < 60) return { loai: "giay", n: t };
  if (t < 3600) return { loai: "phut", m: Math.floor(t / 60), s: t % 60 };
  if (t < 86400) return { loai: "gio", h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60) };
  return { loai: "ngay", d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600) };
}
