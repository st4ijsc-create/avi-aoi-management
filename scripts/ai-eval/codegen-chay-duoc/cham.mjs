/**
 * BỘ CHẤM "SINH ĐƯỢC MÃ CHẠY ĐƯỢC" — MỘT nguồn cho hai người dùng:
 *   • `run.mjs` (bộ đo dòng lệnh, trục M/H, kiểm thước fake-ok/fake-bad);
 *   • Training Studio "Eval mã" (`server/services/kbStudioEvalMa.ts`, AI Local Đợt 5.2) — chạy NỀN trong tiến trình
 *     máy chủ, nên mọi lượt chạy là BẤT ĐỒNG BỘ (`execFile`, không `execSync`: `dotnet run` 240 s đồng bộ sẽ đóng băng
 *     vòng sự kiện của máy chủ) và nhận `AbortSignal` (nút Huỷ giết tiến trình con đang chạy).
 *
 * Tách từ `run.mjs` 2026-10-17 KHÔNG đổi hành vi chấm: cùng trích khối mã (ưu tiên khối mang định danh bài), cùng bốn
 * trình chạy, cùng trần thời gian, cùng cách đọc kết quả (thoát 0 = ĐẠT). Kiểm bằng thước: fake-ok 12/12, fake-bad 0/12.
 * Khác duy nhất: lệnh đi `execFile` (tham số mảng, không qua shell) thay vì chuỗi `execSync` — không còn trích dẫn
 * đường CMake có dấu cách bằng tay.
 *
 * ⚠ Chạy MÃ DO MODEL SINH trên máy này (CPU: node / python / dotnet / MSVC). Ở máy chủ, chỉ chạy sau cờ
 * `KB_STUDIO_EVAL_MA_ENABLED=true` + admin + 2FA (xem `kbStudioEvalMa.ts`). Không chạm GPU.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const BENCH = path.dirname(fileURLToPath(import.meta.url));

/** Lời hệ thống của trục M (model thuần) — Studio dùng CÙNG câu để số Studio so được với số bộ đo. */
export const SYS = "Bạn là trợ lý lập trình. Trả lời bằng ĐÚNG MỘT khối mã trong dấu ``` và không thêm lời giải thích nào ngoài khối mã đó.";

/** CMake không nằm trên PATH của shell này — ghim đường tuyệt đối đã ĐO được, không đoán. */
const CMAKE = fs.existsSync("C:/Program Files/CMake/bin/cmake.exe") ? "C:/Program Files/CMake/bin/cmake.exe" : "cmake";

