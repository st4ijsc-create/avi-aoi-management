/**
 * ★ T1 — BIÊN DỊCH CÁCH LY một khối mã do model viết (C# · TypeScript · Python). CHỈ BIÊN DỊCH / KIỂM CÚ PHÁP:
 *   cs → `dotnet build` (thư viện, không restore gói)   ts → `tsc --noEmit`   py → `python -I -m py_compile`
 * KHÔNG tiến trình nào THỰC THI mã của model (không `dotnet run`, không `node`/`python` chạy tệp).
 *
 * Cách ly: thư mục tạm TÊN NGẪU NHIÊN dưới thư mục tạm của HĐH (từ chối nếu nằm trong cây repo), xoá trong `finally`; môi trường con từ
 * DANH SÁCH TRẮNG TÊN (`moiTruongDaLoc` — không khoá, không DATABASE_URL, không *_KEY_FILE) + DB chết; không mạng (không restore gói,
 * telemetry tắt); hết giờ ⇒ giết CẢ CÂY (`gietCayTienTrinh`); đầu ra chặn ở 64 KB tại chỗ NHẬN. Không DB, không tệp repo.
 *
 * Lỗi do MÔI TRƯỜNG (thiếu gói NuGet / @types) KHÔNG phải lỗi của model: bị gạt ra; còn rỗng mà có lỗi môi trường ⇒ "khong-kiem-duoc".
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gietCayTienTrinh, moiTruongDaLoc } from "../../aiLocalTools/repoCommandSandbox";
import type { ChanDoanMa, KetQuaBienDichMa, KhoiMaKiem, NgonNguKiem } from "./tuKiemMa";

const TRAN_DAU_RA = 64 * 1024;
const AN_HAN_SAU_GIET_MS = 3_000;

/** DB chết: mã của model không được chạm CSDL thật dù (không thể) thực thi. */
const ENV_DB_CHET: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://tukiem:x@127.0.0.1:9/aoi_management",
  TEST_DATABASE_URL: "postgresql://tukiem:x@127.0.0.1:9/aoi_management_test",
};

export function envChoBienDichMa(nguon: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...moiTruongDaLoc(nguon),
    ...ENV_DB_CHET,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    DOTNET_GENERATE_ASPNET_CERTIFICATE: "false",
    NUGET_XMLDOC_MODE: "skip",
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Library</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>disable</Nullable>
    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <NuGetAudit>false</NuGetAudit>
  </PropertyGroup>
</Project>
`;

/**
 * `noResolve: true` — tsc KHÔNG đi theo `/// <reference path=…>` hay `import` sang tệp khác: chẩn đoán trả cho model chỉ nói về `code.ts`.
 * (kiem-dinh đo được: không có cờ này, tên hằng trong một tệp .ts ngoài thư mục tạm bị lộ qua "Cannot find name …".) Import thiếu ⇒ TS2307 ⇒ bị gạt là lỗi môi trường.
 */
export const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", lib: ["es2022", "dom"], strict: true, noEmit: true,
    skipLibCheck: true, types: [], noErrorTruncation: true, noResolve: true,
  },
  files: ["code.ts"],
});

