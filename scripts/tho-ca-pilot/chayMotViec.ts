/**
 * Pilot "Thợ Cả nhận việc" — BỘ CHẠY MỘT VIỆC.
 *
 *   npx tsx scripts/tho-ca-pilot/chayMotViec.ts --the <tep-the.txt> [--wt D:\SOURCES\_tho_ca_wt] [--base main]
 *        [--driver kho|cli] [--ra <thu-muc-ket-qua>] [--ghi-luot <thu-muc>]
 *
 * Việc làm (theo thứ tự): đọc thẻ → kiểm worktree (LIÊN KẾT, sạch, tên `_tho_ca*`) → `git checkout -B pilot/tho-ca-<mã> <base>` → chép luật dự án
 * (`AGENTS.md`, ẩn khỏi diff) → chạy driver có hạn giờ → thu diff (kể cả tệp mới) + dòng thêm/xoá + thời gian tường → đối chiếu "chỉ sửa tệp
 * được phép" + vùng cấm cứng + CRLF → ghi `<ra>/<mã>.diff` và IN ĐÚNG MỘT DÒNG JSON kết quả ra stdout (nhật ký đi stderr).
 *
 * KHÔNG BAO GIỜ: commit · đụng main/.env/:3000/DB · in mật khẩu.
 * L3a (kiểm chứng tự động): SAU khi driver xong và diff sạch, bộ chạy TỰ chạy LỆNH KIỂM của thẻ trong worktree pilot (env DB chết, hạn riêng),
 * ĐỌC dòng "Test Files"/"Tests" của vitest và chỉ cho `xong` khi đạt; đỏ ⇒ `kiem-do`, 0 ca ⇒ `test-rong` (xem kiemChung.ts). Không tin lời khai của model.
 *
 * DRIVER
 *  • kho — chạy khô, KHÔNG gọi model: ghi các tệp mà `--kho-ghi` (JSON {đường: nộiDung}) nêu. Dùng để thử bộ chạy / ca kiểm.
 *  • cli — `npm run ai:cli` CÓ NGƯỜI NGỒI (stdio kế thừa). CLI cố ý đòi một phím 'y' sống cho MỖI lượt ghi (`hoiTuoi`: "KHÔNG có cờ bỏ qua bước
 *          duyệt"); bộ chạy KHÔNG tự trả lời 'y' thay người. Danh tính: AVI_CLI_USER / AVI_CLI_PASSWORD của TIẾN TRÌNH CHA (tài khoản không admin).
 *          ⚠ CLI dùng `streamAnswer` (đường tri thức cũ), KHÔNG qua `goiModelMayChu` ⇒ không có AI_GHI_LUOT_DIR / cacheTokens; không nạp AGENTS.md
 *          (luật được ghép vào đầu `--lenh`).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chuanDuong, docTheViec, kiemDiffTheoThe, quetChamDb, tepTestTrongLenh, type TheViec, type ViPhamDiff } from "./theViec";
import { dongBaoTran, gioiHanChoLuot, tinhTranLuot, type GioiHanLuotChoDriver, type TranLuotKetQua } from "./tranLuot";
import { apDungDotBien, kiemDotBienTrenBase, quetGhimNghiNgo, quetKhangDinhCam, tepTestDoi, type KetQuaDotBien } from "./dotBien";
import { canChayTsc, chayLenhTsc, giaTriBiMatTuUrl, taoChayLenhKiem, demTepTest, laLenhVitest, quyetKetCuc, type ChayKiem, type ChayTsc, type KetCucKiem, type KetQuaKiem, type KetQuaTsc } from "./kiemChung";

export type TenDriver = "kho" | "cli" | "host";

export interface KetQuaDriver {
  /** vòng model đã chạy nếu driver biết; null = không biết */
  vong: number | null;
  /** token xử lý nếu có nguồn (bản ghi lượt); null = không đo được */
  token: { cache: number | null; prompt: number | null; soLuotModel: number } | null;
  /** nhật ký ngắn (đi stderr) */
  ghiChu: string[];
  /** thống kê cổng duyệt (driver host): giây chờ NGƯỜI tách khỏi thời gian model */
  duyet?: { soLanCho: number; soChapNhan: number; soTuChoi: number; giayChoDuyet: number };
  /** lý do dừng của lượt (hoan-thanh | het-luot | het-gio | loi-model | …) nếu driver biết */
  lyDoDung?: string;
  /** thống kê cổng kế hoạch 11.3-C (chỉ có khi cờ bật và có ít nhất một kế hoạch chờ) */
  keHoach?: { soLanCho: number; soChapNhan: number; soTuChoi: number };
  /** lưu ý driver muốn ghi vào JSON (vd khoá checkpoint tạm) */
  luuY?: string[];
  /** đếm lỗi công cụ theo mã (vd { "CHECKPOINT_LOI:KHONG_CO_KHOA": 4 }) */
  loiCongCu?: Record<string, number>;
}

export interface DauVaoDriver {
  the: TheViec;
  wt: string;
  /** luật dự án đã ghép sẵn + thẻ, dạng một lệnh */
  lenh: string;
  hanGiay: number;
  /** thư mục kết quả (hồ sơ chờ duyệt đặt ở đây) */
  ra: string;
  ghiLuotDir: string | null;
  khoGhi: Record<string, string>;
  /** hàm chạy lệnh kiểm cho vòng TỰ CHẠY trong lượt (chỉ đặt khi `--cho-phep-db` hoặc ca kiểm tiêm); vắng ⇒ driver dùng mặc định (DB chết) */
  chayKiem?: ChayKiem;
  /** HA-3: trần lượt agent do KHOÁ THẺ (vắng khi thẻ không có khoá ⇒ driver không ép gì) */
  gioiHanLuot?: GioiHanLuotChoDriver;
  /** `chi-so` (đặt khi `--cho-phep-db`): vòng tự chạy lệnh kiểm trong lượt CHỈ trả cho model con số + tên ca đỏ, KHÔNG kèm đuôi đầu ra */
  cheDoKiem?: "chi-so";
  /** giá trị bí mật (vd mật khẩu CSDL) phải bị xoá khỏi mọi thứ trả cho model, ở mọi dạng mã hoá */
  giaTriBiMat?: string[];
}
export type Driver = (v: DauVaoDriver) => Promise<KetQuaDriver & { hetGio: boolean; loi?: string }>;

