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
 *   • (Đợt 2) `de-xuat-nho` ⇒ thẻ `nho` (trạng thái `cho`). Trạng thái sau khi bấm (Nhớ / Bỏ qua) là của CLIENT
 *     (`capNhatDeXuatNho` theo kết quả THẬT của tRPC) — máy chủ không phát sự kiện cho lượt bấm, nên `xong` KHÔNG làm
 *     thẻ hết hiệu lực: đề xuất còn duyệt được sau khi lượt chạy kết thúc (máy chủ giữ 30 phút).
 *   • (2026-10-17) `canh-bao-du-lieu` / `ha-tu-tri` ⇒ mục `canh-bao` (lượt KHÔNG dừng); `ha-tu-tri` bật `daHaTuTri`.
 *   • (Đợt 11.8) `ngu-canh-day` ⇒ `nguCanhDay` (% ngữ cảnh; phát ĐÚNG MỘT lần mỗi lượt chạy ⇒ banner).
 *   • (Đợt 11.8) AGENT CON: `con-bat-dau` ⇒ mục `con` mới; `su-kien-con` ⇒ áp CHÍNH bộ giảm này lên TRẠNG THÁI RIÊNG của con
 *     (`con.tt`) — sự kiện của con KHÔNG BAO GIỜ chạm `dangChay`/`ketThuc`/`keHoach`/`usage`/`runId` của cha (con không giả được `xong`/
 *     `da-duyet`/`ke-hoach` của cha); `con-xong` đóng mục con. `choDuyet` của cha = cha còn thẻ chờ HOẶC có con còn thẻ chờ.
 *     `nhiemVu`/`tomTat` là chuỗi do MODEL viết ⇒ lưu nguyên, UI vẽ CHỮ THUẦN.
 */
import type {
  CheDoAgent,
  DeXuatDuyet,
  LyDoDung,
  PhamViNho,
  SuKienAgent,
  ThongTinModelBatDau,
  ViecKeHoach,
} from "@shared/agentCore/kieu";

export type TrangThaiTheDuyet = "cho" | "da-duyet" | "bi-bac" | "het-hieu-luc";

/** (Đợt 2) trạng thái thẻ đề xuất nhớ phía client. `loi` mang mã máy chủ (`NOT_FOUND`, `DA_XU_LY`, …). */
export type TrangThaiTheNho = "cho" | "dang-gui" | "da-nho" | "da-bo" | "loi";

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
  | { kieu: "nho"; id: string; note: string; scope: PhamViNho; trangThai: TrangThaiTheNho; maLoi?: string }
  /** (2026-10-17) nội dung đáng ngờ: `du-lieu` = cảnh báo (lượt KHÔNG dừng) · `ha-tu-tri` = tu-dong bị hạ (ghi/lệnh cần duyệt). */
  | { kieu: "canh-bao"; loaiCanhBao: "du-lieu" | "ha-tu-tri"; nguon: string; mau: string[] }
  | { kieu: "loi"; ma: string; thongDiep: string }
  /** (Đợt 11.3-C, UX-D02) thẻ "Kế hoạch chờ duyệt": kế hoạch `bam` của lượt chờ người quyết trước tool ghi/lệnh kế tiếp. */
  | MucKeHoachDuyet
  /** (Đợt 11.8) một agent con: tiêu đề + trạng thái riêng của nó (dòng thời gian lồng). */
  | MucAgentCon;

/**
 * Trạng thái thẻ kế hoạch. `cho` = chờ người; `dang-gui` = đã bấm, chờ máy chủ trả lời (không lạc quan: thẻ chỉ đổi khi máy chủ nói);
 * `da-doi` = máy chủ báo băm lệch (CONFLICT) — kế hoạch đã đổi, thẻ không còn đúng nữa; `het-hieu-luc` = lượt đã kết thúc khi thẻ còn chờ.
 */
export type TrangThaiKeHoachDuyet = "cho" | "dang-gui" | "da-duyet" | "bac" | "het-gio" | "da-doi" | "het-hieu-luc";

export interface MucKeHoachDuyet {
  kieu: "ke-hoach-duyet";
  /** Băm máy chủ của kế hoạch ĐANG HIỂN THỊ — nút gửi đúng băm này. */
  bam: string;
  /** Chữ do MODEL viết ⇒ UI vẽ CHỮ THUẦN. */
  viec: ViecKeHoach[];
  trangThai: TrangThaiKeHoachDuyet;
  luc?: string;
  /** Mã lỗi máy chủ khi quyết định thất bại (`NOT_FOUND`, `DA_QUYET`, `LOI_CSDL`, `PERMISSION_DENIED`, hoặc mã mạng). */
  maLoi?: string;
}

