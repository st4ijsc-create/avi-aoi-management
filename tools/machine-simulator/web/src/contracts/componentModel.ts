/**
 * Bản sao TypeScript của `contracts/component-model.schema.json` v1.
 *
 * Mọi property ở đây được ghim đối chiếu HAI CHIỀU với file schema bởi
 * `web/contract-tests/contracts.test.mjs`. Phía .NET có bài tương ứng
 * (`ComponentModelSchemaPinTests`); hai bài phải CÙNG đỏ khi schema đổi. Đó là toàn bộ lý do
 * hai bài tồn tại — xem `contracts/README.md`.
 *
 * 🔴 KHÔNG có `| null` ở bất kỳ trường tuỳ chọn nào — cùng luật đã ghi ở `tagNamespace.ts` và
 * `contracts/README.md`: một property vắng mặt CHÍNH LÀ null của nó, và `HmiContractJson.Options`
 * phía .NET (`WhenWritingNull`) không bao giờ phát ra một null tường minh. Đọc lý do đầy đủ ở đó
 * trước khi thêm trường mới ở đây.
 *
 * `dataType` và `policyAction` dùng LẠI `TagDataType`/`PolicyAction` từ `./tagNamespace` thay vì
 * khai lại — hai schema định nghĩa hai enum này với đúng cùng tập giá trị (`bool|int|float|string|enum`
 * và `machine.setpoint|machine.command`), và khai lại dưới một tên khác sẽ tạo ra hai "nguồn sự thật"
 * lệch nhau âm thầm nếu một bên đổi mà bên kia quên. Dùng lại KHÔNG phải một $ref liên-schema (JSON
 * Schema ở đây không có $ref liên file — xem `contracts/README.md`); đây thuần là một quyết định ở
 * tầng TypeScript.
 */

import type { PolicyAction, TagDataType } from "./tagNamespace"

export type ComponentTagRole = "in" | "out" | "setpoint" | "command"
export type ComponentStateTone = "run" | "warn" | "fault" | "idle"

export type ComponentTagDef = {
  name: string
  role: ComponentTagRole
  dataType: TagDataType
  /**
   * Giá trị của `dataType === "enum"`. Thêm ở fix round 2 (finding Important 3): schema cho phép
   * `dataType: "enum"` mà không có chỗ khai giá trị, trong khi `tag-namespace.schema.json` đã có
   * `enumValues` — hai schema bất đồng về đúng cùng một kiểu dữ liệu. Không `| null`: vắng mặt CHÍNH
   * LÀ null của nó.
   */
  enumValues?: string[]
  unit?: string
  /** Dải chặn cứng cho `role === "setpoint"` — bất biến an toàn, schema thi hành. */
  min?: number
  max?: number
  /** Bất biến §5: bắt buộc có mặt khi `role` là `"setpoint"` hoặc `"command"`. Schema thi hành. */
  policyAction?: PolicyAction
}

export type ComponentStateDef = {
  name: string
  expr: string
  tone: ComponentStateTone
}

export type ComponentTypeDef = {
  typeId: string
  label: string
  tags: ComponentTagDef[]
  states: ComponentStateDef[]
  defaultFaceplate: string
}

export type ComponentNode = {
  id: string
  typeId: string
  label: string
  parentId?: string
  tagPrefix: string
}

export type ComponentModelDocument = {
  schemaVersion: 1
  machineCode: string
  components: ComponentNode[]
  types: ComponentTypeDef[]
}
