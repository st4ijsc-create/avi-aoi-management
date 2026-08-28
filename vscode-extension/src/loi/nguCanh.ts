/**
 * Dựng ngữ cảnh mã gửi kèm câu hỏi. THUẦN để đo thẳng ba bất biến: cấm tệp bí mật · che chuỗi
 * giống khoá · ngân sách là trần THẬT (cắt thì phải KHAI là đã cắt, vì một ngữ cảnh bị cắt âm
 * thầm làm model trả lời sai mà không ai biết vì sao).
 */
const CHE = "«đã che»";

const CAM_TEP = [/(^|[\\/])\.env(\.|$)/i, /(^|[\\/])id_rsa$/i, /\.pem$/i, /\.pfx$/i, /\.p12$/i];

export function duocPhepGuiNoiDung(duong: string): boolean {
  return !CAM_TEP.some((r) => r.test(duong));
}

export function cheBiMat(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, CHE)
    .replace(/AKIA[0-9A-Z]{16}/g, CHE)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, CHE)
    .replace(
      /((?:password|matkhau|mat_khau|secret|token|api[_-]?key)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
      `$1${CHE}`,
    );
}

export interface DauVaoNguCanh {
  doanChon?: { duong: string; dongDau: number; dongCuoi: number; noiDung: string };
  tepDangMo?: { duong: string; noiDung: string };
  dsTep?: string[];
  nganSach: number;
}

function khoi(nhan: string, noiDung: string, tran: number): string {
  const sach = cheBiMat(noiDung);
  const cat = sach.length > tran;
  const than = cat ? `${sach.slice(0, tran)}\n… (đã cắt ${sach.length - tran} ký tự)` : sach;
  return `--- ${nhan} ---\n${than}\n`;
}

export function dungNguCanh(dv: DauVaoNguCanh): string {
  const phan: string[] = [];
  let conLai = dv.nganSach;

  if (dv.doanChon && duocPhepGuiNoiDung(dv.doanChon.duong) && conLai > 0) {
    const k = khoi(
      `ĐOẠN ĐANG CHỌN ${dv.doanChon.duong} (dòng ${dv.doanChon.dongDau}-${dv.doanChon.dongCuoi})`,
      dv.doanChon.noiDung,
      conLai,
    );
    phan.push(k);
    conLai -= k.length;
  }

  if (dv.tepDangMo && duocPhepGuiNoiDung(dv.tepDangMo.duong) && conLai > 0) {
    const k = khoi(`TỆP ĐANG MỞ ${dv.tepDangMo.duong}`, dv.tepDangMo.noiDung, conLai);
    phan.push(k);
    conLai -= k.length;
  }

  if (dv.dsTep && dv.dsTep.length > 0 && conLai > 0) {
    const k = khoi("DANH SÁCH TỆP", dv.dsTep.join("\n"), conLai);
    phan.push(k);
  }

  return phan.join("\n");
}
