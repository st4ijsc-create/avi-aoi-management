/**
 * Bộ đo NGẪU NHIÊN — đường dẫn, toolchain, môi trường tiến trình con. MỘT chỗ cho mọi trình chạy.
 *
 * Toolchain (đo 2026-10-18 trên máy này; ghi đè bằng biến môi trường nếu máy khác):
 *   python   AI_EVAL_PYTHON  mặc định C:\Users\Admin\AppData\Local\Python\bin\python.exe (3.14.6 + pytest 9.1.1)
 *            ⚠ `python` trên PATH có thể là BÍ DANH WindowsApps (spawn UNKNOWN / treo) — không dùng.
 *            ⚠ KHÔNG có tzdata ⇒ `zoneinfo.ZoneInfo("America/New_York")` NÉM — bài Python chỉ dùng múi giờ lệch cố định.
 *   node     process.execPath (Node 24 — tự bóc kiểu .ts, CHỈ cú pháp xoá được)
 *   dotnet   PATH (SDK 10.0.30x) — xUnit 2.9.2 / Test.Sdk 17.11.1 / runner 2.8.2 có sẵn trong ~/.nuget/packages (offline)
 *   java     PATH (JDK 26.0.1, javac + java) — không Maven; test = lớp có main + `Kt` tự viết
 *   cmake    C:/Program Files/CMake/bin/cmake.exe (4.4.x) → MSVC (VS 2026) dò qua registry, không cần vcvars64
 *   go       AI_EVAL_GO_ROOT   mặc định D:\SOURCES\16.AI\toolchains\go (go1.27.2, zip chính thức, di động)
 *   cargo    AI_EVAL_CARGO_HOME mặc định D:\SOURCES\16.AI\toolchains\cargo (+ RUSTUP_HOME …\rustup; rustc 1.99.1 msvc)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BO = path.dirname(path.dirname(fileURLToPath(import.meta.url))).split(path.sep).join("/");
export const ROOT = path.resolve(BO, "../../..").split(path.sep).join("/");
export const KHO = `${BO}/kho`;

const coTep = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export const PYTHON = process.env.AI_EVAL_PYTHON?.trim() || "C:/Users/Admin/AppData/Local/Python/bin/python.exe";
export const CMAKE = coTep("C:/Program Files/CMake/bin/cmake.exe") ? "C:/Program Files/CMake/bin/cmake.exe" : "cmake";
export const GO_ROOT = (process.env.AI_EVAL_GO_ROOT?.trim() || "D:/SOURCES/16.AI/toolchains/go").replace(/\\/g, "/");
export const CARGO_HOME = (process.env.AI_EVAL_CARGO_HOME?.trim() || "D:/SOURCES/16.AI/toolchains/cargo").replace(/\\/g, "/");
export const RUSTUP_HOME = (process.env.AI_EVAL_RUSTUP_HOME?.trim() || "D:/SOURCES/16.AI/toolchains/rustup").replace(/\\/g, "/");
const TOOLCHAINS = path.dirname(GO_ROOT).split(path.sep).join("/");

export const GO = `${GO_ROOT}/bin/go.exe`;
export const CARGO = `${CARGO_HOME}/bin/cargo.exe`;
export const RUSTC = `${CARGO_HOME}/bin/rustc.exe`;

/** Môi trường tiến trình con: tắt telemetry/màu/nút MSBuild sống; Go/Rust ngoại tuyến hoàn toàn. */
export const MOI_TRUONG = (() => {
  const e = { ...process.env };
  const them = [`${GO_ROOT}/bin`, `${CARGO_HOME}/bin`].map((p) => p.replace(/\//g, path.sep));
  const khoa = Object.keys(e).find((k) => k.toLowerCase() === "path") ?? "PATH";
  e[khoa] = [...them, e[khoa] ?? ""].join(path.delimiter);
  Object.assign(e, {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
    MSBUILDDISABLENODEREUSE: "1",
    UseSharedCompilation: "false",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    // Go: không tải toolchain khác, không proxy mạng, không telemetry; cache dưới thư mục toolchain (không %LOCALAPPDATA%).
    GOROOT: GO_ROOT,
    GOTOOLCHAIN: "local",
    GOPROXY: "off",
    GOTELEMETRY: "off",
    GOPATH: `${TOOLCHAINS}/gopath`,
    GOCACHE: `${TOOLCHAINS}/gocache`,
    CGO_ENABLED: "0",
    // Rust: toolchain di động; `cargo test --offline` (bài không có phụ thuộc ngoài).
    CARGO_HOME,
    RUSTUP_HOME,
    CARGO_NET_OFFLINE: "true",
    CARGO_TERM_COLOR: "never",
  });
  return e;
})();

/** Có toolchain cho kiểu chấm này không (để bộ chọn/kiểm thước báo rõ thay vì "model trượt"). */
export function coToolchain(kieu) {
  if (kieu === "go") return coTep(GO);
  if (kieu === "cargo") return coTep(CARGO);
  if (kieu === "pytest") return coTep(PYTHON);
  // st: ảnh Docker `st-rusty:1.0.7` — kiểm bất đồng bộ ở `lib/st/chayST.mjs#coAnhST` (bộ chấm báo HA_TANG nếu thiếu).
  return true;
}
