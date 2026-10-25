/**
 * ★★★ Luồng AI — XUẤT / NHẬP luồng giữa các nhà máy (lô nhập/xuất, 2026-10-25; dieu-phoi duyệt). THUẦN (không DB) trừ `dauVetNhaMay`.
 *
 * Nguyên tắc: gói xuất KHÔNG BAO GIỜ mang theo thứ thuộc nhà máy gốc, và NHẬP không tin gói (làm sạch lại y như xuất).
 *   • cấp node: `credentialRef` luôn bị xoá; tham số khai ở `THAM_SO_THEO_NHA_MAY` (phamViNut.ts) bị đưa về chỗ trống (biểu thức `{{ … }}` giữ nguyên);
 *   • cấp luồng: id · tên nhà máy · chủ · `settings.errorFlowId` · `pinData` (dữ liệu ghim thật) bị bỏ; id luồng đặt lại lúc nhập;
 *   • văn bản tự do (prompt, nội dung, tiêu đề, tên node…) có thể chứa mã máy / tên nhà máy / tên người của nhà máy gốc viết tay ⇒ `quetVanBan` chỉ CẢNH BÁO
 *     (vị trí node + trường), KHÔNG tự xoá (tránh làm hỏng prompt); cảnh báo trả cho người xuất xem TRƯỚC khi tải và KHÔNG nằm trong tệp gói;
 *   • gói: { dinhDang: "luong-ai/1", luong, viecPhaiDien, bam } — `bam` = sha256 nội dung `luong` (phát hiện sửa tay; thiếu/lệch ⇒ chỉ cảnh báo ở bước xem trước, không phải chữ ký).
 * Nhập đi qua ĐÚNG đường `flow.luu` (kiểm luồng, kiểm tham số, gán nhà máy, hạng tính lại ở máy chủ).
 */
import { createHash } from "node:crypto";
import { FlowDefinitionSchema, type FlowDefinition, type NodeInstance } from "../../../shared/flow/model";
import { THAM_SO_THEO_NHA_MAY, type ThamSoNhaMay } from "./phamViNut";

export const DINH_DANG_GOI = "luong-ai/1";
export const TRAN_BYTE_GOI = 256 * 1024;
export const TRAN_NODE_GOI = 100;

export type LoaiViec = ThamSoNhaMay["viec"] | "bi-mat" | "luong-loi";
export interface ViecPhaiDien {
  nodeId: string;
  truong: string;
  viec: LoaiViec;
}

