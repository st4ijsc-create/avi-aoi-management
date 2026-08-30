// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// Bài này ghim Task 3 (WS-HMI-1) — bộ phân giải `{component}` (`web/src/hmi-runtime/bindings.ts`) và
// toán lưới clamp (`web/src/hmi-runtime/gridLayout.ts`) mà `ScreenRenderer.tsx` dùng để đặt widget lên
// CSS grid. Bốn đề xuất task brief nêu, theo đúng thứ tự trong brief:
//
//   1. `"{component}/torque"` với prefix `"SCRW-01/spindle"` → `"SCRW-01/spindle/torque"`.
//   2. Một binding KHÔNG chứa `{component}` đi qua nguyên vẹn.
//   3. `{component}` mà widget KHÔNG khai `component` → trả nguyên chuỗi + cảnh báo nhìn thấy được,
//      KHÔNG ném.
//   4. Lưới: `col`/`row`/`colSpan`/`rowSpan` đặt đúng; widget vượt biên lưới bị KẸP LẠI và CẢNH BÁO,
//      không bị bỏ rơi, không được tràn.
//
// 🔴 Bài này KHÔNG đo:
//
// (1) `ScreenRenderer.tsx` THẬT có RENDER đúng không — file đó là `.tsx`, và Node's native loader từ
//     chối MỌI đuôi `.tsx` (`ERR_UNKNOWN_FILE_EXTENSION`, đo được ở Task 2, xem `widgetRegistry.test.mjs`
//     header cho probe gốc). `resolveBinding`/`componentTagPrefixOf`/`clampRectToLayout` được tách vào
//     `bindings.ts`/`gridLayout.ts` — plain `.ts`, KHÔNG JSX — chính vì lý do này, cùng kỹ thuật
//     `widgets/shared.ts` (Task 2) đã dùng. Bài dưới THỰC THI ba hàm đó thật, không đọc văn bản.
//
// (2) Rằng một widget THẬT sự ném lỗi khi render thì các widget anh em THẬT sự vẫn sống trên DOM. Đây
//     là claim CẦN một trình duyệt thật để chứng minh, và task này đã THỬ một đường tắt rồi TỪ CHỐI nó:
//     dựng cây `<Boundary><Bad/></Boundary><Good/>` (dùng đúng `getDerivedStateFromError`) rồi
//     `renderToString`/`renderToPipeableStream` từ `react-dom/server` dưới `node --test` trần (không
//     cần đuôi `.tsx`, không cần trình duyệt). Kết quả đo được — không phải suy đoán:
//
//       $ node probe.mjs   # renderToString(tree) với Boundary bọc Bad
//       THREW: boom        # KHÔNG hồi phục — lỗi ném thẳng ra ngoài `renderToString`
//
//     React 19's `renderToString`/`renderToPipeableStream` KHÔNG hồi phục qua error boundary theo cách
//     client render làm — `getDerivedStateFromError` không được gọi, `componentDidCatch` không chạy, cả
//     server render hỏng theo `onError`/`onShellError`. Đây là NGƯỢC với hành vi `createRoot` phía
//     client thật mà `ScreenRenderer` chạy trong trình duyệt/kiosk. Một bài test dựng trên đường SSR đó
//     sẽ báo "boundary hoạt động" trong khi đo đúng một đường thi hành CHẠY NGƯỢC với production — sai
//     lệch, không chỉ là thiếu sót. Bài dưới vì vậy CHỈ kiểm CẤU TRÚC — rằng `ScreenRenderer.tsx` dùng
//     ĐÚNG cơ chế `getDerivedStateFromError`/`componentDidCatch` (không phải một `try/catch` không tác
//     dụng quanh JSX của con) VÀ rằng nó thực sự gọi `resolveBinding`/`componentTagPrefixOf`/
//     `clampRectToLayout` — không phải bằng chứng DOM. Bằng chứng DOM thật thuộc Playwright của
//     Task 4/5 (kế hoạch), không phải một khoảng trống bị bỏ qua ở đây.
//
// (3) `TagValueSource`/`widgetRegistry` (Task 1/2) — đã ghim ở `tagValueSource.test.mjs`/
//     `widgetRegistry.test.mjs`, không lặp lại ở đây.
//
// 🔴 Fix round 1 (2 Important findings, cả hai trong nhánh lưới/cảnh báo, KHÔNG phải trong phần cô lập
// error boundary mà round trước đã đúng):
//
// Finding 1 — `clampRectToLayout` so sánh "raw" (đã qua ép kiểu/mặc định: chuỗi/`null`/`NaN` → 0 hoặc 1)
// với kết quả CUỐI, thay vì so ĐẦU VÀO THẬT với kết quả cuối — nên một rect hỏng KIỂU mà tình cờ rơi
// đúng vào giá trị mặc định trong biên bị coi là "không đổi": KHÔNG cảnh báo, KHÔNG console.warn, dù
// widget đã bị dời tới (0,0) 1×1 một cách câm lặng. Sửa bằng cách so `rect` gốc (không phải giá trị đã
// ép kiểu) với kết quả cuối — xem `gridLayout.ts`'s `ClampResult.warning` doc-comment cho chi tiết đầy
// đủ, và bài "rect hỏng kiểu" bên dưới cho bằng chứng ĐỎ trước khi sửa.
//
// Finding 2 — `resolveBinding` chỉ cảnh báo qua `console.warn`; một binding {component} không phân giải
// được render ra ĐÚNG `NO_DATA "—"` như không-có-dữ-liệu thật, không có gì trên MÀN HÌNH nêu tên vấn đề
// cho một người vận hành đứng tại kiosk không mở devtools. Sửa bằng `unresolvedComponentBindingWarning`
// (`bindings.ts`) — một kiểm tra TĨNH (không cần chặn `resolve()`) mà `ScreenRenderer.tsx` gọi CẠNH
// `clampRectToLayout` và gộp vào ĐÚNG MỘT `title` tooltip đã dùng cho cảnh báo lưới, không phải một ý
// tưởng thứ hai. `console.warn` vẫn còn — đó là dấu vết bền, được bài test THỰC THI; tooltip là bản
// vọng-lại nhìn-thấy-được trên màn hình.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  resolveBinding,
  componentTagPrefixOf,
  bindingNeedsComponent,
  unresolvedComponentBindingWarning,
} from "../src/hmi-runtime/bindings.ts"
import { clampRectToLayout } from "../src/hmi-runtime/gridLayout.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "src")

