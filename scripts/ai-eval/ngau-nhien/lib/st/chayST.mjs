/**
 * ★★ Đợt 7.2 — BIÊN DỊCH + CHẠY Structured Text (IEC 61131-3) bằng RuSTy 1.0.7 trong Docker (ảnh `st-rusty:1.0.7`,
 * `--network none`, 512 MB, 128 tiến trình, không root). Dựng/thử bởi tác vụ toolchain 2026-10-20 (bản gốc ngoài repo:
 * `D:\SOURCES\16.AI\toolchains\st\chay-st.mjs`); bản này nhận NHIỀU tệp theo thứ tự và gắn `run-job.sh` của repo.
 *
 * Thứ tự biên dịch: prelude đồng hồ giả (TON/TOF/TP theo `G_NOW`, printf/puts) → các tệp theo thứ tự truyền vào.
 * Lối vào chương trình là `FUNCTION main : DINT` (của tệp test); giá trị trả về = mã thoát.
 *
 * Trả: { ok, giaiDoan: "bien-dich"|"chay"|"het-gio"|"ha-tang", chanDoan: [{tep,dong,cot,mucDo,ma,thongDiep}], stdout, maThoat, ms }
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THU_MUC = path.dirname(fileURLToPath(import.meta.url));
export const ANH_ST = process.env.AI_EVAL_ST_IMAGE?.trim() || "st-rusty:1.0.7";
const STDOUT_MAX = 64 * 1024;

// /w/10-src__A.st:12:5:{12:5-12:9}: error[E048]: msg
const RE_CHAN_DOAN = /^(\/w\/[^:]+|[^:\s][^:]*):(\d+):(\d+):(?:\{[^}]*\})?:?\s*(error|warning|info|hint)(?:\[(E\d+)\])?:\s*(.*)$/;

function docNeuCo(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function phanTichChanDoan(log, tenHienThi) {
  const ra = [];
  const daThay = new Set();
  for (const dong of log.split(/\r?\n/)) {
    const m = RE_CHAN_DOAN.exec(dong.trim());
    if (!m) continue;
    let tep = m[1].replace(/^\/w\//, "");
    if (tep.startsWith("/usr/share/plc/include/")) continue; // cảnh báo nội bộ thư viện chuẩn
    if (/^_[^:]*vtable/i.test(m[6])) continue; // ký hiệu tổng hợp của trình dịch
    tep = tenHienThi[tep] ?? tep;
    const d = { tep, dong: Number(m[2]), cot: Number(m[3]), mucDo: m[4], ma: m[5] || null, thongDiep: m[6].trim() };
    const k = JSON.stringify(d);
    if (!daThay.has(k)) {
      daThay.add(k);
      ra.push(d);
    }
  }
  if (!ra.some((d) => d.mucDo === "error")) {
    for (const dong of log.split(/\r?\n/)) {
      if (/error/i.test(dong) && !RE_CHAN_DOAN.test(dong.trim()) && !dong.startsWith("/usr/share/plc/include/")) {
        ra.push({ tep: null, dong: null, cot: null, mucDo: "error", ma: null, thongDiep: dong.trim() });
      }
    }
  }
  return ra;
}

function chayLenh(lenh, thamSo, tranMs) {
  return new Promise((res) => {
    const p = spawn(lenh, thamSo, { windowsHide: true });
    let so = "";
    let se = "";
    let biGiet = false;
    p.stdout.on("data", (d) => (so += d));
    p.stderr.on("data", (d) => (se += d));
    const t = setTimeout(() => {
      biGiet = true;
      p.kill("SIGKILL");
    }, tranMs);
    p.on("close", (ma) => {
      clearTimeout(t);
      res({ ma, so, se, biGiet });
    });
    p.on("error", (e) => {
      clearTimeout(t);
      res({ ma: -1, so, se: se + String(e), biGiet });
    });
  });
}

/** Ảnh Docker có sẵn không (để bộ chấm báo "thiếu toolchain" — exit 2 — thay vì "model trượt"). */
export async function coAnhST() {
  const r = await chayLenh("docker", ["image", "inspect", ANH_ST, "--format", "{{.Id}}"], 20_000);
  return r.ma === 0;
}

