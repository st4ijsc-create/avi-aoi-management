/**
 * ★★ AI Local Đợt 8.3 — FLOW STUDIO: phần THUẦN (không React) của trình sửa Luồng AI.
 *
 * Tách khỏi component để lưới đơn vị chạm được: tạo node mới (id duy nhất + tham số mặc định), kiểm biểu thức
 * `{{ … }}` tức thì bằng CHÍNH bộ phân tích của động cơ (`shared/flow/bieuThuc.ts#kiemCuPhap`), nhóm danh mục node theo
 * tiền tố, gộp trạng thái bước của một lượt thành trạng thái từng node (tô canvas), và sinh id luồng từ tên.
 */
import { kiemCuPhap } from "@shared/flow/bieuThuc";
import type { FlowDefinition, HangTacDungPhu, NodeInstance } from "@shared/flow/model";

export interface KhaiBaoNutClient {
  type: string;
  typeVersion: number;
  laKichHoat: boolean;
  congVao: string[];
  congRa: string[];
  tacDungPhu: HangTacDungPhu;
  lapLai: "idempotent" | "atMostOnce";
  choDuCong: boolean;
  nhanBiMat: boolean;
}

/** Màu huy hiệu hạng tác dụng phụ (token ngữ nghĩa, không hex). */
export const MAU_HANG: Record<HangTacDungPhu, string> = {
  thuan: "bg-success/15 text-success border-success/40",
  doc: "bg-info/15 text-info border-info/40",
  "ngoai-ghi": "bg-warning/15 text-warning border-warning/40",
  ot: "bg-destructive/15 text-destructive border-destructive/40",
};

/** Màu trạng thái lượt / bước. */
export const MAU_TRANG_THAI: Record<string, string> = {
  "dang-chay": "bg-info/15 text-info border-info/40",
  "cho-duyet": "bg-warning/15 text-warning border-warning/40",
  xong: "bg-success/15 text-success border-success/40",
  loi: "bg-destructive/15 text-destructive border-destructive/40",
  "khong-ro": "bg-destructive/15 text-destructive border-destructive/40",
  huy: "bg-muted text-muted-foreground border-border",
  "bo-qua": "bg-muted text-muted-foreground border-border",
};

export const laHang = (h: unknown): h is HangTacDungPhu => h === "thuan" || h === "doc" || h === "ngoai-ghi" || h === "ot";

/** Lượt còn "sống" (dòng thời gian tự làm mới). */
export const luotDangSong = (status: string | null | undefined): boolean => status === "dang-chay" || status === "cho-duyet";

/** Nhóm theo tiền tố type (`ai.llm` ⇒ `ai`), giữ thứ tự nhóm cố định cho bảng node. */
export const THU_TU_NHOM = ["kich-hoat", "logic", "du-lieu", "ai", "nguoi", "tich-hop", "ot"] as const;

export function nhomCuaType(type: string): string {
  const i = type.indexOf(".");
  return i < 0 ? type : type.slice(0, i);
}

export function nhomDanhMuc(ds: readonly KhaiBaoNutClient[], loc = ""): { nhom: string; nut: KhaiBaoNutClient[] }[] {
  const q = loc.trim().toLowerCase();
  const theoNhom = new Map<string, KhaiBaoNutClient[]>();
  for (const n of ds) {
    if (q && !n.type.toLowerCase().includes(q)) continue;
    const g = nhomCuaType(n.type);
    if (!theoNhom.has(g)) theoNhom.set(g, []);
    theoNhom.get(g)!.push(n);
  }
  const thuTu = (g: string) => {
    const i = (THU_TU_NHOM as readonly string[]).indexOf(g);
    return i < 0 ? 99 : i;
  };
  return [...theoNhom.entries()].sort((a, b) => thuTu(a[0]) - thuTu(b[0]) || a[0].localeCompare(b[0])).map(([nhom, nut]) => ({ nhom, nut }));
}

