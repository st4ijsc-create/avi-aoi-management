/**
 * MultiPL-E — CHẠY chương trình đã ghép (đề + lời giải + tests) — ĐẠT ⇔ biên dịch được VÀ thoát 0 trong trần thời gian.
 * Mỗi chương trình một thư mục riêng dưới `tmp/` của repo (MSVC từ chối thư mục dựng dưới %TEMP% hệ thống).
 *
 *   py   python prog.py                         java  java -ea -cp javatuples-1.2.jar Problem.java (source launcher)
 *   js   node prog.js (CommonJS)               cs    dotnet run (Debug ⇒ Debug.Assert có hiệu lực)
 *   ts   node prog.ts (tự bóc kiểu, CommonJS)  cpp   MỘT dự án CMake cho cả lô, mỗi bài một target; Release KHÔNG NDEBUG
 *   go   go test (tệp prog_test.go)            rs    rustc --edition 2021 -O
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { PYTHON, CMAKE, GO, RUSTC, MOI_TRUONG } from "../lib/moiTruong.mjs";

function chay(file, args, cwd, giay) {
  return new Promise((resolve) => {
    let out = "", hetGio = false, xong = false;
    let p;
    try { p = spawn(file, args, { cwd, env: MOI_TRUONG, windowsHide: true }); }
    catch (e) { resolve({ ma: null, out: String(e), hetGio: false }); return; }
    const them = (d) => { if (out.length < (4 << 20)) out += d.toString("utf8"); };
    p.stdout.on("data", them);
    p.stderr.on("data", them);
    const hen = setTimeout(() => {
      hetGio = true;
      if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { windowsHide: true });
      else p.kill("SIGKILL");
    }, giay * 1000);
    p.on("error", (e) => { if (xong) return; xong = true; clearTimeout(hen); resolve({ ma: null, out: out + String(e), hetGio }); });
    p.on("close", (ma) => { if (xong) return; xong = true; clearTimeout(hen); resolve({ ma, out, hetGio }); });
  });
}
const ketQua = (r) => ({ dat: r.ma === 0 && !r.hetGio, hetGio: r.hetGio, duoiRa: r.out.slice(-1200) });

/** Header thay `<bits/stdc++.h>` của GCC cho MSVC + tắt hộp thoại abort (assert ⇒ chỉ thoát mã ≠ 0). */
const SHIM_STDCXX = `#pragma once
#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <cctype>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <limits>
#include <list>
#include <map>
#include <numeric>
#include <optional>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>
#ifdef _MSC_VER
#include <crtdbg.h>
namespace mpe_shim {
struct TatHopThoai { TatHopThoai() { _set_abort_behavior(0, _WRITE_ABORT_MSG | _CALL_REPORTFAULT); _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE); _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR); } };
static TatHopThoai tatHopThoai;
}
#endif
`;

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>disable</Nullable>
    <LangVersion>latest</LangVersion>
    <TreatWarningsAsErrors>false</TreatWarningsAsErrors>
    <NoWarn>$(NoWarn);CS8981;CS0168;CS0219;CS0162</NoWarn>
  </PropertyGroup>
