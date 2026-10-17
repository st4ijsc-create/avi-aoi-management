/**
 * ★★★ Đợt 0.1 — GIÁM SÁT `llama-server` + TỰ KHỞI ĐỘNG LẠI, và cửa FAIL-CLOSED cho model chính.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐANG VÁ (đo 2026-10-14)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • `:8091` chết từ 10/9 và KHÔNG AI dựng lại: Task Scheduler chỉ chạy `start-llama-server.ps1`
 *     lúc đăng nhập. `/api/health/ai` báo `textGeneration: degraded … in-process, MẤT PREFIX-CACHE,
 *     fallback: silent` — tức hệ biết, nhưng chỉ NÓI, không SỬA.
 *   • Lượt sinh mã kế tiếp nạp model 21 GB vào CHÍNH tiến trình node (TTFT 71 → 5.304 ms đã đo).
 *     Nếu sau đó ai đó (hoặc Task Scheduler) dựng lại llama-server ⇒ HAI bản cùng model tranh 32 GB.
 *
 * Module này làm HAI việc, cố ý để chung một chỗ vì chúng là HAI NỬA của cùng một hợp đồng:
 *   1. GIÁM SÁT (nhịp 15 s): thấy KHÔNG AI NGHE CỔNG ≥ 2 nhịp liền ⇒ chạy `start-llama-server.ps1`
 *      tách rời. Có khoá liên tiến trình, trần 3 lần / 30 phút, tệp tạm dừng.
 *   2. FAIL-CLOSED: lượt sinh chữ cho model server đang giữ mà server chết ⇒ CHỜ (có trần) cho
 *      nửa (1) dựng lại, thay vì nạp model vào tiến trình node. Hết trần ⇒ `LoiLlamaServerChet`
 *      (`code: "LLAMA_SERVER_DOWN"`) với câu tiếng Việt nói thật.
 *   ⇒ Có (2) mà không có (1) là treo người dùng 120 s rồi báo lỗi mãi mãi; có (1) mà không có (2)
 *     là vẫn nạp bản thứ hai trong lúc (1) đang dựng bản thứ nhất. Hai nửa phải đi cùng nhau.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * "CHẾT" NGHĨA LÀ GÌ — và vì sao định nghĩa hẹp
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CHỈ một kết quả thăm dò được tính là chết: **không có gì nghe cổng** (`ECONNREFUSED`). Ba kết
 * quả khác đều có MỘT TIẾN TRÌNH đang giữ cổng, và khởi động thêm là sai trong cả ba:
 *   • 503 `Loading model` — llama-server đang nạp (30–90 s với model 21 GB). Khởi động thêm = bản 2.
 *   • nhận TCP rồi im (treo) — có thể đang nạp, có thể kẹt. Giết/khởi động đè KHÔNG phải việc của
 *     bộ giám sát (kịch bản khởi động cũng từ chối spawn đè lên cổng có chủ — exit 3).
 *   • HTTP khác — có thể là dịch vụ khác chiếm cổng (8080 từng là Apache). Spawn đè vô ích.
 * Hai nhịp LIÊN TIẾP (không phải "2 trong N") vì một lần hụt có thể là khoảnh khắc giữa lúc tiến
 * trình cũ nhả cổng và tiến trình mới mở cổng (chính `doi-model.ps1` tạo ra khoảnh khắc đó).
 *
 * ⚠ KHÔNG import `aiLlamaServerClient` ở đây: nhiều lưới của `aiGgufEngine` mock module đó bằng
 *   factory LIỆT KÊ TAY, và mọi symbol không liệt kê sẽ biến mất. Thăm dò cổng tự làm bằng `fetch`;
 *   phép "server khoẻ chưa" của cửa fail-closed được TIÊM VÀO (`thamDoKhoe`) — engine truyền
 *   `srv.preflightHealthy`, nên lưới engine giả được nó mà không mở kết nối thật nào tới :8091.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn as spawnThat } from "node:child_process";

// ─── Kiểu ───────────────────────────────────────────────────────────────────────────────────────

/** Kết quả MỘT lần thăm dò cổng. Chỉ `khong-nghe` được tính vào "chết". */
export type KetQuaThamDo = "song" | "dang-nap" | "khong-tra-loi" | "khong-nghe";

/**
 * Trạng thái phơi ra ngoài (health, thanh trạng thái, System Health).
 *   chua-kiem          — chưa có nhịp nào (vừa boot).
 *   song               — `/health` 200.
 *   dang-nap           — có tiến trình giữ cổng nhưng chưa phục vụ (503 Loading / treo).
 *   chet               — không ai nghe cổng ≥ 2 nhịp liền (và chưa / không khởi động được).
 *   dang-khoi-dong-lai — đã chạy kịch bản khởi động (bởi tiến trình này HOẶC tiến trình khác giữ khoá).
 *   bo-cuoc            — đã dùng hết trần 3 lần / 30 phút; DỪNG thử cho tới khi thấy server sống.
 *   tam-dung           — tệp tạm dừng có mặt (đổi model có chủ ý — `doi-model.ps1`).
 *   tat                — giám sát không chạy (cờ tắt / URL không loopback / không phải Windows / chưa khởi chạy).
 */
export type TrangThaiGiamSat =
  | "chua-kiem"
  | "song"
  | "dang-nap"
  | "chet"
  | "dang-khoi-dong-lai"
  | "bo-cuoc"
  | "tam-dung"
  | "tat";

