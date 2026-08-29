/**
 * Bản sao TypeScript của `contracts/tag-namespace.schema.json` v1.
 *
 * Mọi property ở đây được ghim đối chiếu HAI CHIỀU với file schema bởi
 * `web/contract-tests/contracts.test.mjs`. Phía .NET có bài tương ứng
 * (`TagNamespaceSchemaPinTests`); hai bài phải CÙNG đỏ khi schema đổi. Đó là toàn bộ lý do
 * hai bài tồn tại — xem `contracts/README.md`.
 */

export type TagDataType = "bool" | "int" | "float" | "string" | "enum"
export type TagAccess = "r" | "rw"
export type PolicyAction = "machine.setpoint" | "machine.command"

/**
 * 🔴 KHÔNG có `| null` ở bất kỳ trường tuỳ chọn nào, và đó là hợp đồng chứ không phải phong cách.
 * Sau ruling ở Task 4: một tài liệu KHÔNG BAO GIỜ ghi `null` tường minh — khoá vắng mặt CHÍNH LÀ null.
 * Schema thi hành điều đó (`{"type":"string"}`, không phải `["string","null"]`), và bộ serializer C#
 * (`WhenWritingNull`) vốn không thể phát ra một null tường minh, nên một tài liệu chứa nó là tài liệu
 * mà bản tham chiếu .NET không round-trip được. Viết `| null` ở đây là mở lại đúng cái bẫy ấy.
 */
export type TagSource = {
  kind: "modbus" | "opcua" | "mqtt" | "simulated" | "derived"
  unitId?: number
  register?: number
  scale?: number
  nodeId?: string
  topic?: string
  jsonPath?: string
  expr?: string
}

export type TagDescriptor = {
  path: string
  dataType: TagDataType
  unit?: string
  engMin?: number
  engMax?: number
  enumValues?: string[]
  access: TagAccess
  /** Bất biến §5: bắt buộc có mặt khi `access === "rw"`. Schema thi hành; TypeScript không. */
  policyAction?: PolicyAction
  source: TagSource
  isBackedByDriver: boolean
}

export type TagNamespaceDocument = {
  schemaVersion: 1
  machineCode: string
  tags: TagDescriptor[]
}
