/**
 * ★ Đợt 12 H4.2 (spec `docs/superpowers/specs/2026-10-31-h4-2-ghi-phat-lai-luot-agent.md`) — ĐÓNG GÓI bản ghi thô thành fixture và PHÁT LẠI
 * một lượt agent thật không GPU. Dùng chung cho lưới phát lại (do-model) và kịch bản tiêm lỗi H4.1 (kiem-dinh).
 *
 *   • `chuanHoaYeuCau` — yêu cầu engine ⇒ dạng so được: system ⇒ băm (không lưu chữ — đổi lời nhắc không vỡ fixture ở chế độ thường),
 *     định nghĩa tool ⇒ TÊN + băm, cờ nghĩ, mọi tin còn lại NGUYÊN VĂN sau khi thay đường gốc dự án / người dùng bằng token.
 *   • `dongGoi` — bản thô (`ghiLuotModel`) + hàng sổ lượt chạy ⇒ fixture: thay đường tuyệt đối, kiểm KHÔNG còn đường ổ đĩa / mẫu khoá
 *     (fail-closed: không tự xoá — dừng để người xem), gắn câu hỏi / chế độ / sự kiện kỳ vọng.
 *   • `taoStreamPhatLai` — `HamChatStream` giả: lượt k so yêu cầu THỰC (lõi + công cụ THẬT dựng) với lượt k đã ghi; khớp ⇒ phát lại đúng
 *     mảnh đã ghi; lệch ⇒ ghi `lech` + ném (chế độ chặt) — "lệch ở lượt n" = đã đổi byte gửi model ⇒ phải A/B ở cửa sổ GPU.
 *   • `chuanHoaSuKien` — sự kiện so được (UUID ⇒ `<ID#k>`, bỏ nhịp chờ / thời gian).
 * Phát lại kiểm HARNESS (lõi, cắt suy luận, gom tool call, hộp cát, sổ, sự kiện), KHÔNG đo chất lượng model.
 */
import { createHash } from "node:crypto";
import os from "node:os";
import type { GgufChatOptions, GgufStreamChunk } from "../services/aiGgufEngine";

/** 2 = tin của mỗi lượt lưu dạng HIỆU so với lượt trước (`tinChung` + `tinMoi`) — lịch sử chỉ-nối-thêm ⇒ fixture O(n) thay vì O(n²). */
export const PHIEN_BAN_FIXTURE = 2;
export const TOKEN_GOC = "<<GOC_DU_AN>>";
export const TOKEN_NGUOI = "<<NGUOI_DUNG>>";

