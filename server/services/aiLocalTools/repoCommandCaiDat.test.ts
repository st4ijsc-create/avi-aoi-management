/**
 * ★★★ Đợt 3c (2026-10-17) — KHUÔN LỆNH **CÀI PHỤ THUỘC** OFFLINE trong danh sách trắng.
 *
 * Bốn câu hỏi, mỗi khối một câu — và mỗi câu có CHIỀU DƯƠNG đi kèm (chống vá quá tay):
 *   §1 khuôn CỨNG: đúng argv đã khai thì qua; một đối số lạ (tên gói, cờ, tệp khác) ⇒ CMD_NOT_ALLOWED.
 *   §2 npm: `--ignore-scripts` CÓ MẶT mặc định; chỉ một khai báo dự án CÓ LÝ DO mới gỡ được.
 *   §3 nguồn offline: AI_NPM_REGISTRY / AI_PIP_FIND_LINKS / AI_NUGET_SOURCE áp đúng chỗ; cấu hình méo ⇒ TỪ CHỐI.
 *   §4 tu-dong KHÔNG BAO GIỜ tự chạy lệnh cài (tập kiểm chứng + chốt cấu trúc `nhom`).
 *   §5 thông điệp "không mạng" chỉ đúng cách cấu hình nguồn offline.
 *   §6 thẻ duyệt nói thật: cảnh báo cài-đặt + argv THẬT (có/không `--ignore-scripts`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const proposeActionMock = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeActionMock(...a),
}));

import "./index";
import {
  BIEN_NGUON_NPM,
  BIEN_NGUON_NUGET,
  BIEN_NGUON_PIP,
  DANH_SACH_TRANG,
  HAN_GIO_TOI_DA_KIEM_TRA_MS,
  HAN_GIO_TOI_DA_MS,
  MA_TU_CHOI_LENH,
  goiYKhiCaiLoiMang,
  phanQuyetLenh,
  tachArgv,
} from "./repoCommandSandbox";
import { runCommandTool } from "./writeHandlers/repoCommand";
import { NHAN_KIEM_CHUNG, laLenhKiemChung } from "../aiCodingVerify";
import { TEN_TEP_CAU_HINH_CHAY } from "../ai/chayUngDung/cauHinhChayDuAn";

const BIEN = [BIEN_NGUON_NPM, BIEN_NGUON_PIP, BIEN_NGUON_NUGET, "AI_CODING_AUTOLOOP"] as const;
const luuEnv: Record<string, string | undefined> = {};
let goc = "";

function pq(lenh: string, g = goc) {
  const t = tachArgv(lenh);
  if (!t.ok) return { ok: false as const, ma: t.ma, chiTiet: t.chiTiet };
  return phanQuyetLenh(t.argv, g);
}

function taoVenv(g: string): string {
  const p = process.platform === "win32" ? path.join(g, ".venv", "Scripts", "python.exe") : path.join(g, ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "");
  return p;
}

beforeEach(() => {
  for (const b of BIEN) {
    luuEnv[b] = process.env[b];
    delete process.env[b];
  }
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-cai-"));
  fs.writeFileSync(path.join(goc, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "vite" } }));
  proposeActionMock.mockReset();
});

afterEach(() => {
  for (const b of BIEN) {
    if (luuEnv[b] === undefined) delete process.env[b];
    else process.env[b] = luuEnv[b];
  }
  fs.rmSync(goc, { recursive: true, force: true });
});

const CAI = () => DANH_SACH_TRANG.filter((m) => m.nhom === "cai-dat");

describe("§0 — bảng: nhóm cài-đặt có mặt, đúng dân số, đúng trần giờ", () => {
  it("★★★ đúng SÁU khuôn cài-đặt, và chúng đúng là sáu khuôn đã khai", () => {
    expect(CAI().map((m) => m.nhan).sort()).toEqual(
      [
        "dotnet restore",
        "dotnet restore <đường-dẫn>",
        "npm ci",
        "npm install",
        "pip install -r requirements.txt",
        "python -m venv .venv",
      ].sort(),
    );
  });

  it("★★ MỌI mục khai `nhom`; nhóm hỏi-kiểm GIỮ trần cũ ≤ 300 s, chỉ nhóm cài-đặt được tới trần hệ 10 phút", () => {
    for (const m of DANH_SACH_TRANG) {
      expect(["hoi-kiem", "cai-dat"], m.nhan).toContain(m.nhom);
      if (m.nhom === "hoi-kiem") expect(m.hanGioMs, m.nhan).toBeLessThanOrEqual(HAN_GIO_TOI_DA_KIEM_TRA_MS);
      expect(m.hanGioMs, m.nhan).toBeLessThanOrEqual(HAN_GIO_TOI_DA_MS);
    }
    expect(HAN_GIO_TOI_DA_MS).toBe(600_000);
    expect(CAI().some((m) => m.hanGioMs > HAN_GIO_TOI_DA_KIEM_TRA_MS), "lệnh cài cần trần dài hơn lệnh kiểm").toBe(true);
  });

  it("★★ lệnh cài KHÔNG ghi đè mã nguồn (ghiDia:false) nhưng SINH sản phẩm (node_modules/.venv/obj)", () => {
    for (const m of CAI()) {
      expect(m.ghiDia, m.nhan).toBe(false);
      expect(m.sinhSanPhamDung, m.nhan).toBe(true);
    }
  });
});

describe("§1 — khuôn CỨNG: đối số lạ ⇒ CMD_NOT_ALLOWED", () => {
  it.each([
    ["npm install lodash"],
    ["npm install --save lodash"],
    ["npm i"],
    ["npm ci --foo"],
    ["npm install --ignore-scripts=false"],
    ["pip install requests"],
    ["pip install -r other.txt"],
    ["pip install -r requirements.txt --index-url x"],
    ["python -m venv other"],
    ["python -m venv .venv --system-site-packages"],
    ["dotnet restore a b"],
    ["dotnet restore --source x"],
  ])("★★★ %s ⇒ bị từ chối, không phân giải ra argv nào", (lenh) => {
    const r = pq(lenh);
    expect(r.ok).toBe(false);
    if (!r.ok) expect([MA_TU_CHOI_LENH.CMD_NOT_ALLOWED, MA_TU_CHOI_LENH.CMD_METACHAR, MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED]).toContain(r.ma);
  });

  it("★★ `dotnet restore <đường>` đi qua hộp cát đường của pha A (`..` ⇒ CMD_ARG_PATH_REJECTED)", () => {
    const r = pq("dotnet restore ../ngoai");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
  });

  it("★★ CHỐNG VÁ QUÁ TAY — sáu khuôn hợp lệ phân giải ra argv THẬT", () => {
    taoVenv(goc);
    fs.writeFileSync(path.join(goc, "requirements.txt"), "flask\n");
    for (const lenh of ["npm ci", "npm install", "python -m venv .venv", "pip install -r requirements.txt", "dotnet restore", "dotnet restore src/App.csproj"]) {
      const r = pq(lenh);
      expect(r.ok, `${lenh}: ${!r.ok ? r.ma + " " + r.chiTiet : ""}`).toBe(true);
    }
  });

  it("★★ lệnh npm cài trong gốc KHÔNG có package.json ⇒ từ chối (npm sẽ leo lên dự án CHA)", () => {
    fs.rmSync(path.join(goc, "package.json"));
    const r = pq("npm ci");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_GOC_THIEU_PACKAGE_JSON);
  });
});

describe("§2 — npm: `--ignore-scripts` MẶC ĐỊNH; chỉ khai báo dự án CÓ LÝ DO mới gỡ", () => {
  it("★★★ npm ci / npm install mang `--ignore-scripts` khi dự án không khai gì", () => {
    for (const lenh of ["npm ci", "npm install"]) {
      const r = pq(lenh);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.spec.args, lenh).toContain("--ignore-scripts");
    }
  });

  it("★★★ khai `npmChoPhepScriptCai` với lý do ⇒ BỎ `--ignore-scripts` (mở có chủ ý)", () => {
    fs.writeFileSync(
      path.join(goc, TEN_TEP_CAU_HINH_CHAY),
      JSON.stringify({ npmChoPhepScriptCai: { bat: true, lyDo: "esbuild cần postinstall tải nhị phân nền tảng" } }),
    );
    const r = pq("npm ci");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.args).not.toContain("--ignore-scripts");
  });

  it.each([
    [{ npmChoPhepScriptCai: { bat: true } }],
    [{ npmChoPhepScriptCai: { bat: true, lyDo: "  " } }],
    [{ npmChoPhepScriptCai: true }],
    [{ npmChoPhepScriptCai: { bat: "true", lyDo: "vì cần thiết lắm" } }],
  ])("★★★ khai MÉO/thiếu lý do %j ⇒ VẪN `--ignore-scripts` (fail-closed)", (cfg) => {
    fs.writeFileSync(path.join(goc, TEN_TEP_CAU_HINH_CHAY), JSON.stringify(cfg));
    const r = pq("npm install");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.args).toContain("--ignore-scripts");
  });

  it("★ tệp cấu hình KHÔNG phải JSON ⇒ VẪN `--ignore-scripts`", () => {
    fs.writeFileSync(path.join(goc, TEN_TEP_CAU_HINH_CHAY), "{ npmChoPhepScriptCai: ");
    const r = pq("npm ci");
    expect(r.ok && r.spec.args.includes("--ignore-scripts")).toBe(true);
  });
});

describe("§3 — nguồn gói OFFLINE cấu hình được", () => {
  it("★★★ npm: VẮNG AI_NPM_REGISTRY ⇒ `--prefer-offline`, KHÔNG `--registry`, và môi trường giữ offline (chỉ cache)", () => {
    const r = pq("npm ci");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.args).toContain("--prefer-offline");
    expect(r.spec.args).not.toContain("--registry");
    expect(r.spec.envThem?.npm_config_offline ?? "true").toBe("true");
  });

  it("★★★ npm: CÓ AI_NPM_REGISTRY ⇒ `--registry <url>` đứng cạnh nhau + mở offline cho ĐÚNG registry ấy", () => {
    process.env[BIEN_NGUON_NPM] = "http://verdaccio.local:4873/";
    const r = pq("npm install");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = r.spec.args.indexOf("--registry");
    expect(i).toBeGreaterThan(0);
    expect(r.spec.args[i + 1]).toBe("http://verdaccio.local:4873/");
    expect(r.spec.envThem?.npm_config_offline).toBe("false");
  });

  it.each([["ftp://x"], ["khong-phai-url"], ["--registry=http://evil"], ["http://user:pass@reg.local/"]])(
    "★★★ AI_NPM_REGISTRY méo %s ⇒ CMD_THIEU_DIEU_KIEN (không lặng lẽ rơi về mạng công cộng)",
    (v) => {
      process.env[BIEN_NGUON_NPM] = v;
      const r = pq("npm ci");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
        expect(r.chiTiet).toContain(BIEN_NGUON_NPM);
      }
    },
  );

  it("★★★ pip: venv VẮNG ⇒ CMD_THIEU_DIEU_KIEN chỉ đích danh `python -m venv .venv`", () => {
    fs.writeFileSync(path.join(goc, "requirements.txt"), "flask\n");
    const r = pq("pip install -r requirements.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
      expect(r.chiTiet).toContain("python -m venv .venv");
    }
  });

  it("★★ pip: requirements.txt VẮNG ⇒ CMD_THIEU_DIEU_KIEN", () => {
    taoVenv(goc);
    const r = pq("pip install -r requirements.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
  });

  it("★★★ pip: chạy bằng python CỦA VENV dự án (không python hệ thống) — cài vào `.venv`", () => {
    const py = taoVenv(goc);
    fs.writeFileSync(path.join(goc, "requirements.txt"), "flask\n");
    const r = pq("pip install -r requirements.txt");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(path.resolve(r.spec.file)).toBe(path.resolve(py));
    expect(r.spec.args.slice(0, 5)).toEqual(["-m", "pip", "install", "-r", "requirements.txt"]);
    expect(r.spec.args).not.toContain("--no-index");
  });

  it("★★★ pip: AI_PIP_FIND_LINKS = thư mục wheel ⇒ `--no-index --find-links <thư mục>`", () => {
    taoVenv(goc);
    fs.writeFileSync(path.join(goc, "requirements.txt"), "flask\n");
    const kho = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-wheel-"));
    try {
      process.env[BIEN_NGUON_PIP] = kho;
      const r = pq("pip install -r requirements.txt");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.spec.args).toContain("--no-index");
      const i = r.spec.args.indexOf("--find-links");
      expect(r.spec.args[i + 1]).toBe(kho);
    } finally {
      fs.rmSync(kho, { recursive: true, force: true });
    }
  });

  it.each([["wheels"], ["Z:\\khong\\ton\\tai\\ai7"], ["-r"]])("★★ AI_PIP_FIND_LINKS méo %s ⇒ CMD_THIEU_DIEU_KIEN", (v) => {
    taoVenv(goc);
    fs.writeFileSync(path.join(goc, "requirements.txt"), "flask\n");
    process.env[BIEN_NGUON_PIP] = v;
    const r = pq("pip install -r requirements.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe(MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
  });

  /**
   * ★ CẬP NHẬT CÓ LỜI KHAI (2026-10-19): offline (mặc định) không còn "argv trần" (= cấu hình NuGet mặc định ⇒
   *   nuget.org): nguồn DUY NHẤT = AI_NUGET_SOURCE, vắng ⇒ 0 nguồn (chỉ cache máy), kèm cấu hình offline của máy chủ.
   *   Lưới đầy đủ: `repoCommandDotnetRestoreOffline.test.ts` §2.
   */
  it("★★★ dotnet restore: AI_NUGET_SOURCE ⇒ `--source <nguồn>` (nguồn duy nhất); vắng ⇒ 0 nguồn (chỉ cache máy)", () => {
    let r = pq("dotnet restore");
    expect(r.ok && r.spec.args.slice(0, 1)).toEqual(["restore"]);
    expect(r.ok && r.spec.args).toContain("-p:RestoreSources=");
    expect(r.ok && r.spec.args).not.toContain("--source");
    const sau = (a: readonly string[], k: string) => a[a.indexOf(k) + 1];
    const feed = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-nuget-"));
    try {
      process.env[BIEN_NGUON_NUGET] = feed;
      r = pq("dotnet restore src/App.csproj");
      expect(r.ok && r.spec.args.slice(0, 2)).toEqual(["restore", "src/App.csproj"]);
      expect(r.ok && sau(r.spec.args, "--source")).toBe(feed);
      process.env[BIEN_NGUON_NUGET] = "http://nuget.local/v3/index.json";
      r = pq("dotnet restore");
      expect(r.ok && sau(r.spec.args, "--source")).toBe("http://nuget.local/v3/index.json");
      process.env[BIEN_NGUON_NUGET] = "nuget-tuong-doi";
      r = pq("dotnet restore");
      expect(!r.ok && r.ma).toBe(MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
    } finally {
      fs.rmSync(feed, { recursive: true, force: true });
    }
  });

  it("★ python -m venv .venv ⇒ đúng argv `-m venv .venv`", () => {
    const r = pq("python -m venv .venv");
    expect(r.ok && r.spec.args).toEqual(["-m", "venv", ".venv"]);
  });
});

