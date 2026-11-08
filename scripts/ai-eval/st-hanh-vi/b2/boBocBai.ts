/**
 * ★ Đợt 12 B2 (dieu-phoi duyệt 03/11) — chấm HÀNH VI lời giải của 30 bài ST `plc-st-v1` (kho `scripts/ai-eval/ngau-nhien/kho/st-*`)
 * trên `vendor/oip-plc` (AST walker, qua `stHanhVi.ts`), song song bộ chấm chính thức (RuSTy / MATIEC). KHÔNG đổi điểm chính thức.
 *
 * Kịch bản ĐĂNG KÝ TRƯỚC: `kich-ban/<id>.json` viết + commit TRƯỚC khi chạy bất kỳ lời giải nào (luật dieu-phoi) — sau đó không sửa;
 * kịch bản sai ⇒ thêm mục `suaSau` (lý do + bước) RIÊNG, không lặng lẽ.
 *
 * Bộ bọc (chương trình ngầm của OIP) quanh khối chính `fb` của bài:
 *   VAR_GLOBAL G_NOW : TIME;        — đồng hồ của bộ chấm (đề: "đã khai báo sẵn, đọc trực tiếp")
 *   VAR_INPUT kb_dt : TIME; kb_<vào> …; VAR_OUTPUT kb_<ra> …; VAR fb : <Khối>;
 *   G_NOW := G_NOW + kb_dt;  fb(<vào> := kb_<vào>, …);  kb_<ra> := fb.<ra>;
 * Mỗi bước kịch bản = MỘT lần quét với `scan(dt)` = `dtMs` (TON / TOF / TP của OIP chạy theo dt; G_NOW tăng cùng bước) — như
 * `KT_BUOC(T#…); fb(…)` của tệp test ẩn. Chân ARRAY ⇒ một biến vô hướng mỗi phần tử (`kb_<ten>_<chỉ số>`).
 * TIME trong OIP là MILI giây (số); đề của bộ chấm RuSTy dùng nano giây 64 bit (`TIME_TO_LINT`) ⇒ lời giải dùng LINT bị OIP từ chối
 * (tập con) — tính riêng, KHÔNG tính model trượt.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const THU_MUC_NAY = path.dirname(fileURLToPath(import.meta.url));
import { chamKichBan, type BuocKichBan } from "../stHanhVi";

export const GOC_KHO = path.resolve(THU_MUC_NAY, "..", "..", "ngau-nhien", "kho");
export const THU_MUC_KICH_BAN = path.join(THU_MUC_NAY, "kich-ban");

export interface Chan {
  ten: string;
  kieu: string;
  /** ARRAY[lo..hi] OF T ⇒ chỉ số + kiểu phần tử */
  mang?: { lo: number; hi: number; kieu: string };
}

export interface GiaoDien {
  khoi: string;
  /** `fb` = FUNCTION_BLOCK (một thể hiện giữ trạng thái); `ham` = FUNCTION (giá trị trả về là "chân ra" mang tên hàm) */
  loai: "fb" | "ham";
  vao: Chan[];
  ra: Chan[];
}

export interface BuocBai {
  vao?: Record<string, boolean | number | Array<boolean | number>>;
  dtMs: number;
  lan?: number;
  ky?: Record<string, boolean | number | Array<boolean | number>>;
  nhan?: string;
}

export interface KichBanBai {
  id: string;
  khoi: string;
  /** nguồn đáp án: tệp test ẩn / đề — để kiem-dinh rà */
  nguon: string;
  /**
   * mỗi đoạn = MỘT thể hiện khối mới (biên dịch lại), như `fb` / `fb0` của tệp test ẩn. TIME trong `vao` / `ky` = MILI giây.
   * `ky`: chân ra (mảng = đủ phần tử) hoặc MỘT phần tử `"TEN[i]"`; khối là FUNCTION ⇒ giá trị trả về kiểm dưới tên hàm.
   */
  doan: Array<{ ten: string; buoc: BuocBai[] }>;
  /** sửa SAU khi đã chạy lời giải (luật đăng ký trước) — chỉ được THÊM, có lý do */
  suaSau?: Array<{ ngay: string; ly_do: string; buoc: number[] }>;
}