/** Tham số mặc định khi thả một node mới lên canvas. */
export function thamSoMacDinh(type: string): Record<string, unknown> {
  switch (type) {
    case "du-lieu.dat":
      return { truong: {} };
    case "logic.neu":
      return { dieuKien: "{{ true }}" };
    case "ai.llm":
      return { vaiTro: "chat", loiNhac: "", nghi: false, truongRa: "traLoi" };
    case "ai.trich-xuat":
      return { vaiTro: "extract", vanBan: "{{ $json.vanBan }}", truongRa: "trichXuat", truong: [] };
    case "ai.phan-loai":
      return { vaiTro: "classify", vanBan: "{{ $json.vanBan }}", nhan: [], truongRa: "nhan" };
    case "ai.tom-tat":
      return { vaiTro: "summarize", yeuCau: "", truongRa: "tomTat" };
    case "nguoi.duyet":
      return { tieuDe: "", noiDung: "", hetHanGio: 24, vaiTroDuyet: "supervisor" };
    case "tich-hop.http-doc":
      return { url: "", truongRa: "phanHoi" };
    case "tich-hop.http-gui":
      return { url: "", phuongThuc: "POST", than: "", truongRa: "phanHoi" };
    case "kich-hoat.lich":
      return { cron: "0 6 * * *", muiGio: "Asia/Ho_Chi_Minh" };
    case "du-lieu.ma":
      return { ma: "return items;" };
    case "ot.doc-tag":
      return { may: 1, gioiHan: 20, truongRa: "tag" };
    case "ot.de-xuat-lenh":
      return { may: 1, lenh: "pause", hetHanGio: 24 };
    case "ot.de-xuat-luong":
      return { workflowId: 1, version: 1, thamSo: {}, hetHanGio: 24 };
    default:
      return {};
  }
}

/** Id node mới duy nhất trong luồng: `<đuôi type>-<n>`. */
export function idNutMoi(type: string, daCo: Iterable<string>): string {
  const ds = new Set(daCo);
  const goc = (type.split(".").pop() ?? "nut").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || "nut";
  for (let i = 1; i < 10_000; i++) {
    const id = `${goc}-${i}`;
    if (!ds.has(id)) return id;
  }
  return `${goc}-${Date.now()}`;
}

export function taoNutMoi(kb: KhaiBaoNutClient, daCo: Iterable<string>, viTri: [number, number]): NodeInstance {
  const id = idNutMoi(kb.type, daCo);
  return { id, type: kb.type, typeVersion: kb.typeVersion, name: id, position: [Math.round(viTri[0]), Math.round(viTri[1])], parameters: thamSoMacDinh(kb.type) };
}

/**
 * Lỗi biểu thức của MỘT chuỗi tham số: `{{` không đóng, hoặc lỗi cú pháp đầu tiên do `kiemCuPhap` báo.
 * Trả `null` nếu hợp lệ (hoặc không có biểu thức).
 */
export function loiBieuThucChuoi(s: string): string | null {
  const mo = s.split("{{").length - 1;
  const dong = s.split("}}").length - 1;
  if (mo !== dong) return "{{ }}";
  for (const m of s.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const l = kiemCuPhap(m[1]);
    if (l) return l;
  }
  return null;
}

/** Mọi lỗi biểu thức trong tham số một node (đường dẫn `a.b.0` ⇒ thông điệp). */
export function loiBieuThucThamSo(v: unknown, duong = ""): Record<string, string> {
  const ra: Record<string, string> = {};
  if (typeof v === "string") {
    const l = loiBieuThucChuoi(v);
    if (l) ra[duong] = l;
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => Object.assign(ra, loiBieuThucThamSo(x, duong ? `${duong}.${i}` : String(i))));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) Object.assign(ra, loiBieuThucThamSo(x, duong ? `${duong}.${k}` : k));
  }
  return ra;
}

/** Bỏ dấu tiếng Việt + ký tự lạ ⇒ id luồng `[a-z0-9-]`, thêm đuôi ngẫu nhiên ngắn chống trùng. */
export function idLuongTuTen(ten: string, duoi: string = Math.random().toString(36).slice(2, 6)): string {
  const goc = ten
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return `${goc || "luong"}-${duoi}`;
}

