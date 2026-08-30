/**
 * Dựng ngữ cảnh mã gửi kèm câu hỏi. THUẦN để đo thẳng ba bất biến: cấm tệp bí mật · che chuỗi
 * giống khoá · ngân sách là trần THẬT (cắt thì phải KHAI là đã cắt, vì một ngữ cảnh bị cắt âm
 * thầm làm model trả lời sai mà không ai biết vì sao).
 */
// ★★★ H2 (review 2026-08-30) — export để `docCucBo.ts` (grep) có thể che NGUYÊN DÒNG bằng ĐÚNG
// chuỗi này khi tự phát hiện một dòng nằm giữa BEGIN/END của khối PEM đa dòng (xem docblock
// `grepThuan`) — hai bản sao của cùng một chuỗi che sẽ trôi khỏi nhau, đúng bài học đã trả giá ở
// docblock đầu tệp này.
export const CHE = "«đã che»";

const CAM_TEP = [
  /(^|[\\/])\.env(\.|$)/i,
  // Khoá SSH: CÓ hoặc KHÔNG CÓ hậu tố (`id_rsa`, `id_rsa_work`, `id_ed25519_deploy`, …) — đo trên
  // máy thật thì khoá thường được đặt hậu tố để phân biệt nhiều khoá trên cùng máy; luật cũ neo
  // `$` ngay sau tên gốc nên `id_rsa_work` lọt qua nguyên vẹn.
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(_[\w-]*)?$/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.p12$/i,
  // Đo trên mã thật: `server.key`, `app/certs/tls.key`, `store.jks`, `k.p8` đều lọt qua danh sách
  // cũ ⇒ nội dung khoá riêng bị gửi nguyên văn cho máy chủ. Neo bằng `$` nên "keyboard.ts" hay
  // "monkey.p8s.ts" (đuôi thật là .ts) KHÔNG bị chặn nhầm.
  /\.key$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /\.p8$/i,
  /\.pkcs12$/i,
  /\.asc$/i,
  /\.ppk$/i,
];

export function duocPhepGuiNoiDung(duong: string): boolean {
  return !CAM_TEP.some((r) => r.test(duong));
}

/**
 * ★★★ 2026-08-30 (Đợt D, vòng sửa 1) — CẤM **RỜI MÁY**, danh sách RIÊNG, có tên riêng.
 * Trả về LÝ DO nếu cấm, `undefined` nếu cho qua (cùng hình dạng với `camGhiRieng` của Đợt C).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO `.git/**` PHẢI ĐÓNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   · `.git/config` thường chứa **token remote** dạng `https://user:token@github.com/…`;
 *   · `.git/` giữ **NGUYÊN lịch sử** của những tệp đã bị xoá **vì lý do bí mật** — thứ mà người ta
 *     tưởng đã xoá thì vẫn nằm đó;
 *   · `.git/` **không mang giá trị nào cho việc HIỂU MÃ** — model cần mã nguồn, không cần cơ sở
 *     dữ liệu đối tượng nhị phân. Nên đóng nó không mất gì.
 *   · Đợt C **đã chặn GHI** vào `.git/**`. Để ĐỌC mở trong khi GHI đóng là một bất đối xứng không
 *     ai giải thích được, và người sau sẽ đọc nó thành "chắc có lý do".
 *
 * ⚠ Dựa vào `cheBiMat` để cứu `.git/config` là SAI THẾ TRẬN. Luật 4 của `cheBiMat` CÓ che
 *   `scheme://user:pass@host` thật — nhưng đó đúng là kiểu phòng thủ mà chính Đợt D vừa đo được là
 *   nguy hiểm: ở đột biến (b), khẳng định "không có mật khẩu trong kết quả" VẪN XANH kể cả khi tệp
 *   cấm bị mở ra, vì tầng che đã dọn dẹp hộ. Tầng ngoài mục ruỗng mà mọi phép đo vẫn xanh. Vì thế:
 *   tệp lẽ ra không nên MỞ thì phải chặn ở tầng MỞ, không phó thác cho tầng CHE.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO **KHÔNG** NHÉT `.git` VÀO `CAM_TEP` CHO GỌN (đo được, không phải sở thích)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `duocPhepGuiNoiDung` được `duocPhepGhi` (`./chanGhi.ts`, luật 3) dùng chung. Thêm `.git` vào đó
 * sẽ làm luật 3 nổ TRƯỚC luật 4, biến nhánh `.git` của `camGhiRieng` thành **mã CHẾT** — tức xoá
 * mất câu giải thích riêng của Đợt C ("ghi vào đó KHÔNG phải sửa mã nguồn mà là ĐẶT MÃ SẼ CHẠY
 * trên máy bạn"), thay bằng một câu chung chung "tệp nhạy cảm". Và `chanGhi.unit.test.ts` có sẵn
 * một ca ★★★ "ĐỐI CHỨNG" khẳng định `duocPhepGuiNoiDung(".git/hooks/pre-commit") === true` kèm
 * ghi chú "nếu ca này đỏ thì luật 4 là thừa và cả phán quyết I-6 sai" — nhét vào danh sách chung
 * là làm ca ấy ĐỎ. Đây ĐÚNG tình huống mà docblock `chanGhi.ts` đã dặn trước: khi hai câu hỏi
 * tách đáp án thì **TÁCH TƯỜNG MINH thành danh sách có tên riêng**, tuyệt đối không sửa lén bên
 * trong `duocPhepGuiNoiDung`.
 *
 * ⚠ So theo ĐOẠN đường dẫn (`.git` phải là NGUYÊN một đoạn), KHÔNG phải chuỗi con: `.gitignore`,
 *   `.gitattributes`, `.github/`, `src/gitUtils.ts` là tệp bình thường và chặn nhầm chúng là mất
 *   chức năng ÂM THẦM — người dùng chỉ thấy "AI không đọc được tệp này" mà không hiểu vì sao.
 * ⚠ Hoa/thường: Windows coi `.GIT` và `.git` là một. Chặn cả hai là fail-closed, không mất gì.
 * ⚠ Danh sách này áp cho MỌI đường RỜI MÁY (ngữ cảnh + ba tool đọc), KHÔNG áp cho đường GHI —
 *   đường ghi đã có `camGhiRieng` với câu giải thích đúng hậu quả của nó.
 */
