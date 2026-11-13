/**
 * Pilot "Thợ Cả nhận việc" — THẺ VIỆC (mẫu: D:\SOURCES\_tho_ca_pilot\ke-hoach.md) + phép kiểm "chỉ sửa tệp được phép".
 * THUẦN (không fs, không git): bộ chạy `chayMotViec.ts` đưa danh sách tệp đổi vào đây để phân loại.
 *
 * Thẻ là văn bản `KHOÁ: giá trị` (khoá in hoa, một khoá có thể trải nhiều dòng thụt vào hoặc gạch đầu dòng):
 *   MÃ: TC-01
 *   MỤC TIÊU: <một câu>
 *   TỆP ĐƯỢC PHÉP SỬA/TẠO: a.ts, b.ts   (hoặc mỗi tệp một dòng "- a.ts"; hỗ trợ `dir/*` và `dir/**`)
 *   NGỮ CẢNH ĐỌC: ...
 *   LỆNH KIỂM: npx vitest run a.test.ts
 *   GIỚI HẠN: 15 phút, 12 vòng
 */
import { docDotBien, docKhangDinhCam, type DotBienThe } from "./dotBienThuan";
import { TRAN_CUNG_SO_LUOT } from "../../server/services/ai/agent/gioiHanLuot";
import { tachChoPhep } from "./quetTinh";
import { docBangDem, type MucDem } from "./hauQua";
import { docSoTran, GIOI_PHUT, GIOI_TOKEN_RA, type TranTheoThe } from "./tranLuot";

export interface TheViec {
  ma: string;
  mucTieu: string;
  tepDuocPhep: string[];
  nguCanhDoc: string[];
  /** CHỈ phần lệnh (một dòng, đã cắt lời văn sau dấu chấm hết câu) — là thứ bộ chạy THỰC SỰ chạy và host so khớp run_command */
  lenhKiem: string;
  /** lời văn đi kèm LỆNH KIỂM trong thẻ (không chạy) */
  lenhKiemGhiChu?: string;
  /** QUY TRÌNH: bước bắt buộc trước khi làm (vd in danh sách hành vi rồi chờ duyệt) — chuyển nguyên văn cho model */
  quyTrinh?: string;
  /**
   * L3b — CHỈ BỘ CHẠY ĐỌC. Đột biến do thẻ khai (tệp|tìm|thay) áp SAU khi model xong. KHÔNG BAO GIỜ vào lời nhắc của model, không ghi vào worktree lúc model chạy,
   * và bị gỡ khỏi `the` đưa cho driver (xem chayMotViec: theChoDriver).
   */
  dotBien?: DotBienThe[];
  /** L3b — chuỗi/regex test của model KHÔNG ĐƯỢC khẳng định (bộ chạy quét; không đưa cho model) */
  khangDinhCam?: Array<string | RegExp>;
  /** CSDL: khai việc có chạm CSDL _test (CHỈ BỘ CHẠY đọc, KHÔNG vào lời nhắc của model). Điều kiện 2 của `--cho-phep-db`: phải nêu aoi_management_test. */
  csdl?: string;
  /** HA-3 — trần lượt agent do khoá thẻ TƯỜNG MINH (TRẦN LƯỢT MODEL / TRẦN PHÚT / TRẦN TOKEN RA); vắng ⇒ không áp gì. Chữ tự do trong GIỚI HẠN không được phân tích để áp trần. */
  tran?: TranTheoThe;
  /** HA-10 — `KIỂM PHỦ: CÓ`: trước khi nhận "xong", mọi dòng ĐÃ DUYỆT (trừ GIỮ:) phải có ca MỚI tên `[Dk] ` (xem kiemPhu.ts). Host-only; mặc định TẮT. */
  kiemPhu?: boolean;
  /** HA-6b — `BẢNG ĐẾM:` (host-only): các mục đếm hàng CSDL trước/sau lượt, dạng đóng (xem hauQua.ts). Vắng ⇒ không kiểm hậu quả. Model không thấy. */
  bangDem?: MucDem[];
  /** HA-9 — mục cho phép của bộ quét tĩnh (khoá `CHO PHÉP TRONG TEST`): tắt cảnh báo oan, CHỈ khi đoạn khớp nằm trong chính mục. Không phải quyền — chỉ bộ chạy đọc. */
  choPhepTrongTest?: string[];
  gioiHan: { giay: number; vong: number };
}

