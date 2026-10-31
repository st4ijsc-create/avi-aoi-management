/**
 * ★★ Đợt 10.3 B1–B3 — CỔNG AI NGOÀI: điểm vào DUY NHẤT tới Anthropic / OpenAI / Gemini / tương thích OpenAI. Spec §5 + rà kiem-dinh.
 *
 * Thứ tự CỐ ĐỊNH (lưới canh bằng nhật ký phụ thuộc):
 *   (1) `AI_NGOAI_ENABLED === "true"` LÚC GỌI ⇒ không: `NGOAI_TAT`.
 *   (2) Nhà máy theo CHỦ DỮ LIỆU (rà mục 3): tập = chủ dữ liệu ∪ {nhà máy tính trần}; chủ không xác định ⇒ `NGOAI_KHONG_TON_TAI`
 *       (luồng toàn cục ⇒ `NGOAI_LUONG_TOAN_CUC`); người gọi phải thuộc phạm vi MỌI nhà máy; MỌI nhà máy phải `batNgoai`; model phải
 *       có + `batModel` ở nhà máy tính trần (khoá + giá ở đó) ⇒ thiếu: `NGOAI_KHONG_TON_TAI` (NOT_FOUND — không lộ tồn tại).
 *   (3) Đính kèm (ảnh / tệp) ⇒ `NGOAI_CAM_DINH_KEM`; (3b) trần kích thước TRƯỚC khi che: chuỗi ≤ 256 KB, tổng ≤ 1 MB ⇒ `NGOAI_QUA_LON`.
 *   (4) Mức dữ liệu CỔNG tự suy (rà mục 4) từ `nguonMuc`; `van-hanh` ⇒ MỌI nhà máy phải `choDuLieuVanHanh` ⇒ không: `NGOAI_DU_LIEU_VAN_HANH`.
 *   (5) Lắp TOÀN BỘ yêu cầu (system, lịch sử, kết quả tool, schema tool).
 *   (6) CHE — ĐIỂM CHE DUY NHẤT, sau khi lắp xong (`cheDuLieu`); không dựng được từ điển ⇒ `NGOAI_CHE_HONG` (không gửi).
 *   (7) Giữ chỗ trần (`datTruoc`) ⇒ `NGOAI_VUOT_TRAN` / `NGOAI_DEM_HONG`.
 *   (8) Sổ Ý ĐỊNH (`ghiYDinh`) ⇒ lỗi: hoàn chỗ + `NGOAI_SO_HONG`, KHÔNG gọi.
 *   (9) Nhà cung cấp (thử lại lỗi tạm: MỖI lần thử giữ chỗ lại); lỗi ⇒ thông điệp qua `cheChuoi` rồi mới ném / ghi.
 *   (10) Kết toán (`usage` vắng ⇒ giữ ước tính). (11) Kiểm `toolCalls` trả về theo tập ĐÃ CẤP (rà mục 6). (12) Sổ KẾT QUẢ (+ nội dung
 *   ĐÃ che nếu nhà máy bật lưu).
 * Kết quả LUÔN mang `khongTinCay: true` — người gọi bọc như dữ liệu không tin cậy trước khi đưa sang bước sau.
 */
import { cheChuoi, cheGiaTri, cheSchemaTool, layTuDienNhay, type TuDienNhay } from "./cheDuLieu";
import { layCauHinhNhaMay, layModelNgoai, ngoaiBatTheoEnv, type CauHinhNhaMay, type DbDoc, type ModelNgoai } from "./cauHinhNgoai";
import { layEndpointKhoa, layKhoaChoNhaCungCap } from "./khoaNgoai";
import { LoiNgoai } from "./loi";
import { gopMuc, type MucDuLieu } from "./phanLoai";
import { mucCuaGhep } from "./ghepPhan";
import { bamCauTraLoi, bamNoiDung, ghiKetQua, ghiYDinh, luuNoiDungNeuBat, type DbSo } from "./soNgoai";
import { giuLuotBay, thaLuotBay } from "./luotBay";
import { chotTranLuot, raToiThieuCho, datTruoc, huyGiuChuaGui, ketToan, uocTokenVao, type DbDem, type PhieuGiu } from "./tranChiPhi";
import type { CongCuNgoai, KetQuaNhaCungCap, MangNgoai, NhaCungCapAi, TinNhanNgoai, YeuCauNhaCungCap } from "./nhaCungCap/kieu";
import { anthropic } from "./nhaCungCap/anthropic";
import { gemini } from "./nhaCungCap/gemini";
import { openai, openaiTuongThich } from "./nhaCungCap/openai";