export function camRoiMay(duong: string): string | undefined {
  const doan = duong
    .split(/[\\/]+/)
    .filter((x) => x !== "")
    .map((x) => x.toLowerCase());
  if (doan.includes(".git")) {
    return (
      `nằm trong ".git" — kho Git giữ token remote trong "config" và giữ NGUYÊN lịch sử của những ` +
      `tệp đã bị xoá vì lý do bí mật; nó cũng không giúp gì cho việc hiểu mã: "${duong}"`
    );
  }
  return undefined;
}

/**
 * ★★★ VỊ TỪ DUY NHẤT cho câu hỏi "nội dung tệp này có được RỜI MÁY không".
 * Gộp hai luật: tệp nhạy cảm (`duocPhepGuiNoiDung`) + cấm-rời-máy-riêng (`camRoiMay`).
 * Mọi đường rời máy (`dungNguCanh` + ba tool đọc của `loi/docCucBo.ts`) phải hỏi qua ĐÂY, để không
 * ai phải nhớ gọi đủ hai hàm — quên một hàm là mở một lỗ im lặng.
 */
export function duocPhepRoiMay(duong: string): boolean {
  return duocPhepGuiNoiDung(duong) && camRoiMay(duong) === undefined;
}

/**
 * Che chuỗi giống bí mật TRƯỚC khi mã rời máy lập trình viên.
 *
 * ⚠ Thứ tự các luật có ý nghĩa, và mọi luật đều nghiêng về CHE THỪA hơn là để lọt: một đoạn mã bị
 * che quá tay chỉ làm câu trả lời kém đi một chút, còn một khoá bị lọt là mất thật.
 * Năm lớp dưới đây đều đến từ phép đo trên chính repo này, không phải phỏng đoán.
 */
export function cheBiMat(s: string): string {
  return (
    s
      // 1) Khối khoá riêng PEM dán TRONG một tệp không bị `duocPhepGuiNoiDung` chặn (ví dụ nhúng
      //    trong một biến cấu hình `.ts`): `-----BEGIN … PRIVATE KEY-----` … `-----END …-----`.
      //    Che THÂN (base64), GIỮ hai dòng BEGIN/END để người đọc còn biết cái gì đã bị che — đây
      //    là lớp phòng thủ CHIỀU SÂU, khác với việc chặn cả TỆP ở `CAM_TEP`.
      .replace(/(-----BEGIN .*?PRIVATE KEY-----)[\s\S]*?(-----END .*?-----)/g, `$1\n${CHE}\n$2`)
      // 2) Khoá có tiền tố. `sk[-_]` vì Stripe dùng GẠCH DƯỚI (sk_live_…), OpenAI dùng gạch nối.
      .replace(/sk[-_][A-Za-z0-9_-]{16,}/g, CHE)
      .replace(/AKIA[0-9A-Z]{16}/g, CHE)
      // 3) JWT ba đoạn.
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, CHE)
      // 4) Credential NHÚNG trong chuỗi kết nối: scheme://user:MẬT_KHẨU@host. Dự án đã coi đây là
      //    bí mật (aiSafety.test.ts:148); đo trên .env.example thật thì luật cũ để lọt DATABASE_URL.
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@]+)(@)/gi, `$1${CHE}$3`)
      // 5) Gán khoá = giá trị. `["']?` cho phép dấu nháy ĐÓNG chen giữa từ khoá và dấu ngăn — đó
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

  if (dv.doanChon && duocPhepRoiMay(dv.doanChon.duong)) {
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

  if (dv.tepDangMo && duocPhepRoiMay(dv.tepDangMo.duong)) {
    if (conLai > 0) {
      const k = khoi(`TỆP ĐANG MỞ ${dv.tepDangMo.duong}`, dv.tepDangMo.noiDung, conLai);
      phan.push(k);
      conLai -= k.length;
    } else boQua.push("tệp đang mở");
  }

  const dsSach = (dv.dsTep ?? []).filter(duocPhepRoiMay);
  if (dsSach.length > 0) {
    if (conLai > 0) phan.push(khoi("DANH SÁCH TỆP", dsSach.join("\n"), conLai));
    else boQua.push("danh sách tệp");
  }

  // ⚠ Bỏ khối phải NÓI RA. Một ngữ cảnh thiếu âm thầm khiến model trả lời sai mà không ai truy
  //   được vì sao — đúng loại hỏng im lặng mà cả hệ này được dựng để tránh.
  if (boQua.length > 0) phan.push(`--- ĐÃ BỎ QUA vì hết ngân sách: ${boQua.join(", ")} ---\n`);

  return phan.join("\n");
}
