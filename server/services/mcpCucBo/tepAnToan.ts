/**
 * ★ MCP cục bộ (2026-10-26, chủ dự án: "MCP dùng cho code và AI local, đọc ghi tệp trong thư mục cho phép, truy vấn DB") —
 * GIAM TỆP: mọi đường dẫn từ tool là TƯƠNG ĐỐI trong MỘT gốc đã khai; ra khỏi gốc (kể cả qua symlink/junction) ⇒ từ chối.
 *
 * Gốc khai bằng `MCP_CUC_BO_THU_MUC` = `ten=D:\duong\dan[:ro]; ten2=...`
 *   • `:ro` ⇒ chỉ đọc (gốc mã nguồn: tool GHI qua MCP sẽ lách cửa duyệt của tác nhân lập trình — doc 78 — nên mã chỉ đọc).
 *   • Tệp bí mật KHÔNG BAO GIỜ đọc được dù nằm trong gốc (`.env*`, khoá, chứng chỉ, `.git/`, `.npmrc` …) — `laTepBiMat`.
 *
 * Phép kiểm (Windows là nền chính):
 *   • chỉ nhận đường dẫn tương đối dùng `/` hoặc `\`; tuyệt đối / ổ đĩa / UNC / `..` / ký tự điều khiển / `:` (luồng ADS) ⇒ từ chối;
 *   • tên thiết bị dành riêng (CON, NUL, COM1 …) và tên kết thúc bằng dấu chấm / dấu cách ⇒ từ chối (Windows tự cắt ⇒ đổi đích);
 *   • sau khi nối, `realpath` của đích (đọc) hoặc của thư mục cha gần nhất đang tồn tại (ghi) phải nằm TRONG `realpath` của gốc,
 *     so không phân biệt hoa thường — chặn symlink / junction trỏ ra ngoài.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface GocTep {
  ten: string;
  duongDan: string;
  chiDoc: boolean;
}

export class LoiTep extends Error {
  constructor(message: string, readonly ma: string) {
    super(message);
    this.name = "LoiTep";
  }
}

export const TRAN_BYTE_DOC = 512 * 1024;
export const TRAN_BYTE_GHI = 512 * 1024;
export const TRAN_MUC_LIET_KE = 1000;
export const TRAN_KET_QUA_TIM = 200;
export const TRAN_THU_MUC_DUYET_TIM = 5000;

const RE_TEN_GOC = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const TEN_THIET_BI = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
/** Thư mục không bao giờ vào (bí mật hoặc rác lớn làm tìm kiếm chậm). */
const THU_MUC_CAM = new Set([".git", "node_modules", ".ssh", ".gnupg", ".aws", ".azure"]);
const RE_TEP_BI_MAT = /^(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|pfx|p12|jks|keystore|kdbx|ppk))$/i;

