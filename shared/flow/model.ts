/**
 * ★★ Đợt 8.0 — MÔ HÌNH LUỒNG AI (kiểu n8n, sửa hai điểm yếu đã biết của n8n: nối theo ID chứ không theo TÊN node;
 * mỗi loại node KHAI hạng tác dụng phụ). Spec §4.3. THUẦN, dùng chung client (Flow Studio) và server (động cơ).
 */
import { z } from "zod";
import { kiemCuPhap } from "./bieuThuc";

export const RE_ID_NUT = /^[A-Za-z0-9_-]{1,64}$/;

export const NodeInstanceSchema = z.object({
  id: z.string().regex(RE_ID_NUT),
  type: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/).max(64),
  typeVersion: z.number().int().min(1).max(100),
  name: z.string().min(1).max(120),
  position: z.tuple([z.number(), z.number()]),
  parameters: z.record(z.string(), z.unknown()).default({}),
  /** Đợt 8.2: id một bí mật `ai_flow_credentials` — động cơ giải mã lúc chạy, chỉ node khai `nhanBiMat` nhận được. */
  credentialRef: z.string().regex(RE_ID_NUT).optional(),
  retry: z.object({ max: z.number().int().min(0).max(10), backoffMs: z.number().int().min(0).max(600_000) }).optional(),
  khiLoi: z.enum(["dung", "tiep-tuc", "nhanh-loi"]).optional(),
  disabled: z.boolean().optional(),
});
export type NodeInstance = z.infer<typeof NodeInstanceSchema>;

