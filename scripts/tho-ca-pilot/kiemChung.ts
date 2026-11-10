/**
 * Pilot "Thợ Cả nhận việc" — L3a: BỘ CHẠY TỰ CHẠY LỆNH KIỂM (kiểm chứng tự động).
 *
 * Vì sao: trước đây `ketCuc = "xong"` chỉ cần "có đổi tệp, driver không lỗi, không vi phạm diff" — một test ĐỎ vẫn ra "xong", và bộ chạy
 * tin vào việc model tự chạy + tự đọc kết quả. Nay bộ chạy tự chạy LỆNH KIỂM của thẻ trong worktree pilot, ĐỌC kết quả, rồi mới cho "xong".
 *
 * Môi trường lệnh kiểm = môi trường lúc model chạy: DB CHẾT (cổng 9, hai tên DB khác nhau để vitest.setup không từ chối) ⇒ test chạm DB
 * không chạy được, không bao giờ chạm DEV/_test. Hạn giờ RIÊNG (không ăn vào hạn của model).
 *
 * Phần THUẦN (phanTichVitest, demCaTest, quyetKetCuc) tách khỏi phần chạy tiến trình (chayLenhKiem) để test không cần vitest lồng vitest.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { KetQuaDotBien } from "./dotBien";

/**
 * Môi trường cho tiến trình CON do bộ chạy chạy (lệnh kiểm, tsc, đột biến): chạy mã do MODEL viết ⇒ KHÔNG được thừa kế bí mật của tiến trình pilot
 * (khoá :8091, đường dẫn tệp khoá, JWT/SECRET/PASSWORD/TOKEN, DATABASE_URL thật). Gỡ mọi biến có tên bí mật hoặc `*_KEY_FILE`, rồi ép DB chết.
 */
export function envSachChoTienTrinhCon(goc: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ra: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(goc)) {
    if (/(API_KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|_KEY_FILE|_PASSWORD_FILE)/i.test(k)) continue;
    ra[k] = v;
  }
  return { ...ra, ...ENV_DB_CHET };
}

/** Môi trường của `tsc` do bộ chạy chạy: sạch bí mật + heap 12 GB (cùng cổng check:tests). Tách riêng để test được. */
export function envChoTsc(goc: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...envSachChoTienTrinhCon(goc), NODE_OPTIONS: "--max-old-space-size=12288", NO_COLOR: "1", FORCE_COLOR: "0" };
}

/** Hai URL cổng chết, tên DB khác nhau (vitest.setup từ chối khi trùng tên). */
export const ENV_DB_CHET: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://pilot_kiem:x@127.0.0.1:9/aoi_management",
  TEST_DATABASE_URL: "postgresql://pilot_kiem:x@127.0.0.1:9/aoi_management_test",
};

export interface DemVitest {
  dat: number;
  hong: number;
  boQua: number;
  tong: number;
}
export interface KetQuaVitest {
  /** dòng "Test Files" — null nếu vắng */
  tep: DemVitest | null;
  /** dòng "Tests" — null nếu vắng */
  ca: DemVitest | null;
}

export interface KetQuaKiem {
  lenh: string;
  /** mã thoát; null = bị giết do hết hạn / không khởi chạy được */
  exit: number | null;
  hetGio: boolean;
  giay: number;
  /** đuôi đầu ra đã bỏ mã màu (tối đa ~3000 ký tự) — để người đọc thấy vì sao đỏ */
  duoi: string;
  vitest: KetQuaVitest;
  /** lỗi khởi chạy tiến trình nếu có */
  loi?: string;
}

const boMau = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function docDem(phan: string): DemVitest {
  const lay = (tu: string) => {
    const m = new RegExp(`(\\d+)\\s+${tu}`).exec(phan);
    return m ? Number(m[1]) : 0;
  };
  const tong = /\((\d+)\)\s*$/.exec(phan.trim());
  const dat = lay("passed");
  const hong = lay("failed");
  const boQua = lay("skipped") + lay("todo");
  return { dat, hong, boQua, tong: tong ? Number(tong[1]) : dat + hong + boQua };
}

/**
 * Đọc dòng tổng kết của vitest. ĐỌC CẢ dòng "Test Files" lẫn "Tests" (bẫy cũ: chỉ đọc "Tests" làm lọt "No test files found" / tệp hỏng khi nạp).
 * Lấy dòng CUỐI cùng khớp (vitest in một lần ở cuối; chạy theo cụm thì lần cuối là tổng).
 */
