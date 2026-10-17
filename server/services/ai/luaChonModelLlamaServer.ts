/**
 * ★★ Đợt 6 — LỰA CHỌN MODEL BỀN cho `llama-server` (nguồn sự thật của "đổi model qua API").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MỘT TỆP RIÊNG, KHÔNG GHI `.env`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • `.env` là tệp CHUNG do người vận hành sửa tay (1.000+ dòng, có bí mật). Máy chủ ghi đè nó là
 *     mở cửa cho một lượt ghi hỏng giết cả hệ ở lần boot sau — và trộn ý định người với ý định máy.
 *   • `:8091` dùng chung cho NHIỀU worktree (`:3000`, `:3010`): `.env` của worktree A không phải của
 *     B. Tệp lựa chọn vì thế nằm NGOÀI repo — `%LOCALAPPDATA%\avi-aoi-ai\llama-server-lua-chon.json`
 *     (ghi đè bằng `LLAMA_SERVER_SELECTION_FILE`, phải đặt GIỐNG NHAU ở mọi `.env` cùng máy) — cùng lý
 *     do tệp tạm dừng/khoá của bộ giám sát nằm ở `os.tmpdir()`. Khác chúng: đây là trạng thái BỀN
 *     (qua khởi động lại máy), nên không ở thư mục tạm.
 *
 * HAI người đọc, cùng một quy tắc:
 *   1. `scripts/ai/start-llama-server.ps1` — đường khởi động DUY NHẤT (Task Scheduler lúc đăng nhập,
 *      bộ giám sát khi server chết, và API đổi model). Đọc tệp này để chọn `-m`.
 *   2. Tiến trình app — `apDungLuaChonModel()` PHỦ lên `process.env` "BA khoá" (bài học 2026-09-22:
 *      `LLAMA_SERVER_MODEL` · `GGUF_DEFAULT_MODEL` · `GGUF_CODE_MODEL`). Không phủ thì
 *      `laModelServerDangGiu()` so tên model mới với khoá cũ ⇒ `false` ⇒ lùi in-process ⇒ nạp BẢN
 *      THỨ HAI ~21 GB vào node ⇒ OOM. Chỉ khoá nào ĐANG trỏ cùng model với server mới bị phủ.
 *
 * QUY TẮC "Ý ĐỊNH MỚI HƠN THẮNG": tệp ghi lại `envModel` = model `.env` khai LÚC chọn. `.env` bị sửa
 * SAU đó (người vận hành đổi tay) ⇒ hai bên khác nhau ⇒ `.env` thắng, lựa chọn bị bỏ qua có lý do.
 * Không có quy tắc này thì một lựa chọn cũ sẽ lặng lẽ đè mọi lần sửa `.env` về sau — đúng lớp lỗi
 * "chỗ khai KHÁC thứ đang chạy" (`hoSoModelStudio.ts` › `lech`).
 *
 * Module LÁ: chỉ `fs`/`os`/`path` — được import TĨNH ở thân `_core/index.ts` và `worker.ts`.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Ba khoá `.env` cùng nói "model chữ chính là gì" (bài học 2026-09-22). */
export const KHOA_MODEL_SERVER = ["LLAMA_SERVER_MODEL", "GGUF_DEFAULT_MODEL", "GGUF_CODE_MODEL"] as const;
type KhoaModel = (typeof KHOA_MODEL_SERVER)[number];

/**
 * DANH SÁCH TRẮNG DẠNG TÊN: một basename `.gguf`, không dấu phân cách đường dẫn, không bắt đầu bằng
 * dấu chấm (chặn `..gguf`, tệp ẩn). Kịch bản PowerShell dùng ĐÚNG mẫu này.
 */
const MAU_TEN_MODEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,200}\.gguf$/i;
export function laTenModelHopLe(ten: unknown): ten is string {
  return typeof ten === "string" && MAU_TEN_MODEL.test(ten) && !ten.includes("..");
}

/** `D:/m/A.gguf` → `A`. Cùng phép với `aiLlamaServerClient.basename` (phân biệt hoa thường ở THÂN tên). */
export function tenModelGoc(v: string | undefined | null): string {
  return String(v ?? "")
    .trim()
    .replace(/\.gguf$/i, "")
    .replace(/^.*[\\/]/, "")
    .trim();
}

