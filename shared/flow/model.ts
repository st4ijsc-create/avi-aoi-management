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
  credentialRef: z.string().max(64).optional(),
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
}

export interface KetQuaKiemLuong {
  ok: boolean;
  loi: string[];
  /** Hạng tác dụng phụ của CẢ luồng = hạng cao nhất của mọi node (kể cả node tắt — bật lại không qua duyệt mới). */
  hang: HangTacDungPhu;
}

function chuoiBieuThuc(v: unknown, ra: string[]): void {
  if (typeof v === "string") {
    for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) ra.push(m[1]);
  } else if (Array.isArray(v)) v.forEach((x) => chuoiBieuThuc(x, ra));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => chuoiBieuThuc(x, ra));
}

/** Kiểm một định nghĩa luồng trước khi lưu phiên bản. */
export function kiemLuong(raw: unknown, dangKy: (type: string) => KhaiBaoNut | undefined): KetQuaKiemLuong {
  const p = FlowDefinitionSchema.safeParse(raw);
  if (!p.success) {
    return { ok: false, loi: p.error.issues.map((i) => `${i.path.join(".") || "(gốc)"}: ${i.message}`), hang: "thuan" };
  }
  const def = p.data;
  const loi: string[] = [];
  const theoId = new Map<string, { n: NodeInstance; kb: KhaiBaoNut | undefined }>();
  let hang: HangTacDungPhu = "thuan";
  for (const n of def.nodes) {
    if (theoId.has(n.id)) loi.push(`id node trùng '${n.id}'`);
    const kb = dangKy(n.type);
    if (!kb) loi.push(`node '${n.id}': loại '${n.type}' chưa đăng ký`);
    else {
      if (kb.typeVersion !== n.typeVersion) loi.push(`node '${n.id}': phiên bản loại ${n.typeVersion} ≠ ${kb.typeVersion}`);
      if (THU_TU_HANG[kb.tacDungPhu] > THU_TU_HANG[hang]) hang = kb.tacDungPhu;
    }
    const bt: string[] = [];
    chuoiBieuThuc(n.parameters, bt);
    for (const b of bt) {
      const l = kiemCuPhap(b);
      if (l) loi.push(`node '${n.id}': biểu thức {{${b.trim()}}} — ${l}`);
    }
    theoId.set(n.id, { n, kb });
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
  return { ok: loi.length === 0, loi, hang };
}
