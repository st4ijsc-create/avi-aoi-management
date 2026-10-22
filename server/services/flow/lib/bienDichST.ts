/**
 * ★★ Luồng AI Đợt 8.4 — BIÊN DỊCH Structured Text (IEC 61131-3) bằng RuSTy 1.0.7 trong Docker, cho node `ai.sinh-ma`.
 * Spec §3.7 bước 2 ("Biên dịch … Lỗi có cấu trúc → quay về model").
 *
 * Dùng lại toolchain của bộ đo 7.2 (`scripts/ai-eval/ngau-nhien/lib/st/`): ảnh `st-rusty:1.0.7` + prelude đồng hồ giả
 * (`prelude-dong-ho-gia.st`, ĐỌC từ thư mục bộ đo — một nguồn, không chép) + bộ phân tích chẩn đoán dạng clang (chép từ
 * `chayST.mjs`, có ghi nguồn). Khác bộ đo ở chỗ cốt yếu: kịch bản `bien-dich-job.sh` cạnh tệp này chỉ `plc -c` (KHÔNG liên
 * kết, KHÔNG chạy) — mã do model sinh ra không bao giờ được thực thi, kể cả trong container.
 *
 * Ranh giới: `docker run --rm --pull never --network none --read-only --tmpfs /tmp --memory 512m --pids-limit 128 --cpus 2
 * --cap-drop ALL --security-opt no-new-privileges` (người dùng `st` không root của ảnh), mảng tham số cố định, `shell:false`;
 * thư mục việc tạm chỉ chứa prelude + mã + kịch bản, xoá sau mỗi lượt. Trần 60 s; ≤ `AI_FLOW_ST_SONG_SONG` (mặc định 2)
 * container song song. Ảnh thiếu / docker vắng ⇒ `LoiBienDichST` rõ ràng (không lùi về đường nào khác).
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ANH_ST = "st-rusty:1.0.7";
export const TRAN_MA_ST = 64 * 1024;
const TRAN_GIAY_BIEN_DICH = 60;
const TEN_TEP_MA = "ma.st";

export class LoiBienDichST extends Error {
  constructor(
    public readonly loai: "thieu-anh" | "ha-tang" | "het-gio" | "khong-hop-le",
    message: string,
  ) {
    super(message);
    this.name = "LoiBienDichST";
  }
}

export interface ChanDoanST {
  tep: string | null;
  dong: number | null;
  cot: number | null;
  mucDo: string;
  ma: string | null;
  thongDiep: string;
}

export interface KetQuaBienDichST {
  ok: boolean;
  chanDoan: ChanDoanST[];
  ms: number;
}

/** Thư mục có thể chứa một tệp theo thứ tự ưu tiên: cạnh mã nguồn (dev/vitest) rồi theo thư mục làm việc (production). */
function timTep(tuongDoiTuDayDen: string, tuongDoiTuGoc: string): string | null {
  const ungVien = [resolve(process.cwd(), tuongDoiTuGoc)];
  try {
    ungVien.unshift(join(dirname(fileURLToPath(import.meta.url)), tuongDoiTuDayDen));
  } catch {
    /* import.meta.url không phải file: (bản dựng) */
  }
  return ungVien.find((p) => existsSync(p)) ?? null;
}

const lf = (s: string) => s.replace(/\r\n/g, "\n");

function napTaiNguyen(): { prelude: string; kichBan: string } {
  const p = timTep("../../../../scripts/ai-eval/ngau-nhien/lib/st/prelude-dong-ho-gia.st", "scripts/ai-eval/ngau-nhien/lib/st/prelude-dong-ho-gia.st");
  const k = timTep("bien-dich-job.sh", "server/services/flow/lib/bien-dich-job.sh");
  if (!p || !k) throw new LoiBienDichST("ha-tang", "thiếu prelude-dong-ho-gia.st hoặc bien-dich-job.sh (bộ công cụ ST không đủ trên máy này)");
  return { prelude: lf(readFileSync(p, "utf8")), kichBan: lf(readFileSync(k, "utf8")) };
}

// Chép từ scripts/ai-eval/ngau-nhien/lib/st/chayST.mjs (RE_CHAN_DOAN + phanTichChanDoan) — dạng `--error-format clang`:
//   /w/10-ma.st:12:5:{12:5-12:9}: error[E048]: msg
const RE_CHAN_DOAN = /^(\/w\/[^:]+|[^:\s][^:]*):(\d+):(\d+):(?:\{[^}]*\})?:?\s*(error|warning|info|hint)(?:\[(E\d+)\])?:\s*(.*)$/;

