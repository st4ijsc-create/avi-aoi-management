/**
 * ★ Đợt 10.3 B3 — DUYỆT luồng có node dùng model AI NGOÀI (rà kiem-dinh mục 7, dieu-phoi): MỖI phiên bản duyệt riêng VÀ lúc bật so băm
 * định nghĩa ĐẦY ĐỦ (cả đồ thị — thêm một nhánh `ot.doc-tag` sau khi duyệt ⇒ băm lệch ⇒ phải duyệt lại). Toạ độ vẽ (`position`) không
 * vào băm (kéo node không bắt duyệt lại). Luồng toàn hệ thống (`factoryId` NULL) có node ngoài ⇒ không bật được.
 */
import { createHash } from "node:crypto";
import type { FlowDefinition } from "../../../../shared/flow/model";
import { LoiNgoai } from "./loi";

/** Có node nào chọn model ngoài (`thamSo.chonModel` bắt đầu bằng `ngoai:`) không. */
export function coNodeNgoai(def: FlowDefinition): boolean {
  return (def.nodes ?? []).some((n) => {
    const c = (n.parameters as Record<string, unknown> | undefined)?.chonModel;
    return typeof c === "string" && c.startsWith("ngoai:");
  });
}

function chuanHoa(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(chuanHoa);
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, chuanHoa(o[k])]),
  );
}

/** sha256 hex của định nghĩa đã chuẩn hoá (khoá sắp xếp; bỏ `position` của node và trường `version`). */
export function bamDinhNghia(def: FlowDefinition): string {
  const { version: _bo, ...goc } = def as FlowDefinition & { version?: unknown };
  const sach = { ...goc, nodes: (def.nodes ?? []).map(({ position: _p, ...n }) => n) };
  return createHash("sha256").update(JSON.stringify(chuanHoa(sach)), "utf8").digest("hex");
}

export interface PhienBanDuyet {
  definition: unknown;
  ngoaiDuyetLuc: Date | string | null;
  ngoaiBamDuyet: string | null;
}

/**
 * Kiểm TRƯỚC KHI BẬT: không có node ngoài ⇒ qua. Có ⇒ luồng phải thuộc nhà máy, phiên bản phải đã duyệt ngoài và băm duyệt khớp
 * băm định nghĩa hiện tại. Ném `LoiNgoai` (router đổi sang lỗi tRPC).
 */
export function kiemDuyetNgoaiTruocKhiBat(v: PhienBanDuyet, factoryIdLuong: number | null): void {
  const def = v.definition as FlowDefinition;
  if (!coNodeNgoai(def)) return;
  if (factoryIdLuong === null) throw new LoiNgoai("NGOAI_LUONG_TOAN_CUC");
  if (!v.ngoaiDuyetLuc || !v.ngoaiBamDuyet) throw new LoiNgoai("NGOAI_CHUA_DUYET");
  if (v.ngoaiBamDuyet !== bamDinhNghia(def)) throw new LoiNgoai("NGOAI_CHUA_DUYET", "bam-lech");
}

/** ★ Đợt 10.4 (D8, T5) — tóm tắt ĐANG DUYỆT GÌ cho màn duyệt: `flow.chiTiet.ngoai`. */
export type TomTatNgoaiPhienBan =
  | { coNodeNgoai: false }
  | {
      coNodeNgoai: true;
      /** Đã duyệt VÀ băm duyệt khớp định nghĩa hiện tại. */
      daDuyet: boolean;
      duyetBoi?: number;
      duyetLuc?: string;
      tuDuyet: boolean;
      /** Luồng toàn hệ thống (`factoryId` NULL) ⇒ model ngoài KHÔNG BAO GIỜ dùng được. */
      toanHeThong: boolean;
      taoBoi: number | null;
      /** Mức tĩnh của CẢ luồng (gồm luồng con ghim) — `van-hanh` ⇒ tự duyệt bị cấm. */
      mucTinhLuong: "ky-thuat" | "van-hanh";
      nodes: Array<{
        nodeId: string;
        nhaCungCap: string;
        model: string;
        mucTinh: "ky-thuat" | "van-hanh" | "ke-thua";
        /** Lời nhắc / tiêu chí ĐÃ CHE, tối đa `TRAN_TOM_TAT_LENH` ký tự (đủ để người duyệt đọc hết biểu thức). */
        tomTatLenh: string;
        /** Mọi tham chiếu dữ liệu (`$json…`, `$node(…)`, `$input…`) trong MỌI tham số chuỗi của node — thứ sẽ được ghép vào lời nhắc. */
        thamChieu: string[];
      }>;
    };

