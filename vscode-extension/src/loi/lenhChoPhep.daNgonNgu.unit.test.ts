/**
 * ★★★ 2026-10-18 — allowlist extension: Java · C++ (CMake) · Go · Rust, CÙNG mức siết với khuôn cũ (Đợt 4).
 *
 * Extension chạy trên MÁY lập trình viên ⇒ chương trình tra PATH của họ (hợp lệ — khác máy chủ, nơi toolchain là cấu
 * hình quản trị). Cái được giữ: cờ CỐ ĐỊNH khớp nguyên văn, ô tự do chỉ là đường qua `thamSoAnToan` (tương đối, không
 * `..`, không bắt đầu `-`, danh sách trắng ký tự ⇒ không `@argfile`, không `:`), và KHÔNG đường ra mạng: `cargo` bắt
 * buộc `--offline`; `go` chạy với GOPROXY=off + GOTOOLCHAIN=local (không tải module / toolchain rồi chạy nó).
 */
import { describe, it, expect } from "vitest";
import { MAU_LENH_HIEN_THI, TRAN_MS_THEO_LENH, xetDuyetLenh } from "./lenhChoPhep";

function duyet(l: string) {
  const r = xetDuyetLenh(l);
  expect(r.ok, `${l} PHẢI được phép — ${r.ok ? "" : r.lyDo}`).toBe(true);
  if (!r.ok) throw new Error("unreachable");
  return r.lenh;
}
function chan(l: string) {
  const r = xetDuyetLenh(l);
  expect(r.ok, `${l} PHẢI bị chặn`).toBe(false);
}

