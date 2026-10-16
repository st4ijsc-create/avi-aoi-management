/**
 * Đợt 1 · T5 — **BỘ GIẢM SỰ KIỆN AGENT** (thuần): chuỗi `SuKienAgent` (spec §3) ⇒ trạng thái dòng thời gian
 * của chế độ Agent trên `/ai-coding-workspace`.
 *
 * THUẦN: không React, không i18n, không mạng — để lưới đo một mình (`trangThaiAgent.unit.test.ts`).
 * Cùng một hàm dựng lại dòng thời gian khi NỐI LẠI sau tải trang (`/events?tu=0` phát lại bộ đệm), nên
 * phát lại cùng chuỗi ⇒ cùng trạng thái (lưới canh).
 *
 * Quy ước:
 *   • `soSuKien` đếm MỌI sự kiện đã nhận (kể cả loại lạ) — đó là `n` cho `?tu=n` khi nối lại.
 *   • `chu`/`nghi` liên tiếp gộp vào một khối; bất kỳ mục nào chen giữa ⇒ khối mới.
 *   • `tepDaDoi` = tool GHI có kết quả `ok` (đường lấy từ tham số lời gọi) ∪ `hienThi.thayDoi[].duong`.
 *     Checkpoint chụp TRƯỚC lượt ghi (có thể bị bác) nên KHÔNG tự tính là đã đổi — chỉ giữ cho hoàn tác.
 */
import type {
  CheDoAgent,
  DeXuatDuyet,
  LyDoDung,
  SuKienAgent,
  ViecKeHoach,
} from "@shared/agentCore/kieu";

export type TrangThaiTheDuyet = "cho" | "da-duyet" | "bi-bac" | "het-hieu-luc";

export interface KetQuaDongTool {
  ok: boolean;
  tomTat: string;
  ma?: string;
  hienThi?: unknown;
}

export type MucDongThoiGian =
  | { kieu: "cau-hoi"; noiDung: string }
  | { kieu: "chu"; noiDung: string }
  | { kieu: "nghi"; noiDung: string }
  | { kieu: "tool"; id: string; ten: string; thamSo: Record<string, unknown>; luot: number; ketQua?: KetQuaDongTool }
  | { kieu: "duyet"; id: string; deXuat: DeXuatDuyet; trangThai: TrangThaiTheDuyet; lyDo?: string }
  | { kieu: "loi"; ma: string; thongDiep: string };

export interface UsageGop {
  vao: number;
  ra: number;
  nghi?: number;
  ctxPhanTram?: number;
}

export interface TrangThaiAgent {
  runId: string | null;
  cheDo: CheDoAgent | null;
  dangChay: boolean;
  choDuyet: boolean;
  /** Số sự kiện đã nhận — `n` của `?tu=n`. */
  soSuKien: number;
  dongThoiGian: MucDongThoiGian[];
  keHoach: ViecKeHoach[];
  /** `dang-cho-model` — số lượt đứng trước; null khi model đã chạy. */
  phiaTruoc: number | null;
  usage: UsageGop | null;
  checkpoints: Array<{ checkpointId: string; tep: string[] }>;
  tepDaDoi: string[];
  ketThuc: { lyDo: LyDoDung; tomTat?: string } | null;
}

export const TRANG_THAI_RONG: TrangThaiAgent = {
  runId: null,
  cheDo: null,
  dangChay: false,
  choDuyet: false,
  soSuKien: 0,
  dongThoiGian: [],
  keHoach: [],
  phiaTruoc: null,
  usage: null,
  checkpoints: [],
  tepDaDoi: [],
  ketThuc: null,
};

/** Trạng thái lúc người dùng vừa gửi câu hỏi (chưa có `bat-dau`). */
export function batDauGui(cauHoi: string, cheDo: CheDoAgent): TrangThaiAgent {
  return { ...TRANG_THAI_RONG, cheDo, dangChay: true, dongThoiGian: [{ kieu: "cau-hoi", noiDung: cauHoi }] };
}

/** Tool có tác dụng ghi đĩa (theo bộ tool v1, spec §3). */
export const TOOL_GHI = new Set(["edit_file", "write_file", "delete_file", "rename_file"]);