/** (Đợt 11.8) trần số agent con giữ trong trạng thái (chống phình khi máy chủ/dữ liệu bất thường). */
export const TRAN_AGENT_CON = 32;
/** (Đợt 11.8) trần độ sâu lồng `su-kien-con` (con của con…): quá sâu ⇒ bỏ sự kiện, không đệ quy vô hạn. */
const TRAN_DO_SAU_CON = 3;

export interface MucAgentCon {
  kieu: "con";
  runIdCon: string;
  agent: string;
  nguon: "dungSan" | "tuRepo";
  sau: number;
  cheDo: CheDoAgent;
  /** Chuỗi do MODEL viết — vẽ CHỮ THUẦN. */
  nhiemVu: string;
  trangThai: "chay" | "xong";
  lyDo?: LyDoDung;
  /** Chuỗi do MODEL viết — vẽ CHỮ THUẦN. */
  tomTat?: string;
  /** Trạng thái RIÊNG của con (cùng bộ giảm). */
  tt: TrangThaiAgent;
}

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
  /** (2026-10-17) tu-dong đã bị hạ tự trị trong lượt này (`ha-tu-tri`) — một chiều. */
  daHaTuTri: boolean;
  /** ★ Đợt 9 — model + vai trò THỰC của lượt (sự kiện `bat-dau.model`; CHỈ có khi server bật `AI_AGENT_THEO_VAI_TRO`). `null` ⇒ không hiện gì. */
  modelBatDau: ThongTinModelBatDau | null;
  /** (Đợt 11.8, UX-C06) % ngữ cảnh khi `ngu-canh-day` (≥ 80 %); null = chưa đầy. */
  nguCanhDay: number | null;
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
  daHaTuTri: false,
  modelBatDau: null,
  nguCanhDay: null,
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
  if (ten === "find_symbol") return [chuoi(ts.name), chuoi(ts.kind)].filter(Boolean).join(" · ");
  if (ten === "search_code") return chuoi(ts.query) ?? "";
  if (ten === "search_docs") return [chuoi(ts.query), chuoi(ts.corpus)].filter(Boolean).join(" · ");
  if (ten === "remember") return chuoi(ts.note) ?? "";
  if (ten === "lookup_api") return [chuoi(ts.name), chuoi(ts.language)].filter(Boolean).join(" · ");
  // ★★ Đợt 9 — compile_st: `path` (tệp .st/.scl) hoặc mã dán thẳng (`code`, không hiện nội dung — chỉ dấu "code").
  if (ten === "compile_st") return chuoi(ts.path) ?? (chuoi(ts.code) ? "code" : "");
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

/** `xong` của cha, hoặc `con-xong` của một con: mọi thẻ còn chờ (của cha lẫn của con) hết hiệu lực. */
function hetHieuLucTheCho(m: MucDongThoiGian): MucDongThoiGian {
  if (m.kieu === "duyet" && m.trangThai === "cho") return { ...m, trangThai: "het-hieu-luc" };
  if (m.kieu === "ke-hoach-duyet" && (m.trangThai === "cho" || m.trangThai === "dang-gui")) return { ...m, trangThai: "het-hieu-luc" };
  if (m.kieu === "con") return { ...m, tt: { ...m.tt, choDuyet: false, dongThoiGian: m.tt.dongThoiGian.map(hetHieuLucTheCho) } };
  return m;
}

const conChoDuyet = (ds: MucDongThoiGian[]): boolean =>
  ds.some((m) => (m.kieu === "duyet" && m.trangThai === "cho") || (m.kieu === "ke-hoach-duyet" && (m.trangThai === "cho" || m.trangThai === "dang-gui")) || (m.kieu === "con" && m.tt.choDuyet));

const DANG_CHO_KE_HOACH: ReadonlySet<TrangThaiKeHoachDuyet> = new Set(["cho", "dang-gui", "da-doi"]);
const laBam = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