export type NguonMuc =
  | { loai: "luong"; mucDuLieu?: () => Promise<MucDuLieu> }
  | { loai: "be-mat"; beMat: "chat" | "coding" | "agent-turn" | "v1"; phanDaGhep: MucDuLieu[] };

export interface YeuCauGoiNgoai {
  dich: { nhaCungCap: string; model: string };
  /** ★ 10.4b L0a — PHẢI do `ghepPhan` tạo (cổng kiểm dấu; mảng chép / tự dựng ⇒ `NGOAI_KHONG_QUA_BO_GHEP`). */
  tinNhan: readonly TinNhanNgoai[];
  dinhKem?: unknown[];
  congCu?: CongCuNgoai[];
  maxTokens: number;
  mucDich: string;
  ngu: {
    userId: number | null;
    flowId: string | null;
    runId: string | null;
    tuDong: boolean;
    /** Phạm vi nhà máy của NGƯỜI GỌI (`null` = toàn quyền — admin không gắn nhà máy). */
    nhaMayNguoiGoi: number[] | null;
    /** Nhà máy CHỦ của dữ liệu trong yêu cầu (luồng: nhà máy chủ luồng); phần tử `null` = chủ không xác định ⇒ từ chối. */
    nhaMayChuDuLieu: Array<number | null>;
    nguonMuc: NguonMuc;
    /**
     * Luồng: dữ liệu VẬN HÀNH có thể đến từ MỌI nhà máy trong phạm vi chủ lượt (node số liệu đọc theo phạm vi chủ) ⇒ khi mức là
     * `van-hanh`, cổng thêm các nhà máy này vào tập và đòi MỖI nhà máy `batNgoai` + `choDuLieuVanHanh`.
     */
    nhaMayKhiVanHanh?: () => Promise<number[]>;
    /** Luồng: phiên bản của lượt đang chạy — cổng KIỂM LẠI duyệt ngoài (phòng thủ chiều sâu ngoài `taoRunTx`). */
    phienBan?: number;
  };
}

export interface KetQuaGoiNgoai {
  noiDung: string;
  toolCalls: KetQuaNhaCungCap["toolCalls"];
  khongTinCay: true;
  tokenVao: number | null;
  tokenRa: number | null;
  /** ★ 10.4 — chi phí ước theo bảng giá model (null ⇒ model không có giá / nhà cung cấp không báo usage). */
  chiPhiUocUsd: number | null;
  /** ★ 10.4 — id hàng Ý ĐỊNH trong sổ `ai_external_calls` (đối chiếu / `aiNgoai.xemNoiDung`). */
  callId: number;
}

export type DbCong = DbDem & DbSo & DbDoc;

export interface PhuThuocCong {
  db: () => Promise<DbCong | null>;
  env: () => NodeJS.ProcessEnv;
  layTuDien: () => Promise<TuDienNhay>;
  layNhaCungCap: (ma: string) => NhaCungCapAi | null;
  layKhoa: (db: DbCong, keyId: number, factoryId: number, nhaCungCap: string) => () => Promise<string>;
  layEndpoint: (db: DbCong, keyId: number) => Promise<string | null>;
  /** Mạng ra ngoài với chính sách host nội bộ của NHÀ MÁY tính trần. */
  mang: (db: DbCong, factoryId: number) => Promise<MangNgoai>;
  soLanThu: number;
  /** (H3.1) chờ giữa hai lần thử (mặc định `setTimeout`) + nguồn ngẫu nhiên cho jitter (mặc định `Math.random`) — lưới thay để không ngủ thật. */
  ngu?: (ms: number) => Promise<void>;
  ngauNhien?: () => number;
  /** Lưới: nhật ký thứ tự bước. */
  ghiBuoc?: (buoc: string) => void;
  /** ★ 10.4b L0a' (D10-ii) — một lượt ngoài đang bay mỗi người (mặc định: bảng `ai_ngoai_dang_bay`, `luotBay.ts`). */
  luotBay?: { giu: (db: DbCong, userId: number, factoryId: number) => Promise<string>; tha: (db: DbCong, userId: number, token: string) => Promise<void> };
}