export interface KetQuaViec {
  ma: string | null;
  ok: boolean;
  /** xong | het-gio | loi-driver | vi-pham | tu-choi | khong-lam | kiem-do | test-rong | bao-sai | dot-bien-song (hai cuối: L4 / L3b) */
  ketCuc: KetCucKiem;
  loi?: string;
  nhanh?: string;
  baseSha?: string;
  driver?: TenDriver;
  giayTuong?: number;
  /**
   * giayTuong trừ thời gian chờ người duyệt. KHÔNG phải thời gian model: gồm model + công cụ + lệnh kiểm bộ chạy tự chạy (trong lượt) + phần còn lại.
   * (Trước đây đặt tên `giayModel` — do-model chỉ ra là sai nghĩa; thời gian model thật = tổng totalTimeMs trong lượt ghi AI_GHI_LUOT_DIR.)
   */
  giayKhongChoNguoi?: number;
  /** lý do dừng của lượt agent (hoan-thanh | het-luot | loi-model | …) — driver host */
  lyDoDung?: string;
  /** cổng kế hoạch 11.3-C: số kế hoạch chờ / được duyệt / bị bác */
  keHoach?: { soLanCho: number; soChapNhan: number; soTuChoi: number };
  soLanCho?: number;
  soChapNhan?: number;
  soTuChoi?: number;
  giayChoDuyet?: number;
  /** số lỗi công cụ theo mã — để thấy ngay từ JSON vì sao Thợ Cả không ghi được */
  loiCongCu?: Record<string, number>;
  vong?: number | null;
  token?: KetQuaDriver["token"];
  tepDoi?: string[];
  dong?: { them: number; xoa: number };
  viPham?: ViPhamDiff[];
  crlf?: string[];
  diff?: string;
  lenhKiem?: string;
  /** L3a: kết quả bộ chạy TỰ chạy lệnh kiểm (vắng khi ketCuc đã xấu từ trước hoặc có tệp test rỗng) */
  kiem?: Omit<KetQuaKiem, "lenh">;
  /** L3c: kết quả tsc trên tệp model đổi (vắng khi không chạy) */
  tsc?: KetQuaTsc;
  /** L3b: kết quả áp đột biến của thẻ (vắng khi thẻ không có hoặc các bước trước chưa xanh) */
  dotBien?: KetQuaDotBien;
  /** cờ AI_AGENT_* có hiệu lực trong lượt này (tên → giá trị; không có bí mật) */
  coAiAgent?: Record<string, string>;
  /** LUẬT dự án thật sự gửi model (ghi vào AGENTS.md của worktree VÀ ghép vào lệnh): sha256 của đúng chuỗi đó, nguồn (đường tệp hoặc "tham-so") và số byte UTF-8 */
  luat?: { sha256: string; nguon: string; byte: number };
  /** cách đưa luật (`--luat-cach`); LUÔN có */
  luatCach?: LuatCach;
  /** chỉ khi `ghep`: AGENTS.md của BASE (B1) model đọc — sha256/byte của đúng nội dung ở base (null nếu base không có), và worktree sau lượt còn KHỚP base hay không */
  b1?: { nguon: string; sha256: string | null; byte: number; saoLuotKhop: boolean };
  /** HA-3: trần lượt đã áp (chỉ khi thẻ có khoá TRẦN …): khoá thẻ, biến env, trần cứng, số thực dùng. "vòng" = một lần gọi model */
  tran?: TranLuotKetQua;
  /** `--cho-phep-db` đã bật cho lượt này (mặc định vắng = TẮT) */
  choPhepDb?: true;
  /** vai CSDL mà lệnh kiểm dùng khi có cờ (tên vai, không phải bí mật) */
  vaiCsdl?: string;
  /** commit của repo chứa BỘ CHẠY lúc chạy, và liệu thư mục bộ chạy/luật có lệch commit đó không (bản tạm chưa commit ⇒ sach=false) */
  boChay?: BoChay;
  /** L3b: nhãn nghi "ghim lỗi thành kỳ vọng" trong tệp test model viết — CHỈ cảnh báo, người đọc quyết */
  ghimNghiNgo?: Array<{ duong: string; dong: number; trich: string }>;
  /** L3a: số ca đếm tĩnh của từng tệp test model thêm/sửa */
  tepTest?: Array<{ duong: string; soCa: number }>;
  /** chưa đo được gì ở các trường trên null — nói rõ vì sao */
  luuY?: string[];
}

function git(args: string[], cwd: string, dauVao?: string): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", input: dauVao, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const NHANH_PILOT = /^pilot\/tho-ca-[A-Za-z0-9-]+$/;
const RE_NHANH_MA =/^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/;

/**
 * Đọc URL CSDL của vai `tho_ca_test` từ TỆP (một dòng, ngoài repo và ngoài worktree pilot). KHÔNG bao giờ đưa nội dung tệp vào thông báo lỗi.
 * `cacThuMucCam`: tệp nằm TRONG các thư mục này (repo bộ chạy, worktree) ⇒ từ chối.
 */
export function docUrlTuTep(duong: string, cacThuMucCam: readonly string[] = []): string {
  const abs = path.resolve(duong);
  for (const t of cacThuMucCam) {
    const rel = path.relative(path.resolve(t), abs);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error("--tep-url-csdl: tệp nằm trong repo / worktree — đặt ngoài repo");
  }
  if (!fs.existsSync(abs)) throw new Error("--tep-url-csdl: không có tệp");
  const dong = fs.readFileSync(abs, "utf8").split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== "");
  if (dong.length === 0) throw new Error("--tep-url-csdl: tệp rỗng");
  if (dong.length > 1) throw new Error("--tep-url-csdl: tệp phải có đúng MỘT dòng");
  return dong[0];
}

/** Tham số DB của dòng lệnh: cờ `--cho-phep-db` và URL CSDL đọc từ `--tep-url-csdl <tệp>` (không còn lấy DATABASE_URL của tiến trình). `docTep` được tiêm để test không đọc tệp thật. Thuần. */
export function thamSoDbTuDongLenh(a: Record<string, string>, docTep: (duong: string) => string): { choPhepDb: boolean; testDbUrl: string | undefined; loi?: string } {
  if (a["cho-phep-db"] === undefined) return { choPhepDb: false, testDbUrl: undefined };
  const duong = a["tep-url-csdl"];
  if (duong === undefined || duong === "1" || duong === "") return { choPhepDb: true, testDbUrl: undefined, loi: "--cho-phep-db cần --tep-url-csdl <tệp chứa URL CSDL của vai tho_ca_test>" };
  try {
    return { choPhepDb: true, testDbUrl: docTep(duong) };
  } catch (e) {
    return { choPhepDb: true, testDbUrl: undefined, loi: e instanceof Error ? e.message : "--tep-url-csdl: không đọc được tệp" };
  }
}

/**
 * Các gốc sandbox của lượt (AI_REPO_SANDBOX_ROOTS: `ten=duong|duong;ten2=duong2`) — công cụ đọc của model chỉ thấy tệp nằm TRONG các gốc này.
 * Lấy phần đường cuối của mỗi mục (cùng cách `kiemMoiTruong` ở driverHost đọc). Thuần.
 */
export function gocSandboxTuEnv(env: NodeJS.ProcessEnv): string[] {
  return (env.AI_REPO_SANDBOX_ROOTS ?? "")
    .split(";")
    .map((m) => {
      const i = m.indexOf("=");
      return i < 0 ? "" : (m.slice(i + 1).split("|").pop() ?? "").trim();
    })
    .filter((x) => x !== "")
    .map((x) => path.resolve(x));
}

const CHUOI_RA_TRONG_SANDBOX = "--cho-phep-db: thư mục kết quả (--ra) nằm trong gốc sandbox / worktree — đặt ngoài để model không đọc được đầu ra đầy đủ của lệnh kiểm";
/**
 * `--cho-phep-db`: tệp `<ra>/<mã>.kiem-*.txt` chứa đầu ra ĐẦY ĐỦ nên `<ra>` KHÔNG được nằm trong bất kỳ gốc sandbox nào của lượt hay trong worktree
 * (công cụ read_file / list_dir / grep của model sẽ đọc được). Trả chuỗi cố định nếu vi phạm, ngược lại null. Thuần.
 */
