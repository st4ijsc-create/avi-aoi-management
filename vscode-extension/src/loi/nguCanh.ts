/**
 * Dựng ngữ cảnh mã gửi kèm câu hỏi. THUẦN để đo thẳng ba bất biến: cấm tệp bí mật · che chuỗi
 * giống khoá · ngân sách là trần THẬT (cắt thì phải KHAI là đã cắt, vì một ngữ cảnh bị cắt âm
 * thầm làm model trả lời sai mà không ai biết vì sao).
 */
const CHE = "«đã che»";

const CAM_TEP = [
  /(^|[\\/])\.env(\.|$)/i,
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)$/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.p12$/i,
];

export function duocPhepGuiNoiDung(duong: string): boolean {
  return !CAM_TEP.some((r) => r.test(duong));
}

/**
 * Che chuỗi giống bí mật TRƯỚC khi mã rời máy lập trình viên.
 *
 * ⚠ Thứ tự các luật có ý nghĩa, và mọi luật đều nghiêng về CHE THỪA hơn là để lọt: một đoạn mã bị
 * che quá tay chỉ làm câu trả lời kém đi một chút, còn một khoá bị lọt là mất thật.
 * Bốn lớp dưới đây đều đến từ phép đo trên chính repo này, không phải phỏng đoán.
 */
export function cheBiMat(s: string): string {
  return (
    s
      // 1) Khoá có tiền tố. `sk[-_]` vì Stripe dùng GẠCH DƯỚI (sk_live_…), OpenAI dùng gạch nối.
      .replace(/sk[-_][A-Za-z0-9_-]{16,}/g, CHE)
      .replace(/AKIA[0-9A-Z]{16}/g, CHE)
      // 2) JWT ba đoạn.
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, CHE)
      // 3) Credential NHÚNG trong chuỗi kết nối: scheme://user:MẬT_KHẨU@host. Dự án đã coi đây là
      //    bí mật (aiSafety.test.ts:148); đo trên .env.example thật thì luật cũ để lọt DATABASE_URL.
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@]+)(@)/gi, `$1${CHE}$3`)
      // 4) Gán khoá = giá trị. `["']?` cho phép dấu nháy ĐÓNG chen giữa từ khoá và dấu ngăn — đó
      //    chính là hình dạng JSON ("password": "…") mà luật cũ bỏ sót. Giá trị không nháy thì che
      //    tới HẾT DÒNG (`.` không khớp xuống dòng) vì bí mật nhiều từ chỉ che từ đầu là vẫn rò.
      .replace(
        /((?:password|passwd|matkhau|mat_khau|secret|token|api[_-]?key)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|.+)/gi,
        `$1${CHE}`,
      )
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
  const boQua: string[] = [];
  let conLai = dv.nganSach;

  if (dv.doanChon && duocPhepGuiNoiDung(dv.doanChon.duong)) {
    if (conLai > 0) {
      const k = khoi(
        `ĐOẠN ĐANG CHỌN ${dv.doanChon.duong} (dòng ${dv.doanChon.dongDau}-${dv.doanChon.dongCuoi})`,
        dv.doanChon.noiDung,
        conLai,
      );
      phan.push(k);
      conLai -= k.length;
    } else boQua.push("đoạn đang chọn");
  }

  if (dv.tepDangMo && duocPhepGuiNoiDung(dv.tepDangMo.duong)) {
    if (conLai > 0) {
      const k = khoi(`TỆP ĐANG MỞ ${dv.tepDangMo.duong}`, dv.tepDangMo.noiDung, conLai);
      phan.push(k);
      conLai -= k.length;
    } else boQua.push("tệp đang mở");
  }

  const dsSach = (dv.dsTep ?? []).filter(duocPhepGuiNoiDung);
  if (dsSach.length > 0) {
    if (conLai > 0) phan.push(khoi("DANH SÁCH TỆP", dsSach.join("\n"), conLai));
    else boQua.push("danh sách tệp");
  }

  // ⚠ Bỏ khối phải NÓI RA. Một ngữ cảnh thiếu âm thầm khiến model trả lời sai mà không ai truy
  //   được vì sao — đúng loại hỏng im lặng mà cả hệ này được dựng để tránh.
  if (boQua.length > 0) phan.push(`--- ĐÃ BỎ QUA vì hết ngân sách: ${boQua.join(", ")} ---\n`);

  return phan.join("\n");
}
