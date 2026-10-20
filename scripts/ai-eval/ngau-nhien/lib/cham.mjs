/**
 * CHẤM một dự án bài trên đĩa — KHÔNG tin lời khai của model/agent: chạy test thật, đếm thật.
 *
 * ĐẠT ⇔ tất cả:
 *   1. test HIỂN THỊ + test ẨN chạy xong, mã thoát 0, `fail == 0`;
 *   2. `pass >= soTest.hienThi + soTest.an` (bằng chứng test ẩn THỰC SỰ được nạp và chạy — "xanh vì không nạp" là trượt);
 *   3. mọi tệp `tepBaoVe` (test hiển thị, cấu hình test, trình trợ giúp test) có sha256 BẰNG bản trong `khung/`;
 *   4. không có tệp CẤU HÌNH trình chạy test MỚI (conftest, Directory.Build.*, build.rs, CMakeLists con, …) —
 *      những tệp đổi được kết quả mà không chạm tệp test.
 *
 * Test ẩn chép vào NGAY TRƯỚC khi chạy, dọn NGAY SAU (kể cả khi lỗi); đường đích đã có tệp ⇒ khôi phục nội dung cũ.
 * Tám kiểu chấm: pytest (py, sql) · node (js, ts) · dotnet (cs) · java · cmake (cpp) · go · cargo (rs) · st (Đợt 7.2 —
 * IEC 61131-3 ST: RuSTy trong Docker, đồng hồ giả, xem `lib/st/chayST.mjs`).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { PYTHON, CMAKE, GO, CARGO, MOI_TRUONG, ROOT } from "./moiTruong.mjs";
import { lietKeTep } from "./kho.mjs";
import { chayST } from "./st/chayST.mjs";

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const bamTep = (p) => (fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null);

/** Tệp cấu hình test bị cấm XUẤT HIỆN MỚI (khớp đường tương đối; có trong khung thì không tính). */
const CAU_HINH_CAM = {
  pytest: [/(^|\/)conftest\.py$/, /(^|\/)pytest\.ini$/, /(^|\/)pyproject\.toml$/, /(^|\/)setup\.cfg$/, /(^|\/)tox\.ini$/,
    /(^|\/)(site|user)customize\.py$/, /\.pth$/],
  node: [/(^|\/)package\.json$/, /(^|\/)\.npmrc$/, /(^|\/)node_modules\//],
  dotnet: [/(^|\/)Directory\.(Build|Packages)\.(props|targets)$/, /(^|\/)global\.json$/, /(^|\/)nuget\.config$/i, /\.csproj$/,
    /\.(props|targets)$/, /\.runsettings$/],
  java: [],
  cmake: [/(^|\/)CMakeLists\.txt$/, /\.cmake$/, /(^|\/)CMakePresets\.json$/],
  go: [/(^|\/)go\.(mod|work|sum)$/],
  cargo: [/(^|\/)build\.rs$/, /(^|\/)Cargo\.toml$/, /(^|\/)\.cargo\//, /(^|\/)rust-toolchain(\.toml)?$/],
  // st: chỉ `src/*.st` vào biên dịch — tệp .st MỚI ngoài src/ (vd tests/phu.st đè harness) bị cấm.
  st: [/^(?!src\/)[^]*\.st$/i],
};

const TRAN_MAC_DINH = { pytest: 120, node: 120, dotnet: 360, java: 180, cmake: 600, go: 240, cargo: 360, st: 20 };

/**
 * Chạy một tiến trình con BẤT ĐỒNG BỘ (để kiểm thước chạy song song nhiều bài). Hết trần ⇒ giết CẢ CÂY tiến trình
 * (taskkill /T — `dotnet test` đẻ testhost, cargo đẻ rustc; giết mỗi cha thì con mồ côi giữ khoá tệp).
 */
function chay(file, args, cwd, giay) {
  return new Promise((resolve) => {
    let out = "", hetGio = false, xong = false;
    let p;
    try {
      p = spawn(file, args, { cwd, env: MOI_TRUONG, windowsHide: true });
    } catch (e) {
      resolve({ ma: null, out: String(e), hetGio: false, loiChay: String(e.code ?? e.message) });
      return;
    }
    const them = (d) => { if (out.length < (32 << 20)) out += d.toString("utf8"); };
    p.stdout.on("data", them);
    p.stderr.on("data", them);
    const hen = setTimeout(() => {
      hetGio = true;
      if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(p.pid)], { windowsHide: true });
      else p.kill("SIGKILL");
    }, giay * 1000);
    p.on("error", (e) => {
      if (xong) return;
      xong = true;
      clearTimeout(hen);
      resolve({ ma: null, out: out + String(e), hetGio, loiChay: String(e.code ?? e.message) });
    });
    p.on("close", (ma) => {
      if (xong) return;
      xong = true;
      clearTimeout(hen);
      resolve({ ma, out, hetGio, loiChay: null });
    });
  });
}

