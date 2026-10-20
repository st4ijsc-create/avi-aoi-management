/**
 * ★★ Đợt 8.2 Task 3 — CHẠY MÃ JS CỦA NGƯỜI VIẾT LUỒNG TRONG DOCKER CÁCH LY (node `du-lieu.ma`). Spec §4.5, §4.6 luật 6.
 *
 * Ranh giới an toàn là CONTAINER, không phải `vm` của Node:
 *   docker run --rm -i --pull never --log-driver none --network none --read-only --memory 256m --memory-swap 256m
 *     --pids-limit 64 --cpus 1 --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 --workdir /
 *     node@sha256:<ghim> node --permission --max-old-space-size=160 -e <KICH_BAN_CHAY cố định>
 *   • không mạng (`--network none`), không ghi đĩa (`--read-only`, không tmpfs, không gắn thư mục host nào), không root,
 *     không capability, không leo quyền; thêm mô hình quyền của Node (`--permission`: chặn fs đọc/ghi, child_process, worker);
 *   • ảnh GHIM DIGEST, `--pull never` — ảnh thiếu ⇒ lỗi rõ ràng (KHÔNG lùi về chạy trong tiến trình);
 *   • mã người dùng + item đi qua STDIN dạng JSON `{ ma, items }` — KHÔNG BAO GIỜ nằm trên dòng lệnh / trong shell (spawn không
 *     shell, mảng tham số cố định). Kịch bản chạy cố định dựng `async (items) => { <mã> }`, xoá sạch `process.env`, chuyển
 *     `console.*`/`process.stdout.write` của người dùng sang stderr, in đúng MỘT JSON kết quả ra stdout rồi `process.exit`;
 *   • trần 10 s (quá ⇒ giết client + `docker rm -f` container theo tên riêng); trần stdout 1 MB và stderr 1 MB (quá ⇒ giết,
 *     lỗi); số container song song ≤ `AI_FLOW_MA_SONG_SONG` (mặc định 2).
 * Ảnh: xem `README-chay-ma.md` cạnh tệp này (digest, cách cài lại offline).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/** node:24-alpine (Node v24.22.0), kéo 2026-10-20. Đổi digest = đổi mã + README, không qua biến môi trường. */
export const ANH_MA_DIGEST = "sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f";
export const ANH_MA = `node@${ANH_MA_DIGEST}`;
export const TRAN_MS = 10_000;
export const TRAN_DAU_RA = 1024 * 1024;
const TRAN_MA = 64 * 1024;

export class LoiMaLuong extends Error {
  constructor(
    public readonly loai: "thieu-anh" | "het-gio" | "dau-ra-qua-lon" | "ma-loi" | "dau-ra-hong" | "ha-tang" | "khong-hop-le",
    message: string,
  ) {
    super(message);
    this.name = "LoiMaLuong";
  }
}

/** Kịch bản chạy CỐ ĐỊNH trong container (CommonJS qua `-e`). Không chứa gì của người dùng. */
export const KICH_BAN_CHAY = String.raw`"use strict";
const vietRa = process.stdout.write.bind(process.stdout);
let daXong = false;
const xong = (o) => { if (daXong) return; daXong = true; let s; try { s = JSON.stringify(o); } catch (e) { s = JSON.stringify({ ok: false, loi: "kết quả không tuần tự hoá được JSON: " + String(e && e.message || e) }); } vietRa(s === undefined ? "null" : s, () => process.exit(0)); };
const TRAN_LOG = 1048576;
let tongLog = 0;
const ghiLoi = (...a) => {
  let s = "";
  try { s = a.map((x) => typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(" ") + "\n"; } catch {}
  tongLog += Buffer.byteLength(s);
  if (tongLog > TRAN_LOG) { xong({ ok: false, vuotLog: true, loi: "log vượt 1 MB" }); throw new RangeError("log vượt 1 MB"); }
  try { process.stderr.write(s); } catch {}
  return true;
};
const c = [];
process.stdin.on("data", (d) => c.push(d));
process.stdin.on("end", async () => {
  let vao;
  try { vao = JSON.parse(Buffer.concat(c).toString("utf8")); } catch { return xong({ ok: false, loi: "đầu vào không phải JSON" }); }
  for (const k of Object.keys(process.env)) delete process.env[k];
  console.log = console.info = console.warn = console.error = console.debug = console.trace = ghiLoi;
  process.stdout.write = ghiLoi;
  // node -e gắn require/module lên globalThis — gỡ (mạng/đĩa đã chặn ở container + --permission; đây là lớp thứ ba).
  for (const k of ["require", "module", "exports", "__filename", "__dirname"]) { try { delete globalThis[k]; } catch {} }
  for (const k of ["getBuiltinModule", "binding", "_linkedBinding", "dlopen"]) { try { process[k] = undefined; } catch {} }
  try {
    const HamBatDongBo = (async () => {}).constructor;
    const ham = new HamBatDongBo("items", String(vao.ma));
    const kq = await ham(vao.items);
    xong({ ok: true, items: kq === undefined ? null : kq });
  } catch (e) {
    xong({ ok: false, loi: String((e && (e.stack || e.message)) || e).slice(0, 4000) });
  }
});`;

