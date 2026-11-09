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

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "es2022", module: "esnext", moduleResolution: "bundler", lib: ["es2022", "dom"], strict: true, noEmit: true,
    skipLibCheck: true, types: [], noErrorTruncation: true,
  },
  files: ["code.ts"],
});

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

export async function bienDichMa(khoi: KhoiMaKiem, tranMs: number, signal?: AbortSignal, opt: { cwdRepo?: string } = {}): Promise<KetQuaBienDichMa> {
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
