/**
 * ★★★ (2026-10-19, bộ ngẫu nhiên `NN-b-agent-3`: C# 0/3) — RESTORE NuGet OFFLINE **CHỈ TỪ CACHE GÓI CỦA MÁY**.
 *
 * Đo được (sổ `ai_agent_runs`, run 585b8d5f… bài `cs-ud1-bai-do-xe`): `dotnet test Bai.csproj` ⇒ NETSDK1004 "Assets file
 * … project.assets.json not found" (argv mang `--no-restore`), `dotnet restore` ⇒ `LENH_CAN_DUYET_TAY` ở `tu-dong` ⇒
 * model "Tôi không thể chạy dotnet restore tự động" rồi BỊA `obj/project.assets.json` tới hết lượt. Bộ chấm (ngoài
 * agent) restore được ngay: xunit/Test.Sdk ĐÃ nằm trong cache `%USERPROFILE%\.nuget\packages`.
 *
 * Quyết định (rủi ro — xem khối `thamSoRestoreOffline` ở `repoCommandSandbox.ts`):
 * - `dotnet build|test` (tự chạy ở tu-dong) restore NGẦM với **0 nguồn gói**: NuGet.Config do MÁY CHỦ sinh (`<clear/>`)
 *   + thuộc tính toàn cục đè mọi nguồn dự án tự khai (csproj `RestoreSources`/`RestoreAdditionalProjectSources`,
 *   nuget.config trong dự án). Gói đã có trong cache ⇒ dựng được; gói LẠ ⇒ NU1101 trong < 1 s, không mạng.
 * - `dotnet restore` vẫn là nhóm CÀI ĐẶT (Q4 chủ dự án: "lệnh cài trong allowlist, có duyệt") — nó là đường DUY NHẤT
 *   đưa gói MỚI vào máy (từ `AI_NUGET_SOURCE`), cũng qua cấu hình offline của máy chủ (không rơi về nuget.org).
 * - `DOTNET_CHO_PHEP_RESTORE=1` (triển khai có internet) giữ NGUYÊN hành vi cũ.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BIEN_DOTNET_CHO_PHEP_RESTORE,
  BIEN_NGUON_NUGET,
  DANH_SACH_TRANG,
  moiTruongDaLoc,
  phanQuyetLenh,
  tachArgv,
} from "./repoCommandSandbox";
import { laLenhKiemChung } from "../aiCodingVerify";

const BIEN = [BIEN_NGUON_NUGET, BIEN_DOTNET_CHO_PHEP_RESTORE, "AI_CODING_AUTOLOOP"] as const;
const luuEnv: Record<string, string | undefined> = {};
let goc = "";

function pq(lenh: string, g = goc) {
  const t = tachArgv(lenh);
  if (!t.ok) throw new Error(`${t.ma}: ${t.chiTiet}`);
  return phanQuyetLenh(t.argv, g);
}
function args(lenh: string): string[] {
  const r = pq(lenh);
  expect(r.ok, `${lenh}: ${!r.ok ? `${r.ma} ${r.chiTiet}` : ""}`).toBe(true);
  return r.ok ? [...r.spec.args] : [];
}
const thuocTinh = (a: string[], ten: string) => a.find((x) => x.startsWith(`-p:${ten}=`))?.slice(`-p:${ten}=`.length);

beforeEach(() => {
  for (const b of BIEN) {
    luuEnv[b] = process.env[b];
    delete process.env[b];
  }
  goc = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-nuget-off-"));
});
afterEach(() => {
  for (const b of BIEN) {
    if (luuEnv[b] === undefined) delete process.env[b];
    else process.env[b] = luuEnv[b];
  }
  fs.rmSync(goc, { recursive: true, force: true });
});

describe("§1 — dotnet build|test: restore NGẦM chỉ từ cache máy (0 nguồn), không còn `--no-restore`", () => {
  it.each([["dotnet build Bai.csproj"], ["dotnet test Bai.csproj"]])("★★★ %s ⇒ bỏ --no-restore, mang cấu hình NuGet offline của máy chủ", (lenh) => {
    const a = args(lenh);
    expect(a.slice(0, 2)).toEqual(lenh.split(" ").slice(1));
    expect(a).not.toContain("--no-restore");
    const cfg = thuocTinh(a, "RestoreConfigFile");
    expect(cfg && path.isAbsolute(cfg)).toBe(true);
    // ⚠ cấu hình nằm NGOÀI dự án (model không ghi được) và XOÁ mọi nguồn/thư mục dự phòng
    expect(path.relative(goc, cfg!).startsWith("..")).toBe(true);
    const xml = fs.readFileSync(cfg!, "utf8");
    expect(xml).toMatch(/<packageSources>\s*<clear\s*\/>\s*<\/packageSources>/);
    expect(xml).toMatch(/<fallbackPackageFolders>\s*<clear\s*\/>\s*<\/fallbackPackageFolders>/);
    expect(xml).not.toMatch(/<add\b/);
    // thuộc tính TOÀN CỤC đè nguồn do dự án tự khai (csproj/Directory.Build.props)
    expect(thuocTinh(a, "RestoreSources")).toBe("");
    expect(thuocTinh(a, "RestoreAdditionalProjectSources")).toBe("");
    expect(thuocTinh(a, "RestoreFallbackFolders")).toBe("");
    expect(thuocTinh(a, "RestoreAdditionalProjectFallbackFolders")).toBe("");
    expect(thuocTinh(a, "NuGetAudit")).toBe("false");
  });

  it("★★★ build/test KHÔNG dùng AI_NUGET_SOURCE (đưa gói MỚI vào máy là việc của `dotnet restore` có duyệt)", () => {
    const feed = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-feed-"));
    try {
      process.env[BIEN_NGUON_NUGET] = feed;
      const a = args("dotnet test Bai.csproj");
      expect(a).not.toContain(feed);
      expect(thuocTinh(a, "RestoreSources")).toBe("");
    } finally {
      fs.rmSync(feed, { recursive: true, force: true });
    }
  });

  it("★★ DOTNET_CHO_PHEP_RESTORE=1 (có internet) ⇒ GIỮ NGUYÊN hành vi cũ: argv trần", () => {
    process.env[BIEN_DOTNET_CHO_PHEP_RESTORE] = "1";
    expect(args("dotnet build Bai.csproj")).toEqual(["build", "Bai.csproj"]);
    expect(args("dotnet test Bai.csproj")).toEqual(["test", "Bai.csproj"]);
  });

  it("★★ moTa (thẻ duyệt) khai đúng chế độ: cache máy, không nguồn mạng", () => {
    for (const nhan of ["dotnet build <đường-dẫn>", "dotnet test <đường-dẫn>"]) {
      const m = DANH_SACH_TRANG.find((x) => x.nhan === nhan)!;
      expect(m.moTa).toMatch(/cache/i);
      expect(m.moTa).not.toContain("--no-restore");
    }
  });

  it("★★★ tu-dong: dotnet test VẪN tự chạy; dotnet restore VẪN cần duyệt (Q4)", () => {
    process.env.AI_CODING_AUTOLOOP = "1";
    fs.writeFileSync(path.join(goc, "Bai.csproj"), "<Project/>");
    expect(laLenhKiemChung("dotnet test Bai.csproj", goc).ok).toBe(true);
    expect(laLenhKiemChung("dotnet restore", goc).ok).toBe(false);
    expect(laLenhKiemChung("dotnet restore Bai.csproj", goc).ok).toBe(false);
  });
});

describe("§2 — dotnet restore (nhóm cài-đặt, có duyệt): CHỈ nguồn offline do máy chủ cấu hình", () => {
  it("★★★ vắng AI_NUGET_SOURCE ⇒ chỉ cache máy (0 nguồn) — KHÔNG còn rơi về nuget.org của cấu hình mặc định", () => {
    const a = args("dotnet restore Bai.csproj");
    expect(a.slice(0, 2)).toEqual(["restore", "Bai.csproj"]);
    expect(thuocTinh(a, "RestoreConfigFile")).toBeTruthy();
    expect(thuocTinh(a, "RestoreSources")).toBe("");
    expect(a).not.toContain("--source");
  });

  it("★★★ AI_NUGET_SOURCE (thư mục feed) ⇒ `--source <feed>` + cấu hình offline (nguồn DUY NHẤT)", () => {
    const feed = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-feed-"));
    try {
      process.env[BIEN_NGUON_NUGET] = feed;
      const a = args("dotnet restore");
      expect(a[0]).toBe("restore");
      expect(a[a.indexOf("--source") + 1]).toBe(feed);
      expect(thuocTinh(a, "RestoreConfigFile")).toBeTruthy();
      expect(thuocTinh(a, "RestoreSources")).toBeUndefined(); // `--source` đã là RestoreSources
      expect(thuocTinh(a, "RestoreAdditionalProjectSources")).toBe("");
    } finally {
      fs.rmSync(feed, { recursive: true, force: true });
    }
  });

  it("★★ DOTNET_CHO_PHEP_RESTORE=1 ⇒ argv cũ (trần / `--source`)", () => {
    process.env[BIEN_DOTNET_CHO_PHEP_RESTORE] = "1";
    expect(args("dotnet restore")).toEqual(["restore"]);
  });
});

describe("§2b — môi trường ĐÃ LỌC đủ cho NuGet", () => {
  /**
   * Đo 2026-10-19 (chạy thật §3 lượt đầu): với môi trường đã lọc, MỌI restore chết ngay "The type initializer for
   * 'NuGet.Configuration.ConfigurationDefaults' threw … Value cannot be null (Parameter 'path1')" — NuGet dựng đường
   * cấu hình máy từ `ProgramFiles(x86)`/`ProgramFiles`. Thêm một trong hai ⇒ restore qua. (Cũng là lý do `dotnet restore`
   * có duyệt của Đợt 3c chưa bao giờ chạy được trong hộp cát.) Hai biến là đường HĐH, không phải bí mật.
   */
  it("★★★ ProgramFiles / ProgramFiles(x86) đi qua phép lọc", () => {
    const ra = moiTruongDaLoc({ ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", DATABASE_URL: "x" });
    expect(ra.ProgramFiles).toBe("C:\\Program Files");
    expect(ra["ProgramFiles(x86)"]).toBe("C:\\Program Files (x86)");
    expect(ra.DATABASE_URL).toBeUndefined();
  });
});

