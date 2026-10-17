/**
 * BỘ "TÌM MÃ" — CHẤM một câu trả lời (thuần, không I/O) + sinh bộ câu trả lời mẫu cho KIỂM THƯỚC.
 *
 * ĐÚNG ⇔ câu trả lời nêu ĐƯỜNG TỆP ĐÚNG (chuẩn hoá `\`→`/`, không phân biệt hoa thường, có ranh giới hai đầu: `a/b.ts`
 *        không khớp `a/b.tsx` hay `xa/b.ts`; đường tuyệt đối/tiền tố thư mục được chấp nhận vì chứa đường đúng ở cuối;
 *        câu agent-f: đường tương đối trong dự án cũng được)
 *        VÀ (nếu `doiDong`) một số dòng gắn với lần nêu đường đúng nằm trong ±5 của dòng định nghĩa.
 * "Gắn với": ngay sau đường (`:86`, `:86-120`, `#L86`, ` (dòng 86)`, `, line 86`, ô bảng `| 86 |`); hoặc trong 160 ký tự
 *        SAU đường mà KHÔNG vượt qua tên tệp khác (`dòng 86`, `line 86`, `L86`, `lines 86–120`); hoặc sát NGAY TRƯỚC đường
 *        (`dòng 86 của <đường>`). Số đứng xa phía trước KHÔNG tính (có thể thuộc tệp nêu trước đó).
 * Chỉ số phụ (không vào cổng): `chiTenTep` (chỉ nêu tên tệp trần), `nhacTepGoi` (nêu ≥ 1 tệp nhắc tên ký hiệu).
 */
export const DUNG_SAI_DONG = 5;
const CUA_SO = 160;
const KY_TU_DUONG = /[a-z0-9_.\-/]/;
const TEN_TEP = /[a-z0-9_\-.]+\.(?:ts|tsx|mts|js|mjs|cjs|py|cs|json|md|java|go|rs|cpp|h)(?![a-z0-9_])/g;

const chuan = (s) => String(s ?? "").replace(/\\/g, "/").toLowerCase();

/** Các vị trí [dau, cuoi) mà `duong` xuất hiện với ranh giới hợp lệ. Đầu: ký tự trước không thuộc tên (cho phép `/`). */
function viTriDuong(van, duong) {
  const ra = [];
  for (let i = van.indexOf(duong); i !== -1; i = van.indexOf(duong, i + 1)) {
    const truoc = i === 0 ? "" : van[i - 1];
    const sau = van[i + duong.length] ?? "";
    const truocOk = truoc === "" || truoc === "/" || !KY_TU_DUONG.test(truoc);
    const sauOk = sau === "" || !/[a-z0-9_]/.test(sau);
    if (truocOk && sauOk) ra.push([i, i + duong.length]);
  }
  return ra;
}

function soTrongDoan(doan) {
  const so = [];
  const them = (re) => { for (const m of doan.matchAll(re)) so.push(Number(m[1])); };
  them(/(?:dòng|dong|line|lines|lines?:)\s*(?:số\s*)?(\d{1,6})/g);
  them(/(?<![a-z0-9])l(\d{1,6})(?![0-9])/g);
  return so;
}

/** Số dòng gắn với một lần nêu đường tại [dau, cuoi). */
function soDongGan(van, dau, cuoi) {
  const so = [];
  const sau = van.slice(cuoi, cuoi + CUA_SO);
  const dinh = sau.match(/^[`*]*\s*(?::|#l|\s*\(\s*(?:dòng|dong|line|l)?\s*|,?\s*(?:dòng|dong|line|l)\s*|\s*\|\s*(?:dòng|dong|line|l)?\s*)(\d{1,6})/);
  if (dinh) so.push(Number(dinh[1]));
  // cửa sổ sau: tới tên tệp kế tiếp
  TEN_TEP.lastIndex = 0;
  const m = TEN_TEP.exec(sau.slice(1));
  so.push(...soTrongDoan(m ? sau.slice(0, m.index + 1) : sau));
  // phía trước: CHỈ dạng "dòng 86 của/trong <đường>" sát ngay trước (số đứng xa hơn có thể thuộc tệp trước đó)
  const truoc = van.slice(Math.max(0, dau - 60), dau).replace(/[a-z]:\/[^\s`*]*$/, "").replace(/[^\s`*]*$/, "");
  const sat = truoc.match(/(?<![a-z])(?:dòng|dong|line|l)\s*(\d{1,6})(?:\s*[-–]\s*\d{1,6})?\s*(?:của|trong|in|of|tại|ở)?\s*(?:tệp|file)?\s*[`*]*\s*$/);
  if (sat) so.push(Number(sat[1]));
  return so;
}

function cacDuongChapNhan(cau) {
  const ds = [chuan(cau.tep)];
  if (cau.duAn) ds.push(chuan(cau.tep.slice(cau.duAn.length + 1)));
  return ds;
}

