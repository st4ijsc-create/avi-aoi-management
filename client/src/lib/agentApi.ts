/**
 * Đợt 1 · T5 — **LỚP MỎNG API AGENT** cho trình duyệt (spec `2026-10-14-ai-local-dot1-loi-agent-design.md` §4).
 *
 * Vì sao một lớp riêng: lúc T5 viết, phía server (T4) CHƯA có route `/api/ai/agent/*` lẫn thủ tục tRPC
 * `aiAgent.{danhSach, chiTiet, duyet, bac, hoanTac}`. Gọi `trpc.aiAgent.danhSach` ở thành phần sẽ đỏ kiểm kiểu tới khi
 * T4 xong — nên MỌI chỗ phụ thuộc hợp đồng server nằm ở ĐÂY; tích hợp sau chỉ sửa một tệp.
 *
 *   • SSE: `POST /api/ai/agent/runs` (tạo + phát) · `GET /api/ai/agent/runs/:id/events?tu=<n>` (nối lại) ·
 *     `POST /api/ai/agent/runs/:id/huy`. Khung `data: <json>` cách nhau dòng trống; json là `SuKienAgent` trần
 *     hoặc phong bì `{seq|n, suKien|e}` (bóc cả hai — hợp đồng chưa chốt).
 *   • tRPC: gọi HTTP thô tới `/api/trpc/<TIEN_TO_TRPC>.<thủ tục>` với superjson (đúng khuôn `trpcLinks.ts`,
 *     không batch). Khi T4 chốt router, có thể thay bằng client tRPC có kiểu ngay tại đây.
 *
 * Huỷ `signal` của một luồng SSE chỉ NGẮT ĐỌC — KHÔNG huỷ lượt chạy (server giữ, nối lại được). Huỷ thật = `huyLuotChay`.
 */
import superjson from "superjson";
import type { CheDoAgent, NgonNgu, SuKienAgent, TinNhan } from "@shared/agentCore/kieu";
import { thongDiepLoiRest } from "./restAuthError";

export const DUONG_API_AGENT = "/api/ai/agent/runs";
/** ⚠ Phụ thuộc T4: tên router tRPC chứa các thủ tục lượt chạy. */
export const TIEN_TO_TRPC = "aiAgent";

export interface ThanTaoLuotChay {
  cauHoi: string;
  projectId: string;
  cheDo: CheDoAgent;
  lichSu?: TinNhan[];
  sessionId?: string;
  ngonNgu?: NgonNgu;
}

// ─── SSE thuần ─────────────────────────────────────────────────────────────────────────────────

export interface KhungSse {
  data: string;
  id?: string;
}

/** Bộ tách khung SSE tăng dần: `nap(mảnh)` nhiều lần, `ket()` khi luồng đóng. */
export function taoBoTachSse(phat: (k: KhungSse) => void): { nap: (manh: string) => void; ket: () => void } {
  let dem = "";
  const xuLyKhoi = (khoi: string) => {
    const dataDong: string[] = [];
    let id: string | undefined;
    for (const dong of khoi.split("\n")) {
      if (dong.startsWith("data:")) dataDong.push(dong.slice(5).replace(/^ /, ""));
      else if (dong.startsWith("id:")) id = dong.slice(3).trim();
    }
    if (dataDong.length === 0) return;
    phat(id !== undefined ? { data: dataDong.join("\n"), id } : { data: dataDong.join("\n") });
  };
  return {
    nap(manh) {
      dem += manh.replace(/\r\n?/g, "\n");
      let i: number;
      while ((i = dem.indexOf("\n\n")) >= 0) {
        const khoi = dem.slice(0, i);
        dem = dem.slice(i + 2);
        xuLyKhoi(khoi);
      }
    },
    ket() {
      if (dem.trim()) xuLyKhoi(dem);
      dem = "";
    },
  };
}

