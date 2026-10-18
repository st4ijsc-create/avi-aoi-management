/**
 * ★★ AI Local Đợt 5.1 (2026-10-17) — phần THUẦN của PHẢN HỒI agent, dùng chung server + client:
 *
 *   • `khoiTraLoiTuSuKien` — các KHỐI TRẢ LỜI (chữ của model) của một lượt chạy, theo ĐÚNG luật gộp của dòng thời gian
 *     client (`client/src/components/aiCoding/agent/trangThaiAgent.ts#giamSuKien`): `chu` liền nhau gộp một; mục nào
 *     LÊN dòng thời gian (nghi · goi-tool · can-duyet · de-xuat-nho · loi) cắt khối; sự kiện không lên dòng thời gian
 *     (usage · ke-hoach · dang-cho-model · checkpoint · …) KHÔNG cắt. Vì sao phải đúng luật client: nút 👍/👎 gắn vào
 *     khối thứ `chiSoTin` mà NGƯỜI nhìn thấy, còn máy chủ lấy văn bản khối ấy từ SỔ của chính nó (không tin chữ client gửi).
 *     Sổ máy chủ (`noiVaoDem`) cắt khối ở MỌI sự kiện chen giữa ⇒ không dùng được trực tiếp; hàm này gộp lại. Lưới chéo
 *     client ⇄ hàm này: `client/src/components/aiCoding/agent/phanHoiKhoi.unit.test.ts`.
 *   • `diffHopNhat` / `apDiffHopNhat` — unified diff MỘT khối (cắt đầu/đuôi chung, 3 dòng ngữ cảnh) + áp lại; giữ `\r`
 *     của tệp CRLF. Quá trần ⇒ `null` (không xuất một diff cụt như thể trọn vẹn).
 *   • `mauBoDuLieuTuHang` — một hàng phản hồi ⇒ một mẫu bộ dữ liệu (chỉ dẫn → diff ĐƯỢC DUYỆT) hoặc `null`. Chính sách
 *     đường dẫn và lớp che bí mật là của MÁY CHỦ, nên được TIÊM vào (shared không nhập `server/`). Mẫu ghi rõ `nguon`.
 *   • (Đợt 5.1 VSCode) `traLoiCuoiTuSuKien` + trần độ dài của phiếu do EXTENSION gửi (lượt agent chạy CỤC BỘ, không có
 *     sổ `ai_agent_runs` ⇒ client gửi văn bản; máy chủ che bí mật + kiểm trần + đánh dấu `nguon = 'vscode'`). Extension và
 *     máy chủ nhập CÙNG hằng số ở đây ⇒ extension cắt trước khi gửi đúng bằng trần máy chủ kiểm (không 400 oan).
 */
import type { SuKienAgent } from "./agentCore/kieu";

/** Trần số dòng của một diff (thêm + bớt + ngữ cảnh). */
export const TRAN_DONG_DIFF = 3_000;
/** Trần ký tự của một diff / một khối trả lời lưu vào sổ phản hồi. */
export const TRAN_KY_TU_NOI_DUNG = 200_000;
const NGU_CANH = 3;
/** (Đợt 5.1 VSCode) Trần câu hỏi người gõ mà extension gửi kèm phiếu. */
export const TRAN_KY_TU_CAU_HOI_CLIENT = 20_000;
/** (Đợt 5.1 VSCode) Trần câu trả lời cuối mà extension gửi kèm phiếu (≤ `TRAN_KY_TU_NOI_DUNG`). */
export const TRAN_KY_TU_TRA_LOI_CLIENT = 100_000;
/** Trần lý do (cột `lyDo varchar(2000)`). */
export const TRAN_KY_TU_LY_DO = 2_000;

type MucVao = SuKienAgent | { suKien?: unknown } | null | undefined;

function laSuKien(x: unknown): x is SuKienAgent {
  return !!x && typeof x === "object" && typeof (x as { loai?: unknown }).loai === "string";
}