export function giamSuKien(s: TrangThaiAgent, e: SuKienAgent, doSau = 0): TrangThaiAgent {
  const n: TrangThaiAgent = { ...s, soSuKien: s.soSuKien + 1 };
  switch (e?.loai) {
    case "bat-dau":
      return { ...n, runId: e.runId, cheDo: e.cheDo, dangChay: true, ketThuc: null, modelBatDau: e.model ?? null };
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
      return { ...n, dongThoiGian: dt, choDuyet: conChoDuyet(dt) };
    }
    case "ke-hoach":
      return { ...n, keHoach: Array.isArray(e.viec) ? e.viec : [] };
    case "ke-hoach-cho-duyet": {
      if (!laBam(e.bam) || !Array.isArray(e.viec)) return n;
      // phát lại sau nối lại: cùng băm ⇒ KHÔNG nhân đôi (và không kéo thẻ đã quyết về "cho")
      if (n.dongThoiGian.some((m) => m.kieu === "ke-hoach-duyet" && m.bam === e.bam)) return { ...n, choDuyet: conChoDuyet(n.dongThoiGian) };
      // kế hoạch mới thay kế hoạch cũ còn chờ: thẻ cũ không còn là thứ máy chủ đang đợi
      const dt: MucDongThoiGian[] = [
        ...n.dongThoiGian.map((m): MucDongThoiGian => (m.kieu === "ke-hoach-duyet" && DANG_CHO_KE_HOACH.has(m.trangThai) ? { ...m, trangThai: "het-hieu-luc" } : m)),
        { kieu: "ke-hoach-duyet", bam: e.bam, viec: e.viec, trangThai: "cho" },
      ];
      return { ...n, choDuyet: true, dongThoiGian: dt };
    }
    case "ke-hoach-da-duyet":
    case "ke-hoach-khong-duyet": {
      if (!laBam(e.bam)) return n;
      const dich: TrangThaiKeHoachDuyet = e.loai === "ke-hoach-da-duyet" ? "da-duyet" : e.lyDo === "het-gio" ? "het-gio" : "bac";
      const luc = e.loai === "ke-hoach-da-duyet" && typeof e.luc === "string" ? e.luc : undefined;
      const dt = n.dongThoiGian.map((m): MucDongThoiGian => {
        if (m.kieu !== "ke-hoach-duyet" || m.bam !== e.bam) return m;
        const { maLoi: _bo, ...goc } = m;
        return { ...goc, trangThai: dich, ...(luc ? { luc } : {}) };
      });
      return { ...n, dongThoiGian: dt, choDuyet: conChoDuyet(dt) };
    }
    case "de-xuat-nho": {
      if (typeof e.id !== "string" || n.dongThoiGian.some((m) => m.kieu === "nho" && m.id === e.id)) return n;
      const scope: PhamViNho = e.scope === "user" ? "user" : "project";
      return { ...n, dongThoiGian: [...n.dongThoiGian, { kieu: "nho", id: e.id, note: String(e.note ?? ""), scope, trangThai: "cho" }] };
    }
    case "canh-bao-du-lieu":
    case "ha-tu-tri": {
      const muc: MucDongThoiGian = {
        kieu: "canh-bao",
        loaiCanhBao: e.loai === "ha-tu-tri" ? "ha-tu-tri" : "du-lieu",
        nguon: String(e.nguon ?? ""),
        mau: Array.isArray(e.mau) ? e.mau.filter((x): x is string => typeof x === "string") : [],
      };
      return { ...n, dongThoiGian: [...n.dongThoiGian, muc], ...(e.loai === "ha-tu-tri" ? { daHaTuTri: true } : {}) };
    }
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
    case "ngu-canh-day":
      return typeof e.phanTram === "number" && Number.isFinite(e.phanTram) ? { ...n, nguCanhDay: e.phanTram } : n;
    case "con-bat-dau": {
      if (typeof e.runIdCon !== "string" || !e.runIdCon) return n;
      if (n.dongThoiGian.some((m) => m.kieu === "con" && m.runIdCon === e.runIdCon)) return n; // phát lại sau nối lại: không nhân đôi
      if (n.dongThoiGian.filter((m) => m.kieu === "con").length >= TRAN_AGENT_CON) return n;
      const con: MucAgentCon = {
        kieu: "con",
        runIdCon: e.runIdCon,
        agent: String(e.agent ?? ""),
        nguon: e.nguon === "tuRepo" ? "tuRepo" : "dungSan",
        sau: typeof e.sau === "number" ? e.sau : 1,
        cheDo: e.cheDo,
        nhiemVu: String(e.nhiemVu ?? ""),
        trangThai: "chay",
        tt: { ...TRANG_THAI_RONG, cheDo: e.cheDo, dangChay: true },
      };
      return { ...n, dongThoiGian: [...n.dongThoiGian, con] };
    }
    case "con-xong": {
      const dt = n.dongThoiGian.map((m) =>
        m.kieu === "con" && m.runIdCon === e.runIdCon
          ? { ...m, trangThai: "xong" as const, lyDo: e.lyDo, ...(e.tomTat ? { tomTat: e.tomTat } : {}), tt: { ...m.tt, dangChay: false, choDuyet: false, dongThoiGian: m.tt.dongThoiGian.map(hetHieuLucTheCho) } }
          : m,
      );
      return { ...n, dongThoiGian: dt, choDuyet: conChoDuyet(dt) };
    }
    case "su-kien-con": {
      if (doSau >= TRAN_DO_SAU_CON || !e.suKien) return n;
      const dt = n.dongThoiGian.map((m) => (m.kieu === "con" && m.runIdCon === e.runIdCon ? { ...m, tt: giamSuKien(m.tt, e.suKien, doSau + 1) } : m));
      return { ...n, dongThoiGian: dt, choDuyet: conChoDuyet(dt) };
    }
    case "loi":
      return { ...n, dongThoiGian: [...n.dongThoiGian, { kieu: "loi", ma: e.ma, thongDiep: e.thongDiep }] };
    case "xong":
      return {
        ...n,
        dangChay: false,
        choDuyet: false,
        phiaTruoc: null,
        ketThuc: { lyDo: e.lyDo, ...(e.tomTat ? { tomTat: e.tomTat } : {}) },
        dongThoiGian: n.dongThoiGian.map((m) => hetHieuLucTheCho(m)),
      };
    default:
      return n;
  }
}