// ── §3 — CHẠY THẬT (dotnet SDK + gói xunit có sẵn trong cache máy; thư mục tạm NGOÀI repo; không mạng) ──
const CACHE = path.join(os.homedir(), ".nuget", "packages");
const coDotnet = spawnSync("dotnet", ["--version"], { encoding: "utf8", shell: false }).status === 0;
const coGoi = ["xunit/2.9.2", "microsoft.net.test.sdk/17.11.1", "xunit.runner.visualstudio/2.8.2"].every((p) => fs.existsSync(path.join(CACHE, p)));

const CSPROJ = (them = "") => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
    <!-- nguồn do DỰ ÁN tự khai: phải bị đè (cổng 9 = discard, không ai nghe) -->
    <RestoreSources>http://127.0.0.1:9/csproj/index.json</RestoreSources>
    <RestoreAdditionalProjectSources>http://127.0.0.1:9/them/index.json</RestoreAdditionalProjectSources>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />${them}
  </ItemGroup>
  <ItemGroup><Using Include="Xunit" /></ItemGroup>
</Project>`;

function taoDuAnXunit(them = ""): void {
  fs.writeFileSync(path.join(goc, "Bai.csproj"), CSPROJ(them));
  fs.writeFileSync(path.join(goc, "T.cs"), "namespace Bai;\npublic class T { [Fact] public void Cong() => Assert.Equal(3, 1 + 2); }\n");
  fs.writeFileSync(
    path.join(goc, "nuget.config"),
    '<?xml version="1.0" encoding="utf-8"?>\n<configuration><packageSources><add key="bay" value="http://127.0.0.1:9/v3/index.json" /></packageSources></configuration>\n',
  );
}

function chayThat(lenh: string) {
  const r = pq(lenh);
  if (!r.ok) throw new Error(`${r.ma}: ${r.chiTiet}`);
  const env = { ...moiTruongDaLoc(), ...(r.spec.envThem ?? {}) };
  const p = spawnSync(r.spec.file, [...r.spec.args], { cwd: goc, env, encoding: "utf8", timeout: 180_000, shell: false });
  return { ma: p.status, ra: `${p.stdout ?? ""}${p.stderr ?? ""}` };
}

describe.skipIf(!coDotnet || !coGoi)("§3 — CHẠY THẬT: dự án xunit tối thiểu, không mạng", () => {
  it("★★★ `dotnet test Bai.csproj` trên dự án CHƯA restore ⇒ tự restore từ cache, test QUA; nguồn của dự án bị bỏ qua", () => {
    taoDuAnXunit();
    const { ma, ra } = chayThat("dotnet test Bai.csproj");
    expect(ra).not.toMatch(/NETSDK1004|NU1301|NU1302|127\.0\.0\.1/);
    expect(ra).toMatch(/Passed!|Đã qua|Total:\s*1/);
    expect(ma).toBe(0);
  }, 200_000);

  it("★★★ gói LẠ (không có trong cache) ⇒ NU1101 nhanh, không thử nguồn mạng nào", () => {
    taoDuAnXunit('\n    <PackageReference Include="Khong.Ton.Tai.Goi.Ai7" Version="1.0.0" />');
    const t0 = Date.now();
    const { ma, ra } = chayThat("dotnet build Bai.csproj");
    expect(ma).not.toBe(0);
    expect(ra).toMatch(/NU1101/);
    expect(ra).not.toMatch(/NU1301|NU1302|127\.0\.0\.1/);
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 120_000);
});
