// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-1 Task 5, fix round 1 (task-5-review.md §"What 'fixed' means, stated as tests rather than as
// prose", falsification #2) — "swapping the contents of two screen documents changes no pixel and
// reddens no test" phải trở thành SAI. Bài này là bằng chứng trực tiếp, không phải suy luận: nạp
// `props` THẬT của cả ba tài liệu `web/screens/*.json`, đưa qua ĐÚNG hàm `faceplate.tsx` gọi lúc
// render (`resolveOverviewFaceplate`), rồi HOÁN ĐỔI `props.faceplate` giữa hai tài liệu và chứng minh
// đầu ra đổi theo — output theo document, không theo máy thật đang xem nó.
//
// 🔴 Bài này KHÔNG đo: (1) React thực sự render khác đi khi tài liệu bị hoán đổi — `.tsx` không
// `import()` được dưới `node --test` (xem `widgetRegistry.test.mjs`'s header), nên "đầu ra" ở đây là
// `OverviewFaceplateConfig` (deviceClass + tỉ lệ) mà `OperationOverviewFaceplate` nhận làm prop và đưa
// thẳng vào `SchematicPanel.deviceClass`/`style.flexGrow` — một bước lắp ráp JSX cuối cùng nằm ngoài
// những gì `node --test` chạy được, không phải một khoảng trống trong PHÉP TÍNH; (2) hành vi khi
// `props.faceplate` KHÔNG resolve được (rơi về placeholder "not wired yet") — đó là
// `widgetRegistry.test.mjs`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveOverviewFaceplate } from "../src/hmi-runtime/widgets/overviewFaceplate.ts"

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const SCREENS_DIR = join(WEB, "screens")

function loadWidgetProps(file) {
  const doc = JSON.parse(readFileSync(join(SCREENS_DIR, file), "utf8"))
  return doc.widgets[0].props
}

const AUTOMATION_PROPS = loadWidgetProps("automation-overview.json")
const AOI_PROPS = loadWidgetProps("aoi-overview.json")
const IOT_PROPS = loadWidgetProps("iot-overview.json")

// ── Đề xuất 1: mỗi tài liệu thật, không sửa gì, phân giải đúng máy và đúng tỉ lệ của NÓ ──────────
test("automation-overview.json's props phân giải đúng deviceClass Automation, tỉ lệ 1:1", () => {
  assert.deepEqual(resolveOverviewFaceplate(AUTOMATION_PROPS), {
    deviceClass: "Automation",
    schematicFlex: 1,
    readoutFlex: 1,
  })
})

test("aoi-overview.json's props phân giải đúng deviceClass AoiAvi, tỉ lệ 1.15:1", () => {
  assert.deepEqual(resolveOverviewFaceplate(AOI_PROPS), {
    deviceClass: "AoiAvi",
    schematicFlex: 1.15,
    readoutFlex: 1,
  })
})

test("iot-overview.json's props phân giải đúng deviceClass Iot, tỉ lệ 0.85:1.15", () => {
  assert.deepEqual(resolveOverviewFaceplate(IOT_PROPS), {
    deviceClass: "Iot",
    schematicFlex: 0.85,
    readoutFlex: 1.15,
  })
})

