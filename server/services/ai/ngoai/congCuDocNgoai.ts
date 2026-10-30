/**
 * ★ Đợt 10.4b (L2 → dùng chung L3) — bộ tool ĐỌC cho model NGOÀI: tập tool quảng bá + thực thi qua deny-list
 * `shared/aiNgoaiDenyList` (đường ĐÃ GIẢI `duongThuc`) RỒI hộp cát máy chủ; kết quả lọc theo đường THẬT; trần byte / số tệp mỗi run.
 * Tách từ `routes/codingNgoai.ts` để màn lập trình (L2) và agent máy chủ (L3) dùng ĐÚNG MỘT bộ.
 */
import { promises as fsp } from "node:fs";
import path from "node:path";
import { giaiThuMucNgoai, giaiTepNgoai, laNoiDungNhiPhan, locKetQuaTimNgoaiThuc, TRAN_BYTE_TEP_NGOAI, type ChamDia } from "../../../../shared/aiNgoaiDenyList";
import type { CongCuNgoai } from "./nhaCungCap/kieu";

export const TOOL_DOC_NGOAI: readonly CongCuNgoai[] = Object.freeze([
  {
    ten: "read_file",
    moTa: "Đọc nội dung một tệp mã nguồn trong dự án (đường dẫn TƯƠNG ĐỐI so với gốc dự án). Tệp bí mật / dữ liệu / ngoài dự án bị từ chối.",
    schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    ten: "list_files",
    moTa: "Liệt kê tệp / thư mục trong dự án (đường dẫn TƯƠNG ĐỐI; bỏ trống = gốc), depth 1..3.",
    schema: { type: "object", properties: { path: { type: "string" }, depth: { type: "integer", minimum: 1, maximum: 3 } }, additionalProperties: false },
  },
  {
    ten: "grep_repo",
    moTa: "Tìm một biểu thức chính quy trong mã nguồn dự án; trả đường dẫn + số dòng + dòng khớp.",
    schema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"], additionalProperties: false },
  },
]);
export interface NguoiGoi {
  id: number;
  role?: string | null;
}

export interface TrongThaiDoc {
  byte: number;
  tep: number;
  tranByte: number;
  tranTep: number;
}

export interface KetQuaTool {
  ok: boolean;
  path?: string;
  maTuChoi?: string;
  /** Văn bản đưa lại model (đã qua deny-list + hộp cát + bộ che của tool). */
  noiDung: string;
}