/** Định danh bài (tên ký hiệu bài kiểm import) — để `trichMa` chọn đúng khối khi đường ống trả kèm mã repo. */
export function dinhDanhBai(t) {
  return (
    (t.test.match(/import\s*\{\s*([A-Za-z_$][\w$]*)/) ||
      t.test.match(/from sol import\s+([A-Za-z_][\w]*)/) ||
      t.test.match(/([A-Z][A-Za-z0-9]+)\.[A-Z]/) ||
      [])[1] || t.name
  );
}

/** Trích khối mã từ câu trả lời. */
export function trichMa(text, lang, dinhDanh) {
  const fences = [...text.matchAll(/```[a-zA-Z#+]*\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (fences.length) {
    // ★ ƯU TIÊN khối mang ĐỊNH DANH bài yêu cầu. Đường ống trả kèm NGỮ CẢNH REPO, trong đó có
    //   khối mã dài hơn nhiều — lấy "dài nhất" là lấy nhầm tệp của repo (đã đo: 21.638 ký tự
    //   trong khi model thật chỉ sinh 2.002).
    if (dinhDanh) {
      const trung = fences.filter((f) => f.includes(dinhDanh));
      if (trung.length) return trung.sort((a, b) => b.length - a.length)[0].trim();
    }
    const key = lang === "cs" ? /class|namespace/ : lang === "cpp" ? /#include|template|struct|class/ : lang === "py" ? /def\s/ : /function|=>|const|export/;
    const good = fences.filter((f) => key.test(f));
    return (good.length ? good : fences).sort((a, b) => b.length - a.length)[0].trim();
  }
  return text.trim();
}

/** Một lượt chạy tiến trình con: thoát 0 ⇒ ok. Lỗi khởi động (ENOENT…) cũng là TRƯỢT, kèm thông điệp. */
function chay(file, args, cwd, timeout, signal, shell = false) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, out: "HUY" });
    execFile(file, args, { cwd, timeout, signal, shell, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, out: stdout });
      const out = `${stdout || ""}\n${stderr || ""}`.trim();
      resolve({ ok: false, out: (out || String(err.message || err)).slice(-1500) });
    });
  });
}

async function runTs(t, code, dir, signal) {
  fs.mkdirSync(dir, { recursive: true });
  // model hay viết `export function` — giữ nguyên; node 24 tự bóc kiểu cho .ts
  fs.writeFileSync(`${dir}/sol.ts`, code);
  fs.writeFileSync(`${dir}/t.test.ts`, t.test.replace("./sol.mjs", "./sol.ts"));
  fs.writeFileSync(`${dir}/package.json`, '{"type":"module"}');
  return chay(process.execPath, ["--experimental-transform-types", "--test", "t.test.ts"], dir, 60000, signal);
}
async function runPy(t, code, dir, signal) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/sol.py`, code);
  fs.writeFileSync(`${dir}/t.py`, t.test);
  // ⚠ ĐO 2026-10-17: `python` trên máy này là BÍ DANH ỨNG DỤNG của WindowsApps (điểm phân tích lại, không phải .exe
  //   thật) ⇒ `execFile` không qua shell trả "spawn UNKNOWN" ⇒ fake-ok 9/12 (py 0/3) — hiện vật công cụ. Qua cmd.exe
  //   như `execSync` cũ thì phân giải được. Tham số cố định (`t.py`), không có đầu vào người dùng ⇒ shell không mở lỗ.
  //   Đo cùng ngày: chính bí danh ấy còn TREO (`python t.py` qua cmd.exe hết 60 s) ⇒ py 0/3 lần hai. Trình thông dịch thật
  //   (`C:/Python314/python.exe`) chạy ĐẠT ⇒ núm `AI_EVAL_PYTHON` chọn tường minh; vắng ⇒ `python` như cũ.
  const py = process.env.AI_EVAL_PYTHON?.trim();
  if (py) return chay(py, ["t.py"], dir, 60000, signal);
  return chay("python", ["t.py"], dir, 60000, signal, process.platform === "win32");
}
async function runCs(t, code, dir, signal) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(`${BENCH}/cs-template/p.csproj`, `${dir}/p.csproj`);
  fs.writeFileSync(`${dir}/Sol.cs`, code);
  fs.writeFileSync(`${dir}/Program.cs`, t.test);
  return chay("dotnet", ["run", "--project", "p.csproj", "-v", "q", "--nologo"], dir, 240000, signal);
}
/**
 * ★★★ C++ (2026-09-22) — qua **CMake → MSVC** (CMake tự dò MSVC qua registry, không cần `vcvars64`).
 * ⚠ Thư mục dựng KHÔNG được nằm dưới thư mục tạm của hệ (MSB8029) ⇒ người gọi truyền `dir` trong `tmp/` của repo.
 * ⚠ `--config Release` BẮT BUỘC ở generator đa-cấu-hình của Visual Studio.
 * ⚠ Đường .exe dựng bằng `path.join` (bản đầu gõ tay `\` trong template string ⇒ "bReleasesolbench.exe" ⇒ 0/3 giả).
 */
async function runCpp(t, code, dir, signal) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(`${BENCH}/cpp-template/CMakeLists.txt`, `${dir}/CMakeLists.txt`);
  // Bài kiểm nối THẲNG vào sau lời giải: C++ một-tệp, không cần hệ thống test ngoài.
  fs.writeFileSync(`${dir}/sol.cpp`, `${code}

${t.test}
`);
  const cm = await chay(CMAKE, ["-S", ".", "-B", "b"], dir, 180000, signal);
  if (!cm.ok) return cm;
  const bd = await chay(CMAKE, ["--build", "b", "--config", "Release"], dir, 300000, signal);
  if (!bd.ok) return bd;
  return chay(path.join(dir, "b", "Release", "solbench.exe"), [], dir, 60000, signal);
}

export const RUNNERS = { ts: runTs, py: runPy, cs: runCs, cpp: runCpp };

/**
 * Chấm MỘT câu trả lời của model cho bài `t`: trích mã ⇒ chạy bài kiểm trong `dir` ⇒ `{ sinhDuocMa, dat, loi, code }`.
 * Ngôn ngữ lạ / không trích được mã ⇒ TRƯỢT có lý do (không ném).
 */
export async function chamBai({ t, text, dir, signal }) {
  const code = trichMa(text || "", t.lang, dinhDanhBai(t));
  if (!code) return { sinhDuocMa: false, dat: false, loi: "KHÔNG SINH ĐƯỢC MÃ", code: "" };
  const run = RUNNERS[t.lang];
  if (!run) return { sinhDuocMa: true, dat: false, loi: `ngôn ngữ chưa có trình chạy: ${t.lang}`, code };
  let r;
  try {
    r = await run(t, code, dir, signal);
  } catch (e) {
    r = { ok: false, out: String(e).slice(0, 600) };
  }
  return { sinhDuocMa: true, dat: r.ok, loi: r.ok ? null : String(r.out).slice(-700), code };
}