export const TRAN_CHUOI_BYTE = 256 * 1024;
export const TRAN_YEU_CAU_BYTE = 1024 * 1024;
/** Trần cứng token RA mỗi lời gọi (dù model / nhà máy không đặt trần). */
export const MAX_TOKENS_CUNG = 32_000;
/** (H3.1) chờ gốc giữa hai lần thử (nhân đôi mỗi lần) + trần chờ: nhà cung cấp xin chờ lâu hơn trần ⇒ KHÔNG thử lại (trả lỗi ngay). */
export const CHO_THU_LAI_GOC_MS = 500;
export const TRAN_CHO_THU_LAI_MS = 10_000;

/**
 * (H3.1) thời gian chờ trước lần thử thứ `lan + 1`: max(`Retry-After`, gốc·2^(lan−1)) + jitter [0, ½ gốc·2^(lan−1)). Vượt trần ⇒ `null`
 * (không thử lại). Thuần.
 */
export function choTruocLanThu(lan: number, choMs: number | undefined, ngauNhien: () => number = Math.random): number | null {
  const mu = CHO_THU_LAI_GOC_MS * 2 ** Math.max(0, lan - 1);
  const ms = Math.max(choMs ?? 0, mu) + Math.floor(Math.min(0.999, Math.max(0, ngauNhien())) * (mu / 2));
  return ms > TRAN_CHO_THU_LAI_MS ? null : ms;
}

/** Bản cài THẬT (Task 9) — tĩnh: chỉ phụ thuộc lỗi / kiểu, không mạng lúc nạp. */
const cacNhaCungCap = new Map<string, NhaCungCapAi>([anthropic, openai, openaiTuongThich, gemini].map((n) => [n.ma, n]));

async function mangChoNhaMay(db: DbCong, factoryId: number): Promise<MangNgoai> {
  const { sql } = await import("drizzle-orm");
  const { taoMangNgoai } = await import("./mangNgoai");
  const r = (await db.execute(sql`SELECT "hostCong" FROM ai_ngoai_host_noi_bo WHERE "factoryId" = ${factoryId}`)) as unknown;
  const ds = (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ hostCong: string }>;
  return taoMangNgoai({ hostNoiBo: new Set(ds.map((x) => x.hostCong)) });
}

export const phuThuocMacDinh: PhuThuocCong = {
  db: async () => (await (await import("../../../db/connection")).getDb()) as unknown as DbCong | null,
  env: () => process.env,
  layTuDien: () => layTuDienNhay(),
  layNhaCungCap: (ma) => cacNhaCungCap.get(ma) ?? null,
  layKhoa: (db, keyId, factoryId, nhaCungCap) => layKhoaChoNhaCungCap(db, keyId, factoryId, nhaCungCap),
  layEndpoint: (db, keyId) => layEndpointKhoa(db, keyId),
  mang: (db, factoryId) => mangChoNhaMay(db, factoryId),
  soLanThu: 2,
  luotBay: { giu: (db, userId, factoryId) => giuLuotBay(db, userId, factoryId), tha: (db, userId, token) => thaLuotBay(db, userId, token) },
};

/** Nhà máy TÍNH TRẦN: chủ dữ liệu nhỏ nhất (tất định); không có ⇒ nhà máy DUY NHẤT của người gọi; còn lại ⇒ null. */
export function nhaMayTinhTran(ngu: YeuCauGoiNgoai["ngu"]): number | null {
  const chu = ngu.nhaMayChuDuLieu.filter((x): x is number => typeof x === "number");
  if (chu.length) return Math.min(...chu);
  return ngu.nhaMayNguoiGoi && ngu.nhaMayNguoiGoi.length === 1 ? ngu.nhaMayNguoiGoi[0]! : null;
}

// ─── kiểm tool call trả về (rà mục 6) ───────────────────────────────────────────────────────────────────────

/** Kiểm tối thiểu JSON-schema dạng tool: object + properties kiểu nguyên thuỷ + required + additionalProperties:false. Lạ ⇒ sai. */
function hopSchema(v: unknown, schema: unknown): boolean {
  const s = schema as { type?: unknown; properties?: Record<string, { type?: unknown }>; required?: unknown; additionalProperties?: unknown } | null;
  if (!s || s.type !== "object" || typeof s.properties !== "object" || s.properties === null) return false;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!Object.prototype.hasOwnProperty.call(s.properties, k)) return false;
  for (const k of Array.isArray(s.required) ? s.required : []) if (!(String(k) in o)) return false;
  for (const [k, p] of Object.entries(s.properties)) {
    if (!(k in o)) continue;
    const t = p?.type;
    const x = o[k];
    const dung =
      t === "string" ? typeof x === "string" : t === "number" ? typeof x === "number" && Number.isFinite(x) : t === "integer" ? Number.isInteger(x) : t === "boolean" ? typeof x === "boolean" : false;
    if (!dung) return false;
  }
  return true;
}