describe("§4 — tu-dong KHÔNG BAO GIỜ tự chạy lệnh cài", () => {
  it("★★★ không mục cài-đặt nào nằm trong tập KIỂM CHỨNG", () => {
    for (const m of CAI()) expect(NHAN_KIEM_CHUNG.has(m.nhan), m.nhan).toBe(false);
  });

  it("★★★ `laLenhKiemChung` từ chối cả sáu lệnh cài (AUTOLOOP bật vẫn từ chối)", () => {
    process.env.AI_CODING_AUTOLOOP = "1";
    taoVenv(goc);
    fs.writeFileSync(path.join(goc, "requirements.txt"), "x\n");
    for (const lenh of ["npm ci", "npm install", "python -m venv .venv", "pip install -r requirements.txt", "dotnet restore", "dotnet restore a.csproj"]) {
      expect(laLenhKiemChung(lenh, goc).ok, lenh).toBe(false);
    }
  });

  it("★★★ CHỐT CẤU TRÚC — kể cả khi ai đó lỡ thêm `npm ci` vào tập kiểm chứng, nhóm cài-đặt vẫn bị từ chối", () => {
    const tap = NHAN_KIEM_CHUNG as Set<string>;
    tap.add("npm ci");
    try {
      const r = laLenhKiemChung("npm ci", goc);
      expect(r.ok).toBe(false);
    } finally {
      tap.delete("npm ci");
    }
  });

  it("★★ CHỐNG VÁ QUÁ TAY — lệnh kiểm chứng vẫn qua `laLenhKiemChung`", () => {
    expect(laLenhKiemChung("node --test tests", goc).ok).toBe(true);
  });
});

