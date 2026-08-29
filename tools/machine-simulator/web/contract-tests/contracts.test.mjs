// Chạy: npm run test:contracts   (node --test, không thêm package nào)
//
// 🔴 Bài này KHÔNG đo: (1) phía C# đọc cùng fixture ra cùng kết quả — đó là
// `tests/St4i.Hmi.Contracts.Tests`, và hai bên cố ý dùng CHUNG một corpus để một fixture mới bắt
// buộc cả hai phải xanh; (2) type TypeScript có ĐÚNG KIỂU KHÔNG-PHẢI-ENUM không — bài ghim so TÊN
// property, và (từ fix round 2) so GIÁ TRỊ của mọi `properties.*.enum` với union TypeScript tương
// ứng; nó KHÔNG so `string` vs `number` vs `boolean`, cũng không so hình dạng lồng nhau — những sai
// lệch ấy do `tsc -b` bắt khi `web/src/contracts/*.ts` được dùng thật ở WS-HMI-1; (3) bất kỳ luật
// ISA-101 nào — đó là WS-HMI-4; (4) bộ validate có THI HÀNH đúng JSON Schema không — nó là bản viết
// tay một phần, và các bài "vị trí … bị TỪ CHỐI" bên dưới đo đúng chỗ nó KHÔNG thi hành.

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

// 🔴 Fix round 2, finding Important 4. Mỗi fixture `invalid/` khai chuỗi con phải xuất hiện trong danh
// sách lỗi — tức là LUẬT NÊU TRONG TÊN FILE, không phải "một lỗi nào đó". `contracts/README.md` khoản 3
// đã đòi "tên file phải nêu luật bị vi phạm"; bảng này là phép đo biến câu ấy thành máy kiểm được.
// Không có mục ⇒ bài ĐỎ (xem khẳng định trong vòng lặp và bài "không thừa, không thiếu" bên dưới).
const INVALID_FIXTURE_EXPECTS = {
  "components-setpoint-without-hard-band.json": 'thiếu trường bắt buộc "min"',
  "components-writable-tag-without-policy-action.json": 'thiếu trường bắt buộc "policyAction"',
  "screen-binding-value-not-string.json": "bindings.value: kiểu integer, schema đòi string",
  "screen-write-widget-without-policy-action.json": 'thiếu trường bắt buộc "policyAction"',
  "tags-float-without-eng-range.json": 'thiếu trường bắt buộc "engMin"',
  "tags-rw-without-policy-action.json": 'thiếu trường bắt buộc "policyAction"',
}

test("INVALID_FIXTURE_EXPECTS phủ đúng corpus invalid/ — không thừa, không thiếu", () => {
  // Chiều "thiếu" đã được vòng lặp trên bắt. Chiều "thừa" cần bài riêng: một mục trỏ tới file đã bị
  // đổi tên/xoá là dấu hiệu bảng đã cũ, và một bảng cũ che đúng thứ nó sinh ra để đo.
  const onDisk = readdirSync(join(CONTRACTS, "fixtures", "invalid"))
    .filter((f) => f.endsWith(".json")).sort()
  assert.deepEqual(Object.keys(INVALID_FIXTURE_EXPECTS).sort(), onDisk)
})

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

      // 🔴 Fix round 2, finding Important 4: `errs.length > 0` chứng minh "có cái gì đó hỏng", KHÔNG
      // chứng minh LUẬT NÊU TRONG TÊN FILE đã chặn. Sáu fixture hôm nay đúng là nhân chứng một-luật,
      // nhưng đây là bằng chứng DUY NHẤT rằng hai bất biến an toàn thật sự cắn, và nó chỉ cách một
      // lần sửa fixture bất cẩn là sẽ xanh vì một lý do chẳng liên quan (gõ nhầm một `theme`, đổi một
      // `role` — vẫn "có lỗi", vẫn xanh, luật §5 không còn được đo). Nên: mỗi fixture `invalid/` phải
      // khai một chuỗi con kỳ vọng, và lỗi mang chuỗi ấy phải CÓ MẶT trong danh sách.
      const expected = INVALID_FIXTURE_EXPECTS[f]
      assert.ok(
        expected !== undefined,
        `fixture invalid/${f} chưa có mục trong INVALID_FIXTURE_EXPECTS. Một fixture không khai kỳ ` +
        `vọng phải làm bài này ĐỎ, không phải được bỏ qua — nếu không thì thêm một fixture là cách ` +
        `âm thầm hạ chuẩn của bài này.`)
      assert.ok(
        errs.some((e) => e.includes(expected)),
        `invalid/${f} bị từ chối, nhưng KHÔNG phải vì luật trong tên file.\n` +
        `  kỳ vọng một lỗi chứa: ${expected}\n  thực tế:\n${errs.map((e) => `    ${e}`).join("\n")}`)
    })
  }
}

