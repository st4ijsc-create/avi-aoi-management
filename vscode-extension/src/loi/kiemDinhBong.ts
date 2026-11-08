/**
 * ★★★ ĐỢT 10.4b-E (0.6.0) — nút "Kiểm định bằng AI ngoài" ở BONG BÓNG TRỢ LÝ: logic THUẦN (không biết `vscode`).
 * Hợp đồng: `docs/superpowers/plans/2026-11-03-ext-e-060-model-ngoai-hop-dong.md` §2 E1; máy chủ `server/routers/aiKiemDinhRouter.ts`.
 *
 *   · Chữ đem kiểm định đến từ BẢN GHI CỦA HOST (`BanGhiBong`, ghi lúc lượt xong) — webview chỉ gửi mã bong bóng do host cấp.
 *   · Lượt model ngoài máy chủ ĐÃ LƯU (`done.daLuu`) ⇒ nguồn THEO ID `chat` (máy chủ đọc kho, tự suy mức); còn lại ⇒ nguồn `van-ban`
 *     (`beMat: "extension"`), host tự cắt TỔNG byte UTF-8 `cauHoi + traLoi` ≤ 16 KB (không chẻ ký tự) và TỰ BIẾT cờ "đã cắt".
 *   · Mọi thứ máy chủ trả (xem trước, kết quả) là DỮ LIỆU KHÔNG TIN CẬY: đọc phòng thủ, chữ thuần, kết quả đi qua bộ render không tin cậy.
 */
import { CHON_MODEL_RE } from "./chonModel";
import { lamKhongTinCay, lamSachVanBanNgoai } from "./modelNgoai";
import { phanTichMarkdown, type NutMd } from "./markdownAnToan";

/** = `TRAN_VAN_BAN_KIEM_DINH_BYTE` của máy chủ (`server/services/ai/ngoai/nguonKiemDinh.ts`) — lưới so khớp NGUỒN hai phía. */
export const TRAN_VAN_BAN_KIEM_DINH_BYTE = 16 * 1024;
/** Khi phải cắt: câu hỏi giữ tối đa chừng này byte, phần còn lại dành cho câu trả lời (thứ được kiểm định). */
export const TRAN_CAU_HOI_KHI_CAT_BYTE = 4 * 1024;
export const NHAN_KHONG_TIN_CAY = "AI ngoài — không tin cậy";
/** Số bản ghi bong bóng host giữ (cũ nhất bị bỏ — bong bóng đó bấm sẽ bị bỏ qua). */
export const TRAN_BAN_GHI_BONG = 200;

export interface BanGhiBong {
  cauHoi: string;
  traLoi: string;
  /** Lượt model ngoài đã được MÁY CHỦ lưu: id hội thoại máy chủ + id tin trả lời. */
  daLuu?: { cuocTroChuyenId: number; tinNhanId: number };
}

export type NguonKiemDinhBong =
  | { loai: "chat"; cuocTroChuyenId: number; tinNhanId: number }
  | { loai: "van-ban"; beMat: "extension"; cauHoi: string; traLoi: string };

export interface NguonDaChon {
  nguon: NguonKiemDinhBong;
  /** Số byte UTF-8 THẬT của chữ sẽ gửi (`van-ban`); `null` với nguồn theo ID (máy chủ đọc kho). */
  soByte: number | null;
  daCat: boolean;
}

const bo = new TextEncoder();
export const soByteUtf8 = (s: string): number => bo.encode(s).length;

/** Cắt chuỗi ≤ `tran` byte UTF-8 theo ĐIỂM MÃ (không chẻ cặp thay thế / ký tự nhiều byte). */
export function catTheoByte(s: string, tran: number): string {
  if (tran <= 0) return "";
  if (soByteUtf8(s) <= tran) return s;
  let ra = "";
  let dem = 0;
  for (const c of s) {
    const b = soByteUtf8(c);
    if (dem + b > tran) break;
    ra += c;
    dem += b;
  }
  return ra;
}