const RE_THAM_CHIEU = /\/\/\/\s*<reference\b/;
// Không đặt dấu nháy đơn/kép/ngược TRỰC TIẾP trong regex: bộ quét kiểm kê VRAM (vramAllocationSites) bóc chuỗi mà không hiểu regex, và sẽ nuốt mã phía sau (spawn thành vô hình). Dùng \x22 \x27 \x60.
const RE_DAC_TA = /\b(?:from|import|require|export)\s*\(?\s*([\x22\x27\x60])([^\x22\x27\x60\r\n]+)\1/g;
/** Đặc tả mô-đun trỏ ra NGOÀI thư mục tạm: tuyệt đối (`/`, `\`, `C:`, UNC), `file:`, `~`, hoặc có đoạn `..`. */
export function laDacTaNgoaiThuMucTam(dacTa: string): boolean {
  if (/^(?:[\\/~]|[A-Za-z]:|file:)/i.test(dacTa)) return true;
  return dacTa.split(/[\\/]/).includes("..");
}
/**
 * Chặn TRƯỚC khi biên dịch (lớp thứ hai cùng `noResolve`): mã TS có `/// <reference …>` (mọi dạng) hoặc `import` / `export … from` / `require` / `import()` tới đường
 * tuyệt đối hay ra ngoài thư mục tạm ⇒ trả lý do (không biên dịch), ngược lại null. Quét cả trong chú thích / chuỗi: thà chặn thừa còn hơn để lộ tệp máy chủ.
 */
export function phatHienThamChieuNgoai(ma: string): string | null {
  if (RE_THAM_CHIEU.test(ma)) return "tham-chieu-triple-slash";
  for (const m of ma.matchAll(RE_DAC_TA)) if (laDacTaNgoaiThuMucTam(m[2])) return "tham-chieu-ngoai-thu-muc-tam";
  return null;
}

/** Trần số lần biên dịch ĐỒNG THỜI (mỗi lần dựng tiến trình dotnet/tsc/python): mặc định 2, chỉnh bằng AI_CHAT_TU_KIEM_DONG_THOI, kẹp 1..4. */
export const DONG_THOI_MAC_DINH = 2;
export const DONG_THOI_TOI_DA = 4;
export function soKheDongThoi(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AI_CHAT_TU_KIEM_DONG_THOI);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, DONG_THOI_TOI_DA) : DONG_THOI_MAC_DINH;
}
/** Khe đồng thời có hàng đợi FIFO; chờ quá hạn hoặc bị huỷ ⇒ null (không giữ khe). `nha()` gọi nhiều lần chỉ trả khe MỘT lần. */
export class GioiHanDongThoi {
  private dang = 0;
  private readonly hang: Array<() => void> = [];
  get soDangGiu(): number {
    return this.dang;
  }
  get soDangCho(): number {
    return this.hang.length;
  }
  layKhe(toiDa: number, hanChoMs: number, signal?: AbortSignal): Promise<(() => void) | null> {
    if (signal?.aborted) return Promise.resolve(null);
    const cap = () => {
      this.dang++;
      let daNha = false;
      return () => {
        if (daNha) return;
        daNha = true;
        this.dang--;
        this.chuyen(toiDa);
      };
    };
    if (this.dang < toiDa && this.hang.length === 0) return Promise.resolve(cap());
    return new Promise((resolve) => {
      const vao = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", huy);
        resolve(cap());
      };
      const roi = () => {
        const i = this.hang.indexOf(vao);
        if (i >= 0) this.hang.splice(i, 1);
        resolve(null);
      };
      const huy = () => {
        clearTimeout(timer);
        roi();
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", huy);
        roi();
      }, Math.max(0, hanChoMs));
      signal?.addEventListener("abort", huy, { once: true });
      this.hang.push(vao);
    });
  }
  private chuyen(toiDa: number): void {
    while (this.dang < toiDa && this.hang.length > 0) this.hang.shift()!();
  }
}
const GIOI_HAN = new GioiHanDongThoi();

/** Mã lỗi do MÔI TRƯỜNG (thiếu gói / kiểu Node), không phải lỗi của model. */
const LOI_MOI_TRUONG: Record<NgonNguKiem, RegExp> = {
  cs: /^(CS0234|CS0246|CS0012|CS0400)$/,
  ts: /^(TS2307|TS2580|TS2591|TS2688|TS2792)$/,
  py: /^$/,
};

const reCs = /\((\d+),(\d+)\):\s*error\s+(CS\d+):\s*(.*?)(?:\s*\[[^\]]*\])?\s*$/;
const reTs = /\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/;

export function phanTichDotnet(log: string): ChanDoanMa[] {
  return phanTichTheoMau(log, reCs);
}
export function phanTichTsc(log: string): ChanDoanMa[] {
  return phanTichTheoMau(log, reTs);
}

