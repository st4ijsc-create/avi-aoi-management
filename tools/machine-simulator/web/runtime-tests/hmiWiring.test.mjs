// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-1 Task 5, fix round 1 (task-5-review.md §"What 'fixed' means", falsification #1) —
// "reverting Hmi.tsx to its pre-Task-5 state while keeping the JSON leaves everything green" phải trở
// thành SAI. Trước fix round 1, KHÔNG bài nào trong `runtime-tests/` hay Playwright đọc `Hmi.tsx`'s
// nguồn — `screens.test.mjs` chỉ đọc file JSON từ đĩa, nên hoàn tác `Hmi.tsx` về bản trước Task 5 (khôi
// phục `<SchematicPanel>`/`<Sheet><ReadoutGrid/></Sheet>` viết tay, xoá `<ScreenRenderer>`) trong khi
// GIỮ NGUYÊN ba file JSON vẫn để lại một bộ test 100% xanh — vì các bài không đọc `Hmi.tsx` ở đâu cả.
// Bài này đóng lỗ đó bằng kỹ thuật `widgetRegistry.test.mjs` đã dùng cho đúng lý do tương tự: đọc SOURCE
// TEXT của `Hmi.tsx` bằng `readFileSync` rồi kiểm bằng regex — không `import()` nó (`.tsx` không
// `import()` được dưới `node --test`, xem `widgetRegistry.test.mjs`'s header cho phép đo cụ thể).
//
// 🔴 Bài này KHÔNG đo: (1) `Hmi.tsx` RENDER đúng — đó là Playwright (`tests/11-hmi.spec.ts`); (2) bất kỳ
// file nào KHÁC vẫn giữ nguyên (`SchematicPanel.tsx`/`ReadoutGrid.tsx` vẫn được PHÉP tồn tại và được
// IMPORT bởi `faceplate.tsx` — bài này chỉ cấm `Hmi.tsx` tự import chúng); (3) rằng `SCREEN_DOCS` (bảng
// `DeviceClass → HmiScreenDocument` chọn TÀI LIỆU) là sai — nó không phải mục tiêu của bài này, phần
// "đúng bố cục" đã chuyển hẳn vào JSON (`overviewFaceplate.test.mjs`) và chọn TÀI LIỆU theo lớp máy
// chính là điều task brief đòi ("chọn tài liệu JSON theo deviceClass"), không phải điều bị cấm.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const HMI_TSX_PATH = join(HERE, "..", "src", "routes", "Hmi.tsx")

// 🔴 CRLF — cùng lý do mọi bài đọc source text bằng regex trong kho này đã ghi: core.autocrlf=true,
// một checkout mới nhận \r\n, và regex bên dưới hard-code \n.
const src = readFileSync(HMI_TSX_PATH, "utf8").replace(/\r\n/g, "\n")

test("Hmi.tsx render <ScreenRenderer> — không phải bố cục viết tay", () => {
  assert.match(src, /<ScreenRenderer\b/, "Hmi.tsx không còn render <ScreenRenderer> — bố cục JSON đã bị gỡ hay chưa từng có")
})

test("Hmi.tsx import cả BA tài liệu screens/*-overview.json", () => {
  for (const file of ["screens/automation-overview.json", "screens/aoi-overview.json", "screens/iot-overview.json"]) {
    assert.ok(src.includes(file), `Hmi.tsx thiếu import "${file}"`)
  }
})

test("Hmi.tsx KHÔNG tự import SchematicPanel/ReadoutGrid — hai component đó giờ chỉ được faceplate.tsx dùng", () => {
  // Kiểm ĐƯỜNG DẪN IMPORT cụ thể, không phải sự có mặt của chữ "SchematicPanel"/"ReadoutGrid" ở bất kỳ
  // đâu — chính file này có DOC COMMENT nhắc tới cả hai tên (giải thích chúng đã chuyển đi đâu), nên
  // một kiểm substring trần sẽ tự đỏ ngay cả ở trạng thái ĐÚNG hôm nay. Import Task 5 xoá có hình dạng
  // `from "@/components/hmi/SchematicPanel"` / `from "@/components/hmi/ReadoutGrid"` — đúng hình dạng
  // sẽ QUAY LẠI nếu ai đó hoàn tác Task 5's tách JSX ra khỏi Hmi.tsx.
  assert.ok(!src.includes('"@/components/hmi/SchematicPanel"'), 'Hmi.tsx đang tự import SchematicPanel — bố cục viết tay có thể đã quay lại')
  assert.ok(!src.includes('"@/components/hmi/ReadoutGrid"'), 'Hmi.tsx đang tự import ReadoutGrid — bố cục viết tay có thể đã quay lại')
})

test("Hmi.tsx KHÔNG khai báo lại SCHEMATIC_READOUT_FLEX", () => {
  // Khớp phần KHAI BÁO (`const SCHEMATIC_READOUT_FLEX`), không phải chữ đó xuất hiện ở bất kỳ đâu —
  // file này có NHIỀU doc-comment nhắc tên hằng số cũ trong lời giải thích lịch sử, nên một kiểm
  // substring trần sẽ tự đỏ ngay ở trạng thái ĐÚNG. `\bconst\s+SCHEMATIC_READOUT_FLEX\b` chỉ khớp một
  // khai báo THẬT.
  assert.doesNotMatch(src, /\bconst\s+SCHEMATIC_READOUT_FLEX\b/, "SCHEMATIC_READOUT_FLEX được khai báo lại trong Hmi.tsx")
})

test("Hmi.tsx KHÔNG khai báo bảng tỉ lệ theo DeviceClass (Record<DeviceClass, [number, ...]>)", () => {
  // Hình dạng CỤ THỂ của một bảng "layout" (giá trị là TUPLE SỐ, như SCHEMATIC_READOUT_FLEX cũ) — KHÔNG
  // cấm `Record<DeviceClass, ...>` nói chung: `SCREEN_DOCS: Record<DeviceClass, HmiScreenDocument>`
  // (bảng CHỌN TÀI LIỆU, đúng thứ task brief đòi "chọn tài liệu JSON theo deviceClass") phải tiếp tục
  // sống trong file này, và không khớp mẫu dưới đây vì giá trị của nó là `HmiScreenDocument`, không
  // phải một tuple số.
  assert.doesNotMatch(
    src,
    /Record<DeviceClass,\s*\[\s*number/,
    "một Record<DeviceClass, [number...]> (bảng tỉ lệ theo lớp máy) đã quay lại Hmi.tsx — tỉ lệ phải sống trong JSON (props.schematicFlex/readoutFlex), không phải TypeScript"
  )
})