/**
 * Schema tool thuộc tập con kiểm được (object + thuộc tính nguyên thuỷ). Ngoài tập ⇒ KHÔNG cấp tool cho model ngoài (rà lô 2 mục 4: cấp rồi
 * từ chối mọi lời gọi là im lặng hỏng).
 */
export function schemaHoTro(schema: unknown): boolean {
  const s = schema as { type?: unknown; properties?: Record<string, { type?: unknown }> } | null;
  if (!s || s.type !== "object" || typeof s.properties !== "object" || s.properties === null) return false;
  return Object.values(s.properties).every((p) => ["string", "number", "integer", "boolean"].includes(String(p?.type)));
}

export function kiemToolCallTraVe(toolCalls: KetQuaNhaCungCap["toolCalls"], congCuDaCap: readonly CongCuNgoai[] | undefined): KetQuaNhaCungCap["toolCalls"] {
  const theoTen = new Map((congCuDaCap ?? []).map((c) => [c.ten, c]));
  for (const tc of toolCalls) {
    const cc = theoTen.get(tc.ten);
    if (!cc) throw new LoiNgoai("NGOAI_TOOL_KHONG_CAP", String(tc.ten).slice(0, 60));
    if (!hopSchema(tc.thamSo, cc.schema)) throw new LoiNgoai("NGOAI_TOOL_KHONG_CAP", `${cc.ten}: tham số sai schema`);
  }
  return toolCalls;
}

// ─── cổng ───────────────────────────────────────────────────────────────────────────────────────────────────

function kiemKichThuoc(yc: YeuCauGoiNgoai): void {
  for (const m of yc.tinNhan) if (Buffer.byteLength(m.noiDung ?? "", "utf8") > TRAN_CHUOI_BYTE) throw new LoiNgoai("NGOAI_QUA_LON", "tin nhắn");
  for (const c of yc.congCu ?? []) if (Buffer.byteLength(JSON.stringify(c), "utf8") > TRAN_CHUOI_BYTE) throw new LoiNgoai("NGOAI_QUA_LON", "công cụ");
  if (Buffer.byteLength(JSON.stringify({ t: yc.tinNhan, c: yc.congCu ?? [] }), "utf8") > TRAN_YEU_CAU_BYTE) throw new LoiNgoai("NGOAI_QUA_LON", "yêu cầu");
}

async function mucCuaYeuCau(nguon: NguonMuc): Promise<MucDuLieu> {
  if (nguon.loai === "luong") {
    if (!nguon.mucDuLieu) return "van-hanh"; // ngữ cảnh không có mức (vd spread mất ô) ⇒ fail-closed
    try {
      return await nguon.mucDuLieu();
    } catch {
      return "van-hanh";
    }
  }
  return gopMuc(...nguon.phanDaGhep);
}

function cheYeuCau(yc: YeuCauNhaCungCap, tu: TuDienNhay): { daChe: YeuCauNhaCungCap; soTruong: number } {
  let soTruong = 0;
  const tinNhan = yc.tinNhan.map((m) => {
    const kq = cheGiaTri(m.noiDung, tu);
    soTruong += kq.soTruongDaChe;
    return { ...m, noiDung: String(kq.giaTri) };
  });
  const congCu = yc.congCu?.map((c) => {
    const moTa = cheChuoi(c.moTa, tu);
    const schema = cheSchemaTool(c.schema, tu);
    soTruong += moTa.soTruongDaChe + schema.soTruongDaChe;
    return { ten: c.ten, moTa: moTa.giaTri, schema: schema.giaTri };
  });
  return { daChe: { ...yc, tinNhan, ...(congCu ? { congCu } : {}) }, soTruong };
}