// ── Đề xuất 2 (THE deliverable — falsification #2 của review) ────────────────────────────────────
// Hoán đổi `props.faceplate` giữa hai tài liệu THẬT (giữ nguyên mọi thứ khác của mỗi bên) và chứng
// minh `resolveOverviewFaceplate` — hàm THẬT `faceplate.tsx` gọi — trả về deviceClass/tỉ lệ THEO
// TÀI LIỆU đã sửa, không theo tài liệu gốc. Trước fix round 1: `OperationOverviewFaceplate` bỏ qua id
// hoàn toàn (`machine.class` mới là thứ quyết định), nên phép hoán đổi này sẽ không đổi gì — đúng
// falsification reviewer nêu ra. Sau fix: nó đổi, vì hàm dưới đây đọc id trực tiếp.
test("HOÁN ĐỔI props.faceplate giữa aoi-overview.json và iot-overview.json → deviceClass phân giải đổi theo, không giữ nguyên", () => {
  const aoiWithIotId = { ...AOI_PROPS, faceplate: IOT_PROPS.faceplate }
  const iotWithAoiId = { ...IOT_PROPS, faceplate: AOI_PROPS.faceplate }

  const resolvedAoiWithIotId = resolveOverviewFaceplate(aoiWithIotId)
  const resolvedIotWithAoiId = resolveOverviewFaceplate(iotWithAoiId)

  // Đây là quả quyết chính: id bị hoán đổi ⇒ deviceClass PHẢI đổi theo id mới, KHÔNG phải "AoiAvi"/
  // "Iot" gốc — nếu đây fail nghĩa là ai đó đã quay lại hành vi round-0 (đọc props rồi bỏ đi).
  assert.equal(resolvedAoiWithIotId?.deviceClass, "Iot")
  assert.equal(resolvedIotWithAoiId?.deviceClass, "AoiAvi")

  // Và không chỉ deviceClass — tỉ lệ trong cùng file KHÔNG đổi (nó là property RIÊNG của
  // schematicFlex/readoutFlex, độc lập với id), nên bài này cũng ghim rằng hai trường này thật sự là
  // hai kênh riêng, không phải cùng một chuyển mạch.
  assert.equal(resolvedAoiWithIotId?.schematicFlex, AOI_PROPS.schematicFlex)
  assert.equal(resolvedIotWithAoiId?.schematicFlex, IOT_PROPS.schematicFlex)

  // Và kết quả sau hoán đổi phải KHÁC kết quả gốc — nếu bằng nhau, phép hoán đổi này là vô hại (đúng
  // điều reviewer đã chứng minh xảy ra ở round 0) và bài test này đã thất bại trong việc phát hiện nó.
  assert.notDeepEqual(resolvedAoiWithIotId, resolveOverviewFaceplate(AOI_PROPS))
  assert.notDeepEqual(resolvedIotWithAoiId, resolveOverviewFaceplate(IOT_PROPS))
})

// Đối chứng thứ hai, tách biệt khỏi tỉ lệ: hoán đổi CHỈ tỉ lệ (giữ nguyên id) cũng phải đổi output —
// ghim rằng `schematicFlex`/`readoutFlex` bản thân chúng cũng không bị bỏ qua như round 0 đã bỏ qua id.
test("hoán đổi CHỈ schematicFlex/readoutFlex (giữ nguyên faceplate id) → tỉ lệ phân giải đổi theo", () => {
  const aoiWithIotFlex = { ...AOI_PROPS, schematicFlex: IOT_PROPS.schematicFlex, readoutFlex: IOT_PROPS.readoutFlex }
  const resolved = resolveOverviewFaceplate(aoiWithIotFlex)
  assert.equal(resolved?.deviceClass, "AoiAvi") // id không đổi ⇒ deviceClass không đổi
  assert.equal(resolved?.schematicFlex, IOT_PROPS.schematicFlex) // nhưng tỉ lệ đổi theo props mới
  assert.equal(resolved?.readoutFlex, IOT_PROPS.readoutFlex)
  assert.notEqual(resolved?.schematicFlex, AOI_PROPS.schematicFlex)
})

// ── Đề xuất 3: id không nhận diện được ⇒ undefined, không ném (widget rơi về placeholder) ────────
test('props.faceplate không thuộc FACEPLATE_DEVICE_CLASS ⇒ undefined, không ném', () => {
  assert.doesNotThrow(() => resolveOverviewFaceplate({ faceplate: "fp.motor.spindle" }))
  assert.equal(resolveOverviewFaceplate({ faceplate: "fp.motor.spindle" }), undefined)
  assert.equal(resolveOverviewFaceplate({}), undefined)
  assert.equal(resolveOverviewFaceplate({ faceplate: 42 }), undefined)
})

// ── Đề xuất 4: schematicFlex/readoutFlex hỏng kiểu ⇒ rơi về 1 (chia đều), không ném, không NaN ────
test("schematicFlex/readoutFlex thiếu, âm, 0, hoặc không phải number ⇒ rơi về mặc định 1, không ném", () => {
  const base = { faceplate: "fp.overview.automation" }
  for (const bad of [undefined, -1, 0, NaN, Infinity, "1.15", null]) {
    const resolved = resolveOverviewFaceplate({ ...base, schematicFlex: bad, readoutFlex: bad })
    assert.ok(resolved, `faceplate id hợp lệ vẫn phải resolve dù tỉ lệ hỏng (bad=${bad})`)
    assert.equal(resolved.schematicFlex, 1)
    assert.equal(resolved.readoutFlex, 1)
  }
})
