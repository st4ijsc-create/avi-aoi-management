/**
 * Bài `ma-don`: model trả MỘT câu trả lời chứa khối mã. Đề + bài kiểm ẩn vẫn ở nguồn cũ (`bai.nguon`), chấm bằng ĐÚNG
 * `codegen-chay-duoc/cham.mjs#chamBai` như `run.mjs` ⇒ bộ cũ chạy y nguyên, không có hai bản bài kiểm.
 *
 *   node check.mjs --tra-loi <tệp>      câu trả lời nguyên văn của model (trích khối mã như run.mjs)
 *   node check.mjs --ma <tệp>           mã trơn (không cần dấu ```)
 *   node check.mjs --kiem-thuoc ok|bad  lời giải kiểm thước của nguồn cũ (`fake-*.json`): ok phải ĐẠT, bad phải TRƯỢT
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BENCH_CODEGEN, ketThuc, LoiThuoc, ROOT, thamSo } from "./chung.mjs";

export function baiNguon(bai) {
  const tep = `${BENCH_CODEGEN}/${bai.nguon.tep}`;
  const ds = JSON.parse(fs.readFileSync(tep, "utf8"));
  const t = (Array.isArray(ds) ? ds : ds.tasks).find((x) => x.id === bai.nguon.id);
  if (!t) throw new LoiThuoc(`không có bài ${bai.nguon.id} trong ${bai.nguon.tep}`);
  return t;
}

function loiGiaiKiemThuoc(bai, loai) {
  const tep = `${BENCH_CODEGEN}/${bai.nguon.tep.replace(/^tasks/, "fake")}`;
  const ma = JSON.parse(fs.readFileSync(tep, "utf8"))[`fake-${loai}`]?.[bai.nguon.id];
  if (!ma) throw new LoiThuoc(`không có lời giải fake-${loai} cho ${bai.nguon.id}`);
  return "```\n" + ma + "\n```";
}

/**
 * Dọn thư mục chấm. Không dọn được thì để lại trong `tmp/` (bị git bỏ qua): kết quả chấm đã có, không được biến thành "thước hỏng".
 * Trên Windows, lời giải quá giờ có thể còn giữ thư mục một lúc (EPERM); bản đầu ném lỗi ở đây và vứt cả lượt đo 09/11.
 */
export function donThuMuc(dir, tuyChon = { maxRetries: 5, retryDelay: 500 }) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, ...tuyChon });
    return true;
  } catch (e) {
    console.error(`không dọn được ${dir}: ${e?.code ?? e}`);
    return false;
  }
}

export async function cham({ bai }) {
  const { lay } = thamSo();
  const t = baiNguon(bai);
  const kt = lay("--kiem-thuoc");
  let text;
  if (kt) {
    if (!["ok", "bad"].includes(kt)) throw new LoiThuoc(`--kiem-thuoc ok|bad, nhận: ${kt}`);
    text = loiGiaiKiemThuoc(bai, kt);
  } else if (lay("--tra-loi")) text = fs.readFileSync(lay("--tra-loi"), "utf8");
  else if (lay("--ma")) text = "```\n" + fs.readFileSync(lay("--ma"), "utf8") + "\n```";
  else throw new LoiThuoc("thiếu --tra-loi <tệp> | --ma <tệp> | --kiem-thuoc ok|bad");

  const { chamBai } = await import(pathToFileURL(`${BENCH_CODEGEN}/cham.mjs`).href);
  // Trong repo như WORK của run.mjs, KHÔNG ở %TEMP%: bài kiểm import zod, react, drizzle phải tìm được node_modules của repo.
  fs.mkdirSync(`${ROOT}/tmp/ai-eval-tasks`, { recursive: true });
  const dir = fs.mkdtempSync(`${ROOT}/tmp/ai-eval-tasks/${bai.id}-`);
  const t0 = Date.now();
  try {
    const r = await chamBai({ t, text, dir: dir.split(path.sep).join("/") });
    const lyDo = r.dat ? [] : [r.sinhDuocMa ? "TEST_DO" : "KHONG_SINH_DUOC_MA"];
    return ketThuc({ id: bai.id, dat: r.dat, lyDo, ...(kt ? { kiemThuoc: kt } : {}), ms: Date.now() - t0, loi: r.loi ? String(r.loi).slice(-600) : null });
  } finally {
    donThuMuc(dir);
  }
}
