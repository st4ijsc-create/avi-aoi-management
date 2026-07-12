/**
 * doc 44 W3-B4 / G5.10 — Line View: FSM helpers phía client (PURE, unit-testable).
 *
 * NGUỒN SỰ THẬT (server — client chỉ MIRROR để enable/disable nút, KHÔNG mở đường lệnh):
 *   • 7 trạng thái + transition map:  drizzle/schema/lineController.ts
 *     (LINE_STATES / LINE_STATE_TRANSITIONS — spec SYNAPSE LDS-L3 §4.1).
 *   • Lệnh mức cao → đích theo ngữ cảnh:  resolveCommandTarget trong
 *     server/services/lineController/lineControllerService.ts (LINE_COMMANDS).
 *
 * Server LUÔN validate lại mọi lệnh (FSM INVALID_TRANSITION + readiness khi vào
 * 'ready' + policy seam + actuationProcedure role-floor/2FA) — nếu map này lệch
 * phiên bản thì tệ nhất là nút bị disable sai, không bao giờ là lệnh lọt.
 */

export const LINE_VIEW_STATES = [
  "idle",
  "ready",
  "producing",
  "held",
  "completing",
  "changeover",
  "fault",
] as const;
export type LineViewState = (typeof LINE_VIEW_STATES)[number];

/** Mirror LINE_STATE_TRANSITIONS (drizzle/schema/lineController.ts — spec §4.1). */
export const LINE_VIEW_TRANSITIONS: Record<LineViewState, readonly LineViewState[]> = {
  idle: ["ready", "changeover", "fault"],
  ready: ["producing", "changeover", "fault"],
  producing: ["held", "completing", "fault"],
  held: ["producing", "fault"],
  completing: ["idle", "fault"],
  changeover: ["ready", "fault"],
  fault: ["ready"],
};

/** Parse an toàn nhãn trạng thái từ API (fail-safe → null, không bịa). */
export function asLineViewState(raw: unknown): LineViewState | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return (LINE_VIEW_STATES as readonly string[]).includes(s) ? (s as LineViewState) : null;
}

export const LINE_VIEW_COMMANDS = [
  "start",
  "hold",
  "resume",
  "changeover",
  "complete",
  "reset_fault",
] as const;
export type LineViewCommand = (typeof LINE_VIEW_COMMANDS)[number];

/**
 * Lệnh khả dĩ theo trạng thái hiện tại — suy trực tiếp từ resolveCommandTarget
 * (lineControllerService.ts) ∩ transition map §4.1:
 *   idle/ready   → start (idle chain idle→ready→producing) · changeover
 *   producing    → hold · complete (→completing, drain)
 *   held         → resume (— resolveCommandTarget cũng cho 'start' từ held ra
 *                  cùng đích producing, nhưng UI chỉ hiện 'resume' để 1 hành
 *                  động = 1 nút, tránh nút trùng nghĩa)
 *   completing   → complete (→idle, drain xong)
 *   changeover   → complete (→ready, changeover xong)
 *   fault        → reset_fault (→ready, khắc phục + xác nhận)
 */
export const LINE_VIEW_COMMANDS_BY_STATE: Record<LineViewState, readonly LineViewCommand[]> = {
  idle: ["start", "changeover"],
  ready: ["start", "changeover"],
  producing: ["hold", "complete"],
  held: ["resume"],
  completing: ["complete"],
  changeover: ["complete"],
  fault: ["reset_fault"],
};

/** Mirror server resolveCommandTarget — đích của lệnh theo ngữ cảnh. */
export function lineViewCommandTarget(
  command: LineViewCommand,
  current: LineViewState,
): { to: LineViewState; chainReadyFirst?: boolean } {
  switch (command) {
    case "start":
      return current === "idle" ? { to: "producing", chainReadyFirst: true } : { to: "producing" };
    case "hold":
      return { to: "held" };
    case "resume":
      return { to: "producing" };
    case "changeover":
      return { to: "changeover" };
    case "complete":
      if (current === "completing") return { to: "idle" };
      if (current === "changeover") return { to: "ready" };
      return { to: "completing" };
    case "reset_fault":
      return { to: "ready" };
  }
}

/**
 * Nút lệnh có nên enable không: lệnh nằm trong danh sách theo trạng thái VÀ
 * (mọi bước của) transition tương ứng hợp lệ theo map §4.1.
 */
export function isLineViewCommandEnabled(command: LineViewCommand, current: LineViewState): boolean {
  if (!LINE_VIEW_COMMANDS_BY_STATE[current]?.includes(command)) return false;
  const { to, chainReadyFirst } = lineViewCommandTarget(command, current);
  if (chainReadyFirst) {
    return (
      LINE_VIEW_TRANSITIONS[current].includes("ready") &&
      LINE_VIEW_TRANSITIONS.ready.includes("producing")
    );
  }
  return LINE_VIEW_TRANSITIONS[current].includes(to);
}

/**
 * riskLevel cho ConfirmWithReason (quyết định batch W3-B4):
 * start/hold/resume/complete = "low" (2 bước + lý do);
 * changeover/reset_fault = "high" (thêm gõ chuỗi xác nhận).
 */
export const LINE_VIEW_COMMAND_RISK: Record<LineViewCommand, "low" | "high"> = {
  start: "low",
  hold: "low",
  resume: "low",
  complete: "low",
  changeover: "high",
  reset_fault: "high",
};

/**
 * Tone StatusBadge theo trạng thái FSM — tinh thần ISA-101: nền trung tính,
 * màu đậm dành cho BẤT THƯỜNG (held/fault); trạng thái tiến trình dùng info,
 * producing (đang chạy tốt) dùng success.
 */
export const LINE_VIEW_STATE_TONE: Record<
  LineViewState,
  "default" | "success" | "warning" | "error" | "info"
> = {
  idle: "default",
  ready: "info",
  producing: "success",
  held: "warning",
  completing: "info",
  changeover: "info",
  fault: "error",
};

/** Format mili-giây → nhãn ngắn "12s" / "1m30s" / "2h05m" (hiển thị dwell/chu kỳ). */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m${String(rs).padStart(2, "0")}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h${String(rm).padStart(2, "0")}m` : `${h}h`;
}