/** Cờ docker cố định (trừ `--name`). Xuất để lưới kiểm từng cờ an toàn. */
export function coDocker(tenContainer: string, anh = ANH_MA): string[] {
  return [
    "run", "--rm", "-i", "--pull", "never", "--name", tenContainer, "--log-driver", "none",
    "--network", "none", "--read-only", "--memory", "256m", "--memory-swap", "256m", "--pids-limit", "64", "--cpus", "1",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534", "--workdir", "/",
    anh, "node", "--permission", "--max-old-space-size=160", "-e", KICH_BAN_CHAY,
  ];
}

// ── giới hạn song song ──────────────────────────────────────────────────────────────────────────
let dangChay = 0;
const hangCho: (() => void)[] = [];
async function giuCho(): Promise<() => void> {
  const tran = Math.max(1, Math.min(Number(process.env.AI_FLOW_MA_SONG_SONG ?? 2) || 2, 8));
  if (dangChay >= tran) await new Promise<void>((r) => hangCho.push(r));
  dangChay++;
  return () => {
    dangChay--;
    hangCho.shift()?.();
  };
}

function chayDocker(thamSo: string[], tranMs: number): Promise<{ ma: number | null; loiSpawn?: string }> {
  return new Promise((res) => {
    const p = spawn("docker", thamSo, { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    const t = setTimeout(() => p.kill("SIGKILL"), tranMs);
    p.on("close", (ma) => {
      clearTimeout(t);
      res({ ma });
    });
    p.on("error", (e) => {
      clearTimeout(t);
      res({ ma: -1, loiSpawn: String(e.message) });
    });
  });
}

/** Ảnh ghim có sẵn cục bộ không (lưới dùng để bỏ qua có thông báo). */
export async function coAnhMa(anh = ANH_MA): Promise<boolean> {
  return (await chayDocker(["image", "inspect", anh], 20_000)).ma === 0;
}

export interface KetQuaMa {
  items: unknown;
  stderr: string;
  ms: number;
}

/**
 * Chạy `ma` (thân của `async (items) => { … }`) trên `items`. Ném `LoiMaLuong` cho mọi thất bại. `anh` chỉ để lưới thử
 * nhánh "ảnh thiếu" — đường sản phẩm luôn dùng `ANH_MA`.
 */
export async function chayMaCachLy(y: { ma: string; items: unknown; anh?: string; tranMs?: number }): Promise<KetQuaMa> {
  if (typeof y.ma !== "string" || !y.ma.trim()) throw new LoiMaLuong("khong-hop-le", "mã rỗng");
  if (y.ma.length > TRAN_MA) throw new LoiMaLuong("khong-hop-le", `mã dài quá ${TRAN_MA} ký tự`);
  const vao = JSON.stringify({ ma: y.ma, items: y.items });
  if (vao.length > TRAN_DAU_RA) throw new LoiMaLuong("khong-hop-le", `đầu vào quá ${TRAN_DAU_RA} byte`);
  const tranMs = Math.min(y.tranMs ?? TRAN_MS, TRAN_MS);
  const nha = await giuCho();
  const ten = `luong-ma-${process.pid}-${randomBytes(6).toString("hex")}`;
  const t0 = Date.now();
  try {
    const r = await new Promise<{ ma: number | null; so: Buffer; se: string; vuot: "" | "stdout" | "stderr"; hetGio: boolean; loiSpawn?: string }>((res) => {
      const p = spawn("docker", coDocker(ten, y.anh ?? ANH_MA), { windowsHide: true, shell: false });
      const so: Buffer[] = [];
      let soLen = 0;
      let se = "";
      let seLen = 0;
      let vuot: "" | "stdout" | "stderr" = "";
      let hetGio = false;
      let daXong = false;
      const giet = () => {
        try {
          p.kill("SIGKILL");
        } catch {
          /* đã chết */
        }
      };
      p.stdout.on("data", (d: Buffer) => {
        soLen += d.length;
        if (soLen > TRAN_DAU_RA) {
          if (!vuot) vuot = "stdout";
          giet();
          return;
        }
        so.push(d);
      });
      p.stderr.on("data", (d: Buffer) => {
        seLen += d.length;
        if (seLen > TRAN_DAU_RA) {
          if (!vuot) vuot = "stderr";
          giet();
          return;
        }
        if (se.length < 16 * 1024) se += d.toString("utf8");
      });
      const t = setTimeout(() => {
        hetGio = true;
        giet();
      }, tranMs);
      const ket = (ma: number | null, loiSpawn?: string) => {
        if (daXong) return;
        daXong = true;
        clearTimeout(t);
        res({ ma, so: Buffer.concat(so), se, vuot, hetGio, loiSpawn });
      };
      p.on("close", (ma) => ket(ma));
      p.on("error", (e) => ket(-1, String(e.message)));
      p.stdin.on("error", () => {
        /* container chết trước khi đọc hết stdin */
      });
      p.stdin.end(vao);
    });
    // Client docker bị giết KHÔNG dừng container ⇒ xoá theo tên (chờ ngắn; không chặn trả lỗi quá lâu).
    if (r.hetGio || r.vuot) await chayDocker(["rm", "-f", ten], 5_000);
    const ms = Date.now() - t0;
    if (r.loiSpawn) throw new LoiMaLuong("ha-tang", `không chạy được docker: ${r.loiSpawn.slice(0, 300)}`);
    if (r.hetGio) throw new LoiMaLuong("het-gio", `mã chạy quá ${tranMs / 1000} s — đã dừng container`);
    if (r.vuot) throw new LoiMaLuong("dau-ra-qua-lon", `${r.vuot} vượt ${TRAN_DAU_RA} byte — đã dừng container`);
    if (/No such image|Unable to find image/i.test(r.se) && r.so.length === 0) {
      throw new LoiMaLuong("thieu-anh", `ảnh ${y.anh ?? ANH_MA} chưa có trên máy — cài offline: docker load -i node-24-alpine.tar (xem server/services/flow/lib/README-chay-ma.md)`);
    }
    if (r.so.length === 0) throw new LoiMaLuong("ha-tang", `container không trả kết quả (mã thoát ${r.ma}): ${r.se.trim().slice(0, 500)}`);
    let kq: { ok?: boolean; items?: unknown; loi?: string; vuotLog?: boolean };
    try {
      kq = JSON.parse(r.so.toString("utf8"));
    } catch {
      throw new LoiMaLuong("dau-ra-hong", "đầu ra của mã không phải JSON");
    }
    if (!kq || typeof kq !== "object" || typeof kq.ok !== "boolean") throw new LoiMaLuong("dau-ra-hong", "đầu ra của mã sai khuôn");
    if (!kq.ok && kq.vuotLog) throw new LoiMaLuong("dau-ra-qua-lon", `log (console/stdout) của mã vượt ${TRAN_DAU_RA} byte`);
    if (!kq.ok) throw new LoiMaLuong("ma-loi", `mã ném lỗi: ${String(kq.loi ?? "").slice(0, 2000)}`);
    return { items: kq.items, stderr: r.se.slice(0, 16 * 1024), ms };
  } finally {
    nha();
  }
}