export interface CauHinhGiamSat {
  bat: boolean;
  /** Vì sao tắt (tiếng Việt) — `null` khi bật. */
  lyDoTat: string | null;
  url: string;
  nhipMs: number;
  soLanChetLienTiep: number;
  toiDaKhoiDong: number;
  cuaSoMs: number;
  /** Khoá cũ hơn mức này ⇒ hết hạn. PHẢI > `khoiDongHetGioMs` (khoá không được hết hạn giữa lượt khởi động). */
  khoaHetHanMs: number;
  /** Cửa sổ chờ một lượt khởi động sống lại. > `WaitSeconds` 300 s của kịch bản. */
  khoiDongHetGioMs: number;
  /** Tệp tạm dừng cũ hơn mức này ⇒ bỏ qua (chống kẹt khi `doi-model.ps1` chết giữa chừng). */
  tamDungHetHanMs: number;
  thamDoHetGioMs: number;
  duongTamDung: string;
  duongKhoa: string;
  duongLichSu: string;
  duongKichBan: string;
}

function so(env: NodeJS.ProcessEnv, ten: string, macDinh: number, toiThieu = 1): number {
  const n = Number(env[ten]);
  return Number.isFinite(n) && n >= toiThieu ? Math.floor(n) : macDinh;
}

function laLoopback(rawUrl: string): boolean {
  try {
    const h = new URL(rawUrl).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Đọc cấu hình từ env. Mặc định BẬT khi `LLAMA_SERVER_ENABLED=true` + có URL; `LLAMA_WATCHDOG_ENABLED=false`
 * tắt hẳn.
 *
 * ★ Khoá, lịch sử và tệp tạm dừng nằm ở `os.tmpdir()` chứ KHÔNG ở gốc repo: cùng một `:8091` được
 *   chia cho NHIỀU worktree (`:3000` chạy từ worktree này, `:3010` từ worktree kia). Một tệp ở gốc
 *   repo chỉ được tiến trình của ĐÚNG worktree đó thấy — `doi-model.ps1` ở worktree A tạm dừng thì
 *   giám sát ở worktree B vẫn dựng lại server ngay giữa lúc đổi model.
 */
export function docCauHinhGiamSat(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): CauHinhGiamSat {
  const url = (env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
  const tmp = os.tmpdir();
  let lyDoTat: string | null = null;
  if (env.LLAMA_SERVER_ENABLED !== "true" || !url) lyDoTat = "llama-server không bật (LLAMA_SERVER_ENABLED khác 'true' hoặc thiếu LLAMA_SERVER_URL).";
  else if ((env.LLAMA_WATCHDOG_ENABLED || "").trim().toLowerCase() === "false") lyDoTat = "LLAMA_WATCHDOG_ENABLED=false — giám sát tắt có chủ ý.";
  else if (!laLoopback(url)) lyDoTat = "LLAMA_SERVER_URL không phải loopback — máy này không dựng lại được tiến trình ở máy khác.";

  const khoaHetHanMs = so(env, "LLAMA_WATCHDOG_LOCK_STALE_MS", 10 * 60_000);
  return {
    bat: lyDoTat === null,
    lyDoTat,
    url,
    nhipMs: so(env, "LLAMA_WATCHDOG_INTERVAL_MS", 15_000, 1000),
    soLanChetLienTiep: 2,
    toiDaKhoiDong: so(env, "LLAMA_WATCHDOG_MAX_RESTARTS", 3),
    cuaSoMs: so(env, "LLAMA_WATCHDOG_WINDOW_MS", 30 * 60_000),
    khoaHetHanMs,
    // 6 phút: kịch bản chờ `/health` tối đa 300 s; thêm biên cho PowerShell khởi động + đọc .env.
    khoiDongHetGioMs: Math.min(so(env, "LLAMA_WATCHDOG_START_TIMEOUT_MS", 6 * 60_000), khoaHetHanMs - 1),
    tamDungHetHanMs: so(env, "LLAMA_WATCHDOG_PAUSE_MAX_MS", 30 * 60_000),
    thamDoHetGioMs: so(env, "LLAMA_WATCHDOG_PROBE_TIMEOUT_MS", 4000, 100),
    duongTamDung: (env.LLAMA_WATCHDOG_PAUSE_FILE || "").trim() || path.join(tmp, "llama-watchdog.pause"),
    duongKhoa: path.join(tmp, "llama-watchdog.lock"),
    duongLichSu: path.join(tmp, "llama-watchdog.history.json"),
    duongKichBan: (env.LLAMA_WATCHDOG_START_SCRIPT || "").trim() || path.resolve(cwd, "scripts", "ai", "start-llama-server.ps1"),
  };
}

/** Cửa fail-closed: MẶC ĐỊNH BẬT. `LLAMA_SERVER_FAIL_CLOSED=false` = hành vi cũ (lùi in-process im lặng). */
export function llamaServerFailClosed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LLAMA_SERVER_FAIL_CLOSED || "").trim().toLowerCase() !== "false";
}

// ─── Thăm dò cổng ──────────────────────────────────────────────────────────────────────────────

const MA_KHONG_NGHE = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "ENOTFOUND", "EHOSTUNREACH"]);

function maLoiCuaFetch(err: any): string[] {
  const c = err?.cause;
  const ma: string[] = [];
  if (c?.code) ma.push(String(c.code));
  if (Array.isArray(c?.errors)) for (const e of c.errors) if (e?.code) ma.push(String(e.code));
  return ma;
}

/**
 * Một lần thăm dò `GET /health`. Không bao giờ ném.
 * ⚠ Lỗi KHÔNG nhận diện được ⇒ `khong-tra-loi` (KHÔNG phải `khong-nghe`): nghiêng về phía KHÔNG
 *   khởi động — một lần khởi động thừa có thể là bản thứ hai 21 GB, một lần bỏ lỡ chỉ trễ 15 s.
 */
