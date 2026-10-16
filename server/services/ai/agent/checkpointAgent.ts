/**
 * ★★★ Đợt 1 · T3 (2026-10-17) — **CHECKPOINT + HOÀN TÁC CHO VÒNG AGENT.**
 *
 * Spec `docs/superpowers/specs/2026-10-14-ai-local-dot1-loi-agent-design.md` §4: trước MỖI lượt ghi
 * (HITL lẫn tự động) chụp trạng thái các đường bị chạm; hoàn tác (một checkpoint hoặc cả lượt chạy,
 * thứ tự NGƯỢC) chỉ khi băm hiện tại == băm sau, và khôi phục qua CHÍNH tool ghi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO HOÀN TÁC ĐI CỬA GHI, KHÔNG GHI THẲNG BẢN SAO XUỐNG ĐĨA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * File này có sẵn byte gốc — `fs.writeFileSync(tuyệtĐối, byteGốc)` là một dòng. Nhưng đó là một CỬA
 * GHI THỨ HAI vào cây làm việc: không hộp cát (symlink/junction/hard link), không băm chống TOCTOU,
 * không kiểm tệp bẩn, không hàng `ai_pending_actions`, không audit. Census ghi (§2 của spec) nói đúng
 * một điều: *ghi đĩa chỉ qua tool ghi → `proposeAction` → `confirmAction`*. Nên mỗi lượt khôi phục ở
 * đây là MỘT lượt tool ghi đầy đủ:
 *   • tệp đã SỬA       ⇒ `apply_diff` { original = nội dung HIỆN TẠI, modified = byte gốc };
 *   • tệp đã TẠO       ⇒ `delete_file`;
 *   • tệp đã XOÁ       ⇒ `apply_diff` { original: "", modified = byte gốc } (tạo lại);
 *   • tệp đã ĐỔI TÊN   ⇒ `rename_file` NGƯỢC (đích → nguồn).
 * `executeDecision` ⇒ pending action ⇒ `confirmAction(…, { reason: "AI_AGENT_HOAN_TAC" })`: người bấm
 * "Hoàn tác" CHÍNH LÀ lượt duyệt (họ vừa xem danh sách tệp sẽ khôi phục). Kết quả thật đọc bằng
 * `maTuChoiGhi` (note) — `confirmAction.ok` chỉ nói "vòng đời chạy hết chặng", không nói "byte đã vào".
 * ⚠ `{reason}` đi vào tham số `autonomy` của `confirmAction` — tham số ấy CHỈ gắn nhãn audit
 *   (`autonomyAttempt/autonomyReason/confirmedBy`), không mở/đóng cửa nào (đọc mã 2026-10-17). Hàng
 *   audit TỔNG của file này ghi rõ người bấm là ai, nên sổ không bị đọc thành "máy tự duyệt".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HÀNG RÀO GHI CÓ CHO LƯỢT HOÀN TÁC ĐI QUA KHÔNG? — CÓ, NHỜ SỔ BĂM HITL, KHÔNG NỚI GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mọi tệp agent đã chạm đều git-BẨN (` M`/`??`/` D`) nên hàng rào tệp-bẩn sẽ chặn — trừ miễn trừ hẹp
 * `soBamHITL`: băm đĩa ≡ băm lượt ghi đã duyệt vừa đặt. Đo trên mã (2026-10-17):
 *   • sổ được ghi NGAY TẠI cửa ghi chung (`ghiTheoPhanQuyet`/`xoaTheoPhanQuyet`/`doiTenTheoPhanQuyet`),
 *     tức MỌI lượt `confirmAction` → `execute` — cả lượt `tu-dong` (`{reason:"AI_AGENT_TU_DONG"}`) —
 *     đều vào sổ (lưới §A "TẠO qua đường tu-dong" đo bằng chính một lượt `delete_file` sau đó);
 *   • sửa ⇒ sổ = băm sau ⇒ `apply_diff` khôi phục đi qua; tạo ⇒ sổ = băm tệp ⇒ `delete_file` đi qua;
 *     xoá ⇒ sổ = "vắng mặt" ⇒ `apply_diff` tạo lại đi qua; đổi tên ⇒ nguồn "vắng", đích băm ⇒ dời
 *     ngược đi qua. Chuỗi nhiều checkpoint cùng tệp: mỗi lượt khôi phục lại đặt sổ = băm vừa ghi ⇒
 *     lượt kế (seq nhỏ hơn) đi tiếp.
 * ⚠ GIỚI HẠN (nói thẳng, KHÔNG vá bằng cách nới): sổ là RAM theo tiến trình. Server khởi động lại ⇒
 *   sổ rỗng ⇒ lượt khôi phục một tệp git-bẩn bị `FILE_DIRTY` ⇒ hoàn tác KHAI xung đột (lý do mang
 *   nguyên mã), không ghi gì. Người dùng vẫn còn `git checkout -- <tệp>` cho tệp đã track. Đặt lại sổ
 *   từ manifest là trao cho một tệp trên đĩa quyền cấp miễn trừ — `khopSoBamHITL` cố ý chỉ export
 *   phép HỎI; quyết định đó thuộc chủ dự án, không thuộc T3.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LƯU TRỮ — NGOÀI DỰ ÁN, ĐẶT TÊN THEO BĂM, ĐỌC QUA HỘP CÁT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `<AI_CHECKPOINT_DIR | <cwd>/tmp/ai-checkpoints>/<runId>/<seq>/manifest.json` + `<sha256>.bin`.
 *   • Byte gốc đọc bằng `confineTargetUnder` + `readConfined` (realpath/nlink trên fd) — đúng cửa đọc
 *     của tool, KHÔNG `fs.readFile` một đường do model đưa. `fs` của file này chỉ chạm KHO checkpoint
 *     (đường dựng từ runId/seq đã kiểm hình dạng + băm hex), không bao giờ chạm cây dự án.
 *   • Băm = `bamUtf8` (đúng thước của `apply_diff`/`delete_file` ⇒ so được với `bamSau` tool trả).
 *     Bản sao = utf8 của chuỗi `readConfined` trả ⇒ trùng byte thô KHI tệp là UTF-8 hợp lệ. Tệp không
 *     phải UTF-8 (cỡ lệch / có U+FFFD) ⇒ đánh dấu `tuChoi`, hoàn tác KHAI xung đột thay vì ghi một bản
 *     giải mã sai byte (tool ghi vốn chỉ chở chuỗi).
 *   • Tên bản sao = băm ⇒ không đường lạ nào thành tên tệp trong kho; lúc khôi phục băm lại bản sao và
 *     so manifest (`BAN_SAO_HONG` nếu lệch — kho có thể nằm trong repo chính, nơi agent ghi được .json).
 *   • Gốc dự án của lượt hoàn tác phải TRÙNG gốc đã chụp (manifest không được tự chọn nơi ghi).
 *   • Trần dung lượng mỗi lượt chạy (`AI_CHECKPOINT_TRAN_BYTE`, mặc định 50 MB) ⇒ vượt thì `chupTruocGhi`
 *     NÉM `VUOT_TRAN` — người gọi KHÔNG được ghi khi không chụp được (fail-closed).
 *   • `donCheckpointCu()` (T4 gọi lúc boot) xoá lượt chạy không hoạt động > 7 ngày.
 */
