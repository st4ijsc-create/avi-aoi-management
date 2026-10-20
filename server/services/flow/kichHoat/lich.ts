/**
 * ★★ Đợt 8.1 Task 4a — KÍCH HOẠT THEO LỊCH của Luồng AI: node `kich-hoat.lich` + bộ lập lịch bầu chủ.
 *
 *   node `kich-hoat.lich` — tham số `cron` (ĐÚNG 5 trường, `node-cron` validate) · `muiGio` (IANA, mặc định
 *                           Asia/Ho_Chi_Minh). Item ra: `{ moc, cron, muiGio }`.
 *   bộ lập lịch           — CHỈ tiến trình giữ `giuQuyenChu("lich")` mới bắn (lỗ đã biết: 12 bộ node-cron không bầu chủ
 *                           ⇒ chạy đôi). Không giữ quyền ⇒ thử giành lại mỗi 60 s; giữ quyền ⇒ mỗi 60 s đối chiếu lại tập
 *                           luồng BẬT (luồng bật/tắt ở tiến trình khác vẫn được thấy), và `napLaiLich()` gọi ngay khi luồng
 *                           bật/tắt/đổi phiên bản trong cùng tiến trình.
 *   mỗi lần bắn           — `batDauRun` với `idempotencyKey = flowId:nodeId:<mốc phút ISO>` (cột UNIQUE ⇒ hai tiến trình
 *                           lỡ bắn trùng phút vẫn chỉ MỘT lượt; bản dài > 128 ký tự ⇒ băm sha256).
 */
import { createHash } from "node:crypto";
import * as cron from "node-cron";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import type { FlowDefinition } from "../../../../shared/flow/model";
import { dangKyNut } from "../dangKyNut";
import { giuQuyenChu, type QuyenChu } from "../bauChu";

export const LOAI_LICH = "kich-hoat.lich";
export const MUI_GIO_MAC_DINH = "Asia/Ho_Chi_Minh";

dangKyNut({
  type: LOAI_LICH,
  typeVersion: 1,
  laKichHoat: true,
  congVao: [],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    return { main: ngu.inputs.main ?? [{ json: { cron: String(thamSo.cron ?? ""), muiGio: String(thamSo.muiGio ?? MUI_GIO_MAC_DINH) } }] };
  },
});

/** Kiểm biểu thức cron 5 trường (phút giờ ngày tháng thứ). Trả lỗi tiếng Việt hoặc null. */
export function kiemCron(bieuThuc: unknown): string | null {
  if (typeof bieuThuc !== "string" || !bieuThuc.trim()) return "thiếu biểu thức cron";
  const truong = bieuThuc.trim().split(/\s+/);
  if (truong.length !== 5) return `cron cần đúng 5 trường (phút giờ ngày tháng thứ), nhận ${truong.length}`;
  if (!cron.validate(truong.join(" "))) return `cron không hợp lệ: "${bieuThuc}"`;
  return null;
}

export function kiemMuiGio(muiGio: unknown): string | null {
  if (muiGio === undefined || muiGio === null || muiGio === "") return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(muiGio) });
    return null;
  } catch {
    return `múi giờ không hợp lệ: "${String(muiGio)}"`;
  }
}

/**
 * Kiểm tham số các node KÍCH HOẠT (thứ `kiemLuong` không biết — nó chỉ kiểm cấu trúc): cron + múi giờ của mọi node lịch.
 * Router gọi trước `luuPhienBan`; trả danh sách lỗi (rỗng = hợp lệ).
 */
