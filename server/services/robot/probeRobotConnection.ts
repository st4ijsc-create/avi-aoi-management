/**
 * doc 81 Đợt 1B Task 2 (phán quyết R8) — dò kết nối robot CÓ HẠN TỔNG (đường của
 * `robotRouter.testConnection`).
 *
 * Trước bản này router `await driver.connect()` → `getState()` → `disconnect()` không hạn:
 * robot/controller im lặng hoặc disconnect treo (Techman qua modbus-serial, BE1 §0 (1)) giữ
 * request vô hạn và rò socket. Nay: MỘT hạn tổng bao cả ba bước (probeWithDeadline), luôn dọn
 * (kể cả kết nối xong MUỘN sau hạn).
 */
import { probeWithDeadline } from "../ot/probeConnection";
import type { RobotConnectionConfig } from "./robotDriver";

/**
 * Hạn tổng mặc định (ms): driver robot mặc định chờ 5000 ms cho connect và 5000 ms cho mỗi
 * lời gọi (getState), cộng biên 2000 ms cho đóng có hạn.
 */
export const ROBOT_PROBE_TIMEOUT_MS = 12_000;

/** Phần tối thiểu của RobotDriver mà phép dò cần. */
export interface ProbeableRobot<S> {
  readonly vendor: string;
  connect(cfg: RobotConnectionConfig): Promise<void>;
  getState(): Promise<S>;
  disconnect(): Promise<void>;
}

/** connect → getState → disconnect trong một hạn tổng. Resolve state; reject lỗi gốc/hết hạn. */
export async function probeRobotConnection<S>(
  driver: ProbeableRobot<S>,
  cfg: RobotConnectionConfig,
  overallMs: number = ROBOT_PROBE_TIMEOUT_MS,
): Promise<S> {
  const { value } = await probeWithDeadline<S>(
    {
      label: `robot ${driver.vendor}`,
      connect: () => driver.connect(cfg),
      afterConnect: () => driver.getState(),
      disconnect: () => driver.disconnect(),
    },
    overallMs,
  );
  return value as S;
}
