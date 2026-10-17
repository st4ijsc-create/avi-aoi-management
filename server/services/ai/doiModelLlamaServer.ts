/**
 * ★★★ Đợt 6 — ĐỔI MODEL `llama-server` QUA API, CÓ KIỂM `/props` (thay `doi-model.ps1` cho sản phẩm;
 * kịch bản kia giữ vai CÔNG CỤ ĐO).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HỢP ĐỒNG — một lượt đổi đi qua đúng các bước sau, và MỌI đường ra dọn sạch
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   TRƯỚC khi chạm gì (từ chối ⇒ `LoiDoiModel`, không tệp/khoá/tiến trình nào bị đụng):
 *     1. kiem-lua-chon  — tên là basename trong `GGUF_MODELS_DIR` (danh sách trắng, realpath trong kho),
 *                         loại sinh chữ (không mmproj/embedding/reranker); llama-server bật + loopback.
 *     2. giu-khoa       — không có tệp tạm dừng (doi-model.ps1 / lượt khác), bộ giám sát không đang
 *                         khởi động (khoá của nó), giành khoá liên tiến trình `llama-doi-model.lock`.
 *     3. kiem-server    — `/props` hiện tại đọc được (mốc để QUAY VỀ) và khác model được chọn.
 *     4. uoc-luong-vram — trọng số (kích thước tệp) + KV f16 (chỉ tầng chú ý, đọc header GGUF) + phụ phí;
 *                         so với trống SAU KHI trả phần ước lượng của model cũ. Không đọc được VRAM ⇒ từ chối.
 *   SAU ĐÓ (nền; UI hỏi `trangThai()`):
 *     5. tam-dung-giam-sat — tạo ĐÚNG tệp tạm dừng mà bộ giám sát đọc (`doi-model.ps1` cùng cơ chế), chạm
 *                            mtime mỗi 60 s (giám sát bỏ qua tệp cũ hơn 30 phút).
 *     6. cho-hang-doi      — giữ TOÀN BỘ slot của cổng ưu tiên (chờ lượt tương tác đang chạy, có trần);
 *                            hết giờ ⇒ HUỶ, KHÔNG đổi gì.
 *     7. ghi-lua-chon      — tệp lựa chọn bền (`luaChonModelLlamaServer.ts`) — thứ kịch bản khởi động đọc.
 *     8. khoi-dong         — `start-llama-server.ps1 -Force` qua `khoiDongTachRoi` — ĐÚNG đường mà bộ giám
 *                            sát và Task Scheduler dùng (không nhân đôi dòng lệnh llama-server ở đây).
 *     9. kiem-props        — `model_path` = model mới, `n_ctx`/slot và `total_slots` khớp `.env`.
 *    10. sinh-thu          — một lượt chat ngắn (nghĩ TẮT) phải ra token.
 *    11. ap-dung           — phủ "BA khoá" env của tiến trình này ⇒ định tuyến đi server với tên mới.
 *   Hỏng ở 8–10 ⇒ quay-ve: trả tệp lựa chọn Y NGUYÊN, chạy lại kịch bản `-Force`, kiểm `/props` model cũ.
 *
 * GIỚI HẠN (nói thẳng): cổng ưu tiên là của TIẾN TRÌNH NÀY. Lượt đang chạy ở tiến trình anh em (worktree
 * khác, script đo) bị cắt khi kịch bản giết server; lượt MỚI của họ gặp server chết ⇒ cửa fail-closed chờ
 * ≤ 120 s (không nạp in-process). Tiến trình anh em phủ env theo lựa chọn mới trong ≤ 15 s.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  dangTamDung,
  docCauHinhGiamSat,
  docKhoa,
  khoiDongTachRoi,
  laPidSongMacDinh,
  nhaKhoa,
  thuGiuKhoa,
} from "./giamSatLlamaServer";
import {
  apDungLuaChonModel,
  docNoiDungTho,
  duongLuaChon,
  ghiLuaChon,
  khoiPhucNoiDungTho,
  laTenModelHopLe,
  modelEnvGoc,
  tenModelGoc,
} from "./luaChonModelLlamaServer";

const GiB = 1024 ** 3;

// ─── Kho model ────────────────────────────────────────────────────────────────────────────────

export interface ModelTrongKho {
  ten: string;
  kichThuoc: number;
  loai: "sinh-chu" | "khong-ho-tro";
  lyDoKhongHoTro: string | null;
}

function phanLoai(ten: string): { loai: ModelTrongKho["loai"]; lyDo: string | null } {
  if (/mmproj/i.test(ten)) return { loai: "khong-ho-tro", lyDo: "tệp chiếu thị giác (mmproj) — không tự chạy được" };
  if (/embed/i.test(ten)) return { loai: "khong-ho-tro", lyDo: "model nhúng (embedding) — không sinh chữ" };
  if (/rerank/i.test(ten)) return { loai: "khong-ho-tro", lyDo: "model xếp hạng (reranker) — không sinh chữ" };
  return { loai: "sinh-chu", lyDo: null };
}

/** Tệp `.gguf` THƯỜNG ở GỐC kho (không đệ quy, không symlink, không thư mục). Không bao giờ ném. */
export function lietKeModelTrongKho(thuMuc: string): ModelTrongKho[] {
  if (!thuMuc) return [];
  let muc: fs.Dirent[];
  try {
    muc = fs.readdirSync(thuMuc, { withFileTypes: true });
  } catch {
    return [];
  }
  const ra: ModelTrongKho[] = [];
  for (const m of muc) {
    if (!m.isFile() || !laTenModelHopLe(m.name)) continue;
    let kichThuoc = 0;
    try {
      kichThuoc = fs.statSync(path.join(thuMuc, m.name)).size;
    } catch {
      continue;
    }
    const pl = phanLoai(m.name);
    ra.push({ ten: m.name, kichThuoc, loai: pl.loai, lyDoKhongHoTro: pl.lyDo });
  }
  return ra.sort((a, b) => a.ten.localeCompare(b.ten));
}