async function kiemDuyetLuong(db: DbCong, flowId: string | null, phienBan: number | undefined, nhaMay: number): Promise<void> {
  if (!flowId || typeof phienBan !== "number") throw new LoiNgoai("NGOAI_CHUA_DUYET", "thieu-phien-ban");
  const { sql } = await import("drizzle-orm");
  const { kiemDuyetNgoaiTruocKhiBat } = await import("./duyetNgoai");
  const r = (await db.execute(sql`SELECT v.definition, v."ngoaiDuyetLuc", v."ngoaiBamDuyet", f."factoryId"
    FROM ai_flow_versions v JOIN ai_flows f ON f.id = v."flowId" WHERE v."flowId" = ${flowId} AND v.version = ${phienBan}`)) as unknown;
  const [h] = (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ definition: unknown; ngoaiDuyetLuc: Date | null; ngoaiBamDuyet: string | null; factoryId: number | null }>;
  if (!h) throw new LoiNgoai("NGOAI_CHUA_DUYET", "khong-co-phien-ban");
  if (h.factoryId !== nhaMay) throw new LoiNgoai("NGOAI_KHONG_TON_TAI");
  kiemDuyetNgoaiTruocKhiBat({ definition: h.definition, ngoaiDuyetLuc: h.ngoaiDuyetLuc, ngoaiBamDuyet: h.ngoaiBamDuyet }, h.factoryId);
}

/** Kết quả các bước (1)–(5) của cổng — KHÔNG giữ chỗ trần, KHÔNG gọi mạng (dùng chung cho `goiAiNgoai` và xem trước của kiểm định). */
export interface KiemTruocNgoai {
  db: DbCong;
  laLuong: boolean;
  tinhTran: number;
  tap: number[];
  cfg: CauHinhNhaMay;
  /** Trần dùng cho giữ chỗ: cấu hình nhà máy với `tranTokenLuot` = min(nhà máy, model). */
  tran: CauHinhNhaMay;
  model: ModelNgoai;
  ncc: NhaCungCapAi;
  muc: MucDuLieu;
  maxTokens: number;
}

/**
 * ★ Đợt 10.4 — bước (1)–(5) của cổng tách thành hàm: `goiAiNgoai` gọi nó TRƯỚC giữ chỗ; `aiKiemDinh.xemTruoc` gọi nó để báo trước
 * "được phép không / vì sao" mà không tiêu tiền. Cùng một mã ⇒ xem trước và gọi thật không thể lệch luật.
 */
