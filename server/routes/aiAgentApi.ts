/**
 * ★★★ Đợt 1 · T4 (2026-10-17) — TUYẾN REST/SSE của vòng agent máy chủ (spec Đợt 1 §4 "API").
 *
 *   POST /api/ai/agent/runs              tạo lượt chạy + SSE sự kiện (từ seq 1). Thân: {cauHoi, projectId, cheDo,
 *                                        lichSu?, sessionId?, ngonNgu?}. Header `X-Agent-Run-Id` mang id ngay.
 *   GET  /api/ai/agent/runs/:id/events   SSE nối lại: phát lại bộ đệm từ `?tu=<seq>` rồi nghe tiếp; lượt đã rời bộ
 *                                        nhớ ⇒ phát lại bản ĐÃ GỘP trong sổ rồi đóng.
 *   POST /api/ai/agent/runs/:id/huy      huỷ (chỉ chủ lượt chạy).
 *
 * Khung SSE: `id: <seq>` + `data: {"seq":<seq>,"suKien":{loai,…}}` (+ `: ping` mỗi 15 s).
 *
 * ⚠⚠ CLIENT BỎ ĐI **KHÔNG** HUỶ LƯỢT CHẠY (khác `/api/ai/local-kb/stream`): đóng kết nối chỉ gỡ người nghe; lượt
 *   chạy tiếp tục và nối lại được. Chỉ `…/huy` (nút Dừng) mới huỷ. Vì thế tuyến này KHÔNG dùng `huyKhiClientBoDi`.
 * ⚠ Xác thực `thuXacThucRest` (cùng `authenticateRequest` của mọi tuyến); cổng giấy phép MOD_AI do
 *   `app.use("/api/ai", chanTuyenAiTheoGiayPhep())` đứng TRƯỚC lượt đăng ký này. Quyền `ai_repo_read`/`ai_repo_exec`
 *   do bộ quản lý kiểm (một chỗ cho REST lẫn CLI sau này).
 * ⚠ Chữ model đã qua bộ cắt suy luận + che bí mật ở `goiModelMayChu`; kết quả tool đã làm sạch ở `boThucThiMayChu`.
 */
import type express from "express";
import type { Request, Response } from "express";
import { thuXacThucRest, thanTuChoiRest } from "./_xacThucRest";
import { quanLyLuotChay, type MucSuKien, type QuanLyLuotChay } from "../services/ai/agent/quanLyLuotChay";
import { docHangLuotChay, RE_ID_LUOT_CHAY } from "../db/aiAgentRuns";

const NHIP_PING_MS = 15_000;

function reqChoAudit(req: Request) {
  return { ip: req.ip, headers: req.headers as Record<string, unknown>, socket: { remoteAddress: req.socket?.remoteAddress } };
}

function moSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") res.flushHeaders();
}

/** Một khung SSE cho một sự kiện. Thuần. */
export function khungSse(m: MucSuKien): string {
  return `id: ${m.seq}\ndata: ${JSON.stringify({ seq: m.seq, suKien: m.suKien })}\n\n`;
}

/**
 * Bơm sự kiện của một lượt chạy SỐNG ra `res` (phát lại từ `tu`, rồi nghe tới `xong`). Gỡ người nghe khi
 * client bỏ đi — KHÔNG huỷ lượt chạy.
 */
function bomSuKien(ql: QuanLyLuotChay, runId: string, userId: number, tu: number, res: Response): boolean {
  let dong = false;
  let go: (() => void) | null = null;
  const ket = () => {
    if (dong) return;
    dong = true;
    clearInterval(ping);
    go?.();
    if (!res.writableEnded) res.end();
  };
  const ping = setInterval(() => {
    if (!dong && !res.writableEnded) res.write(": ping\n\n");
  }, NHIP_PING_MS);
  ping.unref?.();
  go = ql.nghe(runId, userId, tu, (m) => {
    if (dong || res.writableEnded) return;
    res.write(khungSse(m));
    if (m.suKien.loai === "xong") setImmediate(ket);
  });
  if (go === null) {
    clearInterval(ping);
    return false;
  }
  // Lượt đã kết thúc trước khi nối ⇒ phần phát lại đã gồm `xong`.
  const l = ql.layLuotChay(runId, userId);
  if (!l || l.ketThuc !== null) setImmediate(ket);
  res.on("close", ket);
  return true;
}