</Project>
`;

/**
 * Chạy MỘT lô chương trình cùng ngôn ngữ. `ds` = [{khoa, prog}] ⇒ Map khoa ⇒ {dat, hetGio, duoiRa}.
 * `goc` = thư mục làm việc của lô (tuyệt đối, dưới tmp/ của repo). `duLieu` = thư mục dữ liệu (javatuples).
 */
export async function chayLo(lang, ds, { goc, duLieu, songSong = 4 }) {
  fs.mkdirSync(goc, { recursive: true });
  const kq = new Map();
  if (lang === "cpp") return chayLoCpp(ds, goc, kq);
  let i = 0;
  const tho = async () => {
    while (i < ds.length) {
      const { khoa, prog } = ds[i++];
      const dir = path.join(goc, khoa.replace(/[^\w.-]/g, "_"));
      fs.mkdirSync(dir, { recursive: true });
      kq.set(khoa, await chayMot(lang, prog, dir, duLieu));
    }
  };
  await Promise.all(Array.from({ length: Math.min(lang === "cs" ? 2 : songSong, ds.length) }, tho));
  return kq;
}

async function chayMot(lang, prog, dir, duLieu) {
  switch (lang) {
    case "py":
      fs.writeFileSync(`${dir}/prog.py`, prog);
      return ketQua(await chay(PYTHON, ["prog.py"], dir, 30));
    case "js":
    case "ts": {
      fs.writeFileSync(`${dir}/package.json`, '{"type":"commonjs"}\n');
      const tep = lang === "js" ? "prog.js" : "prog.ts";
      fs.writeFileSync(`${dir}/${tep}`, prog);
      return ketQua(await chay(process.execPath, lang === "ts" ? ["--experimental-transform-types", "--no-warnings", tep] : [tep], dir, 30));
    }
    case "go":
      fs.writeFileSync(`${dir}/go.mod`, "module mpe\n\ngo 1.24\n");
      fs.writeFileSync(`${dir}/prog_test.go`, prog);
      return ketQua(await chay(GO, ["test", "-count=1", "."], dir, 120));
    case "java":
      fs.writeFileSync(`${dir}/Problem.java`, prog);
      return ketQua(await chay("java", ["-ea", "-cp", path.join(duLieu, "javatuples-1.2.jar"), "Problem.java"], dir, 60));
    case "cs": {
      fs.writeFileSync(`${dir}/p.csproj`, CSPROJ);
      fs.writeFileSync(`${dir}/Program.cs`, prog);
      return ketQua(await chay("dotnet", ["run", "--project", "p.csproj", "-v", "q", "--nologo"], dir, 240));
    }
    case "rs": {
      fs.writeFileSync(`${dir}/prog.rs`, prog);
      const bd = await chay(RUSTC, ["--edition", "2021", "-O", "--crate-name", "prog", "-o", "prog.exe", "prog.rs"], dir, 180);
      if (bd.ma !== 0) return ketQua(bd);
      return ketQua(await chay(path.join(dir, "prog.exe"), [], dir, 30));
    }
    default:
      return { dat: false, duoiRa: `ngôn ngữ lạ ${lang}` };
  }
}

/** C++: một dự án CMake cho cả lô (cấu hình MSVC một lần), dựng từng target riêng để lỗi một bài không chặn bài khác. */
async function chayLoCpp(ds, goc, kq) {
  fs.mkdirSync(`${goc}/shim/bits`, { recursive: true });
  fs.writeFileSync(`${goc}/shim/bits/stdc++.h`, SHIM_STDCXX);
  const ten = (k) => "p_" + k.replace(/[^\w]/g, "_");
  for (const { khoa, prog } of ds) fs.writeFileSync(`${goc}/${ten(khoa)}.cpp`, prog);
  fs.writeFileSync(`${goc}/CMakeLists.txt`, [
    "cmake_minimum_required(VERSION 3.20)",
    "project(mpe CXX)",
    "set(CMAKE_CXX_STANDARD 17)",
    "if(MSVC)",
    '  add_compile_options(/utf-8 /EHsc /permissive- /bigobj /w)',
    '  string(REPLACE "/DNDEBUG" "" CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE}")',
    "endif()",
    ...ds.map(({ khoa }) => `add_executable(${ten(khoa)} ${ten(khoa)}.cpp)\ntarget_include_directories(${ten(khoa)} PRIVATE \${CMAKE_SOURCE_DIR}/shim)`),
    "",
  ].join("\n"));
  const cm = await chay(CMAKE, ["-S", ".", "-B", "_b"], goc, 300);
  if (cm.ma !== 0) {
    for (const { khoa } of ds) kq.set(khoa, { dat: false, hetGio: false, duoiRa: "CMAKE cấu hình hỏng: " + cm.out.slice(-800) });
    return kq;
  }
  for (const { khoa } of ds) {
    const bd = await chay(CMAKE, ["--build", "_b", "--config", "Release", "--target", ten(khoa)], goc, 300);
    if (bd.ma !== 0) { kq.set(khoa, ketQua(bd)); continue; }
    kq.set(khoa, ketQua(await chay(path.join(goc, "_b", "Release", `${ten(khoa)}.exe`), [], goc, 30)));
  }
  return kq;
}