// ── Vị trí từ khoá KHÔNG được thi hành ⇒ phải bị TỪ CHỐI ───────────────────────
// 🔴 Fix round 2, finding Critical 1. `validate.mjs` hứa (nguyên văn ở đầu file đó) rằng "một từ khoá
// không được hiểu mà bị bỏ qua chính là cách một bộ validate viết tay trở thành lời nói dối" — và
// trước đợt sửa này lời hứa ấy SAI: `KNOWN` nhận `if`/`then`/`items`/`$ref` ở BẤT CỨ ĐÂU, còn
// `validate` chỉ đọc chúng ở đúng một vị trí. Năm hình dạng dưới đây đều được guard CŨ chấp nhận và
// `validate` CŨ trả về `[]` — đo thật, không suy. Mỗi bài dưới đây là một lần NHÌN THẤY guard mới bắn;
// một guard chưa ai thấy bắn thì không phân biệt được với một guard không thể bắn.
//
// 🔴 Bài này KHÔNG đo: các vị trí ấy có được THI HÀNH hay không — chúng KHÔNG được thi hành, và đó là
// chủ ý. Đây là bài đo "từ chối to tiếng", không phải bài đo "hiểu đúng".
const REJECTED_POSITIONS = [
  {
    name: "P1 if/then đặt thẳng trên một nút, không trong allOf (cách tự nhiên nhất để thêm điều kiện thứ ba)",
    schema: {
      type: "object",
      properties: {
        widget: {
          type: "object",
          required: ["kind"],
          properties: { kind: { enum: ["readout", "command-button"] }, policyAction: { enum: ["machine.command"] } },
          if: { properties: { kind: { const: "command-button" } }, required: ["kind"] },
          then: { required: ["policyAction"] },
        },
      },
    },
    // Chứng cứ vì sao P1 là cái nguy hiểm nhất: một `command-button` KHÔNG có `policyAction` đi lọt.
    silentlyAccepts: { widget: { kind: "command-button" } },
    expect: "if/then chỉ được thi hành khi là thành viên TRỰC TIẾP",
  },
  {
    name: "P2 then trong một phần tử allOf mà không có if anh em",
    schema: { type: "object", properties: { policyAction: { type: "string" } }, allOf: [{ then: { required: ["policyAction"] } }] },
    silentlyAccepts: {},
    expect: "if và then phải đi CÙNG NHAU",
  },
  {
    name: "P3 $ref kèm anh em minLength/pattern",
    schema: {
      type: "object",
      properties: { name: { $ref: "#/$defs/str", minLength: 5, pattern: "^[a-z]+$" } },
      $defs: { str: { type: "string" } },
    },
    silentlyAccepts: { name: "AB" },
    expect: "$ref không được thi hành cùng anh em kế bên",
  },
  {
    name: "P4 items dạng tuple [ {...}, {...} ]",
    schema: { type: "array", items: [{ type: "string" }, { type: "string" }] },
    silentlyAccepts: [1, 2, 3],
    expect: "items dạng tuple (mảng) không được thi hành",
  },
  {
    name: "P5 additionalProperties dạng mảng",
    schema: { type: "object", properties: {}, additionalProperties: [{ type: "string" }] },
    silentlyAccepts: { anything: 42 },
    expect: "additionalProperties dạng mảng không được thi hành",
  },
]