/** Khối trả lời của một lượt chạy — nhận cả mảng `SuKienAgent` lẫn SỔ `{seq, suKien}` của `ai_agent_runs.suKien`. */
export function khoiTraLoiTuSuKien(ds: ReadonlyArray<MucVao>): string[] {
  const khoi: string[] = [];
  let mo = false;
  for (const m of Array.isArray(ds) ? ds : []) {
    const e: unknown = laSuKien(m) ? m : m && typeof m === "object" ? (m as { suKien?: unknown }).suKien : null;
    if (!laSuKien(e)) continue;
    switch (e.loai) {
      case "chu": {
        const t = typeof e.noiDung === "string" ? e.noiDung : "";
        if (mo) khoi[khoi.length - 1] += t;
        else {
          khoi.push(t);
          mo = true;
        }
        break;
      }
      case "nghi":
      case "goi-tool":
      case "can-duyet":
      case "de-xuat-nho":
      case "loi":
        mo = false;
        break;
      default:
        break; // không lên dòng thời gian ⇒ không cắt khối
    }
  }
  return khoi;
}

/**
 * (Đợt 5.1 VSCode) Câu trả lời CUỐI của một lượt = khối trả lời cuối theo ĐÚNG luật gộp `khoiTraLoiTuSuKien` (cùng chỗ
 * web gắn nút — `viTriTraLoiCuoi`). Không có khối chữ nào / khối cuối rỗng ⇒ null (không có gì để chấm).
 */
export function traLoiCuoiTuSuKien(ds: ReadonlyArray<MucVao>): { chiSoKhoi: number; vanBan: string } | null {
  const khoi = khoiTraLoiTuSuKien(ds);
  const vanBan = khoi[khoi.length - 1];
  return vanBan && vanBan.trim() ? { chiSoKhoi: khoi.length - 1, vanBan } : null;
}

