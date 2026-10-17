/**
 * BỘ "TÌM MÃ" (Đợt 2 §1) — CHUẨN BỊ ĐÁP ÁN từ mã THẬT, không gõ tay số dòng.
 *
 *   node scripts/ai-eval/codegen-chay-duoc/tim-ma/chuanBi.mjs          ⇒ ghi cau.json (đáp án: tệp + dòng định nghĩa)
 *   node scripts/ai-eval/codegen-chay-duoc/tim-ma/chuanBi.mjs --kiem   ⇒ CHỈ kiểm cau.json còn khớp mã hiện tại (exit 1 nếu lệch)
 *
 * Mỗi câu khai `mau` = regex của DÒNG ĐỊNH NGHĨA. Script:
 *   • tìm `mau` trong `tep` ⇒ đúng MỘT dòng (≠ 1 ⇒ hỏng);
 *   • quét CẢ cây (git ls-files + tệp chưa track không bị ignore; bỏ test, tài liệu, tmp, báo cáo) ⇒ `mau` chỉ khớp
 *     ĐÚNG tệp đó (định nghĩa duy nhất — câu hỏi có một đáp án);
 *   • `tepGoi` = các tệp khác nhắc tên ký hiệu theo ranh giới từ (chỉ số PHỤ "nêu chỗ gọi", không vào cổng).
 * run-tim-ma.mjs gọi `kiemDapAn` trước mỗi lượt đo: mã đổi (agent song song sửa tệp) ⇒ dòng lệch ⇒ exit 2, chạy lại script này.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BENCH = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(BENCH, "../../../..");
export const TEP_CAU = path.join(BENCH, "cau.json");

const DA = (id) => `sandbox-projects/agent-f/${id}`;

/**
 * Nguồn câu hỏi. `duAn` (agent-f) ⇒ câu trả lời nêu đường tương đối trong dự án cũng được tính.
 * `doiDong` = câu hỏi đòi số dòng ⇒ phải nêu một dòng trong ±5 của dòng định nghĩa.
 */
