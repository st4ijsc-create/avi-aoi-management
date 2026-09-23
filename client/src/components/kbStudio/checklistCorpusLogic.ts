/**
 * R5 (kế hoạch AI Local 2026-09-22 §4) — CHECKLIST 4 BƯỚC CÓ TRẠNG THÁI, đọc từ DỮ LIỆU THẬT thay cho
 * bốn đoạn chữ hướng dẫn: (1) corpus · (2) đã nạp (kèm kiểm máy R4) · (3) đã đánh giá (bộ vàng + lượt R1)
 * · (4) điểm. Thuần — trang chỉ đổ dữ liệu tRPC vào đây, lưới khoá cách suy trạng thái.
 *
 * ★ "Không biết" ≠ "chưa": dữ liệu đang tải ⇒ `dang-tai`, không vẽ dấu ✗ oan.
 * ★ Điểm CŨ hơn lần nạp cuối ⇒ `canh-bao` (số đó đo corpus trước khi đổi) — không được hiện như xanh.
 */
export type TrangThaiBuoc = "xong" | "chua" | "canh-bao" | "dang-tai";

export interface BuocChecklist {
  id: "corpus" | "nap" | "danh-gia" | "diem";
  trangThai: TrangThaiBuoc;
  /** Khoá i18n phần chi tiết + tham số — trang tự dịch. */
  khoa: string;
  thamSo?: Record<string, string | number>;
}

export interface DauVaoChecklist {
  tenCorpus: string;
  /** `undefined` = đang tải. */
  corpora?: Array<{ name: string; chunkCount: number; lastIngestAt: string | Date | null }>;
  /** Job của corpus này (mới nhất trước); `undefined` = đang tải / chưa hỏi. */
  jobs?: Array<{ status: string; sourceRef?: string; createdAt?: string | Date; ketQuaMay?: { canhBao: Array<{ muc: string }> } | null }>;
  boVang?: Array<{ ten: string; soCauTrong: number; soDongLoi: number }>;
  /** Lượt eval của corpus này (mới nhất trước). */
  luot?: Array<{ trangThai: string; createdAt: string | Date; tongHop: unknown }>;
}

const thoiGian = (x: string | Date | null | undefined) => (x ? new Date(x).getTime() : null);
const pt = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? `${Math.round(x * 100)} %` : "—");

export function dungChecklist(v: DauVaoChecklist): BuocChecklist[] {
  const ten = v.tenCorpus.trim();
  const dk = v.corpora?.find((c) => c.name === ten);

  const buoc1: BuocChecklist = !ten
    ? { id: "corpus", trangThai: "chua", khoa: "chuaChon" }
    : v.corpora === undefined
      ? { id: "corpus", trangThai: "dang-tai", khoa: "dangTai" }
      : dk
        ? { id: "corpus", trangThai: "xong", khoa: "daCo", thamSo: { ten } }
        : { id: "corpus", trangThai: "chua", khoa: "moi", thamSo: { ten } };

  let buoc2: BuocChecklist;
  if (!ten || v.corpora === undefined) buoc2 = { id: "nap", trangThai: ten ? "dang-tai" : "chua", khoa: ten ? "dangTai" : "choCorpus" };
  else if (!dk || dk.chunkCount === 0) buoc2 = { id: "nap", trangThai: "chua", khoa: "chuaNap" };
  else {
    // Chỉ job MỚI NHẤT của mỗi nguồn: nạp lại một tệp đã sửa thì cảnh báo cũ của nó hết hiệu lực.
    const moiNhat = new Map<string, NonNullable<DauVaoChecklist["jobs"]>[number]>();
    for (const j of v.jobs ?? []) if (!moiNhat.has(j.sourceRef ?? "")) moiNhat.set(j.sourceRef ?? "", j);
    const doDo = [...moiNhat.values()].filter((j) => j.ketQuaMay?.canhBao.some((c) => c.muc === "do")).length;
    buoc2 = doDo > 0
      ? { id: "nap", trangThai: "canh-bao", khoa: "napCoCanhBao", thamSo: { doan: dk.chunkCount, n: doDo } }
      : { id: "nap", trangThai: "xong", khoa: "daNap", thamSo: { doan: dk.chunkCount } };
  }

  const bo = v.boVang?.find((b) => b.ten === ten);
  const luotXong = (v.luot ?? []).find((l) => l.trangThai === "xong");
  let buoc3: BuocChecklist;
  if (!ten) buoc3 = { id: "danh-gia", trangThai: "chua", khoa: "choCorpus" };
  else if (v.boVang === undefined || v.luot === undefined) buoc3 = { id: "danh-gia", trangThai: "dang-tai", khoa: "dangTai" };
  else if (!bo) buoc3 = { id: "danh-gia", trangThai: "chua", khoa: "chuaBoVang", thamSo: { ten } };
  else if (bo.soDongLoi > 0) buoc3 = { id: "danh-gia", trangThai: "canh-bao", khoa: "boVangLoi", thamSo: { n: bo.soDongLoi } };
  else if (!luotXong) buoc3 = { id: "danh-gia", trangThai: "chua", khoa: "chuaChay", thamSo: { cau: bo.soCauTrong } };
  else buoc3 = { id: "danh-gia", trangThai: "xong", khoa: "daChay", thamSo: { cau: bo.soCauTrong, luot: (v.luot ?? []).length } };

  let buoc4: BuocChecklist;
  if (!luotXong) buoc4 = { id: "diem", trangThai: buoc3.trangThai === "dang-tai" ? "dang-tai" : "chua", khoa: "chuaCoDiem" };
  else {
    const th = (luotXong.tongHop ?? {}) as { trungNguon?: number | null; duongOng?: number | null };
    const thamSo = { trung: pt(th.trungNguon), toi: pt(th.duongOng) };
    // Mốc nạp = job THÀNH CÔNG mới nhất (job thất bại không đổi corpus); không có danh sách job ⇒ mốc registry.
    const mocNap = v.jobs
      ? Math.max(0, ...v.jobs.filter((j) => j.status === "succeeded").map((j) => thoiGian(j.createdAt) ?? 0))
      : (thoiGian(dk?.lastIngestAt) ?? 0);
    const napSau = mocNap > (thoiGian(luotXong.createdAt) ?? 0);
    buoc4 = napSau
      ? { id: "diem", trangThai: "canh-bao", khoa: "diemCu", thamSo }
      : { id: "diem", trangThai: "xong", khoa: "diem", thamSo };
  }
  return [buoc1, buoc2, buoc3, buoc4];
}