function khaiBao(khoiChu: string, phan: "VAR_INPUT" | "VAR_OUTPUT"): Chan[] {
  const ra: Chan[] = [];
  const re = new RegExp(`${phan}\\b([\\s\\S]*?)END_VAR`, "g");
  for (const m of khoiChu.matchAll(re)) {
    const than = m[1]!.replace(/\(\*[\s\S]*?\*\)/g, "");
    for (const cau of than.split(";")) {
      const t = cau.trim();
      if (!t) continue;
      const mm = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:\s*(.+?)(?:\s*:=.*)?$/s.exec(t);
      if (!mm) throw new Error(`khong doc duoc khai bao '${t}'`);
      const kieu = mm[2]!.trim();
      const mang = /^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(\w+)$/i.exec(kieu);
      for (const ten of mm[1]!.split(",").map((x) => x.trim()))
        ra.push({ ten, kieu, ...(mang ? { mang: { lo: Number(mang[1]), hi: Number(mang[2]), kieu: mang[3]!.toUpperCase() } } : {}) });
    }
  }
  return ra;
}

/** Giao diện khối chính đọc từ KHUNG của bài (không phải lời giải). */
export function docGiaoDien(id: string, khoi: string): GiaoDien {
  const bai = JSON.parse(fs.readFileSync(path.join(GOC_KHO, id, "bai.json"), "utf8")) as { tepGiai: string[] };
  for (const tep of bai.tepGiai) {
    const s = fs.readFileSync(path.join(GOC_KHO, id, "khung", tep), "utf8");
    const m = new RegExp(`FUNCTION_BLOCK\\s+${khoi}\\b([\\s\\S]*?)END_FUNCTION_BLOCK`).exec(s);
    if (m) return { khoi, loai: "fb", vao: khaiBao(m[1]!, "VAR_INPUT"), ra: khaiBao(m[1]!, "VAR_OUTPUT") };
    const h = new RegExp(`FUNCTION\\s+${khoi}\\s*:\\s*(\\w+)([\\s\\S]*?)END_FUNCTION\\b`).exec(s);
    if (h) return { khoi, loai: "ham", vao: khaiBao(h[2]!, "VAR_INPUT"), ra: [{ ten: khoi, kieu: h[1]!.toUpperCase() }] };
  }
  throw new Error(`${id}: khong thay FUNCTION_BLOCK / FUNCTION ${khoi} trong khung`);
}

const bien = (c: Chan, i?: number) => `kb_${c.ten}${i === undefined ? "" : `_${i < 0 ? `m${-i}` : i}`}`;
const chiSo = (c: Chan) => (c.mang ? Array.from({ length: c.mang.hi - c.mang.lo + 1 }, (_, k) => c.mang!.lo + k) : []);

/** Chương trình bọc (nối SAU mã lời giải). */
export function maBoBoc(g: GiaoDien): string {
  const khai = (ds: Chan[]) =>
    ds.flatMap((c) => (c.mang ? chiSo(c).map((i) => `${bien(c, i)} : ${c.mang!.kieu};`) : [`${bien(c)} : ${c.kieu};`])).join(" ");
  const vaoMang = g.vao.filter((c) => c.mang);
  const raMang = g.ra.filter((c) => c.mang);
  const dong: string[] = [];
  dong.push("VAR_GLOBAL G_NOW : TIME; END_VAR");
  dong.push(`VAR_INPUT kb_dt : TIME; ${khai(g.vao)} END_VAR`);
  if (g.ra.length) dong.push(`VAR_OUTPUT ${khai(g.ra)} END_VAR`);
  const mangPhu = [...vaoMang, ...raMang].map((c) => `kbm_${c.ten} : ${c.kieu};`).join(" ");
  if (g.loai === "fb") dong.push(`VAR fb : ${g.khoi}; ${mangPhu} END_VAR`);
  else if (mangPhu) dong.push(`VAR ${mangPhu} END_VAR`);
  dong.push("G_NOW := G_NOW + kb_dt;");
  for (const c of vaoMang) for (const i of chiSo(c)) dong.push(`kbm_${c.ten}[${i}] := ${bien(c, i)};`);
  const doiSo = g.vao.map((c) => `${c.ten} := ${c.mang ? `kbm_${c.ten}` : bien(c)}`);
  if (g.loai === "ham") {
    // FUNCTION: chỉ giá trị trả về ⇒ kb_<Tên hàm>. VAR_OUTPUT của hàm KHÔNG gán được trên OIP ("a FUNCTION has no outputs to bind
    // with =>") ⇒ không có trong giao diện kiểm (kịch bản kiểm chúng ⇒ `doiBuoc` báo lỗi tên chân).
    dong.push(`${bien(g.ra[0]!)} := ${g.khoi}(${doiSo.join(", ")});`);
    return dong.join("\n");
  }
  dong.push(`fb(${doiSo.join(", ")});`);
  for (const c of g.ra) {
    if (c.mang) {
      dong.push(`kbm_${c.ten} := fb.${c.ten};`);
      for (const i of chiSo(c)) dong.push(`${bien(c, i)} := kbm_${c.ten}[${i}];`);
    } else dong.push(`${bien(c)} := fb.${c.ten};`);
  }
  return dong.join("\n");
}