function phanTichTheoMau(log: string, re: RegExp): ChanDoanMa[] {
  const thay = new Set<string>();
  const ra: ChanDoanMa[] = [];
  for (const dong of String(log ?? "").split(/\r?\n/)) {
    const m = re.exec(dong);
    if (!m) continue;
    const d: ChanDoanMa = { dong: Number(m[1]), cot: Number(m[2]), ma: m[3]!, thongDiep: m[4]!.trim().slice(0, 300) };
    const khoa = `${d.dong}:${d.cot}:${d.ma}:${d.thongDiep}`;
    if (thay.has(khoa)) continue; // dotnet in mỗi lỗi hai lần (nhiều khung)
    thay.add(khoa);
    ra.push(d);
  }
  return ra;
}

/** `python -m py_compile` in lỗi cú pháp dạng `File "x", line N` … `SyntaxError: …`. */
export function phanTichPython(log: string): ChanDoanMa[] {
  const dong = /line (\d+)/.exec(log);
  const thongDiep = [...String(log ?? "").split(/\r?\n/)].reverse().find((l) => /^\w*(Error|Exception)\b.*:/.test(l.trim()));
  if (!dong && !thongDiep) return [];
  return [{ dong: dong ? Number(dong[1]) : null, cot: null, ma: null, thongDiep: (thongDiep ?? "SyntaxError").trim().slice(0, 300) }];
}

/** Gạt lỗi môi trường; trả `{ cua: lỗi của model, moiTruong: số lỗi gạt }`. */
export function loaiLoiMoiTruong(ngonNgu: NgonNguKiem, ds: ChanDoanMa[]): { cua: ChanDoanMa[]; moiTruong: number } {
  const cua = ds.filter((d) => !(d.ma && LOI_MOI_TRUONG[ngonNgu].test(d.ma)));
  return { cua, moiTruong: ds.length - cua.length };
}

export interface KetQuaTienTrinh {
  exit: number | null;
  hetGio: boolean;
  dauRa: string;
  loi?: string;
}

