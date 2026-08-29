// Chạy: npm run test:contracts   (node --test, không thêm package nào)
//
// 🔴 Bài này KHÔNG đo: (1) phía C# đọc cùng fixture ra cùng kết quả — đó là
// `tests/St4i.Hmi.Contracts.Tests`, và hai bên cố ý dùng CHUNG một corpus để một fixture mới bắt
// buộc cả hai phải xanh; (2) type TypeScript có ĐÚNG KIỂU không — bài ghim chỉ so TÊN property,
// sai kiểu do `tsc -b` bắt khi `web/src/contracts/*.ts` được dùng thật ở WS-HMI-1; (3) bất kỳ luật
// ISA-101 nào — đó là WS-HMI-4.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { validate, assertKnownKeywords } from "./validate.mjs"

// web/contract-tests → web → tools/machine-simulator → contracts
const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACTS = join(HERE, "..", "..", "contracts")

const SCHEMAS = {
  "tags-": "tag-namespace.schema.json",
  "components-": "component-model.schema.json",
  "screen-": "hmi-screen.schema.json",
}

const load = (f) => JSON.parse(readFileSync(join(CONTRACTS, f), "utf8"))
const fixtures = (bucket, prefix) =>
  readdirSync(join(CONTRACTS, "fixtures", bucket))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()

for (const [prefix, schemaFile] of Object.entries(SCHEMAS)) {
  const schema = load(schemaFile)

  test(`${schemaFile}: chỉ dùng từ khoá bộ validate này hiểu`, () => {
    assertKnownKeywords(schema)
  })

  test(`${schemaFile}: corpus hợp lệ không rỗng`, () => {
    assert.ok(fixtures("valid", prefix).length > 0, `không có fixture valid/${prefix}*`)
  })

  for (const f of fixtures("valid", prefix)) {
    test(`${schemaFile}: chấp nhận valid/${f}`, () => {
      const errs = validate(schema, schema, load(join("fixtures", "valid", f)))
      assert.deepEqual(errs, [], `đáng lẽ hợp lệ nhưng báo lỗi:\n${errs.join("\n")}`)
    })
  }

  for (const f of fixtures("invalid", prefix)) {
    test(`${schemaFile}: TỪ CHỐI invalid/${f}`, () => {
      const errs = validate(schema, schema, load(join("fixtures", "invalid", f)))
      assert.ok(errs.length > 0, `đáng lẽ bị từ chối nhưng lại hợp lệ — luật trong tên file không chặn`)
    })
  }
}

// ── Ghim hai chiều schema ⟷ type TypeScript ───────────────────────────────────
// Không đọc được type TS lúc chạy, nên bài này đọc TÊN PROPERTY từ chính file .ts bằng cách bóc
// các khối `export type X = { ... }`. Thô, nhưng đúng thứ cần: nó đỏ khi hai bên lệch tên.

const TS_SOURCES = {
  "tag-namespace.schema.json": "tagNamespace.ts",
  "component-model.schema.json": "componentModel.ts",
  "hmi-screen.schema.json": "hmiScreen.ts",
}

const PIN = {
  "tag-namespace.schema.json": [
    [[], "TagNamespaceDocument"],
    [["$defs", "tag"], "TagDescriptor"],
  ],
  "component-model.schema.json": [
    [[], "ComponentModelDocument"],
    [["$defs", "component"], "ComponentNode"],
    [["$defs", "componentType"], "ComponentTypeDef"],
    [["$defs", "componentTag"], "ComponentTagDef"],
    [["$defs", "componentState"], "ComponentStateDef"],
  ],
  "hmi-screen.schema.json": [
    [[], "HmiScreenDocument"],
    [["$defs", "layout"], "ScreenLayout"],
    [["$defs", "widget"], "ScreenWidget"],
    [["$defs", "rect"], "WidgetRect"],
  ],
}

function tsProps(sourceFile, typeName) {
  const src = readFileSync(join(HERE, "..", "src", "contracts", sourceFile), "utf8")
  const m = new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\}`).exec(src)
  assert.ok(m, `không tìm thấy "export type ${typeName} = {" trong ${sourceFile}`)
  return new Set([...m[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1]))
}

for (const [schemaFile, pins] of Object.entries(PIN)) {
  const schema = load(schemaFile)
  for (const [pointer, typeName] of pins) {
    test(`${schemaFile} ⟷ ${typeName}: cùng tập tên property`, () => {
      const node = pointer.reduce((n, seg) => n[seg], schema)
      const inSchema = new Set(Object.keys(node.properties))
      const inTs = tsProps(TS_SOURCES[schemaFile], typeName)

      const missingFromTs = [...inSchema].filter((k) => !inTs.has(k)).sort()
      const missingFromSchema = [...inTs].filter((k) => !inSchema.has(k)).sort()

      assert.deepEqual(missingFromTs, [], `schema khai nhưng TS thiếu: ${missingFromTs}`)
      assert.deepEqual(missingFromSchema, [], `TS khai nhưng schema thiếu: ${missingFromSchema}`)
    })
  }
}

// ── Ghim hai chiều $defs/source ⟷ TagSource (gộp mọi nhánh oneOf) ─────────────
// 🔴 Fix round 1, finding 1: `$defs/source` là `oneOf`, không có một `properties` gốc để PIN ở
// trên trỏ tới — mỗi nhánh (modbus/opcua/mqtt/simulated/derived) có `properties` riêng của nó. Đây
// là bài ghim DUY NHẤT của `TagSource`: gộp property của cả 5 nhánh rồi so HAI CHIỀU với `TagSource`
// phẳng bên `tagNamespace.ts`. Mirror của
// `TagNamespaceSchemaPinTests.TagSource_covers_every_source_kind_and_every_branch_field_the_schema_allows`
// phía C# — hai bài phải CÙNG đỏ khi một nhánh source thêm/bớt field. Trước đợt sửa này bài này
// không tồn tại ở phía web: thêm/bớt field trên một nhánh làm C# đỏ ngay còn web im lặng — đúng
// kiểu drift Mốc 0 tồn tại để ngăn.
test("tag-namespace.schema.json ⟷ TagSource: cùng tập tên property (gộp mọi nhánh oneOf)", () => {
  const schema = load("tag-namespace.schema.json")
  const oneOf = schema.$defs.source.oneOf

  const kinds = new Set(oneOf.map((branch) => branch.properties.kind.const))
  assert.equal(kinds.size, 5, `kỳ vọng đúng 5 kind nguồn, có ${kinds.size}: ${[...kinds].join(", ")}`)

  const allBranchProps = new Set(oneOf.flatMap((branch) => Object.keys(branch.properties)))
  const inTs = tsProps("tagNamespace.ts", "TagSource")

  const missingFromTs = [...allBranchProps].filter((k) => !inTs.has(k)).sort()
  const missingFromSchema = [...inTs].filter((k) => !allBranchProps.has(k)).sort()

  assert.deepEqual(missingFromTs, [], `nhánh oneOf khai nhưng TagSource thiếu: ${missingFromTs}`)
  assert.deepEqual(
    missingFromSchema, [],
    `TagSource khai nhưng không nhánh oneOf nào có: ${missingFromSchema}`,
  )
})