const idDuong = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Bản ghi CỦA HOST → nguồn gửi máy chủ. Không bao giờ đọc gì khác ngoài bản ghi. */
export function nguonChoBanGhi(b: BanGhiBong): NguonDaChon {
  if (b.daLuu && idDuong(b.daLuu.cuocTroChuyenId) && idDuong(b.daLuu.tinNhanId)) {
    return { nguon: { loai: "chat", cuocTroChuyenId: b.daLuu.cuocTroChuyenId, tinNhanId: b.daLuu.tinNhanId }, soByte: null, daCat: false };
  }
  let cauHoi = b.cauHoi;
  let traLoi = b.traLoi;
  let daCat = false;
  if (soByteUtf8(cauHoi) + soByteUtf8(traLoi) > TRAN_VAN_BAN_KIEM_DINH_BYTE) {
    daCat = true;
    cauHoi = catTheoByte(cauHoi, TRAN_CAU_HOI_KHI_CAT_BYTE);
    traLoi = catTheoByte(traLoi, TRAN_VAN_BAN_KIEM_DINH_BYTE - soByteUtf8(cauHoi));
  }
  return { nguon: { loai: "van-ban", beMat: "extension", cauHoi, traLoi }, soByte: soByteUtf8(cauHoi) + soByteUtf8(traLoi), daCat };
}

export interface ModelKiemDinh {
  ma: string;
  nhan: string;
  moTa: string;
}

/** Danh mục THÔ (`aiChonModel.danhMuc`) → model ngoài dùng được cho kiểm định (`duocDungO ∋ "kiem-dinh"`, không tắt). */
export function danhMucKiemDinh(tho: unknown): ModelKiemDinh[] {
  const ra: ModelKiemDinh[] = [];
  const thay = new Set<string>();
  for (const p of Array.isArray(tho) ? tho : []) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const ma = typeof o.ma === "string" ? o.ma : "";
    if (o.loai !== "ngoai" || !ma.startsWith("ngoai:") || !CHON_MODEL_RE.test(ma) || thay.has(ma)) continue;
    if (!Array.isArray(o.duocDungO) || !o.duocDungO.includes("kiem-dinh")) continue;
    if (o.trangThai === "tat") continue;
    thay.add(ma);
    ra.push({
      ma,
      nhan: lamSachVanBanNgoai(typeof o.nhan === "string" && o.nhan.trim() ? o.nhan.slice(0, 120) : ma),
      moTa: lamSachVanBanNgoai(typeof o.moTa === "string" ? o.moTa.slice(0, 300) : ""),
    });
  }
  return ra;
}

export interface XemTruocKiemDinh {
  duocPhep: boolean;
  lyDo: string | null;
  tranVuot: string | null;
  mucDuLieu: string;
  tokenUoc: number | null;
  chiPhiUocUsd: number | null;
  nhaCungCap: string;
  model: string;
  trichTraLoi: string;
  doDaiTraLoi: number | null;
}

const soKhongAm = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const maNgan = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(v) ? v : null);

/** Kết quả `aiKiemDinh.xemTruoc` → bản sạch; thiếu `mucDuLieu` / `duocPhep` ⇒ `null` (không modal, không gọi `chay`). */
export function docXemTruoc(tho: unknown): XemTruocKiemDinh | null {
  if (!tho || typeof tho !== "object") return null;
  const o = tho as Record<string, unknown>;
  const muc = typeof o.mucDuLieu === "string" && /^[a-z-]{1,32}$/.test(o.mucDuLieu) ? o.mucDuLieu : null;
  if (!muc || typeof o.duocPhep !== "boolean") return null;
  return {
    duocPhep: o.duocPhep,
    lyDo: maNgan(o.lyDo),
    tranVuot: maNgan(o.tranVuot),
    mucDuLieu: muc,
    tokenUoc: soKhongAm(o.tokenUoc),
    chiPhiUocUsd: soKhongAm(o.chiPhiUocUsd),
    nhaCungCap: lamSachVanBanNgoai(typeof o.nhaCungCap === "string" ? o.nhaCungCap.slice(0, 32) : ""),
    model: lamSachVanBanNgoai(typeof o.model === "string" ? o.model.slice(0, 96) : ""),
    trichTraLoi: lamSachVanBanNgoai(typeof o.trichTraLoi === "string" ? o.trichTraLoi.slice(0, 400) : ""),
    doDaiTraLoi: soKhongAm(o.doDaiTraLoi),
  };
}

const TEN_MUC: Record<string, string> = {
  "cong-khai": "công khai",
  "noi-bo": "nội bộ",
  "van-hanh": "VẬN HÀNH (dữ liệu nhà máy)",
  "ky-thuat": "KỸ THUẬT (mã / cấu hình)",
};

const usd = (x: number): string => `~$${x.toFixed(x < 0.01 ? 4 : 2)}`;

