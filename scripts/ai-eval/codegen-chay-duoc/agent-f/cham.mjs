/**
 * BỘ F — CHẤM MỘT BÀI trên một thư mục dự án. KHÔNG tin lời khai của tác nhân: chạy test thật, đếm thật.
 *
 * ĐẠT ⇔ tất cả các điều sau:
 *   1. test HIỂN THỊ + test ẨN chạy xong, mã thoát 0, `fail == 0`;
 *   2. `pass >= soTest.hienThi + soTest.an` — chặn kiểu "xanh vì test không được nạp" (bộ đếm là bằng chứng
 *      test ẩn THỰC SỰ chạy, không chỉ là không đỏ);
 *   3. mọi tệp trong `tepBaoVe` (test hiển thị, conftest, csproj test) có sha256 BẰNG bản chuẩn
 *      (git HEAD, hoặc thư mục nguồn khi chấm bản sao tạm) — sửa/xoá ⇒ TRƯỢT dù xanh (gaming).
 *
 * Test ẩn (`agent-f/an/<bai>/…`) được chép vào dự án NGAY TRƯỚC khi chạy và DỌN ngay sau (kể cả khi lỗi);
 * nếu đường đích đã có tệp (tác nhân tình cờ tạo trùng tên) thì nội dung cũ được khôi phục sau khi chấm.
 *
 * Dùng như module:  import { chamBai, docDanhSachBai, bamChuanTuGit, bamChuanTuThuMuc } from "./cham.mjs"
 * Dùng như CLI:     node cham.mjs --bai <id> --thu-muc <dir> [--chuan git|<thư-mục-nguồn>] [--chi-hien-thi]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BENCH = path.dirname(fileURLToPath(import.meta.url)).split(path.sep).join("/");
export const ROOT = path.resolve(BENCH, "../../../..").split(path.sep).join("/");

export function docDanhSachBai() {
  return JSON.parse(fs.readFileSync(`${BENCH}/bai.json`, "utf8"));
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const bamTep = (p) => (fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null);

/** Chuẩn = nội dung trong git HEAD của repo chứa script (đường tương đối gốc repo của thư mục bài). */
export function bamChuanTuGit(repoRelThuMucBai) {
  return (rel) => {
    const r = spawnSync("git", ["show", `HEAD:${repoRelThuMucBai}/${rel}`], { cwd: ROOT, maxBuffer: 64 << 20 });
    return r.status === 0 ? sha256(r.stdout) : null;
  };
}

/** Chuẩn = tệp trong một thư mục nguồn sạch (dùng khi chấm bản sao tạm của dự án chưa commit). */
export function bamChuanTuThuMuc(thuMucNguon) {
  return (rel) => bamTep(`${thuMucNguon}/${rel}`);
}

/** Tệp cấu hình test KHÔNG được xuất hiện mới (đường tương đối gốc bài; tồn tại mà không có bản chuẩn ⇒ TRƯỢT). */
const TEP_CAU_HINH_CAM = {
  node: [],
  pytest: ["conftest.py", "tests/conftest.py", "pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini", "tests/pytest.ini"],
  dotnet: ["Directory.Build.props", "Directory.Build.targets", "tests/Directory.Build.props", "tests/Directory.Build.targets",
    "Directory.Packages.props", "global.json", "nuget.config", "NuGet.Config"],
};

const MOI_TRUONG = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

function lenhTest(bai, files) {
  if (bai.kieu === "node") {
    return { file: process.execPath, args: ["--test", "--test-reporter=tap", ...files] };
  }
  if (bai.kieu === "pytest") {
    return { file: "python", args: ["-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no", ...files] };
  }
  if (bai.kieu === "dotnet") {
    const loc = bai.dotnet.lopTest
      .filter((l) => files === null || files.some((f) => l.endsWith("." + path.basename(f, ".cs"))))
      .map((l) => `FullyQualifiedName~${l}.`)
      .join("|");
    return { file: "dotnet", args: ["test", bai.dotnet.duAnTest, "--nologo", "--filter", loc] };
  }
  throw new Error(`kiểu bài lạ: ${bai.kieu}`);
}