/** Bóc một `data:` thành sự kiện agent (trần hoặc phong bì). Không phải sự kiện ⇒ null. */
export function bocSuKien(data: string): { suKien: SuKienAgent; seq?: number } | null {
  const s = data.trim();
  if (!s || s === "[DONE]") return null;
  let o: unknown;
  try {
    o = JSON.parse(s);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const trong = (r.suKien ?? r.e) as Record<string, unknown> | undefined;
  if (trong && typeof trong === "object" && typeof trong.loai === "string") {
    const seq = typeof r.seq === "number" ? r.seq : typeof r.n === "number" ? r.n : undefined;
    return seq !== undefined ? { seq, suKien: trong as unknown as SuKienAgent } : { suKien: trong as unknown as SuKienAgent };
  }
  if (typeof r.loai === "string") return { suKien: r as unknown as SuKienAgent };
  return null;
}

export interface TuyChonLuong {
  signal: AbortSignal;
  onSuKien: (e: SuKienAgent) => void;
}

async function docLuong(res: Response, opts: TuyChonLuong): Promise<void> {
  if (!res.ok || !res.body) {
    const than = await res.json().catch(() => ({}));
    throw new Error(thongDiepLoiRest(than as { error?: unknown; code?: unknown }, `Agent stream failed (${res.status})`));
  }
  const reader = res.body.getReader();
  const giaiMa = new TextDecoder();
  const tach = taoBoTachSse((k) => {
    const b = bocSuKien(k.data);
    if (b) opts.onSuKien(b.suKien);
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tach.nap(giaiMa.decode(value, { stream: true }));
  }
  tach.ket();
}

/** Tạo lượt chạy + đọc luồng sự kiện tới khi server đóng (hoặc `signal` ngắt đọc). */
export async function moLuotChay(than: ThanTaoLuotChay, opts: TuyChonLuong): Promise<void> {
  const res = await fetch(DUONG_API_AGENT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    credentials: "include",
    body: JSON.stringify(than),
    signal: opts.signal,
  });
  await docLuong(res, opts);
}

/** Nối lại luồng của một lượt chạy từ sự kiện thứ `tu` (0 = phát lại toàn bộ bộ đệm). */
export async function noiLaiLuotChay(runId: string, tu: number, opts: TuyChonLuong): Promise<void> {
  const res = await fetch(`${DUONG_API_AGENT}/${encodeURIComponent(runId)}/events?tu=${Math.max(0, Math.floor(tu))}`, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
    credentials: "include",
    signal: opts.signal,
  });
  await docLuong(res, opts);
}

