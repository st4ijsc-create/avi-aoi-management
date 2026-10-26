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