/**
 * Nội dung modal HOST trước khi gọi `chay` (rà kiem-dinh): model, mức dữ liệu, chi phí ước, số BYTE thật + cờ "đã cắt" (host tự biết),
 * trích câu trả lời ĐÃ CHE (máy chủ che). Chữ thuần.
 */
export function noiDungModalKiemDinh(dv: { model: ModelKiemDinh; xt: XemTruocKiemDinh; nguon: NguonDaChon }): { thongDiep: string; chiTiet: string } {
  const { xt, nguon } = dv;
  const dong: string[] = [];
  dong.push(`Model: ${xt.nhaCungCap && xt.model ? `${xt.nhaCungCap}/${xt.model}` : dv.model.ma.slice("ngoai:".length)} (${dv.model.nhan})`);
  dong.push(`Mức dữ liệu: ${TEN_MUC[xt.mucDuLieu] ?? xt.mucDuLieu}`);
  const token = xt.tokenUoc !== null ? `~${Math.round(xt.tokenUoc)} token` : "chưa ước được token";
  dong.push(`Chi phí ước: ${xt.chiPhiUocUsd !== null ? usd(xt.chiPhiUocUsd) : "chưa rõ giá"} · ${token}`);
  if (nguon.nguon.loai === "chat") {
    dong.push(`Sẽ gửi: câu hỏi + câu trả lời đã lưu trên máy chủ${xt.doDaiTraLoi !== null ? ` (câu trả lời ${Math.round(xt.doDaiTraLoi)} ký tự)` : ""}.`);
  } else {
    dong.push(`Sẽ gửi: ${nguon.soByte ?? 0} byte (câu hỏi + câu trả lời)${nguon.daCat ? " — ĐÃ CẮT cho vừa trần 16 KB, phần cuối không được kiểm định" : ""}.`);
  }
  if (xt.trichTraLoi) dong.push(`Trích câu trả lời (đã che bí mật): «${xt.trichTraLoi}${xt.doDaiTraLoi !== null && xt.doDaiTraLoi > xt.trichTraLoi.length ? "…" : ""}»`);
  dong.push("Kết quả là ý kiến của AI ngoài — KHÔNG tin cậy, không tự áp dụng.");
  return { thongDiep: "Gửi câu trả lời này cho AI NGOÀI kiểm định? (có tính phí)", chiTiet: dong.join("\n") };
}

export const NUT_DONG_Y_KIEM_DINH = "Gửi kiểm định";

const TEN_KET_LUAN: Record<string, string> = { dat: "ĐẠT", "can-sua": "CẦN SỬA", sai: "SAI" };
const TEN_MUC_LOI: Record<string, string> = { "nghiem-trong": "nghiêm trọng", vua: "vừa", nhe: "nhẹ" };

export interface KetQuaKiemDinhBong {
  ketLuan: string;
  diem: number | null;
  loi: Array<{ muc: string; moTa: string; viTri: string }>;
  banChuanHoa: string;
  baiHoc: string[];
  nhaCungCap: string;
  model: string;
  chiPhiUocUsd: number | null;
  tuBoNho: boolean;
}

const chuSach = (v: unknown, tran: number): string => (typeof v === "string" ? lamSachVanBanNgoai(v).slice(0, tran) : "");

/** Kết quả `aiKiemDinh.chay` → bản sạch; không có `ketQua.ketLuan` hợp lệ ⇒ `null`. */
export function docKetQuaKiemDinh(tho: unknown): KetQuaKiemDinhBong | null {
  if (!tho || typeof tho !== "object") return null;
  const o = tho as Record<string, unknown>;
  const k = o.ketQua && typeof o.ketQua === "object" ? (o.ketQua as Record<string, unknown>) : null;
  if (!k || typeof k.ketLuan !== "string" || !(k.ketLuan in TEN_KET_LUAN)) return null;
  const v = o.vet && typeof o.vet === "object" ? (o.vet as Record<string, unknown>) : {};
  const diem = typeof k.diem === "number" && Number.isInteger(k.diem) && k.diem >= 0 && k.diem <= 100 ? k.diem : null;
  return {
    ketLuan: k.ketLuan,
    diem,
    loi: (Array.isArray(k.loi) ? k.loi : []).slice(0, 20).flatMap((l) => {
      if (!l || typeof l !== "object") return [];
      const x = l as Record<string, unknown>;
      return [{ muc: typeof x.muc === "string" && x.muc in TEN_MUC_LOI ? x.muc : "vua", moTa: chuSach(x.moTa, 500), viTri: chuSach(x.viTri, 200) }];
    }),
    banChuanHoa: chuSach(k.banChuanHoa, 20_000),
    baiHoc: (Array.isArray(k.baiHocDeXuat) ? k.baiHocDeXuat : []).slice(0, 5).flatMap((b) =>
      b && typeof b === "object" && typeof (b as Record<string, unknown>).noiDung === "string" ? [chuSach((b as Record<string, unknown>).noiDung, 500)] : [],
    ),
    nhaCungCap: chuSach(v.nhaCungCap, 32),
    model: chuSach(v.model, 96),
    chiPhiUocUsd: soKhongAm(v.chiPhiUocUsd),
    tuBoNho: o.tuBoNho === true,
  };
}