import fs from "node:fs";
import path from "node:path";
import { confineTargetUnder, readConfined, bamUtf8 } from "../../aiLocalTools/readToolsProgramming";
import { TRAN_TEP } from "../../aiLocalTools/writeHandlers/applyDiff";
import { gocHopCat } from "../../aiLocalTools/repoSandbox";
import { executeDecision, type ToolExecContext, type ToolLang } from "../../aiLocalTools";
import { confirmAction, type CopilotUser } from "../../aiCopilotActions";
import { AUDIT_ACTIONS, ENTITY_TYPES, createAuditContext, logCrudOperation } from "../../auditTrailService";
import { daBiTuChoiGhi, maTuChoiGhi } from "@shared/aiCodingLoop";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HỢP ĐỒNG (T4 gọi đúng các hàm này)
// ══════════════════════════════════════════════════════════════════════════════════════════════
export type LoaiThayDoi = "tao" | "sua" | "xoa" | "doi-ten";

export interface MucCheckpoint {
  /** Tương đối gốc dự án, '/'. */
  duong: string;
  tonTai: boolean;
  bamTruoc: string | null;
  /** `undefined` = chưa chốt (lượt ghi chưa báo kết quả); `null` = tệp vắng sau lượt ghi. */
  bamSau?: string | null;
  loai?: LoaiThayDoi;
  tuDuong?: string;
  /** Không chụp được bản sao (hộp cát từ chối, quá lớn, không phải UTF-8…) — hoàn tác KHÔNG khôi phục mục này. */
  tuChoi?: string;
  /** Mục là NGUỒN của một lượt đổi tên (giá trị = đích) — mục đích xử lý cả cặp. */
  nguonCuaDoiTen?: string;
  /** Đã hoàn tác lúc nào — lần hoàn tác sau bỏ qua mục này. */
  daHoanTacLuc?: string;
}

export interface Checkpoint {
  id: string;
  runId: string;
  seq: number;
  gocDuAn: string;
  taoLuc: string;
  muc: MucCheckpoint[];
  /** Người sở hữu lượt chạy (tuỳ chọn) — có mặt ⇒ chỉ người đó hoàn tác được. */
  userId?: number;
  chotLuc?: string;
}