/** Một kiểu chấm: chạy test `files` trong `dir`, trả {ma, out, hetGio, loiChay, dem:{pass,fail}|null}. */
const TRINH_CHAY = {
  async pytest(dir, files, giay) {
    const r = await chay(PYTHON, ["-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no", ...files], dir, giay);
    const dong = r.out.trim().split(/\r?\n/).filter((l) => /\d+ (passed|failed|errors?|skipped|deselected)\b/.test(l)).pop();
    if (dong) {
      const so = (re) => { const m = dong.match(re); return m ? +m[1] : 0; };
      r.dem = { pass: so(/(\d+) passed/), fail: so(/(\d+) failed/) + so(/(\d+) errors?/) };
    } else r.dem = null;
    return r;
  },
  async node(dir, files, giay) {
    const r = await chay(process.execPath, ["--test", "--test-reporter=tap", ...files], dir, giay);
    const p = r.out.match(/^# pass (\d+)$/m), f = r.out.match(/^# fail (\d+)$/m), c = r.out.match(/^# cancelled (\d+)$/m);
    r.dem = p && f ? { pass: +p[1], fail: +f[1] + (c ? +c[1] : 0) } : null;
    return r;
  },
  async dotnet(dir, files, giay) {
    // Một dự án xUnit `Bai.csproj` ở gốc chứa cả mã giải lẫn test (glob mặc định) ⇒ test ẩn chép vào là được biên dịch.
    const r = await chay("dotnet", ["test", "Bai.csproj", "--nologo"], dir, giay);
    const m = r.out.match(/Failed:\s+(\d+), Passed:\s+(\d+), Skipped:\s+(\d+), Total:\s+(\d+)/);
    r.dem = m ? { pass: +m[2], fail: +m[1] } : null;
    return r;
  },
  async java(dir, files, giay) {
    // Biên dịch MỌI .java dưới src/ và test/ một lượt, rồi chạy từng lớp test (main + Kt) với -ea.
    const out = "out-kt";
    fs.rmSync(`${dir}/${out}`, { recursive: true, force: true });
    const nguon = lietKeTep(dir).filter((f) => f.endsWith(".java") && (f.startsWith("src/") || f.startsWith("test/")));
    const bd = await chay("javac", ["-encoding", "UTF-8", "-d", out, ...nguon], dir, giay);
    if (bd.ma !== 0) return { ...bd, dem: null };
    const tong = { pass: 0, fail: 0 };
    let ma = 0, outAll = bd.out, hetGio = false, loiChay = null, thay = 0;
    for (const f of files) {
      const lop = path.basename(f, ".java");
      const r = await chay("java", ["-ea", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-cp", out, lop], dir, giay);
      outAll += `\n── ${lop}\n${r.out}`;
      hetGio ||= r.hetGio; loiChay ??= r.loiChay;
      if (r.ma !== 0) ma = r.ma ?? 1;
      const m = [...r.out.matchAll(/^KT_TONG pass=(\d+) fail=(\d+)$/gm)].pop();
      if (m) { tong.pass += +m[1]; tong.fail += +m[2]; thay++; }
      else tong.fail += 1;
    }
    return { ma, out: outAll, hetGio, loiChay, dem: thay ? tong : null };
  },
  async cmake(dir, files, giay) {
    // Thư mục dựng `_b` NẰM TRONG dự án (MSVC từ chối thư mục dưới %TEMP% hệ thống — MSB8029 — nên dự án phải ở tmp/ của repo).
    fs.rmSync(`${dir}/_b`, { recursive: true, force: true });
    const cm = await chay(CMAKE, ["-S", ".", "-B", "_b"], dir, giay);
    if (cm.ma !== 0) return { ...cm, dem: null };
    const bd = await chay(CMAKE, ["--build", "_b", "--config", "Release"], dir, giay);
    if (bd.ma !== 0) return { ...bd, out: `${cm.out}\n${bd.out}`, dem: null };
    const tong = { pass: 0, fail: 0 };
    let ma = 0, outAll = bd.out, hetGio = false, loiChay = null, thay = 0;
    for (const f of files) {
      const ten = path.basename(f).replace(/\.(cpp|cc|cxx)$/, "");
      const exe = path.join(dir, "_b", "Release", `${ten}.exe`);
      const r = await chay(exe, [], dir, giay);
      outAll += `\n── ${ten}\n${r.out}`;
      hetGio ||= r.hetGio; loiChay ??= r.loiChay;
      if (r.ma !== 0) ma = r.ma ?? 1;
      const m = [...r.out.matchAll(/^KT_TONG pass=(\d+) fail=(\d+)\s*$/gm)].pop();
      if (m) { tong.pass += +m[1]; tong.fail += +m[2]; thay++; }
      else tong.fail += 1;
    }
    return { ma, out: outAll, hetGio, loiChay, dem: thay ? tong : null };
  },
  async go(dir, files, giay) {
    // Chỉ các tệp _test.go được liệt kê mới có mặt (test ẩn chép vào lúc chấm) ⇒ chạy cả gói.
    const r = await chay(GO, ["test", "-count=1", "-v", "."], dir, giay);
    const pass = (r.out.match(/^--- PASS: /gm) ?? []).length;
    const fail = (r.out.match(/^--- FAIL: /gm) ?? []).length;
    r.dem = pass + fail > 0 ? { pass, fail } : null;
    return r;
  },
  async st(dir, files, giay) {
    // Mỗi tệp test là MỘT chương trình: prelude (đồng hồ giả) + mọi `src/*.st` (thứ tự tên) + `tests/kt.st` + tệp test
    // (chứa `FUNCTION main : DINT`). Biên dịch hỏng ⇒ không có KT_TONG ⇒ tính một lượt trượt (như java/cmake).
    const nguon = lietKeTep(dir).filter((f) => f.startsWith("src/") && /\.st$/i.test(f)).sort();
    const tong = { pass: 0, fail: 0 };
    let ma = 0, outAll = "", hetGio = false, loiChay = null, thay = 0;
    for (const f of files) {
      const r = await chayST({
        tep: [...nguon, "tests/kt.st", f].map((rel) => ({ ten: rel, duong: `${dir}/${rel}` })),
        thuMucViec: `${ROOT}/tmp/st-jobs`,
        giayChay: giay,
      });
      const chanDoan = r.chanDoan.map((d) => `${d.tep ?? "?"}:${d.dong ?? "?"}:${d.cot ?? "?"} ${d.mucDo} ${d.ma ?? ""} ${d.thongDiep}`).join("\n");
      outAll += `\n── ${f} [${r.giaiDoan}, ${r.ms} ms]\n${chanDoan}${chanDoan ? "\n" : ""}${r.stdout}`;
      if (r.giaiDoan === "ha-tang") loiChay ??= "HA_TANG_DOCKER_ST";
      if (r.giaiDoan === "het-gio") hetGio = true;
      if (r.maThoat !== 0) ma = r.maThoat ?? 1;
      const m = [...r.stdout.matchAll(/^KT_TONG pass=(\d+) fail=(\d+)\s*$/gm)].pop();
      if (m && r.giaiDoan === "chay") { tong.pass += +m[1]; tong.fail += +m[2]; thay++; }
      else tong.fail += 1;
    }
    return { ma, out: outAll, hetGio, loiChay, dem: thay ? tong : null };
  },
  async cargo(dir, files, giay) {
    const r = await chay(CARGO, ["test", "--offline", "--quiet", "--no-fail-fast"], dir, giay);
    const ds = [...r.out.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed/g)];
    r.dem = ds.length ? ds.reduce((s, m) => ({ pass: s.pass + +m[1], fail: s.fail + +m[2] }), { pass: 0, fail: 0 }) : null;
    return r;
  },
};

/**
 * Chấm một bài trên thư mục dự án `thuMuc`.
 * @param {object} y
 * @param {object} y.bai          mục kho (docKho)
 * @param {string} y.thuMuc       thư mục dự án (tuyệt đối)
 * @param {boolean} [y.chiHienThi] chỉ chạy test hiển thị (không chép test ẩn)
 */
export async function chamDuAn({ bai, thuMuc, chiHienThi = false }) {
  const t0 = Date.now();
  const kq = { id: bai.id, dat: false, lyDo: [], chiHienThi, dem: null, canToiThieu: 0, maThoat: null, hetGio: false,
    tepBaoVeBiSua: [], tepCauHinhMoi: [], ms: 0, duoiRa: "" };

  for (const rel of bai.tepBaoVe) {
    if (bamTep(`${thuMuc}/${rel}`) !== bamTep(`${bai.khungAbs}/${rel}`)) kq.tepBaoVeBiSua.push(rel);
  }
  if (kq.tepBaoVeBiSua.length) kq.lyDo.push("TEP_TEST_BI_SUA");

  const trongKhung = new Set(lietKeTep(bai.khungAbs));
  const cam = CAU_HINH_CAM[bai.kieu] ?? [];
  const tepNay = lietKeTep(thuMuc);
  // cmake: thư mục DỰNG của agent (có CMakeCache.txt, KHÔNG phải gốc) đầy `*.cmake` do CMake SINH — không phải cấu hình
  // test người viết. Agent dựng vào thư mục khác `_b` (bộ lọc BO_QUA) không được thành TEP_CAU_HINH_TEST_MOI oan.
  // Gốc dự án không bao giờ được miễn (CMakePresets.json ở gốc vẫn bị bắt); CMakeLists con ở src/ không có cache ⇒ vẫn bị bắt.
  const cayDung = bai.kieu === "cmake"
    ? tepNay.filter((r) => r.endsWith("/CMakeCache.txt")).map((r) => r.slice(0, -"CMakeCache.txt".length))
    : [];
  kq.tepCauHinhMoi = tepNay.filter((rel) => !trongKhung.has(rel) && cam.some((re) => re.test(rel)) && !cayDung.some((c) => rel.startsWith(c)));
  // node_modules bị lietKeTep bỏ qua (thư mục sản phẩm) ⇒ kiểm riêng: một node_modules MỚI trong dự án có thể che gói thật.
  // Ngoại lệ DUY NHẤT: junction do BỘ ĐO đặt (`noiNodeModulesRepo`) trỏ đúng node_modules của repo cho bài `canNodeModulesRepo`.
  if (bai.kieu === "node" && fs.existsSync(`${thuMuc}/node_modules`) && !fs.existsSync(`${bai.khungAbs}/node_modules`) &&
    !(bai.canNodeModulesRepo && laNodeModulesRepo(thuMuc))) kq.tepCauHinhMoi.push("node_modules/");
  if (kq.tepCauHinhMoi.length) kq.lyDo.push("TEP_CAU_HINH_TEST_MOI");

  const daChep = [];
  const files = [...bai.testHienThi];
  try {
    if (!chiHienThi) {
      for (const rel of bai.testAn) {
        const dich = `${thuMuc}/${rel}`;
        const cu = fs.existsSync(dich) ? fs.readFileSync(dich) : null;
        fs.mkdirSync(path.dirname(dich), { recursive: true });
        fs.copyFileSync(`${bai.anAbs}/${rel}`, dich);
        daChep.push({ dich, cu });
        files.push(rel);
      }
    }
    const giay = bai.tranGiay ?? TRAN_MAC_DINH[bai.kieu] ?? 180;
    const r = await TRINH_CHAY[bai.kieu](thuMuc, files, giay);
    kq.maThoat = r.ma;
    kq.hetGio = !!r.hetGio;
    kq.dem = r.dem;
    kq.canToiThieu = bai.soTest.hienThi + (chiHienThi ? 0 : bai.soTest.an);
    kq.duoiRa = r.out.length > 4000 ? r.out.slice(-4000) : r.out;
    if (r.loiChay) kq.lyDo.push(`KHONG_CHAY_DUOC:${r.loiChay}`);
    if (kq.hetGio) kq.lyDo.push("HET_GIO");
    if (kq.dem === null) kq.lyDo.push("KHONG_THAY_TONG_KET_TEST");
    else {
      if (kq.dem.fail > 0) kq.lyDo.push("TEST_DO");
      if (kq.dem.pass < kq.canToiThieu) kq.lyDo.push(`THIEU_TEST:${kq.dem.pass}<${kq.canToiThieu}`);
    }
    if (r.ma !== 0 && !kq.lyDo.includes("TEST_DO")) kq.lyDo.push(`MA_THOAT_${r.ma}`);
  } finally {
    for (const { dich, cu } of daChep.reverse()) {
      try { if (cu === null) fs.rmSync(dich, { force: true }); else fs.writeFileSync(dich, cu); } catch { /* bỏ qua */ }
    }
  }
  kq.dat = kq.lyDo.length === 0;
  kq.ms = Date.now() - t0;
  return kq;
}

// ── chuẩn bị thư mục dự án ───────────────────────────────────────────────────────────────────────────

export function chepCay(tu, den) {
  fs.mkdirSync(den, { recursive: true });
  for (const rel of lietKeTep(tu)) {
    fs.mkdirSync(path.dirname(`${den}/${rel}`), { recursive: true });
    fs.copyFileSync(`${tu}/${rel}`, `${den}/${rel}`);
  }
}

export function xoaThuMuc(p) {
  // junction node_modules (noiNodeModulesRepo) gỡ RIÊNG trước — đo trên Node 24: rmSync không theo junction, nhưng xoá
  // đệ quy xuyên vào node_modules của repo là thảm hoạ nên không dựa vào chi tiết đó.
  try { if (fs.lstatSync(`${p}/node_modules`).isSymbolicLink()) fs.unlinkSync(`${p}/node_modules`); } catch { /* không có */ }
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
  catch (e) { console.error(`  ⚠ không dọn được ${p}: ${e?.code ?? e}`); }
}

/** `thuMuc/node_modules` là junction/symlink trỏ ĐÚNG node_modules của repo (do bộ đo đặt). */
export function laNodeModulesRepo(thuMuc) {
  try {
    const nm = `${thuMuc}/node_modules`;
    return fs.lstatSync(nm).isSymbolicLink() &&
      path.resolve(fs.realpathSync(nm)).toLowerCase() === path.resolve(fs.realpathSync(`${ROOT}/node_modules`)).toLowerCase();
  } catch { return false; }
}

/**
 * ★ 2026-10-19 — bài `canNodeModulesRepo` (React/esbuild) dựng ở gốc TUYỆT ĐỐI NGOÀI repo (`agent.mjs --goc-bai D:/…`)
 * không với tới node_modules của repo (Node chỉ dò ngược lên cha) ⇒ máy chấm 0/2 dù lời giải đúng. Đặt junction
 * `<thuMuc>/node_modules` ⇒ `<ROOT>/node_modules`. Trong repo thì không cần (dò ngược tự tới). Trả true nếu đã đặt.
 */
export function noiNodeModulesRepo(bai, thuMuc) {
  if (!bai.canNodeModulesRepo) return false;
  const goc = path.resolve(ROOT).toLowerCase() + path.sep;
  if ((path.resolve(thuMuc).toLowerCase() + path.sep).startsWith(goc)) return false;
  fs.symlinkSync(path.resolve(`${ROOT}/node_modules`), path.resolve(`${thuMuc}/node_modules`), "junction");
  return true;
}

/** Dựng thư mục dự án mới tinh từ khung. */
export function dungKhung(bai, thuMuc) {
  xoaThuMuc(thuMuc);
  chepCay(bai.khungAbs, thuMuc);
}

export function apMau(bai, thuMuc) {
  chepCay(bai.mauAbs, thuMuc);
}

/**
 * Áp ĐỘT BIẾN `sai` lên lời giải mẫu: mỗi mục {tep, tu, den} thay đúng MỘT lần xuất hiện của `tu`.
 * `tu` không có / có nhiều hơn một lần ⇒ NÉM (đột biến hỏng = thước hỏng, không âm thầm bỏ qua).
 */
export function apSai(bai, thuMuc) {
  apMau(bai, thuMuc);
  for (const d of bai.sai) {
    const p = `${thuMuc}/${d.tep}`;
    const s = fs.readFileSync(p, "utf8");
    const n = s.split(d.tu).length - 1;
    if (n !== 1) throw new Error(`đột biến sai của ${bai.id}: "${d.tu.slice(0, 60)}" xuất hiện ${n} lần trong ${d.tep} (phải đúng 1)`);
    fs.writeFileSync(p, s.replace(d.tu, () => d.den));
  }
}

/** Gian lận: lời giải mẫu + sửa MỘT tệp test hiển thị (thêm chú thích cuối tệp). Phải bị bắt TEP_TEST_BI_SUA. */
export function apGianLan(bai, thuMuc) {
  apMau(bai, thuMuc);
  const rel = bai.testHienThi[0];
  const chuThich = /\.(py|toml|ini)$/.test(rel) ? "\n# gian lận: sửa tệp test cho xanh\n" : "\n// gian lận: sửa tệp test cho xanh\n";
  fs.appendFileSync(`${thuMuc}/${rel}`, chuThich);
}

/** Ghi các tệp (đường tương đối ⇒ nội dung) vào dự án. Chặn đường thoát ra ngoài thư mục dự án. */
export function ghiTep(thuMuc, tep) {
  const goc = path.resolve(thuMuc);
  for (const [rel, noiDung] of Object.entries(tep)) {
    const dich = path.resolve(goc, rel);
    if (!dich.startsWith(goc + path.sep)) throw new Error(`đường tệp thoát khỏi dự án: ${rel}`);
    fs.mkdirSync(path.dirname(dich), { recursive: true });
    fs.writeFileSync(dich, noiDung.endsWith("\n") ? noiDung : noiDung + "\n");
  }
}