const catChu = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[đã cắt ${s.length - n} ký tự]` : s);

/** Một tool ĐỌC cho model ngoài: deny-list (đường ĐÃ GIẢI) ⇒ hộp cát máy chủ ⇒ lọc kết quả theo đường THẬT ⇒ trần byte / số tệp. */
export async function chayToolDocNgoai(
  ten: string,
  thamSo: Record<string, unknown>,
  o: { goc: string; user: NguoiGoi; doc: TrongThaiDoc },
  dep: { realpath: ChamDia["realpath"]; thucThi: (tool: string, args: Record<string, unknown>) => Promise<{ data?: unknown; textSummary?: string } | null> },
): Promise<KetQuaTool> {
  const cd: ChamDia = { goc: o.goc, realpath: dep.realpath };
  const tuChoi = (ma: string, p?: string): KetQuaTool => ({ ok: false, ...(p ? { path: p } : {}), maTuChoi: ma, noiDung: `[TỪ CHỐI ${ma}${p ? ` ${p}` : ""}]` });
  const gocThuc = await dep.realpath(o.goc).catch(() => o.goc);
  const tuongDoi = (thuc: string) => path.relative(gocThuc, thuc).split(path.sep).join("/") || ".";
  if (ten === "read_file") {
    const p = typeof thamSo.path === "string" ? thamSo.path : "";
    if (o.doc.tep >= o.doc.tranTep) return tuChoi("TRAN_SO_TEP", p);
    const g = await giaiTepNgoai(p, cd);
    if (!g.ok) return tuChoi(g.ma, p);
    const rel = tuongDoi(g.duongThuc);
    const kq = await dep.thucThi("read_file", { path: rel, maxBytes: TRAN_BYTE_TEP_NGOAI });
    const data = (kq?.data ?? {}) as { content?: string | null };
    const noiDung = typeof data.content === "string" ? data.content : "";
    if (!noiDung) return tuChoi(String((kq as { note?: string } | null)?.note ?? "READ_ERROR"), rel);
    if (laNoiDungNhiPhan(noiDung)) return tuChoi("NHI_PHAN", rel);
    const b = Buffer.byteLength(noiDung, "utf8");
    if (o.doc.byte + b > o.doc.tranByte) return tuChoi("TRAN_BYTE_DOC", rel);
    o.doc.byte += b;
    o.doc.tep += 1;
    return { ok: true, path: rel, noiDung: `<<<TEP ${rel}\n${noiDung.replace(/<<<|>>>/g, "‹‹‹")}\n>>>` };
  }
  if (ten === "list_files" || ten === "grep_repo") {
    const p = typeof thamSo.path === "string" ? thamSo.path : "";
    const g = await giaiThuMucNgoai(p, cd);
    if (!g.ok) return tuChoi(g.ma, p || ".");
    const rel = tuongDoi(g.duongThuc);
    const args: Record<string, unknown> =
      ten === "list_files"
        ? { ...(rel !== "." ? { path: rel } : {}), ...(typeof thamSo.depth === "number" ? { depth: Math.min(3, Math.max(1, thamSo.depth)) } : {}) }
        : { pattern: String(thamSo.pattern ?? "").slice(0, 200), ...(rel !== "." ? { path: rel } : {}) };
    const kq = await dep.thucThi(ten, args);
    const data = (kq?.data ?? {}) as { entries?: Array<{ path: string; kind: string }>; matches?: Array<{ path: string; line: number; text: string }> };
    let dong: string[];
    let boDi = 0;
    if (ten === "list_files") {
      const ds = data.entries ?? [];
      const tep = ds.filter((e) => e.kind !== "dir");
      const tm = ds.filter((e) => e.kind === "dir");
      const loc = await locKetQuaTimNgoaiThuc(tep, (e) => e.path, cd);
      const tmGiu: typeof tm = [];
      for (const d of tm) if ((await giaiThuMucNgoai(d.path, cd)).ok) tmGiu.push(d);
      boDi = loc.soBoDi + (tm.length - tmGiu.length);
      dong = [...tmGiu.map((d) => `${d.path}/`), ...loc.giu.map((e) => e.path)];
    } else {
      const loc = await locKetQuaTimNgoaiThuc(data.matches ?? [], (m) => m.path, cd);
      boDi = loc.soBoDi;
      dong = loc.giu.map((m) => `${m.path}:${m.line}: ${m.text}`);
    }
    let noiDung = dong.join("\n") + (boDi ? `\n[${boDi} mục bị ẩn — tệp/thư mục cấm với AI ngoài]` : "");
    noiDung = catChu(noiDung, 16_000);
    const b = Buffer.byteLength(noiDung, "utf8");
    if (o.doc.byte + b > o.doc.tranByte) return tuChoi("TRAN_BYTE_DOC", rel);
    o.doc.byte += b;
    return { ok: true, path: rel, noiDung };
  }
  return tuChoi("NGOAI_TOOL_KHONG_CAP");
}

/** Thực thi THẬT: deny-list ⇒ `executeDecision` (hộp cát aiLocalTools) với gốc dự án đã phân giải. */
export async function chayToolDocNgoaiThat(ten: string, thamSo: Record<string, unknown>, o: { goc: string; user: NguoiGoi; doc: TrongThaiDoc }): Promise<KetQuaTool> {
  const { executeDecision } = await import("../../aiLocalTools");
  return chayToolDocNgoai(ten, thamSo, o, {
    realpath: (p) => fsp.realpath(p),
    thucThi: async (tool, args) => {
      const out = await executeDecision(
        { tool, args },
        { user: { id: o.user.id, role: String(o.user.role ?? "") }, lang: "vi", projectRoot: o.goc } as never,
      );
      return (out.result as { data?: unknown; textSummary?: string } | null) ?? null;
    },
  });
}