const NGUON = [
  // ── repo chính (9) ──
  { id: "R1-chayVongAgent", kyHieu: "chayVongAgent", tep: "shared/agentCore/vongAgent.ts", mau: String.raw`^export async function chayVongAgent\(`, doiDong: true,
    cauHoi: "Hàm chayVongAgent (vòng lặp agent) được định nghĩa ở tệp nào, dòng mấy? Phía server nó được gọi từ đâu?" },
  { id: "R2-gomToolCall", kyHieu: "gomToolCallTuVanBan", tep: "server/services/ai/nativeToolCalls.ts", mau: String.raw`^export function gomToolCallTuVanBan\(`, doiDong: true,
    cauHoi: "Khi model trả tool call dưới dạng văn bản thay vì native tool call, chỗ nào gom chúng lại (gomToolCallTuVanBan)? Cho mình tệp và dòng." },
  { id: "R3-docKetQuaTest", kyHieu: "docKetQuaTest", tep: "shared/aiCodingLoop.ts", mau: String.raw`^export function docKetQuaTest\(`, doiDong: true,
    cauHoi: "Muốn hỗ trợ thêm một định dạng đầu ra test mới cho bước đọc kết quả test (docKetQuaTest) thì sửa ở tệp nào, dòng mấy?" },
  { id: "R4-laGhiVaoRepoChinh", kyHieu: "laGhiVaoRepoChinh", tep: "server/services/aiCodingTuTriGhi.ts", mau: String.raw`^export function laGhiVaoRepoChinh\(`, doiDong: true,
    cauHoi: "Hàm kiểm tra một đường tệp có rơi vào repo chính hay không (laGhiVaoRepoChinh) nằm ở đâu (tệp:dòng), và nó được gọi từ đâu?" },
  { id: "R5-gioiHanVong", kyHieu: "GIOI_HAN_MAC_DINH", tep: "shared/agentCore/kieu.ts", mau: String.raw`^export const GIOI_HAN_MAC_DINH\b`, doiDong: false,
    cauHoi: "Mình muốn tăng số lượt tối đa của vòng agent (mặc định đang là 30 lượt) — giá trị mặc định đó khai ở tệp nào để sửa?" },
  { id: "R6-kiemThamSo", kyHieu: "kiemThamSo", tep: "shared/agentCore/congCu.ts", mau: String.raw`^export function kiemThamSo\(`, doiDong: true,
    cauHoi: "Tham số của một tool call do model gửi lên được kiểm tra hợp lệ ở hàm nào trong lõi agent? Chỉ giúp tệp và dòng." },
  { id: "R7-routeAgentRuns", kyHieu: "/api/ai/agent/runs", tep: "server/routes/aiAgentApi.ts", mau: String.raw`app\.post\("/api/ai/agent/runs",`, doiDong: true,
    cauHoi: "Endpoint POST /api/ai/agent/runs (tạo lượt chạy agent) được đăng ký ở tệp nào, dòng nào?" },
  { id: "R8-loiNhacHeThong", kyHieu: "dungLoiNhacHeThong", tep: "shared/agentCore/loiNhac.ts", mau: String.raw`^export function dungLoiNhacHeThong\(`, doiDong: true,
    cauHoi: "System prompt của chế độ agent được dựng ở hàm nào? Muốn thêm một quy tắc cho model thì sửa tệp nào, dòng nào?" },
  { id: "R9-lamSachBaiHoc", kyHieu: "lamSachBaiHoc", tep: "server/services/ai/codingLessonContext.ts", mau: String.raw`^export function lamSachBaiHoc\(`, doiDong: true,
    cauHoi: "Bài học (lesson) của trợ lý lập trình được làm sạch và che bí mật trước khi lưu ở hàm nào? Cho tệp:dòng." },
  // ── dự án agent-f (6) ──
  { id: "A1-timSanPham", duAn: DA("ts-gio-hang"), kyHieu: "timSanPham", tep: `${DA("ts-gio-hang")}/src/sanPham.ts`, mau: String.raw`^export function timSanPham\(`, doiDong: true,
    cauHoi: `Trong dự án ${DA("ts-gio-hang")}, hàm tìm sản phẩm theo mã nằm ở đâu (tệp:dòng), và giỏ hàng gọi nó ở chỗ nào?` },
  { id: "A2-baoCaoTonThap", duAn: DA("py-kho-cache"), kyHieu: "bao_cao_ton_thap", tep: `${DA("py-kho-cache")}/kho/dich_vu.py`, mau: String.raw`^\s+def bao_cao_ton_thap\(`, doiDong: false,
    cauHoi: `Trong dự án ${DA("py-kho-cache")}, muốn đổi cách lập báo cáo hàng tồn dưới ngưỡng thì sửa ở tệp nào?` },
  { id: "A3-trungVoi", duAn: DA("cs-dat-phong"), kyHieu: "TrungVoi", tep: `${DA("cs-dat-phong")}/src/DatPhong/DatCho.cs`, mau: String.raw`^\s+public bool TrungVoi\(`, doiDong: true,
    cauHoi: `Trong ${DA("cs-dat-phong")}, logic kiểm tra hai lượt đặt phòng có trùng giờ với nhau nằm ở đâu? Cho mình tệp và dòng.` },
  { id: "A4-tachThamSo", duAn: DA("js-cli-viec"), kyHieu: "tachThamSo", tep: `${DA("js-cli-viec")}/src/thamSo.mjs`, mau: String.raw`^export function tachThamSo\(`, doiDong: true,
    cauHoi: `Dự án ${DA("js-cli-viec")}: hàm tách tham số dòng lệnh (các cờ --xxx) ở tệp nào, dòng mấy, và được gọi từ đâu?` },
  { id: "A5-phanTichDong", duAn: DA("cs-nhat-ky"), kyHieu: "PhanTichDong", tep: `${DA("cs-nhat-ky")}/src/NhatKy/BoPhanTich.cs`, mau: String.raw`^\s+public static BanGhi\? PhanTichDong\(`, doiDong: true,
    cauHoi: `Trong ${DA("cs-nhat-ky")}, chỗ phân tích MỘT dòng log thành bản ghi nằm ở đâu (tệp:dòng)?` },
  { id: "A6-traThongDiep", duAn: DA("py-dang-ky"), kyHieu: "t", tep: `${DA("py-dang-ky")}/dang_ky/thong_diep.py`, mau: String.raw`^def t\(`, doiDong: true,
    cauHoi: `Trong ${DA("py-dang-ky")}, thông điệp trả cho người dùng được tra theo khoá ở hàm nào? Cho tệp và dòng.` },
];