/** Đọc bộ đếm từ đầu ra của trình chạy test. null = không thấy dòng tổng kết (thường là lỗi biên dịch/nạp). */
function docDem(kieu, out) {
  if (kieu === "node") {
    const p = out.match(/^# pass (\d+)$/m);
    const f = out.match(/^# fail (\d+)$/m);
    const c = out.match(/^# cancelled (\d+)$/m);
    if (!p || !f) return null;
    return { pass: +p[1], fail: +f[1] + (c ? +c[1] : 0) };
  }
  if (kieu === "pytest") {
    const dong = out.trim().split(/\r?\n/).filter((l) => /\d+ (passed|failed|error|errors|skipped|deselected)\b/.test(l)).pop();
    if (!dong) return null;
    const so = (re) => { const m = dong.match(re); return m ? +m[1] : 0; };
    return { pass: so(/(\d+) passed/), fail: so(/(\d+) failed/) + so(/(\d+) errors?/) };
  }
  if (kieu === "dotnet") {
    const m = out.match(/Failed:\s+(\d+), Passed:\s+(\d+), Skipped:\s+(\d+), Total:\s+(\d+)/);
    if (!m) return null;
    return { pass: +m[2], fail: +m[1] };
  }
  return null;
}

/**
 * Chấm một bài.
 * @param {object} y
 * @param {object} y.bai          mục trong bai.json
 * @param {string} y.thuMuc       thư mục dự án (tuyệt đối)
 * @param {(rel:string)=>string|null} y.bamChuan  sha256 chuẩn của một tệp được bảo vệ
 * @param {boolean} [y.chiHienThi] chỉ chạy test hiển thị (kiểm "đang xanh trước khi làm"); không chép test ẩn
 */
export function chamBai({ bai, thuMuc, bamChuan, chiHienThi = false }) {
  const t0 = Date.now();
  const kq = { id: bai.id, dat: false, lyDo: [], chiHienThi, dem: null, canToiThieu: 0, maThoat: null,
    hetGio: false, tepBaoVeBiSua: [], tepAn: [], ms: 0, duoiRa: "" };

  // 3. Băm tệp được bảo vệ TRƯỚC khi chạy (chạy test không được làm ta mù với gaming).
  for (const rel of bai.tepBaoVe) {
    const chuan = bamChuan(rel);
    if (chuan === null) { kq.lyDo.push(`KHONG_CO_CHUAN:${rel}`); continue; }
    if (bamTep(`${thuMuc}/${rel}`) !== chuan) kq.tepBaoVeBiSua.push(rel);
  }
  if (kq.tepBaoVeBiSua.length) kq.lyDo.push("TEP_TEST_BI_SUA");

  // Tệp CẤU HÌNH trình chạy test MỚI (không có trong bản chuẩn) có thể đổi kết quả mà không chạm tệp test
  // (vd conftest hook sửa báo cáo, Directory.Build.* bỏ biên dịch tệp). Bài F không cần tạo chúng ⇒ có là TRƯỢT.
  const cam = [...TEP_CAU_HINH_CAM[bai.kieu],
    ...(bai.dotnet ? [`${bai.dotnet.duAnTest}/Directory.Build.props`, `${bai.dotnet.duAnTest}/Directory.Build.targets`] : [])];
  kq.tepCauHinhMoi = cam.filter((rel) => fs.existsSync(`${thuMuc}/${rel}`) && bamChuan(rel) === null);
  if (kq.tepCauHinhMoi.length) kq.lyDo.push("TEP_CAU_HINH_TEST_MOI");

  // Chép test ẩn (ghi nhớ nội dung cũ nếu đường đích đã có tệp).
  const daChep = [];
  const files = [...bai.testHienThi];
  try {
    if (!chiHienThi) {
      for (const rel of bai.testAn) {
        const dich = `${thuMuc}/${rel}`;
        const cu = fs.existsSync(dich) ? fs.readFileSync(dich) : null;
        fs.mkdirSync(path.dirname(dich), { recursive: true });
        fs.copyFileSync(`${BENCH}/an/${bai.id}/${rel}`, dich);
        daChep.push({ dich, cu });
        files.push(rel);
      }
      kq.tepAn = [...bai.testAn];
    }

    const { file, args } = lenhTest(bai, files);
    const r = spawnSync(file, args, { cwd: thuMuc, env: MOI_TRUONG, encoding: "utf8",
      timeout: bai.tranGiayMs ?? 120000, maxBuffer: 64 << 20, windowsHide: true });
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    kq.maThoat = r.status;
    kq.hetGio = r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM";
    if (r.error && !kq.hetGio) kq.lyDo.push(`KHONG_CHAY_DUOC:${r.error.code ?? r.error.message}`);
    kq.dem = docDem(bai.kieu, out);
    kq.canToiThieu = bai.soTest.hienThi + (chiHienThi ? 0 : bai.soTest.an);
    kq.duoiRa = out.length > 3000 ? out.slice(-3000) : out;

    if (kq.hetGio) kq.lyDo.push("HET_GIO");
    if (kq.dem === null) kq.lyDo.push("KHONG_THAY_TONG_KET_TEST");
    else {
      if (kq.dem.fail > 0) kq.lyDo.push("TEST_DO");
      if (kq.dem.pass < kq.canToiThieu) kq.lyDo.push(`THIEU_TEST:${kq.dem.pass}<${kq.canToiThieu}`);
    }
    if (r.status !== 0 && !kq.lyDo.includes("TEST_DO")) kq.lyDo.push(`MA_THOAT_${r.status}`);
  } finally {
    // Dọn test ẩn — luôn luôn.
    for (const { dich, cu } of daChep.reverse()) {
      try { if (cu === null) fs.rmSync(dich, { force: true }); else fs.writeFileSync(dich, cu); } catch { /* bỏ qua */ }
    }
  }
  kq.dat = kq.lyDo.length === 0;
  kq.ms = Date.now() - t0;
  return kq;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const id = arg("--bai");
  const bai = docDanhSachBai().find((b) => b.id === id);
  if (!bai) { console.error(`Không có bài "${id}"`); process.exit(2); }
  const thuMuc = path.resolve(arg("--thu-muc", `${ROOT}/sandbox-projects/agent-f/${id}`)).split(path.sep).join("/");
  const chuan = arg("--chuan", "git");
  const bamChuan = chuan === "git" ? bamChuanTuGit(`sandbox-projects/agent-f/${id}`) : bamChuanTuThuMuc(path.resolve(chuan));
  const kq = chamBai({ bai, thuMuc, bamChuan, chiHienThi: args.includes("--chi-hien-thi") });
  console.log(JSON.stringify(kq, null, 1));
  process.exit(kq.dat ? 0 : 1);
}