/**
 * @param {{ tep: {ten: string, duong: string}[], thuMucViec: string, giayChay?: number, giayBienDich?: number }} y
 *   `ten` = đường hiển thị trong chẩn đoán (vd `src/BoPhieu.st`); `thuMucViec` = thư mục cha cho thư mục việc tạm.
 */
export async function chayST({ tep, thuMucViec, giayChay = 10, giayBienDich = 60 }) {
  const t0 = Date.now();
  fs.mkdirSync(thuMucViec, { recursive: true });
  const viec = fs.mkdtempSync(path.join(thuMucViec, "st-"));
  const tenHienThi = { "00-prelude.st": "prelude-dong-ho-gia.st" };
  let kq;
  try {
    const lf = (s) => s.replace(/\r\n/g, "\n");
    fs.writeFileSync(path.join(viec, "00-prelude.st"), lf(fs.readFileSync(path.join(THU_MUC, "prelude-dong-ho-gia.st"), "utf8")));
    fs.writeFileSync(path.join(viec, "run-job.sh"), lf(fs.readFileSync(path.join(THU_MUC, "run-job.sh"), "utf8")));
    tep.forEach((t, i) => {
      const ten = `${String(10 + i).padStart(2, "0")}-${t.ten.replace(/[\\/]/g, "__")}`;
      tenHienThi[ten] = t.ten;
      fs.writeFileSync(path.join(viec, ten), fs.readFileSync(t.duong, "utf8"));
    });
    const tenCt = `cham-st-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await chayLenh(
      "docker",
      ["run", "--rm", "--pull", "never", "--name", tenCt, "--network", "none", "--memory", "512m", "--pids-limit", "128",
        "--cpus", "2", "-e", `CT=${giayBienDich}`, "-e", `RT=${giayChay}`, "-v", `${viec}:/w`, ANH_ST, "bash", "/w/run-job.sh"],
      (giayBienDich + giayChay + 20) * 1000,
    );
    if (r.biGiet) await chayLenh("docker", ["rm", "-f", tenCt], 10_000);
    const nhatKy = docNeuCo(path.join(viec, "compile.log"));
    const maBd = docNeuCo(path.join(viec, "compile.rc")).trim();
    const maChay = docNeuCo(path.join(viec, "run.rc")).trim();
    let stdout = docNeuCo(path.join(viec, "run.out"));
    if (stdout.length > STDOUT_MAX) stdout = stdout.slice(0, STDOUT_MAX) + "\n...[cắt bớt]";
    const ms = Date.now() - t0;
    if (r.biGiet || maBd === "124" || maBd === "137") {
      kq = { ok: false, giaiDoan: "het-gio", chanDoan: [], stdout, maThoat: -1, ms };
    } else if (maBd === "") {
      kq = { ok: false, giaiDoan: "ha-tang", chanDoan: [{ tep: null, dong: null, thongDiep: `lỗi hạ tầng docker: ${(r.se || r.so).trim().slice(0, 2000)}` }], stdout: "", maThoat: -1, ms };
    } else if (maBd !== "0") {
      kq = { ok: false, giaiDoan: "bien-dich", chanDoan: phanTichChanDoan(nhatKy, tenHienThi), stdout: "", maThoat: Number(maBd), ms };
    } else if (maChay === "124" || maChay === "137") {
      kq = { ok: false, giaiDoan: "het-gio", chanDoan: [], stdout, maThoat: -1, ms };
    } else {
      const ma = Number(maChay === "" ? -1 : maChay);
      kq = { ok: ma === 0, giaiDoan: "chay", chanDoan: phanTichChanDoan(nhatKy, tenHienThi).filter((d) => d.mucDo !== "error"), stdout, maThoat: ma, ms };
    }
  } finally {
    try {
      fs.rmSync(viec, { recursive: true, force: true });
    } catch {
      /* Windows giữ handle */
    }
  }
  return kq;
}