for (const p of REJECTED_POSITIONS) {
  test(`validate.mjs: vị trí không thi hành được bị TỪ CHỐI — ${p.name}`, () => {
    assert.throws(
      () => assertKnownKeywords(p.schema),
      (e) => e instanceof Error && e.message.includes(p.expect),
      `guard đã KHÔNG ném lỗi nêu "${p.expect}" cho hình dạng này`)

    // Chiều thứ hai, và là chiều giải thích VÌ SAO guard phải ném: nếu guard im lặng thì tài liệu
    // dưới đây validate SẠCH dù một bộ validate JSON Schema thật từ chối nó. Khẳng định `[]` ở đây
    // không phải mong muốn — nó là phép đo lỗ hổng mà guard tồn tại để bịt.
    assert.deepEqual(
      validate(p.schema, p.schema, p.silentlyAccepts), [],
      `hình dạng này hoá ra ĐÃ được validate() thi hành — nếu vậy hãy gỡ guard tương ứng thay vì giữ ` +
      `một lời từ chối không còn đúng`)
  })
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

const tsSource = (sourceFile) => readFileSync(join(HERE, "..", "src", "contracts", sourceFile), "utf8")

const tsTypeBody = (sourceFile, typeName) => {
  const m = new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\}`).exec(tsSource(sourceFile))
  assert.ok(m, `không tìm thấy "export type ${typeName} = {" trong ${sourceFile}`)
  return m[1]
}

function tsProps(sourceFile, typeName) {
  return new Set([...tsTypeBody(sourceFile, typeName).matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1]))
}

/** Tên kiểu khai cho MỘT property, ví dụ `kind: WidgetKind` → `"WidgetKind"`. */
function tsPropTypeName(sourceFile, typeName, prop) {
  const m = new RegExp(`^ {2}${prop}\\??:\\s*(.+?)\\s*$`, "m").exec(tsTypeBody(sourceFile, typeName))
  assert.ok(m, `không tìm thấy property "${prop}" trong ${typeName} (${sourceFile})`)
  assert.match(
    m[1], /^[A-Za-z_]\w*$/,
    `${typeName}.${prop} khai một union NỘI TUYẾN (${m[1]}) chứ không phải một union có tên. Bài ghim ` +
    `enum này chỉ phân giải được union có tên; nếu vị trí này thật sự cần union nội tuyến thì hãy MỞ ` +
    `RỘNG bài ghim trước, đừng để nó im lặng bỏ qua một enum`)
  return m[1]
}

/**
 * Thành viên của một union có tên, THEO CẢ IMPORT sang file khác.
 *
 * 🔴 Fix round 2, finding Important 5: việc "theo import" chính là phép đo. `componentModel.ts` và
 * `hmiScreen.ts` import `PolicyAction`/`TagDataType` từ `tagNamespace.ts` thay vì khai lại — đó là
 * lựa chọn ĐÚNG (một nguồn sự thật), nhưng nó có nghĩa là nới enum `policyAction` của
 * `tag-namespace.schema.json` sẽ âm thầm nới luôn hai kiểu TypeScript kia RỘNG HƠN schema của chính
 * chúng cho phép — và `policyAction` đúng là chỗ các giá trị an toàn sống. Bài ghim phải đi qua
 * import thì mới nhìn thấy chuyện đó; nếu nó chỉ đọc một file, cái widen sẽ vô hình.
 */
function tsUnionMembers(sourceFile, unionName) {
  const src = tsSource(sourceFile)
  const decl = new RegExp(`export type ${unionName} =((?:.|\\n)*?)(?=\\n(?!\\s*\\|)|$)`).exec(src)
  if (decl) return new Set([...decl[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]))

  for (const m of src.matchAll(/import type \{([^}]*)\} from "\.\/(\w+)"/g))
    if (m[1].split(",").map((s) => s.trim()).includes(unionName))
      return tsUnionMembers(`${m[2]}.ts`, unionName)

  assert.fail(`không tìm thấy "export type ${unionName} =" trong ${sourceFile}, và không import nào mang tên đó`)
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

// ── Ghim hai chiều GIÁ TRỊ enum ⟷ union TypeScript ────────────────────────────
// 🔴 Fix round 2, finding Important 5. Vòng lặp ngay trên chỉ so TÊN property, và phía C# type MỌI enum
// của schema thành `string` — nên cho tới đợt này, GIÁ TRỊ của enum không được ghim ở BẤT KỲ phía nào.
// Nới `policyAction` thành ["machine.setpoint","machine.command","machine.raw"] là hợp lệ theo luật
// cộng-thêm và không làm một bài nào đỏ. Bài dưới đây đóng chiều đó, và nó phân giải union QUA IMPORT
// (xem `tsUnionMembers`) nên nó cũng thấy được cái widen lan từ `tagNamespace.ts` sang hai file kia.
//
// 🔴 KHÔNG đo: (1) enum của các nhánh `$defs/source` — chúng là `const` một-giá-trị, đã do bài
// `⟷ TagSource` phủ; (2) `schemaVersion` — là `const`, không phải `enum`; (3) TypeScript có DÙNG union
// ấy đúng chỗ hay không — đó là việc của `tsc -b`.
const ENUM_PINS = Object.entries(PIN).flatMap(([schemaFile, pins]) => {
  const schema = load(schemaFile)
  return pins.flatMap(([pointer, typeName]) =>
    Object.entries(pointer.reduce((n, seg) => n[seg], schema).properties)
      .filter(([, sub]) => sub.enum)
      .map(([prop, sub]) => ({ schemaFile, typeName, prop, members: sub.enum })))
})

// Khẳng định KHÔNG RỖNG / KHÔNG CŨ, theo đúng khuôn `Exemption_list_is_not_stale` phía C#: nếu một
// `properties.*.enum` biến mất khỏi schema thì bài ghim của nó cũng biến mất, và một bộ test "xanh" vì
// không còn đo gì là đúng cái bẫy khuôn ghim hai chiều tồn tại để chặn.
test("ghim enum phủ đúng mọi properties.*.enum của ba schema — không thừa, không thiếu", () => {
  assert.deepEqual(ENUM_PINS.map((p) => `${p.typeName}.${p.prop}`), [
    "TagDescriptor.dataType",
    "TagDescriptor.access",
    "TagDescriptor.policyAction",
    "ComponentTagDef.role",
    "ComponentTagDef.dataType",
    "ComponentTagDef.policyAction",
    "ComponentStateDef.tone",
    "HmiScreenDocument.theme",
    "ScreenLayout.breakpoint",
    "ScreenWidget.kind",
    "ScreenWidget.policyAction",
  ])
})

for (const { schemaFile, typeName, prop, members } of ENUM_PINS) {
  test(`${schemaFile} ⟷ ${typeName}.${prop}: cùng tập GIÁ TRỊ enum`, () => {
    const sourceFile = TS_SOURCES[schemaFile]
    const unionName = tsPropTypeName(sourceFile, typeName, prop)
    const inTs = tsUnionMembers(sourceFile, unionName)

    const missingFromTs = members.filter((v) => !inTs.has(v)).sort()
    const missingFromSchema = [...inTs].filter((v) => !members.includes(v)).sort()

    assert.deepEqual(
      missingFromTs, [],
      `schema cho phép nhưng union ${unionName} (${sourceFile}) thiếu: ${missingFromTs}`)
    assert.deepEqual(
      missingFromSchema, [],
      `union ${unionName} cho phép nhưng schema ${schemaFile} không: ${missingFromSchema}`)
  })
}

// ── Bất biến §5 phía web: tập access ghi được ⟷ luật allOf ────────────────────
// 🔴 Fix round 2, finding Critical 2. Mirror của
// `TagNamespaceSchemaPinTests.Every_writable_access_is_covered_by_the_policy_action_rule`. Hai bài
// phải CÙNG đỏ — đó là toàn bộ lý do Mốc 0 giữ hai bộ ghim thay vì một. Reviewer đã nới `access`
// thành ["r","rw","w"] (một thay đổi cộng-thêm mà `contracts/README.md` cho phép) rồi validate một
// tag `"access":"w"` không có `policyAction`: 0 lỗi, mọi test xanh — vì `access` là guard DUY NHẤT
// trong ba guard không có bài "tập được gác BẰNG tập ghi được".
test("tag-namespace.schema.json: mọi access ghi được đều được luật policyAction phủ", () => {
  const tag = load("tag-namespace.schema.json").$defs.tag
  assert.deepEqual([...tag.properties.access.enum].sort(), ["r", "rw"])
  assert.equal(tag.allOf[0].if.properties.access.const, "rw")
  assert.ok(
    tag.properties.access.enum.includes(tag.allOf[0].if.properties.access.const),
    "luật allOf[0] gác một giá trị access không có trong enum — luật đã chết mà không ai thấy")
})

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