/** (Đợt 2) cập nhật thẻ đề xuất nhớ `id` (sau khi bấm Nhớ / Bỏ qua). id lạ ⇒ trả NGUYÊN `s`. Thuần. */
export function capNhatDeXuatNho(
  s: TrangThaiAgent,
  id: string,
  vao: { trangThai: TrangThaiTheNho; maLoi?: string },
): TrangThaiAgent {
  if (!s.dongThoiGian.some((m) => m.kieu === "nho" && m.id === id)) return s;
  return {
    ...s,
    dongThoiGian: s.dongThoiGian.map((m) => {
      if (m.kieu !== "nho" || m.id !== id) return m;
      const { maLoi: _bo, ...goc } = m;
      return vao.maLoi ? { ...goc, trangThai: vao.trangThai, maLoi: vao.maLoi } : { ...goc, trangThai: vao.trangThai };
    }),
  };
}

/**
 * (Đợt 11.3-C) cập nhật thẻ kế hoạch theo `bam` sau khi bấm / sau khi hỏi lại máy chủ. `bam` lạ ⇒ trả NGUYÊN `s`.
 * Thẻ ĐÃ QUYẾT (da-duyet / bac / het-gio) KHÔNG bị kéo ngược về trạng thái chờ bởi lời gọi muộn.
 */
export function capNhatKeHoachDuyet(
  s: TrangThaiAgent,
  bam: string,
  vao: { trangThai: TrangThaiKeHoachDuyet; maLoi?: string; luc?: string },
): TrangThaiAgent {
  if (!s.dongThoiGian.some((m) => m.kieu === "ke-hoach-duyet" && m.bam === bam)) return s;
  const dt = s.dongThoiGian.map((m): MucDongThoiGian => {
    if (m.kieu !== "ke-hoach-duyet" || m.bam !== bam) return m;
    if (m.trangThai === "da-duyet" || m.trangThai === "bac" || m.trangThai === "het-gio" || m.trangThai === "het-hieu-luc") return m;
    const { maLoi: _bo, ...goc } = m;
    return { ...goc, trangThai: vao.trangThai, ...(vao.maLoi ? { maLoi: vao.maLoi } : {}), ...(vao.luc ? { luc: vao.luc } : {}) };
  });
  return { ...s, dongThoiGian: dt, choDuyet: conChoDuyet(dt) };
}

const TT_MAY_CHU_SANG_THE: Record<string, TrangThaiKeHoachDuyet> = { cho: "cho", duyet: "da-duyet", bac: "bac", "het-gio": "het-gio" };