const laBieuThuc = (v: unknown): boolean => typeof v === "string" && v.includes("{{");
const trong = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** JSON ổn định (khoá sắp xếp) để băm. */
export function jsonOnDinh(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonOnDinh).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonOnDinh(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
export const bamLuong = (luong: unknown): string => createHash("sha256").update(jsonOnDinh(luong), "utf8").digest("hex");

function lamTrongNut(n: NodeInstance, viec: ViecPhaiDien[]): NodeInstance {
  // Node GỌI LUỒNG CON không lưu được khi id con trống (id con phải CỐ ĐỊNH và tồn tại) ⇒ thay bằng node giữ chỗ `du-lieu.dat` (cùng id/tên/cổng) để luồng vẫn nhập được; người nhập thay lại bằng node luồng con.
  if (n.type === "luong.goi-con") {
    viec.push({ nodeId: n.id, truong: "flowId", viec: "luong-con" });
    return { id: n.id, type: "du-lieu.dat", typeVersion: 1, name: `[Chọn lại luồng con] ${n.name}`.slice(0, 120), position: n.position, parameters: { truong: {} }, ...(n.disabled ? { disabled: true } : {}) };
  }
  const ra: NodeInstance = { ...n, parameters: { ...(n.parameters ?? {}) } };
  if (ra.credentialRef !== undefined) {
    viec.push({ nodeId: ra.id, truong: "credentialRef", viec: "bi-mat" });
    delete ra.credentialRef;
    delete ra.parameters.kieuXacThuc; // đi cùng bí mật
  }
  for (const d of THAM_SO_THEO_NHA_MAY[ra.type]?.truong ?? []) {
    const cu = ra.parameters[d.truong];
    if (d.thanh === "luong-con") {
      if (Array.isArray(cu) && cu.length > 0) {
        ra.parameters[d.truong] = [];
        viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
      }
      continue;
    }
    if (d.thanh === "tat") {
      if (cu === true || laBieuThuc(cu)) viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
      ra.parameters[d.truong] = false;
      continue;
    }
    if (laBieuThuc(cu)) continue; // biểu thức không phải ID
    if (!trong(cu) || d.thanh === "bo") {
      if (!trong(cu)) viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
      if (d.thanh === "bo") delete ra.parameters[d.truong];
      else ra.parameters[d.truong] = d.thanh === "mang-rong" ? [] : "";
    } else if (!(d.truong in ra.parameters)) {
      // đã trống từ đầu: vẫn là việc phải điền (người nhập cần chọn)
      viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
    }
  }
  // việc còn thiếu (nhập): node loại này có khai trường mang id mà giá trị đang TRỐNG ⇒ phải điền
  for (const d of THAM_SO_THEO_NHA_MAY[ra.type]?.truong ?? []) {
    if (d.thanh === "tat" || d.thanh === "bo" || d.thanh === "luong-con") continue;
    const v = ra.parameters[d.truong];
    if (!laBieuThuc(v) && trong(v) && !viec.some((x) => x.nodeId === ra.id && x.truong === d.truong)) viec.push({ nodeId: ra.id, truong: d.truong, viec: d.viec });
  }
  return ra;
}

/** Luồng SẠCH (không id/bí mật/dữ liệu ghim) + danh sách việc phải điền. Node luồng-con/agent có tham chiếu bị đưa về trống (xem THAM_SO_THEO_NHA_MAY). */
export function lamSachLuong(def: FlowDefinition): { luong: FlowDefinition; viec: ViecPhaiDien[] } {
  const viec: ViecPhaiDien[] = [];
  const nodes = def.nodes.map((n) => lamTrongNut(n, viec));
  const settings = { ...def.settings };
  if (settings.errorFlowId !== undefined) {
    viec.push({ nodeId: "(luồng)", truong: "settings.errorFlowId", viec: "luong-loi" });
    delete settings.errorFlowId;
  }
  const luong: FlowDefinition = { id: "luong-nhap", name: def.name, version: 1, nodes, connections: def.connections, settings };
  return { luong, viec };
}

// ── quét văn bản tự do ───────────────────────────────────────────────────────────────────────────

export interface DauVetNhaMay {
  maMay: string[];
  nhaMay: string[];
  nguoi: string[];
}
export interface CanhBaoVanBan {
  nodeId: string;
  truong: string;
  loai: "ma-may" | "nha-may" | "nguoi-dung";
  khop: string;
}

const thoat = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function* duyetChuoi(v: unknown, duong: string): Generator<[string, string]> {
  if (typeof v === "string") yield [duong, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* duyetChuoi(v[i], `${duong}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) yield* duyetChuoi(x, duong ? `${duong}.${k}` : k);
}

/** Quét MỌI chuỗi của luồng (tên luồng, tên node, tham số) với dấu vết nhà máy nguồn (token ≥ 3 ký tự, khớp nguyên từ, không phân biệt hoa thường). Chỉ cảnh báo. */
export function quetVanBan(def: FlowDefinition, dau: DauVetNhaMay, tran = 200): CanhBaoVanBan[] {
  const bo: { loai: CanhBaoVanBan["loai"]; re: RegExp; khop: string }[] = [];
  const them = (loai: CanhBaoVanBan["loai"], ds: string[]) => {
    for (const t of new Set(ds.map((x) => x.trim()).filter((x) => x.length >= 3))) {
      bo.push({ loai, khop: t, re: new RegExp(`(^|[^\\p{L}\\p{N}])${thoat(t)}($|[^\\p{L}\\p{N}])`, "iu") });
    }
  };
  them("ma-may", dau.maMay);
  them("nha-may", dau.nhaMay);
  them("nguoi-dung", dau.nguoi);
  const ra: CanhBaoVanBan[] = [];
  const xet = (nodeId: string, truong: string, chu: string) => {
    for (const b of bo) {
      if (ra.length >= tran) return;
      if (b.re.test(chu)) ra.push({ nodeId, truong, loai: b.loai, khop: b.khop });
    }
  };
  xet("(luồng)", "name", def.name);
  for (const n of def.nodes) {
    xet(n.id, "name", n.name);
    for (const [duong, chu] of duyetChuoi(n.parameters, "parameters")) xet(n.id, duong, chu);
  }
  return ra;
}

// ── gói ────────────────────────────────────────────────────────────────────────────────────────────

export interface GoiLuong {
  dinhDang: string;
  luong: FlowDefinition;
  viecPhaiDien: ViecPhaiDien[];
  bam: string;
}

export function taoGoi(def: FlowDefinition): { goi: GoiLuong; viec: ViecPhaiDien[] } {
  const { luong, viec } = lamSachLuong(def);
  return { goi: { dinhDang: DINH_DANG_GOI, luong, viecPhaiDien: viec, bam: bamLuong(luong) }, viec };
}

export type KetQuaPhanTich =
  | { ok: true; luong: FlowDefinition; viec: ViecPhaiDien[]; canhBao: ("bam-thieu" | "bam-lech" | "co-du-lieu-ghim" | "co-bi-mat" | "co-id-nha-may")[] }
  | { ok: false; ma: "DINH_DANG_LA" | "QUA_LON" | "KHONG_HOP_LE"; thongDiep: string };

/** Phân tích một gói do NGƯỜI DÙNG tải lên (không tin): định dạng lạ ⇒ từ chối; sai schema / quá lớn ⇒ từ chối; băm thiếu/lệch ⇒ chỉ cảnh báo; làm sạch LẠI y như xuất. */
export function phanTichGoi(goi: unknown): KetQuaPhanTich {
  let chu: string;
  try {
    chu = JSON.stringify(goi) ?? "";
  } catch {
    return { ok: false, ma: "KHONG_HOP_LE", thongDiep: "Gói không phải JSON hợp lệ." };
  }
  if (chu.length > TRAN_BYTE_GOI) return { ok: false, ma: "QUA_LON", thongDiep: `Gói vượt ${TRAN_BYTE_GOI / 1024} KB.` };
  const g = goi as Partial<GoiLuong> | null;
  if (!g || typeof g !== "object") return { ok: false, ma: "KHONG_HOP_LE", thongDiep: "Gói rỗng hoặc sai kiểu." };
  if (g.dinhDang !== DINH_DANG_GOI) return { ok: false, ma: "DINH_DANG_LA", thongDiep: `Định dạng gói '${String(g.dinhDang).slice(0, 40)}' không được hỗ trợ (cần ${DINH_DANG_GOI}).` };
  const p = FlowDefinitionSchema.safeParse(g.luong);
  if (!p.success) return { ok: false, ma: "KHONG_HOP_LE", thongDiep: `Luồng trong gói không hợp lệ: ${p.error.issues[0]?.path.join(".") || "(gốc)"} — ${p.error.issues[0]?.message ?? "sai schema"}`.slice(0, 300) };
  if (p.data.nodes.length > TRAN_NODE_GOI) return { ok: false, ma: "QUA_LON", thongDiep: `Gói có ${p.data.nodes.length} node — tối đa ${TRAN_NODE_GOI}.` };
  const canhBao: Extract<KetQuaPhanTich, { ok: true }>["canhBao"] = [];
  if (typeof g.bam !== "string" || g.bam === "") canhBao.push("bam-thieu");
  else if (g.bam !== bamLuong(g.luong)) canhBao.push("bam-lech");
  if (p.data.pinData && Object.keys(p.data.pinData).length > 0) canhBao.push("co-du-lieu-ghim");
  if (p.data.nodes.some((n) => n.credentialRef !== undefined)) canhBao.push("co-bi-mat");
  // gói do người khác soạn có thể MANG id nhà máy (máy, người nhận, luồng con, FOE…): báo, rồi làm sạch LẠI (nhập không tin gói)
  const mangId = p.data.nodes.some((n) => (THAM_SO_THEO_NHA_MAY[n.type]?.truong ?? []).some((d) => d.thanh !== "tat" && !trong(n.parameters[d.truong]) && !laBieuThuc(n.parameters[d.truong])));
  if (mangId) canhBao.push("co-id-nha-may");
  const { luong, viec } = lamSachLuong(p.data);
  return { ok: true, luong, viec, canhBao };
}

/** Id luồng mới từ tên (ASCII, ≤ 64) + hậu tố ngẫu nhiên. */
export function idLuongNhap(ten: string, duoi: string = Math.random().toString(36).slice(2, 8)): string {
  const goc = ten.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "luong";
  return `${goc}-${duoi}`.slice(0, 64);
}