export async function thamDoCong(url: string, timeoutMs: number, fetchFn: typeof fetch = fetch): Promise<KetQuaThamDo> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    const key = (process.env.LLAMA_SERVER_API_KEY || "").trim();
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await fetchFn(`${url.replace(/\/+$/, "")}/health`, { headers, signal: ctrl.signal });
    // Đọc hết thân để socket được trả về pool (không rò kết nối mỗi 15 s).
    await res.text().catch(() => "");
    if (res.ok) return "song";
    if (res.status === 503) return "dang-nap";
    return "khong-tra-loi";
  } catch (err: any) {
    if (err?.name === "AbortError") return "khong-tra-loi";
    return maLoiCuaFetch(err).some((m) => MA_KHONG_NGHE.has(m)) ? "khong-nghe" : "khong-tra-loi";
  } finally {
    clearTimeout(t);
  }
}

// ─── Logic quyết định — THUẦN ──────────────────────────────────────────────────────────────────

export interface BoNhoNhip {
  trangThai: TrangThaiGiamSat;
  demKhongNghe: number;
  /** Mốc tiến trình NÀY chạy kịch bản khởi động; `null` = không có lượt nào đang chờ. */
  dangKhoiDongTu: number | null;
  /** Dính cho tới khi thấy `song`. */
  boCuoc: boolean;
}

export type HanhDongNhip = "khong" | "thu-khoi-dong" | "xong-khoi-dong" | "het-gio-khoi-dong";

/**
 * MỘT nhịp: (bộ nhớ, kết quả thăm dò, giờ) ⇒ (bộ nhớ mới, việc phải làm). Không I/O.
 * Trần 3 lần / 30 phút KHÔNG nằm ở đây mà ở bước thực thi, DƯỚI KHOÁ: đếm lịch sử dùng chung trước
 * khi giữ khoá là để hai tiến trình cùng đọc "2 lần" rồi cùng khởi động lần thứ 3 và thứ 4.
 */
export function quyetDinhNhip(
  boNho: BoNhoNhip,
  thamDo: KetQuaThamDo,
  bayGio: number,
  cfg: Pick<CauHinhGiamSat, "soLanChetLienTiep" | "khoiDongHetGioMs">,
): { boNho: BoNhoNhip; hanhDong: HanhDongNhip } {
  if (thamDo === "song") {
    return {
      boNho: { trangThai: "song", demKhongNghe: 0, dangKhoiDongTu: null, boCuoc: false },
      hanhDong: boNho.dangKhoiDongTu !== null ? "xong-khoi-dong" : "khong",
    };
  }
  if (boNho.boCuoc) return { boNho: { ...boNho, trangThai: "bo-cuoc" }, hanhDong: "khong" };

  if (boNho.dangKhoiDongTu !== null) {
    if (bayGio - boNho.dangKhoiDongTu < cfg.khoiDongHetGioMs) {
      return { boNho: { ...boNho, trangThai: "dang-khoi-dong-lai", demKhongNghe: 0 }, hanhDong: "khong" };
    }
    // Hết giờ. Đang nạp dở (503/treo) ⇒ thôi giữ cửa sổ nhưng KHÔNG coi là chết; không ai nghe ⇒
    // chết, và đặt bộ đếm sát ngưỡng để nhịp KẾ TIẾP thử lại ngay (đã chờ cả cửa sổ rồi).
    return {
      boNho: {
        trangThai: thamDo === "khong-nghe" ? "chet" : "dang-nap",
        demKhongNghe: thamDo === "khong-nghe" ? Math.max(0, cfg.soLanChetLienTiep - 1) : 0,
        dangKhoiDongTu: null,
        boCuoc: false,
      },
      hanhDong: "het-gio-khoi-dong",
    };
  }

  if (thamDo !== "khong-nghe") {
    return { boNho: { ...boNho, trangThai: "dang-nap", demKhongNghe: 0 }, hanhDong: "khong" };
  }

  const dem = boNho.demKhongNghe + 1;
  if (dem < cfg.soLanChetLienTiep) {
    return { boNho: { ...boNho, demKhongNghe: dem }, hanhDong: "khong" };
  }
  return { boNho: { ...boNho, trangThai: "chet", demKhongNghe: dem }, hanhDong: "thu-khoi-dong" };
}

// ─── Khoá liên tiến trình (tệp `wx`) ───────────────────────────────────────────────────────────

export interface NoiDungKhoa {
  pid: number;
  luc: number;
  token: string;
}

export function docKhoa(duong: string): NoiDungKhoa | null {
  try {
    const j = JSON.parse(fs.readFileSync(duong, "utf8"));
    if (Number.isFinite(j?.pid) && Number.isFinite(j?.luc) && typeof j?.token === "string") return j as NoiDungKhoa;
    return null;
  } catch {
    return null;
  }
}

/**
 * PID còn sống? `process.kill(pid, 0)` chỉ HỎI, không gửi tín hiệu. `EPERM` = tồn tại nhưng không
 * có quyền ⇒ sống. ⚠ Windows tái dùng PID: một chủ khoá đã chết có thể "sống lại" dưới PID của tiến
 * trình khác ⇒ khoá kẹt tới khi quá hạn 10 phút. Đó là lý do có HAI điều kiện hết hạn, không một.
 */