// 🔴 CRLF: cùng lý do `contracts.test.mjs`/`widgetRegistry.test.mjs` đã đo — `core.autocrlf=true` trên
// kho này, checkout MỚI nhận `\r\n`, và mọi regex/`includes` bóc tách văn bản bên dưới giả định `\n`.
// Chuẩn hoá MỘT LẦN ở đây, như hai file kia đã làm.
const readNormalized = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n")

/** Chạy `fn`, chặn MỌI lệnh gọi `console.warn` trong lúc đó, trả về cả kết quả lẫn danh sách lệnh gọi đã
 * chặn — rồi PHỤC HỒI `console.warn` gốc dù `fn` có ném hay không (bài test không được để lại tác dụng
 * phụ lên `console` cho các bài chạy SAU nó trong cùng tiến trình `node --test`). */
function captureWarnings(fn) {
  const original = console.warn
  const calls = []
  console.warn = (...args) => {
    calls.push(args)
  }
  try {
    const result = fn()
    return { result, calls }
  } finally {
    console.warn = original
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Đề xuất 1 — component có tagPrefix, binding {component} phân giải đúng
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('resolveBinding: "{component}/torque" với prefix "SCRW-01/spindle" → "SCRW-01/spindle/torque"', () => {
  const { result, calls } = captureWarnings(() => resolveBinding("{component}/torque", "SCRW-01/spindle"))
  assert.equal(result, "SCRW-01/spindle/torque")
  assert.deepEqual(calls, [], "trường hợp phân giải THÀNH CÔNG không được cảnh báo gì cả")
})

test("resolveBinding: thay MỌI lần xuất hiện của {component}, không chỉ lần đầu", () => {
  const result = resolveBinding("{component}/{component}-backup", "SCRW-01/spindle")
  assert.equal(result, "SCRW-01/spindle/SCRW-01/spindle-backup")
})

test("componentTagPrefixOf + resolveBinding: pipeline đầy đủ qua ComponentNode thật (khớp fixture screwdrive-cell)", () => {
  // Hình dạng ComponentNode và giá trị tagPrefix lấy đúng từ
  // contracts/fixtures/valid/components-screwdrive-cell.json's "spindle" component — không bịa dữ liệu.
  const components = [
    { id: "spindle", typeId: "st4i.motor.spindle", label: "Trục vít chính", tagPrefix: "SCRW-01/spindle" },
    { id: "ambient", typeId: "st4i.sensor.temp", label: "Nhiệt độ buồng máy", tagPrefix: "SCRW-01/ambient" },
  ]
  const prefix = componentTagPrefixOf(components, "spindle")
  assert.equal(prefix, "SCRW-01/spindle")
  assert.equal(resolveBinding("{component}/torque", prefix), "SCRW-01/spindle/torque")
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Đề xuất 2 — binding không chứa {component} đi qua nguyên vẹn
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("resolveBinding: binding không có {component} đi qua nguyên vẹn (không có prefix)", () => {
  const { result, calls } = captureWarnings(() => resolveBinding("SCRW-01/spindle/torque"))
  assert.equal(result, "SCRW-01/spindle/torque")
  assert.deepEqual(calls, [])
})

test("resolveBinding: binding không có {component} đi qua nguyên vẹn NGAY CẢ KHI một prefix được cấp — prefix bị bỏ qua vì không có gì để thay", () => {
  const result = resolveBinding("SCRW-01/spindle/torque", "SOME-OTHER-PREFIX")
  assert.equal(result, "SCRW-01/spindle/torque")
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Đề xuất 3 — {component} trên widget không khai component: nguyên chuỗi + cảnh báo, KHÔNG ném
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("resolveBinding: {component} mà không có prefix (widget không khai component) → trả nguyên chuỗi, cảnh báo, KHÔNG NÉM", () => {
  let result
  const { calls } = captureWarnings(() => {
    assert.doesNotThrow(() => {
      result = resolveBinding("{component}/torque")
    })
  })
  assert.equal(result, "{component}/torque", "chuỗi phải giữ NGUYÊN — không phải chuỗi rỗng, không phải throw")
  assert.equal(calls.length, 1, "phải có ĐÚNG MỘT cảnh báo nhìn thấy được")
  const [message] = calls[0]
  assert.ok(typeof message === "string" && message.length > 0, "cảnh báo phải có nội dung")
  assert.ok(message.includes("{component}/torque"), "cảnh báo phải NÊU TÊN binding gây lỗi, không phải một câu chung chung")
})

test("componentTagPrefixOf: componentId vắng mặt → undefined, không ném", () => {
  assert.doesNotThrow(() => componentTagPrefixOf([{ id: "spindle", typeId: "t", label: "l", tagPrefix: "P" }], undefined))
  assert.equal(componentTagPrefixOf([{ id: "spindle", typeId: "t", label: "l", tagPrefix: "P" }], undefined), undefined)
})

test("componentTagPrefixOf: componentId không khớp bất kỳ ComponentNode nào → undefined, không ném (tham chiếu hỏng/lỗi chính tả)", () => {
  const components = [{ id: "spindle", typeId: "t", label: "l", tagPrefix: "SCRW-01/spindle" }]
  assert.doesNotThrow(() => componentTagPrefixOf(components, "spndle-typo"))
  assert.equal(componentTagPrefixOf(components, "spndle-typo"), undefined)
})

test("componentTagPrefixOf: components rỗng hoặc undefined → undefined, không ném", () => {
  assert.doesNotThrow(() => componentTagPrefixOf([], "spindle"))
  assert.equal(componentTagPrefixOf([], "spindle"), undefined)
  assert.doesNotThrow(() => componentTagPrefixOf(undefined, "spindle"))
  assert.equal(componentTagPrefixOf(undefined, "spindle"), undefined)
})

test("resolveBinding: một tham chiếu component HỎNG (id không tồn tại) rơi vào ĐÚNG đường an toàn như không khai component — trả nguyên, cảnh báo, không ném", () => {
  const components = [{ id: "spindle", typeId: "t", label: "l", tagPrefix: "SCRW-01/spindle" }]
  const prefix = componentTagPrefixOf(components, "does-not-exist")
  const { result, calls } = captureWarnings(() => resolveBinding("{component}/torque", prefix))
  assert.equal(result, "{component}/torque")
  assert.equal(calls.length, 1)
})

test("resolveBinding: binding không phải string (tài liệu hỏng) → trả nguyên, không ném — cùng thế phòng thủ TagValueSource.get đã ghim", () => {
  assert.doesNotThrow(() => resolveBinding(/** @type {any} */ (42)))
  assert.equal(resolveBinding(/** @type {any} */ (42)), 42)
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 Fix round 1, Finding 2 — cảnh báo NHÌN THẤY ĐƯỢC TRÊN MÀN HÌNH cho binding {component} không phân
// giải được, không chỉ console.warn. `bindingNeedsComponent` là kiểm tra dùng chung (tránh chép token
// "{component}" ra hai chỗ); `unresolvedComponentBindingWarning` là kiểm tra TĨNH cấp-widget mà
// `ScreenRenderer.tsx` gọi để gộp vào cùng `title` tooltip đã dùng cho cảnh báo lưới.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("bindingNeedsComponent: true khi binding chứa {component}, false khi không, false (không ném) cho input không phải string", () => {
  assert.equal(bindingNeedsComponent("{component}/torque"), true)
  assert.equal(bindingNeedsComponent("prefix-{component}-suffix"), true)
  assert.equal(bindingNeedsComponent("SCRW-01/spindle/torque"), false)
  assert.doesNotThrow(() => bindingNeedsComponent(/** @type {any} */ (undefined)))
  assert.equal(bindingNeedsComponent(/** @type {any} */ (undefined)), false)
  assert.equal(bindingNeedsComponent(/** @type {any} */ (null)), false)
  assert.equal(bindingNeedsComponent(/** @type {any} */ (42)), false)
})

test("unresolvedComponentBindingWarning: tagPrefix ĐÃ phân giải → undefined (không có gì để cảnh báo), bất kể bindings chứa gì", () => {
  const widget = { id: "torque", bindings: { value: "{component}/torque" } }
  assert.equal(unresolvedComponentBindingWarning(widget, "SCRW-01/spindle"), undefined)
})

test("unresolvedComponentBindingWarning: tagPrefix undefined NHƯNG không binding nào dùng {component} → undefined", () => {
  const widget = { id: "trend", bindings: { series: "SCRW-01/spindle/torque" } }
  assert.equal(unresolvedComponentBindingWarning(widget, undefined), undefined)
})

test("unresolvedComponentBindingWarning: tagPrefix undefined VÀ có binding dùng {component} → một cảnh báo có nội dung, NÊU TÊN widget và (các) khoá binding gây lỗi", () => {
  const widget = { id: "torque", bindings: { value: "{component}/torque", label: "static text" } }
  const warning = unresolvedComponentBindingWarning(widget, undefined)
  assert.equal(typeof warning, "string")
  assert.ok(warning.length > 0)
  assert.ok(warning.includes("torque"), "phải nêu tên WIDGET (id) gây lỗi")
  assert.ok(warning.includes("value"), "phải nêu tên KHOÁ binding gây lỗi (\"value\"), không phải một câu chung chung")
  assert.ok(!warning.includes('"label"'), "KHÔNG được liệt kê khoá \"label\" — binding đó không dùng {component}, không phải nguồn gây lỗi")
})

test("unresolvedComponentBindingWarning: widget không có bindings, hoặc bindings undefined → undefined, không ném", () => {
  assert.doesNotThrow(() => unresolvedComponentBindingWarning({ id: "w" }, undefined))
  assert.equal(unresolvedComponentBindingWarning({ id: "w" }, undefined), undefined)
  assert.equal(unresolvedComponentBindingWarning({ id: "w", bindings: undefined }, undefined), undefined)
})

test("unresolvedComponentBindingWarning: pipeline đầy đủ khớp resolveBinding — cùng điều kiện, hai kênh cảnh báo (console.warn VÀ tooltip) không lệch nhau", () => {
  const widget = { id: "torque-sp", bindings: { value: "{component}/torque-target" } }
  const { result, calls } = captureWarnings(() => resolveBinding(widget.bindings.value, undefined))
  const tooltipWarning = unresolvedComponentBindingWarning(widget, undefined)
  assert.equal(result, "{component}/torque-target", "resolveBinding vẫn trả nguyên chuỗi, không đổi hành vi")
  assert.equal(calls.length, 1, "console.warn vẫn là dấu vết bền, không bị thay thế")
  assert.ok(typeof tooltipWarning === "string" && tooltipWarning.length > 0, "VÀ tooltip cảnh báo cũng phải có mặt cho ĐÚNG cùng điều kiện")
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Đề xuất 4 — lưới: col/row/colSpan/rowSpan đặt đúng; vượt biên bị KẸP + CẢNH BÁO, không bỏ rơi/tràn
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("clampRectToLayout: rect vừa khít bên trong layout → giữ NGUYÊN, không cảnh báo", () => {
  const layout = { cols: 12, rows: 10, breakpoint: "panel" }
  const rect = { col: 7, row: 1, colSpan: 5, rowSpan: 4 } // 7+5===12, 1+4===5<=10 — khớp fixture thật
  const { result: out, calls } = captureWarnings(() => clampRectToLayout(rect, layout, "torque-trend"))
  assert.deepEqual(out.rect, rect)
  assert.equal(out.warning, undefined)
  assert.deepEqual(calls, [])
})

test("clampRectToLayout: colSpan vượt biên phải (col+colSpan > cols) → KẸP colSpan, CẢNH BÁO, widget vẫn hiện (không bỏ rơi)", () => {
  const layout = { cols: 12, rows: 10, breakpoint: "panel" }
  const rect = { col: 10, row: 0, colSpan: 5, rowSpan: 1 } // 10+5=15 > 12
  const { result: out, calls } = captureWarnings(() => clampRectToLayout(rect, layout, "overflow-widget"))
  assert.equal(out.rect.col, 10)
  assert.equal(out.rect.colSpan, 2, "colSpan phải bị kẹp còn đúng phần vừa với lưới: 12-10=2")
  assert.ok(out.rect.col + out.rect.colSpan <= layout.cols, "widget đã kẹp KHÔNG được tràn khỏi lưới")
  assert.ok(typeof out.warning === "string" && out.warning.includes("overflow-widget"), "cảnh báo phải nêu tên widget")
  assert.equal(calls.length, 1, "phải có console.warn — không phải một cú kẹp câm lặng")
})

test("clampRectToLayout: rowSpan vượt biên dưới (row+rowSpan > rows) → KẸP rowSpan, CẢNH BÁO", () => {
  const layout = { cols: 12, rows: 8, breakpoint: "panel" }
  const rect = { col: 0, row: 6, colSpan: 2, rowSpan: 5 } // 6+5=11 > 8
  const { result: out, calls } = captureWarnings(() => clampRectToLayout(rect, layout, "tall-widget"))
  assert.equal(out.rect.row, 6)
  assert.equal(out.rect.rowSpan, 2, "rowSpan phải bị kẹp còn đúng phần vừa với lưới: 8-6=2")
  assert.ok(out.rect.row + out.rect.rowSpan <= layout.rows)
  assert.equal(calls.length, 1)
})

test("clampRectToLayout: col vượt HẲN ra ngoài lưới (col >= cols) → kẹp về cột cuối, colSpan còn 1, CẢNH BÁO — vẫn hiện, không tràn, không mất tích", () => {
  const layout = { cols: 12, rows: 10, breakpoint: "panel" }
  const rect = { col: 20, row: 0, colSpan: 3, rowSpan: 1 }
  const { result: out, calls } = captureWarnings(() => clampRectToLayout(rect, layout, "off-grid-widget"))
  assert.equal(out.rect.col, 11, "cột cuối hợp lệ 0-indexed của lưới 12 cột là 11")
  assert.equal(out.rect.colSpan, 1)
  assert.ok(out.rect.col + out.rect.colSpan <= layout.cols)
  assert.equal(calls.length, 1)
})

test("clampRectToLayout: col/row ÂM → kẹp về 0, CẢNH BÁO", () => {
  const layout = { cols: 12, rows: 10, breakpoint: "panel" }
  const rect = { col: -3, row: -1, colSpan: 2, rowSpan: 2 }
  const { result: out, calls } = captureWarnings(() => clampRectToLayout(rect, layout, "negative-widget"))
  assert.equal(out.rect.col, 0)
  assert.equal(out.rect.row, 0)
  assert.equal(calls.length, 1)
})

// 🔴 Fix round 1, Finding 1: một rect hỏng KIỂU (không phải số, null, NaN) mà tình cờ rơi vào giá trị
// mặc định VẪN NẰM TRONG BIÊN lưới trước đây bị coi là "không đổi" — vì phép so sánh cũ so `raw` (đã
// qua ép kiểu/mặc định) với kết quả cuối, thay vì so ĐẦU VÀO THẬT với kết quả cuối. Bài dưới khẳng định
// CẢ HAI: giá trị đã kẹp đúng, VÀ một cảnh báo thật sự được phát ra — không chỉ đọc rect kết quả.
test("clampRectToLayout: rect hỏng kiểu (không phải số/thiếu trường) → KHÔNG ném, dùng giá trị an toàn, VÀ CẢNH BÁO — ép kiểu PHẢI được tính là một thay đổi, không chỉ range-clamp", () => {
  const layout = { cols: 12, rows: 10, breakpoint: "panel" }
  const malformed = /** @type {any} */ ({ col: "x", row: null, colSpan: -5, rowSpan: NaN })
  const { result: out, calls } = captureWarnings(() => {
    let result
    assert.doesNotThrow(() => {
      result = clampRectToLayout(malformed, layout, "malformed-widget")
    })
    return result
  })
  assert.equal(out.rect.col, 0)
  assert.equal(out.rect.row, 0)
  assert.equal(out.rect.colSpan, 1)
  assert.equal(out.rect.rowSpan, 1)
  assert.ok(
    typeof out.warning === "string" && out.warning.length > 0,
    "một rect hỏng KIỂU vẫn phải sinh ra MỘT warning nhìn thấy được — nếu 'kẹp về giá trị an toàn' im lặng, màn hình TRÔNG như đúng trong khi tài liệu THẬT SỰ sai, đúng thứ đề xuất 4 tồn tại để chặn"
  )
  assert.equal(
    calls.length,
    1,
    "console.warn phải được gọi cho input hỏng KIỂU — không chỉ cho input đúng kiểu nhưng lệch biên"
  )
})

test("clampRectToLayout: layout hỏng (cols/rows không phải số dương) → KHÔNG ném, rơi về lưới 1x1 an toàn", () => {
  assert.doesNotThrow(() =>
    clampRectToLayout({ col: 0, row: 0, colSpan: 1, rowSpan: 1 }, /** @type {any} */ ({ cols: 0, rows: -5 }), "w")
  )
  const out = clampRectToLayout({ col: 0, row: 0, colSpan: 1, rowSpan: 1 }, /** @type {any} */ ({ cols: 0, rows: -5 }), "w")
  assert.equal(out.rect.col, 0)
  assert.equal(out.rect.row, 0)
  assert.equal(out.rect.colSpan, 1)
  assert.equal(out.rect.rowSpan, 1)
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 Cấu trúc: ScreenRenderer.tsx dùng ĐÚNG error boundary React thật, và THỰC SỰ gọi ba hàm trên
// (không định nghĩa rồi bỏ xó) — xem header "KHÔNG đo (2)" ở trên cho lý do đây CHỈ là kiểm cấu trúc.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("ScreenRenderer.tsx: dùng getDerivedStateFromError + componentDidCatch (error boundary THẬT), không phải try/catch không tác dụng", () => {
  const src = readNormalized(join(SRC, "hmi-runtime", "ScreenRenderer.tsx"))
  assert.ok(src.includes("getDerivedStateFromError"), "thiếu getDerivedStateFromError — đây là cơ chế BẮT BUỘC để một class component trở thành error boundary")
  assert.ok(src.includes("componentDidCatch"), "thiếu componentDidCatch")
  assert.ok(src.includes("extends Component"), "boundary phải là MỘT class component thật, không phải hàm")
})

test("ScreenRenderer.tsx: mỗi widget được bọc RIÊNG bằng WidgetErrorBoundary của chính nó (không phải một boundary DUY NHẤT quanh cả danh sách)", () => {
  const src = readNormalized(join(SRC, "hmi-runtime", "ScreenRenderer.tsx"))
  // `.map((widget) => ...)` sinh MỘT <WidgetErrorBoundary> cho MỖI widget — đếm số lần class được
  // NHẮC TỚI trong nhánh render-per-widget (định nghĩa class + một lần dùng trong JSX map = 2 lần tối
  // thiểu; một boundary DUY NHẤT ngoài `.map` sẽ chỉ xuất hiện 1 lần bất kể cách viết).
  const usageCount = (src.match(/<WidgetErrorBoundary\b/g) ?? []).length
  assert.equal(usageCount, 1, "WidgetErrorBoundary phải được dùng ĐÚNG MỘT LẦN trong JSX — bên trong .map() của widget, nên áp dụng cho từng widget một, không phải N lần viết tay")
  assert.ok(/widgets\.map/.test(src), "việc bọc boundary phải nằm TRONG vòng lặp theo từng widget")
})

test("ScreenRenderer.tsx: THỰC SỰ gọi resolveBinding, componentTagPrefixOf, clampRectToLayout, unresolvedComponentBindingWarning — không import rồi bỏ xó", () => {
  const src = readNormalized(join(SRC, "hmi-runtime", "ScreenRenderer.tsx"))
  for (const fn of ["resolveBinding(", "componentTagPrefixOf(", "clampRectToLayout(", "unresolvedComponentBindingWarning("]) {
    assert.ok(src.includes(fn), `ScreenRenderer.tsx không gọi ${fn} — hàm được import nhưng không dùng, bài ghim ở bindings.test.mjs không còn chứng minh gì về renderer thật`)
  }
})

// 🔴 Fix round 1, Finding 2: cảnh báo {component} không phân giải được phải LÊN ĐƯỢC `title` tooltip
// trên chính ô lưới của widget — cùng ý tưởng cảnh báo lưới đã dùng, không phải một kênh khác/thứ hai.
test('ScreenRenderer.tsx: cảnh báo {component} không phân giải được GỘP vào CÙNG "title" tooltip với cảnh báo lưới, không phải một kênh riêng', () => {
  const src = readNormalized(join(SRC, "hmi-runtime", "ScreenRenderer.tsx"))
  assert.ok(
    /title=\{/.test(src),
    'phải có một thuộc tính title={...} trên ô lưới của widget — đây là nơi cảnh báo phải HIỆN RA'
  )
  // Cả biến cảnh báo lưới (clampWarning) LẪN biến cảnh báo binding (bindingWarning) phải xuất hiện
  // TRƯỚC dòng title={...} và được GỘP vào nó — không phải hai chỗ tách biệt không bao giờ gặp nhau.
  const titleLine = src.match(/const title = .*/)?.[0] ?? ""
  assert.ok(titleLine.length > 0, "không tìm thấy dòng gộp title — cấu trúc gộp cảnh báo có thể đã đổi")
  assert.ok(/clampWarning/.test(titleLine), "dòng gộp title phải tham chiếu cảnh báo LƯỚI")
  assert.ok(/bindingWarning/.test(titleLine), "dòng gộp title phải tham chiếu cảnh báo BINDING — nếu không, finding 2 chưa thực sự được sửa, chỉ mới thêm hàm mồ côi")
})

test("ScreenRenderer.tsx: kind không có trong widgetRegistry được canh gác (không tra thẳng rồi gọi ngay)", () => {
  const src = readNormalized(join(SRC, "hmi-runtime", "ScreenRenderer.tsx"))
  assert.ok(
    /widgetRegistry\[widget\.kind\]/.test(src),
    "phải tra widgetRegistry theo widget.kind ở đâu đó"
  )
  assert.ok(
    /if\s*\(\s*!Widget\s*\)/.test(src),
    "phải có một canh gác kiểu `if (!Widget)` trước khi render — thiếu canh gác nghĩa là một kind lạ sẽ làm nổ renderer thay vì hiện một ô thay thế nêu tên vấn đề"
  )
})

test("ScreenRenderer.tsx: dựng CSS grid từ layout.cols/rows — KHÔNG toạ độ pixel tuyệt đối (position: absolute / left|top: Npx)", () => {
  const src = readNormalized(join(SRC, "hmi-runtime", "ScreenRenderer.tsx"))
  assert.ok(src.includes("gridTemplateColumns"), "phải dựng lưới bằng gridTemplateColumns")
  assert.ok(src.includes("gridTemplateRows"), "phải dựng lưới bằng gridTemplateRows")
  assert.ok(src.includes("layout.cols") && src.includes("layout.rows"), "kích thước lưới phải đọc từ layout.cols/layout.rows của tài liệu, không phải hằng số cứng")
  assert.ok(!/position:\s*["']?absolute/.test(src), "không được dùng position: absolute để đặt widget — spec chốt lưới, không toạ độ pixel")
  assert.ok(!/\bleft:\s*[`"']?\$?\{?\d/.test(src), "không được thấy toạ độ `left: Npx` kiểu pixel tuyệt đối")
})