const KHOA: Record<string, keyof TheViec | "tepDuocPhep"> = {
  "MA": "ma",
  "MUC TIEU": "mucTieu",
  "TEP DUOC PHEP SUA/TAO": "tepDuocPhep",
  "TEP DUOC PHEP": "tepDuocPhep",
  "NGU CANH DOC": "nguCanhDoc",
  "LENH KIEM": "lenhKiem",
  "GIOI HAN": "gioiHan",
  "QUY TRINH": "quyTrinh",
  "GHI CHU LENH KIEM": "lenhKiemGhiChu",
  "DOT BIEN": "dotBien",
  "KHONG DUOC KHANG DINH": "khangDinhCam",
  "CSDL": "csdl",
  "TRAN LUOT MODEL": "tranLuotModel",
  "TRAN PHUT": "tranPhut",
  "TRAN TOKEN RA": "tranTokenRa",
  "KIEM PHU": "kiemPhu",
  "BANG DEM": "bangDem",
  "CHO PHEP TRONG TEST": "choPhepTrongTest",
};

/** Bỏ dấu + in hoa để so khoá (thẻ do người gõ, dấu có thể thiếu). */
function chuanKhoa(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const RE_MA = /^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/;

export type KetQuaThe = { ok: true; the: TheViec } | { ok: false; loi: string };

function tachDanhSach(s: string): string[] {
  return s
    .split(/[,\n]/)
    .map((x) => x.replace(/^\s*[-*]\s+/, "").trim())
    .filter((x) => x !== "");
}

/**
 * Tách LỆNH KIỂM thô của thẻ thành phần LỆNH (dòng đầu, cắt tại dấu chấm hết câu ". " + chữ, bỏ dấu chấm cuối) và GHI CHÚ (phần còn lại).
 * Vì sao: thẻ viết văn xuôi ngay sau lệnh ("npx vitest run a.test.ts. Ngoài ra …") — bộ chạy NAY chạy lệnh này trong shell và host so khớp
 * nguyên văn run_command, nên phải là lệnh sạch. Dấu chấm trong đường (a.unit.test.ts, ./x) không có khoảng trắng sau nên không bị cắt.
 */
export function tachLenhKiem(tho: string): { lenh: string; ghiChu: string } {
  const dong = tho.replace(/\r\n/g, "\n").split("\n");
  const dau = (dong[0] ?? "").trim();
  const m = /\.\s+\S/.exec(dau);
  const lenh = (m ? dau.slice(0, m.index) : dau).replace(/\.$/, "").trim();
  const conLai = [m ? dau.slice(m.index + 1).trim() : "", ...dong.slice(1).map((x) => x.trim())].filter((x) => x !== "");
  return { lenh, ghiChu: conLai.join(" ") };
}

/** `GIỚI HẠN: 15 phút, 12 vòng` (phút/giây/vòng, thứ tự tuỳ ý). Vắng ⇒ mặc định 15 phút, 12 vòng. */
export function docGioiHan(s: string | undefined): { giay: number; vong: number } {
  let giay = 15 * 60;
  let vong = 12;
  if (s) {
    const ph = /(\d+)\s*(phut|phút|min|m)\b/i.exec(s);
    const gi = /(\d+)\s*(giay|giây|sec|s)\b/i.exec(s);
    const vg = /(\d+)\s*(vong|vòng|round|rounds|turn|turns)\b/i.exec(s);
    if (ph) giay = Number(ph[1]) * 60;
    else if (gi) giay = Number(gi[1]);
    if (vg) vong = Number(vg[1]);
  }
  return { giay: Math.min(Math.max(giay, 30), 3600), vong: Math.min(Math.max(vong, 1), 40) };
}

export function docTheViec(van: string): KetQuaThe {
  const truong = new Map<string, string>();
  let hienTai: string | null = null;
  for (const dong of van.replace(/\r\n/g, "\n").split("\n")) {
    const m = /^([^:\n]{1,40}):\s*(.*)$/.exec(dong);
    const khoa = m ? KHOA[chuanKhoa(m[1])] : undefined;
    if (m && khoa) {
      hienTai = khoa;
      truong.set(khoa, m[2]);
    } else if (hienTai) {
      truong.set(hienTai, `${truong.get(hienTai) ?? ""}\n${dong}`);
    }
  }
  const ma = (truong.get("ma") ?? "").trim();
  if (!RE_MA.test(ma)) return { ok: false, loi: "MÃ thẻ thiếu hoặc không hợp lệ (chữ, số, gạch ngang; ≤ 31 ký tự)" };
  const mucTieu = (truong.get("mucTieu") ?? "").trim();
  if (mucTieu === "") return { ok: false, loi: "thiếu MỤC TIÊU" };
  const tepDuocPhep = tachDanhSach(truong.get("tepDuocPhep") ?? "");
  if (tepDuocPhep.length === 0) return { ok: false, loi: "thiếu TỆP ĐƯỢC PHÉP SỬA/TẠO (danh sách rỗng ⇒ không việc nào hợp lệ)" };
  for (const t of tepDuocPhep) {
    const loi = kiemTepDuocPhep(t);
    if (loi) return { ok: false, loi: `TỆP ĐƯỢC PHÉP "${t}": ${loi}` };
  }
  const lenhTho = (truong.get("lenhKiem") ?? "").trim();
  if (lenhTho === "") return { ok: false, loi: "thiếu LỆNH KIỂM" };
  const { lenh: lenhKiem, ghiChu: ghiChuTuLenh } = tachLenhKiem(lenhTho);
  // khoá GHI CHÚ LỆNH KIỂM riêng (thẻ viết từ TC-06) + lời văn dính sau lệnh (thẻ cũ) gộp thành một
  const lenhKiemGhiChu = [ghiChuTuLenh, (truong.get("lenhKiemGhiChu") ?? "").trim()].filter((x) => x !== "").join(" ");
  if (lenhKiem === "") return { ok: false, loi: "LỆNH KIỂM không có phần lệnh (chỉ có lời văn)" };
  const quyTrinh = (truong.get("quyTrinh") ?? "").trim();
  const db = docDotBien(truong.get("dotBien") as string ?? "");
  if (db.loi.length > 0) return { ok: false, loi: db.loi.join("; ") };
  for (const d of db.ds) {
    if (tepDuocPhep.includes(d.tep)) return { ok: false, loi: `ĐỘT BIẾN ${d.tep}: nằm trong TỆP ĐƯỢC PHÉP của model (đột biến phải ở tệp NGUỒN, không phải bài làm)` };
  }
  const khangDinhCam = docKhangDinhCam((truong.get("khangDinhCam") as string) ?? "");
  const csdl = (truong.get("csdl") ?? "").trim();
  const kiemPhuTho = chuanKhoa((truong.get("kiemPhu") ?? "").trim());
  if (kiemPhuTho !== "" && kiemPhuTho !== "CO" && kiemPhuTho !== "KHONG") return { ok: false, loi: `KIỂM PHỦ phải là CÓ hoặc KHÔNG (nhận "${(truong.get("kiemPhu") ?? "").trim().slice(0, 20)}")` };
  const bangDemDoc = docBangDem(truong.get("bangDem") as string | undefined);
  if (!bangDemDoc.ok) return { ok: false, loi: bangDemDoc.loi };
  const choPhepTrongTest = tachChoPhep((truong.get("choPhepTrongTest") ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(";"));
  const tran: TranTheoThe = {};
  for (const [khoa, ten, gioi, truongTran] of [
    ["tranLuotModel", "TRẦN LƯỢT MODEL", { min: 1, max: TRAN_CUNG_SO_LUOT }, "luotModel"],
    ["tranPhut", "TRẦN PHÚT", GIOI_PHUT, "phut"],
    ["tranTokenRa", "TRẦN TOKEN RA", GIOI_TOKEN_RA, "tokenRa"],
  ] as const) {
    const tho = truong.get(khoa);
    if (tho === undefined) continue;
    const n = docSoTran(tho, gioi.min, gioi.max);
    if (n === null) return { ok: false, loi: `${ten} phải là một số nguyên trong khoảng ${gioi.min}..${gioi.max}` };
    tran[truongTran] = n;
  }
  return {
    ok: true,
    the: {
      ma,
      mucTieu,
      tepDuocPhep,
      nguCanhDoc: tachDanhSach(truong.get("nguCanhDoc") ?? ""),
      lenhKiem,
      ...(lenhKiemGhiChu ? { lenhKiemGhiChu } : {}),
      ...(quyTrinh ? { quyTrinh } : {}),
      ...(db.ds.length ? { dotBien: db.ds } : {}),
      ...(khangDinhCam.length ? { khangDinhCam } : {}),
      ...(csdl ? { csdl } : {}),
      ...(kiemPhuTho === "CO" ? { kiemPhu: true } : {}),
      ...(bangDemDoc.muc.length ? { bangDem: bangDemDoc.muc } : {}),
      ...(choPhepTrongTest.length ? { choPhepTrongTest } : {}),
      ...(Object.keys(tran).length > 0 ? { tran } : {}),
      gioiHan: docGioiHan(truong.get("gioiHan")),
    },
  };
}

// ── Chuẩn hoá đường + vùng cấm ────────────────────────────────────────────────────────────────

/** Đường tương đối kiểu POSIX trong worktree, hoặc null nếu thoát ra ngoài / tuyệt đối / có ký tự điều khiển. */
export function chuanDuong(p: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(p)) return null;
  const x = p.replace(/\\/g, "/").replace(/^\.\//, "");
  if (x === "" || x.startsWith("/") || /^[A-Za-z]:/.test(x)) return null;
  const phan: string[] = [];
  for (const s of x.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") return null;
    phan.push(s);
  }
  return phan.length ? phan.join("/") : null;
}

/**
 * VÙNG CẤM — luật cứng của kế hoạch: không giao đường lệnh/STOP, ot/*, an ninh/quyền/auth, migration, socket, thiết bị, bí mật.
 * Áp ĐỘC LẬP với thẻ: một thẻ lỡ ghi tệp vùng cấm vẫn bị từ chối ở `docTheViec`, và một lượt chạm vùng cấm bị đánh dấu dù thẻ cho phép.
 *
 * HAI MỨC (sửa sau TC-02: `client/src/lib/stateVocabulary.edge.test.ts` bị gắn nhãn "vung-cam (thiet bi)" chỉ vì TÊN TỆP có chữ "edge"):
 *  • MẠNH — khớp theo ĐOẠN THƯ MỤC (`…/edge/…`, `…/ot/…`, `drizzle/`, `auth/`…) hoặc tệp đặc biệt (.env, khoá, .git), và — CHỈ trong mã backend
 *    `server/` · `shared/` — tên tệp nền socket, auth, accessControl, trpc, permission, sdk (tiền tố). Luôn là vùng cấm.
 *  • MỜ — khớp CHUỖI CON tên tệp (stop·interlock·dispatcher·plc·modbus·opcua·mqtt·robot·scada·edge·device·hardware·secret), CHỈ trong `server/` · `shared/`
 *    (nơi một cái tên như `foeStopHangMoi.ts` đáng ngờ thật). Tệp ngoài `server/`·`shared/` (vd `client/src/lib/…edge…`) KHÔNG bao giờ là vùng cấm theo tên.
 *    Tệp khớp mờ mà NGOÀI thẻ ⇒ nhãn "ngoai-danh-sach" (đúng sự thật: bị chặn vì ngoài thẻ); khớp mờ mà TRONG thẻ ⇒ vẫn vùng cấm (thẻ sai).
 */
const GOC_BACKEND = /^(server|shared)\//i;

export const VUNG_CAM_MANH: ReadonlyArray<{ ten: string; re: RegExp }> = [
  { ten: "ot", re: /(^|\/)ot\//i },
  { ten: "migration", re: /(^|\/)(drizzle|migrations?)\//i },
  { ten: "auth/quyen", re: /(^|\/)auth\//i },
  { ten: "thiet bi", re: /(^|\/)(edge|robots?|scada|plc|modbus|opcua|mqtt|devices?|hardware)\//i },
  { ten: "stop/interlock", re: /(^|\/)(stop|estop|e-stop|interlocks?)\//i },
  { ten: "bi mat", re: /(^|\/)\.env([./]|$)|\.(pem|key|p12|pfx)$/i },
  { ten: "git", re: /(^|\/)\.git(\/|$)/i },
];

/** Chỉ áp cho đường bắt đầu bằng server/ hoặc shared/. */
export const VUNG_CAM_MANH_BACKEND: ReadonlyArray<{ ten: string; re: RegExp }> = [
  { ten: "auth/quyen", re: /(^|\/)(auth|accessControl|trpc|permission|requirePermission|sdk)[^/]*\.(ts|tsx|js|mjs)$/i },
  { ten: "socket", re: /(^|\/)socket[^/]*\.(ts|tsx|js|mjs)$/i },
];

/** Chỉ áp cho đường bắt đầu bằng server/ hoặc shared/. */
export const VUNG_CAM_MO_BACKEND: ReadonlyArray<{ ten: string; re: RegExp }> = [
  { ten: "stop/interlock", re: /(stop|e-?stop|interlock|dispatcher)/i },
  { ten: "thiet bi", re: /(plc|modbus|opcua|mqtt|robot|scada|edge|device|hardware)/i },
  { ten: "bi mat", re: /secret/i },
];

/** Mức vùng cấm của một đường (đã chuẩn hoá, POSIX): "manh" | "mo" | null. THUẦN. */
export function mucVungCam(duong: string): { muc: "manh" | "mo"; ten: string } | null {
  for (const v of VUNG_CAM_MANH) if (v.re.test(duong)) return { muc: "manh", ten: v.ten };
  if (GOC_BACKEND.test(duong)) {
    for (const v of VUNG_CAM_MANH_BACKEND) if (v.re.test(duong)) return { muc: "manh", ten: v.ten };
    for (const v of VUNG_CAM_MO_BACKEND) if (v.re.test(duong)) return { muc: "mo", ten: v.ten };
  }
  return null;
}

/** Tên vùng cấm (cả mạnh lẫn mờ) hoặc null — dùng để từ chối thẻ / lời gọi ghi. */
export function vungCamCua(duong: string): string | null {
  return mucVungCam(duong)?.ten ?? null;
}

function kiemTepDuocPhep(mau: string): string | null {
  const m = mau.replace(/\\/g, "/");
  const goc = m.replace(/\/\*{1,2}$/, "");
  const duong = chuanDuong(goc);
  if (duong === null) return "đường không hợp lệ (tuyệt đối, có '..' hoặc ký tự điều khiển)";
  if (/\*/.test(goc)) return "chỉ cho phép ký tự đại diện ở cuối (`dir/*` hoặc `dir/**`)";
  const cam = vungCamCua(duong);
  if (cam) return `nằm trong vùng cấm (${cam})`;
  return null;
}

function khop(mau: string, duong: string): boolean {
  const m = mau.replace(/\\/g, "/");
  if (m.endsWith("/**")) return duong.startsWith(m.slice(0, -2));
  if (m.endsWith("/*")) {
    const goc = m.slice(0, -1);
    return duong.startsWith(goc) && !duong.slice(goc.length).includes("/");
  }
  return chuanDuong(m) === duong;
}

export interface ViPhamDiff {
  duong: string;
  loai: "ngoai-danh-sach" | "vung-cam" | "duong-khong-hop-le" | "cham-db" | "khang-dinh-cam";
  chiTiet?: string;
}

/** Phân loại các tệp mà diff chạm vào. Rỗng ⇒ không vi phạm. THUẦN. */
export function kiemDiffTheoThe(tepDoi: readonly string[], tepDuocPhep: readonly string[]): ViPhamDiff[] {
  const ra: ViPhamDiff[] = [];
  for (const t of tepDoi) {
    const d = chuanDuong(t);
    if (d === null) {
      ra.push({ duong: t, loai: "duong-khong-hop-le" });
      continue;
    }
    const cam = mucVungCam(d);
    const trongThe = tepDuocPhep.some((m) => khop(m, d));
    // MẠNH ⇒ luôn vùng cấm. MỜ (khớp chuỗi con tên tệp trong server/shared): ngoài thẻ ⇒ nhãn đúng sự thật "ngoai-danh-sach"; trong thẻ ⇒ vùng cấm (thẻ sai).
    if (cam && (cam.muc === "manh" || trongThe)) {
      ra.push({ duong: d, loai: "vung-cam", chiTiet: cam.ten });
      continue;
    }
    if (!trongThe) ra.push({ duong: d, loai: "ngoai-danh-sach", ...(cam ? { chiTiet: `khớp mờ vùng cấm (${cam.ten}) — nhưng đã ngoài thẻ` } : {}) });
  }
  return ra;
}

// ── Test chạm DB (luật dieu-phoi 2026-11-02: quét NỘI DUNG, không chỉ tên *.db.test.ts) ─────────────

/** Dấu hiệu một tệp chạm DB: import/mock getDb·postgres·drizzle·db/*, DATABASE_URL, hoặc tên *.db.test.*. THUẦN; trả danh sách dấu hiệu tìm thấy. */
export function quetChamDb(duong: string, noiDung: string): string[] {
  const ra: string[] = [];
  if (/\.db\.test\.[cm]?[jt]sx?$/i.test(duong)) ra.push("tên .db.test");
  const mau: Array<[string, RegExp]> = [
    ["getDb/getReadDb", /\bget(Read)?Db\b/],
    ["import postgres", /(?:from|import|require\()\s*\(?\s*["']postgres["']/],
    ["import drizzle", /(?:from|import|require\()\s*\(?\s*["']drizzle-orm[^"']*["']/],
    ["import db/*", /(?:from|import|require\()\s*\(?\s*["'][^"']*\/db(?:\/[^"']*)?["']/],
    ["vi.mock db", /vi\.(?:do)?mock\(\s*["'][^"']*\/db(?:\/[^"']*)?["']/],
    ["DATABASE_URL", /\bDATABASE_URL\b/],
    ["db.select/insert/execute", /\bdb\s*\.\s*(?:select|insert|update|delete|execute|transaction)\s*\(/],
  ];
  for (const [ten, re] of mau) if (re.test(noiDung)) ra.push(ten);
  return ra;
}

/** Các đường tệp test nêu trong LỆNH KIỂM (token kết thúc bằng .test.ts/tsx/js/mjs/cjs/jsx). */
export function tepTestTrongLenh(lenh: string): string[] {
  return lenh
    .split(/\s+/)
    .map((x) => x.replace(/^["']|["']$/g, "").replace(/\\/g, "/"))
    .filter((x) => /\.test\.[cm]?[jt]sx?$/.test(x));
}