/**
 * (Đợt 11.3-C) đồng bộ thẻ kế hoạch với câu trả lời `aiAgent.keHoachDangCho` (mở lại trang / sau CONFLICT). KHÔNG đụng `soSuKien`
 * (không phải sự kiện luồng — `?tu=n` phải giữ nguyên). Thẻ cùng băm: lấy trạng thái máy chủ (thẻ đã quyết không bị kéo ngược);
 * băm chưa có thẻ và máy chủ còn đang chờ: thêm thẻ mới, thẻ cũ còn chờ thành `da-doi`. Trạng thái lạ ⇒ "cho".
 */
export function dongBoKeHoachMayChu(
  s: TrangThaiAgent,
  kq: { bam: string | null; trangThai: string | null; viec: ViecKeHoach[] },
): TrangThaiAgent {
  if (!kq.bam || !laBam(kq.bam)) return s;
  const dich = TT_MAY_CHU_SANG_THE[kq.trangThai ?? "cho"] ?? "cho";
  if (s.dongThoiGian.some((m) => m.kieu === "ke-hoach-duyet" && m.bam === kq.bam)) return dich === "cho" ? s : capNhatKeHoachDuyet(s, kq.bam, { trangThai: dich });
  if (dich !== "cho") return s;
  const dt: MucDongThoiGian[] = [
    ...s.dongThoiGian.map((m): MucDongThoiGian => (m.kieu === "ke-hoach-duyet" && DANG_CHO_KE_HOACH.has(m.trangThai) ? { ...m, trangThai: "da-doi" } : m)),
    { kieu: "ke-hoach-duyet", bam: kq.bam, viec: kq.viec, trangThai: "cho" },
  ];
  return { ...s, dongThoiGian: dt, choDuyet: true };
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

/**
 * (Đợt 5.1) Chỗ gắn nút 👍/👎: câu trả lời CUỐI của lượt ĐÃ XONG phía máy chủ. `iDong` = vị trí trên `dongThoiGian`;
 * `chiSoTin` = thứ tự của khối `chu` ấy trong các khối `chu` (hợp đồng `aiAgent.phanHoi` — cùng luật gộp với
 * `khoiTraLoiTuSuKien`). Đang chạy / chưa có `runId` (dừng trước `bat-dau`) / không có chữ ⇒ null.
 */
export function viTriTraLoiCuoi(s: TrangThaiAgent): { runId: string; iDong: number; chiSoTin: number } | null {
  if (s.dangChay || !s.ketThuc || !s.runId) return null;
  let iDong = -1;
  let chiSoTin = -1;
  s.dongThoiGian.forEach((m, i) => {
    if (m.kieu !== "chu") return;
    iDong = i;
    chiSoTin++;
  });
  return iDong < 0 ? null : { runId: s.runId, iDong, chiSoTin };
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

/**
 * (Đợt 11.3-A) cảnh báo của máy chủ gắn vào thẻ duyệt (`preview.warnings` — vd "Thư mục chạy: …", cảnh báo cài đặt) — CHỮ THUẦN, giữ nguyên thứ tự.
 * Nhận cùng ba hình dạng `xemTruoc` như `layDiffTuDeXuat`; không có ⇒ []. Chuỗi cắt 400 ký tự, tối đa 12 dòng (chống phình).
 */
export function canhBaoCuaDeXuat(deXuat: DeXuatDuyet): string[] {
  const xt = deXuat?.xemTruoc as Record<string, unknown> | undefined;
  if (!xt || typeof xt !== "object") return [];
  const ung: Array<Record<string, unknown>> = [];
  if (xt.pendingAction && typeof xt.pendingAction === "object") ung.push(xt.pendingAction as Record<string, unknown>);
  ung.push(xt);
  for (const u of ung) {
    const pv = u.preview as { warnings?: unknown } | undefined;
    const ds = Array.isArray(pv?.warnings) ? pv!.warnings : Array.isArray(u.warnings) ? u.warnings : null;
    if (ds) return (ds as unknown[]).filter((w): w is string => typeof w === "string").map((w) => w.slice(0, 400)).slice(0, 12);
  }
  return [];
}

/** id gửi cho `aiAgent.duyet/bac`: id hàng `ai_pending_actions` nếu server gửi, không thì id sự kiện. */
export function idHanhDong(m: { id: string; deXuat: DeXuatDuyet }): string {
  const p = m.deXuat?.pendingActionId;
  return p !== undefined && p !== null && String(p).length > 0 ? String(p) : m.id;
}
