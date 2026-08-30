// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-1 Task 5 — nạp ba tài liệu `web/screens/*-overview.json` (những gì `Hmi.tsx` giờ chọn thay vì
// dựng bố cục bằng tay) và validate CHÚNG bằng chính `validate.mjs` của Mốc 0 — IMPORT nó, không chép
// nó (task brief). `contract-tests/contracts.test.mjs` validate CORPUS của Mốc 0
// (`contracts/fixtures/**`), không phải ba file này; bài này là bài riêng task brief đòi thêm.
//
// 🔴 Bài này KHÔNG đo: (1) React thực sự render ba document này đúng — đó là Playwright
// (`tests/11-hmi.spec.ts`/`tests/31-theme-isa101.spec.ts`), `.tsx` không `import()` được dưới
// `node --test` (xem `widgetRegistry.test.mjs`'s header cho phép đo cụ thể); (2) `validate.mjs` THI
// HÀNH đúng JSON Schema — nó là bản viết tay một phần, đọc header của chính nó (`web/contract-tests/
// validate.mjs`) trước khi tin nó; (3) `props.faceplate` mà mỗi widget mang trỏ tới một hiện thực THẬT
// — schema coi `props` là `{"type":"object"}` (từ khoá lạ bên trong không được thi hành), nên một
// `props.faceplate` gõ sai vẫn hợp lệ theo schema; `widgetRegistry.test.mjs`/Playwright là nơi hiện
// thực thật được đo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { validate } from "../contract-tests/validate.mjs"

// web/runtime-tests → web
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const SCREENS_DIR = join(WEB, "screens")
// web → tools/machine-simulator → contracts
const SCHEMA_PATH = join(WEB, "..", "contracts", "hmi-screen.schema.json")

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))

const SCREEN_FILES = ["automation-overview.json", "aoi-overview.json", "iot-overview.json"]

test("web/screens/ chứa ĐÚNG ba tài liệu Task 5 đòi — không thừa, không thiếu", () => {
  const onDisk = readdirSync(SCREENS_DIR).filter((f) => f.endsWith(".json")).sort()
  assert.deepEqual(onDisk, [...SCREEN_FILES].sort())
})

for (const file of SCREEN_FILES) {
  test(`web/screens/${file}: hợp lệ theo contracts/hmi-screen.schema.json (qua validate.mjs của Mốc 0)`, () => {
    const doc = JSON.parse(readFileSync(join(SCREENS_DIR, file), "utf8"))
    const errs = validate(schema, schema, doc)
    assert.deepEqual(errs, [], `đáng lẽ hợp lệ nhưng validate.mjs báo lỗi:\n${errs.join("\n")}`)
  })

  test(`web/screens/${file}: theme là "blueprint" — kế thừa theme HIỆN HÀNH của app, không ép isa101`, () => {
    // `index.css`'s own top comment (WS-HMI-1 Task 5): `data-theme="blueprint"` là INERT trên chủ ý —
    // không có khối CSS nào khớp nó, nên phần tử mang nó tiếp tục kế thừa Glass/Console/Warmth/isa101
    // của tổ tiên. Ba màn hình này phải render GIỐNG HỆT như trước dưới CẢ BỐN theme (11-hmi.spec.ts
    // chạy glass/console/warmth; 31-theme-isa101.spec.ts chạy isa101) — nếu file này lỡ ghi "isa101",
    // `ScreenRenderer`'s `data-theme={doc.theme}` sẽ ép isa101 lên đúng vùng schematic+readout bất kể
    // theme ambient là gì, đổi màu thật và làm lệch baseline glass/console/warmth ngay lập tức.
    const doc = JSON.parse(readFileSync(join(SCREENS_DIR, file), "utf8"))
    assert.equal(doc.theme, "blueprint")
  })

  test(`web/screens/${file}: đúng MỘT widget kind "faceplate", props.faceplate khớp máy`, () => {
    const doc = JSON.parse(readFileSync(join(SCREENS_DIR, file), "utf8"))
    assert.equal(doc.widgets.length, 1)
    assert.equal(doc.widgets[0].kind, "faceplate")
    assert.equal(typeof doc.widgets[0].props?.faceplate, "string")
  })
}