/** Chấm một câu trả lời. Trả { dung, nhacTep, dongNeu[], dongDung, chiTenTep, nhacTepGoi }. */
export function chamCau(cau, traLoi) {
  const van = chuan(traLoi);
  const hits = cacDuongChapNhan(cau).flatMap((d) => viTriDuong(van, d));
  const nhacTep = hits.length > 0;
  const dongNeu = [...new Set(hits.flatMap(([a, b]) => soDongGan(van, a, b)))];
  const dongDung = cau.dong != null && dongNeu.some((n) => Math.abs(n - cau.dong) <= DUNG_SAI_DONG);
  const ten = chuan(cau.tep.split("/").pop());
  const chiTenTep = !nhacTep && viTriDuong(van, ten).length > 0;
  const nhacTepGoi = (cau.tepGoi ?? []).some((g) => viTriDuong(van, chuan(g)).length > 0 ||
    (cau.duAn && g.startsWith(`${cau.duAn}/`) && viTriDuong(van, chuan(g.slice(cau.duAn.length + 1))).length > 0));
  return { dung: nhacTep && (!cau.doiDong || dongDung), nhacTep, dongNeu, dongDung, chiTenTep, nhacTepGoi };
}

// ── KIỂM THƯỚC: câu trả lời mẫu sinh TỪ ĐÁP ÁN ─────────────────────────────────────────────────────

/** Năm kiểu viết đúng, xoay vòng theo chỉ số câu (thước phải nhận đủ các kiểu người/model hay viết). */
function mauDung(cau, i) {
  const tep = cau.tep;
  const tuongDoi = cau.duAn ? tep.slice(cau.duAn.length + 1) : tep;
  const goi = cau.tepGoi?.[0] ? ` Nó được gọi từ \`${cau.tepGoi[0]}\` (dòng 12).` : "";
  switch (i % 5) {
    case 0: return `Định nghĩa ở \`${tep}:${cau.dong}\`.${goi}`;
    case 1: return `Bạn xem tệp ${tep.replace(/\//g, "\\")}, dòng ${cau.dong + 3} — đó là chỗ cần sửa.${goi}`;
    case 2: return `- [${tep.split("/").pop()}](${tep}#L${cau.dong})\n${goi}`;
    case 3: return `Ở dòng ${cau.dong - 2} của D:\\SOURCES\\du-an\\${tep.replace(/\//g, "\\").toUpperCase()} có hàm này.`;
    default: return `**${tuongDoi}** (line ${cau.dong}–${cau.dong + 20}) chứa định nghĩa.${goi}`;
  }
}

/** Tệp SAI nhưng thật: tệp gọi (nếu có) hoặc tệp khác cùng thư mục; giữ ĐÚNG số dòng để chỉ phép so tệp quyết định. */
function tepSai(cau, cungThuMuc) {
  const khac = (cau.tepGoi ?? []).find((g) => g !== cau.tep) ?? cungThuMuc.find((f) => f !== cau.tep);
  return khac ?? `${cau.tep}x`;
}

/**
 * Bộ câu trả lời kiểm thước. `cungThuMuc(cau)` ⇒ danh sách tệp khác cùng thư mục (I/O ở run-tim-ma).
 *   dung      ⇒ kỳ vọng 100 %   sai-tep   ⇒ 0 %   chi-ten-tep ⇒ 0 %
 *   sai-dong  (đúng tệp, dòng lệch +40) ⇒ chỉ các câu KHÔNG đòi dòng được tính ĐÚNG
 *   tien-to   (đường đúng dính chữ: `…/vongAgent.tsx`, `xshared/…`, `xsrc/sanPham.ts`) ⇒ 0 %
 */
export function boTraLoiKiemThuoc(dsCau, cungThuMuc) {
  return {
    dung: dsCau.map((c, i) => mauDung(c, i)),
    "sai-tep": dsCau.map((c) => `Định nghĩa ở \`${tepSai(c, cungThuMuc(c))}:${c.dong}\`.`),
    "chi-ten-tep": dsCau.map((c) => `Nằm trong tệp ${c.tep.split("/").pop()} dòng ${c.dong}.`),
    "sai-dong": dsCau.map((c) => `Định nghĩa ở \`${c.tep}:${c.dong + 40}\`.`),
    // lẻ: dính chữ phía TRƯỚC đường (agent-f: đường tương đối trong dự án) · chẵn: dính chữ phía SAU tên tệp
    "tien-to": dsCau.map((c, i) => {
      if (i % 2) return `Định nghĩa ở \`x${c.duAn ? c.tep.slice(c.duAn.length + 1) : c.tep}:${c.dong}\`.`;
      return `Định nghĩa ở \`${c.tep}x:${c.dong}\`.`;
    }),
  };
}

export function kyVongKiemThuoc(dsCau) {
  return { dung: dsCau.length, "sai-tep": 0, "chi-ten-tep": 0, "sai-dong": dsCau.filter((c) => !c.doiDong).length, "tien-to": 0 };
}