const sha12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** Thay đường gốc (mọi biến thể `\` / `/`, hoa / thường ổ đĩa) và thư mục / tên người dùng Windows bằng token. */
export function taoBoThay(goc: string, nguoi: { home?: string; ten?: string } = { home: os.homedir(), ten: os.userInfo().username }): (s: string) => string {
  const bien = new Set<string>();
  for (const g of [goc, goc.replace(/\\/g, "/"), goc.replace(/\//g, "\\")]) {
    bien.add(g);
    if (/^[A-Za-z]:/.test(g)) {
      bien.add(g[0]!.toLowerCase() + g.slice(1));
      bien.add(g[0]!.toUpperCase() + g.slice(1));
    }
  }
  const goi = [...bien].filter(Boolean).sort((a, b) => b.length - a.length);
  const home = nguoi.home ? [nguoi.home, nguoi.home.replace(/\\/g, "/")] : [];
  const thoat = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reGoc = goi.length ? new RegExp(goi.map(thoat).join("|"), "g") : null;
  const reHome = home.length ? new RegExp(home.map(thoat).join("|"), "gi") : null;
  const reTen = nguoi.ten && nguoi.ten.length >= 3 ? new RegExp(`\\b${thoat(nguoi.ten)}\\b`, "g") : null;
  return (s) => {
    let r = reGoc ? s.replace(reGoc, TOKEN_GOC) : s;
    if (reHome) r = r.replace(reHome, TOKEN_NGUOI);
    if (reTen) r = r.replace(reTen, TOKEN_NGUOI);
    return r;
  };
}

export interface TinChuanHoa {
  role: string;
  content: string;
  tool_call_id?: string;
  name?: string;
  nghiTruoc?: string;
  tool_calls?: Array<{ id?: string; name: string; arguments: string }>;
}
export interface YeuCauChuanHoa {
  heThong: string;
  congCu: { ten: string[]; bam: string };
  co: { disableThinking: boolean; preserveThinking: boolean };
  tin: TinChuanHoa[];
}

export function chuanHoaYeuCau(o: GgufChatOptions, thay: (s: string) => string): YeuCauChuanHoa {
  const tools = ((o as { tools?: Array<{ function?: { name?: string } }> }).tools ?? []) as Array<{ function?: { name?: string } }>;
  return {
    heThong: sha12(thay(o.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"))),
    congCu: { ten: tools.map((t) => String(t.function?.name ?? "")), bam: sha12(thay(JSON.stringify(tools))) },
    co: { disableThinking: (o as { disableThinking?: boolean }).disableThinking === true, preserveThinking: (o as { preserveThinking?: boolean }).preserveThinking === true },
    tin: o.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: thay(String(m.content ?? "")),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...((m as { name?: string }).name ? { name: (m as { name?: string }).name } : {}),
        ...(m.nghiTruoc ? { nghiTruoc: thay(m.nghiTruoc) } : {}),
        ...(m.tool_calls?.length
          ? { tool_calls: m.tool_calls.map((t) => ({ ...(t.id ? { id: t.id } : {}), name: t.function.name, arguments: thay(String(t.function.arguments ?? "")) })) }
          : {}),
      })),
  };
}

/** Thay đệ quy MỌI chuỗi trong một giá trị JSON. */
function thayMoiChuoi<T>(v: T, thay: (s: string) => string): T {
  if (typeof v === "string") return thay(v) as T;
  if (Array.isArray(v)) return v.map((x) => thayMoiChuoi(x, thay)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, thayMoiChuoi(x, thay)])) as T;
  return v;
}

// ─── sự kiện ───────────────────────────────────────────────────────────────────────────────────

const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Loại sự kiện không tất định giữa hai lần chạy (vị trí hàng đợi, nhịp lưu). */
const BO_LOAI = new Set(["dang-cho-model"]);

export function chuanHoaSuKien(ds: readonly unknown[], thay: (s: string) => string = (s) => s): unknown[] {
  const ma = new Map<string, string>();
  const doiId = (s: string) => s.replace(RE_UUID, (u) => {
    const k = u.toLowerCase();
    if (!ma.has(k)) ma.set(k, `<ID#${ma.size + 1}>`);
    return ma.get(k)!;
  });
  const ra: unknown[] = [];
  for (const m of ds) {
    const e = (m && typeof m === "object" && "suKien" in m ? (m as { suKien: unknown }).suKien : m) as { loai?: string } | null;
    if (!e || BO_LOAI.has(String(e.loai))) continue;
    ra.push(thayMoiChuoi(e, (s) => doiId(thay(s))));
  }
  return ra;
}

// ─── fixture ───────────────────────────────────────────────────────────────────────────────────

/** Yêu cầu một lượt trong fixture: như `YeuCauChuanHoa` nhưng `tin` = `tinChung` tin đầu của lượt TRƯỚC + `tinMoi`. */
export type YeuCauHieu = Omit<YeuCauChuanHoa, "tin"> & { tinChung: number; tinMoi: TinChuanHoa[] };

export interface LuotFixture {
  n: number;
  yeuCau: YeuCauHieu;
  manh: GgufStreamChunk[];
  loi?: string;
}
export interface FixturePhatLai {
  phienBan: number;
  dau: { ngay: string; node: string; nguon: string; bai?: string; dist?: string; model?: string | null };
  lenh: { cauHoi: string; cheDo: string; duAnTuongDoi: string; commit?: string };
  luot: LuotFixture[];
  ky: { suKien: unknown[]; lyDo: string | null; dat?: boolean | null };
}