/** Danh sách trắng: basename hợp lệ + có trong `lietKeModelTrongKho` + sinh chữ + realpath nằm trong kho. */
export function xacThucTenModel(thuMuc: string, ten: string): { ok: true; duong: string } | { ok: false; lyDo: string } {
  if (!thuMuc) return { ok: false, lyDo: "chưa khai kho model (GGUF_MODELS_DIR)." };
  if (!laTenModelHopLe(ten)) return { ok: false, lyDo: "tên model phải là tên tệp .gguf trong kho — không nhận đường dẫn." };
  const m = lietKeModelTrongKho(thuMuc).find((x) => x.ten === ten);
  if (!m) return { ok: false, lyDo: `không có tệp ${ten} trong kho model.` };
  if (m.loai !== "sinh-chu") return { ok: false, lyDo: `${ten}: ${m.lyDoKhongHoTro}.` };
  try {
    const goc = fs.realpathSync(thuMuc);
    const that = fs.realpathSync(path.join(thuMuc, ten));
    if (path.dirname(that).toLowerCase() !== goc.toLowerCase()) return { ok: false, lyDo: `${ten} trỏ ra ngoài kho model.` };
    return { ok: true, duong: that };
  } catch {
    return { ok: false, lyDo: `không đọc được ${ten}.` };
  }
}

// ─── /props + sinh thử ────────────────────────────────────────────────────────────────────────

export interface ThongTinProps {
  modelPath: string;
  tenModel: string;
  /** `default_generation_settings.n_ctx` — ngữ cảnh MỖI SLOT. */
  nCtx: number | null;
  tongSlot: number | null;
}

function tieuDe(env: NodeJS.ProcessEnv): Record<string, string> {
  const key = (env.LLAMA_SERVER_API_KEY || "").trim();
  return key ? { authorization: `Bearer ${key}` } : {};
}