export function phanTichVitest(dau: string): KetQuaVitest {
  const dong = boMau(dau).split(/\r?\n/);
  let tep: DemVitest | null = null;
  let ca: DemVitest | null = null;
  for (const d of dong) {
    const mt = /^\s*Test Files\s+(.+)$/.exec(d);
    if (mt) tep = docDem(mt[1]);
    const mc = /^\s*Tests\s+(.+)$/.exec(d);
    if (mc) ca = docDem(mc[1]);
  }
  return { tep, ca };
}

/**
 * Đếm số ca test CHẠY ĐƯỢC trong một tệp: it/test (kể cả .only/.each/.concurrent), BỎ .skip/.todo, bỏ chú thích và chuỗi chú giải đơn giản.
 * Là phép đếm tĩnh thô: `.each` tính 1 (không biết số hàng). Mục đích duy nhất: bắt tệp test MỚI rỗng (0 ca).
 */
export function demCaTest(nguon: string): number {
  const khongCt = nguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  let n = 0;
  const re = /(?:^|[^\w.$])(?:it|test)((?:\.\w+)*)\s*(?:\(|`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(khongCt)) !== null) {
    const mod = m[1] ?? "";
    if (/\.(skip|todo)\b/.test(mod)) continue;
    n++;
  }
  return n;
}

export const RE_TEP_TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

export type KetCucKiem = "xong" | "kiem-do" | "test-rong" | "bao-sai" | "dot-bien-song" | "vi-pham" | "het-gio" | "loi-driver" | "khong-lam" | "tu-choi";

/** Ketcuc nào là "đã chốt xấu" ⇒ L3 không được nâng lên (sticky). */
const KET_CUC_XAU = new Set<KetCucKiem>(["vi-pham", "het-gio", "loi-driver", "khong-lam", "tu-choi", "kiem-do", "test-rong", "bao-sai", "dot-bien-song"]);

export interface DauVaoQuyet {
  /** ketCuc do phần diff/driver đã quyết trước khi kiểm chứng */
  truoc: KetCucKiem;
  /** lệnh kiểm có dùng vitest không (quyết việc có bắt buộc đọc dòng "Test Files"/"Tests") */
  dungVitest: boolean;
  /** tệp test do model thêm/sửa: số ca đếm tĩnh */
  tepTest: ReadonlyArray<{ duong: string; soCa: number }>;
  /** kết quả chạy lệnh kiểm; null = chưa chạy (vì có tệp test rỗng) */
  kiem: KetQuaKiem | null;
  /** L3c: kết quả tsc (chỉ lỗi nằm trong tệp model đổi); vắng/null = không chạy (không có tệp .ts đổi / không có tsconfig.tests.json) */
  tsc?: KetQuaTsc | null;
  /** L3b: kết quả áp đột biến của thẻ (chỉ khi thẻ có ĐỘT BIẾN và các bước trước đều xanh); vắng/null = không áp */
  dotBien?: KetQuaDotBien | null;
}

export interface QuyetKetCuc {
  ketCuc: KetCucKiem;
  /** lý do một dòng, ghi vào luuY */
  lyDo: string | null;
}

/** THUẦN. Sticky: ketCuc xấu đến từ trước giữ nguyên; chỉ "xong" mới bị hạ bởi kiểm chứng (lệnh kiểm rồi tsc). */
export function quyetKetCuc(v: DauVaoQuyet): QuyetKetCuc {
  const r = quyetLenhKiem(v);
  if (r.ketCuc !== "xong") return r;
  const t = v.tsc;
  if (t) {
    if (t.hetGio) return { ketCuc: "kiem-do", lyDo: `tsc hết hạn sau ${t.giay}s — không kết luận được kiểu (fail-closed)` };
    if (t.loi) return { ketCuc: "kiem-do", lyDo: `tsc không khởi chạy được: ${t.loi}` };
    if (t.loiTrongTep.length > 0) {
      return { ketCuc: "kiem-do", lyDo: `tsc: ${t.loiTrongTep.length} lỗi kiểu trong tệp model đổi — ${t.loiTrongTep.slice(0, 3).join(" | ")}` };
    }
  }
  const d = v.dotBien;
  if (d) {
    // lỗi CỦA BỘ CHẠY (không khôi phục sạch / tệp lạ sau revert) đi trước: kết quả đột biến không còn tin được
    if (!d.khoiPhucSach) return { ketCuc: "vi-pham", lyDo: "L3b: khôi phục tệp sau đột biến KHÔNG sạch — worktree có thể đã bị bẩn" };
    if (d.tepLa.length > 0) return { ketCuc: "vi-pham", lyDo: `L3b: tệp lạ sau khôi phục đột biến: ${d.tepLa.slice(0, 3).join(", ")}` };
    if (d.song > 0) {
      const song = d.chiTiet.filter((c) => c.ketQua === "song").map((c) => `${c.tep}: "${c.tim.slice(0, 40)}"`);
      return { ketCuc: "dot-bien-song", lyDo: `L3b: ${d.song}/${d.tong} đột biến SỐNG (test vẫn xanh): ${song.slice(0, 3).join(" | ")}` };
    }
    if (d.khongApDung > 0) return { ketCuc: "kiem-do", lyDo: `L3b: ${d.khongApDung}/${d.tong} đột biến không áp dụng/không kết luận được (lỗi thẻ hoặc hết hạn)` };
  }
  return r;
}

function quyetLenhKiem(v: DauVaoQuyet): QuyetKetCuc {
  if (KET_CUC_XAU.has(v.truoc) || v.truoc !== "xong") return { ketCuc: v.truoc, lyDo: null };

  const rong = v.tepTest.filter((t) => t.soCa === 0).map((t) => t.duong);
  if (rong.length > 0) return { ketCuc: "test-rong", lyDo: `tệp test mới/sửa không có ca nào: ${rong.join(", ")}` };

  const k = v.kiem;
  if (!k) return { ketCuc: "kiem-do", lyDo: "không chạy được LỆNH KIỂM (bộ chạy không có kết quả)" };
  if (k.hetGio) return { ketCuc: "kiem-do", lyDo: `LỆNH KIỂM hết hạn sau ${k.giay}s` };
  if (k.loi) return { ketCuc: "kiem-do", lyDo: `LỆNH KIỂM không khởi chạy được: ${k.loi}` };

  if (v.dungVitest) {
    const { tep, ca } = k.vitest;
    if (!tep || !ca) {
      // không có dòng Test Files / Tests: vitest không chạy ca nào (No test files found, lỗi nạp cấu hình, …)
      return k.exit === 0
        ? { ketCuc: "test-rong", lyDo: "vitest thoát 0 nhưng không có dòng \"Test Files\"/\"Tests\" — không ca nào chạy" }
        : { ketCuc: "kiem-do", lyDo: `LỆNH KIỂM thoát mã ${k.exit} và không có dòng \"Test Files\"/\"Tests\" (lỗi nạp / không thấy tệp)` };
    }
    if (ca.hong > 0 || tep.hong > 0) return { ketCuc: "kiem-do", lyDo: `LỆNH KIỂM đỏ: ${tep.hong} tệp hỏng, ${ca.hong} ca hỏng (Tests ${ca.dat} passed / ${ca.tong})` };
    if (k.exit !== 0) return { ketCuc: "kiem-do", lyDo: `LỆNH KIỂM thoát mã ${k.exit} dù không đếm được ca hỏng` };
    if (ca.dat === 0) return { ketCuc: "test-rong", lyDo: `0 ca chạy qua (Tests ${ca.dat} passed / ${ca.tong})` };
    return { ketCuc: "xong", lyDo: null };
  }
  // lệnh kiểm không phải vitest (vd script): chỉ có mã thoát
  return k.exit === 0 ? { ketCuc: "xong", lyDo: null } : { ketCuc: "kiem-do", lyDo: `LỆNH KIỂM thoát mã ${k.exit}` };
}

