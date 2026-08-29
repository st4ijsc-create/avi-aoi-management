/**
 * Bản sao TypeScript của `contracts/hmi-screen.schema.json` v1.
 *
 * Mọi property ở đây được ghim đối chiếu HAI CHIỀU với file schema bởi
 * `web/contract-tests/contracts.test.mjs`. Phía .NET có bài tương ứng
 * (`HmiScreenSchemaPinTests`); hai bài phải CÙNG đỏ khi schema đổi. Đó là toàn bộ lý do
 * hai bài tồn tại — xem `contracts/README.md`.
 *
 * 🔴 KHÔNG có `| null` ở bất kỳ trường tuỳ chọn nào — cùng luật đã ghi ở `tagNamespace.ts` và
 * `contracts/README.md`: một property vắng mặt CHÍNH LÀ null của nó, và `HmiContractJson.Options`
 * phía .NET (`WhenWritingNull`) không bao giờ phát ra một null tường minh. Đọc lý do đầy đủ ở đó
 * trước khi thêm trường mới ở đây.
 *
 * `policyAction` dùng LẠI `PolicyAction` từ `./tagNamespace` thay vì khai lại — ba schema (tag
 * namespace, component model, màn hình này) định nghĩa enum này với đúng cùng tập giá trị
 * (`machine.setpoint|machine.command`). Xem lý do đầy đủ ở doc-comment đầu `componentModel.ts`.
 */

import type { PolicyAction } from "./tagNamespace"

export type ScreenTheme = "isa101" | "blueprint"
export type ScreenBreakpoint = "panel" | "tablet" | "phone"

export type WidgetKind =
  | "readout"
  | "status-lamp"
  | "gauge"
  | "trend"
  | "alarm-banner"
  | "alarm-list"
  | "log"
  | "faceplate"
  | "label"
  | "sheet"
  | "kpi-tile"
  | "state-badge"
  | "setpoint-input"
  | "command-button"
  | "line-state"

export type WidgetRect = {
  col: number
  row: number
  colSpan: number
  rowSpan: number
}

export type ScreenLayout = {
  cols: number
  rows: number
  breakpoint: ScreenBreakpoint
}

export type ScreenWidget = {
  id: string
  kind: WidgetKind
  rect: WidgetRect
  /** Bật indirect binding: `{component}` trong `bindings` được thay bằng `tagPrefix` của linh kiện này. */
  component?: string
  bindings?: Record<string, string>
  props?: Record<string, unknown>
  /** Bất biến §5: bắt buộc có mặt khi `kind` là `"setpoint-input"` hoặc `"command-button"`. Schema thi hành. */
  policyAction?: PolicyAction
}

export type HmiScreenDocument = {
  schemaVersion: 1
  screenId: string
  title: string
  titleEn?: string
  theme: ScreenTheme
  layout: ScreenLayout
  widgets: ScreenWidget[]
}