export interface LuaChonModel {
  v: 1;
  /** Basename `.gguf` trong `GGUF_MODELS_DIR`. */
  model: string;
  /** Model mà `.env` khai cho server LÚC chọn (quy tắc "ý định mới hơn thắng"). */
  envModel: string;
  luc: string;
  nguoi: string | null;
}

export function duongLuaChon(env: NodeJS.ProcessEnv = process.env): string {
  const ghiDe = (env.LLAMA_SERVER_SELECTION_FILE || "").trim();
  if (ghiDe) return ghiDe;
  const goc = (env.LOCALAPPDATA || "").trim() || os.homedir();
  return path.join(goc, "avi-aoi-ai", "llama-server-lua-chon.json");
}

/** Không bao giờ ném. Nội dung hỏng / phiên bản lạ / tên có đường dẫn ⇒ `null` (coi như KHÔNG có). */
export function docLuaChon(duong: string): LuaChonModel | null {
  try {
    const j = JSON.parse(fs.readFileSync(duong, "utf8"));
    if (j?.v !== 1 || !laTenModelHopLe(j?.model) || typeof j?.envModel !== "string") return null;
    return {
      v: 1,
      model: j.model,
      envModel: j.envModel,
      luc: typeof j.luc === "string" ? j.luc : "",
      nguoi: typeof j.nguoi === "string" ? j.nguoi : null,
    };
  } catch {
    return null;
  }
}

/** Ghi NGUYÊN TỬ (tệp tạm cùng thư mục rồi `rename`) — kịch bản đọc giữa chừng không thấy nửa tệp. */
export function ghiLuaChon(duong: string, lc: LuaChonModel): void {
  if (!laTenModelHopLe(lc.model)) throw new Error(`tên model không hợp lệ: ${String(lc.model).slice(0, 80)}`);
  fs.mkdirSync(path.dirname(duong), { recursive: true });
  const tam = `${duong}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tam, JSON.stringify(lc, null, 2), "utf8");
  fs.renameSync(tam, duong);
}

/** Nội dung thô hiện tại (để quay về y nguyên); `null` = không có tệp. */
export function docNoiDungTho(duong: string): string | null {
  try {
    return fs.readFileSync(duong, "utf8");
  } catch {
    return null;
  }
}

/** Trả tệp về đúng trạng thái đã chụp: `null` ⇒ gỡ tệp (trạng thái "chưa từng chọn"). */
export function khoiPhucNoiDungTho(duong: string, tho: string | null): void {
  if (tho === null) {
    try {
      fs.unlinkSync(duong);
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
    return;
  }
  fs.mkdirSync(path.dirname(duong), { recursive: true });
  const tam = `${duong}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tam, tho, "utf8");
  fs.renameSync(tam, duong);
}

// ─── Phủ env ───────────────────────────────────────────────────────────────────────────────────

export interface KetQuaApDung {
  /** env = không có lựa chọn · lua-chon = đang phủ · lua-chon-bo-qua = có tệp nhưng không hiệu lực. */
  nguon: "env" | "lua-chon" | "lua-chon-bo-qua";
  /** Model server hiệu lực (basename `.gguf`, rỗng nếu `.env` không khai). */
  model: string;
  /** Model `.env` khai cho server (giá trị GỐC, trước khi phủ). */
  envModel: string;
  lyDo: string | null;
  duong: string;
  khoaDaPhu: KhoaModel[];
}

/** Giá trị GỐC của ba khoá (chụp lần đầu cho mỗi đối tượng env) — để áp lại / trả về được. */
const gocTheoEnv = new WeakMap<NodeJS.ProcessEnv, Record<KhoaModel, string | undefined>>();
let ketQuaCuoi: KetQuaApDung | null = null;

function layGoc(env: NodeJS.ProcessEnv): Record<KhoaModel, string | undefined> {
  let g = gocTheoEnv.get(env);
  if (!g) {
    g = { LLAMA_SERVER_MODEL: env.LLAMA_SERVER_MODEL, GGUF_DEFAULT_MODEL: env.GGUF_DEFAULT_MODEL, GGUF_CODE_MODEL: env.GGUF_CODE_MODEL };
    gocTheoEnv.set(env, g);
  }
  return g;
}

/** Model `.env` khai cho server — cùng thứ tự với kịch bản khởi động: LLAMA_SERVER_MODEL → GGUF_DEFAULT_MODEL. */
export function modelEnvGoc(env: NodeJS.ProcessEnv = process.env): string {
  const g = layGoc(env);
  return ((g.LLAMA_SERVER_MODEL || "").trim() || (g.GGUF_DEFAULT_MODEL || "").trim());
}