describe("§5 — không mạng ⇒ thông điệp chỉ cách cấu hình nguồn offline", () => {
  it("★★★ npm ENOTCACHED/ENOTFOUND ⇒ nhắc AI_NPM_REGISTRY", () => {
    const g = goiYKhiCaiLoiMang("npm ci", "npm error code ENOTCACHED\nnpm error request to https://registry.npmjs.org/x failed", 1);
    expect(g).toContain(BIEN_NGUON_NPM);
    expect(goiYKhiCaiLoiMang("npm install", "getaddrinfo ENOTFOUND registry.npmjs.org", 1)).toContain(BIEN_NGUON_NPM);
  });

  it("★★★ pip không với tới chỉ mục ⇒ nhắc AI_PIP_FIND_LINKS", () => {
    const g = goiYKhiCaiLoiMang("pip install -r requirements.txt", "ERROR: Could not find a version that satisfies the requirement flask\nERROR: No matching distribution found for flask", 1);
    expect(g).toContain(BIEN_NGUON_PIP);
  });

  it("★★★ NuGet NU1301 ⇒ nhắc AI_NUGET_SOURCE", () => {
    const g = goiYKhiCaiLoiMang("dotnet restore", "error NU1301: Unable to load the service index for source https://api.nuget.org/v3/index.json.", 1);
    expect(g).toContain(BIEN_NGUON_NUGET);
  });

  it("★★ CHỐNG BÁO GIẢ — mã thoát 0, hoặc lỗi KHÔNG phải mạng ⇒ null", () => {
    expect(goiYKhiCaiLoiMang("npm ci", "ENOTCACHED", 0)).toBeNull();
    expect(goiYKhiCaiLoiMang("npm ci", "npm error code EUSAGE\nThe `npm ci` command can only install with an existing package-lock.json", 1)).toBeNull();
    expect(goiYKhiCaiLoiMang("npm run check", "ENOTFOUND", 1), "lệnh không phải lệnh cài ⇒ không gợi ý").toBeNull();
  });
});