async function voiHetGio<T>(ms: number, f: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await f(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** GET `/props`. NÉM khi không đọc được (người gọi quyết định nghĩa của "không đọc được"). */
export async function docProps(url: string, fetchFn: typeof fetch, hetGioMs: number, env: NodeJS.ProcessEnv = process.env): Promise<ThongTinProps> {
  return voiHetGio(hetGioMs, async (signal) => {
    const res = await fetchFn(`${url.replace(/\/+$/, "")}/props`, { headers: tieuDe(env), signal });
    const txt = await res.text();
    if (!res.ok) throw new Error(`/props HTTP ${res.status}`);
    const j = JSON.parse(txt);
    const modelPath = String(j?.model_path ?? "");
    if (!modelPath) throw new Error("/props không có model_path");
    const n = Number(j?.default_generation_settings?.n_ctx);
    const s = Number(j?.total_slots);
    return {
      modelPath,
      tenModel: `${tenModelGoc(modelPath)}.gguf`,
      nCtx: Number.isFinite(n) && n > 0 ? n : null,
      tongSlot: Number.isFinite(s) && s > 0 ? s : null,
    };
  });
}

/** Danh sách chỗ lệch (rỗng = khớp). */
export function kiemProps(p: ThongTinProps, mong: { tenModel: string; nCtx: number; tongSlot: number }): string[] {
  const lech: string[] = [];
  if (tenModelGoc(p.tenModel) !== tenModelGoc(mong.tenModel)) lech.push(`model_path là ${p.tenModel}, mong ${mong.tenModel}`);
  if (p.nCtx !== mong.nCtx) lech.push(`n_ctx mỗi slot là ${p.nCtx ?? "?"}, mong ${mong.nCtx}`);
  if (p.tongSlot !== mong.tongSlot) lech.push(`total_slots là ${p.tongSlot ?? "?"}, mong ${mong.tongSlot}`);
  return lech;
}

/** Một lượt chat ngắn, nghĩ TẮT. Không ném — trả `ok:false` kèm lý do. Đi THẲNG server (đang giữ cổng). */
export async function sinhThuNgan(
  url: string,
  fetchFn: typeof fetch,
  hetGioMs: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; chu: string; ms: number; lyDo: string | null }> {
  const t0 = Date.now();
  try {
    return await voiHetGio(hetGioMs, async (signal) => {
      const res = await fetchFn(`${url.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...tieuDe(env) },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
          max_tokens: 16,
          temperature: 0,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal,
      });
      const txt = await res.text();
      if (!res.ok) return { ok: false, chu: "", ms: Date.now() - t0, lyDo: `HTTP ${res.status}: ${txt.slice(0, 160)}` };
      const j = JSON.parse(txt);
      const msg = j?.choices?.[0]?.message ?? {};
      const chu = String(msg.content ?? "").trim() || String(msg.reasoning_content ?? "").trim();
      const soToken = Number(j?.usage?.completion_tokens ?? 0);
      const ok = chu.length > 0 || soToken > 0;
      return { ok, chu: chu.slice(0, 80), ms: Date.now() - t0, lyDo: ok ? null : "server trả 0 token" };
    });
  } catch (e: any) {
    return { ok: false, chu: "", ms: Date.now() - t0, lyDo: e?.name === "AbortError" ? `quá ${hetGioMs} ms` : String(e?.message ?? e).slice(0, 160) };
  }
}

// ─── Ước lượng VRAM ──────────────────────────────────────────────────────────────────────────

export interface MetaGguf {
  /** Số tầng CÓ KV (MoE lai Qwen3.6: chỉ 1/`full_attention_interval` tầng là chú ý đầy đủ). */
  soTangChuY: number;
  soDauKv: number;
  doDaiKey: number;
  doDaiValue: number;
}

/**
 * trọng số ≈ kích thước tệp · KV f16 = tầng-chú-ý × đầu-KV × (dK + dV) × 2 byte × n_ctx · + phụ phí (bộ
 * đệm tính toán). Kiểm bằng số đã đo: Qwen3-30B-A3B 64k ⇒ KV 6 GiB (khớp 6.144 MiB đo 2026-08-16).
 * Không đọc được header ⇒ KV 8 GiB (thận trọng: thà từ chối oan còn hơn OOM giữa lúc dừng server).
 */
export function uocLuongVramByte(
  tepByte: number,
  meta: MetaGguf | null,
  nCtx: number,
  phuPhiByte: number,
): { tong: number; trongSo: number; kv: number; phuPhi: number; coMeta: boolean } {
  const kv = meta ? meta.soTangChuY * meta.soDauKv * (meta.doDaiKey + meta.doDaiValue) * 2 * nCtx : 8 * GiB;
  return { tong: tepByte + kv + phuPhiByte, trongSo: tepByte, kv, phuPhi: phuPhiByte, coMeta: !!meta };
}

/** Header GGUF qua `readGgufFileInfo` (thuần JS, KHÔNG tạo ngữ cảnh CUDA). Không ném — `null`. */
export async function docMetaGgufMacDinh(duong: string): Promise<MetaGguf | null> {
  try {
    const { readGgufFileInfo } = await import("node-llama-cpp");
    const info: any = await readGgufFileInfo(duong, { readTensorInfo: false });
    const md: any = info?.metadata ?? {};
    const arch = md?.general?.architecture;
    const a: any = arch ? md[arch] : null;
    if (!a) return null;
    const soTang = Number(a.block_count);
    const att = a.attention ?? {};
    const hc = Number(att.head_count);
    const hkvTho = att.head_count_kv;
    const hkv = Array.isArray(hkvTho) ? Math.max(...hkvTho.map(Number)) : Number(hkvTho ?? hc);
    const emb = Number(a.embedding_length);
    const dK = Number(att.key_length ?? (emb && hc ? emb / hc : NaN));
    const dV = Number(att.value_length ?? dK);
    const fai = Number(a.full_attention_interval);
    const soTangChuY = Number.isFinite(fai) && fai > 1 ? Math.ceil(soTang / fai) : soTang;
    if (![soTangChuY, hkv, dK, dV].every((x) => Number.isFinite(x) && x > 0)) return null;
    return { soTangChuY, soDauKv: hkv, doDaiKey: dK, doDaiValue: dV };
  } catch {
    return null;
  }
}

// ─── Điều phối ───────────────────────────────────────────────────────────────────────────────

export type MaLoiDoiModel =
  | "TAT"
  | "MODEL_KHONG_HOP_LE"
  | "DANG_DOI"
  | "DANG_TAM_DUNG"
  | "GIAM_SAT_DANG_KHOI_DONG"
  | "SERVER_KHONG_SONG"
  | "DA_DANG_CHAY"
  | "VRAM_KHONG_DOC_DUOC"
  | "VRAM_KHONG_DU";

export class LoiDoiModel extends Error {
  constructor(
    readonly code: MaLoiDoiModel,
    message: string,
  ) {
    super(message);
    this.name = "LoiDoiModel";
  }
}

export type TenBuoc =
  | "kiem-lua-chon"
  | "giu-khoa"
  | "kiem-server"
  | "uoc-luong-vram"
  | "tam-dung-giam-sat"
  | "cho-hang-doi"
  | "ghi-lua-chon"
  | "khoi-dong"
  | "kiem-props"
  | "sinh-thu"
  | "ap-dung"
  | "quay-ve";

export interface BuocDoiModel {
  buoc: TenBuoc;
  trangThai: "cho" | "dang-chay" | "xong" | "loi" | "bo-qua";
  chiTiet: string | null;
  luc: string | null;
}

export interface UocLuongVram {
  canByte: number;
  trongSauKhiDungByte: number;
  dungByte: number;
  tongByte: number;
  kvByte: number;
  coMeta: boolean;
}

export interface PhienDoiModel {
  id: string;
  modelCu: string;
  modelMoi: string;
  nguoi: string | null;
  batDau: string;
  ketThuc: string | null;
  ketQua: "dang-chay" | "thanh-cong" | "that-bai-da-quay-ve" | "that-bai-quay-ve-hong" | "huy-khong-doi";
  buoc: BuocDoiModel[];
  vram: UocLuongVram | null;
  propsCu: ThongTinProps | null;
  props: ThongTinProps | null;
  sinhThu: { chu: string; ms: number } | null;
  loi: string | null;
  canhBao: string[];
}

export interface PhuThuocDoiModel {
  env: NodeJS.ProcessEnv;
  nenTang?: NodeJS.Platform;
  fetchFn: typeof fetch;
  /** Chạy `start-llama-server.ps1` với cờ thêm; trả mã thoát (`null` = không chạy được / quá giờ). */
  chayKichBan: (thamSo: readonly "-Force"[]) => Promise<{ ma: number | null; loi?: string }>;
  docVram: () => Promise<{ usedBytes: number; totalBytes: number } | null>;
  docMetaGguf: (duong: string) => Promise<MetaGguf | null>;
  kichThuocTep?: (duong: string) => number;
  /** Giữ toàn bộ slot cổng ưu tiên; trả hàm nhả. Ném ⇒ huỷ lượt đổi (không đổi gì). */
  giuCong: (choToiDaMs: number) => Promise<() => void>;
  bayGio: () => number;
  duongTamDung: string;
  duongKhoaDoi: string;
  duongKhoaGiamSat: string;
  khiKetThuc?: (p: PhienDoiModel) => void | Promise<void>;
  hetGio?: Partial<{ propsMs: number; sinhThuMs: number; choHangMs: number; chamTamDungMs: number }>;
}

const THU_TU_BUOC: TenBuoc[] = [
  "kiem-lua-chon",
  "giu-khoa",
  "kiem-server",
  "uoc-luong-vram",
  "tam-dung-giam-sat",
  "cho-hang-doi",
  "ghi-lua-chon",
  "khoi-dong",
  "kiem-props",
  "sinh-thu",
  "ap-dung",
  "quay-ve",
];

const MO_TA_MA_THOAT: Record<number, string> = {
  2: "cấu hình .env / không thấy tệp model",
  3: "cổng bị tiến trình KHÔNG phải llama-server chiếm",
  4: "llama-server thoát sớm (thường là hết VRAM / tệp hỏng — xem logs/llama-server-*.err.log)",
  5: "quá giờ chờ /health",
};

function soEnv(env: NodeJS.ProcessEnv, ten: string, macDinh: number): number {
  const n = Number(env[ten]);
  return Number.isFinite(n) && n > 0 ? n : macDinh;
}

function laLoopback(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}

export class DieuPhoiDoiModel {
  private phien: PhienDoiModel | null = null;
  private dangChay = false;

  constructor(private readonly d: PhuThuocDoiModel) {}

  trangThai(): PhienDoiModel | null {
    return this.phien ? structuredClone(this.phien) : null;
  }

  dangDoi(): boolean {
    return this.dangChay;
  }

  /** Mong đợi cấu hình từ `.env`: ctx tổng / slot (cùng biến mà kịch bản dựng `-c`/`-np`). */
  private mong(): { nCtx: number; tongSlot: number } {
    const tong = soEnv(this.d.env, "LLAMA_SERVER_CTX_TOTAL", 65536);
    const slot = soEnv(this.d.env, "LLAMA_SERVER_SLOTS", 1);
    return { nCtx: Math.floor(tong / slot), tongSlot: slot };
  }

  private url(): string {
    return (this.d.env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
  }

  /**
   * Kiểm trước (đồng bộ với người gọi — từ chối ⇒ ném `LoiDoiModel`, không đụng gì), rồi chạy phần dài
   * ở nền. `xong` cho test/người gọi muốn chờ; router chỉ trả `id`.
   */
  async batDau(tenModel: string, nguoi: string | null): Promise<{ id: string; xong: Promise<PhienDoiModel> }> {
    const env = this.d.env;
    if (env.LLAMA_SERVER_ENABLED !== "true" || !this.url()) throw new LoiDoiModel("TAT", "llama-server không bật trong cấu hình.");
    if (!laLoopback(this.url())) throw new LoiDoiModel("TAT", "llama-server không ở máy này (URL không loopback) — không đổi model từ xa được.");
    if ((this.d.nenTang ?? process.platform) !== "win32") throw new LoiDoiModel("TAT", "kịch bản khởi động là PowerShell/Windows.");

    const kho = (env.GGUF_MODELS_DIR || "").trim();
    const xt = xacThucTenModel(kho, tenModel);
    if (!xt.ok) throw new LoiDoiModel("MODEL_KHONG_HOP_LE", xt.lyDo);

    if (this.dangChay) throw new LoiDoiModel("DANG_DOI", "đang có một lượt đổi model chạy.");
    const bayGio = this.d.bayGio();
    if (dangTamDung(this.d.duongTamDung, bayGio, 30 * 60_000))
      throw new LoiDoiModel("DANG_TAM_DUNG", "giám sát llama-server đang tạm dừng (doi-model.ps1 hoặc lượt đổi khác đang chạy).");
    const kGs = docKhoa(this.d.duongKhoaGiamSat);
    if (kGs && bayGio - kGs.luc < 10 * 60_000 && laPidSongMacDinh(kGs.pid))
      throw new LoiDoiModel("GIAM_SAT_DANG_KHOI_DONG", `bộ giám sát (PID ${kGs.pid}) đang khởi động lại llama-server — thử lại sau.`);

    const khoa = thuGiuKhoa(this.d.duongKhoaDoi, { bayGio, hetHanMs: 20 * 60_000 });
    if (!khoa.duoc) throw new LoiDoiModel("DANG_DOI", `tiến trình khác${khoa.chu ? ` (PID ${khoa.chu.pid})` : ""} đang đổi model.`);
    this.dangChay = true;

    let propsCu: ThongTinProps;
    let vram: UocLuongVram;
    try {
      try {
        propsCu = await docProps(this.url(), this.d.fetchFn, this.d.hetGio?.propsMs ?? 5000, env);
      } catch (e: any) {
        throw new LoiDoiModel("SERVER_KHONG_SONG", `không đọc được /props của llama-server (${String(e?.message ?? e).slice(0, 120)}) — không có mốc để quay về; để bộ giám sát dựng lại trước.`);
      }
      if (tenModelGoc(propsCu.tenModel) === tenModelGoc(tenModel)) throw new LoiDoiModel("DA_DANG_CHAY", `llama-server đang chạy đúng ${tenModel}.`);

      const dv = await this.d.docVram().catch(() => null);
      if (!dv || !(dv.totalBytes > 0)) throw new LoiDoiModel("VRAM_KHONG_DOC_DUOC", "không đọc được VRAM thiết bị — từ chối đổi (fail-closed).");
      const nCtxTong = soEnv(env, "LLAMA_SERVER_CTX_TOTAL", 65536);
      const phuPhi = soEnv(env, "LLAMA_DOI_MODEL_PHU_PHI_MIB", 3072) * 1024 * 1024;
      const demAnToan = soEnv(env, "LLAMA_DOI_MODEL_DEM_AN_TOAN_MIB", 512) * 1024 * 1024;
      const kichThuoc = this.d.kichThuocTep ?? ((p: string) => fs.statSync(p).size);
      const duongCu = path.join(kho, path.basename(propsCu.modelPath.replace(/\\/g, "/")));
      const moi = uocLuongVramByte(kichThuoc(xt.duong), await this.d.docMetaGguf(xt.duong), nCtxTong, phuPhi);
      let traLai = 0;
      try {
        const cu = uocLuongVramByte(kichThuoc(propsCu.modelPath), await this.d.docMetaGguf(propsCu.modelPath), nCtxTong, phuPhi);
        traLai = Math.min(cu.tong, dv.usedBytes);
      } catch {
        try {
          const cu = uocLuongVramByte(kichThuoc(duongCu), await this.d.docMetaGguf(duongCu), nCtxTong, phuPhi);
          traLai = Math.min(cu.tong, dv.usedBytes);
        } catch {
          traLai = 0; // không biết model cũ chiếm bao nhiêu ⇒ không cộng lại gì (thận trọng)
        }
      }
      vram = {
        canByte: moi.tong + demAnToan,
        trongSauKhiDungByte: dv.totalBytes - dv.usedBytes + traLai,
        dungByte: dv.usedBytes,
        tongByte: dv.totalBytes,
        kvByte: moi.kv,
        coMeta: moi.coMeta,
      };
      if (vram.canByte > vram.trongSauKhiDungByte) {
        const g = (b: number) => (b / GiB).toFixed(1);
        throw new LoiDoiModel(
          "VRAM_KHONG_DU",
          `${tenModel} cần ≈ ${g(vram.canByte)} GiB (trọng số ${g(moi.trongSo)} + KV ${g(moi.kv)} + phụ phí ${g(moi.phuPhi)} + đệm), ` +
            `card còn ≈ ${g(vram.trongSauKhiDungByte)} GiB sau khi dừng model hiện tại — không vừa.`,
        );
      }
    } catch (e) {
      nhaKhoa(this.d.duongKhoaDoi, khoa.token);
      this.dangChay = false;
      throw e;
    }

    const luc = new Date(bayGio).toISOString();
    const phien: PhienDoiModel = {
      id: randomUUID(),
      modelCu: propsCu.tenModel,
      modelMoi: tenModel,
      nguoi,
      batDau: luc,
      ketThuc: null,
      ketQua: "dang-chay",
      buoc: THU_TU_BUOC.map((b) => ({ buoc: b, trangThai: "cho", chiTiet: null, luc: null })),
      vram,
      propsCu,
      props: null,
      sinhThu: null,
      loi: null,
      canhBao: [],
    };
    this.phien = phien;
    this.datBuoc("kiem-lua-chon", "xong", tenModel);
    this.datBuoc("giu-khoa", "xong", null);
    this.datBuoc("kiem-server", "xong", `đang chạy ${propsCu.tenModel} (n_ctx ${propsCu.nCtx ?? "?"}, ${propsCu.tongSlot ?? "?"} slot)`);
    this.datBuoc(
      "uoc-luong-vram",
      "xong",
      `cần ≈ ${(vram.canByte / GiB).toFixed(1)} GiB / trống sau dừng ≈ ${(vram.trongSauKhiDungByte / GiB).toFixed(1)} GiB${vram.coMeta ? "" : " (không đọc được header GGUF — KV ước 8 GiB)"}`,
    );
    const xong = this.chayNen(phien, khoa.token);
    return { id: phien.id, xong };
  }

  private datBuoc(b: TenBuoc, trangThai: BuocDoiModel["trangThai"], chiTiet: string | null): void {
    const x = this.phien?.buoc.find((y) => y.buoc === b);
    if (!x) return;
    x.trangThai = trangThai;
    if (chiTiet !== null) x.chiTiet = chiTiet;
    x.luc = new Date(this.d.bayGio()).toISOString();
  }

  private async chayNen(p: PhienDoiModel, tokenKhoa: string): Promise<PhienDoiModel> {
    const env = this.d.env;
    const url = this.url();
    const mong = this.mong();
    const dLuaChon = duongLuaChon(env);
    let nhaCong: (() => void) | null = null;
    let hen: NodeJS.Timeout | null = null;
    let daTaoTamDung = false;
    let thoCu: string | null | undefined; // undefined = chưa ghi lựa chọn (không có gì để trả)

    const quayVe = async (lyDo: string): Promise<void> => {
      p.loi = lyDo;
      this.datBuoc("quay-ve", "dang-chay", `quay về ${p.modelCu}`);
      try {
        if (thoCu !== undefined) khoiPhucNoiDungTho(dLuaChon, thoCu);
        apDungLuaChonModel(env);
        const kb = await this.d.chayKichBan(["-Force"]);
        if (kb.ma !== 0) throw new Error(`kịch bản thoát ${kb.ma ?? "?"}${kb.ma && MO_TA_MA_THOAT[kb.ma] ? ` (${MO_TA_MA_THOAT[kb.ma]})` : ""}${kb.loi ? `: ${kb.loi}` : ""}`);
        const pr = await docProps(url, this.d.fetchFn, this.d.hetGio?.propsMs ?? 5000, env);
        const lech = kiemProps(pr, { tenModel: p.modelCu, ...mong });
        if (tenModelGoc(pr.tenModel) !== tenModelGoc(p.modelCu)) throw new Error(lech.join("; "));
        p.props = pr;
        if (lech.length) p.canhBao.push(`sau khi quay về: ${lech.join("; ")}`);
        this.datBuoc("quay-ve", "xong", `đã quay về ${pr.tenModel}`);
        p.ketQua = "that-bai-da-quay-ve";
      } catch (e: any) {
        this.datBuoc("quay-ve", "loi", String(e?.message ?? e).slice(0, 300));
        p.ketQua = "that-bai-quay-ve-hong";
        p.canhBao.push("Quay về KHÔNG thành công — bộ giám sát sẽ dựng lại llama-server từ lựa chọn cũ khi tạm dừng được gỡ. Xem logs/llama-server-*.err.log.");
      }
    };

    try {
      // 5. tạm dừng giám sát — đúng tệp, đúng cơ chế doi-model.ps1.
      fs.mkdirSync(path.dirname(this.d.duongTamDung), { recursive: true });
      fs.writeFileSync(this.d.duongTamDung, `doi-model API PID ${process.pid} ${new Date().toISOString()} ${p.modelMoi}`);
      daTaoTamDung = true;
      hen = setInterval(() => {
        try {
          const t = new Date();
          fs.utimesSync(this.d.duongTamDung, t, t);
        } catch {
          /* tệp bị ai gỡ — nhịp sau giám sát có thể chạy; lượt đổi vẫn giữ khoá của nó */
        }
      }, this.d.hetGio?.chamTamDungMs ?? 60_000);
      hen.unref?.();
      this.datBuoc("tam-dung-giam-sat", "xong", this.d.duongTamDung);

      // 6. chờ hàng đợi.
      this.datBuoc("cho-hang-doi", "dang-chay", null);
      const choHangMs = this.d.hetGio?.choHangMs ?? soEnv(env, "LLAMA_DOI_MODEL_CHO_HANG_MS", 120_000);
      try {
        nhaCong = await this.d.giuCong(choHangMs);
      } catch (e: any) {
        this.datBuoc("cho-hang-doi", "loi", `lượt LLM đang chạy chưa xong sau ${Math.round(choHangMs / 1000)} s — huỷ, KHÔNG đổi gì (${String(e?.message ?? e).slice(0, 120)})`);
        p.ketQua = "huy-khong-doi";
        p.loi = "Hết giờ chờ các lượt AI đang chạy — chưa đổi gì. Thử lại khi máy rảnh.";
        return p;
      }
      this.datBuoc("cho-hang-doi", "xong", null);

      // 7. ghi lựa chọn bền.
      thoCu = docNoiDungTho(dLuaChon);
      ghiLuaChon(dLuaChon, { v: 1, model: p.modelMoi, envModel: modelEnvGoc(env), luc: new Date().toISOString(), nguoi: p.nguoi });
      this.datBuoc("ghi-lua-chon", "xong", dLuaChon);

      // 8. khởi động bằng ĐÚNG đường của bộ giám sát.
      this.datBuoc("khoi-dong", "dang-chay", "start-llama-server.ps1 -Force");
      const kb = await this.d.chayKichBan(["-Force"]);
      if (kb.ma !== 0) {
        const cau = `kịch bản khởi động thoát ${kb.ma ?? "?"}${kb.ma && MO_TA_MA_THOAT[kb.ma] ? ` — ${MO_TA_MA_THOAT[kb.ma]}` : ""}${kb.loi ? `: ${kb.loi}` : ""}`;
        this.datBuoc("khoi-dong", "loi", cau);
        await quayVe(cau);
        return p;
      }
      this.datBuoc("khoi-dong", "xong", null);

      // 9. kiểm /props.
      this.datBuoc("kiem-props", "dang-chay", null);
      let pr: ThongTinProps;
      try {
        pr = await docProps(url, this.d.fetchFn, this.d.hetGio?.propsMs ?? 5000, env);
      } catch (e: any) {
        const cau = `không đọc được /props sau khởi động: ${String(e?.message ?? e).slice(0, 160)}`;
        this.datBuoc("kiem-props", "loi", cau);
        await quayVe(cau);
        return p;
      }
      p.props = pr;
      const lech = kiemProps(pr, { tenModel: p.modelMoi, ...mong });
      if (lech.length) {
        const cau = `/props không khớp: ${lech.join("; ")}`;
        this.datBuoc("kiem-props", "loi", cau);
        await quayVe(cau);
        return p;
      }
      this.datBuoc("kiem-props", "xong", `${pr.tenModel} · n_ctx ${pr.nCtx} · ${pr.tongSlot} slot`);

      // 10. sinh thử.
      this.datBuoc("sinh-thu", "dang-chay", null);
      const st = await sinhThuNgan(url, this.d.fetchFn, this.d.hetGio?.sinhThuMs ?? 60_000, env);
      if (!st.ok) {
        const cau = `lượt sinh thử hỏng: ${st.lyDo}`;
        this.datBuoc("sinh-thu", "loi", cau);
        await quayVe(cau);
        return p;
      }
      p.sinhThu = { chu: st.chu, ms: st.ms };
      this.datBuoc("sinh-thu", "xong", `"${st.chu}" sau ${st.ms} ms`);

      // 11. phủ env của tiến trình này.
      const ad = apDungLuaChonModel(env);
      if (ad.nguon !== "lua-chon" || tenModelGoc(ad.model) !== tenModelGoc(p.modelMoi)) {
        p.canhBao.push(`server đã chạy ${p.modelMoi} nhưng định tuyến của tiến trình chưa nhận lựa chọn: ${ad.lyDo ?? ad.nguon}`);
        this.datBuoc("ap-dung", "loi", ad.lyDo ?? ad.nguon);
      } else {
        this.datBuoc("ap-dung", "xong", `phủ ${ad.khoaDaPhu.join(", ")}`);
      }
      this.datBuoc("quay-ve", "bo-qua", null);
      p.ketQua = "thanh-cong";
      return p;
    } catch (e: any) {
      // Lỗi bất ngờ (đĩa, quyền…) giữa chừng: cố quay về nếu đã ghi lựa chọn.
      const cau = `lỗi bất ngờ: ${String(e?.message ?? e).slice(0, 200)}`;
      if (thoCu !== undefined) await quayVe(cau);
      else {
        p.loi = cau;
        p.ketQua = "huy-khong-doi";
      }
      return p;
    } finally {
      for (const b of p.buoc) if (b.trangThai === "cho") b.trangThai = "bo-qua";
      try {
        nhaCong?.();
      } catch {
        /* nhả cổng không bao giờ được chặn dọn dẹp */
      }
      if (hen) clearInterval(hen);
      if (daTaoTamDung) {
        try {
          fs.unlinkSync(this.d.duongTamDung);
        } catch {
          /* đã bị gỡ */
        }
      }
      nhaKhoa(this.d.duongKhoaDoi, tokenKhoa);
      p.ketThuc = new Date(this.d.bayGio()).toISOString();
      this.dangChay = false;
      try {
        await this.d.khiKetThuc?.(structuredClone(p));
      } catch {
        /* audit hỏng không đổi kết quả */
      }
    }
  }
}

// ─── Đơn thể của tiến trình ───────────────────────────────────────────────────────────────────

let macDinh: DieuPhoiDoiModel | null = null;

/** Chạy kịch bản qua `khoiDongTachRoi` — CÙNG hàm, CÙNG tệp kịch bản với bộ giám sát. */
function chayKichBanMacDinh(thamSo: readonly "-Force"[]): Promise<{ ma: number | null; loi?: string }> {
  const cfg = docCauHinhGiamSat(process.env);
  // kịch bản: ≤ 60 s nhả cổng + ≤ 300 s chờ /health ⇒ 7 phút là trần ngoài.
  const hetGioMs = 7 * 60_000;
  return new Promise((resolve) => {
    let xong = false;
    const t = setTimeout(() => {
      if (xong) return;
      xong = true;
      resolve({ ma: null, loi: `kịch bản chưa thoát sau ${hetGioMs / 60_000} phút` });
    }, hetGioMs);
    t.unref?.();
    try {
      khoiDongTachRoi(cfg.duongKichBan, {
        thamSoThem: thamSo,
        khiKetThuc: (code, loi) => {
          if (xong) return;
          xong = true;
          clearTimeout(t);
          resolve(loi ? { ma: null, loi: String(loi.message).slice(0, 200) } : { ma: code });
        },
      });
    } catch (e: any) {
      xong = true;
      clearTimeout(t);
      resolve({ ma: null, loi: String(e?.message ?? e).slice(0, 200) });
    }
  });
}

export function layDieuPhoiDoiModel(khiKetThuc?: (p: PhienDoiModel) => void | Promise<void>): DieuPhoiDoiModel {
  if (macDinh) return macDinh;
  const cfg = docCauHinhGiamSat(process.env);
  macDinh = new DieuPhoiDoiModel({
    env: process.env,
    fetchFn: (...a) => fetch(...a),
    chayKichBan: chayKichBanMacDinh,
    docVram: async () => {
      const { readDeviceVramUncached } = await import("../vram/vramProbe");
      return readDeviceVramUncached();
    },
    docMetaGguf: docMetaGgufMacDinh,
    giuCong: async (choToiDaMs) => {
      const { giuToanBoCongDeBaoTri } = await import("./hangDoiUuTienLlm");
      return (await giuToanBoCongDeBaoTri({ choToiDaMs })).nha;
    },
    bayGio: () => Date.now(),
    duongTamDung: cfg.duongTamDung,
    duongKhoaDoi: path.join(os.tmpdir(), "llama-doi-model.lock"),
    duongKhoaGiamSat: cfg.duongKhoa,
    khiKetThuc,
  });
  return macDinh;
}

/** Trạng thái để UI hiển thị: kho model + server đang chạy + lựa chọn bền. Không ném. */
export async function tongQuanDoiModel(): Promise<{
  bat: boolean;
  lyDoTat: string | null;
  khoModel: string;
  models: ModelTrongKho[];
  dangChay: ThongTinProps | null;
  loiDocProps: string | null;
  modelEnv: string;
  mongDoi: { nCtx: number; tongSlot: number };
}> {
  const env = process.env;
  const url = (env.LLAMA_SERVER_URL || "").trim().replace(/\/+$/, "");
  let lyDoTat: string | null = null;
  if (env.LLAMA_SERVER_ENABLED !== "true" || !url) lyDoTat = "llama-server không bật trong cấu hình.";
  else if (!laLoopback(url)) lyDoTat = "llama-server không ở máy này (URL không loopback).";
  else if (process.platform !== "win32") lyDoTat = "kịch bản khởi động là PowerShell/Windows.";
  const kho = (env.GGUF_MODELS_DIR || "").trim();
  let dangChay: ThongTinProps | null = null;
  let loiDocProps: string | null = null;
  if (url) {
    try {
      dangChay = await docProps(url, fetch, 3000, env);
    } catch (e: any) {
      loiDocProps = String(e?.message ?? e).slice(0, 160);
    }
  }
  const tong = soEnv(env, "LLAMA_SERVER_CTX_TOTAL", 65536);
  const slot = soEnv(env, "LLAMA_SERVER_SLOTS", 1);
  return {
    bat: lyDoTat === null,
    lyDoTat,
    khoModel: kho,
    models: lietKeModelTrongKho(kho),
    dangChay,
    loiDocProps,
    modelEnv: modelEnvGoc(env),
    mongDoi: { nCtx: Math.floor(tong / slot), tongSlot: slot },
  };
}