export function raTrongGocSandbox(ra: string, wt: string, env: NodeJS.ProcessEnv): string | null {
  const chuan = (x: string) => path.resolve(x).toLowerCase();
  const raC = chuan(ra);
  for (const goc of [...gocSandboxTuEnv(env), path.resolve(wt)]) {
    const rel = path.relative(chuan(goc), raC);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return CHUOI_RA_TRONG_SANDBOX;
  }
  return null;
}

/** `aoi_management_test` phải là MỘT token nguyên trong dòng CSDL (ranh giới từ: chữ, số, gạch dưới) — `aoi_management_test_x` không tính. */
const RE_TEN_DB_TEST = /(^|[^A-Za-z0-9_])aoi_management_test($|[^A-Za-z0-9_])/;
/** Máy chủ và cổng CSDL được phép cho `--cho-phep-db`; vai CHỈ `tho_ca_test` (vai riêng chỉ CONNECT aoi_management_test; KHÔNG avi_app vì chung mật khẩu với DEV). */
const MAY_CHU_DUOC_PHEP: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);
const CONG_DUOC_PHEP = "5434";
const VAI_DUOC_PHEP = "tho_ca_test";

/** Lý do TỪ CHỐI `--cho-phep-db` (null = đủ điều kiện). Thuần. */
export function kiemChoPhepDb(the: Pick<TheViec, "csdl">, testDbUrl: string | undefined): string | null {
  if (!the.csdl || !RE_TEN_DB_TEST.test(the.csdl)) return "--cho-phep-db: thẻ không có dòng CSDL: nêu aoi_management_test";
  if (!testDbUrl) return "--cho-phep-db: thiếu URL CSDL của tiến trình (DATABASE_URL)";
  let u: URL;
  try {
    u = new URL(testDbUrl);
  } catch {
    return "--cho-phep-db: URL CSDL không hợp lệ";
  }
  if (decodeURIComponent(u.pathname.replace(/^\//, "")) !== "aoi_management_test") return "--cho-phep-db: URL CSDL không trỏ aoi_management_test";
  if (!MAY_CHU_DUOC_PHEP.has(u.hostname.toLowerCase())) return "--cho-phep-db: máy chủ CSDL không thuộc 127.0.0.1 / localhost / ::1";
  if (u.port !== CONG_DUOC_PHEP) return "--cho-phep-db: cổng CSDL không phải 5434";
  if (decodeURIComponent(u.username) !== VAI_DUOC_PHEP) return "--cho-phep-db: URL CSDL không dùng vai tho_ca_test (vai riêng chỉ cho _test; không avi_app, không owner aoi)";
  return null;
}

export interface BoChay {
  commit: string | null;
  /** false khi `scripts/tho-ca-pilot` hoặc `docs/tho-ca-pilot` có thay đổi chưa commit (kể cả tệp luật chép tạm); null khi không đọc được git */
  sach: boolean | null;
  tepLech?: string[];
}

export const sha256Hex = (van: string): string => createHash("sha256").update(van, "utf8").digest("hex");

/** Commit HEAD của repo chứa bộ chạy + có tệp lệch (chỉ xét thư mục bộ chạy và luật; tệp khác của cây dev không ảnh hưởng số đo). */
export function commitBoChay(goc: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")): BoChay {
  const h = git(["rev-parse", "HEAD"], goc);
  if (!h.ok) return { commit: null, sach: null };
  const st = git(["status", "--porcelain=v1", "--untracked-files=all", "--", "scripts/tho-ca-pilot", "docs/tho-ca-pilot"], goc);
  if (!st.ok) return { commit: h.out.trim(), sach: null };
  const lech = st.out.split(/\r?\n/).filter((x) => x !== "").map((x) => x.slice(3));
  return { commit: h.out.trim(), sach: lech.length === 0, ...(lech.length > 0 ? { tepLech: lech } : {}) };
}

/** `--luat <tệp>`: đọc tệp luật (UTF-8). Tệp vắng/rỗng ⇒ ném lỗi (không lùi lặng lẽ về luật mặc định: số đo sẽ nói sai luật). */
export function docLuatTuTep(duong: string): { luat: string; nguon: string } {
  const abs = path.resolve(duong);
  if (!fs.existsSync(abs)) throw new Error(`--luat: không có tệp ${abs}`);
  const luat = fs.readFileSync(abs, "utf8");
  if (luat.trim() === "") throw new Error(`--luat: tệp rỗng ${abs}`);
  return { luat, nguon: abs };
}

/**
 * `--luat-cach`: cách đưa luật cho model. `ghi-de` (mặc định, hành vi cũ): ghi `--luat` đè AGENTS.md của worktree (ẩn khỏi git) VÀ ghép vào lệnh.
 * `ghep`: bộ chạy KHÔNG chạm tệp nào ở worktree — model đọc AGENTS.md của BASE (B1) qua docTepQuyUoc; tệp `--luat` (mặc định docs/tho-ca-pilot/bo-sung-pilot.md)
 * chỉ ghép vào LỆNH như phần bổ sung riêng cho pilot.
 */
export type LuatCach = "ghi-de" | "ghep";
/** Vắng ⇒ "ghi-de"; giá trị lạ ⇒ null (dòng lệnh thoát 2). */
export function docLuatCach(tho: string | undefined): LuatCach | null {
  if (tho === undefined) return "ghi-de";
  return tho === "ghi-de" || tho === "ghep" ? tho : null;
}

/** Phần bổ sung riêng cho pilot khi `--luat-cach ghep` (nguồn sự thật trong repo). */
export function duongTepLuatBoSung(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/tho-ca-pilot/bo-sung-pilot.md");
}

/** Luật dự án nguồn sự thật (cạnh bộ chạy trong repo). */
export function duongTepLuat(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/tho-ca-pilot/luat-du-an.md");
}

export function ghepLenh(the: TheViec, luat: string, tran?: TranLuotKetQua | null): string {
  return [
    luat.trim(),
    "",
    "=== THẺ VIỆC ===",
    `MÃ: ${the.ma}`,
    // QUY TRÌNH ngay sau MÃ (L1, TC-05: ở cuối thẻ model bỏ qua — in danh sách rồi vẫn gọi write_file)
    the.quyTrinh ? `QUY TRÌNH: ${the.quyTrinh}` : "",
    `MỤC TIÊU: ${the.mucTieu}`,
    `TỆP ĐƯỢC PHÉP SỬA/TẠO: ${the.tepDuocPhep.join(", ")}`,
    the.nguCanhDoc.length ? `NGỮ CẢNH ĐỌC: ${the.nguCanhDoc.join(", ")}` : "",
    `LỆNH KIỂM: ${the.lenhKiem}`,
    the.lenhKiemGhiChu ? `GHI CHÚ LỆNH KIỂM: ${the.lenhKiemGhiChu}` : "",
    // HA-3: có khoá TRẦN ⇒ báo trần thật và bỏ chữ "N vòng" tự do (chữ đó không được bộ chạy áp, dễ mâu thuẫn với trần thật)
    tran?.apDungTuThe ? `GIỚI HẠN: ${Math.round(the.gioiHan.giay / 60)} phút` : `GIỚI HẠN: ${Math.round(the.gioiHan.giay / 60)} phút, ${the.gioiHan.vong} vòng`,
    ...(tran ? dongBaoTran(tran) : []),
  ]
    .filter((x) => x !== "")
    .join("\n");
}

// ── Drivers ──────────────────────────────────────────────────────────────────────────────────────

export const driverKho: Driver = async (v) => {
  const ghiChu: string[] = [];
  for (const [rel, noiDung] of Object.entries(v.khoGhi)) {
    const dich = path.resolve(v.wt, rel);
    if (!dich.startsWith(path.resolve(v.wt) + path.sep)) {
      ghiChu.push(`kho: bỏ qua đường ra ngoài worktree: ${rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dich), { recursive: true });
    fs.writeFileSync(dich, noiDung, "utf8");
    ghiChu.push(`kho: ghi ${rel}`);
  }
  return { vong: Object.keys(v.khoGhi).length > 0 ? 1 : 0, token: null, ghiChu, hetGio: false };
};

export const driverCli: Driver = (v) =>
  new Promise((xong) => {
    const env: NodeJS.ProcessEnv = { ...process.env, AI_REPO_SANDBOX_ROOTS: v.wt };
    if (v.ghiLuotDir) env.AI_GHI_LUOT_DIR = v.ghiLuotDir;
    const con = spawn("npx", ["tsx", "server/services/aiCodingCli/batDau.ts", "--du-an", path.basename(v.wt), "--lenh", v.lenh], {
      cwd: v.wt,
      env,
      stdio: "inherit",
      shell: true,
    });
    let hetGio = false;
    const dong = setTimeout(() => {
      hetGio = true;
      spawnSync("taskkill", ["/PID", String(con.pid), "/T", "/F"], { stdio: "ignore" });
    }, v.hanGiay * 1000);
    con.on("exit", (ma) =>
      xong({
        vong: null,
        token: null,
        ghiChu: [`cli: thoát mã ${ma}`],
        hetGio,
        ...(ma !== 0 && !hetGio ? { loi: `cli thoát mã ${ma}` } : {}),
      }),
    );
    con.on("error", (e) => xong({ vong: null, token: null, ghiChu: [], hetGio: false, loi: String(e) }));
    void dong;
  });

const DRIVERS: Record<Exclude<TenDriver, "host">, Driver> = { kho: driverKho, cli: driverCli };

// ── Thu diff ─────────────────────────────────────────────────────────────────────────────────────

const TEP_LUAT = "AGENTS.md";

/**
 * AGENTS.md của worktree KHỚP base? Base không có ⇒ worktree cũng không được có (tệp chưa theo dõi có thể bị `.git/info/exclude` của runtime nuốt khỏi `git status`,
 * nên kiểm bằng đĩa, không bằng status). Base có ⇒ worktree phải có và `git diff --quiet <base> -- AGENTS.md` (xử lý cả chuẩn hoá cuối dòng).
 */
export function khopB1(wt: string, baseSha: string): boolean {
  const baseCo = git(["cat-file", "-e", `${baseSha}:${TEP_LUAT}`], wt).ok;
  const coTrenDia = fs.existsSync(path.join(wt, TEP_LUAT));
  if (!baseCo) return !coTrenDia;
  if (!coTrenDia) return false;
  return git(["diff", "--quiet", baseSha, "--", TEP_LUAT], wt).ok;
}

/** Nội dung B1 của base (chuỗi UTF-8) hoặc null nếu base không có AGENTS.md. */
function noiDungB1(wt: string, baseSha: string): string | null {
  const r = git(["show", `${baseSha}:${TEP_LUAT}`], wt);
  return r.ok ? r.out : null;
}

function thuTepDoi(wt: string, boQuaAgentsMd = true): string[] {
  const r = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], wt);
  const ra: string[] = [];
  const mucs = r.out.split("\0").filter((x) => x !== "");
  for (let i = 0; i < mucs.length; i++) {
    const m = mucs[i];
    const ma = m.slice(0, 2);
    const duong = m.slice(3);
    if (ma[0] === "R" || ma[0] === "C") i++; // mục kế tiếp là tên cũ
    if (!boQuaAgentsMd || duong !== TEP_LUAT) ra.push(duong);
  }
  return ra.sort();
}

function demDong(wt: string, tep: string[]): { them: number; xoa: number } {
  let them = 0;
  let xoa = 0;
  const r = git(["diff", "--numstat", "HEAD", "--", ...tep], wt);
  for (const dong of r.out.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(dong);
    if (m) {
      them += m[1] === "-" ? 0 : Number(m[1]);
      xoa += m[2] === "-" ? 0 : Number(m[2]);
    }
  }
  return { them, xoa };
}

function tepCrlf(wt: string, tep: string[]): string[] {
  const ra: string[] = [];
  for (const t of tep) {
    try {
      const b = fs.readFileSync(path.join(wt, t));
      if (b.includes(Buffer.from("\r\n"))) ra.push(t);
    } catch {
      /* tệp bị xoá */
    }
  }
  return ra;
}

// ── Chạy một việc ─────────────────────────────────────────────────────────────────────────────────

export interface ThamSoViec {
  van: string;
  wt: string;
  base: string;
  driver: TenDriver | Driver;
  ra: string;
  ghiLuotDir?: string | null;
  khoGhi?: Record<string, string>;
  /** nhãn ghi vào JSON khi `driver` là hàm (vd "host") */
  tenDriver?: TenDriver;
  /** CHỈ cho ca kiểm: cho phép worktree không phải worktree LIÊN KẾT (kho tạm). Không có cờ CLI tương ứng. */
  choPhepKhoRieng?: boolean;
  luat?: string;
  /** `--luat-cach` (mặc định "ghi-de" = hành vi cũ) */
  luatCach?: LuatCach;
  /** nguồn của `luat` để ghi vào JSON (đường tệp); vắng ⇒ "tham-so" khi `luat` được truyền, ngược lại đường luat-du-an.md mặc định */
  luatNguon?: string;
  /**
   * `--cho-phep-db` (mặc định TẮT): bỏ qua ĐÚNG MỘT kiểm — "LỆNH KIỂM trỏ vào tệp test chạm DB". Kiểm cùng họ sau lượt (tệp test do model viết chạm DB) cũng được miễn, CHỈ cho tệp có trong LỆNH KIỂM. Mọi kiểm khác (vùng cấm, TỆP ĐƯỢC PHÉP, L3b…) giữ nguyên.
   * Điều kiện (kiemChoPhepDb): thẻ có dòng `CSDL:` nêu aoi_management_test, và `testDbUrl` trỏ đúng CSDL aoi_management_test bằng vai KHÔNG phải owner `aoi`.
   * Có cờ ⇒ tiến trình con chạy lệnh kiểm nhận TEST_DATABASE_URL = testDbUrl (DATABASE_URL vẫn là cổng chết).
   */
  choPhepDb?: boolean;
  /** chỉ cho ca kiểm: thay `process.env` khi đọc AI_AGENT_SO_LUOT_TOI_DA (trần lượt) */
  envTran?: NodeJS.ProcessEnv;
  /** chỉ cho ca kiểm: thay `process.env` khi đọc AI_REPO_SANDBOX_ROOTS để kiểm `--ra` nằm ngoài gốc sandbox */
  envSandbox?: NodeJS.ProcessEnv;
  /** URL CSDL của tiến trình pilot (dòng lệnh truyền process.env.DATABASE_URL); chỉ dùng khi choPhepDb */
  testDbUrl?: string;
  /** chỉ cho ca kiểm: thay nhà máy dựng hàm chạy lệnh kiểm để quan sát tham số (mặc định taoChayLenhKiem) */
  taoChayKiem?: typeof taoChayLenhKiem;
  /** commit bộ chạy (dòng lệnh tính bằng `commitBoChay`); vắng ⇒ không ghi */
  boChay?: BoChay;
  nhatKy?: (s: string) => void;
  /** L3a: hàm chạy lệnh kiểm (mặc định chạy thật; ca kiểm đơn vị tiêm bản giả) */
  chayKiem?: ChayKiem;
  /** L3a: hạn giờ RIÊNG của lệnh kiểm, giây (mặc định 300) */
  hanKiemGiay?: number;
  /** L3c: hàm chạy tsc (mặc định chạy thật) và hạn giờ riêng, giây (mặc định 900) */
  chayTsc?: ChayTsc;
  hanTscGiay?: number;
  /** cờ AI_AGENT_* THỰC SỰ có trong env tiến trình lúc chạy (ghi vào JSON để số đo nói rõ chạy với cờ nào) */
  coAiAgent?: Record<string, string>;
}

export async function chayMotViec(p: ThamSoViec): Promise<KetQuaViec> {
  const nhatKy = p.nhatKy ?? (() => undefined);
  const tuChoi = (loi: string, ma: string | null = null): KetQuaViec => ({ ma, ok: false, ketCuc: "tu-choi", loi });
  const tenDriver: TenDriver = typeof p.driver === "string" ? p.driver : p.tenDriver ?? "kho";

  const dt = docTheViec(p.van);
  if (!dt.ok) return tuChoi(dt.loi);
  const the = dt.the;
  if (!RE_NHANH_MA.test(the.ma)) return tuChoi("mã thẻ không dùng được làm tên nhánh", the.ma);

  const dbCho = p.choPhepDb === true;
  // HA-3: trần lượt theo khoá thẻ TƯỜNG MINH (thẻ không có khoá ⇒ tran = null ⇒ không đổi gì)
  const tran = the.tran ? tinhTranLuot(the.tran, p.envTran ?? process.env) : null;
  const gioiHanLuot: GioiHanLuotChoDriver | undefined = tran ? gioiHanChoLuot(tran) : undefined;
  if (dbCho) {
    const lyDoDb = kiemChoPhepDb(the, p.testDbUrl);
    if (lyDoDb) return tuChoi(lyDoDb, the.ma);
  }
  const chayKiemDung: ChayKiem = p.chayKiem ?? (p.taoChayKiem ?? taoChayLenhKiem)(dbCho ? { testDbUrl: p.testDbUrl } : {});

  const wt = path.resolve(p.wt);
  if (!/^_tho_ca/i.test(path.basename(wt)) && !p.choPhepKhoRieng) return tuChoi(`worktree "${wt}" không phải thư mục _tho_ca* — từ chối để không sửa nhầm nơi khác`, the.ma);
  if (!fs.existsSync(wt)) return tuChoi(`worktree không tồn tại: ${wt}`, the.ma);
  if (dbCho) {
    const lyDoRa = raTrongGocSandbox(p.ra, wt, p.envSandbox ?? process.env);
    if (lyDoRa) return tuChoi(lyDoRa, the.ma);
  }
  const top = git(["rev-parse", "--show-toplevel"], wt);
  if (!top.ok || path.resolve(top.out.trim()) !== wt) return tuChoi("đường không phải gốc một worktree git", the.ma);
  const gitDir = git(["rev-parse", "--git-dir"], wt).out.trim();
  const chung = git(["rev-parse", "--git-common-dir"], wt).out.trim();
  const laLienKet = path.resolve(wt, gitDir) !== path.resolve(wt, chung);
  if (!laLienKet && !p.choPhepKhoRieng) return tuChoi("đây là worktree CHÍNH, không phải worktree liên kết — từ chối", the.ma);
  const cach: LuatCach = p.luatCach ?? "ghi-de";
  const trangThaiBan = () => git(["status", "--porcelain=v1", "--untracked-files=all"], wt).out.split("\n").filter((x) => x !== "" && (cach === "ghep" || !x.endsWith(` ${TEP_LUAT}`)));
  let ban = trangThaiBan();
  const luuY0: string[] = [];
  if (ban.length > 0) {
    // CẤT kết quả lượt trước: chỉ khi đang đứng trên nhánh pilot/tho-ca-* (commit vào CHÍNH nhánh đó, không bao giờ main hay nhánh khác); mọi trường hợp khác ⇒ từ chối như cũ.
    const nhanhHienTai = git(["branch", "--show-current"], wt).out.trim();
    if (!NHANH_PILOT.test(nhanhHienTai)) return tuChoi(`worktree không sạch (${ban.length} mục) và không đứng trên nhánh pilot/tho-ca-* — dọn tay trước khi nhận việc`, the.ma);
    // ★ PATHSPEC ở CẢ add LẪN commit (hook BG-124 dùng chung chặn commit trần: nó cuốn toàn index). Danh sách = đúng các tệp lượt trước đã đổi.
    const tepCat = thuTepDoi(wt, cach === "ghi-de");
    const them = git(["add", "--", ...tepCat], wt);
    const loiNhan = ["pilot: cất kết quả lượt trước (không lên main)", "", "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"].join("\n");
    const cm = them.ok ? git(["-c", "user.name=tho-ca-pilot", "-c", "user.email=tho-ca-pilot@localhost", "commit", "-q", "-m", loiNhan, "--", ...tepCat], wt) : them;
    if (!cm.ok) return tuChoi(`không cất được kết quả lượt trước trên ${nhanhHienTai}: ${cm.err.trim()}`, the.ma);
    luuY0.push(`đã cất kết quả lượt trước vào nhánh ${nhanhHienTai} (${ban.length} mục)`);
    ban = trangThaiBan();
    if (ban.length > 0) return tuChoi(`worktree vẫn không sạch sau khi cất (${ban.length} mục)`, the.ma);
  }

  // LỆNH KIỂM trỏ vào tệp test ĐÃ CÓ mà chạm DB ⇒ từ chối (luật: quét import/nội dung, không chỉ tên .db.test). Tệp chưa có (Thợ Cả sẽ tạo) kiểm sau khi chạy.
  for (const t of tepTestTrongLenh(the.lenhKiem)) {
    const f = path.join(wt, t);
    if (fs.existsSync(f)) {
      const dau = quetChamDb(t, fs.readFileSync(f, "utf8"));
      if (dau.length > 0 && !dbCho) return tuChoi(`LỆNH KIỂM trỏ vào tệp chạm DB (${t}: ${dau.join(", ")}) — pilot không chạy test DB`, the.ma);
    } else if (quetChamDb(t, "").length > 0 && !dbCho) {
      return tuChoi(`LỆNH KIỂM trỏ vào tệp .db.test (${t}) — pilot không chạy test DB`, the.ma);
    }
  }
  const base = git(["rev-parse", "--verify", `${p.base}^{commit}`], wt);
  if (!base.ok) return tuChoi(`không có base "${p.base}"`, the.ma);
  const baseSha = base.out.trim();
  const nhanh = `pilot/tho-ca-${the.ma}`;
  const cb = git(["checkout", "-q", "-B", nhanh, baseSha], wt);
  if (!cb.ok) return tuChoi(`không tạo được nhánh ${nhanh}: ${cb.err.trim()}`, the.ma);
  // L3b: đột biến của thẻ phải áp dụng được TRÊN BASE (đúng một chỗ khớp) — lỗi thẻ thì từ chối TRƯỚC khi tốn lượt model
  if (the.dotBien?.length) {
    const loiDb = kiemDotBienTrenBase(wt, the.dotBien);
    if (loiDb.length > 0) return tuChoi(`thẻ lỗi — ${loiDb.join("; ")}`, the.ma);
  }

  // luật dự án. `ghi-de` (mặc định): → AGENTS.md ở gốc worktree, ẩn khỏi git (info/exclude) để không lẫn vào diff, VÀ ghép vào lệnh.
  // `ghep`: KHÔNG chạm tệp nào ở worktree; `luat` ở đây là phần bổ sung riêng cho pilot (chỉ ghép vào lệnh), model tự đọc AGENTS.md của base (B1).
  const tepLuatMacDinh = cach === "ghep" ? duongTepLuatBoSung() : duongTepLuat();
  const luat = p.luat ?? fs.readFileSync(tepLuatMacDinh, "utf8");
  const luatNguon = p.luatNguon ?? (p.luat !== undefined ? "tham-so" : tepLuatMacDinh);
  if (cach === "ghep") {
    // worktree phải KHỚP base về AGENTS.md trước lượt (kể cả tệp chưa theo dõi bị .git/info/exclude nuốt khỏi `git status`): nếu lệch, model sẽ đọc luật không phải B1 của base
    if (!khopB1(wt, baseSha)) return tuChoi("--luat-cach ghep: AGENTS.md ở worktree KHÁC AGENTS.md của base (tệp lạ / đã sửa / còn bản ghi-đè của lượt cũ) — dọn trước khi nhận việc", the.ma);
  } else {
    fs.writeFileSync(path.join(wt, TEP_LUAT), luat, "utf8");
    const ex = git(["rev-parse", "--git-path", "info/exclude"], wt).out.trim();
    const exPath = path.resolve(wt, ex);
    try {
      fs.mkdirSync(path.dirname(exPath), { recursive: true });
      const cu = fs.existsSync(exPath) ? fs.readFileSync(exPath, "utf8") : "";
      if (!cu.split("\n").includes(TEP_LUAT)) fs.appendFileSync(exPath, `${cu.endsWith("\n") || cu === "" ? "" : "\n"}${TEP_LUAT}\n`);
    } catch {
      /* nếu không ghi được exclude, thuTepDoi vẫn bỏ AGENTS.md ra khỏi danh sách */
    }
  }

  if (p.driver === "host") return tuChoi("driver host phải được dựng ở dòng lệnh (phuThuocHostThat) rồi truyền vào dạng hàm", the.ma);
  const driver = typeof p.driver === "string" ? DRIVERS[p.driver] : p.driver;
  const t0 = Date.now();
  nhatKy(`bắt đầu ${the.ma} trên ${nhanh} @ ${baseSha.slice(0, 9)} (driver ${tenDriver}, hạn ${the.gioiHan.giay}s)`);
  // L3b: model/driver KHÔNG được thấy đột biến hay chuỗi cấm — gỡ khỏi `the` đưa cho driver (ghepLenh cũng không in chúng)
  const { dotBien: _dotBien, khangDinhCam: _khangDinhCam, csdl: _csdl, ...theChoDriver } = the;
  const kq = await driver({ the: theChoDriver, wt, lenh: ghepLenh(the, luat, tran), hanGiay: tran?.phutThucDung ? tran.phutThucDung * 60 : the.gioiHan.giay, ...(gioiHanLuot ? { gioiHanLuot } : {}), ra: p.ra, ghiLuotDir: p.ghiLuotDir ?? null, khoGhi: p.khoGhi ?? {}, ...(p.chayKiem || dbCho ? { chayKiem: chayKiemDung } : {}), ...(dbCho ? { cheDoKiem: "chi-so" as const, giaTriBiMat: giaTriBiMatTuUrl(p.testDbUrl) } : {}) });
  const giayTuong = Math.round(((Date.now() - t0) / 1000) * 10) / 10;
  for (const g of kq.ghiChu) nhatKy(g);

  // thu diff: đánh dấu tệp mới là "ý định thêm" để `git diff` thấy; chỉ chạm index của worktree pilot, không commit
  const tepDoi = thuTepDoi(wt, cach === "ghi-de");
  if (tepDoi.length > 0) git(["add", "-N", "--", ...tepDoi], wt);
  const dong = tepDoi.length ? demDong(wt, tepDoi) : { them: 0, xoa: 0 };
  const diffText = tepDoi.length ? git(["diff", "HEAD", "--", ...tepDoi], wt).out : "";
  fs.mkdirSync(p.ra, { recursive: true });
  const diffPath = path.join(p.ra, `${the.ma}.diff`);
  fs.writeFileSync(diffPath, diffText, "utf8");

  const viPham = kiemDiffTheoThe(tepDoi, the.tepDuocPhep);
  // tệp test do Thợ Cả viết/sửa mà chạm DB ⇒ vi phạm (dieu-phoi KHÔNG được chạy nó).
  // `--cho-phep-db`: miễn ĐÚNG các tệp test có trong LỆNH KIỂM (chính tệp thẻ cho phép chạy trên _test); tệp test khác chạm DB vẫn vi phạm.
  const tepTestDuocCho = new Set(dbCho ? tepTestTrongLenh(the.lenhKiem).map(chuanDuong).filter((x): x is string => x !== null) : []);
  for (const t of tepDoi) {
    if (!/\.test\.[cm]?[jt]sx?$/.test(t)) continue;
    try {
      const dau = quetChamDb(t, fs.readFileSync(path.join(wt, t), "utf8"));
      if (dau.length > 0 && !tepTestDuocCho.has(t)) viPham.push({ duong: t, loai: "cham-db", chiTiet: dau.join(", ") });
    } catch {
      /* tệp bị xoá */
    }
  }
  // L3b: KHÔNG ĐƯỢC KHẲNG ĐỊNH (vi phạm) + nhãn nghi ghim lỗi (chỉ cảnh báo)
  const ghimNghiNgo: Array<{ duong: string; dong: number; trich: string }> = [];
  for (const t of tepTestDoi(tepDoi)) {
    let nguon: string;
    try {
      nguon = fs.readFileSync(path.join(wt, t), "utf8");
    } catch {
      continue;
    }
    for (const h of quetKhangDinhCam(nguon, the.khangDinhCam ?? [])) viPham.push({ duong: t, loai: "khang-dinh-cam", chiTiet: `dòng ${h.dong}: ${h.cam} — ${h.trich}` });
    for (const g of quetGhimNghiNgo(nguon)) ghimNghiNgo.push({ duong: t, ...g });
  }
  const crlf = tepCrlf(wt, tepDoi);
  const luuY: string[] = [...luuY0, ...(kq.luuY ?? [])];
  if (p.coAiAgent?.AI_AGENT_CONG_KE_HOACH === "1") {
    luuY.push("cổng duyệt kế hoạch 11.3-C BẬT chỉ trong env tiến trình pilot này (lượt đo thử). kiem-dinh CHƯA rà ĐẠT 11.3-C (dieu-phoi 2026-11-08) ⇒ mặc định của cờ trong ứng dụng KHÔNG đổi.");
  }
  if (kq.token === null) luuY.push("token xử lý: driver không có nguồn đo (CLI không qua goiModelMayChu); do-model đo ở llama-server nếu cần");
  if (kq.vong === null) luuY.push("số vòng: driver không biết");

  // KHÔNG BAO GIỜ "xong" khi không làm gì: lượt lỗi ⇒ loi-driver; không đổi tệp nào và không lỗi ⇒ khong-lam (ok:false)
  let ketCuc: KetQuaViec["ketCuc"] = "xong";
  if (kq.hetGio) ketCuc = "het-gio";
  else if (kq.loi) ketCuc = "loi-driver";
  else if (tepDoi.length === 0) ketCuc = "khong-lam";
  if (viPham.length > 0 || crlf.length > 0) ketCuc = "vi-pham";

  // ── L3a: bộ chạy TỰ chạy LỆNH KIỂM và ĐỌC kết quả (chỉ khi còn đáng chạy: ứng viên "xong") ──
  const tepTest = demTepTest(wt, tepDoi);
  let kiem: KetQuaKiem | null = null;
  let tsc: KetQuaTsc | null = null;
  let dotBien: KetQuaDotBien | null = null;
  let lyDoKiem: string | null = null;
  const khongTepRong = !tepTest.some((t) => t.soCa === 0);
  if (ketCuc === "xong") {
    if (khongTepRong) {
      nhatKy(`chạy LỆNH KIỂM: ${the.lenhKiem}`);
      kiem = await chayKiemDung(the.lenhKiem, wt, p.hanKiemGiay ?? 300);
    }
    let qd = quyetKetCuc({ truoc: ketCuc, dungVitest: laLenhVitest(the.lenhKiem), tepTest, kiem });
    // L3c: lệnh kiểm xanh vẫn chưa đủ — tsc trên tệp model đổi (vitest không kiểm kiểu; TC-05 tự định nghĩa lại kiểu đã export)
    if (qd.ketCuc === "xong" && canChayTsc(wt, tepDoi)) {
      nhatKy("chạy tsc --noEmit -p tsconfig.tests.json (L3c)");
      tsc = await (p.chayTsc ?? chayLenhTsc)(wt, tepDoi, p.hanTscGiay ?? 900);
      qd = quyetKetCuc({ truoc: ketCuc, dungVitest: laLenhVitest(the.lenhKiem), tepTest, kiem, tsc });
    }
    // L3b: đột biến của thẻ — chỉ khi mọi bước trước đều xanh (đột biến trên bài làm đã đỏ là vô nghĩa)
    if (qd.ketCuc === "xong" && the.dotBien?.length) {
      nhatKy(`áp ${the.dotBien.length} đột biến của thẻ (L3b)`);
      dotBien = await apDungDotBien(wt, the.dotBien, tepDoi, the.lenhKiem, chayKiemDung, p.hanKiemGiay ?? 300);
      qd = quyetKetCuc({ truoc: ketCuc, dungVitest: laLenhVitest(the.lenhKiem), tepTest, kiem, tsc, dotBien });
    }
    ketCuc = qd.ketCuc as KetQuaViec["ketCuc"];
    lyDoKiem = qd.lyDo;
  } else if ((ketCuc === "loi-driver" || ketCuc === "het-gio") && tepTest.some((t) => t.soCa > 0) && khongTepRong) {
    // Lượt dừng giữa chừng nhưng ĐÃ có tệp test: vẫn chạy lệnh kiểm để KHÔNG MẤT số đo. ketCuc giữ nguyên (sticky) — chỉ ghi `kiem`.
    nhatKy(`lượt ${ketCuc} nhưng có tệp test — vẫn chạy LỆNH KIỂM để ghi số đo: ${the.lenhKiem}`);
    kiem = await chayKiemDung(the.lenhKiem, wt, p.hanKiemGiay ?? 300);
    // HA-3: tsc cũng LUÔN chạy trên cây cuối khi có tệp test (trước đây bị bỏ qua khi lượt không xong ⇒ mất số đo kiểu)
    if (canChayTsc(wt, tepDoi)) {
      nhatKy(`lượt ${ketCuc} — vẫn chạy tsc --noEmit -p tsconfig.tests.json để ghi số đo`);
      tsc = await (p.chayTsc ?? chayLenhTsc)(wt, tepDoi, p.hanTscGiay ?? 900);
    }
    lyDoKiem = `ketCuc ${ketCuc} giữ nguyên; lệnh kiểm chạy bổ sung: exit ${kiem.exit}${kiem.vitest.ca ? `, Tests ${kiem.vitest.ca.dat} passed / ${kiem.vitest.ca.tong}` : ""}${tsc ? `; tsc exit ${tsc.exit}, ${tsc.tongLoi} lỗi` : ""}`;
  }

  // `--cho-phep-db`: đầu ra ĐẦY ĐỦ của lần chạy lệnh kiểm cuối (đã lọc URL + bí mật) ra TỆP cho người duyệt; không vào JSON, không vào lời nhắc model
  if (dbCho && kiem?.dauRaDayDu !== undefined) {
    try {
      fs.writeFileSync(path.join(p.ra, `${the.ma}.kiem-cuoi.txt`), kiem.dauRaDayDu, "utf8");
    } catch {
      /* tệp phụ */
    }
  }
  return {
    ma: the.ma,
    ok: ketCuc === "xong",
    ketCuc,
    ...(kq.loi ? { loi: kq.loi } : {}),
    nhanh,
    baseSha,
    driver: tenDriver,
    giayTuong,
    giayKhongChoNguoi: Math.round((giayTuong - (kq.duyet?.giayChoDuyet ?? 0)) * 10) / 10,
    ...(kq.duyet ? { soLanCho: kq.duyet.soLanCho, soChapNhan: kq.duyet.soChapNhan, soTuChoi: kq.duyet.soTuChoi, giayChoDuyet: kq.duyet.giayChoDuyet } : {}),
    ...(kq.lyDoDung ? { lyDoDung: kq.lyDoDung } : {}),
    ...(kq.keHoach ? { keHoach: kq.keHoach } : {}),
    ...(kq.loiCongCu ? { loiCongCu: kq.loiCongCu } : {}),
    vong: kq.vong,
    token: kq.token,
    tepDoi,
    dong,
    viPham,
    crlf,
    diff: diffPath,
    lenhKiem: the.lenhKiem,
    ...(kiem ? { kiem: (({ lenh: _l, dauRaDayDu: _d, ...r }) => r)(kiem) } : {}),
    ...(p.coAiAgent ? { coAiAgent: p.coAiAgent } : {}),
    ...(tran ? { tran } : {}),
    ...(dbCho ? { choPhepDb: true as const, vaiCsdl: VAI_DUOC_PHEP } : {}),
    luat: { sha256: sha256Hex(luat), nguon: luatNguon, byte: Buffer.byteLength(luat, "utf8") },
    luatCach: cach,
    ...(cach === "ghep"
      ? (() => {
          const b1 = noiDungB1(wt, baseSha);
          return { b1: { nguon: `${TEP_LUAT}@${baseSha.slice(0, 12)}`, sha256: b1 === null ? null : sha256Hex(b1), byte: b1 === null ? 0 : Buffer.byteLength(b1, "utf8"), saoLuotKhop: khopB1(wt, baseSha) } };
        })()
      : {}),
    ...(p.boChay ? { boChay: p.boChay } : {}),
    ...(tsc ? { tsc } : {}),
    ...(dotBien ? { dotBien } : {}),
    ...(ghimNghiNgo.length > 0 ? { ghimNghiNgo } : {}),
    ...(tepTest.length > 0 ? { tepTest } : {}),
    luuY: lyDoKiem ? [...luuY, `L3a: ${lyDoKiem}`] : luuY,
  };
}

// ── Dòng lệnh ────────────────────────────────────────────────────────────────────────────────────

function docThamSo(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  }
  return o;
}

async function main(): Promise<number> {
  const a = docThamSo(process.argv.slice(2));
  if (!a.the) {
    process.stderr.write("dùng: chayMotViec.ts --the <tep-the> [--wt D:\\SOURCES\\_tho_ca_wt] [--base main] [--luat <tep-luat>] [--luat-cach ghi-de|ghep] [--cho-phep-db --tep-url-csdl <tep>] [--driver kho|cli] [--ra <thu-muc>] [--ghi-luot <thu-muc>] [--kho-ghi '<json>']\n");
    return 2;
  }
  const luatCach = docLuatCach(a["luat-cach"]);
  if (luatCach === null) {
    process.stderr.write(`--luat-cach phải là ghi-de hoặc ghep (nhận "${a["luat-cach"]}")\n`);
    return 2;
  }
  // `--cho-phep-db`: URL CSDL đọc từ TỆP ngoài repo / worktree (vai tho_ca_test); lỗi ⇒ dừng, thông báo không chứa nội dung tệp
  const thamDb = thamSoDbTuDongLenh(a, (d) => docUrlTuTep(d, [process.cwd(), ...(a.wt ? [a.wt] : [])]));
  if (thamDb.loi) {
    process.stderr.write(`${thamDb.loi}\n`);
    return 2;
  }
  if (thamDb.choPhepDb) {
    const lyDoRa = raTrongGocSandbox(a.ra ?? path.join(os.tmpdir(), "tho-ca-pilot"), a.wt ?? "D:\\SOURCES\\_tho_ca_wt", process.env);
    if (lyDoRa) {
      process.stderr.write(`${lyDoRa}\n`);
      return 2;
    }
  }
  const drv = (a.driver ?? "cli") as TenDriver;
  if (drv !== "kho" && drv !== "cli" && drv !== "host") {
    process.stderr.write(`driver không hợp lệ: ${drv}\n`);
    return 2;
  }
  // Cờ AI_AGENT_* khai TƯỜNG MINH (không nhận ngầm từ .env — xem napEnv.ts). `--cong-ke-hoach` = AI_AGENT_CONG_KE_HOACH=1 (cổng duyệt kế hoạch 11.3-C).
  const { docCoTuongMinh, datCoTuongMinh, coAiAgentHieuLuc } = await import("./napEnv");
  const tm = docCoTuongMinh(a.co === "1" ? "" : a.co);
  if (tm.loi.length > 0) {
    process.stderr.write(`--co không hợp lệ: ${tm.loi.join("; ")}\n`);
    return 2;
  }
  if (a["cong-ke-hoach"]) tm.co.AI_AGENT_CONG_KE_HOACH = "1";
  let driver: TenDriver | Driver = drv;
  if (drv === "host") {
    if (a["env-tu"]) {
      const { napEnvTuTep } = await import("./napEnv");
      const kqNap = napEnvTuTep(a["env-tu"]);
      process.stderr.write(`[tho-ca-pilot] đã nạp từ --env-tu (chỉ tên khoá): ${kqNap.daNap.join(" ") || "(không)"}; đã có sẵn trong môi trường (giữ nguyên): ${kqNap.daCo.join(" ") || "(không)"}
`);
      if (kqNap.boQuaCoAgent.length > 0) {
        process.stderr.write(`[tho-ca-pilot] BỎ QUA cờ AI_AGENT_* trong ${a["env-tu"]} (không nhận ngầm; khai bằng --co nếu muốn): ${kqNap.boQuaCoAgent.join(" ")}\n`);
      }
    }
    const id = Number(a["nguoi-id"]);
    if (!Number.isInteger(id) || id <= 0) {
      process.stderr.write("driver host cần --nguoi-id <id engineer1 trong _test> (KHÔNG admin) [--nguoi-vai engineer] [--han-duyet <giây>]\n");
      return 2;
    }
    if ((a["nguoi-vai"] ?? "engineer") === "admin") {
      process.stderr.write("từ chối: pilot KHÔNG chạy bằng vai admin\n");
      return 2;
    }
    datCoTuongMinh(tm.co);
    const { driverHost, phuThuocHostThat } = await import("./driverHost");
    const dep = await phuThuocHostThat({ nguoi: { id, role: a["nguoi-vai"] ?? "engineer", name: "pilot-tho-ca" } });
    driver = driverHost(dep, a["han-duyet"] ? Number(a["han-duyet"]) : 3600);
  }
  datCoTuongMinh(tm.co);
  const coAiAgent = coAiAgentHieuLuc();
  process.stderr.write(`[tho-ca-pilot] cờ AI_AGENT_* CÓ HIỆU LỰC: ${Object.entries(coAiAgent).map(([k, v]) => `${k}=${v}`).join(" ") || "(không — mọi cờ ở mặc định trong mã)"}\n`);
  const kq = await chayMotViec({
    coAiAgent,
    van: fs.readFileSync(a.the, "utf8"),
    wt: a.wt ?? "D:\\SOURCES\\_tho_ca_wt",
    base: a.base ?? "main",
    luatCach,
    ...(a.luat ? (({ luat, nguon }) => ({ luat, luatNguon: nguon }))(docLuatTuTep(a.luat)) : {}),
    boChay: commitBoChay(),
    ...(({ choPhepDb, testDbUrl }) => ({ choPhepDb, testDbUrl }))(thamDb),
    driver,
    tenDriver: drv,
    ra: a.ra ?? path.join(os.tmpdir(), "tho-ca-pilot"),
    ghiLuotDir: a["ghi-luot"] ?? null,
    khoGhi: a["kho-ghi"] ? (JSON.parse(a["kho-ghi"]) as Record<string, string>) : {},
    nhatKy: (s) => process.stderr.write(`[tho-ca-pilot] ${s}\n`),
  });
  process.stdout.write(`${JSON.stringify(kq)}\n`);
  return kq.ok ? 0 : 1;
}

if (process.argv[1] && /chayMotViec\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (ma) => process.exit(ma),
    (e) => {
      process.stderr.write(`✖ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
      process.exit(3);
    },
  );
}