export async function kiemTruocNgoai(yc: YeuCauGoiNgoai, dep: PhuThuocCong = phuThuocMacDinh): Promise<KiemTruocNgoai> {
  const buoc = (b: string) => dep.ghiBuoc?.(b);
  // (1)
  buoc("co-env");
  if (!ngoaiBatTheoEnv(dep.env())) throw new LoiNgoai("NGOAI_TAT");
  // (2)
  buoc("nha-may");
  const db = await dep.db();
  if (!db) throw new LoiNgoai("NGOAI_DEM_HONG", "db");
  const laLuong = yc.ngu.nguonMuc.loai === "luong";
  if (yc.ngu.nhaMayChuDuLieu.some((x) => x === null)) throw new LoiNgoai(laLuong ? "NGOAI_LUONG_TOAN_CUC" : "NGOAI_KHONG_TON_TAI");
  const tinhTran = nhaMayTinhTran(yc.ngu);
  if (tinhTran === null) throw new LoiNgoai(laLuong ? "NGOAI_LUONG_TOAN_CUC" : "NGOAI_KHONG_TON_TAI");
  const tap = [...new Set([...(yc.ngu.nhaMayChuDuLieu as number[]), tinhTran])];
  if (yc.ngu.nhaMayNguoiGoi !== null && tap.some((f) => !yc.ngu.nhaMayNguoiGoi!.includes(f))) throw new LoiNgoai("NGOAI_KHONG_TON_TAI");
  const cauHinh = new Map<number, CauHinhNhaMay>();
  for (const f of tap) {
    const c = await layCauHinhNhaMay(db, f).catch(() => null);
    if (!c?.batNgoai) throw new LoiNgoai("NGOAI_KHONG_TON_TAI");
    cauHinh.set(f, c);
  }
  // Luồng: phiên bản của lượt phải ĐÃ DUYỆT NGOÀI và băm khớp (cổng là điểm ra DUY NHẤT — kiểm lại dù `taoRunTx` đã kiểm).
  if (laLuong) await kiemDuyetLuong(db, yc.ngu.flowId, yc.ngu.phienBan, tinhTran);
  const model = await layModelNgoai(db, tinhTran, yc.dich.nhaCungCap, yc.dich.model).catch(() => null);
  const ncc = dep.layNhaCungCap(yc.dich.nhaCungCap);
  if (!model?.batModel || !ncc) throw new LoiNgoai("NGOAI_KHONG_TON_TAI");
  // (3)
  buoc("dinh-kem");
  if (yc.dinhKem?.length) throw new LoiNgoai("NGOAI_CAM_DINH_KEM");
  kiemKichThuoc(yc);
  // (4)
  buoc("muc-du-lieu");
  // ★ 10.4b L0a — MAX giữa mức nguồn khai và mức BỘ DỰNG tính (`ghepPhan`): người gọi không hạ được mức của phần đã ghép.
  const muc = gopMuc(await mucCuaYeuCau(yc.ngu.nguonMuc), mucCuaGhep(yc.tinNhan) ?? "ky-thuat");
  if (muc === "van-hanh" && yc.ngu.nhaMayKhiVanHanh) {
    let them: number[];
    try {
      them = await yc.ngu.nhaMayKhiVanHanh();
    } catch {
      throw new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH");
    }
    for (const f of them) {
      if (cauHinh.has(f)) continue;
      const c = await layCauHinhNhaMay(db, f).catch(() => null);
      if (!c?.batNgoai) throw new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH");
      cauHinh.set(f, c);
      tap.push(f);
    }
  }
  if (muc === "van-hanh" && tap.some((f) => !cauHinh.get(f)!.choDuLieuVanHanh)) throw new LoiNgoai("NGOAI_DU_LIEU_VAN_HANH");
  // (5)
  buoc("lap");
  // maxTokens KẸP (rà lô 2 mục 1): ≤ trần lượt của model, ≤ MAX cứng, ≥ 1 — người gọi không đặt được 10^9.
  const maxTokens = Math.max(1, Math.min(Math.floor(Number(yc.maxTokens) || 1), model.tranTokenLuot ?? MAX_TOKENS_CUNG, MAX_TOKENS_CUNG));
  const cfg = cauHinh.get(tinhTran)!;
  // Trần MỖI LƯỢT hiệu lực = nhỏ hơn của cấu hình nhà máy và của model.
  const tranLuot = [cfg.tranTokenLuot, model.tranTokenLuot].filter((x): x is number => x !== null);
  const tran = { ...cfg, tranTokenLuot: tranLuot.length ? Math.min(...tranLuot) : null };
  return { db, laLuong, tinhTran, tap, cfg, tran, model, ncc, muc, maxTokens };
}

const nguThat = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

export async function goiAiNgoai(yc: YeuCauGoiNgoai, dep: PhuThuocCong = phuThuocMacDinh): Promise<KetQuaGoiNgoai> {
  // ★ 10.4b L0a — đường DUY NHẤT dựng yêu cầu: chỉ `tinNhan` mang dấu của `ghepPhan` mới được gửi (TRƯỚC mọi bước — không giữ chỗ, không sổ).
  if (mucCuaGhep(yc.tinNhan) === undefined) throw new LoiNgoai("NGOAI_KHONG_QUA_BO_GHEP");
  const k = await kiemTruocNgoai(yc, dep);
  // ★ 10.4b L0a' (D10-ii) — bề mặt người dùng (không phải luồng tự động): MỘT lượt ngoài đang bay mỗi người, giữ suốt mọi lần thử,
  //   thả ở finally (lỗi / huỷ cũng thả; tiến trình chết ⇒ TTL). Luồng có trần riêng (lượt chạy / luồng).
  const userId = yc.ngu.userId;
  const canKhoa = userId !== null && !yc.ngu.tuDong && yc.ngu.nguonMuc.loai === "be-mat" && dep.luotBay !== undefined;
  const token = canKhoa ? await dep.luotBay!.giu(k.db, userId!, k.tinhTran) : null;
  try {
    return await goiSauKiemTruoc(yc, dep, k);
  } finally {
    if (token !== null) await dep.luotBay!.tha(k.db, userId!, token).catch(() => undefined);
  }
}

