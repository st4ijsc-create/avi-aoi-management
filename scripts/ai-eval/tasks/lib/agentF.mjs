/**
 * Bài `agent-f`: agent sửa dự án nhiều tệp trong `sandbox-projects/agent-f/<id>`. Chấm bằng ĐÚNG `agent-f/cham.mjs#chamBai` (test hiển thị + ẩn,
 * băm tệp test) như `run-f.mjs`.
 *
 *   node check.mjs --thu-muc <dir> [--chuan git|<thư mục nguồn>]   chấm một bản dự án (mặc định chuẩn băm = git HEAD)
 *   node check.mjs --kiem-thuoc mau|goc|gian-lan                   bản sao tạm: mau phải ĐẠT; goc, gian-lan phải TRƯỢT
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BENCH_CODEGEN, ketThuc, LoiThuoc, ROOT, thamSo } from "./chung.mjs";

const BO_QUA = new Set(["bin", "obj", "__pycache__", ".pytest_cache", "node_modules"]);
function chepCay(tu, den) {
  fs.mkdirSync(den, { recursive: true });
  for (const e of fs.readdirSync(tu, { withFileTypes: true })) {
    if (BO_QUA.has(e.name)) continue;
    if (e.isDirectory()) chepCay(`${tu}/${e.name}`, `${den}/${e.name}`);
    else fs.copyFileSync(`${tu}/${e.name}`, `${den}/${e.name}`);
  }
}

export async function cham({ bai }) {
  const { lay } = thamSo();
  const f = await import(pathToFileURL(`${BENCH_CODEGEN}/agent-f/cham.mjs`).href);
  const nguon = f.docDanhSachBai().find((b) => b.id === bai.nguon.id);
  if (!nguon) throw new LoiThuoc(`không có bài ${bai.nguon.id} trong agent-f/bai.json`);
  const goc = `${ROOT}/${bai.duAn}`;
  const kt = lay("--kiem-thuoc");
  if (kt) {
    if (!["mau", "goc", "gian-lan"].includes(kt)) throw new LoiThuoc(`--kiem-thuoc mau|goc|gian-lan, nhận: ${kt}`);
    const tam = fs.mkdtempSync(path.join(os.tmpdir(), `ai-eval-tasks-${bai.id}-`)).split(path.sep).join("/");
    try {
      chepCay(goc, tam);
      if (kt !== "goc") chepCay(`${BENCH_CODEGEN}/agent-f/mau/${bai.id}`, tam);
      if (kt === "gian-lan") fs.appendFileSync(`${tam}/${nguon.testHienThi[0]}`, nguon.kieu === "pytest" ? "\n# gian lận\n" : "\n// gian lận\n");
      const r = f.chamBai({ bai: nguon, thuMuc: tam, bamChuan: f.bamChuanTuThuMuc(goc) });
      return ketThuc({ id: bai.id, dat: r.dat, lyDo: r.lyDo, kiemThuoc: kt, dem: r.dem, ms: r.ms });
    } finally {
      fs.rmSync(tam, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  }
  const thuMuc = lay("--thu-muc");
  if (!thuMuc) throw new LoiThuoc("thiếu --thu-muc <dir> | --kiem-thuoc mau|goc|gian-lan");
  const chuan = lay("--chuan", "git");
  const bamChuan = chuan === "git" ? f.bamChuanTuGit(bai.duAn) : f.bamChuanTuThuMuc(path.resolve(chuan).split(path.sep).join("/"));
  const r = f.chamBai({ bai: nguon, thuMuc: path.resolve(thuMuc).split(path.sep).join("/"), bamChuan });
  return ketThuc({ id: bai.id, dat: r.dat, lyDo: r.lyDo, dem: r.dem, tepBaoVeBiSua: r.tepBaoVeBiSua, ms: r.ms, duoiRa: r.dat ? undefined : r.duoiRa.slice(-600) });
}