export const ConnectionSchema = z.object({
  from: z.object({ node: z.string().regex(RE_ID_NUT), port: z.string().min(1).max(32) }),
  to: z.object({ node: z.string().regex(RE_ID_NUT), port: z.string().min(1).max(32) }),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const FlowDefinitionSchema = z.object({
  id: z.string().regex(RE_ID_NUT),
  name: z.string().min(1).max(200),
  version: z.number().int().min(1),
  nodes: z.array(NodeInstanceSchema).min(1).max(500),
  connections: z.array(ConnectionSchema).max(2000),
  settings: z
    .object({
      errorFlowId: z.string().regex(RE_ID_NUT).optional(),
      timeoutS: z.number().int().min(1).max(7 * 24 * 3600).optional(),
      maxConcurrentRuns: z.number().int().min(1).max(100).optional(),
      uuTien: z.enum(["interactive", "agent", "background"]).default("background"),
      affinity: z.array(z.string().max(48)).max(8).optional(),
      luuDuLieu: z.enum(["day-du", "chi-loi", "khong"]).default("day-du"),
    })
    .default({ uuTien: "background", luuDuLieu: "day-du" }),
  pinData: z.record(z.string(), z.array(z.object({ json: z.record(z.string(), z.unknown()) }))).optional(),
});
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;

export type HangTacDungPhu = "thuan" | "doc" | "ngoai-ghi" | "ot";
export const THU_TU_HANG: Record<HangTacDungPhu, number> = { thuan: 0, doc: 1, "ngoai-ghi": 2, ot: 3 };

/** Khai báo một LOẠI node (sổ đăng ký). Phần chạy (`chay`) chỉ có ở server — xem `server/services/flow/dangKyNut.ts`. */
export interface KhaiBaoNut {
  type: string;
  typeVersion: number;
  laKichHoat: boolean;
  congVao: readonly string[];
  congRa: readonly string[];
  tacDungPhu: HangTacDungPhu;
  /** `idempotent`: chạy lại với cùng khoá là vô hại · `atMostOnce`: KHÔNG bao giờ chạy lại sau khi đã bắt đầu. */
  lapLai: "idempotent" | "atMostOnce";
  /** `gop`: node chờ ĐỦ mọi cổng vào có nối mới chạy (vd `logic.gop`). Mặc định: chạy khi có item ở bất kỳ cổng nào. */
  choDuCong?: boolean;
  /** Đợt 8.2: node nhận bí mật qua `credentialRef` (vd HTTP). Node khác có `credentialRef` ⇒ luồng không hợp lệ. */
  nhanBiMat?: boolean;
}

export interface KetQuaKiemLuong {
  ok: boolean;
  loi: string[];
  /**
   * Hạng tác dụng phụ của CẢ luồng = hạng cao nhất của mọi node (kể cả node tắt — bật lại không qua duyệt mới) VÀ của mọi
   * luồng con được tham chiếu (Đợt 8.4: `luong.goi-con`, tool của `ai.agent`) khi biết hạng của chúng.
   */
  hang: HangTacDungPhu;
  /** Đợt 8.4 — id các luồng con được tham chiếu (không trùng). */
  luongCon: string[];
}

/** Đợt 8.4 — loại node GỌI LUỒNG KHÁC và chỗ đặt id luồng con trong tham số. */
export const LOAI_GOI_LUONG_CON = "luong.goi-con";
export const LOAI_AGENT = "ai.agent";
/** Độ sâu lồng tối đa (cha ⇒ con ⇒ cháu …) lúc chạy. */
export const DO_SAU_LUONG_CON_TOI_DA = 4;

/**
 * Đợt 8.4 — id luồng con một node tham chiếu (`luong.goi-con.parameters.flowId`, `ai.agent.parameters.luongCon[].flowId`).
 * Id PHẢI là chuỗi CỐ ĐỊNH đúng khuôn id — id là biểu thức thì hạng luồng con không biết được lúc lưu ⇒ lỗi.
 */
export function luongConCuaNut(n: Pick<NodeInstance, "id" | "type" | "parameters">): { ids: string[]; loi: string[] } {
  const ids: string[] = [];
  const loi: string[] = [];
  const kiem = (v: unknown, cho: string) => {
    if (typeof v !== "string" || !RE_ID_NUT.test(v)) loi.push(`node '${n.id}': ${cho} phải là id luồng CỐ ĐỊNH (không biểu thức)`);
    else ids.push(v);
  };
  if (n.type === LOAI_GOI_LUONG_CON) kiem(n.parameters?.flowId, "flowId");
  else if (n.type === LOAI_AGENT) {
    const ds = n.parameters?.luongCon;
    if (ds !== undefined && !Array.isArray(ds)) loi.push(`node '${n.id}': luongCon phải là danh sách`);
    else (ds ?? []).forEach((x: unknown, i: number) => kiem((x as { flowId?: unknown } | null)?.flowId, `luongCon[${i}].flowId`));
  }
  return { ids, loi };
}

export interface TuyChonKiemLuong {
  /**
   * Đợt 8.4 — hạng của PHIÊN BẢN HOẠT ĐỘNG của một luồng con; `null` ⇒ luồng con không tồn tại / chưa có phiên bản hoạt động
   * (lỗi). Vắng tuỳ chọn (client) ⇒ chỉ kiểm cú pháp tham chiếu, hạng chỉ tính theo node.
   */
  hangLuongCon?: (flowId: string) => HangTacDungPhu | null;
}

function chuoiBieuThuc(v: unknown, ra: string[]): void {
  if (typeof v === "string") {
    for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) ra.push(m[1]);
  } else if (Array.isArray(v)) v.forEach((x) => chuoiBieuThuc(x, ra));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => chuoiBieuThuc(x, ra));
}