async function goiSauKiemTruoc(yc: YeuCauGoiNgoai, dep: PhuThuocCong, k: KiemTruocNgoai): Promise<KetQuaGoiNgoai> {
  const buoc = (b: string) => dep.ghiBuoc?.(b);
  const { db, tinhTran, tap, cfg, tran, model, ncc, muc, maxTokens: maxTokensYeuCau } = k;
  let maxTokens = maxTokensYeuCau;
  // ★ 11.0 (rà kiem-dinh) — DANH SÁCH TRẮNG trường tin nhắn: kiểu TS không chặn trường THỪA lúc chạy (vd `reasoning_content` của lõi agent
  //   khi bật giữ nghĩ, `nghiTruoc`, dấu nội bộ) ⇒ chỉ vai trò + nội dung + tên tool đi tiếp tới bộ che và nhà cung cấp.
  const tinNhanSach: TinNhanNgoai[] = yc.tinNhan.map(({ vaiTro, noiDung, tenTool }) => ({ vaiTro, noiDung, ...(tenTool !== undefined ? { tenTool } : {}) }));
  const yeuCau: YeuCauNhaCungCap = { model: model.model, tinNhan: tinNhanSach, ...(yc.congCu?.length ? { congCu: yc.congCu } : {}), maxTokens, nhietDo: 0.2 };
  // (6)
  buoc("che");
  let tu: TuDienNhay;
  try {
    tu = await dep.layTuDien();
  } catch {
    throw new LoiNgoai("NGOAI_CHE_HONG");
  }
  const { daChe, soTruong } = cheYeuCau(yeuCau, tu);
  const noiDungDaChe = JSON.stringify(daChe);
  // (7)–(9) MỖI lần thử: giữ chỗ → sổ Ý ĐỊNH riêng → gọi (rà kiem-dinh lô 2 mục 5: mỗi lần thử có hàng ý định + kết quả của nó ⇒
  //   đối soát chi phí khớp bộ đếm từng lần). Ghi sổ ý định lỗi ⇒ hoàn chỗ + `NGOAI_SO_HONG`, KHÔNG gọi.
  const tokenVaoUoc = uocTokenVao(daChe);
  // ★ 10.4 — lời gọi ngoài lượt chạy: co maxTokens để vào + ra vừa trần MỖI LƯỢT (hàm dùng chung với xem trước).
  maxTokens = chotTranLuot(tokenVaoUoc, maxTokens, tran.tranTokenLuot, yc.ngu.runId, raToiThieuCho(yc.mucDich));
  daChe.maxTokens = maxTokens;
  const tienUoc =
    model.giaVaoUsdTrieu !== null && model.giaRaUsdTrieu !== null ? (tokenVaoUoc * model.giaVaoUsdTrieu + maxTokens * model.giaRaUsdTrieu) / 1e6 : null;
  const bam = bamNoiDung(noiDungDaChe);
  const ghiKq = async (yDinhId: number, h: Parameters<typeof ghiKetQua>[2]) => {
    // Thử lại MỘT lần; vẫn lỗi ⇒ cảnh báo (đối soát sẽ đánh `khong-ro` sau 30 phút) — không làm hỏng lượt đã có kết quả.
    for (let i = 0; i < 2; i++) {
      try {
        return await ghiKetQua(db, yDinhId, h);
      } catch {
        /* thử lại */
      }
    }
    console.warn(`[AiNgoai] không ghi được kết quả sổ cho ý định ${yDinhId} (${h.ketCuc})`);
  };
  const cheLoi = (e: unknown): LoiNgoai =>
    e instanceof LoiNgoai
      ? e.ma === "NGOAI_NHA_CUNG_CAP_LOI"
        ? // (H3.1) giữ loại lỗi cho người gọi (UI nói đúng "hết hạn mức" / "tràn ngữ cảnh") — thông điệp vẫn che
          new LoiNgoai(e.ma, cheChuoi(e.chiTiet ?? "", tu).giaTri.slice(0, 500), { ...(e.phanLoai ? { phanLoai: e.phanLoai } : {}) })
        : e
      : new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", cheChuoi(String((e as Error)?.message ?? e), tu).giaTri.slice(0, 500));
  let kq: KetQuaNhaCungCap | null = null;
  let phieu: PhieuGiu;
  let yDinhId = 0;
  for (let lan = 1; ; lan++) {
    buoc("dat-truoc");
    phieu = await datTruoc(db, { factoryId: tinhTran, userId: yc.ngu.userId, flowId: yc.ngu.flowId, runId: yc.ngu.runId, tokenUoc: tokenVaoUoc + maxTokens, tienUocUsd: tienUoc }, tran);
    buoc("so-y-dinh");
    try {
      yDinhId = await ghiYDinh(db, {
        factoryId: tinhTran,
        nhaMayDuLieu: tap,
        userId: yc.ngu.userId,
        flowId: yc.ngu.flowId,
        runId: yc.ngu.runId,
        tuDong: yc.ngu.tuDong,
        nhaCungCap: yc.dich.nhaCungCap,
        model: model.model,
        mucDich: yc.mucDich,
        mucDuLieu: muc,
        soTruongDaChe: soTruong,
        bamNoiDung: bam,
      });
    } catch {
      await huyGiuChuaGui(db, phieu).catch(() => undefined);
      throw new LoiNgoai("NGOAI_SO_HONG");
    }
    buoc("nha-cung-cap");
    try {
      const endpoint = yc.dich.nhaCungCap === "openai_compat" ? await dep.layEndpoint(db, model.keyId) : null;
      kq = await ncc.goi(daChe, dep.layKhoa(db, model.keyId, tinhTran, yc.dich.nhaCungCap), await dep.mang(db, tinhTran), { endpoint });
      break;
    } catch (e) {
      const loi = e instanceof LoiNgoai ? e : null;
      if (loi?.chuaGui) await huyGiuChuaGui(db, phieu).catch(() => undefined);
      else await ketToan(db, phieu, null).catch(() => undefined); // đã rời máy, không usage ⇒ giữ ước tính
      const loiDaChe = cheLoi(e);
      await ghiKq(yDinhId, { tokenVao: null, tokenRa: null, chiPhiUocUsd: null, ketCuc: "loi", maLoi: loiDaChe.ma });
      if (!loi?.thuLai || lan >= dep.soLanThu) throw loiDaChe;
      // (H3.1) backoff + jitter, tôn trọng `Retry-After`; nhà cung cấp xin chờ quá trần ⇒ dừng thử (không giữ chỗ lần nữa)
      const cho = choTruocLanThu(lan, loi.choMs, dep.ngauNhien);
      if (cho === null) throw loiDaChe;
      buoc("cho-thu-lai");
      await (dep.ngu ?? nguThat)(cho);
    }
  }
  // (10)
  buoc("ket-toan");
  const chiPhi =
    kq.tokenVao !== null && kq.tokenRa !== null && model.giaVaoUsdTrieu !== null && model.giaRaUsdTrieu !== null
      ? (kq.tokenVao * model.giaVaoUsdTrieu + kq.tokenRa * model.giaRaUsdTrieu) / 1e6
      : null;
  await ketToan(db, phieu, kq.tokenVao !== null && kq.tokenRa !== null ? { tokenVao: kq.tokenVao, tokenRa: kq.tokenRa, tienUsd: chiPhi } : null).catch(() => undefined);
  // (11) kiểm đầu ra: trần kích thước phản hồi (rà lô 2 mục 2) + toolCalls theo tập ĐÃ CẤP (rà mục 6)
  buoc("kiem-tool");
  try {
    if (Buffer.byteLength(kq.noiDung ?? "", "utf8") > TRAN_CHUOI_BYTE) throw new LoiNgoai("NGOAI_PHAN_HOI_QUA_LON");
    kiemToolCallTraVe(kq.toolCalls, daChe.congCu);
  } catch (e) {
    const loi = cheLoi(e);
    await ghiKq(yDinhId, { tokenVao: kq.tokenVao, tokenRa: kq.tokenRa, chiPhiUocUsd: chiPhi, ketCuc: "tu-choi", maLoi: loi.ma });
    throw loi;
  }
  // (12)
  buoc("so-ket-qua");
  // ★ 10.4b L0a' — băm câu trả lời (hàng ket-qua, WORM) ⇒ máy chủ xác minh dấu nguồn khi client lưu tin (`aiChat.saveStreamedMessage`).
  await ghiKq(yDinhId, { tokenVao: kq.tokenVao, tokenRa: kq.tokenRa, chiPhiUocUsd: chiPhi, ketCuc: "ok", bamTraLoi: bamCauTraLoi(kq.noiDung ?? "") });
  await luuNoiDungNeuBat(db, yDinhId, tinhTran, noiDungDaChe, cfg).catch(() => undefined);
  return { noiDung: kq.noiDung, toolCalls: kq.toolCalls, khongTinCay: true, tokenVao: kq.tokenVao, tokenRa: kq.tokenRa, chiPhiUocUsd: chiPhi, callId: yDinhId };
}