/** Tách dòng GIỮ ký tự kết thúc (`\n`, `\r\n`); dòng cuối có thể không có `\n`. */
function tachDong(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const boXuongDong = (d: string) => (d.endsWith("\n") ? d.slice(0, -1) : d);
const DAU_KHONG_XUONG_DONG = "\\ No newline at end of file";

/**
 * Unified diff MỘT khối giữa `truoc` và `sau` của tệp `duong` (POSIX, tương đối). Không đổi ⇒ `""`. Quá
 * `TRAN_DONG_DIFF` dòng hoặc `TRAN_KY_TU_NOI_DUNG` ký tự ⇒ `null`.
 */
export function diffHopNhat(duong: string, truoc: string, sau: string): string | null {
  if (truoc === sau) return "";
  const a = tachDong(truoc);
  const b = tachDong(sau);
  let dau = 0;
  while (dau < a.length && dau < b.length && a[dau] === b[dau]) dau++;
  let duoi = 0;
  while (duoi < a.length - dau && duoi < b.length - dau && a[a.length - 1 - duoi] === b[b.length - 1 - duoi]) duoi++;
  const batDau = Math.max(0, dau - NGU_CANH);
  const sauDuoi = Math.min(NGU_CANH, duoi);
  const cuoiA = a.length - duoi + sauDuoi;
  const cuoiB = b.length - duoi + sauDuoi;
  const soA = cuoiA - batDau;
  const soB = cuoiB - batDau;
  if (soA + soB > TRAN_DONG_DIFF) return null;

  const ra: string[] = [truoc === "" ? "--- /dev/null" : `--- a/${duong}`, sau === "" ? "+++ /dev/null" : `+++ b/${duong}`];
  ra.push(`@@ -${soA === 0 ? batDau : batDau + 1},${soA} +${soB === 0 ? batDau : batDau + 1},${soB} @@`);
  const dong = (tienTo: string, d: string) => {
    ra.push(tienTo + boXuongDong(d));
    if (!d.endsWith("\n")) ra.push(DAU_KHONG_XUONG_DONG);
  };
  for (let i = batDau; i < dau; i++) dong(" ", a[i]!);
  for (let i = dau; i < a.length - duoi; i++) dong("-", a[i]!);
  for (let i = dau; i < b.length - duoi; i++) dong("+", b[i]!);
  for (let i = a.length - duoi; i < cuoiA; i++) dong(" ", a[i]!);
  const s = `${ra.join("\n")}\n`;
  return s.length > TRAN_KY_TU_NOI_DUNG ? null : s;
}

/** Áp một diff do `diffHopNhat` sinh lên `truoc`. Ngữ cảnh/dòng bớt không khớp ⇒ ném. */
export function apDiffHopNhat(truoc: string, diff: string): string {
  if (diff === "") return truoc;
  const a = tachDong(truoc);
  const dongDiff = diff.split("\n");
  if (dongDiff[dongDiff.length - 1] === "") dongDiff.pop();
  const iTieuDe = dongDiff.findIndex((d) => d.startsWith("@@ "));
  const m = iTieuDe >= 0 ? /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(dongDiff[iTieuDe]!) : null;
  if (!m) throw new Error("diff không có tiêu đề khối @@");
  const soA = Number(m[2]);
  const viTri = soA === 0 ? Number(m[1]) : Number(m[1]) - 1;
  const moi: string[] = [];
  let i = viTri;
  for (let k = iTieuDe + 1; k < dongDiff.length; k++) {
    const d = dongDiff[k]!;
    if (d === DAU_KHONG_XUONG_DONG) continue;
    const coXuongDong = dongDiff[k + 1] !== DAU_KHONG_XUONG_DONG;
    const noiDung = d.slice(1) + (coXuongDong ? "\n" : "");
    if (d[0] === " " || d[0] === "-") {
      if (a[i] !== noiDung) throw new Error(`diff không khớp dòng ${i + 1}`);
      i++;
      if (d[0] === " ") moi.push(noiDung);
    } else if (d[0] === "+") moi.push(noiDung);
    else throw new Error(`dòng diff lạ: ${d.slice(0, 20)}`);
  }
  if (i - viTri !== soA) throw new Error("số dòng cũ không khớp tiêu đề");
  return [...a.slice(0, viTri), ...moi, ...a.slice(i)].join("");
}

/** Một hàng phản hồi (tập con cột của `ai_agent_feedback`) — đủ để dựng mẫu. */
export interface HangPhanHoiChoXuat {
  loai: string;
  quyetDinh: string | null;
  danhGia: number | null;
  cauHoi: string | null;
  noiDung: string | null;
  duongDan: string | null;
  projectId: string | null;
  runId: string | null;
  actionId: string | null;
  /** `web` (văn bản lấy từ sổ máy chủ) | `vscode` (văn bản client tự khai). Thiếu ⇒ `web` (hàng trước mig 0398). */
  nguon?: string | null;
}

/** Một dòng JSONL của bộ dữ liệu "chỉ dẫn → diff được duyệt". */
export interface MauBoDuLieu {
  chiDan: string;
  duong: string;
  diff: string;
  duAn: string | null;
  /** Phiếu của người duyệt (1 = 👍, null = chưa bỏ phiếu). 👎 không bao giờ vào bộ dữ liệu. */
  danhGia: number | null;
  runId: string | null;
  actionId: string | null;
  /** Nguồn của hàng — bộ dữ liệu diff chỉ nhận `web` (văn bản lấy từ SỔ máy chủ, không phải chữ client tự khai). */
  nguon: "web";
}

export interface TuyChonMau {
  /** Chính sách hộp cát của máy chủ (`phanQuyetDuongDan(d) === null`). */
  duongDuocPhep: (duong: string) => boolean;
  /** Lớp che bí mật của máy chủ (`redactSecretsOnly`). */
  che: (s: string) => string;
}

export function mauBoDuLieuTuHang(h: HangPhanHoiChoXuat, o: TuyChonMau): MauBoDuLieu | null {
  if (h.loai !== "diff" || h.quyetDinh !== "duyet" || h.danhGia === -1) return null;
  // Không trộn mức tin: văn bản client tự khai (nguồn ≠ web) không bao giờ thành mẫu "chỉ dẫn → diff được duyệt".
  if ((h.nguon ?? "web") !== "web") return null;
  const chiDan = (h.cauHoi ?? "").trim();
  const diff = h.noiDung ?? "";
  const duong = (h.duongDan ?? "").trim();
  if (!chiDan || !diff || !duong) return null;
  if (!o.duongDuocPhep(duong)) return null;
  return {
    chiDan: o.che(chiDan),
    duong,
    diff: o.che(diff),
    duAn: h.projectId ?? null,
    danhGia: h.danhGia ?? null,
    runId: h.runId ?? null,
    actionId: h.actionId ?? null,
    nguon: "web",
  };
}