/** Kiểm một định nghĩa luồng trước khi lưu phiên bản. */
export function kiemLuong(raw: unknown, dangKy: (type: string) => KhaiBaoNut | undefined, tuyChon: TuyChonKiemLuong = {}): KetQuaKiemLuong {
  const p = FlowDefinitionSchema.safeParse(raw);
  if (!p.success) {
    return { ok: false, loi: p.error.issues.map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`), hang: "thuan", luongCon: [] };
  }
  const def = p.data;
  const loi: string[] = [];
  const theoId = new Map<string, { n: NodeInstance; kb: KhaiBaoNut | undefined }>();
  const luongCon: string[] = [];
  let hang: HangTacDungPhu = "thuan";
  for (const n of def.nodes) {
    if (theoId.has(n.id)) loi.push(`id node trùng '${n.id}'`);
    const kb = dangKy(n.type);
    if (!kb) loi.push(`node '${n.id}': loại '${n.type}' chưa đăng ký`);
    else {
      if (kb.typeVersion !== n.typeVersion) loi.push(`node '${n.id}': phiên bản loại ${n.typeVersion} ≠ ${kb.typeVersion}`);
      if (THU_TU_HANG[kb.tacDungPhu] > THU_TU_HANG[hang]) hang = kb.tacDungPhu;
      if (n.credentialRef && !kb.nhanBiMat) loi.push(`node '${n.id}': loại '${n.type}' không nhận bí mật (credentialRef)`);
    }
    const bt: string[] = [];
    chuoiBieuThuc(n.parameters, bt);
    for (const b of bt) {
      const l = kiemCuPhap(b);
      if (l) loi.push(`node '${n.id}': biểu thức {{${b.trim()}}} — ${l}`);
    }
    theoId.set(n.id, { n, kb });
    const lc = luongConCuaNut(n);
    loi.push(...lc.loi);
    for (const con of lc.ids) {
      if (con === def.id) loi.push(`node '${n.id}': luồng không được gọi chính nó ('${con}')`);
      else if (!luongCon.includes(con)) luongCon.push(con);
    }
  }
  if (tuyChon.hangLuongCon) {
    for (const con of luongCon) {
      const h = tuyChon.hangLuongCon(con);
      if (h === null) loi.push(`luồng con '${con}' không tồn tại hoặc chưa có phiên bản hoạt động`);
      else if (THU_TU_HANG[h] > THU_TU_HANG[hang]) hang = h;
    }
  }
  if (!def.nodes.some((n) => theoId.get(n.id)?.kb?.laKichHoat)) loi.push("luồng cần ít nhất một node kích hoạt");
  const canh = new Map<string, Set<string>>();
  for (const c of def.connections) {
    const a = theoId.get(c.from.node);
    const b = theoId.get(c.to.node);
    if (!a) loi.push(`nối từ node không tồn tại '${c.from.node}'`);
    if (!b) loi.push(`nối tới node không tồn tại '${c.to.node}'`);
    if (a?.kb && !a.kb.congRa.includes(c.from.port)) loi.push(`node '${c.from.node}' không có cổng ra '${c.from.port}'`);
    if (b?.kb && !b.kb.congVao.includes(c.to.port)) loi.push(`node '${c.to.node}' không có cổng vào '${c.to.port}'`);
    if (b?.kb?.laKichHoat) loi.push(`node kích hoạt '${c.to.node}' không nhận nối vào`);
    if (!canh.has(c.from.node)) canh.set(c.from.node, new Set());
    canh.get(c.from.node)!.add(c.to.node);
  }
  // Chu trình (Kahn) — luồng là ĐỒ THỊ CÓ HƯỚNG KHÔNG CHU TRÌNH; lặp dùng node "chia lô" (8.1), không dùng cạnh ngược.
  const vao = new Map<string, number>(def.nodes.map((n) => [n.id, 0]));
  for (const ds of canh.values()) for (const d of ds) vao.set(d, (vao.get(d) ?? 0) + 1);
  const hang0 = [...vao].filter(([, v]) => v === 0).map(([k]) => k);
  let daDuyet = 0;
  while (hang0.length) {
    const id = hang0.pop()!;
    daDuyet++;
    for (const d of canh.get(id) ?? []) {
      const v = (vao.get(d) ?? 0) - 1;
      vao.set(d, v);
      if (v === 0) hang0.push(d);
    }
  }
  if (daDuyet < vao.size) loi.push(`luồng có chu trình (qua: ${[...vao].filter(([, v]) => v > 0).map(([k]) => k).join(", ")})`);
  return { ok: loi.length === 0, loi, hang, luongCon };
}