export function kiemThamSoKichHoat(raw: unknown): string[] {
  const nodes = (raw as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return [];
  const loi: string[] = [];
  for (const n of nodes as { id?: unknown; type?: unknown; parameters?: Record<string, unknown> }[]) {
    if (n?.type !== LOAI_LICH) continue;
    const l1 = kiemCron(n.parameters?.cron);
    if (l1) loi.push(`node '${String(n.id)}': ${l1}`);
    const l2 = kiemMuiGio(n.parameters?.muiGio);
    if (l2) loi.push(`node '${String(n.id)}': ${l2}`);
  }
  return loi;
}

/** Mốc PHÚT dạng ISO UTC (`2026-10-20T23:00Z`) — hai tiến trình bắn trong cùng phút ra CÙNG mốc. */
export function mocPhut(d: Date): string {
  return `${d.toISOString().slice(0, 16)}Z`;
}

export function khoaLich(flowId: string, nodeId: string, moc: Date): string {
  const k = `${flowId}:${nodeId}:${mocPhut(moc)}`;
  return k.length <= 128 ? k : `sha256:${createHash("sha256").update(k).digest("hex")}`;
}

/** Lỗi trùng khoá UNIQUE (23505) — postgres.js để `code` ở lỗi hoặc ở `cause` (drizzle bọc). */
export function laTrungKhoa(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    if ((x as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * MỘT lần bắn: bắt đầu lượt cho đúng node lịch. Trả `runId`, hoặc `null` nếu mốc phút này ĐÃ có lượt (tiến trình khác
 * bắn trước / bắn lặp). `bayGio` tiêm được — lưới dùng đồng hồ giả.
 */
export async function banLich(y: { flowId: string; version: number; nodeId: string; bayGio?: Date; cron?: string; muiGio?: string }): Promise<string | null> {
  const { batDauRun } = await import("../dongCo");
  const moc = y.bayGio ?? new Date();
  try {
    return await batDauRun({
      flowId: y.flowId,
      version: y.version,
      nutKichHoat: y.nodeId,
      triggerKind: "lich",
      idempotencyKey: khoaLich(y.flowId, y.nodeId, moc),
      items: [{ json: { moc: mocPhut(moc), cron: y.cron ?? "", muiGio: y.muiGio ?? MUI_GIO_MAC_DINH } }],
    });
  } catch (e) {
    if (laTrungKhoa(e)) return null;
    throw e;
  }
}

export interface MucLich {
  flowId: string;
  version: number;
  nodeId: string;
  cron: string;
  muiGio: string;
}

/** Mọi node lịch của các luồng BẬT (phiên bản hoạt động). `tienToFlow` — chỉ lưới. */
export async function docMucLich(tienToFlow?: string): Promise<MucLich[]> {
  const db = await getDb();
  if (!db) return [];
  const loc = tienToFlow ? sql`AND f.id LIKE ${tienToFlow.replace(/[\\%_]/g, (c) => "\\" + c) + "%"}` : sql``;
  const rows = (await db.execute(sql`
    SELECT f.id AS "flowId", f."activeVersion" AS version, v.definition
      FROM ai_flows f JOIN ai_flow_versions v ON v."flowId" = f.id AND v.version = f."activeVersion"
     WHERE f.enabled AND f."activeVersion" IS NOT NULL ${loc}
     ORDER BY f.id`)) as unknown as { flowId: string; version: number; definition: FlowDefinition }[];
  const ra: MucLich[] = [];
  for (const r of rows) {
    for (const n of r.definition?.nodes ?? []) {
      if (n.type !== LOAI_LICH || n.disabled) continue;
      const c = String(n.parameters?.cron ?? "");
      const mg = String(n.parameters?.muiGio || MUI_GIO_MAC_DINH);
      if (kiemCron(c) || kiemMuiGio(mg)) continue; // phiên bản lưu trước khi có kiểm ⇒ bỏ qua, không làm sập bộ lập lịch
      ra.push({ flowId: r.flowId, version: r.version, nodeId: n.id, cron: c.trim().split(/\s+/).join(" "), muiGio: mg });
    }
  }
  return ra;
}

// ── bộ lập lịch (một mỗi tiến trình) ─────────────────────────────────────────────────────────────

const NHIP_MS = 60_000;
let quyen: QuyenChu | null = null;
let nhip: ReturnType<typeof setInterval> | null = null;
let dangNap: Promise<void> | null = null;
const viec = new Map<string, { chuKy: string; task: cron.ScheduledTask }>();

function khoaViec(m: MucLich): string {
  return `${m.flowId}@${m.version}#${m.nodeId}`;
}

async function dongBoViec(): Promise<void> {
  if (!quyen?.la) {
    for (const v of viec.values()) await v.task.destroy();
    viec.clear();
    return;
  }
  const muc = await docMucLich();
  const can = new Map(muc.map((m) => [khoaViec(m), m]));
  for (const [k, v] of viec) {
    const m = can.get(k);
    if (!m || v.chuKy !== `${m.cron}|${m.muiGio}`) {
      await v.task.destroy();
      viec.delete(k);
    }
  }
  for (const [k, m] of can) {
    if (viec.has(k)) continue;
    const task = cron.schedule(
      m.cron,
      async (c) => {
        try {
          await banLich({ flowId: m.flowId, version: m.version, nodeId: m.nodeId, bayGio: c?.triggeredAt ?? new Date(), cron: m.cron, muiGio: m.muiGio });
        } catch (e) {
          console.warn(`[luong-ai] lịch ${k}: không bắt đầu được lượt — ${String((e as Error)?.message ?? e).slice(0, 200)}`);
        }
      },
      { timezone: m.muiGio, name: `luong-ai:${k}`, noOverlap: true },
    );
    viec.set(k, { chuKy: `${m.cron}|${m.muiGio}`, task });
  }
}

/** Nạp lại tập việc lịch (gọi khi luồng bật/tắt/đổi phiên bản). Tiến trình không giữ quyền chủ ⇒ no-op. */
export async function napLaiLich(): Promise<void> {
  if (!nhip) return;
  if (dangNap) return dangNap;
  dangNap = (async () => {
    try {
      await dongBoViec();
    } catch (e) {
      console.warn(`[luong-ai] nạp lịch lỗi — ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    } finally {
      dangNap = null;
    }
  })();
  return dangNap;
}

async function moiNhip(): Promise<void> {
  if (!quyen?.la) {
    quyen = await giuQuyenChu("lich");
    if (quyen.la) console.log(`[luong-ai] tiến trình ${process.pid} giữ quyền chủ bộ lập lịch Luồng AI.`);
  }
  await napLaiLich();
}

/** Khởi bộ lập lịch (gọi lại = no-op). Bầu chủ ⇒ an toàn khi khởi ở cả API lẫn worker. */
export function khoiChayLich(): void {
  if (nhip) return;
  nhip = setInterval(() => void moiNhip(), NHIP_MS);
  nhip.unref?.();
  void moiNhip();
}

export async function dungLich(): Promise<void> {
  if (nhip) clearInterval(nhip);
  nhip = null;
  for (const v of viec.values()) await v.task.destroy();
  viec.clear();
  await quyen?.nha();
  quyen = null;
}
