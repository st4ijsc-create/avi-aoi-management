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

interface SseClient {
  id: number;
  res: Response;
  channels: Set<string>;
}

const clients = new Map<number, SseClient>();
let nextId = 1;
let heartbeat: NodeJS.Timeout | null = null;

function enabled(): boolean {
  return process.env.SSE_ENABLED === "true";
}

function ensureHeartbeat(): void {
  if (heartbeat) return;
  const ms = Number(process.env.SSE_HEARTBEAT_MS ?? 25000);
  heartbeat = setInterval(() => {
    for (const c of clients.values()) {
      try {
        c.res.write(`: ping\n\n`);
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
 * Mở kết nối SSE; client nhận event của các channel đã đăng ký (mặc định "all").
 */
export function sseHandler(req: Request, res: Response): void {
  if (!enabled()) {
    res.status(404).json({ error: "SSE disabled" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 5000\n\n`);

  const channelsParam = (req.query.channels as string) || "all";
  const channels = new Set(
    channelsParam.split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (channels.size === 0) channels.add("all");

  const id = nextId++;
  clients.set(id, { id, res, channels });
  ensureHeartbeat();

  req.on("close", () => {
    clients.delete(id);
  });
}

/**
 * Phát một sự kiện tới mọi client đã đăng ký channel (hoặc "all").
 * No-op khi SSE tắt hoặc không có client.
 */
export function sseBroadcast(channel: string, event: string, data: unknown): void {
  if (!enabled() || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients.values()) {
    if (c.channels.has("all") || c.channels.has(channel)) {
      try {
        c.res.write(payload);
      } catch {
        clients.delete(c.id);
      }
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}

export function isSseEnabled(): boolean {
  return enabled();
}
