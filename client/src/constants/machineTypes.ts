/**
 * Sprint F2 → doc 56 Đ0 việc 6: file này KHÔNG còn là nguồn dữ liệu runtime.
 *
 * @deprecated làm DATA SOURCE — từ vựng loại máy (24 loại + deviceClass) do
 * server phục vụ qua tRPC `machine.listTypes` (server/routers/hierarchyRouters.ts,
 * chiếu từ server/constants/machineTypes.ts). Client dùng hook
 * `@/hooks/useMachineTypes` (có fallback tĩnh khi query đang tải/lỗi) và
 * component `@/components/MachineTypeSelectOptions` cho dropdown.
 * KHÔNG fork lại mảng runtime ở đây.
 *
 * Chỉ còn TYPE cho các khai báo tĩnh (form state, props). Union PHẢI đồng bộ
 * với `MACHINE_TYPES` trong server/constants/machineTypes.ts (order + values).
 */
export type MachineType =
  | "AVI"
  | "AOI"
  | "SPI"
  | "AXI"
  | "ICT"
  | "FCT"
  | "CMM"
  | "AUTOMATION"
  | "FEEDER"
  | "ASSEMBLY"
  | "SCREWDRIVE"
  | "DISPENSING"
  | "ICT_FUNC"
  | "ROBOT_TEST"
  | "PACKAGING"
  | "PALLETIZER"
  | "ROBOT"
  | "MOUNTER"
  | "REFLOW"
  | "STENCIL_PRINTER"
  | "WAVE_SOLDER"
  | "WELDER"
  | "IOT_SENSOR"
  | "IOT_GATEWAY";
