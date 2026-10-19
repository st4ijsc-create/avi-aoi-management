/**
 * ★★★ 2026-10-18 — DANH SÁCH TRẮNG ĐA NGÔN NGỮ: Java · C++ (CMake) · Go · Rust.
 *
 * Bối cảnh đo được (bộ đo `scripts/ai-eval/ngau-nhien/`, đường (b)): agent máy chủ chỉ chạy được `node --test` ·
 * `python -m pytest|unittest` · `dotnet build|test` ⇒ với Java/C++/Go/Rust agent KHÔNG tự biên dịch/chạy test được — nó
 * sinh mã rồi "đoán" là đúng. Lưới này ghim ĐÚNG DẠNG được mở (và chỉ dạng ấy), cùng mức siết của các mục cũ:
 *   • khuôn CỨNG (subcommand + cờ cố định), ô tự do = đường TƯƠNG ĐỐI qua hộp cát pha A, không bắt đầu bằng `-`/`@`;
 *   • toolchain từ CẤU HÌNH MÁY CHỦ (`AI_TOOLCHAIN_GO_ROOT`, `AI_TOOLCHAIN_CARGO_HOME` + `AI_TOOLCHAIN_RUSTUP_HOME`,
 *     `AI_JAVA_HOME`, `AI_TOOLCHAIN_CMAKE_DIR`) — KHÔNG tra PATH; thiếu ⇒ `CMD_THIEU_DIEU_KIEN` nói đúng biến;
 *   • không đường ra mạng: `go` GOPROXY=off + GOTOOLCHAIN=local, `cargo` bắt buộc `--offline` + RUSTUP_AUTO_INSTALL=0;
 *   • tu-dong: test/build/check tự chạy được; `java -cp <lớp> <LớpMain>` (chạy CHƯƠNG TRÌNH) luôn cần người duyệt.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DANH_SACH_TRANG,
  MA_TU_CHOI_LENH,
  moiTruongDaLoc,
  phanQuyetLenh,
  tachArgv,
  type KetQuaPhanQuyetLenh,
} from "./repoCommandSandbox";
import { NHAN_KIEM_CHUNG, laLenhKiemChung } from "../aiCodingVerify";
import { phanQuyetLenhTuDong } from "../ai/agent/boThucThiMayChu";

const EXE = process.platform === "win32" ? ".exe" : "";
const BIEN = [
  "AI_TOOLCHAIN_GO_ROOT",
  "AI_TOOLCHAIN_CARGO_HOME",
  "AI_TOOLCHAIN_RUSTUP_HOME",
  "AI_JAVA_HOME",
  "AI_TOOLCHAIN_CMAKE_DIR",
  "AI_CODING_AUTOLOOP",
] as const;

let tam: string;
let goc: string;
let tc: { go: string; cargo: string; rustup: string; java: string; cmake: string };
const cu: Record<string, string | undefined> = {};

function taoTep(p: string, noiDung = ""): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, noiDung);
}

beforeAll(() => {
  tam = fs.mkdtempSync(path.join(os.tmpdir(), "dsTrangDaNN-"));
  tc = {
    go: path.join(tam, "tc", "go"),
    cargo: path.join(tam, "tc", "cargo"),
    rustup: path.join(tam, "tc", "rustup"),
    java: path.join(tam, "tc", "jdk"),
    cmake: path.join(tam, "tc", "cmake", "bin"),
  };
  taoTep(path.join(tc.go, "bin", `go${EXE}`));
  taoTep(path.join(tc.cargo, "bin", `cargo${EXE}`));
  fs.mkdirSync(tc.rustup, { recursive: true });
  taoTep(path.join(tc.java, "bin", `javac${EXE}`));
  taoTep(path.join(tc.java, "bin", `java${EXE}`));
  taoTep(path.join(tc.cmake, `cmake${EXE}`));
  taoTep(path.join(tc.cmake, `ctest${EXE}`));

  goc = path.join(tam, "duan");
  taoTep(path.join(goc, "go.mod"), "module vd\n\ngo 1.22\n");
  taoTep(path.join(goc, "Cargo.toml"), '[package]\nname = "vd"\nversion = "0.1.0"\n');
  taoTep(path.join(goc, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.20)\n");
  taoTep(path.join(goc, "src", "Kmp.java"), "class Kmp {}\n");
  taoTep(path.join(goc, "src", "con", "Phu.java"), "class Phu {}\n");
  taoTep(path.join(goc, "src", "ghichu.txt"), "x\n");
  taoTep(path.join(goc, "test", "KmpTest.java"), "class KmpTest {}\n");
  taoTep(path.join(goc, "test", "Kt.java"), "class Kt {}\n");
  fs.mkdirSync(path.join(goc, "rong"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(tam, { recursive: true, force: true });
});

beforeEach(() => {
  for (const k of BIEN) cu[k] = process.env[k];
  process.env.AI_TOOLCHAIN_GO_ROOT = tc.go;
  process.env.AI_TOOLCHAIN_CARGO_HOME = tc.cargo;
  process.env.AI_TOOLCHAIN_RUSTUP_HOME = tc.rustup;
  process.env.AI_JAVA_HOME = tc.java;
  process.env.AI_TOOLCHAIN_CMAKE_DIR = tc.cmake;
});

afterEach(() => {
  for (const k of BIEN) {
    if (cu[k] === undefined) delete process.env[k];
    else process.env[k] = cu[k];
  }
});

function pq(lenh: string, g = goc): KetQuaPhanQuyetLenh {
  const t = tachArgv(lenh);
  if (!t.ok) return { ok: false, ma: t.ma, chiTiet: t.chiTiet };
  return phanQuyetLenh(t.argv, g);
}

function phaiChay(lenh: string) {
  const r = pq(lenh);
  expect(r.ok, `${lenh} PHẢI được phép — ${r.ok ? "" : `${r.ma}: ${r.chiTiet}`}`).toBe(true);
  if (!r.ok) throw new Error("unreachable");
  return r;
}

function phaiChan(lenh: string, ma?: string) {
  const r = pq(lenh);
  expect(r.ok, `${lenh} PHẢI bị chặn`).toBe(false);
  if (!r.ok && ma) expect(r.ma, `${lenh}: ${r.chiTiet}`).toBe(ma);
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — CHIỀU DƯƠNG: đúng dạng được mở phân giải ra argv THẬT (toolchain từ cấu hình, cờ cố định)", () => {
  it("★★★ javac -d <out> <tệp.java…> ⇒ javac của AI_JAVA_HOME, `-encoding UTF-8` cố định, đường nguyên văn", () => {
    const r = phaiChay("javac -d out src/Kmp.java test/KmpTest.java test/Kt.java");
    expect(r.spec.file).toBe(path.join(tc.java, "bin", `javac${EXE}`));
    expect(r.spec.args).toEqual(["-encoding", "UTF-8", "-d", "out", "src/Kmp.java", "test/KmpTest.java", "test/Kt.java"]);
    expect(r.nhan).toBe("javac -d out src/Kmp.java test/KmpTest.java test/Kt.java");
  });

  it("★★ javac -d <out> <thư-mục> ⇒ máy chủ tự liệt kê MỌI .java dưới thư mục (sắp xếp, bỏ tệp khác đuôi)", () => {
    const r = phaiChay("javac -d out src test");
    expect(r.spec.args).toEqual([
      "-encoding",
      "UTF-8",
      "-d",
      "out",
      "src/Kmp.java",
      "src/con/Phu.java",
      "test/KmpTest.java",
      "test/Kt.java",
    ]);
  });

  it("★★★ java -cp <out> <LớpTest> ⇒ `-ea` + mã hoá UTF-8 cố định; lớp tên hợp lệ đi vào argv nguyên văn", () => {
    const r = phaiChay("java -cp out KmpTest");
    expect(r.spec.file).toBe(path.join(tc.java, "bin", `java${EXE}`));
    expect(r.spec.args).toEqual(["-ea", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-cp", "out", "KmpTest"]);
    expect(r.muc.nhan).toBe("java -cp <thư-mục-lớp> <LớpTest>");
    // lớp có gói
    expect(phaiChay("java -cp out vd.kmp.KmpTests").muc.nhan).toBe("java -cp <thư-mục-lớp> <LớpTest>");
  });

  it("★★ java -cp <out> <LớpMain> (không phải tên lớp test) ⇒ mục RIÊNG `<LớpMain>` (chạy chương trình)", () => {
    const r = phaiChay("java -cp out vd.App");
    expect(r.muc.nhan).toBe("java -cp <thư-mục-lớp> <LớpMain>");
    expect(r.spec.args.slice(-3)).toEqual(["-cp", "out", "vd.App"]);
  });

  it("★★★ cmake -S . -B <build> · cmake --build <build> · ctest --test-dir <build> ⇒ cmake/ctest của AI_TOOLCHAIN_CMAKE_DIR", () => {
    const a = phaiChay("cmake -S . -B _b");
    expect(a.spec.file).toBe(path.join(tc.cmake, `cmake${EXE}`));
    expect(a.spec.args, "-D chỉ do MÁY CHỦ đặt: Debug + FetchContent ngắt mạng").toEqual([
      "-S",
      ".",
      "-B",
      "_b",
      "-DCMAKE_BUILD_TYPE=Debug",
      "-DFETCHCONTENT_FULLY_DISCONNECTED=ON",
    ]);
    const b = phaiChay("cmake --build _b");
    expect(b.spec.file).toBe(path.join(tc.cmake, `cmake${EXE}`));
    expect(b.spec.args).toEqual(["--build", "_b", "--config", "Debug"]);
    const c = phaiChay("ctest --test-dir _b");
    expect(c.spec.file).toBe(path.join(tc.cmake, `ctest${EXE}`));
    expect(c.spec.args).toEqual(["--test-dir", "_b", "-C", "Debug", "--output-on-failure", "--no-tests=error"]);
  });

  it("★★★ go test|build|vet ./... ⇒ go của AI_TOOLCHAIN_GO_ROOT, GOPROXY=off, GOTOOLCHAIN=local, GOFLAGS cố định", () => {
    for (const sub of ["test", "build", "vet"]) {
      const r = phaiChay(`go ${sub} ./...`);
      expect(r.spec.file).toBe(path.join(tc.go, "bin", `go${EXE}`));
      expect(r.spec.args).toEqual([sub, "./..."]);
      const e = r.spec.envThem ?? {};
      expect(e.GOROOT).toBe(tc.go);
      expect(e.GOPROXY, "KHÔNG tải module qua mạng").toBe("off");
      expect(e.GOTOOLCHAIN, "KHÔNG tải toolchain khác theo go.mod").toBe("local");
      expect(e.GOFLAGS, "không vendor ⇒ -mod=readonly (không sửa go.mod)").toBe("-mod=readonly");
      expect(e.GOTELEMETRY).toBe("off");
      expect(e.CGO_ENABLED).toBe("0");
    }
  });

  it("★★ có vendor/modules.txt ⇒ GOFLAGS=-mod=vendor (dùng phụ thuộc đã chép vào dự án)", () => {
    const g2 = path.join(tam, "duan-vendor");
    taoTep(path.join(g2, "go.mod"), "module v\n");
    taoTep(path.join(g2, "vendor", "modules.txt"), "");
    const r = pq("go test ./...", g2);
    expect(r.ok && r.spec.envThem?.GOFLAGS).toBe("-mod=vendor");
  });

  it("★★★ cargo test|build|check --offline ⇒ cargo của AI_TOOLCHAIN_CARGO_HOME, mạng TẮT, rustup không tự cài", () => {
    for (const sub of ["test", "build", "check"]) {
      const r = phaiChay(`cargo ${sub} --offline`);
      expect(r.spec.file).toBe(path.join(tc.cargo, "bin", `cargo${EXE}`));
      expect(r.spec.args).toEqual([sub, "--offline"]);
      const e = r.spec.envThem ?? {};
      expect(e.CARGO_HOME).toBe(tc.cargo);
      expect(e.RUSTUP_HOME).toBe(tc.rustup);
      expect(e.CARGO_NET_OFFLINE).toBe("true");
      expect(e.RUSTUP_AUTO_INSTALL, "rust-toolchain.toml không được kéo toolchain về").toBe("0");
      const khoaPath = Object.keys(e).find((k) => k.toUpperCase() === "PATH");
      expect(khoaPath, "rustc/linker proxy phải tìm được qua PATH đặt thêm").toBeDefined();
      expect(e[khoaPath!]!.startsWith(path.join(tc.cargo, "bin"))).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — CHIỀU ÂM: lệnh tải mạng / chạy tuỳ ý / cờ lạ / đường ngoài hộp cát ⇒ chặn, không tiến trình nào", () => {
  it.each([
    "go get example.com/x",
    "go run .",
    "go run main.go",
    "go install ./...",
    "go mod download",
    "go mod tidy",
    "go generate ./...",
    "go test",
    "go test .",
    "go test ./... -exec x",
    "go test ./... -toolexec x",
    "go env -w GOPROXY",
    "go tool x",
  ])("★★★ %s ⇒ CMD_NOT_ALLOWED", (l) => {
    phaiChan(l, MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
  });

  it.each([
    "cargo test",
    "cargo build",
    "cargo check",
    "cargo install ripgrep",
    "cargo run --offline",
    "cargo fetch",
    "cargo update",
    "cargo build --offline --features x",
    "cargo test --offline --manifest-path ../x/Cargo.toml",
    "cargo --offline test",
  ])("★★★ %s ⇒ CMD_NOT_ALLOWED (không --offline = có thể tải crate + chạy build.rs của nó)", (l) => {
    phaiChan(l, MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
  });

  it("★★★ cmake -D… : `=` chặn ở lớp ký tự; `-D` không `=` lệch khuôn; -P/-E/--target ⇒ không có khuôn", () => {
    phaiChan("cmake -S . -B _b -DCMAKE_BUILD_TYPE=Release", MA_TU_CHOI_LENH.CMD_METACHAR);
    phaiChan("cmake -S . -B _b -DFOO", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("cmake -S . -B -DFOO", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("cmake -P script.cmake", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("cmake -E rm -rf src", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("cmake --build _b --target clean", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("cmake -S src -B _b", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("cmake --install _b", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("ctest --test-dir _b -R x", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("ctest -S x.cmake", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
  });

  it("★★★ java -javaagent / -agentlib / -XX / -jar / nguồn đơn tệp ⇒ chặn", () => {
    phaiChan("java -javaagent:x.jar -cp out KmpTest", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("java -agentlib:jdwp -cp out KmpTest", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("java -cp out -XX", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("java -cp out -javaagent:x.jar", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("java -cp -javaagent:x.jar KmpTest", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("java -jar app.jar", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("java src/Kmp.java", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("java -cp out KmpTest arg1", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("java -cp out 1Lop", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("java -cp out vd..Lop", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("java -cp out @args", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
  });

  it("★★★ javac: @argfile / cờ ở ô đường / không tệp nào / tệp không phải .java ⇒ chặn", () => {
    phaiChan("javac -d out @nguon.txt", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("javac -d out -processorpath x", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("javac -d -J-Xmx1g src/Kmp.java", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
    phaiChan("javac -d out", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("javac src/Kmp.java", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("javac -cp x -d out src/Kmp.java", MA_TU_CHOI_LENH.CMD_NOT_ALLOWED);
    phaiChan("javac -d out src/ghichu.txt", MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
    phaiChan("javac -d out rong", MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
    phaiChan("javac -d out khongco", MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
  });

  it.each([
    "javac -d ../out src/Kmp.java",
    "javac -d out ../ngoai/X.java",
    "javac -d out C:/x/X.java",
    "javac -d out src/../../X.java",
    "javac -d /tmp/out src/Kmp.java",
    "java -cp ../out KmpTest",
    "java -cp C:/x KmpTest",
    "java -cp out:../x KmpTest",
    "cmake -S . -B ../ngoai",
    "cmake -S . -B C:/x",
    "cmake --build ../ngoai",
    "ctest --test-dir ../ngoai",
    "cmake -S . -B .git/x",
  ])("★★★ đường ngoài hộp cát: %s ⇒ CMD_ARG_PATH_REJECTED", (l) => {
    phaiChan(l, MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
  });

  it("★★★ (mọi mục) ô tự do bắt đầu bằng `-` hoặc `@` ⇒ CMD_ARG_PATH_REJECTED — chương trình đích đọc nó là CỜ / tệp tham số", () => {
    fs.writeFileSync(path.join(goc, "package.json"), "{}");
    try {
      phaiChan("npx vitest run --update", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
      phaiChan("node --test --inspect-brk", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
      phaiChan("dotnet build @lenh.rsp", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
      phaiChan("dotnet test -bl", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
      phaiChan("python -m pytest -p", MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED);
      // chống vá quá tay: đường thường vẫn qua
      expect(pq("node --test tests").ok).toBe(true);
    } finally {
      fs.rmSync(path.join(goc, "package.json"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — TOOLCHAIN: cấu hình máy chủ, KHÔNG PATH; thiếu/méo ⇒ CMD_THIEU_DIEU_KIEN nói đúng biến", () => {
  it.each([
    ["AI_TOOLCHAIN_GO_ROOT", "go test ./..."],
    ["AI_TOOLCHAIN_CARGO_HOME", "cargo test --offline"],
    ["AI_TOOLCHAIN_RUSTUP_HOME", "cargo build --offline"],
    ["AI_JAVA_HOME", "javac -d out src/Kmp.java"],
    ["AI_JAVA_HOME", "java -cp out KmpTest"],
    ["AI_TOOLCHAIN_CMAKE_DIR", "cmake -S . -B _b"],
    ["AI_TOOLCHAIN_CMAKE_DIR", "ctest --test-dir _b"],
  ])("★★★ vắng %s ⇒ %s bị từ chối, câu từ chối nêu TÊN biến", (bien, lenh) => {
    delete process.env[bien];
    const r = phaiChan(lenh, MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
    if (!r.ok) expect(r.chiTiet).toContain(bien);
  });

  it("★★ giá trị TƯƠNG ĐỐI / thư mục không có tệp chạy ⇒ từ chối (không rơi về PATH)", () => {
    process.env.AI_TOOLCHAIN_GO_ROOT = "toolchains/go";
    phaiChan("go test ./...", MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
    process.env.AI_TOOLCHAIN_GO_ROOT = tc.cargo; // tồn tại nhưng không có bin/go
    phaiChan("go test ./...", MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
    process.env.AI_JAVA_HOME = path.join(tam, "khong-co");
    phaiChan("javac -d out src/Kmp.java", MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
  });

  it("★★★ go/cargo đi NGƯỢC cây thư mục tìm go.mod/Cargo.toml ⇒ gốc thiếu manifest ⇒ từ chối (không chạy nhầm dự án cha)", () => {
    const g3 = path.join(tam, "duan-rong");
    fs.mkdirSync(g3, { recursive: true });
    const a = pq("go test ./...", g3);
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.ma).toBe(MA_TU_CHOI_LENH.CMD_THIEU_DIEU_KIEN);
      expect(a.chiTiet).toContain("go.mod");
    }
    const b = pq("cargo test --offline", g3);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.chiTiet).toContain("Cargo.toml");
  });

  it("★★★ biến môi trường tiêm cờ của toolchain từ tiến trình máy chủ bị LỌC (JAVA_TOOL_OPTIONS, GOFLAGS, RUSTC_WRAPPER…)", () => {
    const loc = moiTruongDaLoc({
      PATH: "x",
      JAVA_TOOL_OPTIONS: "-javaagent:x.jar",
      JDK_JAVA_OPTIONS: "-javaagent:x.jar",
      _JAVA_OPTIONS: "-javaagent:x.jar",
      GOFLAGS: "-toolexec=x",
      RUSTC_WRAPPER: "x",
      RUSTFLAGS: "-C linker=x",
      CARGO_BUILD_RUSTC_WRAPPER: "x",
      CMAKE_TOOLCHAIN_FILE: "x.cmake",
    });
    for (const k of ["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "GOFLAGS", "RUSTC_WRAPPER", "RUSTFLAGS", "CARGO_BUILD_RUSTC_WRAPPER", "CMAKE_TOOLCHAIN_FILE"]) {
      expect(loc[k], k).toBeUndefined();
    }
    // và envThem của các mục mới không đưa chúng trở lại
    for (const l of ["go test ./...", "cargo test --offline", "javac -d out src/Kmp.java", "java -cp out KmpTest", "cmake -S . -B _b"]) {
      const r = phaiChay(l);
      for (const k of Object.keys(r.spec.envThem ?? {})) {
        expect(["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "RUSTC_WRAPPER", "RUSTFLAGS", "CMAKE_TOOLCHAIN_FILE"], `${l}: ${k}`).not.toContain(k);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — CHÍNH SÁCH tu-dong GIỮ NGUYÊN: chỉ test/build/check tự chạy; chạy CHƯƠNG TRÌNH cần người duyệt", () => {
  const TU_CHAY = [
    "javac -d out src/Kmp.java test/KmpTest.java",
    "java -cp out KmpTest",
    "cmake -S . -B _b",
    "cmake --build _b",
    "ctest --test-dir _b",
    "go test ./...",
    "go build ./...",
    "go vet ./...",
    "cargo test --offline",
    "cargo build --offline",
    "cargo check --offline",
  ];

  it.each(TU_CHAY)("★★★ %s ∈ tập KIỂM CHỨNG", (l) => {
    const r = laLenhKiemChung(l, goc);
    expect(r.ok, r.ok ? "" : r.chiTiet).toBe(true);
  });

  it("★★★ java -cp <out> <LớpMain> KHÔNG thuộc tập kiểm chứng (chạy chương trình người dùng viết = chạy mã tuỳ ý theo yêu cầu)", () => {
    expect(NHAN_KIEM_CHUNG.has("java -cp <thư-mục-lớp> <LớpMain>")).toBe(false);
    expect(laLenhKiemChung("java -cp out vd.App", goc).ok).toBe(false);
  });

  it("★★★ phanQuyetLenhTuDong: javac khai CẢ thư mục ra LẪN tệp nguồn là đường lệnh chạm (Q1 xét đủ)", () => {
    process.env.AI_CODING_AUTOLOOP = "1";
    const r = phanQuyetLenhTuDong("javac -d out src/Kmp.java test/KmpTest.java", goc, () => false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.duongCham).toEqual(["out", "src/Kmp.java", "test/KmpTest.java"]);
    const g = phanQuyetLenhTuDong("go test ./...", goc, () => false);
    expect(g.ok && g.duongCham).toEqual(["."]);
    const m = phanQuyetLenhTuDong("java -cp out vd.App", goc, () => false);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.ma).toBe("LENH_CAN_DUYET_TAY");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — CẤU TRÚC các mục mới", () => {
  const MOI = DANH_SACH_TRANG.filter((m) => ["javac", "java", "cmake", "ctest", "go", "cargo"].includes(m.khuon[0] ?? ""));

  it("★★ đủ 12 mục mới, đều nhóm hoi-kiem, KHÔNG mục nào ghi đè mã nguồn, hạn giờ ≤ trần hỏi/kiểm", () => {
    expect(MOI.map((m) => m.nhan)).toEqual([
      "javac -d <thư-mục-lớp> <tệp.java|thư-mục>…",
      "java -cp <thư-mục-lớp> <LớpTest>",
      "java -cp <thư-mục-lớp> <LớpMain>",
      "cmake -S . -B <thư-mục-dựng>",
      "cmake --build <thư-mục-dựng>",
      "ctest --test-dir <thư-mục-dựng>",
      "go test ./...",
      "go build ./...",
      "go vet ./...",
      "cargo test --offline",
      "cargo build --offline",
      "cargo check --offline",
    ]);
    for (const m of MOI) {
      expect(m.nhom, m.nhan).toBe("hoi-kiem");
      expect(m.ghiDia, m.nhan).toBe(false);
      expect(m.hanGioMs, m.nhan).toBeLessThanOrEqual(300_000);
    }
  });

  it("★★★ mục có ĐUÔI tự do khai bộ phán quyết cho đuôi", () => {
    for (const m of DANH_SACH_TRANG) {
      if (m.duoi) expect(typeof m.duoi.phanQuyet, m.nhan).toBe("function");
    }
  });
});
