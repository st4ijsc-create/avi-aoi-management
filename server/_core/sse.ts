/**
 * G8 (Giai đoạn 1) — Server-Sent Events (SSE) realtime layer.
 *
 * Mục tiêu: thay polling 30s bằng push realtime qua HTTP SSE cho các dashboard
 * KPI/yield/máy. Bổ sung kênh nhẹ song song với Socket.IO (SSE đơn hướng, hợp
 * cho luồng số liệu một chiều, dễ qua proxy/CDN).
 *
 * Lớp CODE-ONLY, feature-flag `SSE_ENABLED`. Khi tắt: endpoint trả 404, broadcast
 * là no-op. Không phụ thuộc hạ tầng ngoài.
 */

import type { Request, Response } from "express";
import { thuXacThucRest, thanTuChoiRest } from "../routes/_xacThucRest";
import { idsTrongPhamVi } from "../db/hierarchy";

interface SseClient {
  id: number;
  userId: number;
  res: Response;
  channels: Set<string>;
  /** Phạm vi nhà máy lúc kết nối (`null` = toàn quyền). Sự kiện mang `factoryId` chỉ tới client có phạm vi chứa nó. */
  nhaMayIds: number[] | null;
  lanCuoi: number;
}

const clients = new Map<number, SseClient>();
let nextId = 1;
let heartbeat: NodeJS.Timeout | null = null;

function enabled(): boolean {
  return process.env.SSE_ENABLED === "true";
}

/** Trần kết nối đồng thời mỗi người dùng (chặn giữ socket). */
function tranMoiNguoi(): number {
  const n = Number(process.env.SSE_MAX_PER_USER ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/** Quá hạn không có SỰ KIỆN nào (ping không tính) ⇒ đóng; EventSource tự nối lại (retry 5 s) và được kiểm lại phiên + phạm vi. */
function hanKhongHoatDongMs(): number {
  const n = Number(process.env.SSE_IDLE_MS ?? 600_000);
  return Number.isFinite(n) && n > 0 ? n : 600_000;
}

function ensureHeartbeat(): void {
  if (heartbeat) return;
  const ms = Number(process.env.SSE_HEARTBEAT_MS ?? 25000);
  heartbeat = setInterval(() => {
    const now = Date.now();
    const han = hanKhongHoatDongMs();
    for (const c of [...clients.values()]) {
      if (now - c.lanCuoi > han) {
        clients.delete(c.id);
        try {
          c.res.end();
        } catch {
          /* đã đóng */
        }
        continue;
      }
      try {
        c.res.write(`: ping

`);
      } catch {
        /* sẽ dọn ở close handler */
      }
    }
  }, ms > 0 ? ms : 25000);
  // Không giữ tiến trình sống chỉ vì heartbeat.
  if (typeof heartbeat.unref === "function") heartbeat.unref();
}

/**
 * Express handler cho GET /api/stream?channels=a,b,c
 * ★ Phải có PHIÊN (cùng cổng với /api/ai/agent/runs/:id/events): không phiên ⇒ 401/403 và KHÔNG mở luồng.
 * Phạm vi nhà máy của người nghe được chốt lúc kết nối (`idsTrongPhamVi`, strict); kênh "all" KHÔNG bỏ qua lọc nhà máy.
 */
export async function sseHandler(req: Request, res: Response): Promise<void> {
  if (!enabled()) {
    res.status(404).json({ error: "SSE disabled" });
    return;
  }

  const xacThuc = await thuXacThucRest(req);
  if (!xacThuc.ok) {
    res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
    return;
  }
  const userId = Number(xacThuc.user.id);
  const userRole = String(xacThuc.user.role ?? "");

  let soDangMo = 0;
  for (const c of clients.values()) if (c.userId === userId) soDangMo++;
  if (soDangMo >= tranMoiNguoi()) {
    res.status(429).json({ success: false, code: "TOO_MANY_STREAMS" });
    return;
  }

  let nhaMayIds: number[] | null;
  try {
    nhaMayIds = await idsTrongPhamVi("factory", { userId, userRole }, { strict: true });
  } catch {
    res.status(503).json({ success: false, code: "SCOPE_UNAVAILABLE" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 5000

`);

  const channelsParam = (req.query.channels as string) || "all";
  const channels = new Set(
    channelsParam.split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (channels.size === 0) channels.add("all");

  const id = nextId++;
  clients.set(id, { id, userId, res, channels, nhaMayIds, lanCuoi: Date.now() });
  ensureHeartbeat();

  req.on("close", () => {
    clients.delete(id);
  });
}

/**
 * Phát một sự kiện tới client đã đăng ký channel (hoặc "all") VÀ có phạm vi chứa `factoryId`.
 * `factoryId` BẮT BUỘC: số ⇒ client toàn quyền + client có nhà máy đó; `null` ⇒ CHỈ client toàn quyền (không nhà máy nào được nhận).
 * No-op khi SSE tắt hoặc không có client.
 */
export function sseBroadcast(channel: string, event: string, data: unknown, factoryId: number | null): void {
  if (!enabled() || clients.size === 0) return;
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  for (const c of [...clients.values()]) {
    if (!(c.channels.has("all") || c.channels.has(channel))) continue;
    const duocPhep = c.nhaMayIds === null || (factoryId !== null && c.nhaMayIds.includes(factoryId));
    if (!duocPhep) continue;
    try {
      c.res.write(payload);
      c.lanCuoi = Date.now();
    } catch {
      clients.delete(c.id);
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}

export function isSseEnabled(): boolean {
  return enabled();
}