/** Đọc `MCP_CUC_BO_THU_MUC`. Mục hỏng ⇒ NÉM (cấu hình sai phải lộ ngay lúc khởi động, không im lặng bỏ qua). */
export function docGocTuEnv(giaTri: string | undefined): GocTep[] {
  const ra: GocTep[] = [];
  for (const muc of (giaTri ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = muc.indexOf("=");
    if (i <= 0) throw new LoiTep(`MCP_CUC_BO_THU_MUC: mục "${muc}" phải có dạng ten=duong_dan[:ro]`, "CAU_HINH_SAI");
    const ten = muc.slice(0, i).trim().toLowerCase();
    let p = muc.slice(i + 1).trim();
    let chiDoc = false;
    if (/:ro$/i.test(p)) {
      chiDoc = true;
      p = p.slice(0, -3);
    }
    if (!RE_TEN_GOC.test(ten)) throw new LoiTep(`MCP_CUC_BO_THU_MUC: tên gốc "${ten}" không hợp lệ (a-z, 0-9, -, _)`, "CAU_HINH_SAI");
    if (!path.isAbsolute(p)) throw new LoiTep(`MCP_CUC_BO_THU_MUC: gốc "${ten}" phải là đường dẫn tuyệt đối`, "CAU_HINH_SAI");
    if (ra.some((g) => g.ten === ten)) throw new LoiTep(`MCP_CUC_BO_THU_MUC: trùng tên gốc "${ten}"`, "CAU_HINH_SAI");
    ra.push({ ten, duongDan: path.resolve(p), chiDoc });
  }
  return ra;
}

export function laTepBiMat(ten: string): boolean {
  return RE_TEP_BI_MAT.test(ten);
}

function cungHoacTrong(goc: string, dich: string): boolean {
  const a = path.resolve(goc).toLowerCase();
  const b = path.resolve(dich).toLowerCase();
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

/** Kiểm cú pháp đường dẫn tương đối; trả các đoạn đã tách. */
export function tachDuongDanTuongDoi(duongDan: unknown): string[] {
  if (typeof duongDan !== "string") throw new LoiTep("duongDan phải là chuỗi", "THAM_SO_SAI");
  if (duongDan.length > 1024) throw new LoiTep("duongDan quá dài", "THAM_SO_SAI");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>"|?*]/.test(duongDan)) throw new LoiTep("duongDan chứa ký tự không cho phép", "DUONG_DAN_CAM");
  if (/^([a-zA-Z]:|[\\/])/.test(duongDan)) throw new LoiTep("chỉ nhận đường dẫn TƯƠNG ĐỐI trong gốc", "DUONG_DAN_CAM");
  const doan = duongDan.split(/[\\/]+/).filter((d) => d !== "" && d !== ".");
  for (const d of doan) {
    if (d === "..") throw new LoiTep("không được dùng '..'", "DUONG_DAN_CAM");
    if (d.includes(":")) throw new LoiTep("không được dùng ':' (luồng dữ liệu phụ NTFS)", "DUONG_DAN_CAM");
    if (TEN_THIET_BI.test(d)) throw new LoiTep(`tên "${d}" là tên thiết bị dành riêng`, "DUONG_DAN_CAM");
    if (/[. ]$/.test(d)) throw new LoiTep(`tên "${d}" không được kết thúc bằng dấu chấm hoặc dấu cách`, "DUONG_DAN_CAM");
    if (THU_MUC_CAM.has(d.toLowerCase())) throw new LoiTep(`không truy cập thư mục "${d}"`, "DUONG_DAN_CAM");
  }
  return doan;
}

export function timGoc(dsGoc: readonly GocTep[], ten: unknown): GocTep {
  if (dsGoc.length === 0) throw new LoiTep("chưa khai gốc thư mục nào (MCP_CUC_BO_THU_MUC)", "CHUA_KHAI_GOC");
  if (ten === undefined || ten === null || ten === "") {
    if (dsGoc.length === 1) return dsGoc[0];
    throw new LoiTep(`phải chọn goc: ${dsGoc.map((g) => g.ten).join(", ")}`, "THAM_SO_SAI");
  }
  const g = dsGoc.find((x) => x.ten === String(ten).toLowerCase());
  if (!g) throw new LoiTep(`không có gốc "${String(ten).slice(0, 40)}"`, "KHONG_CO_GOC");
  return g;
}

async function realpathGoc(goc: GocTep): Promise<string> {
  try {
    return await fs.realpath(goc.duongDan);
  } catch {
    throw new LoiTep(`gốc "${goc.ten}" không tồn tại trên đĩa`, "GOC_VANG");
  }
}

/** Đường dẫn ĐỌC (đích phải tồn tại). Trả đường dẫn thật đã kiểm. */
export async function giaiDuongDanDoc(goc: GocTep, duongDan: unknown): Promise<string> {
  const doan = tachDuongDanTuongDoi(duongDan ?? "");
  const gocThat = await realpathGoc(goc);
  const dich = path.join(gocThat, ...doan);
  let that: string;
  try {
    that = await fs.realpath(dich);
  } catch {
    throw new LoiTep("không tìm thấy", "KHONG_TIM_THAY");
  }
  if (!cungHoacTrong(gocThat, that)) throw new LoiTep("đích nằm ngoài gốc (symlink / junction)", "DUONG_DAN_CAM");
  if (laTepBiMat(path.basename(that))) throw new LoiTep("tệp bí mật — không đọc qua MCP", "TEP_BI_MAT");
  return that;
}

/** Đường dẫn GHI: gốc không chỉ đọc; thư mục cha gần nhất đang tồn tại phải nằm trong gốc. */
export async function giaiDuongDanGhi(goc: GocTep, duongDan: unknown): Promise<string> {
  if (goc.chiDoc) throw new LoiTep(`gốc "${goc.ten}" chỉ đọc`, "GOC_CHI_DOC");
  const doan = tachDuongDanTuongDoi(duongDan);
  if (doan.length === 0) throw new LoiTep("thiếu tên tệp", "THAM_SO_SAI");
  if (laTepBiMat(doan[doan.length - 1])) throw new LoiTep("không ghi tệp có tên kiểu bí mật", "TEP_BI_MAT");
  const gocThat = await realpathGoc(goc);
  const dich = path.join(gocThat, ...doan);
  let cha = path.dirname(dich);
  for (;;) {
    try {
      const that = await fs.realpath(cha);
      if (!cungHoacTrong(gocThat, that)) throw new LoiTep("đích nằm ngoài gốc (symlink / junction)", "DUONG_DAN_CAM");
      break;
    } catch (e) {
      if (e instanceof LoiTep) throw e;
      const tren = path.dirname(cha);
      if (tren === cha) throw new LoiTep("không giải được thư mục cha", "DUONG_DAN_CAM");
      cha = tren;
    }
  }
  try {
    const st = await fs.lstat(dich);
    if (st.isSymbolicLink()) throw new LoiTep("không ghi đè symlink", "DUONG_DAN_CAM");
    if (st.isDirectory()) throw new LoiTep("đích là thư mục", "THAM_SO_SAI");
  } catch (e) {
    if (e instanceof LoiTep) throw e;
  }
  return dich;
}

export async function lietKe(goc: GocTep, duongDan: unknown): Promise<{ muc: Array<{ ten: string; loai: "tep" | "thu-muc" | "khac"; byte?: number; sua?: string }>; biCat: boolean }> {
  const thuMuc = await giaiDuongDanDoc(goc, duongDan ?? "");
  const ds = await fs.readdir(thuMuc, { withFileTypes: true }).catch(() => {
    throw new LoiTep("không phải thư mục", "THAM_SO_SAI");
  });
  const muc: Array<{ ten: string; loai: "tep" | "thu-muc" | "khac"; byte?: number; sua?: string }> = [];
  for (const d of ds) {
    if (muc.length >= TRAN_MUC_LIET_KE) break;
    if (THU_MUC_CAM.has(d.name.toLowerCase()) || laTepBiMat(d.name)) continue;
    if (d.isDirectory()) muc.push({ ten: d.name, loai: "thu-muc" });
    else if (d.isFile()) {
      const st = await fs.stat(path.join(thuMuc, d.name)).catch(() => null);
      muc.push({ ten: d.name, loai: "tep", byte: st?.size, sua: st?.mtime.toISOString() });
    } else muc.push({ ten: d.name, loai: "khac" });
  }
  return { muc, biCat: ds.length > muc.length && muc.length >= TRAN_MUC_LIET_KE };
}

export async function docTep(goc: GocTep, duongDan: unknown, batDau: unknown, soByte: unknown): Promise<{ noiDung: string; byteTong: number; batDau: number; biCat: boolean }> {
  const p = await giaiDuongDanDoc(goc, duongDan);
  const st = await fs.stat(p);
  if (!st.isFile()) throw new LoiTep("không phải tệp", "THAM_SO_SAI");
  const tu = Number.isInteger(batDau) && (batDau as number) >= 0 ? (batDau as number) : 0;
  const n = Math.min(Number.isInteger(soByte) && (soByte as number) > 0 ? (soByte as number) : TRAN_BYTE_DOC, TRAN_BYTE_DOC);
  const fh = await fs.open(p, "r");
  try {
    const buf = Buffer.alloc(Math.max(0, Math.min(n, st.size - tu)));
    if (buf.length > 0) await fh.read(buf, 0, buf.length, tu);
    if (buf.includes(0)) throw new LoiTep("tệp nhị phân — chỉ đọc tệp văn bản", "TEP_NHI_PHAN");
    return { noiDung: buf.toString("utf8"), byteTong: st.size, batDau: tu, biCat: tu + buf.length < st.size };
  } finally {
    await fh.close();
  }
}

export async function ghiTep(goc: GocTep, duongDan: unknown, noiDung: unknown, ghiDe: unknown): Promise<{ byte: number; taoMoi: boolean }> {
  if (typeof noiDung !== "string") throw new LoiTep("noiDung phải là chuỗi", "THAM_SO_SAI");
  const buf = Buffer.from(noiDung, "utf8");
  if (buf.length > TRAN_BYTE_GHI) throw new LoiTep(`noiDung vượt ${TRAN_BYTE_GHI} byte`, "QUA_TRAN");
  const p = await giaiDuongDanGhi(goc, duongDan);
  const coSan = await fs.stat(p).then(() => true, () => false);
  if (coSan && ghiDe !== true) throw new LoiTep("tệp đã tồn tại — đặt ghiDe=true để ghi đè", "DA_TON_TAI");
  await fs.mkdir(path.dirname(p), { recursive: true });
  // mkdir xong ⇒ kiểm LẠI cha thật (một junction có thể vừa xuất hiện giữa hai bước).
  await giaiDuongDanGhi(goc, duongDan);
  const tam = `${p}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tam, buf, { flag: "wx" });
  await fs.rename(tam, p);
  return { byte: buf.length, taoMoi: !coSan };
}

/** Tìm tệp theo chuỗi con của tên (không phân biệt hoa thường), duyệt rộng có trần. */
export async function timTep(goc: GocTep, mau: unknown, duongDan: unknown): Promise<{ ketQua: string[]; biCat: boolean }> {
  if (typeof mau !== "string" || mau.trim().length < 2 || mau.length > 100) throw new LoiTep("mau phải là chuỗi 2–100 ký tự", "THAM_SO_SAI");
  const can = mau.trim().toLowerCase();
  const gocThat = await realpathGoc(goc);
  const batDauTu = await giaiDuongDanDoc(goc, duongDan ?? "");
  const hang: string[] = [batDauTu];
  const ketQua: string[] = [];
  let soThuMuc = 0;
  while (hang.length > 0 && ketQua.length < TRAN_KET_QUA_TIM && soThuMuc < TRAN_THU_MUC_DUYET_TIM) {
    const tm = hang.shift()!;
    soThuMuc++;
    const ds = await fs.readdir(tm, { withFileTypes: true }).catch(() => []);
    for (const d of ds) {
      if (THU_MUC_CAM.has(d.name.toLowerCase()) || laTepBiMat(d.name)) continue;
      const p = path.join(tm, d.name);
      if (d.isDirectory()) hang.push(p);
      else if (d.isFile() && d.name.toLowerCase().includes(can)) {
        ketQua.push(path.relative(gocThat, p).split(path.sep).join("/"));
        if (ketQua.length >= TRAN_KET_QUA_TIM) break;
      }
    }
  }
  return { ketQua, biCat: ketQua.length >= TRAN_KET_QUA_TIM || soThuMuc >= TRAN_THU_MUC_DUYET_TIM };
}