export function laPidSongMacDinh(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

export type KetQuaGiuKhoa = { duoc: true; token: string } | { duoc: false; chu: { pid: number; luc: number } | null };

/**
 * Giành khoá bằng `open(…, "wx")` — HỆ ĐIỀU HÀNH bảo đảm chỉ một bên tạo được tệp. Khoá cũ quá hạn,
 * chủ đã chết, hoặc nội dung hỏng ⇒ xoá rồi thử lại ĐÚNG MỘT lần (hai bên cùng xoá rồi cùng tạo thì
 * vẫn chỉ một bên thắng `wx`).
 */
export function thuGiuKhoa(
  duong: string,
  o: { bayGio: number; hetHanMs: number; pid?: number; laPidSong?: (pid: number) => boolean },
): KetQuaGiuKhoa {
  const pid = o.pid ?? process.pid;
  const laPidSong = o.laPidSong ?? laPidSongMacDinh;
  const token = randomUUID();
  const thuTao = (): boolean => {
    try {
      fs.writeFileSync(duong, JSON.stringify({ pid, luc: o.bayGio, token } satisfies NoiDungKhoa), { flag: "wx" });
      return true;
    } catch (e: any) {
      if (e?.code === "EEXIST") return false;
      throw e;
    }
  };
  try {
    if (thuTao()) return { duoc: true, token };
    const cu = docKhoa(duong);
    const hetHan = !cu || o.bayGio - cu.luc >= o.hetHanMs || !laPidSong(cu.pid);
    if (!hetHan) return { duoc: false, chu: { pid: cu!.pid, luc: cu!.luc } };
    try {
      fs.unlinkSync(duong);
    } catch {
      /* bên kia vừa xoá trước — không sao, `wx` dưới đây vẫn phân xử */
    }
    if (thuTao()) return { duoc: true, token };
    const moi = docKhoa(duong);
    return { duoc: false, chu: moi ? { pid: moi.pid, luc: moi.luc } : null };
  } catch {
    // Không ghi được thư mục tạm ⇒ coi như KHÔNG giữ được (an toàn: không khởi động mù).
    return { duoc: false, chu: null };
  }
}

/** Nhả CHỈ khi tệp còn mang token của mình — không bao giờ xoá khoá của người khác. */
export function nhaKhoa(duong: string, token: string): boolean {
  const cu = docKhoa(duong);
  if (!cu || cu.token !== token) return false;
  try {
    fs.unlinkSync(duong);
    return true;
  } catch {
    return false;
  }
}

// ─── Lịch sử khởi động (dùng chung giữa tiến trình) ────────────────────────────────────────────

export function docLichSuKhoiDong(duong: string): number[] {
  try {
    const j = JSON.parse(fs.readFileSync(duong, "utf8"));
    return Array.isArray(j) ? j.filter((x) => Number.isFinite(x)).map(Number) : [];
  } catch {
    return [];
  }
}

/** Chỉ gọi khi ĐANG GIỮ KHOÁ — đó là thứ làm phép đọc-sửa-ghi này an toàn giữa các tiến trình. */
function ghiLichSuKhoiDong(duong: string, mocs: number[]): void {
  try {
    fs.writeFileSync(duong, JSON.stringify(mocs.slice(-50)));
  } catch {
    /* mất lịch sử = trần chỉ còn đếm trong tiến trình; không chặn lượt khởi động */
  }
}

export function demTrongCuaSo(mocs: number[], bayGio: number, cuaSoMs: number): number {
  return mocs.filter((m) => m > bayGio - cuaSoMs && m <= bayGio).length;
}

// ─── Tệp tạm dừng ──────────────────────────────────────────────────────────────────────────────

/** Có tệp và tệp còn MỚI (mtime trong hạn). `doi-model.ps1` chạm mtime mỗi vòng chờ. */
export function dangTamDung(duong: string, bayGio: number, hetHanMs: number): boolean {
  try {
    const st = fs.statSync(duong);
    return bayGio - st.mtimeMs < hetHanMs;
  } catch {
    return false;
  }
}

// ─── Khởi động tách rời ────────────────────────────────────────────────────────────────────────

/**
 * Chạy `start-llama-server.ps1` TÁCH RỜI.
 *
 * ⚠ BẪY ĐÃ BIẾT: `Start-Process` (bên trong kịch bản) gọi từ một tiến trình đang GIỮ ỐNG stdout/err
 *   của người gọi có thể làm người gọi TREO tới khi cháu (llama-server, sống vĩnh viễn) đóng ống.
 *   ⇒ `stdio: "ignore"` (không ống nào được thừa kế) + `unref()`: node không chờ, không giữ gì.
 * ⚠⚠ KHÔNG `detached` (ĐO 2026-10-17): `detached` ⇒ DETACHED_PROCESS ⇒ powershell.exe KHÔNG có console ⇒
 *   thoát 0 mà KHÔNG chạy một dòng kịch bản nào — cổng sống "giết llama-server" 300 s không phục hồi trong khi
 *   lưới mock xanh. Không detached thì powershell (con trực tiếp) nằm trong job của node, nhưng libuv cho
 *   phép cháu THOÁT KHỎI job (silent breakaway) ⇒ llama-server do `Start-Process` dựng vẫn sống khi app chết
 *   (đo: cháu `ping` sống sau khi node cha thoát; lưới "THẬT" trong giamSatLlamaServer.test.ts).
 * ⚠ PHẢI nghe `error`: `spawn` ENOENT (không có powershell.exe) phát sự kiện BẤT ĐỒNG BỘ; không ai
 *   nghe ⇒ `uncaughtException` ⇒ sập CẢ server ứng dụng vì một bộ giám sát.
 */
/** Kịch bản khởi động vắng — lỗi HỆ THỐNG TỆP: giữ đường dẫn (giá trị chẩn đoán), bộ giám sát bắt nội bộ, không tới tRPC. */
export class LoiKichBanKhoiDongVang extends Error {
  readonly code = "KICH_BAN_KHOI_DONG_VANG" as const;
  constructor(readonly duongDan: string) {
    super(`không thấy kịch bản khởi động: ${duongDan}`);
    this.name = "LoiKichBanKhoiDongVang";
  }
}

export function khoiDongTachRoi(
  kichBan: string,
  o: {
    spawnFn?: typeof spawnThat;
    cwd?: string;
    khiKetThuc?: (code: number | null, loi?: Error) => void;
    /**
     * Đợt 6 — cờ thêm cho kịch bản. DANH SÁCH ĐÓNG: chỉ `-Force` (API đổi model: giết llama-server đang giữ
     * cổng rồi dựng lại từ lựa chọn mới). Bộ giám sát KHÔNG BAO GIỜ truyền — nó chỉ chạy khi không ai nghe cổng.
     */
    thamSoThem?: readonly "-Force"[];
  } = {},
): { pid: number | undefined } {
  if (!fs.existsSync(kichBan)) throw new LoiKichBanKhoiDongVang(kichBan);
  const spawnFn = o.spawnFn ?? spawnThat;
  const them = (o.thamSoThem ?? []).filter((x) => x === "-Force");
  const con = spawnFn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", kichBan, ...them], {
    cwd: o.cwd ?? path.resolve(path.dirname(kichBan), "..", ".."),
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  con.on("error", (e: Error) => o.khiKetThuc?.(null, e));
  con.on("exit", (code: number | null) => o.khiKetThuc?.(code));
  con.unref();
  return { pid: con.pid };
}

// ─── Bộ giám sát ───────────────────────────────────────────────────────────────────────────────

export interface AnhChupGiamSat {
  trangThai: TrangThaiGiamSat;
  thamDoCuoi: KetQuaThamDo | null;
  lanKiemCuoi: string | null;
  /** Số lần TIẾN TRÌNH NÀY đã chạy kịch bản khởi động từ khi boot. */
  soLanKhoiDong: number;
  /** Số lần khởi động (mọi tiến trình) trong cửa sổ hiện tại — đọc từ lịch sử dùng chung. */
  soLanTrongCuaSo: number;
  toiDaKhoiDong: number;
  cuaSoPhut: number;
  lanKhoiDongCuoi: string | null;
  nguoiKhoiDong: "tien-trinh-nay" | "tien-trinh-khac" | null;
  /** Một câu tiếng Việt nói ĐANG XẢY RA GÌ. */
  lyDo: string;
}

export interface NhatKy {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

export interface PhuThuocGiamSat {
  cfg: CauHinhGiamSat;
  bayGio: () => number;
  thamDo: () => Promise<KetQuaThamDo>;
  /** Chạy kịch bản khởi động. Ném ⇒ lượt thất bại ngay. `khiKetThuc` báo mã thoát / lỗi spawn. */
  khoiDong: (khiKetThuc: (code: number | null, loi?: Error) => void) => void;
  pid?: number;
  laPidSong?: (pid: number) => boolean;
  log?: NhatKy;
}

const LOG_MAC_DINH: NhatKy = {
  info: (m) => console.log(`[llama-watchdog] ${m}`),
  warn: (m) => console.warn(`[llama-watchdog] ${m}`),
  error: (m) => console.error(`[llama-watchdog] ${m}`),
};

export class GiamSatLlamaServer {
  private boNho: BoNhoNhip = { trangThai: "chua-kiem", demKhongNghe: 0, dangKhoiDongTu: null, boCuoc: false };
  private thamDoCuoi: KetQuaThamDo | null = null;
  private lanKiemCuoi: number | null = null;
  private soLanKhoiDong = 0;
  private lanKhoiDongCuoi: number | null = null;
  private nguoiKhoiDong: "tien-trinh-nay" | "tien-trinh-khac" | null = null;
  private tokenKhoa: string | null = null;
  private lyDo = "Chưa có nhịp kiểm nào.";
  private dangKiem: Promise<AnhChupGiamSat> | null = null;
  private hen: NodeJS.Timeout | null = null;
  /** Đời của lượt khởi động hiện tại — báo thoát của một lượt CŨ không được đóng cửa sổ lượt MỚI. */
  private doiKhoiDong = 0;
  private readonly log: NhatKy;

  constructor(private readonly d: PhuThuocGiamSat) {
    this.log = d.log ?? LOG_MAC_DINH;
  }

  get cfg(): CauHinhGiamSat {
    return this.d.cfg;
  }

  anhChup(): AnhChupGiamSat {
    const bayGio = this.d.bayGio();
    return {
      trangThai: this.boNho.trangThai,
      thamDoCuoi: this.thamDoCuoi,
      lanKiemCuoi: this.lanKiemCuoi !== null ? new Date(this.lanKiemCuoi).toISOString() : null,
      soLanKhoiDong: this.soLanKhoiDong,
      soLanTrongCuaSo: demTrongCuaSo(docLichSuKhoiDong(this.d.cfg.duongLichSu), bayGio, this.d.cfg.cuaSoMs),
      toiDaKhoiDong: this.d.cfg.toiDaKhoiDong,
      cuaSoPhut: Math.round(this.d.cfg.cuaSoMs / 60_000),
      lanKhoiDongCuoi: this.lanKhoiDongCuoi !== null ? new Date(this.lanKhoiDongCuoi).toISOString() : null,
      nguoiKhoiDong: this.boNho.trangThai === "dang-khoi-dong-lai" ? this.nguoiKhoiDong : null,
      lyDo: this.lyDo,
    };
  }

  /** Một nhịp. Gọi chồng ⇒ dùng chung lượt đang chạy (không thăm dò/khởi động hai lần song song). */
  kiem(): Promise<AnhChupGiamSat> {
    if (!this.dangKiem) {
      this.dangKiem = this.kiemMotNhip().finally(() => {
        this.dangKiem = null;
      });
    }
    return this.dangKiem;
  }

  batDau(): void {
    if (this.hen) return;
    void this.kiem().catch(() => {});
    this.hen = setInterval(() => void this.kiem().catch(() => {}), this.d.cfg.nhipMs);
    this.hen.unref?.();
  }

  dung(): void {
    if (this.hen) clearInterval(this.hen);
    this.hen = null;
    this.nhaKhoaNeuGiu();
  }

  private nhaKhoaNeuGiu(): void {
    if (this.tokenKhoa) nhaKhoa(this.d.cfg.duongKhoa, this.tokenKhoa);
    this.tokenKhoa = null;
  }

  private async kiemMotNhip(): Promise<AnhChupGiamSat> {
    const cfg = this.d.cfg;
    const bayGio = this.d.bayGio();
    this.lanKiemCuoi = bayGio;

    if (dangTamDung(cfg.duongTamDung, bayGio, cfg.tamDungHetHanMs)) {
      if (this.boNho.trangThai !== "tam-dung") this.log.info(`tạm dừng — có tệp ${cfg.duongTamDung} (đổi model có chủ ý). Không khởi động lại.`);
      // Không mang bộ đếm cũ qua: sau tạm dừng lại cần đủ 2 nhịp LIÊN TIẾP mới coi là chết.
      this.boNho = { ...this.boNho, trangThai: "tam-dung", demKhongNghe: 0 };
      this.thamDoCuoi = null;
      this.lyDo = "Tạm dừng có chủ ý (đang đổi model) — không tự khởi động lại.";
      return this.anhChup();
    }

    const td = await this.d.thamDo();
    this.thamDoCuoi = td;
    const cu = this.boNho;
    const { boNho, hanhDong } = quyetDinhNhip(cu.trangThai === "tam-dung" ? { ...cu, trangThai: "chua-kiem" } : cu, td, bayGio, cfg);
    this.boNho = boNho;

    switch (hanhDong) {
      case "xong-khoi-dong": {
        const giay = cu.dangKhoiDongTu !== null ? Math.round((bayGio - cu.dangKhoiDongTu) / 1000) : null;
        this.log.info(`llama-server ĐÃ SỐNG LẠI${giay !== null ? ` sau ${giay} s` : ""}.`);
        this.nhaKhoaNeuGiu();
        break;
      }
      case "het-gio-khoi-dong":
        this.log.error(`lượt khởi động không sống lại trong ${Math.round(cfg.khoiDongHetGioMs / 1000)} s (thăm dò cuối: ${td}). Xem logs/llama-server-*.err.log.`);
        this.nhaKhoaNeuGiu();
        break;
      case "thu-khoi-dong":
        this.thuKhoiDong(bayGio);
        break;
      default:
        break;
    }
    this.capNhatLyDo(td);
    return this.anhChup();
  }

  private thuKhoiDong(bayGio: number): void {
    const cfg = this.d.cfg;
    const k = thuGiuKhoa(cfg.duongKhoa, { bayGio, hetHanMs: cfg.khoaHetHanMs, pid: this.d.pid, laPidSong: this.d.laPidSong });
    if (!k.duoc) {
      // Tiến trình khác (vd :3000 khi ta là :3010) đang khởi động. KHÔNG đặt `dangKhoiDongTu`: ta
      // không sở hữu lượt đó; nhịp sau sẽ lại thấy (sống / đang nạp / vẫn khoá).
      this.boNho = { ...this.boNho, trangThai: "dang-khoi-dong-lai" };
      this.nguoiKhoiDong = "tien-trinh-khac";
      this.lyDo = `Tiến trình khác${k.chu ? ` (PID ${k.chu.pid})` : ""} đang khởi động lại llama-server.`;
      return;
    }

    // ★ Đếm trần DƯỚI KHOÁ (xem docblock `quyetDinhNhip`).
    const lichSu = docLichSuKhoiDong(cfg.duongLichSu);
    if (demTrongCuaSo(lichSu, bayGio, cfg.cuaSoMs) >= cfg.toiDaKhoiDong) {
      nhaKhoa(cfg.duongKhoa, k.token);
      this.boNho = { ...this.boNho, trangThai: "bo-cuoc", boCuoc: true };
      this.log.error(
        `BỎ CUỘC — đã khởi động ${cfg.toiDaKhoiDong} lần trong ${Math.round(cfg.cuaSoMs / 60_000)} phút mà llama-server vẫn chết. ` +
          `Dừng thử để không lặp nạp 21 GB vô hạn. Xem logs/llama-server-*.err.log rồi chạy tay scripts/ai/start-llama-server.ps1.`,
      );
      return;
    }

    ghiLichSuKhoiDong(cfg.duongLichSu, [...lichSu, bayGio]);
    this.tokenKhoa = k.token;
    this.soLanKhoiDong++;
    this.lanKhoiDongCuoi = bayGio;
    this.nguoiKhoiDong = "tien-trinh-nay";
    const doi = ++this.doiKhoiDong;
    try {
      this.d.khoiDong((code, loi) => this.khiKichBanKetThuc(doi, code, loi));
      this.boNho = { ...this.boNho, trangThai: "dang-khoi-dong-lai", dangKhoiDongTu: bayGio, demKhongNghe: 0 };
      this.log.warn(`llama-server KHÔNG ai nghe cổng ${cfg.soLanChetLienTiep} nhịp liền ⇒ chạy ${cfg.duongKichBan} (lần ${this.soLanKhoiDong}).`);
    } catch (e: any) {
      this.nhaKhoaNeuGiu();
      this.boNho = { ...this.boNho, trangThai: "chet", dangKhoiDongTu: null };
      this.lyDo = `Không chạy được kịch bản khởi động: ${String(e?.message ?? e).slice(0, 200)}`;
      this.log.error(this.lyDo);
    }
  }

  /** Kịch bản thoát. Mã 0 = `/health` đã xanh — nhịp kế sẽ thấy `song`. Mã khác ⇒ đóng cửa sổ sớm. */
  private khiKichBanKetThuc(doi: number, code: number | null, loi?: Error): void {
    if (doi !== this.doiKhoiDong || this.boNho.dangKhoiDongTu === null) return;
    if (!loi && code === 0) return;
    this.nhaKhoaNeuGiu();
    this.boNho = { ...this.boNho, trangThai: "chet", dangKhoiDongTu: null, demKhongNghe: Math.max(0, this.d.cfg.soLanChetLienTiep - 1) };
    this.lyDo = loi
      ? `Không chạy được PowerShell: ${String(loi.message).slice(0, 200)}`
      : `Kịch bản khởi động thoát mã ${code} (2 = cấu hình .env, 3 = cổng bị tiến trình khác chiếm, 4 = llama-server thoát sớm, 5 = quá giờ chờ).`;
    this.log.error(this.lyDo);
  }

  private capNhatLyDo(td: KetQuaThamDo): void {
    const s = this.boNho.trangThai;
    if (s === "song") this.lyDo = "llama-server trả lời /health 200.";
    else if (s === "dang-nap") this.lyDo = td === "dang-nap" ? "llama-server đang nạp model (503 Loading)." : "Có tiến trình giữ cổng nhưng chưa trả lời /health — đang nạp hoặc treo.";
    else if (s === "dang-khoi-dong-lai" && this.nguoiKhoiDong === "tien-trinh-nay")
      this.lyDo = `Đang khởi động lại llama-server (lần ${this.soLanKhoiDong}; ${demTrongCuaSo(docLichSuKhoiDong(this.d.cfg.duongLichSu), this.d.bayGio(), this.d.cfg.cuaSoMs)}/${this.d.cfg.toiDaKhoiDong} trong ${Math.round(this.d.cfg.cuaSoMs / 60_000)} phút).`;
    else if (s === "bo-cuoc")
      this.lyDo = `Đã khởi động ${this.d.cfg.toiDaKhoiDong} lần trong ${Math.round(this.d.cfg.cuaSoMs / 60_000)} phút mà vẫn chết — DỪNG thử. Cần người xem log.`;
    else if (s === "chet" && !/^Không chạy được|^Kịch bản khởi động thoát/.test(this.lyDo)) this.lyDo = "Không có tiến trình nào nghe cổng llama-server.";
    else if (s === "chua-kiem") this.lyDo = "Một nhịp không ai nghe cổng — chờ nhịp thứ hai để xác nhận.";
  }
}

// ─── Đơn thể của tiến trình ────────────────────────────────────────────────────────────────────

let dangChay: GiamSatLlamaServer | null = null;

/**
 * Khởi chạy ở boot (idempotent). Trả `null` khi cấu hình tắt / không phải Windows (kịch bản là
 * PowerShell + `Get-NetTCPConnection`). Gọi từ `_core/index.ts`, KHÔNG ở tiến trình edge.
 */
export function khoiChayGiamSatLlamaServer(env: NodeJS.ProcessEnv = process.env): GiamSatLlamaServer | null {
  if (dangChay) return dangChay;
  const cfg = docCauHinhGiamSat(env);
  if (!cfg.bat) {
    LOG_MAC_DINH.info(`không chạy — ${cfg.lyDoTat}`);
    return null;
  }
  if (process.platform !== "win32") {
    LOG_MAC_DINH.info("không chạy — kịch bản khởi động là PowerShell/Windows (start-llama-server.ps1).");
    return null;
  }
  dangChay = new GiamSatLlamaServer({
    cfg,
    bayGio: () => Date.now(),
    thamDo: () => thamDoCong(cfg.url, cfg.thamDoHetGioMs),
    khoiDong: (khiKetThuc) => {
      khoiDongTachRoi(cfg.duongKichBan, { khiKetThuc });
    },
  });
  dangChay.batDau();
  LOG_MAC_DINH.info(
    `bật — nhịp ${cfg.nhipMs / 1000} s, tối đa ${cfg.toiDaKhoiDong} lần / ${Math.round(cfg.cuaSoMs / 60_000)} phút, tệp tạm dừng ${cfg.duongTamDung}.`,
  );
  return dangChay;
}

export function dungGiamSatLlamaServer(): void {
  dangChay?.dung();
  dangChay = null;
}

export function giamSatDangChay(): GiamSatLlamaServer | null {
  return dangChay;
}

/** Ảnh chụp cho health/UI — LUÔN có giá trị (tắt thì nói vì sao tắt). */
export function layAnhChupGiamSat(env: NodeJS.ProcessEnv = process.env): AnhChupGiamSat {
  if (dangChay) return dangChay.anhChup();
  const cfg = docCauHinhGiamSat(env);
  return {
    trangThai: "tat",
    thamDoCuoi: null,
    lanKiemCuoi: null,
    soLanKhoiDong: 0,
    soLanTrongCuaSo: 0,
    toiDaKhoiDong: cfg.toiDaKhoiDong,
    cuaSoPhut: Math.round(cfg.cuaSoMs / 60_000),
    lanKhoiDongCuoi: null,
    nguoiKhoiDong: null,
    lyDo: cfg.lyDoTat ?? (process.platform !== "win32" ? "Không phải Windows — kịch bản khởi động là PowerShell." : "Giám sát chưa được khởi chạy trong tiến trình này."),
  };
}

// ─── Cửa FAIL-CLOSED ───────────────────────────────────────────────────────────────────────────

export type LyDoKetThucCho = "song" | "het-han" | "bo-cuoc" | "giam-sat-tat" | "huy";

export interface KetQuaCho {
  song: boolean;
  lyDo: LyDoKetThucCho;
  daChoMs: number;
  trangThai: TrangThaiGiamSat;
}

/**
 * Chờ (CÓ TRẦN) cho llama-server sống lại. Không bao giờ ném.
 *   • giám sát TẮT bằng cờ ⇒ trả NGAY: không ai dựng lại, chờ chỉ là treo người dùng thêm 120 s.
 *   • giám sát của tiến trình này đã `bo-cuoc` ⇒ trả NGAY vì cùng lý do.
 *   • còn lại ⇒ thăm dò mỗi `nhipMs` (2 s) tới `hanMs` (mặc định 120 s, `LLAMA_SERVER_DOWN_WAIT_MS`).
 * ⚠ Tiến trình KHÔNG chạy giám sát (worker) vẫn chờ: giám sát ở tiến trình api cùng máy sẽ dựng lại.
 */
export async function choLlamaServerHoiPhuc(o: {
  thamDoKhoe: () => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  hanMs?: number;
  nhipMs?: number;
  bayGio?: () => number;
  ngu?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<KetQuaCho> {
  const env = o.env ?? process.env;
  const bayGio = o.bayGio ?? (() => Date.now());
  const ngu = o.ngu ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const hanMs = o.hanMs ?? so(env, "LLAMA_SERVER_DOWN_WAIT_MS", 120_000, 0);
  const nhipMs = o.nhipMs ?? so(env, "LLAMA_SERVER_DOWN_POLL_MS", 2000);
  const batDau = bayGio();
  const trangThai = (): TrangThaiGiamSat => (dangChay ? dangChay.anhChup().trangThai : docCauHinhGiamSat(env).bat ? "chua-kiem" : "tat");
  const ket = (song: boolean, lyDo: LyDoKetThucCho): KetQuaCho => ({ song, lyDo, daChoMs: bayGio() - batDau, trangThai: trangThai() });

  if (o.signal?.aborted) return ket(false, "huy");
  if (!docCauHinhGiamSat(env).bat) return ket(false, "giam-sat-tat");
  // Đánh thức giám sát ngay thay vì đợi nhịp 15 s kế tiếp.
  if (dangChay) void dangChay.kiem().catch(() => {});

  const han = batDau + hanMs;
  while (bayGio() < han) {
    if (o.signal?.aborted) return ket(false, "huy");
    if (trangThai() === "bo-cuoc") return ket(false, "bo-cuoc");
    await ngu(Math.max(1, Math.min(nhipMs, han - bayGio())));
    if (o.signal?.aborted) return ket(false, "huy");
    if (await o.thamDoKhoe().catch(() => false)) return ket(true, "song");
  }
  return ket(false, trangThai() === "bo-cuoc" ? "bo-cuoc" : "het-han");
}

/**
 * Lỗi của cửa fail-closed. `code` để máy đọc (cùng khuôn `LoiToolCallKhongHoTro.code`), thông điệp
 * tiếng Việt nói THẬT: model đang khởi động lại / không khởi động được — và KHÔNG nạp vào tiến trình.
 */
export class LoiLlamaServerChet extends Error {
  readonly code = "LLAMA_SERVER_DOWN" as const;
  constructor(
    readonly chiTiet: {
      modelId: string;
      viTri: string;
      lyDo: LyDoKetThucCho | "khong-cho";
      daChoMs: number;
      trangThai: TrangThaiGiamSat;
    },
  ) {
    const giay = Math.round(chiTiet.daChoMs / 1000);
    const khongNap =
      `KHÔNG nạp model vào tiến trình ứng dụng (đó sẽ là BẢN THỨ HAI ~21 GB tranh VRAM với llama-server ` +
      `ngay khi nó được dựng lại).`;
    let cau: string;
    switch (chiTiet.lyDo) {
      case "bo-cuoc":
        cau = `llama-server (model "${chiTiet.modelId}") không khởi động được — bộ giám sát đã thử hết số lần cho phép và DỪNG thử. ${khongNap} Xem logs/llama-server-*.err.log rồi chạy tay scripts/ai/start-llama-server.ps1.`;
        break;
      case "giam-sat-tat":
        cau = `llama-server (model "${chiTiet.modelId}") không trả lời và bộ giám sát tự khởi động lại đang TẮT. ${khongNap} Chạy scripts/ai/start-llama-server.ps1 rồi thử lại.`;
        break;
      case "huy":
        cau = `Đã huỷ trong lúc chờ llama-server (model "${chiTiet.modelId}") khởi động lại. ${khongNap}`;
        break;
      case "khong-cho":
        cau = `llama-server (model "${chiTiet.modelId}") không trả lời (giám sát: ${chiTiet.trangThai}) — model đang khởi động lại hoặc không khởi động được. ${khongNap} Thử lại sau ít phút.`;
        break;
      default:
        cau = `Model "${chiTiet.modelId}" đang khởi động lại trên llama-server nhưng chưa sẵn sàng sau ${giay} s (giám sát: ${chiTiet.trangThai}). ${khongNap} Thử lại sau ít phút.`;
    }
    super(`[aiGgufEngine] LLAMA_SERVER_DOWN (${chiTiet.viTri}): ${cau}`);
    this.name = "LoiLlamaServerChet";
  }
}
