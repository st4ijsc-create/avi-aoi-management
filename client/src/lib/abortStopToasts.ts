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
  phanLoai?: Record<string, { lop: string }>;
  chuaKhoa?: boolean;
  khongBen?: string[];
  khongGuiLai?: string[];
  ghimNgoaiCua?: string[];
};

/** Khoá "vì sao chưa biết" — mỗi khoá có nhãn dịch ở `studio.abortWhy.<khoá>`. */
export type LyDoChuaBiet = "khongDocDuoc" | "quetChuaXong" | "nhapQuet" | "khongBen" | "conNo";

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
  return r;
}

export function keHoachToastAbort(s: AbortStopsBaoCao): KeHoachToast {
  const lyDo = lyDoChuaBiet(s);
  const sent = s.sent.length;
  if (lyDo.length > 0) return { dau: "chuaBiet", lyDo };
  if (sent > 0) return { dau: "thanhCong", lyDo };
  // sent = 0, không có cờ "chưa biết": nếu còn điều khác để nói (lỗi / chờ / chưa xác minh / nhánh chưa xét / không ghim / không cần) thì
  // các toast riêng đã nói; còn lại thì nói thẳng "không STOP nào đi" — KHÔNG ra success "0".
  const conDieuKhac =
    s.failed.length + s.pending.length + s.unverified.length + s.untakenBranch.length + s.notPinned.length + (s.notNeeded?.length ?? 0) > 0;
  return { dau: conDieuKhac ? "khong" : "khongStopNaoDi", lyDo };
}
