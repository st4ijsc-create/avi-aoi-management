// T12b — toast của Abort / Từ chối / Gửi lại STOP theo BÁO CÁO THẬT của `abortStops` (hợp đồng scada-master 13/11, 13a mục 8c).
// Luật: "sent" = bộ điều phối NHẬN, không phải "máy đã xác nhận"; KHÔNG toast.success khi không có STOP nào đi (sent = 0) hoặc khi báo cáo
// nói còn điều chưa biết / còn nợ (khongDocDuoc, quetChuaXong, nhapQuet, khongBen, phanLoai có lop "no"). Hàm thuần, kiểm được không cần DOM.

export type AbortStopsBaoCao = {
  sent: string[];
  failed: string[];
  pending: string[];
  unverified: string[];
  untakenBranch: string[];
  notPinned: string[];
  notNeeded?: string[];
  khongDocDuoc?: boolean;
  quetChuaXong?: boolean;
  nhapQuet?: boolean;
  phanLoai?: Record<string, { lop: string; truoc?: string; khoaThu?: number }>;
  /** H38: các id trong `sent` mà lần giao chỉ MÔ PHỎNG (không tới thiết bị). Trường tuỳ chọn — thiếu thì nhánh này không chạy. */
  moPhong?: string[];
  chuaKhoa?: boolean;
  khongBen?: string[];
  khongGuiLai?: string[];
  ghimNgoaiCua?: string[];
};

/** Khoá "vì sao chưa biết" — mỗi khoá có nhãn dịch ở `studio.abortWhy.<khoá>`. */
export type LyDoChuaBiet = "khongDocDuoc" | "quetChuaXong" | "nhapQuet" | "khongBen" | "conNo" | "coTheDaRa" | "moPhong";

export type KeHoachToast = {
  /** toast đầu tiên: thành công thật / cảnh báo "chưa biết" / "không STOP nào đi" / không có (các toast riêng lo). */
  dau: "thanhCong" | "chuaBiet" | "khongStopNaoDi" | "khong";
  lyDo: LyDoChuaBiet[];
};

export function lyDoChuaBiet(s: AbortStopsBaoCao): LyDoChuaBiet[] {
  const r: LyDoChuaBiet[] = [];
  if (s.khongDocDuoc) r.push("khongDocDuoc");
  if (s.quetChuaXong) r.push("quetChuaXong");
  if (s.nhapQuet) r.push("nhapQuet");
  if ((s.khongBen?.length ?? 0) > 0) r.push("khongBen");
  if (Object.values(s.phanLoai ?? {}).some((p) => p.lop === "no")) r.push("conNo");
  // giao lại dưới khoá của lần thử cũ: câu trả lời chỉ nói cho lần thử đó, lần giao trước có tới máy không thì KHÔNG biết (foeEngine.ts:6325)
  if (s.sent.some((id) => s.phanLoai?.[id]?.lop === "coTheDaRa")) r.push("coTheDaRa");
  if ((s.moPhong?.length ?? 0) > 0) r.push("moPhong");
  return r;
}

/** Số bước THẬT SỰ giao cho bộ điều phối: `sent` trừ các id chỉ mô phỏng (không tính là "đã giao"). */
export function soGiaoThat(s: AbortStopsBaoCao): number {
  const mp = new Set(s.moPhong ?? []);
  return s.sent.filter((id) => !mp.has(id)).length;
}

/**
 * "thanhCong" CHỈ khi sent > 0 VÀ không còn việc theo ĐÚNG điều kiện của server (foeEngine.ts:6377 `conGi`): failed / pending / notPinned /
 * unverified / untakenBranch rỗng, không cờ chưa-biết, không id nào trong sent có lop "coTheDaRa", và không id nào trong sent nằm trong `moPhong`. Ngược lại không bao giờ success.
 */
export function keHoachToastAbort(s: AbortStopsBaoCao): KeHoachToast {
  const lyDo = lyDoChuaBiet(s);
  const sent = s.sent.length;
  if (lyDo.length > 0) return { dau: "chuaBiet", lyDo };
  const conViec = s.failed.length + s.pending.length + s.unverified.length + s.untakenBranch.length + s.notPinned.length > 0;
  if (sent > 0 && !conViec) return { dau: "thanhCong", lyDo };
  // còn việc (hoặc sent = 0 mà còn điều khác để nói): các toast riêng (pending / notSent / notPinned / notNeeded) nói; KHÔNG success.
  if (sent > 0 || conViec || (s.notNeeded?.length ?? 0) > 0) return { dau: "khong", lyDo };
  return { dau: "khongStopNaoDi", lyDo };
}