const DUOI_QUET = /\.(ts|tsx|mts|js|mjs|cjs|py|cs|java|go|rs|cpp|h)$/i;
const LOAI_TRU = [/(^|\/)tmp\//, /(^|\/)node_modules\//, /(^|\/)(bin|obj|dist|out)\//, /\.test\.|\.spec\.|(^|\/)tests?\//i,
  /(^|\/)test_[^/]*\.py$/, /Tests?\.cs$/, /(^|\/)docs\//, /scripts\/ai-eval\//, /(^|\/)\.vite\//, /(^|\/)test-results\//];

let _dsTep = null;
function danhSachTep() {
  if (_dsTep) return _dsTep;
  const r = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ls-files hỏng: ${r.stderr}`);
  _dsTep = r.stdout.split(/\r?\n/).filter((f) => f && DUOI_QUET.test(f) && !LOAI_TRU.some((x) => x.test(f)));
  return _dsTep;
}
const docDong = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Dòng (1-based) khớp `mau` trong tệp; trả mảng (đúng ra phải 1 phần tử). */
export function timDongDinhNghia(rel, mau) {
  const re = new RegExp(mau);
  return docDong(rel).flatMap((l, i) => (re.test(l) ? [i + 1] : []));
}

function dungMotCau(n) {
  const loi = [];
  if (!fs.existsSync(path.join(ROOT, n.tep))) return { loi: [`${n.id}: tệp không tồn tại ${n.tep}`] };
  const dongs = timDongDinhNghia(n.tep, n.mau);
  if (dongs.length !== 1) loi.push(`${n.id}: mẫu định nghĩa khớp ${dongs.length} dòng trong ${n.tep} (cần đúng 1)`);
  const re = new RegExp(n.mau);
  const phamVi = danhSachTep().filter((f) => !n.duAn || f.startsWith(`${n.duAn}/`));
  const khac = phamVi.filter((f) => f !== n.tep && docDong(f).some((l) => re.test(l)));
  if (khac.length) loi.push(`${n.id}: định nghĩa KHÔNG duy nhất — cũng khớp ở ${khac.join(", ")}`);
  const reTen = n.kyHieu.startsWith("/") ? new RegExp(escRe(n.kyHieu)) : new RegExp(`(?<![\\w$])${escRe(n.kyHieu)}(?![\\w$])`);
  const tepGoi = phamVi.filter((f) => f !== n.tep && docDong(f).some((l) => reTen.test(l)));
  const cau = {
    id: n.id, cauHoi: n.cauHoi, kyHieu: n.kyHieu, tep: n.tep, dong: dongs[0] ?? null, doiDong: n.doiDong,
    duAn: n.duAn ?? null, mau: n.mau, tepGoi: tepGoi.slice(0, 30),
    dongMa: dongs.length ? docDong(n.tep)[dongs[0] - 1].trim().slice(0, 160) : null,
  };
  return { cau, loi };
}

/** Kiểm cau.json còn khớp mã hiện tại. Trả danh sách lỗi (rỗng = khớp). */
export function kiemDapAn(dsCau) {
  const loi = [];
  for (const c of dsCau) {
    if (!fs.existsSync(path.join(ROOT, c.tep))) { loi.push(`${c.id}: mất tệp ${c.tep}`); continue; }
    const dongs = timDongDinhNghia(c.tep, c.mau);
    if (dongs.length !== 1 || dongs[0] !== c.dong) loi.push(`${c.id}: định nghĩa giờ ở dòng [${dongs.join(",")}] của ${c.tep}, đáp án ghi ${c.dong}`);
  }
  return loi;
}

export function docCau() {
  return JSON.parse(fs.readFileSync(TEP_CAU, "utf8")).cau;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--kiem")) {
    const loi = kiemDapAn(docCau());
    console.log(loi.length ? `⛔ ĐÁP ÁN LỆCH MÃ:\n  ${loi.join("\n  ")}` : `✓ cau.json khớp mã hiện tại (${docCau().length} câu)`);
    process.exit(loi.length ? 1 : 0);
  }
  const ketQua = NGUON.map(dungMotCau);
  const loi = ketQua.flatMap((k) => k.loi);
  if (loi.length) { console.error(`⛔ KHÔNG ghi cau.json:\n  ${loi.join("\n  ")}`); process.exit(1); }
  const cau = ketQua.map((k) => k.cau);
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(TEP_CAU, JSON.stringify({ moTa: "Bộ tìm mã Đợt 2 — SINH bởi chuanBi.mjs từ mã thật; đừng sửa tay số dòng.", luc: new Date().toISOString(), commit, cau }, null, 1) + "\n");
  console.log(`✓ ghi ${path.relative(ROOT, TEP_CAU)}: ${cau.length} câu (repo chính ${cau.filter((c) => !c.duAn).length}, agent-f ${cau.filter((c) => c.duAn).length})`);
  for (const c of cau) console.log(`  ${c.id.padEnd(22)} ${c.tep}:${c.dong}  gọi:${c.tepGoi.length}  ${c.dongMa}`);
}