describe("§6 — thẻ duyệt (preview) nói thật về lệnh cài", () => {
  const ctx = (g: string) => ({ user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const, projectRoot: g });

  it("★★★ cảnh báo CÀI ĐẶT đứng ĐẦU, nói rõ: không tự chạy, script cài bị tắt, nguồn gói", async () => {
    const p = await runCommandTool.preview!({ command: "npm ci" }, ctx(goc) as any);
    const dau = p.warnings[0] ?? "";
    expect(dau).toMatch(/CÀI/);
    expect(dau).toMatch(/--ignore-scripts/);
    expect(dau).toMatch(/cache/i);
    const argv = p.changes.find((c) => c.field === "argv")?.newValue as string;
    expect(argv).toContain("--ignore-scripts");
  });

  it("★★ script cài được MỞ ⇒ thẻ duyệt nêu LÝ DO dự án đã khai", async () => {
    fs.writeFileSync(
      path.join(goc, TEN_TEP_CAU_HINH_CHAY),
      JSON.stringify({ npmChoPhepScriptCai: { bat: true, lyDo: "esbuild cần postinstall" } }),
    );
    const p = await runCommandTool.preview!({ command: "npm install" }, ctx(goc) as any);
    expect(p.warnings[0]).toContain("esbuild cần postinstall");
  });

  it("★★ lệnh kiểm KHÔNG mang cảnh báo cài (cảnh báo thừa dạy người ta bấm qua)", async () => {
    const p = await runCommandTool.preview!({ command: "git status" }, ctx(goc) as any);
    expect(p.warnings.some((w) => /CÀI ĐẶT/.test(w))).toBe(false);
  });
});
