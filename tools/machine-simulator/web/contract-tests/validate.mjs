// ─────────────────────────────────────────────────────────────────────────────
// Bộ validate JSON Schema TỐI THIỂU, viết tay, cho đúng ba schema của `contracts/`.
//
// VÌ SAO KHÔNG DÙNG AJV: Mốc 0 có ràng buộc "không thêm npm package" (xem blueprint §Global
// Constraints). Đổi lại, bộ này CHỈ hiểu các từ khoá ba schema ấy thật sự dùng:
//   type · const · enum · required · additionalProperties · properties · items · $ref (nội bộ)
//   minLength · minimum · maximum · pattern · oneOf · allOf · if/then
//
// 🔴 NÓ KHÔNG PHẢI BỘ VALIDATE TỔNG QUÁT. Nếu ai đó thêm một từ khoá ngoài danh sách trên vào
// schema, `assertKnownKeywords` dưới đây NÉM LỖI thay vì bỏ qua âm thầm — một từ khoá không được
// hiểu mà bị bỏ qua chính là cách một bộ validate viết tay trở thành lời nói dối.
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "type", "const", "enum", "required",
  "additionalProperties", "properties", "items", "minLength", "minimum", "maximum",
  "pattern", "oneOf", "allOf", "if", "then",
])

// 🔴 Đệ quy phải phân biệt NÚT SCHEMA với BẢN ĐỒ TÊN→SCHEMA. Khoá của `properties` và `$defs` là tên do
// người dùng đặt ("machineCode", "tag"), KHÔNG phải từ khoá — kiểm chúng với KNOWN sẽ ném lỗi trên mọi
// schema hợp lệ. Chỉ đi xuống những chỗ thật sự chứa nút schema; `enum`/`required`/`pattern`/`const` là
// giá trị lá, không đi xuống.
export function assertKnownKeywords(node, path = "#") {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return

  for (const k of Object.keys(node)) {
    if (!KNOWN.has(k)) throw new Error(`từ khoá schema chưa được hỗ trợ: ${k} tại ${path}`)
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" || k === "$defs") {
      for (const [name, sub] of Object.entries(v)) assertKnownKeywords(sub, `${path}/${k}/${name}`)
    } else if (k === "oneOf" || k === "allOf") {
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

  if (schema.properties && value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const req of schema.required ?? [])
      if (!(req in value)) errs.push(`${path}: thiếu trường bắt buộc "${req}"`)
    if (schema.additionalProperties === false)
      for (const k of Object.keys(value))
        if (!(k in schema.properties)) errs.push(`${path}: trường lạ "${k}"`)
    for (const [k, sub] of Object.entries(schema.properties))
      if (k in value) errs.push(...validate(root, sub, value[k], `${path}.${k}`))
  }

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
