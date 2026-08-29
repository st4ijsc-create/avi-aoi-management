// ─────────────────────────────────────────────────────────────────────────────
// Bộ validate JSON Schema TỐI THIỂU, viết tay, cho đúng ba schema của `contracts/`.
//
// VÌ SAO KHÔNG DÙNG AJV: Mốc 0 có ràng buộc "không thêm npm package" (xem blueprint §Global
// Constraints). Đổi lại, bộ này CHỈ hiểu các từ khoá ba schema ấy thật sự dùng — và từ đợt sửa
// round 2, "hiểu" nghĩa là hiểu ĐÚNG MỘT VỊ TRÍ, không phải "ở bất cứ đâu". Danh sách đầy đủ, kèm
// vị trí được THI HÀNH:
//
//   type · const · enum · required · minLength · minimum · maximum · pattern
//        — mọi nút schema
//   properties · additionalProperties (đúng hai dạng: `false`, hoặc MỘT schema)
//        — mọi nút object; `additionalProperties` dạng MẢNG bị từ chối
//   items — CHỈ dạng schema (một object). Dạng tuple (`[ {...}, {...} ]`) bị từ chối
//   oneOf · allOf — mảng schema
//   if / then — CHỈ khi là thành viên TRỰC TIẾP của một phần tử `allOf`, và phải ĐI CÙNG NHAU
//   $ref — chỉ nội bộ (`#/...`), và KHÔNG được có anh em kế bên nào ngoài `$comment`
//   $schema · $id · $defs · title · $comment — chú thích: đọc rồi bỏ qua có chủ ý (JSON Schema
//        không gán cho chúng nghĩa validate nào, nên bỏ qua chúng không phải bỏ qua một phép kiểm)
//
// 🔴 NÓ KHÔNG PHẢI BỘ VALIDATE TỔNG QUÁT. Nếu ai đó thêm một từ khoá ngoài danh sách trên, HOẶC đặt
// một từ khoá trong danh sách vào một vị trí ngoài bảng trên, `assertKnownKeywords` dưới đây NÉM
// LỖI thay vì bỏ qua âm thầm — một từ khoá không được hiểu mà bị bỏ qua chính là cách một bộ
// validate viết tay trở thành lời nói dối.
//
// 🔴 VÌ SAO CÂU TRÊN PHẢI NÓI CẢ VỊ TRÍ (fix round 2, finding Critical 1). Trước đợt sửa này, khối
// bình luận ở đây hứa đúng câu vừa rồi — và chính nó là lời nói dối mà nó cảnh báo. `KNOWN` nhận
// `if` · `then` · `items` · `$ref` Ở BẤT CỨ ĐÂU, trong khi `validate` bên dưới chỉ đọc `if`/`then`
// khi chúng là thành viên trực tiếp của một phần tử `allOf`, chỉ đọc `items` dạng schema, và RETURN
// ngay sau khi phân giải `$ref` nên mọi anh em kế bên của `$ref` bốc hơi. Năm hình dạng dưới đây
// đều được `assertKnownKeywords` CŨ chấp nhận và `validate` CŨ trả về `[]` (đo thật, không suy):
//   (1) `if`/`then` đặt THẲNG trên một nút, không nằm trong `allOf`. Đây là hình dạng nguy hiểm
//       nhất: nó là cách TỰ NHIÊN NHẤT để ai đó thêm điều kiện thứ ba vào `$defs/widget`, nó hợp lệ
//       theo JSON Schema, một bộ validate thật THI HÀNH nó — còn bộ này thì không, nên một
//       `command-button` không có `policyAction` đi lọt sạch. Nghĩa là bất biến §5 ("không có đường
//       ghi không gác") bị vô hiệu hoá bằng một lần sửa schema HỢP LỆ và ĐƯỢC PHÉP theo luật cộng-
//       thêm của `contracts/README.md` — không ai phải phá một luật nào cả.
//   (2) `then` trong một phần tử `allOf` mà không có `if` anh em: `validate` rơi vào nhánh "schema
//       thường" và `then` bị bỏ qua hoàn toàn.
//   (3) `$ref` kèm anh em `minLength`/`pattern`: ràng buộc anh em không bao giờ được đọc.
//   (4) `items` dạng tuple `[ {...}, {...} ]`: `validate` truyền cả MẢNG vào chỗ chờ một schema,
//       mảng không có từ khoá nào, nên mọi phần tử hợp lệ.
//   (5) `additionalProperties` dạng mảng (vốn không hợp lệ trong JSON Schema): cùng lớp lỗi (4).
// ĐÃ SỬA BẰNG CÁCH TỪ CHỐI, KHÔNG PHẢI BẰNG CÁCH THI HÀNH — đó mới là posture của file này: thà đỏ
// to tiếng còn hơn kiểm một phần trong im lặng. Ai thật sự cần một trong năm vị trí ấy thì phải THI
// HÀNH nó trong `validate` TRƯỚC rồi mới nới guard, hai việc trong cùng một commit. Năm hình dạng
// trên được ghim bằng test ở `contracts.test.mjs` ("vị trí … bị TỪ CHỐI"), nên đây là guard ĐÃ ĐƯỢC
// NHÌN THẤY BẮN, không phải guard được tin là bắn.
//
// 🔴 `additionalProperties` được THI HÀNH ở đúng hai dạng, không hơn: `false` (cấm mọi khoá lạ
// ngoài `properties`) và MỘT SCHEMA — dạng bản đồ tên→giá trị, dùng cho `bindings`
// (`{"type":"object","additionalProperties":{"type":"string"}}`, một node KHÔNG có `properties`
// nào cả). Trước một đợt sửa (fix round 1), dạng schema nằm trong danh sách từ khoá "hiểu được" ở
// trên nhưng KHÔNG được thi hành — `{"bindings":{"value":42}}` (giá trị không phải string) validate
// sạch dù cả schema lẫn `Record<string, string>` bên TypeScript đều đòi string. Đã sửa: nhánh dưới
// (`schema.additionalProperties` là object) chạy ĐỘC LẬP với `schema.properties` có mặt hay không,
// và validate GIÁ TRỊ của mọi khoá không thuộc `properties` (hoặc mọi khoá, nếu node không có
// `properties`) theo schema đó. Fixture `invalid/screen-binding-value-not-string.json` chứng minh
// nó giờ thật sự chặn.
// ─────────────────────────────────────────────────────────────────────────────