export interface KetQuaTsc {
  exit: number | null;
  hetGio: boolean;
  giay: number;
  /** dòng lỗi "tệp(dòng,cột): error TSxxxx: …" chỉ của các tệp model đổi (tsc báo cả lỗi có sẵn ở tệp khác — không tính) */
  loiTrongTep: string[];
  /** tổng số dòng lỗi tsc (mọi tệp) — để thấy ngay nếu nền đã đỏ sẵn */
  tongLoi: number;
  loi?: string;
}

/** THUẦN. Lọc dòng lỗi tsc theo danh sách tệp đổi (đường tương đối POSIX trong worktree). */
export function loiTscTrongTep(dau: string, tepDoi: readonly string[]): { trongTep: string[]; tong: number } {
  const tap = new Set(tepDoi.map((t) => t.replace(/\\/g, "/")));
  const trongTep: string[] = [];
  let tong = 0;
  for (const d of boMau(dau).split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/.exec(d);
    if (!m) continue;
    tong++;
    if (tap.has(m[1].replace(/\\/g, "/"))) trongTep.push(d.trim());
  }
  return { trongTep, tong };
}

/** Có đáng chạy tsc không: có tệp .ts/.tsx/.mts/.cts đổi VÀ worktree có tsconfig.tests.json (cổng check:tests của dự án). */
export function canChayTsc(wt: string, tepDoi: readonly string[]): boolean {
  return tepDoi.some((t) => /\.(?:ts|tsx|mts|cts)$/.test(t)) && fs.existsSync(path.join(wt, "tsconfig.tests.json"));
}