/** Nút Dừng — huỷ THẬT lượt chạy phía server. */
export async function huyLuotChay(runId: string): Promise<void> {
  const res = await fetch(`${DUONG_API_AGENT}/${encodeURIComponent(runId)}/huy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: "{}",
  });
  if (!res.ok) {
    const than = await res.json().catch(() => ({}));
    throw new Error(thongDiepLoiRest(than as { error?: unknown; code?: unknown }, `Cancel failed (${res.status})`));
  }
}

// ─── tRPC thô (superjson, không batch) ─────────────────────────────────────────────────────────

/** Lỗi mang `.data` như TRPCClientError ⇒ `mapTrpcError` đọc được `code`/`appCode`. */
class LoiTrpcTho extends Error {
  data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "LoiTrpcTho";
    this.data = data;
  }
}

async function docTrpc<T>(res: Response): Promise<T> {
  const than = (await res.json().catch(() => null)) as
    | { result?: { data?: unknown }; error?: unknown }
    | null;
  if (than && than.error) {
    const loi = superjson.deserialize(than.error as Parameters<typeof superjson.deserialize>[0]) as {
      message?: string;
      data?: unknown;
    };
    throw new LoiTrpcTho(typeof loi?.message === "string" ? loi.message : `tRPC ${res.status}`, loi?.data);
  }
  if (!res.ok || !than?.result) throw new LoiTrpcTho(`tRPC ${res.status}`, { httpStatus: res.status });
  return superjson.deserialize(than.result.data as Parameters<typeof superjson.deserialize>[0]) as T;
}

async function truyVan<T>(thuTuc: string, input?: unknown): Promise<T> {
  const q = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`;
  const res = await fetch(`/api/trpc/${TIEN_TO_TRPC}.${thuTuc}${q}`, { method: "GET", credentials: "include" });
  return docTrpc<T>(res);
}

async function dotBien<T>(thuTuc: string, input: unknown): Promise<T> {
  const res = await fetch(`/api/trpc/${TIEN_TO_TRPC}.${thuTuc}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(superjson.serialize(input)),
  });
  return docTrpc<T>(res);
}

export type TrangThaiLuotChay = "dang-chay" | "cho-duyet" | "xong" | "huy" | "loi" | "gian-doan";

export interface TomTatLuotChay {
  id: string;
  trangThai: TrangThaiLuotChay | string;
  projectId?: string;
  cheDo?: CheDoAgent;
  cauHoi?: string;
}

export function chuanHoaDanhSach(o: unknown): TomTatLuotChay[] {
  const ds = Array.isArray(o)
    ? o
    : o && typeof o === "object"
      ? ((o as { runs?: unknown; items?: unknown }).runs ?? (o as { items?: unknown }).items)
      : null;
  if (!Array.isArray(ds)) return [];
  return ds.filter((r): r is TomTatLuotChay => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string");
}

export interface KetQuaHoanTac {
  khoiPhuc: string[];
  xungDot: Array<{ duong: string; lyDo?: string }>;
}

function duongCua(x: unknown): string | null {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const d = (x as { duong?: unknown; path?: unknown }).duong ?? (x as { path?: unknown }).path;
    return typeof d === "string" ? d : null;
  }
  return null;
}

export function chuanHoaHoanTac(o: unknown): KetQuaHoanTac {
  if (!o || typeof o !== "object") return { khoiPhuc: [], xungDot: [] };
  const r = o as Record<string, unknown>;
  const kp = r.khoiPhuc ?? r.daKhoiPhuc ?? r.restored;
  const xd = r.xungDot ?? r.conflicts;
  return {
    khoiPhuc: Array.isArray(kp) ? kp.map(duongCua).filter((x): x is string => !!x) : [],
    xungDot: Array.isArray(xd)
      ? xd
          .map((x) => {
            const duong = duongCua(x);
            if (!duong) return null;
            const lyDo = x && typeof x === "object" ? (x as { lyDo?: unknown }).lyDo : undefined;
            return typeof lyDo === "string" ? { duong, lyDo } : { duong };
          })
          .filter((x): x is { duong: string; lyDo?: string } => !!x)
      : [],
  };
}

/**
 * ⚠ Phụ thuộc T4 — tên + hình dạng input của thủ tục:
 *   danhSach()                         ⇒ mảng (hoặc {runs}/{items}) `{id, trangThai, projectId?}`
 *   duyet({actionId, chonKhoi?})       — `chonKhoi` = chỉ số khối (TheDuyetDiff), vắng ⇒ mọi khối
 *   bac({actionId, lyDo})              — lý do đưa cho model
 *   hoanTac({runId, checkpointId?})    ⇒ {khoiPhuc, xungDot}
 *   nhoDeXuat({runId, id})             ⇒ {ok, note, ketQua}  (Đợt 2 — ghi đề xuất nhớ thành bài học)
 *   boDeXuat({runId, id})              ⇒ {ok, note}          (Đợt 2 — bỏ qua, không ghi)
 */
export const agentTrpc = {
  async danhSach(): Promise<TomTatLuotChay[]> {
    return chuanHoaDanhSach(await truyVan<unknown>("danhSach"));
  },
  chiTiet(runId: string): Promise<unknown> {
    return truyVan<unknown>("chiTiet", { runId });
  },
  duyet(actionId: string, chonKhoi?: number[]): Promise<unknown> {
    return dotBien("duyet", chonKhoi ? { actionId, chonKhoi } : { actionId });
  },
  bac(actionId: string, lyDo: string): Promise<unknown> {
    return dotBien("bac", { actionId, lyDo });
  },
  async hoanTac(runId: string, checkpointId?: string): Promise<KetQuaHoanTac> {
    return chuanHoaHoanTac(await dotBien<unknown>("hoanTac", checkpointId ? { runId, checkpointId } : { runId }));
  },
  async nhoDeXuat(runId: string, id: string): Promise<KetQuaDeXuatNho> {
    return chuanHoaKetQuaDeXuat(await dotBien<unknown>("nhoDeXuat", { runId, id }));
  },
  async boDeXuat(runId: string, id: string): Promise<KetQuaDeXuatNho> {
    return chuanHoaKetQuaDeXuat(await dotBien<unknown>("boDeXuat", { runId, id }));
  },
  /** (Đợt 5.1) bỏ / sửa / gỡ phiếu 👍/👎 — chỉ định danh + phiếu + lý do; máy chủ tự lấy văn bản từ sổ của nó. */
  async phanHoi(vao: DauVaoPhanHoi): Promise<KetQuaPhanHoi> {
    return chuanHoaKetQuaPhanHoi(await dotBien<unknown>("phanHoi", vao));
  },
};

/** (Đợt 5.1) đầu vào `aiAgent.phanHoi`. `danhGia: null` = gỡ phiếu. */
export type DauVaoPhanHoi =
  | { loai: "tra-loi"; runId: string; chiSoTin: number; danhGia: 1 | -1 | null; lyDo?: string }
  | { loai: "diff"; actionId: string; danhGia: 1 | -1 | null; lyDo?: string };

/** (Đợt 5.1) kết quả THẬT: `danhGia` là phiếu máy chủ đang giữ sau lượt ghi (null = không có phiếu). */
export interface KetQuaPhanHoi {
  ok: boolean;
  ma: string | null;
  danhGia: 1 | -1 | null;
}

export function chuanHoaKetQuaPhanHoi(o: unknown): KetQuaPhanHoi {
  if (!o || typeof o !== "object") return { ok: false, ma: "LOI", danhGia: null };
  const r = o as { ok?: unknown; note?: unknown; phieu?: { danhGia?: unknown } | null };
  const dg = r.phieu && typeof r.phieu === "object" ? r.phieu.danhGia : null;
  return {
    ok: r.ok === true,
    ma: typeof r.note === "string" ? r.note : r.ok === true ? null : "LOI",
    danhGia: r.ok === true && (dg === 1 || dg === -1) ? dg : null,
  };
}

/** (Đợt 2) kết quả Nhớ / Bỏ qua: `ok` THẬT của máy chủ + mã từ chối (`NOT_FOUND`, `DA_XU_LY`, `PERMISSION_DENIED`, …). */
export interface KetQuaDeXuatNho {
  ok: boolean;
  ma: string | null;
}

export function chuanHoaKetQuaDeXuat(o: unknown): KetQuaDeXuatNho {
  if (!o || typeof o !== "object") return { ok: false, ma: "LOI" };
  const r = o as { ok?: unknown; note?: unknown };
  return { ok: r.ok === true, ma: typeof r.note === "string" ? r.note : r.ok === true ? null : "LOI" };
}