export interface ThayDoiChot {
  duong: string;
  loai: LoaiThayDoi;
  tuDuong?: string;
  bamSau: string | null;
}

export interface KetQuaHoanTac {
  khoiPhuc: string[];
  xungDot: Array<{ duong: string; lyDo: string }>;
  boQua: string[];
}

/** Lý do gắn vào `confirmAction` của MỌI lượt ghi khôi phục — tách bạch với `AI_AGENT_TU_DONG`. */
export const LY_DO_HOAN_TAC = "AI_AGENT_HOAN_TAC" as const;

export type MaLoiCheckpoint = "THAM_SO_SAI" | "DA_TON_TAI" | "VUOT_TRAN" | "KHONG_TIM_THAY" | "DANG_HOAN_TAC" | "LOI_LUU_TRU";

export class LoiCheckpoint extends Error {
  constructor(
    public readonly ma: MaLoiCheckpoint,
    message: string,
  ) {
    super(message);
    this.name = "LoiCheckpoint";
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KHO
// ══════════════════════════════════════════════════════════════════════════════════════════════
const TRAN_MAC_DINH = 50 * 1024 * 1024;
const NGAY_MS = 86_400_000;
const TRAN_SO_DUONG = 500;
/** runId đi thẳng vào tên thư mục ⇒ chỉ ký tự an toàn, KHÔNG dấu chấm (id checkpoint = `<runId>.<seq>`). */
const KHUON_RUN_ID = /^[A-Za-z0-9_-]{1,100}$/;
const KHUON_BAM = /^[0-9a-f]{64}$/;

/** Đọc env TẠI CHỖ (lưới lật env theo ca). */
export function thuMucKhoCheckpoint(): string {
  const raw = (process.env.AI_CHECKPOINT_DIR ?? "").trim();
  if (raw === "") return path.resolve(process.cwd(), "tmp", "ai-checkpoints");
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

function tranByteMoiLuotChay(): number {
  const n = Number((process.env.AI_CHECKPOINT_TRAN_BYTE ?? "").trim());
  return Number.isSafeInteger(n) && n > 0 ? n : TRAN_MAC_DINH;
}

function kiemRunId(runId: unknown): string {
  if (typeof runId !== "string" || !KHUON_RUN_ID.test(runId)) throw new LoiCheckpoint("THAM_SO_SAI", `runId không hợp lệ: ${String(runId)}`);
  return runId;
}

function kiemSeq(seq: unknown): number {
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw new LoiCheckpoint("THAM_SO_SAI", `seq không hợp lệ: ${String(seq)}`);
  return seq;
}

function idCheckpoint(runId: string, seq: number): string {
  return `${runId}.${seq}`;
}

function tachId(checkpointId: unknown): { runId: string; seq: number } {
  const s = typeof checkpointId === "string" ? checkpointId : "";
  const i = s.lastIndexOf(".");
  const seqStr = i > 0 ? s.slice(i + 1) : "";
  if (i <= 0 || !/^\d{1,15}$/.test(seqStr)) throw new LoiCheckpoint("THAM_SO_SAI", `checkpointId không hợp lệ: ${s}`);
  return { runId: kiemRunId(s.slice(0, i)), seq: kiemSeq(Number(seqStr)) };
}

function thuMucRun(runId: string): string {
  return path.join(thuMucKhoCheckpoint(), runId);
}

function thuMucSeq(runId: string, seq: number): string {
  return path.join(thuMucRun(runId), String(seq));
}

function duongBanSao(runId: string, seq: number, bam: string): string {
  if (!KHUON_BAM.test(bam)) throw new LoiCheckpoint("LOI_LUU_TRU", "băm bản sao không hợp lệ");
  return path.join(thuMucSeq(runId, seq), `${bam}.bin`);
}

/** Tổng byte đã dùng của một lượt chạy (đệ quy, không theo symlink). */
function dungLuong(dir: string): number {
  let tong = 0;
  let ds: fs.Dirent[];
  try {
    ds = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of ds) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tong += dungLuong(p);
    else if (e.isFile()) {
      try {
        tong += fs.statSync(p).size;
      } catch {
        /* biến mất giữa chừng — bỏ */
      }
    }
  }
  return tong;
}

/** Ghi nguyên tử (tệp tạm + rename) — một manifest dở dang không bao giờ được đọc thành checkpoint. */
function ghiManifest(cp: Checkpoint): void {
  const dich = path.join(thuMucSeq(cp.runId, cp.seq), "manifest.json");
  const tam = `${dich}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tam, JSON.stringify(cp, null, 2));
  fs.renameSync(tam, dich);
}

/** Đọc + kiểm manifest khớp CHÍNH chỗ nó nằm (runId/seq/id) — manifest lệch chỗ bị coi như không có. */
function docManifest(runId: string, seq: number): Checkpoint | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(thuMucSeq(runId, seq), "manifest.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const cp = JSON.parse(raw) as Checkpoint;
    if (cp?.runId !== runId || cp.seq !== seq || cp.id !== idCheckpoint(runId, seq)) return null;
    if (typeof cp.gocDuAn !== "string" || !Array.isArray(cp.muc)) return null;
    return cp;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ĐỌC CÂY DỰ ÁN — CHỈ qua cửa của hộp cát
// ══════════════════════════════════════════════════════════════════════════════════════════════
type TrangThaiTep =
  | { loi: string }
  | { loi?: undefined; tonTai: false }
  | { loi?: undefined; tonTai: true; quaLon: true }
  | { loi?: undefined; tonTai: true; quaLon?: false; noiDung: string; bam: string; khongPhaiUtf8: boolean; duong: string };

function chuanDuong(d: unknown): string {
  return String(d ?? "").replace(/\\/g, "/");
}

function docTrangThai(goc: string, duong: string): TrangThaiTep & { rel?: string } {
  const c = confineTargetUnder(goc, duong);
  if (!c.ok) return { loi: c.kind === "NOT_A_FILE" ? "NOT_A_FILE" : `PATH_REJECTED:${c.reason}` };
  const rel = c.target.relPath;
  if (!c.target.exists) return { tonTai: false, rel };
  const rd = readConfined(c.target, TRAN_TEP);
  if (!rd.ok) {
    if (rd.kind === "NOT_FOUND") return { tonTai: false, rel };
    return { loi: rd.kind === "PATH_REJECTED" ? `PATH_REJECTED:${rd.reason}` : rd.kind, rel };
  }
  if (rd.truncated) return { tonTai: true, quaLon: true, rel };
  const khongPhaiUtf8 = Buffer.byteLength(rd.content, "utf8") !== rd.size || rd.content.includes("�");
  return { tonTai: true, noiDung: rd.content, bam: bamUtf8(rd.content), khongPhaiUtf8, duong: rel, rel };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHỤP
// ══════════════════════════════════════════════════════════════════════════════════════════════
export async function chupTruocGhi(y: {
  runId: string;
  seq: number;
  gocDuAn: string;
  duongs: string[];
  /** Tuỳ chọn: chủ lượt chạy — có mặt ⇒ `hoanTac` chỉ nhận đúng người này. */
  userId?: number;
}): Promise<Checkpoint> {
  const runId = kiemRunId(y?.runId);
  const seq = kiemSeq(y?.seq);
  if (typeof y.gocDuAn !== "string" || !path.isAbsolute(y.gocDuAn)) throw new LoiCheckpoint("THAM_SO_SAI", "gocDuAn phải là đường TUYỆT ĐỐI");
  if (!Array.isArray(y.duongs) || y.duongs.length > TRAN_SO_DUONG) throw new LoiCheckpoint("THAM_SO_SAI", "duongs không hợp lệ");

  // 1. Đọc toàn bộ TRƯỚC khi chạm kho (vượt trần ⇒ không để lại thư mục dở).
  const muc: MucCheckpoint[] = [];
  const banSao = new Map<string, Buffer>();
  const daCo = new Set<string>();
  for (const d of y.duongs) {
    const tt = docTrangThai(y.gocDuAn, d);
    const duong = tt.rel ?? chuanDuong(d);
    if (daCo.has(duong)) continue;
    daCo.add(duong);
    if (tt.loi !== undefined) {
      muc.push({ duong, tonTai: false, bamTruoc: null, tuChoi: tt.loi });
    } else if (!tt.tonTai) {
      muc.push({ duong, tonTai: false, bamTruoc: null });
    } else if (tt.quaLon) {
      muc.push({ duong, tonTai: true, bamTruoc: null, tuChoi: "QUA_LON" });
    } else if (tt.khongPhaiUtf8) {
      muc.push({ duong, tonTai: true, bamTruoc: tt.bam, tuChoi: "KHONG_PHAI_UTF8" });
    } else {
      muc.push({ duong, tonTai: true, bamTruoc: tt.bam });
      banSao.set(tt.bam, Buffer.from(tt.noiDung, "utf8"));
    }
  }

  const cp: Checkpoint = {
    id: idCheckpoint(runId, seq),
    runId,
    seq,
    gocDuAn: path.resolve(y.gocDuAn),
    taoLuc: new Date().toISOString(),
    muc,
    ...(typeof y.userId === "number" ? { userId: y.userId } : {}),
  };

  // 2. Trần dung lượng của CẢ lượt chạy.
  const them = [...banSao.values()].reduce((s, b) => s + b.length, 0) + Buffer.byteLength(JSON.stringify(cp, null, 2));
  const daDung = dungLuong(thuMucRun(runId));
  const tran = tranByteMoiLuotChay();
  if (daDung + them > tran) {
    throw new LoiCheckpoint("VUOT_TRAN", `checkpoint lượt chạy ${runId} vượt trần ${tran} byte (đã ${daDung}, thêm ${them}) — KHÔNG ghi khi không chụp được`);
  }

  // 3. Ghi kho: mkdir KHÔNG đệ quy cho seq ⇒ seq trùng bị từ chối, không ghi đè checkpoint cũ.
  const dir = thuMucSeq(runId, seq);
  fs.mkdirSync(thuMucRun(runId), { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "EEXIST") throw new LoiCheckpoint("DA_TON_TAI", `checkpoint ${cp.id} đã tồn tại`);
    throw new LoiCheckpoint("LOI_LUU_TRU", String((e as Error)?.message ?? e));
  }
  try {
    for (const [bam, buf] of banSao) fs.writeFileSync(duongBanSao(runId, seq, bam), buf, { flag: "wx" });
    ghiManifest(cp);
  } catch (e) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    throw new LoiCheckpoint("LOI_LUU_TRU", String((e as Error)?.message ?? e));
  }
  return cp;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHỐT
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Ghi băm SAU vào manifest từ `thayDoi` của kết quả tool. Rỗng (tool từ chối ghi) ⇒ chỉ đánh dấu đã chốt;
 * mục vẫn `bamSau: undefined` và hoàn tác sẽ bỏ qua nếu tệp không đổi.
 * Đường đổi mà KHÔNG được chụp trước: tạo/đích-đổi-tên chắc chắn vắng trước (tool chỉ tạo khi vắng) ⇒
 * thêm mục vắng; sửa/xoá thì không biết byte gốc ⇒ thêm mục `tuChoi: KHONG_CHUP_TRUOC` (hoàn tác khai xung đột).
 */
export async function chotSauGhi(checkpointId: string, thayDoi: ThayDoiChot[]): Promise<void> {
  const { runId, seq } = tachId(checkpointId);
  const cp = docManifest(runId, seq);
  if (!cp) throw new LoiCheckpoint("KHONG_TIM_THAY", `không có checkpoint ${checkpointId}`);
  const tim = (d: string) => cp.muc.find((m) => m.duong === d);
  for (const td of Array.isArray(thayDoi) ? thayDoi : []) {
    const duong = chuanDuong(td.duong);
    let m = tim(duong);
    if (!m) {
      const vangTruoc = td.loai === "tao" || td.loai === "doi-ten";
      m = vangTruoc ? { duong, tonTai: false, bamTruoc: null } : { duong, tonTai: true, bamTruoc: null, tuChoi: "KHONG_CHUP_TRUOC" };
      cp.muc.push(m);
    }
    m.bamSau = td.bamSau ?? null;
    m.loai = td.loai;
    if (td.loai === "doi-ten" && td.tuDuong) {
      const tu = chuanDuong(td.tuDuong);
      m.tuDuong = tu;
      let nguon = tim(tu);
      if (!nguon) {
        // Đổi tên giữ nguyên nội dung ⇒ băm nguồn trước = băm đích sau.
        nguon = { duong: tu, tonTai: true, bamTruoc: td.bamSau ?? null };
        cp.muc.push(nguon);
      }
      nguon.bamSau = null;
      nguon.nguonCuaDoiTen = duong;
    }
  }
  cp.chotLuc = new Date().toISOString();
  ghiManifest(cp);
}

/**
 * ★ Tiện ích cho T4: kết quả `confirmAction().result` của một tool ghi ⇒ `thayDoi` cho `chotSauGhi`.
 * Lô (`apply_diff_batch`) đọc `daGhi` KỂ CẢ khi `BATCH_PARTIAL` — byte đã nằm trên đĩa thì phải hoàn tác được.
 */
export function thayDoiTuKetQuaGhi(tenTool: string, ketQua: unknown): ThayDoiChot[] {
  const data = (ketQua as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return [];
  if (tenTool === "apply_diff_batch") {
    const daGhi = Array.isArray(data.daGhi) ? (data.daGhi as Array<Record<string, unknown>>) : [];
    return daGhi
      .filter((d) => typeof d.path === "string")
      .map((d) => ({ duong: String(d.path), loai: d.created === true ? "tao" : "sua", bamSau: typeof d.sha256After === "string" ? d.sha256After : null }));
  }
  if (daBiTuChoiGhi(ketQua)) return [];
  if (tenTool === "apply_diff") {
    if (data.ok !== true || typeof data.path !== "string") return [];
    return [{ duong: data.path, loai: data.created === true ? "tao" : "sua", bamSau: typeof data.sha256After === "string" ? data.sha256After : null }];
  }
  if (Array.isArray(data.thayDoi)) {
    return (data.thayDoi as ThayDoiChot[]).filter((t) => typeof t?.duong === "string" && typeof t?.loai === "string");
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LIỆT KÊ + DỌN
// ══════════════════════════════════════════════════════════════════════════════════════════════
export async function danhSachCheckpoint(runId: string): Promise<Checkpoint[]> {
  const id = kiemRunId(runId);
  let ds: fs.Dirent[];
  try {
    ds = fs.readdirSync(thuMucRun(id), { withFileTypes: true });
  } catch {
    return [];
  }
  const ra: Checkpoint[] = [];
  for (const e of ds) {
    if (!e.isDirectory() || !/^\d{1,15}$/.test(e.name)) continue;
    const cp = docManifest(id, Number(e.name));
    if (cp) ra.push(cp);
  }
  return ra.sort((a, b) => a.seq - b.seq);
}

/** Xoá lượt chạy KHÔNG hoạt động lâu hơn `soNgay` (mốc = taoLuc/chotLuc/hoàn tác mới nhất). T4 gọi lúc boot. */
export async function donCheckpointCu(y: { soNgay?: number; bayGio?: number } = {}): Promise<{ daXoa: string[] }> {
  const soNgay = y.soNgay ?? 7;
  const bayGio = y.bayGio ?? Date.now();
  const kho = thuMucKhoCheckpoint();
  const daXoa: string[] = [];
  let ds: fs.Dirent[];
  try {
    ds = fs.readdirSync(kho, { withFileTypes: true });
  } catch {
    return { daXoa };
  }
  for (const e of ds) {
    if (!e.isDirectory() || !KHUON_RUN_ID.test(e.name)) continue;
    const cps = await danhSachCheckpoint(e.name);
    let moiNhat = 0;
    for (const cp of cps) {
      for (const t of [cp.taoLuc, cp.chotLuc, ...cp.muc.map((m) => m.daHoanTacLuc)]) {
        const ms = t ? Date.parse(t) : NaN;
        if (Number.isFinite(ms) && ms > moiNhat) moiNhat = ms;
      }
    }
    if (moiNhat === 0) {
      try {
        moiNhat = fs.statSync(path.join(kho, e.name)).mtimeMs;
      } catch {
        continue;
      }
    }
    if (bayGio - moiNhat > soNgay * NGAY_MS) {
      try {
        fs.rmSync(path.join(kho, e.name), { recursive: true, force: true });
        daXoa.push(e.name);
      } catch {
        /* best-effort — lần boot sau thử lại */
      }
    }
  }
  return { daXoa };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HOÀN TÁC
// ══════════════════════════════════════════════════════════════════════════════════════════════
const dangHoanTac = new Set<string>();

function cungDuong(a: string, b: string): boolean {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Trạng thái hiện tại có ĐÚNG là trạng thái (tonTai, bam) đã cho không. `bam === null` + tonTai = "có nhưng không băm được". */
function khop(tt: TrangThaiTep, tonTai: boolean, bam: string | null): boolean {
  if (tt.loi !== undefined) return false;
  if (!tonTai) return !tt.tonTai;
  if (!tt.tonTai) return false;
  if (tt.quaLon) return bam === null;
  return tt.bam === bam;
}

/** Đọc bản sao + băm lại: bản sao hỏng/thiếu ⇒ null (không bao giờ ghi một nội dung không khớp manifest). */
function docBanSao(cp: Checkpoint, bam: string): string | null {
  try {
    const buf = fs.readFileSync(duongBanSao(cp.runId, cp.seq, bam));
    const s = buf.toString("utf8");
    return bamUtf8(s) === bam && Buffer.from(s, "utf8").equals(buf) ? s : null;
  } catch {
    return null;
  }
}

/** MỘT lượt tool ghi khôi phục: đề xuất ⇒ xác nhận (`AI_AGENT_HOAN_TAC`) ⇒ đọc note thật. */
async function chayToolGhi(
  tool: "apply_diff" | "delete_file" | "rename_file",
  args: Record<string, unknown>,
  ctx: ToolExecContext,
  user: CopilotUser,
  lang: ToolLang,
): Promise<{ ok: true; actionId: string } | { ok: false; lyDo: string; actionId?: string }> {
  const out = await executeDecision({ tool, args }, ctx);
  if (out.denied) return { ok: false, lyDo: `BI_TU_CHOI_QUYEN: ${out.denied.reason ?? out.denied.message ?? ""}` };
  if (!out.pendingAction) return { ok: false, lyDo: `DE_XUAT_HONG: ${out.error ?? "không có pending action"}` };
  const { actionId, token } = out.pendingAction;
  const kq = await confirmAction(actionId, token, user, lang, ctx.req, {}, { reason: LY_DO_HOAN_TAC });
  if (!kq.ok) return { ok: false, lyDo: `XAC_NHAN_HONG: ${kq.status}${kq.reason ? ` ${kq.reason}` : ""}`, actionId };
  const note = maTuChoiGhi(kq.result);
  if (note !== null) return { ok: false, lyDo: `GHI_BI_TU_CHOI: ${note}`, actionId };
  return { ok: true, actionId };
}

export async function hoanTac(y: {
  runId: string;
  /** Vắng ⇒ cả lượt chạy, theo thứ tự NGƯỢC seq. */
  checkpointId?: string;
  execCtx: ToolExecContext;
  user: CopilotUser;
  lang: ToolLang;
}): Promise<KetQuaHoanTac> {
  const runId = kiemRunId(y?.runId);
  let cps: Checkpoint[];
  if (y.checkpointId !== undefined) {
    const t = tachId(y.checkpointId);
    if (t.runId !== runId) throw new LoiCheckpoint("THAM_SO_SAI", `checkpoint ${y.checkpointId} không thuộc lượt chạy ${runId}`);
    const cp = docManifest(t.runId, t.seq);
    if (!cp) throw new LoiCheckpoint("KHONG_TIM_THAY", `không có checkpoint ${y.checkpointId}`);
    cps = [cp];
  } else {
    cps = (await danhSachCheckpoint(runId)).reverse();
  }
  if (dangHoanTac.has(runId)) throw new LoiCheckpoint("DANG_HOAN_TAC", `lượt chạy ${runId} đang được hoàn tác`);
  dangHoanTac.add(runId);

  const kq: KetQuaHoanTac = { khoiPhuc: [], xungDot: [], boQua: [] };
  const actionIds: string[] = [];
  const gocHieuLuc = y.execCtx.projectRoot && y.execCtx.projectRoot !== "" ? y.execCtx.projectRoot : gocHopCat();
  try {
    for (const cp of cps) {
      const ctx: ToolExecContext = { ...y.execCtx, user: { id: y.user.id, role: y.user.role, name: y.user.name ?? null }, lang: y.lang, projectRoot: cp.gocDuAn };
      const chanCaCheckpoint = !cungDuong(cp.gocDuAn, gocHieuLuc)
        ? "GOC_DU_AN_KHAC: gốc của lượt hoàn tác khác gốc đã chụp"
        : typeof cp.userId === "number" && cp.userId !== y.user.id
          ? "KHONG_PHAI_CHU_LUOT_CHAY"
          : null;
      const nowIso = () => new Date().toISOString();
      let doi = false;

      // Thứ tự NGƯỢC trong checkpoint (lô nhiều tệp: tệp ghi sau hoàn tác trước).
      for (const m of [...cp.muc].reverse()) {
        if (m.nguonCuaDoiTen !== undefined) continue; // mục đích của cặp đổi tên xử lý
        if (m.daHoanTacLuc) {
          kq.boQua.push(m.duong);
          continue;
        }
        if (chanCaCheckpoint) {
          kq.xungDot.push({ duong: m.duong, lyDo: chanCaCheckpoint });
          continue;
        }
        const ht = docTrangThai(cp.gocDuAn, m.duong);
        const khopTruoc = khop(ht, m.tonTai, m.bamTruoc);

        // Không có bản sao: chỉ hợp lệ nếu không có gì để khôi phục.
        if (m.tuChoi !== undefined) {
          // Đường hộp cát vẫn từ chối y như lúc chụp ⇒ tool ghi cũng chưa từng ghi được vào đó.
          if (khopTruoc || (ht.loi !== undefined && ht.loi === m.tuChoi)) kq.boQua.push(m.duong);
          else kq.xungDot.push({ duong: m.duong, lyDo: `KHONG_CO_BAN_SAO: ${m.tuChoi}` });
          continue;
        }
        // Chưa chốt (lượt ghi chưa báo kết quả): không chứng minh được thay đổi là của agent.
        if (m.bamSau === undefined) {
          if (khopTruoc) kq.boQua.push(m.duong);
          else kq.xungDot.push({ duong: m.duong, lyDo: "CHUA_CHOT_SAU_GHI: không có băm sau để chứng minh thay đổi là của agent" });
          continue;
        }

        // ── ĐỔI TÊN: dời ngược đích → nguồn.
        if (m.loai === "doi-ten" && m.tuDuong) {
          const nguon = cp.muc.find((x) => x.duong === m.tuDuong);
          const htNguon = docTrangThai(cp.gocDuAn, m.tuDuong);
          const khopSauCap = khop(ht, true, m.bamSau) && khop(htNguon, false, null);
          const khopTruocCap = khop(ht, false, null) && khop(htNguon, true, nguon?.bamTruoc ?? m.bamSau);
          if (!khopSauCap) {
            if (khopTruocCap) kq.boQua.push(m.tuDuong);
            else kq.xungDot.push({ duong: m.duong, lyDo: htNguon.loi === undefined && htNguon.tonTai ? `NGUON_DA_CO_TEP: "${m.tuDuong}" đã có tệp — không ghi đè` : "BAM_HIEN_TAI_KHAC: tệp đã bị sửa sau lượt agent" });
            continue;
          }
          const r = await chayToolGhi("rename_file", { from: m.duong, to: m.tuDuong }, ctx, y.user, y.lang);
          if (r.actionId) actionIds.push(r.actionId);
          if (!r.ok) {
            kq.xungDot.push({ duong: m.duong, lyDo: r.lyDo });
            continue;
          }
          if (!khop(docTrangThai(cp.gocDuAn, m.tuDuong), true, m.bamSau) || !khop(docTrangThai(cp.gocDuAn, m.duong), false, null)) {
            kq.xungDot.push({ duong: m.duong, lyDo: "KHONG_KHOP_SAU_GHI: đĩa không ở trạng thái mong đợi sau lượt dời ngược" });
            continue;
          }
          m.daHoanTacLuc = nowIso();
          if (nguon) nguon.daHoanTacLuc = m.daHoanTacLuc;
          doi = true;
          kq.khoiPhuc.push(m.tuDuong);
          continue;
        }

        // ── SỬA / TẠO / XOÁ.
        const khongDoi = m.tonTai ? m.bamSau === m.bamTruoc : m.bamSau === null;
        if (khongDoi) {
          kq.boQua.push(m.duong);
          continue;
        }
        if (!khop(ht, m.bamSau !== null, m.bamSau)) {
          if (khopTruoc) kq.boQua.push(m.duong);
          else kq.xungDot.push({ duong: m.duong, lyDo: "BAM_HIEN_TAI_KHAC: tệp đã bị sửa sau lượt agent — không ghi đè" });
          continue;
        }
        let r: Awaited<ReturnType<typeof chayToolGhi>>;
        if (m.tonTai) {
          const goc = m.bamTruoc ? docBanSao(cp, m.bamTruoc) : null;
          if (goc === null) {
            kq.xungDot.push({ duong: m.duong, lyDo: "BAN_SAO_HONG: bản sao trong kho thiếu hoặc không khớp băm manifest" });
            continue;
          }
          const hienTai = ht.loi === undefined && ht.tonTai && !ht.quaLon ? ht.noiDung : "";
          r = await chayToolGhi("apply_diff", { path: m.duong, original: hienTai, modified: goc }, ctx, y.user, y.lang);
        } else {
          r = await chayToolGhi("delete_file", { path: m.duong }, ctx, y.user, y.lang);
        }
        if (r.actionId) actionIds.push(r.actionId);
        if (!r.ok) {
          kq.xungDot.push({ duong: m.duong, lyDo: r.lyDo });
          continue;
        }
        // Tin đĩa, không tin lời khai: đọc lại và so với trạng thái TRƯỚC.
        if (!khop(docTrangThai(cp.gocDuAn, m.duong), m.tonTai, m.bamTruoc)) {
          kq.xungDot.push({ duong: m.duong, lyDo: "KHONG_KHOP_SAU_GHI: đĩa không ở trạng thái trước-agent sau lượt khôi phục" });
          continue;
        }
        m.daHoanTacLuc = nowIso();
        doi = true;
        kq.khoiPhuc.push(m.duong);
      }
      if (doi) {
        try {
          ghiManifest(cp);
        } catch {
          /* đĩa đã đúng; lần sau mục này rơi vào nhánh "đã ở trạng thái trước" ⇒ bỏ qua */
        }
      }
    }
  } finally {
    dangHoanTac.delete(runId);
  }

  // ── AUDIT: MỘT hàng tổng cho lần hoàn tác này (từng lượt ghi có bộ hàng HITL riêng — `actionIds`).
  await logCrudOperation(createAuditContext({ user: { id: y.user.id, name: y.user.name ?? null }, req: y.execCtx.req }), {
    action: AUDIT_ACTIONS.AI_AGENT_HOAN_TAC,
    entityType: ENTITY_TYPES.AI_ACTION,
    entityName: runId,
    details: {
      operation: "AI_AGENT_HOAN_TAC",
      metadata: {
        runId,
        checkpointId: y.checkpointId ?? null,
        checkpoints: cps.map((c) => c.id),
        lyDo: LY_DO_HOAN_TAC,
        nguoiBam: y.user.id,
        khoiPhuc: kq.khoiPhuc,
        xungDot: kq.xungDot,
        boQua: kq.boQua,
        actionIds,
      },
    },
    status: kq.xungDot.length === 0 ? "success" : "failure",
  });
  return kq;
}