const THAM_SO_LENH = ["loiNhac", "tieuChi", "lenh", "prompt", "cauHoi", "moTa"] as const;
export const TRAN_TOM_TAT_LENH = 4000;
/** Biến của ngôn ngữ biểu thức (`shared/flow/bieuThuc.ts`): `$json` · `$input` · `$env` · `$run` · `$node("…")`, kèm chuỗi truy cập theo sau. */
const RE_THAM_CHIEU = /\$(?:(?:json|input|env|run)(?![\w$])|node\s*\(\s*["'][^"'\n]{1,80}["']\s*\))(?:\.[A-Za-z_$][\w$]*|\[[^\]\n]{1,80}\])*/g;
function thamChieuCua(t: Record<string, unknown>, che: (s: string) => string): string[] {
  const ra = new Set<string>();
  const duyet = (v: unknown, sau: number): void => {
    if (sau > 4 || ra.size >= 50) return;
    if (typeof v === "string") for (const m of v.matchAll(RE_THAM_CHIEU)) ra.add(che(m[0]).slice(0, 120));
    else if (Array.isArray(v)) v.forEach((x) => duyet(x, sau + 1));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => duyet(x, sau + 1));
  };
  for (const [k, v] of Object.entries(t)) if (k !== "chonModel") duyet(v, 0);
  return [...ra];
}

export async function tomTatNgoaiPhienBan(
  v: { definition: unknown; ngoaiDuyetLuc: Date | string | null; ngoaiBamDuyet: string | null; ngoaiDuyetBoi: number | null; ngoaiTuDuyet: boolean; createdBy: number | null },
  factoryIdLuong: number | null,
  docCon: (flowId: string, version: number) => Promise<FlowDefinition | null>,
): Promise<TomTatNgoaiPhienBan> {
  const def = v.definition as FlowDefinition;
  if (!def || !coNodeNgoai(def)) return { coNodeNgoai: false };
  const [{ cheChuoi }, { mucNguonNut, mucTinhCuaDinhNghia }] = await Promise.all([import("./cheDuLieu"), import("./phanLoai")]);
  const nodes = (def.nodes ?? [])
    .filter((n) => typeof (n.parameters as Record<string, unknown> | undefined)?.chonModel === "string" && String((n.parameters as Record<string, unknown>).chonModel).startsWith("ngoai:"))
    .map((n) => {
      const t = (n.parameters ?? {}) as Record<string, unknown>;
      const [, nhaCungCap = "", ...m] = String(t.chonModel).split(":");
      const lenh = THAM_SO_LENH.map((k) => t[k]).find((x): x is string => typeof x === "string" && x.trim().length > 0) ?? "";
      // tóm tắt SAU bộ che — màn duyệt không bao giờ hiện khoá / mật khẩu viết trong lời nhắc
      return {
        nodeId: n.id,
        nhaCungCap,
        model: m.join(":"),
        mucTinh: mucNguonNut(n.type),
        tomTatLenh: String(cheChuoi(lenh).giaTri).slice(0, TRAN_TOM_TAT_LENH),
        thamChieu: thamChieuCua(t, (s) => String(cheChuoi(s).giaTri)),
      };
    });
  let mucTinhLuong: "ky-thuat" | "van-hanh";
  try {
    mucTinhLuong = await mucTinhCuaDinhNghia(def, docCon);
  } catch {
    mucTinhLuong = "van-hanh";
  }
  let daDuyet = false;
  try {
    kiemDuyetNgoaiTruocKhiBat(v, factoryIdLuong);
    daDuyet = true;
  } catch {
    daDuyet = false;
  }
  const luc = v.ngoaiDuyetLuc ? new Date(v.ngoaiDuyetLuc).toISOString() : undefined;
  return {
    coNodeNgoai: true,
    daDuyet,
    ...(v.ngoaiDuyetBoi !== null ? { duyetBoi: v.ngoaiDuyetBoi } : {}),
    ...(luc ? { duyetLuc: luc } : {}),
    tuDuyet: v.ngoaiTuDuyet,
    toanHeThong: factoryIdLuong === null,
    taoBoi: v.createdBy,
    mucTinhLuong,
    nodes,
  };
}