/** Đầy đủ ⇒ hiệu: mỗi lượt giữ số tin đầu TRÙNG lượt trước + phần mới. */
function thanhHieu(ds: Array<Omit<LuotFixture, "yeuCau"> & { yeuCau: YeuCauChuanHoa }>): LuotFixture[] {
  let truoc: TinChuanHoa[] = [];
  return ds.map((l) => {
    const { tin, ...con } = l.yeuCau;
    let k = 0;
    while (k < tin.length && k < truoc.length && JSON.stringify(tin[k]) === JSON.stringify(truoc[k])) k++;
    truoc = tin;
    return { ...l, yeuCau: { ...con, tinChung: k, tinMoi: tin.slice(k) } };
  });
}

/** Hiệu ⇒ đầy đủ (theo thứ tự lượt). */
export function moRongYeuCau(fx: FixturePhatLai): YeuCauChuanHoa[] {
  let truoc: TinChuanHoa[] = [];
  return fx.luot.map((l) => {
    const { tinChung, tinMoi, ...con } = l.yeuCau;
    const tin = [...truoc.slice(0, tinChung), ...tinMoi];
    truoc = tin;
    return { ...con, tin };
  });
}

/** Mẫu không được còn trong fixture sau khi thay (fail-closed). */
const MAU_CAM: ReadonlyArray<[string, RegExp]> = [
  ["duong-o-dia", /\b[A-Za-z]:[\\/][^\s"'<>]{2,}/],
  ["unc", /\\\\[A-Za-z0-9._-]+\\[^\s"']+/],
  ["thu-muc-nguoi-dung", /[\\/](Users|home)[\\/][^\\/\s"']+/i],
  ["khoa-openai", /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/],
  ["khoa-anthropic", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["khoa-aws", /\bAKIA[0-9A-Z]{16}\b/],
  ["khoa-github", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["khoa-rieng", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

export function kiemMauCam(s: string): string[] {
  return MAU_CAM.filter(([, re]) => re.test(s)).map(([ten]) => ten);
}

/**
 * Bản thô (các dòng JSON của `ghiLuotModel`) + thông tin lượt chạy ⇒ fixture. NÉM khi còn mẫu cấm sau khi thay (không tự xoá: người đóng gói
 * phải xem — có thể là bí mật thật trong dự án mẫu).
 */
export function dongGoi(
  dongTho: readonly Record<string, unknown>[],
  y: {
    goc: string;
    duAnTuongDoi: string;
    cauHoi: string;
    cheDo: string;
    suKien: readonly unknown[];
    lyDo: string | null;
    dat?: boolean | null;
    bai?: string;
    dist?: string;
    commit?: string;
    nguoi?: { home?: string; ten?: string };
  },
): FixturePhatLai {
  const thay = taoBoThay(y.goc, y.nguoi);
  const dau = dongTho.find((d) => d.loai === "dau") as { ngay?: string; node?: string } | undefined;
  const luotTho = dongTho.filter((d) => d.loai === "luot") as Array<{ n: number; modelId?: string | null; options: GgufChatOptions; manh: GgufStreamChunk[]; loi?: string }>;
  const fx: FixturePhatLai = {
    phienBan: PHIEN_BAN_FIXTURE,
    dau: { ngay: String(dau?.ngay ?? ""), node: String(dau?.node ?? ""), nguon: "ghiLuotModel", ...(y.bai ? { bai: y.bai } : {}), ...(y.dist ? { dist: y.dist } : {}), model: luotTho[0]?.modelId ?? null },
    lenh: { cauHoi: thay(y.cauHoi), cheDo: y.cheDo, duAnTuongDoi: y.duAnTuongDoi, ...(y.commit ? { commit: y.commit } : {}) },
    luot: thanhHieu(
      luotTho
        .sort((a, b) => a.n - b.n)
        .map((l) => ({ n: l.n, yeuCau: chuanHoaYeuCau(l.options, thay), manh: thayMoiChuoi(l.manh, thay), ...(l.loi ? { loi: thay(l.loi) } : {}) })),
    ),
    ky: { suKien: chuanHoaSuKien(y.suKien, thay), lyDo: y.lyDo, ...(y.dat !== undefined ? { dat: y.dat } : {}) },
  };
  const s = JSON.stringify(fx);
  const cam = kiemMauCam(s);
  if (cam.length) throw new Error(`fixture còn mẫu cấm sau khi thay: ${cam.join(", ")} — xem bản thô, không commit`);
  return fx;
}

// ─── phát lại ──────────────────────────────────────────────────────────────────────────────────

export interface LechPhatLai {
  n: number;
  truong: string;
  ghi: unknown;
  thuc: unknown;
}

type HamStream = (options: GgufChatOptions, modelId?: string, signal?: AbortSignal) => AsyncIterable<GgufStreamChunk>;

/** So hai yêu cầu chuẩn hoá: trả trường lệch ĐẦU TIÊN (chuỗi đường dẫn) hoặc null. `soHeThong` ⇒ so cả băm system + định nghĩa tool. */
export function soYeuCau(ghi: YeuCauChuanHoa, thuc: YeuCauChuanHoa, soHeThong = false): LechPhatLai | null {
  const lech = (truong: string, a: unknown, b: unknown): LechPhatLai => ({ n: 0, truong, ghi: a, thuc: b });
  if (soHeThong && ghi.heThong !== thuc.heThong) return lech("heThong", ghi.heThong, thuc.heThong);
  if (soHeThong && ghi.congCu.bam !== thuc.congCu.bam) return lech("congCu.bam", ghi.congCu.bam, thuc.congCu.bam);
  if (JSON.stringify(ghi.congCu.ten) !== JSON.stringify(thuc.congCu.ten)) return lech("congCu.ten", ghi.congCu.ten, thuc.congCu.ten);
  if (JSON.stringify(ghi.co) !== JSON.stringify(thuc.co)) return lech("co", ghi.co, thuc.co);
  if (ghi.tin.length !== thuc.tin.length) return lech("tin.length", ghi.tin.length, thuc.tin.length);
  for (let i = 0; i < ghi.tin.length; i++) {
    const a = JSON.stringify(ghi.tin[i]);
    const b = JSON.stringify(thuc.tin[i]);
    if (a !== b) return lech(`tin[${i}]`, ghi.tin[i], thuc.tin[i]);
  }
  return null;
}

export class LoiLechPhatLai extends Error {
  constructor(readonly lech: LechPhatLai) {
    super(`phát lại LỆCH ở lượt ${lech.n}: ${lech.truong}`);
    this.name = "LoiLechPhatLai";
  }
}

/**
 * `HamChatStream` phát lại. `goc` = thư mục dự án của LẦN PHÁT (thay bằng token khi so, đổi token về đường này trong mảnh phát ra).
 * `chat` (mặc định true): lệch ⇒ ném `LoiLechPhatLai`; `false` (chẩn đoán) ⇒ chỉ ghi `lech` rồi vẫn phát mảnh đã ghi.
 */
export function taoStreamPhatLai(fx: FixturePhatLai, o: { goc: string; chat?: boolean; soHeThong?: boolean; nguoi?: { home?: string; ten?: string } }) {
  const thay = taoBoThay(o.goc, o.nguoi);
  const veGoc = (s: string) => s.split(TOKEN_GOC).join(o.goc);
  const lech: LechPhatLai[] = [];
  const day = moRongYeuCau(fx);
  let k = 0;
  const stream: HamStream = async function* (options) {
    const l = fx.luot[k++];
    if (!l) {
      const e: LechPhatLai = { n: k, truong: "thua-luot", ghi: fx.luot.length, thuc: k };
      lech.push(e);
      throw new LoiLechPhatLai(e);
    }
    const d = soYeuCau(day[k - 1]!, chuanHoaYeuCau(options, thay), o.soHeThong === true);
    if (d) {
      d.n = l.n;
      lech.push(d);
      if (o.chat !== false) throw new LoiLechPhatLai(d);
    }
    for (const c of l.manh) yield thayMoiChuoi(c, veGoc);
    if (l.loi) throw new Error(veGoc(l.loi));
  };
  return { stream, lech, conLai: () => fx.luot.length - k };
}