/** Luồng mới tối thiểu: một node kích hoạt thủ công. */
export function luongMoi(id: string, ten: string): FlowDefinition {
  return {
    id,
    name: ten,
    version: 1,
    nodes: [{ id: "thu-cong-1", type: "kich-hoat.thu-cong", typeVersion: 1, name: "thu-cong-1", position: [0, 0], parameters: {} }],
    connections: [],
    settings: { uuTien: "background", luuDuLieu: "day-du" },
  };
}

/** Bản sao định nghĩa mẫu dưới id/tên mới (bỏ pinData — dữ liệu thử của mẫu không đi theo). */
export function saoTuMau(mau: FlowDefinition, id: string, ten: string): FlowDefinition {
  const { pinData: _bo, ...con } = mau;
  return { ...con, id, name: ten, version: 1 };
}

/** Trạng thái MỚI NHẤT của từng node trong một lượt (bước xếp theo id tăng dần ⇒ bước sau đè bước trước). */
export function trangThaiTheoNut(buoc: readonly { nodeId: string; status: string }[]): Record<string, string> {
  const ra: Record<string, string> = {};
  for (const b of buoc) ra[b.nodeId] = b.status;
  return ra;
}

/** Đọc mảng items JSON người nhập cho "Chạy tay": nhận `[{json:{…}}]` hoặc `[{…}]` (tự bọc). */
export function docItemsNhap(chu: string): { ok: true; items: { json: Record<string, unknown> }[] } | { ok: false } {
  const s = chu.trim();
  if (!s) return { ok: true, items: [] };
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return { ok: false };
  }
  const ds = Array.isArray(v) ? v : [v];
  const items: { json: Record<string, unknown> }[] = [];
  for (const x of ds) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false };
    const o = x as Record<string, unknown>;
    const laBoc = Object.keys(o).length === 1 && o.json && typeof o.json === "object" && !Array.isArray(o.json);
    items.push({ json: (laBoc ? o.json : o) as Record<string, unknown> });
  }
  return { ok: true, items };
}

/** Đợt 9 — vết model của một bước (sự kiện `buoc.model` của `flow.dongThoiGian`): các lần gọi AI trong bước `nodeId#lan`. */
export interface VetModelClient {
  vaiTro: string;
  model: string | null;
  nguon: string;
  phamVi: string | null;
  duPhong: boolean;
  kheBan: boolean;
  lyDo: string[];
}

export function vetModelCuaBuoc(suKien: readonly { kind: string; payload: unknown }[], nodeId: string, lan: number): VetModelClient[] {
  const ra: VetModelClient[] = [];
  for (const e of suKien) {
    if (e.kind !== "buoc.model") continue;
    const p = e.payload as (Partial<VetModelClient> & { nodeId?: string; lan?: number }) | null;
    if (!p || p.nodeId !== nodeId || p.lan !== lan) continue;
    ra.push({
      vaiTro: String(p.vaiTro ?? ""), model: typeof p.model === "string" ? p.model : null, nguon: String(p.nguon ?? ""), phamVi: typeof p.phamVi === "string" ? p.phamVi : null,
      duPhong: p.duPhong === true, kheBan: p.kheBan === true, lyDo: Array.isArray(p.lyDo) ? p.lyDo.map(String).slice(0, 8) : [],
    });
  }
  return ra;
}

/** Mã lỗi node ỔN ĐỊNH (do máy chủ đóng dấu vào `error.ma`) có chú giải ở UI — nhận diện theo MÃ, không theo chuỗi tiếng Việt. */
export const MA_LOI_CO_CHU_GIAI = ["BI_MAT_CHUA_KHAI_HOST", "CHU_LUOT_KHONG_XAC_DINH", "DICH_NOI_BO"] as const;
export type MaLoiCoChuGiai = (typeof MA_LOI_CO_CHU_GIAI)[number];

export function maLoiChuGiai(loi: unknown): MaLoiCoChuGiai | null {
  const ma = loi && typeof loi === "object" ? (loi as { ma?: unknown }).ma : null;
  return typeof ma === "string" && (MA_LOI_CO_CHU_GIAI as readonly string[]).includes(ma) ? (ma as MaLoiCoChuGiai) : null;
}