function chuoi(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Đối số CHÍNH hiển thị trên dòng tool thu gọn (đường tệp / lệnh / mẫu). */
export function thamSoChinh(ten: string, thamSo: Record<string, unknown>): string {
  const ts = thamSo ?? {};
  if (ten === "rename_file") {
    const tu = chuoi(ts.from);
    const den = chuoi(ts.to);
    return tu && den ? `${tu} → ${den}` : tu ?? den ?? "";
  }
  if (ten === "run_command") return chuoi(ts.command) ?? "";
  if (ten === "grep") {
    const p = chuoi(ts.pattern);
    const d = chuoi(ts.path);
    return [p, d].filter(Boolean).join(" · ");
  }
  if (ten === "find_files") return chuoi(ts.pattern) ?? "";
  if (ten === "todo_write") return Array.isArray(ts.todos) ? String(ts.todos.length) : "";
  return chuoi(ts.path) ?? "";
}

/** Đường tệp mà một lời gọi tool GHI chạm tới (sau khi chạy). */
function duongCuaToolGhi(ten: string, thamSo: Record<string, unknown>): string[] {
  if (ten === "rename_file") return [chuoi(thamSo.to)].filter((x): x is string => !!x);
  const p = chuoi(thamSo.path);
  return p ? [p] : [];
}

function duongTuHienThi(hienThi: unknown): string[] {
  if (!hienThi || typeof hienThi !== "object") return [];
  const td = (hienThi as { thayDoi?: unknown }).thayDoi;
  if (!Array.isArray(td)) return [];
  return td.map((x) => (x && typeof x === "object" ? chuoi((x as { duong?: unknown }).duong) : null)).filter((x): x is string => !!x);
}

function themDuyNhat(ds: string[], moi: string[]): string[] {
  const kq = [...ds];
  for (const d of moi) if (!kq.includes(d)) kq.push(d);
  return kq;
}

function noiChu(ds: MucDongThoiGian[], kieu: "chu" | "nghi", noiDung: string): MucDongThoiGian[] {
  const cuoi = ds[ds.length - 1];
  if (cuoi && cuoi.kieu === kieu) return [...ds.slice(0, -1), { kieu, noiDung: cuoi.noiDung + noiDung }];
  return [...ds, { kieu, noiDung }];
}

export function giamSuKien(s: TrangThaiAgent, e: SuKienAgent): TrangThaiAgent {
  const n: TrangThaiAgent = { ...s, soSuKien: s.soSuKien + 1 };
  switch (e?.loai) {
    case "bat-dau":
      return { ...n, runId: e.runId, cheDo: e.cheDo, dangChay: true, ketThuc: null };
    case "chu":
    case "nghi":
      return { ...n, phiaTruoc: null, dongThoiGian: noiChu(n.dongThoiGian, e.loai, e.noiDung ?? "") };
    case "goi-tool":
      return {
        ...n,
        phiaTruoc: null,
        dongThoiGian: [...n.dongThoiGian, { kieu: "tool", id: e.goi.id, ten: e.goi.ten, thamSo: e.goi.thamSo ?? {}, luot: e.luot }],
      };
    case "ket-qua-tool": {
      let tepMoi: string[] = duongTuHienThi(e.hienThi);
      const dt = n.dongThoiGian.map((m) => {
        if (m.kieu !== "tool" || m.id !== e.id) return m;
        if (e.ok && TOOL_GHI.has(m.ten)) tepMoi = [...duongCuaToolGhi(m.ten, m.thamSo), ...tepMoi];
        return { ...m, ketQua: { ok: e.ok, tomTat: e.tomTat, ma: e.ma, hienThi: e.hienThi } };
      });
      return { ...n, dongThoiGian: dt, tepDaDoi: themDuyNhat(n.tepDaDoi, tepMoi) };
    }
    case "can-duyet":
      return {
        ...n,
        choDuyet: true,
        dongThoiGian: [...n.dongThoiGian, { kieu: "duyet", id: e.id, deXuat: e.deXuat, trangThai: "cho" }],
      };
    case "da-duyet":
    case "bi-bac": {
      const dt = n.dongThoiGian.map((m) =>
        m.kieu === "duyet" && m.id === e.id
          ? { ...m, trangThai: (e.loai === "da-duyet" ? "da-duyet" : "bi-bac") as TrangThaiTheDuyet, lyDo: e.lyDo ?? m.lyDo }
          : m,
      );
      const conCho = dt.some((m) => m.kieu === "duyet" && m.trangThai === "cho");
      return { ...n, dongThoiGian: dt, choDuyet: conCho };
    }
    case "ke-hoach":
      return { ...n, keHoach: Array.isArray(e.viec) ? e.viec : [] };
    case "checkpoint":
      return { ...n, checkpoints: [...n.checkpoints, { checkpointId: e.checkpointId, tep: Array.isArray(e.tep) ? e.tep : [] }] };
    case "usage": {
      const cu = n.usage;
      const nghi = (cu?.nghi ?? 0) + (e.nghi ?? 0);
      return {
        ...n,
        usage: {
          vao: (cu?.vao ?? 0) + (e.vao ?? 0),
          ra: (cu?.ra ?? 0) + (e.ra ?? 0),
          ...(cu?.nghi !== undefined || e.nghi !== undefined ? { nghi } : {}),
          ...(e.ctxPhanTram !== undefined ? { ctxPhanTram: e.ctxPhanTram } : cu?.ctxPhanTram !== undefined ? { ctxPhanTram: cu.ctxPhanTram } : {}),
        },
      };
    }
    case "dang-cho-model":
      return { ...n, phiaTruoc: e.phiaTruoc };
    case "loi":
      return { ...n, dongThoiGian: [...n.dongThoiGian, { kieu: "loi", ma: e.ma, thongDiep: e.thongDiep }] };
    case "xong":
      return {
        ...n,
        dangChay: false,
        choDuyet: false,
        phiaTruoc: null,
        ketThuc: { lyDo: e.lyDo, ...(e.tomTat ? { tomTat: e.tomTat } : {}) },
        dongThoiGian: n.dongThoiGian.map((m) => (m.kieu === "duyet" && m.trangThai === "cho" ? { ...m, trangThai: "het-hieu-luc" } : m)),
      };
    default:
      return n;
  }
}

export function giamNhieu(s: TrangThaiAgent, es: SuKienAgent[]): TrangThaiAgent {
  return es.reduce(giamSuKien, s);
}

/** Văn bản trả lời CUỐI (khối `chu` cuối cùng) — đưa vào lịch sử cho lượt sau. */
export function vanBanTraLoiCuoi(s: TrangThaiAgent): string {
  for (let i = s.dongThoiGian.length - 1; i >= 0; i--) {
    const m = s.dongThoiGian[i]!;
    if (m.kieu === "chu") return m.noiDung;
  }
  return "";
}

// ─── Đề xuất ghi ⇒ args cho `TheDuyetDiff` ─────────────────────────────────────────────────────

export interface DiffTuDeXuat {
  args: { path: string; original: string; modified: string };
  expiresAt: string;
  warnings: string[];
}

function laDiff(o: unknown): o is { path: string; original: string; modified: string } {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return typeof x.path === "string" && typeof x.original === "string" && typeof x.modified === "string";
}

/** TTL thẻ duyệt phía server (spec §4: 5 phút) — chỉ dùng khi server không gửi `expiresAt`. */
const TTL_MAC_DINH_MS = 5 * 60 * 1000;

/**
 * ⚠ HỢP ĐỒNG T4 CHƯA CHỐT: `xemTruoc` có thể là `{pendingAction: PendingActionDTO}`, chính `PendingActionDTO`
 * (`{tool, args, expiresAt, preview}`), hoặc phẳng `{path, original, modified}`. Hàm nhận cả ba; không có diff ⇒ null
 * (thẻ gọn: xoá / đổi tên / chạy lệnh).
 */
export function layDiffTuDeXuat(deXuat: DeXuatDuyet, bayGio: () => number = Date.now): DiffTuDeXuat | null {
  const xt = deXuat?.xemTruoc as Record<string, unknown> | undefined;
  if (!xt || typeof xt !== "object") return null;
  const ung: Array<Record<string, unknown>> = [];
  if (xt.pendingAction && typeof xt.pendingAction === "object") ung.push(xt.pendingAction as Record<string, unknown>);
  ung.push(xt);
  for (const u of ung) {
    const args = laDiff(u.args) ? u.args : laDiff(u) ? u : null;
    if (!args) continue;
    const preview = u.preview as { warnings?: unknown } | undefined;
    const warnings = Array.isArray(preview?.warnings)
      ? (preview!.warnings as unknown[]).filter((w): w is string => typeof w === "string")
      : Array.isArray(u.warnings)
        ? (u.warnings as unknown[]).filter((w): w is string => typeof w === "string")
        : [];
    const expiresAt = typeof u.expiresAt === "string" ? u.expiresAt : new Date(bayGio() + TTL_MAC_DINH_MS).toISOString();
    return { args: { path: args.path, original: args.original, modified: args.modified }, expiresAt, warnings };
  }
  return null;
}

/** id gửi cho `aiAgent.duyet/bac`: id hàng `ai_pending_actions` nếu server gửi, không thì id sự kiện. */
export function idHanhDong(m: { id: string; deXuat: DeXuatDuyet }): string {
  const p = m.deXuat?.pendingActionId;
  return p !== undefined && p !== null && String(p).length > 0 ? String(p) : m.id;
}