// `$comment` nằm trong danh sách này một cách có chủ ý: JSON Schema KHÔNG gán cho nó nghĩa validate
// nào, nên đọc-rồi-bỏ-qua nó không phải là bỏ qua một phép kiểm. Nó là anh em kế bên DUY NHẤT mà
// `$ref` được phép có (xem guard `$ref` bên dưới) — chỗ tự nhiên để giải thích một `$ref` mà không
// làm bốc hơi ràng buộc nào.
const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "$comment", "title", "type", "const", "enum", "required",
  "additionalProperties", "properties", "items", "minLength", "minimum", "maximum",
  "pattern", "oneOf", "allOf", "if", "then",
])

// 🔴 Đệ quy phải phân biệt NÚT SCHEMA với BẢN ĐỒ TÊN→SCHEMA. Khoá của `properties` và `$defs` là tên do
// người dùng đặt ("machineCode", "tag"), KHÔNG phải từ khoá — kiểm chúng với KNOWN sẽ ném lỗi trên mọi
// schema hợp lệ. Chỉ đi xuống những chỗ thật sự chứa nút schema; `enum`/`required`/`pattern`/`const` là
// giá trị lá, không đi xuống.
//
// 🔴 `isAllOfElement` KHÔNG phải tham số trang trí. Nó là toàn bộ khác biệt giữa "từ khoá này có
// trong danh sách" và "từ khoá này ở vị trí `validate` thật sự đọc" — xem khối Critical 1 ở đầu file.
// Nó chỉ TRUE cho các phần tử trực tiếp của một mảng `allOf`, và trở lại FALSE ngay khi đi xuống
// `if`/`then`/`properties`/`items` bên trong phần tử ấy: một `if` lồng trong một `then` cũng là vị trí
// `validate` không đọc.
export function assertKnownKeywords(node, path = "#", isAllOfElement = false) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return

  for (const k of Object.keys(node)) {
    if (!KNOWN.has(k)) throw new Error(`từ khoá schema chưa được hỗ trợ: ${k} tại ${path}`)
  }

  const hasIf = "if" in node
  const hasThen = "then" in node

  if ((hasIf || hasThen) && !isAllOfElement)
    throw new Error(
      `if/then chỉ được thi hành khi là thành viên TRỰC TIẾP của một phần tử allOf; gặp ` +
      `${hasIf ? "if" : "then"} tại ${path}. validate() KHÔNG đọc if/then ở vị trí này — để nguyên ` +
      `thì điều kiện bị bỏ qua âm thầm. Hoặc gói nó vào allOf, hoặc thi hành vị trí này trong ` +
      `validate() trước khi nới guard.`)

  if (hasIf !== hasThen)
    throw new Error(
      `if và then phải đi CÙNG NHAU trong một phần tử allOf; tại ${path} chỉ có ` +
      `${hasIf ? "if (thiếu then — validate() sẽ nổ khi if khớp)" : "then (thiếu if — validate() bỏ qua then hoàn toàn)"}.`)

  if (Array.isArray(node.items))
    throw new Error(
      `items dạng tuple (mảng) không được thi hành; tại ${path}. validate() truyền cả mảng vào chỗ ` +
      `chờ MỘT schema, nên mọi phần tử hợp lệ. Dùng items dạng schema.`)

  if (Array.isArray(node.additionalProperties))
    throw new Error(
      `additionalProperties dạng mảng không được thi hành (và cũng không hợp lệ trong JSON Schema); ` +
      `tại ${path}. Chỉ nhận \`false\` hoặc MỘT schema.`)

  if ("$ref" in node) {
    const siblings = Object.keys(node).filter((k) => k !== "$ref" && k !== "$comment")
    if (siblings.length > 0)
      throw new Error(
        `$ref không được thi hành cùng anh em kế bên (${siblings.join(", ")}) tại ${path}: ` +
        `validate() return NGAY sau khi phân giải $ref, nên mọi ràng buộc anh em bốc hơi. ` +
        `Chuyển chúng vào chính $defs được trỏ tới, hoặc bỏ $ref.`)
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" || k === "$defs") {
      for (const [name, sub] of Object.entries(v)) assertKnownKeywords(sub, `${path}/${k}/${name}`)
    } else if (k === "allOf") {
      v.forEach((sub, i) => assertKnownKeywords(sub, `${path}/${k}/${i}`, true))
    } else if (k === "oneOf") {
      v.forEach((sub, i) => assertKnownKeywords(sub, `${path}/${k}/${i}`))
    } else if (k === "items" || k === "if" || k === "then" || k === "additionalProperties") {
      assertKnownKeywords(v, `${path}/${k}`) // additionalProperties có thể là `false` — guard đầu hàm lo
    }
  }
}