describe("Java", () => {
  it("★★★ javac -d <out> <tệp.java>… ⇒ `-encoding UTF-8` cố định; hienThi = dạng NGƯỜI GÕ (bangChat xét lại được)", () => {
    const l = duyet("javac -d out src/Kmp.java test/KmpTest.java");
    expect(l.ten).toBe("javac");
    expect(l.argv).toEqual(["javac", "-encoding", "UTF-8", "-d", "out", "src/Kmp.java", "test/KmpTest.java"]);
    expect(l.hienThi).toBe("javac -d out src/Kmp.java test/KmpTest.java");
    expect(xetDuyetLenh(l.hienThi).ok, "nhãn đã lưu phải tự qua lại allowlist").toBe(true);
  });

  it("★★★ java -cp <out> <Lớp> ⇒ `-ea` + UTF-8 cố định", () => {
    const l = duyet("java -cp out vd.KmpTest");
    expect(l.ten).toBe("java_run");
    expect(l.argv).toEqual(["java", "-ea", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-cp", "out", "vd.KmpTest"]);
    expect(l.hienThi).toBe("java -cp out vd.KmpTest");
    expect(xetDuyetLenh(l.hienThi).ok).toBe(true);
  });

  it.each([
    "javac -d out",
    "javac -d out notes.txt",
    "javac -d out @nguon.txt",
    "javac -d out -processorpath x",
    "javac -d -J-Xmx1g src/A.java",
    "javac -d ../out src/A.java",
    "javac -d out ../x/A.java",
    "javac -d out C:/x/A.java",
    "javac -cp x -d out src/A.java",
    "javac src/A.java",
    "java -javaagent:x.jar -cp out A",
    "java -agentlib:jdwp -cp out A",
    "java -cp out -XX",
    "java -cp out @args",
    "java -cp out:../x A",
    "java -cp ../out A",
    "java -cp out 1A",
    "java -cp out A arg",
    "java -jar app.jar",
    "java src/A.java",
  ])("★★★ %s ⇒ chặn", (l) => chan(l));
});

describe("C++ (CMake)", () => {
  it("★★★ ba khuôn: cấu hình (Debug, FetchContent ngắt mạng) · dựng --config Debug · ctest -C Debug", () => {
    expect(duyet("cmake -S . -B build").argv).toEqual([
      "cmake",
      "-S",
      ".",
      "-B",
      "build",
      "-DCMAKE_BUILD_TYPE=Debug",
      "-DFETCHCONTENT_FULLY_DISCONNECTED=ON",
    ]);
    expect(duyet("cmake --build build").argv).toEqual(["cmake", "--build", "build", "--config", "Debug"]);
    expect(duyet("ctest --test-dir build").argv).toEqual([
      "ctest",
      "--test-dir",
      "build",
      "-C",
      "Debug",
      "--output-on-failure",
      "--no-tests=error",
    ]);
    for (const h of ["cmake -S . -B build", "cmake --build build", "ctest --test-dir build"]) {
      expect(duyet(h).hienThi).toBe(h);
    }
  });

  it.each([
    "cmake -S . -B build -DCMAKE_BUILD_TYPE=Release",
    "cmake -S . -B build -DFOO",
    "cmake -S . -B -DFOO",
    "cmake -S src -B build",
    "cmake -S . -B ../ngoai",
    "cmake -P script.cmake",
    "cmake -E rm -rf src",
    "cmake --build build --target clean",
    "cmake --install build",
    "ctest --test-dir build -R x",
    "ctest -S x.cmake",
  ])("★★★ %s ⇒ chặn", (l) => chan(l));
});

describe("Go", () => {
  it("★★★ go test|build|vet ./... ⇒ GOPROXY=off + GOTOOLCHAIN=local", () => {
    for (const sub of ["test", "build", "vet"]) {
      const l = duyet(`go ${sub} ./...`);
      expect(l.argv).toEqual(["go", sub, "./..."]);
      expect(l.env?.GOPROXY).toBe("off");
      expect(l.env?.GOTOOLCHAIN).toBe("local");
    }
  });

  it.each(["go get example.com/x", "go run .", "go install ./...", "go mod download", "go mod tidy", "go generate ./...", "go test", "go test ./... -exec x", "go tool x"])(
    "★★★ %s ⇒ chặn",
    (l) => chan(l),
  );
});

describe("Rust", () => {
  it("★★★ cargo test|build|check --offline ⇒ CARGO_NET_OFFLINE + RUSTUP_AUTO_INSTALL=0", () => {
    for (const sub of ["test", "build", "check"]) {
      const l = duyet(`cargo ${sub} --offline`);
      expect(l.argv).toEqual(["cargo", sub, "--offline"]);
      expect(l.env?.CARGO_NET_OFFLINE).toBe("true");
      expect(l.env?.RUSTUP_AUTO_INSTALL).toBe("0");
    }
  });

  it.each(["cargo test", "cargo build", "cargo install ripgrep", "cargo run --offline", "cargo fetch", "cargo build --offline --features x", "cargo --offline test"])(
    "★★★ %s ⇒ chặn (không --offline = tải crate + chạy build.rs của nó)",
    (l) => chan(l),
  );
});

describe("danh sách hiển thị + trần", () => {
  it("★★ MAU_LENH_HIEN_THI nêu đủ dạng mới (một nguồn cho lời nhắc + lời từ chối)", () => {
    for (const m of [
      "javac -d <out> <file.java…>",
      "java -cp <out> <MainClass>",
      "cmake -S . -B <build>",
      "cmake --build <build>",
      "ctest --test-dir <build>",
      "go test ./...",
      "go build ./...",
      "go vet ./...",
      "cargo test --offline",
      "cargo build --offline",
      "cargo check --offline",
    ]) {
      expect(MAU_LENH_HIEN_THI).toContain(m);
    }
  });

  it("★ mỗi khuôn mới có trần thời gian ≤ 300 s", () => {
    for (const t of ["javac", "java_run", "cmake_configure", "cmake_build", "ctest", "go_test", "go_build", "go_vet", "cargo_test", "cargo_build", "cargo_check"] as const) {
      expect(TRAN_MS_THEO_LENH[t], t).toBeGreaterThan(0);
      expect(TRAN_MS_THEO_LENH[t], t).toBeLessThanOrEqual(300_000);
    }
  });
});