/** Bước kịch bản (tên chân của bài) ⇒ bước của `chamKichBan` (tên biến bọc). REAL so có dung sai ⇒ làm tròn hai phía 1e-4. */
export function doiBuoc(g: GiaoDien, b: BuocBai): BuocKichBan {
  const tim = (ds: Chan[], ten: string) => {
    const c = ds.find((x) => x.ten === ten);
    if (!c) throw new Error(`chan '${ten}' khong co trong giao dien ${g.khoi}`);
    return c;
  };
  const trai = (ds: Chan[], o: Record<string, boolean | number | Array<boolean | number>> | undefined) => {
    const ra: Record<string, boolean | number> = {};
    for (const [ten, v] of Object.entries(o ?? {})) {
      // MỘT phần tử của chân mảng: "TEN[i]"
      const pt = /^(\w+)\[(-?\d+)\]$/.exec(ten);
      if (pt) {
        const c = tim(ds, pt[1]!);
        const i = Number(pt[2]);
        if (!c.mang || !chiSo(c).includes(i) || Array.isArray(v)) throw new Error(`'${ten}' khong phai phan tu hop le cua mang ${c.ten}`);
        ra[bien(c, i)] = v;
        continue;
      }
      const c = tim(ds, ten);
      if (c.mang) {
        if (!Array.isArray(v) || v.length !== chiSo(c).length) throw new Error(`chan mang '${ten}' can ${chiSo(c).length} phan tu`);
        chiSo(c).forEach((i, k) => (ra[bien(c, i)] = v[k] as boolean | number));
      } else {
        if (Array.isArray(v)) throw new Error(`chan '${ten}' khong phai mang`);
        ra[bien(c)] = v;
      }
    }
    return ra;
  };
  return { vao: { ...trai(g.vao, b.vao), kb_dt: b.dtMs }, dt: b.dtMs / 1000, ...(b.lan ? { lan: b.lan } : {}), ky: trai(g.ra, b.ky), ...(b.nhan ? { nhan: b.nhan } : {}) };
}

export function docKichBan(id: string): KichBanBai {
  return JSON.parse(fs.readFileSync(path.join(THU_MUC_KICH_BAN, `${id}.json`), "utf8")) as KichBanBai;
}

export interface KetQuaBai {
  dat: boolean;
  /** lỗi biên dịch / quét của đoạn đầu tiên gặp lỗi (lỗi của lời giải HOẶC tập con OIP — báo cáo phân loại) */
  loi?: string;
  lech: Array<{ doan: string; buoc: number; nhan?: string; ten: string; ky: unknown; thuc: unknown }>;
  soKiem: number;
}

/** Chấm một lời giải (các tệp nguồn của bài, nối lại) theo kịch bản đã đăng ký — mọi đoạn. */
export function chamLoiGiai(kb: KichBanBai, nguon: string): KetQuaBai {
  const g = docGiaoDien(kb.id, kb.khoi);
  const kieuRa = new Map(g.ra.flatMap((c) => (c.mang ? chiSo(c).map((i) => [bien(c, i), c.mang!.kieu] as const) : [[bien(c), c.kieu.toUpperCase()] as const])));
  const lech: KetQuaBai["lech"] = [];
  let soKiem = 0;
  for (const d of kb.doan) {
    soKiem += d.buoc.reduce((s, b) => s + Object.keys(b.ky ?? {}).length, 0);
    const kq = chamKichBan(`${nguon}\n${maBoBoc(g)}`, d.buoc.map((b) => doiBuoc(g, b)));
    if (kq.loi) return { dat: false, loi: `${d.ten}: ${kq.loi}`, lech, soKiem };
    // REAL / LREAL: dung sai tương đối 1e-4 (tuyệt đối 1e-6 quanh 0)
    for (const l of kq.lech) {
      const k = kieuRa.get(l.ten);
      if ((k === "REAL" || k === "LREAL") && typeof l.ky === "number" && typeof l.thuc === "number" && Math.abs(l.ky - l.thuc) <= Math.max(1e-6, 1e-4 * Math.abs(l.ky))) continue;
      lech.push({ doan: d.ten, ...l, ten: l.ten.replace(/^kb_/, "") });
    }
  }
  return { dat: lech.length === 0, lech, soKiem };
}