function resolve(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`chỉ hỗ trợ $ref nội bộ, gặp: ${ref}`)
  return ref.slice(2).split("/").reduce((node, seg) => node[seg], root)
}

/** Trả về mảng lỗi (rỗng = hợp lệ). */
export function validate(root, schema, value, path = "$") {
  const errs = []
  if (schema.$ref) return validate(root, resolve(root, schema.$ref), value, path)

  if (schema.const !== undefined && value !== schema.const)
    errs.push(`${path}: phải là ${JSON.stringify(schema.const)}`)

  if (schema.enum && !schema.enum.some((e) => e === value))
    errs.push(`${path}: không nằm trong enum ${JSON.stringify(schema.enum)}`)

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual =
      value === null ? "null"
      : Array.isArray(value) ? "array"
      : Number.isInteger(value) ? "integer"
      : typeof value === "number" ? "number"
      : typeof value
    const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"))
    if (!ok) errs.push(`${path}: kiểu ${actual}, schema đòi ${types.join("|")}`)
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errs.push(`${path}: ngắn hơn minLength ${schema.minLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errs.push(`${path}: không khớp pattern ${schema.pattern}`)
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errs.push(`${path}: nhỏ hơn minimum ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum)
      errs.push(`${path}: lớn hơn maximum ${schema.maximum}`)
  }

  const isPlainObject = value !== null && typeof value === "object" && !Array.isArray(value)

  if (isPlainObject)
    for (const req of schema.required ?? [])
      if (!(req in value)) errs.push(`${path}: thiếu trường bắt buộc "${req}"`)

  if (schema.properties && isPlainObject) {
    if (schema.additionalProperties === false)
      for (const k of Object.keys(value))
        if (!(k in schema.properties)) errs.push(`${path}: trường lạ "${k}"`)
    for (const [k, sub] of Object.entries(schema.properties))
      if (k in value) errs.push(...validate(root, sub, value[k], `${path}.${k}`))
  }

  // `additionalProperties` là MỘT SCHEMA (không phải `true`/`false`) ⇒ bản đồ tên→giá trị. Chạy dù
  // `schema.properties` có mặt hay không — một node object có thể THUẦN LÀ bản đồ (không
  // `properties` nào cả, như `bindings`), và những khoá KHÔNG nằm trong `properties` (nếu có) vẫn
  // phải qua schema này.
  if (isPlainObject && schema.additionalProperties && typeof schema.additionalProperties === "object")
    for (const [k, v] of Object.entries(value))
      if (!schema.properties || !(k in schema.properties))
        errs.push(...validate(root, schema.additionalProperties, v, `${path}.${k}`))

  if (schema.items && Array.isArray(value))
    value.forEach((v, i) => errs.push(...validate(root, schema.items, v, `${path}[${i}]`)))

  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validate(root, s, value, path).length === 0)
    if (passing.length !== 1) errs.push(`${path}: khớp ${passing.length} nhánh oneOf, cần đúng 1`)
  }

  for (const sub of schema.allOf ?? []) {
    if (sub.if) {
      if (validate(root, sub.if, value, path).length === 0)
        errs.push(...validate(root, sub.then, value, path))
    } else {
      errs.push(...validate(root, sub, value, path))
    }
  }

  return errs
}