/** Phân tích nhật ký biên dịch thành chẩn đoán có cấu trúc. Bỏ cảnh báo của thư viện chuẩn và của prelude. */
export function phanTichChanDoanST(log: string): ChanDoanST[] {
  const ra: ChanDoanST[] = [];
  const daThay = new Set<string>();
  for (const dong of log.split(/\r?\n/)) {
    const m = RE_CHAN_DOAN.exec(dong.trim());
    if (!m) continue;
    let tep = m[1].replace(/^\/w\//, "");
    if (tep.startsWith("/usr/share/plc/include/")) continue;
    if (/^_[^:]*vtable/i.test(m[6])) continue;
    if (tep === "00-prelude.st" && m[4] !== "error") continue;
    tep = tep === "10-ma.st" ? TEN_TEP_MA : tep === "00-prelude.st" ? "prelude.st" : tep;
    const d: ChanDoanST = { tep, dong: Number(m[2]), cot: Number(m[3]), mucDo: m[4], ma: m[5] || null, thongDiep: m[6].trim().slice(0, 500) };
    const k = JSON.stringify(d);
    if (!daThay.has(k)) {
      daThay.add(k);
      ra.push(d);
    }
  }
  if (!ra.some((d) => d.mucDo === "error")) {
    for (const dong of log.split(/\r?\n/)) {
      const s = dong.trim();
      if (/error/i.test(s) && !RE_CHAN_DOAN.test(s) && !s.startsWith("/usr/share/plc/include/")) {
        ra.push({ tep: null, dong: null, cot: null, mucDo: "error", ma: null, thongDiep: s.slice(0, 500) });
      }
    }
  }
  return ra.slice(0, 50);
}

/** Cờ docker cố định (trừ `--name` và đường gắn). Xuất để lưới kiểm từng cờ an toàn. */
export function coDockerST(
  tenContainer: string,
  thuMucViec: string,
  anh = ANH_ST,
  /** ★ Đợt 9 — lượt `--ir` dự phòng (chỉ khi `-c` bị giết sớm); vắng ⇒ cờ GIỐNG HỆT bản cũ. */
  them: { cheDo?: "ir"; giay?: number } = {},
): string[] {
  return [
    "run", "--rm", "--pull", "never", "--name", tenContainer, "--log-driver", "none",
    "--network", "none", "--read-only", "--tmpfs", "/tmp:size=64m", "--memory", "512m", "--memory-swap", "512m",
    "--pids-limit", "128", "--cpus", "2", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "-e", `CT=${them.giay ?? TRAN_GIAY_BIEN_DICH}`, ...(them.cheDo ? ["-e", `CHE_DO=${them.cheDo}`] : []),
    "-v", `${thuMucViec}:/w`, anh, "bash", "/w/bien-dich-job.sh",
  ];
}

let dangChay = 0;
const hangCho: (() => void)[] = [];
async function giuCho(): Promise<() => void> {
  const tran = Math.max(1, Math.min(Number(process.env.AI_FLOW_ST_SONG_SONG ?? 2) || 2, 8));
  if (dangChay >= tran) await new Promise<void>((r) => hangCho.push(r));
  dangChay++;
  return () => {
    dangChay--;
    hangCho.shift()?.();
  };
}

/** ★ Đợt 9 — số lượt `docker run` ĐÃ chạy (lưới đo "đường bình thường không tốn thêm"; không ảnh hưởng hành vi). */
let soLuotRun = 0;
export function soLuotDockerRunST(): number {
  return soLuotRun;
}

function chayDocker(thamSo: string[], tranMs: number): Promise<{ ma: number | null; se: string; biGiet: boolean; loiSpawn?: string }> {
  if (thamSo[0] === "run") soLuotRun++;
  return new Promise((res) => {
    const p = spawn("docker", thamSo, { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let se = "";
    let biGiet = false;
    p.stderr?.on("data", (d: Buffer) => {
      if (se.length < 8192) se += d.toString("utf8");
    });
    const t = setTimeout(() => {
      biGiet = true;
      p.kill("SIGKILL");
    }, tranMs);
    p.on("close", (ma) => {
      clearTimeout(t);
      res({ ma, se, biGiet });
    });
    p.on("error", (e) => {
      clearTimeout(t);
      res({ ma: -1, se, biGiet, loiSpawn: String(e.message) });
    });
  });
}

/** Ảnh có sẵn cục bộ không (lưới dùng để bỏ qua có thông báo). */
export async function coAnhST(anh = ANH_ST): Promise<boolean> {
  return (await chayDocker(["image", "inspect", anh], 20_000)).ma === 0;
}

/**
 * Biên dịch MỘT đơn vị ST (sau prelude). Trả chẩn đoán có cấu trúc; ném `LoiBienDichST` cho lỗi hạ tầng (không phải lỗi mã).
 * `anh` chỉ để lưới thử nhánh "ảnh thiếu".
 */
/**
 * ★ Đợt 9 (2026-10-22) — phân loại một lượt biên dịch BỊ GIẾT. Trước: mọi `137` đều báo "biên dịch quá 60 s" — SAI: đo trên
 * một câu trả lời thật của 27B (A/B /v1, st-ud3#1) RuSTy bị giết sau ~1 s, cả khi nới trần bộ nhớ lên 2 GB / 6 GB ⇒ trình
 * biên dịch NỔ bộ nhớ trên mã đó, không phải hết giờ. `124`, hoặc bị giết khi đã gần trần thời gian ⇒ `het-gio`; `137` sớm ⇒
 * `ha-tang` (trình biên dịch sập). Cả hai đều là "chưa kiểm được" — KHÔNG phải phán quyết về mã. Thuần (lưới gọi thẳng).
 */
export function phanLoaiBiGiet(
  rc: string,
  biGiet: boolean,
  ms: number,
  tranGiay = TRAN_GIAY_BIEN_DICH,
): { loai: "het-gio" | "ha-tang"; thongDiep: string } | null {
  if (biGiet || rc === "124") return { loai: "het-gio", thongDiep: `biên dịch quá ${tranGiay} s` };
  if (rc !== "137") return null;
  if (ms >= tranGiay * 1000 * 0.9) return { loai: "het-gio", thongDiep: `biên dịch quá ${tranGiay} s` };
  return {
    loai: "ha-tang",
    thongDiep: `trình biên dịch bị giết (mã 137) sau ${ms} ms — vượt trần bộ nhớ của sandbox (lỗi của trình biên dịch với mã này)`,
  };
}

/** Trần giây của lượt `--ir` dự phòng (IR báo lỗi tức thì trên ca đã đo; trần chỉ để không treo). */
export const TRAN_GIAY_IR_DU_PHONG = 15;

/** Câu kèm chẩn đoán lấy từ `--ir` — model biết vì sao lỗi không có số dòng ST và phải tìm ở đâu. */
export const GHI_CHU_IR =
  "trình biên dịch nổ bộ nhớ khi sinh mã đối tượng; chế độ --ir báo lỗi này — thường do một nhãn CASE xuất hiện ở NHIỀU nhánh " +
  "(vd `1, 2:` … `1, 2:`): mỗi giá trị chỉ được thuộc MỘT nhánh";

/**
 * ★ Đợt 9 — đọc kết quả lượt `--ir` (thuần, lưới gọi thẳng): lỗi có vị trí ST (clang) ⇒ giữ nguyên; lỗi của bộ dựng LLVM
 * ("Builder error: …ll:N:M: error: duplicate case value in switch") ⇒ MỘT chẩn đoán không dòng + `GHI_CHU_IR`. Không lỗi nào ⇒ null.
 */
export function chanDoanTuIr(rc: string, log: string): ChanDoanST[] | null {
  if (rc === "0" || rc === "") return null;
  // dòng/cột trỏ vào tệp IR TẠM (`…/10-ma.st.ll:19:5`) là vị trí trong LLVM IR, KHÔNG phải trong mã ST ⇒ không đưa model
  const ds = phanTichChanDoanST(log).filter(
    (d) => d.mucDo === "error" && !/\.ll$/i.test(d.tep ?? "") && !/Builder error|\.ll:\d+/i.test(d.thongDiep),
  );
  if (ds.length) return ds;
  const m = /error:\s*([^\n]+)/i.exec(log);
  if (!m) return null;
  return [{ tep: null, dong: null, cot: null, mucDo: "error", ma: null, thongDiep: `${m[1].trim().slice(0, 200)} (${GHI_CHU_IR})` }];
}

async function thuIrSauKhiNo(viec: string, anh?: string): Promise<ChanDoanST[] | null> {
  try {
    for (const f of ["compile.rc", "compile.log"]) rmSync(join(viec, f), { force: true });
    const ten = `luong-st-ir-${process.pid}-${randomBytes(6).toString("hex")}`;
    const r = await chayDocker(coDockerST(ten, viec, anh, { cheDo: "ir", giay: TRAN_GIAY_IR_DU_PHONG }), (TRAN_GIAY_IR_DU_PHONG + 20) * 1000);
    if (r.biGiet) await chayDocker(["rm", "-f", ten], 10_000);
    const doc = (f: string) => (existsSync(join(viec, f)) ? readFileSync(join(viec, f), "utf8") : "");
    return chanDoanTuIr(doc("compile.rc").trim(), doc("compile.log"));
  } catch {
    return null; // dự phòng hỏng ⇒ giữ phân loại hạ tầng như cũ
  }
}

export async function bienDichST(ma: string, y: { anh?: string } = {}): Promise<KetQuaBienDichST> {
  if (typeof ma !== "string" || !ma.trim()) throw new LoiBienDichST("khong-hop-le", "mã rỗng");
  if (ma.length > TRAN_MA_ST) throw new LoiBienDichST("khong-hop-le", `mã dài quá ${TRAN_MA_ST} ký tự`);
  const { prelude, kichBan } = napTaiNguyen();
  const goc = join(tmpdir(), "luong-ai-st");
  mkdirSync(goc, { recursive: true });
  const viec = mkdtempSync(join(goc, "bd-"));
  const nha = await giuCho();
  const t0 = Date.now();
  try {
    writeFileSync(join(viec, "00-prelude.st"), prelude);
    writeFileSync(join(viec, "10-ma.st"), lf(ma));
    writeFileSync(join(viec, "bien-dich-job.sh"), kichBan);
    const ten = `luong-st-${process.pid}-${randomBytes(6).toString("hex")}`;
    const r = await chayDocker(coDockerST(ten, viec, y.anh), (TRAN_GIAY_BIEN_DICH + 20) * 1000);
    if (r.biGiet) await chayDocker(["rm", "-f", ten], 10_000);
    const doc = (f: string) => (existsSync(join(viec, f)) ? readFileSync(join(viec, f), "utf8") : "");
    const rc = doc("compile.rc").trim();
    const ms = Date.now() - t0;
    if (r.loiSpawn) throw new LoiBienDichST("ha-tang", `không chạy được docker: ${r.loiSpawn.slice(0, 300)}`);
    if (/No such image|Unable to find image/i.test(r.se) && rc === "") {
      throw new LoiBienDichST("thieu-anh", `ảnh ${y.anh ?? ANH_ST} chưa có trên máy — dựng theo scripts/ai-eval/ngau-nhien/lib/st/Dockerfile`);
    }
    const ketThuc = phanLoaiBiGiet(rc, r.biGiet, ms);
    if (ketThuc?.loai === "ha-tang") {
      // ★ Đợt 9 (2026-10-22, kiem-dinh tìm gốc) — `-c` bị giết SỚM: RuSTy 1.0.7 phình bộ nhớ vô hạn với nhãn CASE trùng giữa
      // các nhánh viết dạng danh sách. Chạy THÊM `--ir` (chỉ đường này — đường bình thường không tốn gì) để lấy chẩn đoán THẬT
      // cho model sửa thay vì "không kiểm được".
      const ir = await thuIrSauKhiNo(viec, y.anh);
      if (ir) return { ok: false, chanDoan: ir, ms: Date.now() - t0 };
    }
    if (ketThuc) throw new LoiBienDichST(ketThuc.loai, ketThuc.thongDiep);
    if (rc === "") throw new LoiBienDichST("ha-tang", `container không trả kết quả (mã thoát ${r.ma}): ${r.se.trim().slice(0, 500)}`);
    const chanDoan = phanTichChanDoanST(doc("compile.log"));
    if (rc !== "0" && !chanDoan.some((d) => d.mucDo === "error")) {
      chanDoan.push({ tep: null, dong: null, cot: null, mucDo: "error", ma: null, thongDiep: `trình biên dịch thoát mã ${rc}` });
    }
    return { ok: rc === "0", chanDoan, ms };
  } finally {
    nha();
    try {
      rmSync(viec, { recursive: true, force: true });
    } catch {
      /* Windows giữ handle */
    }
  }
}