/** Rào dòng chữ của AI ngoài trong markdown: dấu mở đầu khối/tiêu đề/liệt kê ở ĐẦU dòng không được đổi cấu trúc khung kết quả. */
const motDong = (s: string): string => s.replace(/[\r\n]+/g, " ").trim();
const raoMa = (s: string): string => {
  let rao = "```";
  while (s.includes(rao)) rao += "`";
  return rao;
};

/** Kết quả sạch → markdown của khung kết quả (chữ AI ngoài chỉ nằm trong mục liệt kê / khối mã). */
export function ketQuaThanhMarkdown(kq: KetQuaKiemDinhBong): string {
  const p: string[] = [];
  p.push(`**Kết luận:** ${TEN_KET_LUAN[kq.ketLuan]}${kq.diem !== null ? ` · điểm ${kq.diem}/100` : ""}`);
  if (kq.loi.length) {
    p.push("**Lỗi tìm thấy:**");
    p.push(kq.loi.map((l) => `- [${TEN_MUC_LOI[l.muc]}] ${motDong(l.moTa)}${l.viTri ? ` (${motDong(l.viTri)})` : ""}`).join("\n"));
  }
  if (kq.banChuanHoa) {
    const r = raoMa(kq.banChuanHoa);
    p.push("**Bản đề xuất của AI ngoài (chỉ để đọc — không tự áp dụng):**");
    p.push(`${r}\n${kq.banChuanHoa}\n${r}`);
  }
  if (kq.baiHoc.length) {
    p.push("**Bài học đề xuất:**");
    p.push(kq.baiHoc.map((b) => `- ${motDong(b)}`).join("\n"));
  }
  return p.join("\n\n");
}

/** Cây hiển thị KHÔNG TIN CẬY của kết quả (liên kết thành chữ + miền; không ảnh/HTML — xem `markdownAnToan`). */
export const cayKetQuaKiemDinh = (kq: KetQuaKiemDinhBong): NutMd[] => lamKhongTinCay(phanTichMarkdown(ketQuaThanhMarkdown(kq)));

/** Dòng nhãn khung kết quả: luôn mang `NHAN_KHONG_TIN_CAY` (cả nguồn `chat` lẫn `van-ban`). */
export function nhanKetQuaKiemDinh(kq: KetQuaKiemDinhBong): string {
  const phan = [NHAN_KHONG_TIN_CAY];
  if (kq.nhaCungCap && kq.model) phan.push(`${kq.nhaCungCap}/${kq.model}`);
  if (kq.chiPhiUocUsd !== null) phan.push(usd(kq.chiPhiUocUsd));
  if (kq.tuBoNho) phan.push("kết quả vừa có (không tính phí lại)");
  return phan.join(" · ");
}

/** Đọc mã lỗi máy-đọc-được từ thân lỗi tRPC (`error.json.data.appParams.reason` hoặc `message` dạng `NGOAI_*`). */
export function maLoiTrpc(than: unknown): string | null {
  const e = than && typeof than === "object" ? (than as Record<string, unknown>).error : null;
  const j = e && typeof e === "object" ? (((e as Record<string, unknown>).json ?? e) as Record<string, unknown>) : null;
  if (!j || typeof j !== "object") return null;
  const d = j.data && typeof j.data === "object" ? (j.data as Record<string, unknown>) : {};
  const ap = d.appParams && typeof d.appParams === "object" ? (d.appParams as Record<string, unknown>) : {};
  for (const ung of [ap.reason, j.message]) if (typeof ung === "string" && /^NGOAI_[A-Z_]{2,40}$/.test(ung)) return ung;
  return null;
}