export function registerAiAgentRoutes(app: express.Express, ql: QuanLyLuotChay = quanLyLuotChay()): void {
  app.post("/api/ai/agent/runs", async (req, res) => {
    const xacThuc = await thuXacThucRest(req);
    if (!xacThuc.ok) {
      res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
      return;
    }
    const user = xacThuc.user;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const kq = await ql.taoLuotChay({
      user: { id: Number(user.id), role: String(user.role ?? ""), name: user.name ?? null },
      cauHoi: b.cauHoi,
      projectId: b.projectId,
      cheDo: b.cheDo,
      lichSu: b.lichSu,
      sessionId: b.sessionId,
      ngonNgu: b.ngonNgu,
      req: reqChoAudit(req),
    });
    if (!kq.ok) {
      res.status(kq.http).json({
        success: false,
        code: kq.ma,
        ...(kq.runId ? { runId: kq.runId } : {}),
        ...(kq.thongDiep ? { message: kq.thongDiep } : {}),
      });
      return;
    }
    res.setHeader("X-Agent-Run-Id", kq.luot.id);
    moSse(res);
    bomSuKien(ql, kq.luot.id, kq.luot.userId, 0, res);
  });

  app.get("/api/ai/agent/runs/:id/events", async (req, res) => {
    const xacThuc = await thuXacThucRest(req);
    if (!xacThuc.ok) {
      res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
      return;
    }
    const userId = Number(xacThuc.user.id);
    const runId = String(req.params.id ?? "");
    const tuTho = Number(req.query.tu ?? 0);
    const tu = Number.isFinite(tuTho) && tuTho > 0 ? Math.floor(tuTho) : 0;
    if (!RE_ID_LUOT_CHAY.test(runId)) {
      res.status(404).json({ success: false, code: "NOT_FOUND" });
      return;
    }
    if (ql.layLuotChay(runId, userId)) {
      moSse(res);
      bomSuKien(ql, runId, userId, tu, res);
      return;
    }
    // Lượt đã rời bộ nhớ (restart/hết giữ) ⇒ phát lại bản đã gộp trong sổ rồi đóng.
    const hang = await docHangLuotChay(userId, runId);
    if (!hang) {
      res.status(404).json({ success: false, code: "NOT_FOUND" });
      return;
    }
    moSse(res);
    const ds = Array.isArray(hang.suKien) ? (hang.suKien as MucSuKien[]) : [];
    for (const m of ds) if (m && typeof m.seq === "number" && m.seq > tu) res.write(khungSse(m));
    if (!ds.some((m) => m?.suKien?.loai === "xong")) {
      // Lượt chết giữa chừng (restart) — khép bằng một sự kiện có thật trong hợp đồng.
      const seq = (ds[ds.length - 1]?.seq ?? 0) + 1;
      if (seq > tu) {
        res.write(khungSse({ seq, suKien: { loai: "loi", ma: "GIAN_DOAN", thongDiep: "run interrupted (server restarted)" } }));
        res.write(khungSse({ seq: seq + 1, suKien: { loai: "xong", lyDo: "loi-model" } }));
      }
    }
    res.end();
  });

  app.post("/api/ai/agent/runs/:id/huy", async (req, res) => {
    const xacThuc = await thuXacThucRest(req);
    if (!xacThuc.ok) {
      res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
      return;
    }
    const ok = ql.huy(String(req.params.id ?? ""), Number(xacThuc.user.id));
    res.status(ok ? 200 : 404).json(ok ? { success: true } : { success: false, code: "NOT_FOUND" });
  });
}