/** (xuất để test hết giờ + giết cây) */
export function chay(lenh: string, args: string[], cwd: string, tranMs: number, signal?: AbortSignal): Promise<KetQuaTienTrinh> {
  return new Promise((xong) => {
    let dauRa = "";
    let hetGio = false;
    let daXong = false;
    let con: ReturnType<typeof spawn>;
    const ketThuc = (exit: number | null, loi?: string) => {
      if (daXong) return;
      daXong = true;
      clearTimeout(dongHo);
      clearTimeout(anHan);
      signal?.removeEventListener("abort", huy);
      xong({ exit, hetGio, dauRa, ...(loi ? { loi } : {}) });
    };
    let anHan: ReturnType<typeof setTimeout> | undefined;
    const giet = () => {
      try {
        gietCayTienTrinh(con?.pid);
      } catch {
        /* tiến trình đã chết */
      }
      // không chờ `close` mãi mãi: có ân hạn rồi khai là hết giờ
      anHan = setTimeout(() => ketThuc(null), AN_HAN_SAU_GIET_MS);
    };
    const dongHo = setTimeout(() => {
      hetGio = true;
      giet();
    }, tranMs);
    const huy = () => {
      hetGio = true;
      giet();
    };
    try {
      con = spawn(lenh, args, {
        cwd,
        env: envChoBienDichMa(),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (e) {
      clearTimeout(dongHo);
      xong({ exit: null, hetGio: false, dauRa: "", loi: String((e as Error)?.message ?? e) });
      return;
    }
    signal?.addEventListener("abort", huy, { once: true });
    const nhan = (b: Buffer) => {
      if (dauRa.length < TRAN_DAU_RA) dauRa += b.toString("utf8").slice(0, TRAN_DAU_RA - dauRa.length);
    };
    con.stdout?.on("data", nhan);
    con.stderr?.on("data", nhan);
    con.on("error", (e) => ketThuc(null, (e as NodeJS.ErrnoException).code === "ENOENT" ? "khong-co-cong-cu" : String(e.message)));
    con.on("close", (ma) => ketThuc(ma));
  });
}

function tscJs(): string | null {
  try {
    return createRequire(path.join(process.cwd(), "package.json")).resolve("typescript/bin/tsc");
  } catch {
    return null;
  }
}

/** Thư mục tạm có nằm trong cây repo (cwd) không — nếu có, từ chối: không ghi vào repo. */
export function namTrongCay(goc: string, dich: string): boolean {
  const rel = path.relative(path.resolve(goc), path.resolve(dich));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Tham số python: `-I` = chế độ cô lập (bỏ biến PYTHON*, bỏ site người dùng, không thêm cwd vào sys.path). */
export const ARGS_PYTHON: readonly string[] = ["-I", "-m", "py_compile", "code.py"];

export async function bienDichMa(khoi: KhoiMaKiem, tranMs: number, signal?: AbortSignal, opt: { cwdRepo?: string; gioiHan?: GioiHanDongThoi; toiDaDongThoi?: number; chayTrongKhe?: typeof bienDichTrongKhe } = {}): Promise<KetQuaBienDichMa> {
  if (khoi.ngonNgu === "ts") {
    const ngoai = phatHienThamChieuNgoai(khoi.ma);
    if (ngoai) return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: ngoai };
  }
  const t0 = Date.now();
  const nha = await (opt.gioiHan ?? GIOI_HAN).layKhe(opt.toiDaDongThoi ?? soKheDongThoi(), tranMs, signal);
  if (!nha) return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: signal?.aborted ? "huy" : "day-khe-bien-dich" };
  try {
    return await (opt.chayTrongKhe ?? bienDichTrongKhe)(khoi, Math.max(1, tranMs - (Date.now() - t0)), signal, opt);
  } finally {
    nha();
  }
}

async function bienDichTrongKhe(khoi: KhoiMaKiem, tranMs: number, signal: AbortSignal | undefined, opt: { cwdRepo?: string }): Promise<KetQuaBienDichMa> {
  const goc = os.tmpdir();
  if (namTrongCay(opt.cwdRepo ?? process.cwd(), goc)) return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "thu-muc-tam-trong-repo" };
  let dir: string;
  try {
    dir = fs.mkdtempSync(path.join(goc, "tukiem-"));
  } catch (e) {
    return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: `khong-tao-duoc-thu-muc-tam: ${String((e as Error)?.message ?? e).slice(0, 100)}` };
  }
  try {
    let r: KetQuaTienTrinh;
    let ds: (log: string) => ChanDoanMa[];
    if (khoi.ngonNgu === "cs") {
      fs.writeFileSync(path.join(dir, "p.csproj"), CSPROJ);
      fs.writeFileSync(path.join(dir, "Code.cs"), khoi.ma);
      r = await chay("dotnet", ["build", "p.csproj", "-nologo", "-v", "q", "-clp:NoSummary", "-p:UseSharedCompilation=false"], dir, tranMs, signal);
      ds = phanTichDotnet;
    } else if (khoi.ngonNgu === "ts") {
      const js = tscJs();
      if (!js) return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "khong-co-tsc" };
      fs.writeFileSync(path.join(dir, "code.ts"), khoi.ma);
      fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
      r = await chay(process.execPath, [js, "-p", "tsconfig.json", "--pretty", "false"], dir, tranMs, signal);
      ds = phanTichTsc;
    } else {
      fs.writeFileSync(path.join(dir, "code.py"), khoi.ma);
      r = await chay(process.platform === "win32" ? "python" : "python3", [...ARGS_PYTHON], dir, tranMs, signal);
      ds = phanTichPython;
    }
    if (r.hetGio) return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: "het-gio" };
    if (r.loi) return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: r.loi };
    if (r.exit === 0) return { trangThai: "ok", chanDoan: [] };
    const { cua, moiTruong } = loaiLoiMoiTruong(khoi.ngonNgu, ds(r.dauRa));
    if (cua.length > 0) return { trangThai: "loi", chanDoan: cua };
    return { trangThai: "khong-kiem-duoc", chanDoan: [], lyDo: moiTruong > 0 ? "thieu-goi-hoac-kieu-moi-truong" : "khong-phan-tich-duoc" };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* dọn best-effort; tên ngẫu nhiên nằm ngoài repo */
    }
  }
}