/**
 * Đọc tệp lựa chọn và PHỦ (hoặc gỡ phủ) ba khoá trên `env`. Idempotent; không bao giờ ném.
 * Khoá được phủ ⇔ giá trị GỐC của nó cùng tên model với model server của `.env`.
 */
export function apDungLuaChonModel(env: NodeJS.ProcessEnv = process.env): KetQuaApDung {
  const goc = layGoc(env);
  const envModelTho = modelEnvGoc(env);
  const tenEnv = tenModelGoc(envModelTho);
  const duong = duongLuaChon(env);
  const lc = docLuaChon(duong);

  let dich: string | null = null;
  let nguon: KetQuaApDung["nguon"] = "env";
  let lyDo: string | null = null;
  if (lc) {
    const thuMuc = (env.GGUF_MODELS_DIR || "").trim();
    if (!tenEnv) {
      nguon = "lua-chon-bo-qua";
      lyDo = "`.env` không khai model cho llama-server — không biết khoá nào để phủ.";
    } else if (tenModelGoc(lc.envModel) !== tenEnv) {
      nguon = "lua-chon-bo-qua";
      lyDo = `.env đã đổi model server (${tenEnv}) SAU lựa chọn (lúc chọn: ${tenModelGoc(lc.envModel)}) — .env thắng.`;
    } else if (!thuMuc || !fs.existsSync(path.join(thuMuc, lc.model))) {
      nguon = "lua-chon-bo-qua";
      lyDo = `tệp model đã chọn (${lc.model}) không còn trong kho model.`;
    } else {
      nguon = "lua-chon";
      dich = lc.model;
    }
  }

  const khoaDaPhu: KhoaModel[] = [];
  for (const k of KHOA_MODEL_SERVER) {
    const g = goc[k];
    const thuocServer = !!tenEnv && tenModelGoc(g) === tenEnv;
    if (dich && thuocServer) {
      env[k] = dich;
      khoaDaPhu.push(k);
    } else if (g === undefined) {
      delete env[k];
    } else {
      env[k] = g;
    }
  }

  const kq: KetQuaApDung = {
    nguon,
    model: dich ?? (tenEnv ? `${tenEnv}.gguf` : ""),
    envModel: tenEnv ? `${tenEnv}.gguf` : "",
    lyDo,
    duong,
    khoaDaPhu,
  };
  if (env === process.env) {
    const doi = !ketQuaCuoi || ketQuaCuoi.model !== kq.model || ketQuaCuoi.nguon !== kq.nguon;
    if (doi && kq.nguon !== "env") {
      const cau = kq.nguon === "lua-chon"
        ? `model llama-server lấy từ LỰA CHỌN QUẢN TRỊ (${kq.model}, tệp ${duong}) — phủ ${khoaDaPhu.join(", ")}; .env khai ${kq.envModel}.`
        : `bỏ qua lựa chọn model ở ${duong}: ${lyDo}`;
      console.log(`[llama-model] ${cau}`);
    }
    ketQuaCuoi = kq;
  }
  return kq;
}

/** Kết quả lần áp gần nhất trên `process.env` (cho UI/health); `null` = chưa áp lần nào. */
export function trangThaiLuaChonModel(): KetQuaApDung | null {
  return ketQuaCuoi;
}

let henDongBo: NodeJS.Timeout | null = null;

/**
 * Áp NGAY rồi áp lại mỗi `nhipMs` (mặc định 15 s): một tiến trình anh em (worktree khác, vai worker)
 * đổi model qua API ⇒ tiến trình này theo kịp trong ≤ 1 nhịp mà không cần khởi động lại. Trong cửa
 * sổ đó lượt của nó vẫn đi server (tên cũ == khoá cũ) — chỉ nhãn model có thể lệch, không nạp gì.
 */
export function khoiChayDongBoLuaChonModel(nhipMs = 15_000): KetQuaApDung {
  const kq = apDungLuaChonModel(process.env);
  if (!henDongBo) {
    henDongBo = setInterval(() => {
      try {
        apDungLuaChonModel(process.env);
      } catch {
        /* không bao giờ ném — phòng xa */
      }
    }, nhipMs);
    henDongBo.unref?.();
  }
  return kq;
}