export type ChayTsc =(wt: string, tepDoi: readonly string[], hanGiay: number) => Promise<KetQuaTsc>;

/** Chạy `tsc --noEmit -p tsconfig.tests.json` (cùng cổng check:tests của dự án) trong worktree pilot; heap 12 GB; giết cả cây khi hết hạn. */
export const chayLenhTsc: ChayTsc = (wt, tepDoi, hanGiay) =>
  new Promise((xong) => {
    const t0 = Date.now();
    let dau = "";
    let hetGio = false;
    const env = envChoTsc();
    const ra = (exit: number | null, loi?: string) => {
      clearTimeout(dongHo);
      const { trongTep, tong } = loiTscTrongTep(dau, tepDoi);
      xong({ exit, hetGio, giay: Math.round(((Date.now() - t0) / 1000) * 10) / 10, loiTrongTep: trongTep, tongLoi: tong, ...(loi ? { loi } : {}) });
    };
    let con: ReturnType<typeof spawn>;
    try {
      con = spawn("npx tsc --noEmit -p tsconfig.tests.json", { cwd: wt, env, shell: true, windowsHide: true });
    } catch (e) {
      xong({ exit: null, hetGio: false, giay: 0, loiTrongTep: [], tongLoi: 0, loi: String(e) });
      return;
    }
    const dongHo = setTimeout(() => {
      hetGio = true;
      if (con.pid) spawnSync("taskkill", ["/PID", String(con.pid), "/T", "/F"], { stdio: "ignore" });
      else con.kill();
    }, Math.max(1, hanGiay) * 1000);
    con.stdout?.on("data", (b) => (dau += String(b)));
    con.stderr?.on("data", (b) => (dau += String(b)));
    con.on("error", (e) => ra(null, String(e)));
    con.on("close", (ma) => ra(hetGio ? null : ma));
  });

/** Lệnh kiểm có dùng vitest không (quyết việc đọc dòng tổng kết). */
export function laLenhVitest(lenh: string): boolean {
  return /\bvitest\b/.test(lenh);
}

/** Đếm ca tĩnh cho các tệp test trong danh sách tệp đổi; tệp đã bị xoá bỏ qua. */
export function demTepTest(wt: string, tepDoi: readonly string[]): Array<{ duong: string; soCa: number }> {
  const ra: Array<{ duong: string; soCa: number }> = [];
  for (const t of tepDoi) {
    if (!RE_TEP_TEST.test(t)) continue;
    try {
      ra.push({ duong: t, soCa: demCaTest(fs.readFileSync(path.join(wt, t), "utf8")) });
    } catch {
      /* tệp bị xoá */
    }
  }
  return ra;
}

export type ChayKiem = (lenh: string, wt: string, hanGiay: number) => Promise<KetQuaKiem>;

/** Chạy LỆNH KIỂM thật: shell, cwd = worktree pilot, env DB chết, hạn giờ riêng (giết cả cây tiến trình khi hết hạn). */
export const chayLenhKiem: ChayKiem = (lenh, wt, hanGiay) =>
  new Promise((xong) => {
    const t0 = Date.now();
    let dau = "";
    let hetGio = false;
    const env: NodeJS.ProcessEnv = { ...envSachChoTienTrinhCon(), CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
    const ketThuc = (exit: number | null, loi?: string) => {
      clearTimeout(dongHo);
      const sach = boMau(dau);
      xong({
        lenh,
        exit,
        hetGio,
        giay: Math.round(((Date.now() - t0) / 1000) * 10) / 10,
        duoi: sach.length > 3000 ? sach.slice(-3000) : sach,
        vitest: phanTichVitest(sach),
        ...(loi ? { loi } : {}),
      });
    };
    let con: ReturnType<typeof spawn>;
    try {
      con = spawn(lenh, { cwd: wt, env, shell: true, windowsHide: true });
    } catch (e) {
      xong({ lenh, exit: null, hetGio: false, giay: 0, duoi: "", vitest: { tep: null, ca: null }, loi: String(e) });
      return;
    }
    const dongHo = setTimeout(() => {
      hetGio = true;
      if (con.pid) spawnSync("taskkill", ["/PID", String(con.pid), "/T", "/F"], { stdio: "ignore" });
      else con.kill();
    }, Math.max(1, hanGiay) * 1000);
    con.stdout?.on("data", (b) => (dau += String(b)));
    con.stderr?.on("data", (b) => (dau += String(b)));
    con.on("error", (e) => ketThuc(null, String(e)));
    con.on("close", (ma) => ketThuc(hetGio ? null : ma));
  });
