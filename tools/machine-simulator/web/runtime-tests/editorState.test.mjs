// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-2 Task 7 — trạng thái tài liệu của trình soạn thảo trực quan + undo/redo, THUẦN LOGIC.
//
// `web/src/editor/editorState.ts` là `.ts` thuần, KHÔNG JSX, KHÔNG React, KHÔNG DOM — cùng lý do
// `hmi-runtime/bindings.ts` và `hmi-runtime/widgets/shared.ts` là thuần: `node --test` `import()` và
// THỰC THI được nó, nên mọi mệnh đề dưới đây đo HÀNH VI THẬT, không khớp mẫu văn bản. Bài duy nhất
// trong file này đọc mã nguồn là bài cuối, và nó chỉ đo TẬP IMPORT (xem lý do tại chỗ).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 HAI KỸ THUẬT ĐƯỢC DÙNG CÓ CHỦ Ý Ở ĐÂY, VÀ VÌ SAO
//
// (A) CẬN 100 ĐƯỢC VIẾT THẲNG RA, KHÔNG ĐỌC `UNDO_DEPTH_LIMIT`.
//     Bài "ngăn xếp undo dừng ở ĐÚNG 100 bước" viết 120 / 100 / 20 thành SỐ, và cố ý KHÔNG import
//     hằng số của module để tính chúng. Một bài đọc cận từ chính hiện thực rồi dùng nó để quyết định
//     đẩy bao nhiêu lần sửa sẽ XANH ở MỌI cận — nó ghim đúng con số không. Đó là khuyết tật
//     "ghim một chiều" mà cây mã này đã bị bắt sáu lần trong hai ngày. Sự trùng lặp ở đây là CỐ Ý:
//     ai nới hay siết cận trong `editorState.ts` phải sửa bài này, và phải nhìn thấy nó đỏ trước.
//     Bài `UNDO_DEPTH_LIMIT === 100` bên cạnh là dây bẫy rẻ tiền; bài HÀNH VI mới là bằng chứng
//     rằng hằng số ấy thật sự ĐƯỢC DÙNG.
//
// (B) "GIỮ HỢP LỆ THEO SCHEMA" ĐƯỢC ĐO BẰNG ĐỐI CHIẾU HAI PHÍA, KHÔNG BẰNG MỘT VÀI EDIT ĐẸP.
//     `editorState.ts` mang một bản sao viết tay của `$defs/widget`/`$defs/rect` (nó không thể
//     `import` `validate.mjs` — file đó là hạ tầng test, nằm ngoài `tsconfig.app.json`'s `include`,
//     và kéo nó vào bundle sản phẩm là sai chỗ). Phản đối thường trực của repo này với "bản sao thứ
//     hai của một luật" được trả lời đúng cách repo đã trả lời cho `web/src/contracts/*.ts`: bằng
//     một GHIM HAI CHIỀU CÓ CHẠY. Dưới đây là hai corpus (widget và rect); mỗi thành viên được đưa
//     qua CẢ `applyEdit` LẪN `validate.mjs` thật của Mốc 0, và bài khẳng định HAI CÂU TRẢ LỜI BẰNG
//     NHAU. Một guard nới ra (nhận thứ schema từ chối) hay siết vào (từ chối thứ schema nhận) đều đỏ.
//
//     HAI ngoại lệ đã biết, và cả hai được đo TỪ CẢ HAI PHÍA trong bài riêng của chúng — id TRÙNG và
//     giá trị KHÔNG-JSON trong `props`: `editorState.ts` nghiêm hơn schema ở đúng hai chỗ đó, mỗi bài
//     khẳng định schema THẬT SỰ cho phép (đo, không suy) rồi mới khẳng định editor từ chối. Ngày nào
//     schema siết lại, bài ấy đỏ và ghi chú "nghiêm hơn" phải sửa.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 🔴 BÀI NÀY KHÔNG ĐO:
//
// (1) Rằng có một giao diện soạn thảo nào GỌI các hàm này. Task 7 dựng đúng phần thuần logic; phần
//     React/kéo-thả là task sau, và bằng chứng của nó phải là Playwright trong trình duyệt thật —
//     `.tsx` không `import()` được dưới `node --test` (đo nhiều lần trên cây này; xem header của
//     `widgetRegistry.test.mjs` cho phép đo gốc).
// (2) Rằng `validate.mjs` THI HÀNH đúng JSON Schema. Nó là bản viết tay MỘT PHẦN và tự nói thế ở
//     header của chính nó; đọc file đó trước khi tin nó. Mọi khẳng định "hợp lệ" dưới đây chỉ mạnh
//     bằng bộ ấy — nhưng nó CŨNG là bộ mà `contracts.test.mjs` và `screens.test.mjs` dùng, nên
//     không có bộ luật thứ hai được dựng riêng cho bài này.
// (3) Rằng rect nằm trong `layout`. `$defs/rect` không có `maximum` nào; kẹp theo lưới là việc của
//     `gridLayout.ts`'s `clampRectToLayout` lúc render. Corpus dưới đây có một thành viên ĐO điều đó
//     (`col: 999` — schema NHẬN, nên editor phải NHẬN), để chỗ-không-phải-việc-của-nó là một phép đo
//     chứ không phải một khoảng trống.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  UNDO_DEPTH_LIMIT,
  applyEdit,
  createEditorState,
  redo,
  undo,
} from "../src/editor/editorState.ts"
import { validate } from "../contract-tests/validate.mjs"

// web/runtime-tests → web
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA_PATH = join(WEB, "..", "contracts", "hmi-screen.schema.json")
const DEMO_SCREEN_PATH = join(WEB, "screens", "demo", "component-demo.json")

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))

/** Đọc lại từ đĩa mỗi lần: không bài nào được thừa hưởng đột biến của bài trước. */
const demoDoc = () => JSON.parse(readFileSync(DEMO_SCREEN_PATH, "utf8"))
const freshState = () => createEditorState(demoDoc())

const docErrors = (doc) => validate(schema, schema, doc)
const widgetErrors = (widget) => validate(schema, schema.$defs.widget, widget)
const rectErrors = (rect) => validate(schema, schema.$defs.rect, rect)

const idsOf = (doc) => doc.widgets.map((w) => w.id)
const widgetOf = (doc, id) => doc.widgets.find((w) => w.id === id)

const RECT = (col, row, colSpan, rowSpan) => ({ col, row, colSpan, rowSpan })
const FRESH_RECT = RECT(0, 0, 1, 1)

function assertAccepted(state, what) {
  assert.equal(state.lastRefusal, undefined, `${what} đáng lẽ được NHẬN nhưng bị từ chối: ${state.lastRefusal}`)
}

function assertRefusedUnchanged(before, after, what) {
  assert.ok(
    typeof after.lastRefusal === "string" && after.lastRefusal.length > 0,
    `${what} đáng lẽ bị TỪ CHỐI KÈM LÝ DO, nhưng lastRefusal là ${JSON.stringify(after.lastRefusal)}`
  )
  // Tham chiếu, không phải nội dung: một lần từ chối không được dựng lại tài liệu.
  assert.equal(after.doc, before.doc, `${what}: doc đã bị thay dù edit bị từ chối`)
  assert.equal(after.past, before.past, `${what}: ngăn xếp undo đã bị đẩy dù edit bị từ chối`)
  assert.equal(after.future, before.future, `${what}: ngăn xếp redo đã bị đổi dù edit bị từ chối`)
}

// ── năm edit HỢP LỆ trên đúng tài liệu demo, dùng lại ở nhiều bài dưới ─────────────────────────────
//
// `component-demo.json` (17 widget, phủ cả 15 kind đã đăng ký) là tài liệu THẬT của cây này, không
// phải một fixture dựng riêng cho bài test — nên "sửa được nó" là một phép đo có nghĩa.
const ACCEPTED_EDITS = {
  move: { kind: "move", widgetId: "probe-a", rect: RECT(2, 3, 2, 2) },
  "set-prop": { kind: "set-prop", widgetId: "kind-gauge", path: "thresholds.warn", value: 35 },
  add: {
    kind: "add",
    widget: { id: "editor-added", kind: "readout", rect: FRESH_RECT, bindings: { value: "cycles" } },
  },
  remove: { kind: "remove", widgetId: "kind-label" },
  reorder: { kind: "reorder", widgetId: "probe-a", toIndex: 5 },
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Nền
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("nền: screens/demo/component-demo.json HỢP LỆ TRƯỚC khi sửa gì — 'giữ hợp lệ' chỉ có nghĩa nếu điểm xuất phát hợp lệ", () => {
  const errs = docErrors(demoDoc())
  assert.deepEqual(errs, [], `tài liệu nền đã KHÔNG hợp lệ, mọi bài 'giữ hợp lệ' dưới đây vô nghĩa:\n${errs.join("\n")}`)
  assert.equal(demoDoc().widgets.length, 17)
})

test("createEditorState: SAO CHÉP tài liệu — người gọi đột biến object của mình sau đó không chạm được vào state", () => {
  const caller = demoDoc()
  const state = createEditorState(caller)

  assert.notEqual(state.doc, caller, "state.doc là CHÍNH object người gọi đưa vào — một đột biến bên ngoài sẽ viết lại cả lịch sử")
  assert.deepEqual(state.doc, caller)
  assert.deepEqual(state.past, [])
  assert.deepEqual(state.future, [])
  assert.equal(state.lastRefusal, undefined)

  caller.widgets[0].id = "mutated-from-outside"
  caller.widgets.push({ id: "smuggled", kind: "label", rect: FRESH_RECT })
  assert.equal(state.doc.widgets[0].id, "probe-a")
  assert.equal(state.doc.widgets.length, 17)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mệnh đề 1 — applyEdit KHÔNG đột biến đầu vào
// ─────────────────────────────────────────────────────────────────────────────────────────────────

for (const [name, edit] of Object.entries(ACCEPTED_EDITS)) {
  test(`applyEdit(${name}) KHÔNG đột biến đầu vào — state cũ giữ nguyên THAM CHIẾU lẫn NỘI DUNG, kết quả là tài liệu MỚI`, () => {
    const state = freshState()
    const docRef = state.doc
    const widgetsRef = state.doc.widgets
    const contentBefore = structuredClone(state.doc)

    const next = applyEdit(state, edit)
    assertAccepted(next, `applyEdit(${name})`)

    assert.equal(state.doc, docRef, "state.doc bị thay tham chiếu")
    assert.equal(state.doc.widgets, widgetsRef, "state.doc.widgets bị thay tham chiếu")
    assert.deepEqual(state.doc, contentBefore, "NỘI DUNG tài liệu gốc đã đổi — applyEdit đã đột biến đầu vào")
    assert.deepEqual(state.past, [])
    assert.deepEqual(state.future, [])

    assert.notEqual(next.doc, state.doc, "applyEdit trả về CHÍNH tài liệu cũ — không có tài liệu mới nào được dựng")
    assert.notEqual(next.doc.widgets, state.doc.widgets)
    assert.notDeepEqual(next.doc, state.doc, `applyEdit(${name}) không đổi gì cả — bài này khi ấy không đo được tính thuần`)
  })
}

test("applyEdit(add): widget của người gọi được SAO CHÉP — đột biến nó sau đó không chạm vào tài liệu", () => {
  const state = freshState()
  const widget = { id: "editor-added", kind: "readout", rect: RECT(1, 1, 2, 2), props: { label: "trước" } }
  const next = applyEdit(state, { kind: "add", widget })
  assertAccepted(next, "add")

  widget.props.label = "sau"
  widget.rect.col = 41
  assert.equal(widgetOf(next.doc, "editor-added").props.label, "trước")
  assert.equal(widgetOf(next.doc, "editor-added").rect.col, 1)
})

test("applyEdit(set-prop): giá trị của người gọi được SAO CHÉP — đột biến nó sau đó không chạm vào tài liệu", () => {
  const state = freshState()
  const value = { warn: 31, fault: 41 }
  const next = applyEdit(state, { kind: "set-prop", widgetId: "kind-gauge", path: "thresholds", value })
  assertAccepted(next, "set-prop")

  value.warn = 999
  assert.equal(widgetOf(next.doc, "kind-gauge").props.thresholds.warn, 31)
})

test("applyEdit(set-prop): prop anh em và widget anh em KHÔNG bị chạm tới", () => {
  const state = freshState()
  const next = applyEdit(state, ACCEPTED_EDITS["set-prop"])
  assertAccepted(next, "set-prop")

  const gauge = widgetOf(next.doc, "kind-gauge")
  assert.equal(gauge.props.thresholds.warn, 35)
  assert.equal(gauge.props.thresholds.fault, 40, "prop anh em trong cùng object lồng đã bị xoá")
  assert.equal(gauge.props.label, "Nhiệt độ", "prop anh em ở cấp trên đã bị xoá")
  assert.equal(gauge.props.max, 60)
  // Mọi widget KHÁC phải là ĐÚNG object cũ — chia sẻ cấu trúc, không sao chép sâu vô cớ.
  for (const before of state.doc.widgets) {
    if (before.id === "kind-gauge") continue
    assert.equal(widgetOf(next.doc, before.id), before, `widget "${before.id}" bị dựng lại dù edit không chạm tới nó`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mệnh đề 2 & 3 — undo · redo · nhánh redo bị xoá
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Ba lần sửa KHÁC NHAU, mỗi lần đổi tài liệu thật sự. */
function threeEdits() {
  const s0 = freshState()
  const s1 = applyEdit(s0, ACCEPTED_EDITS.move)
  const s2 = applyEdit(s1, ACCEPTED_EDITS["set-prop"])
  const s3 = applyEdit(s2, ACCEPTED_EDITS.add)
  assertAccepted(s1, "lần 1")
  assertAccepted(s2, "lần 2")
  assertAccepted(s3, "lần 3")
  // Nếu ba tài liệu không khác nhau thì "trả về đúng trạng thái sau hai lần" không phân biệt được
  // với "sau ba lần", và bài dưới sẽ xanh mà không đo gì.
  assert.notDeepEqual(s1.doc, s0.doc)
  assert.notDeepEqual(s2.doc, s1.doc)
  assert.notDeepEqual(s3.doc, s2.doc)
  return { s0, s1, s2, s3 }
}

test("undo sau BA lần sửa trả về ĐÚNG trạng thái sau HAI lần", () => {
  const { s2, s3 } = threeEdits()
  const back = undo(s3)

  assert.equal(back.lastRefusal, undefined)
  assert.deepEqual(back.doc, s2.doc, "undo không đưa về tài liệu sau hai lần sửa")
  assert.notDeepEqual(back.doc, s3.doc)
  assert.equal(back.past.length, 2)
  assert.equal(back.future.length, 1)
})

test("undo hai lần rồi ba lần đi ngược đúng từng bước — không nhảy cóc, không dừng sớm", () => {
  const { s0, s1, s2, s3 } = threeEdits()
  const back1 = undo(s3)
  const back2 = undo(back1)
  const back3 = undo(back2)
  assert.deepEqual(back1.doc, s2.doc)
  assert.deepEqual(back2.doc, s1.doc)
  assert.deepEqual(back3.doc, s0.doc)
  assert.equal(back3.past.length, 0)
  assert.equal(back3.future.length, 3)
})

test("redo sau undo trả lại ĐÚNG lần thứ ba", () => {
  const { s3 } = threeEdits()
  const forward = redo(undo(s3))

  assert.equal(forward.lastRefusal, undefined)
  assert.deepEqual(forward.doc, s3.doc, "redo không đưa lại tài liệu sau ba lần sửa")
  assert.equal(forward.past.length, 3)
  assert.deepEqual(forward.future, [])
})

test("một applyEdit MỚI sau undo XOÁ nhánh redo — lần thứ ba KHÔNG quay lại được nữa", () => {
  const { s3 } = threeEdits()
  const back = undo(s3)
  assert.equal(back.future.length, 1, "chưa có nhánh redo nào để xoá — bài này khi ấy không đo gì")

  const branched = applyEdit(back, ACCEPTED_EDITS.remove)
  assertAccepted(branched, "lần sửa mới sau undo")
  assert.deepEqual(branched.future, [], "nhánh redo vẫn còn sau một lần sửa mới")

  const attempted = redo(branched)
  assertRefusedUnchanged(branched, attempted, "redo sau khi nhánh đã bị xoá")
  assert.notDeepEqual(attempted.doc, s3.doc, "lần thứ ba đã quay lại được — nhánh redo chưa bị xoá thật")
})

test("undo ở ĐÁY và redo ở ĐỈNH là no-op CÓ LÝ DO — không ném, không đổi tài liệu", () => {
  const state = freshState()

  const u = undo(state)
  assertRefusedUnchanged(state, u, "undo trên state mới tinh")

  const r = redo(state)
  assertRefusedUnchanged(state, r, "redo khi chưa undo lần nào")

  // Hai lý do phải KHÁC NHAU: "chưa có gì để hoàn tác" và "không có gì để làm lại" là hai tình huống
  // khác nhau và cần hai câu khác nhau — cùng luật `policyGate` đã đặt cho hai nhánh disabled của nó.
  assert.notEqual(u.lastRefusal, r.lastRefusal)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mệnh đề 4 — CẬN TRÊN của ngăn xếp
//
// 🔴 100 · 120 · 20 là SỐ VIẾT THẲNG, CỐ Ý KHÔNG đọc `UNDO_DEPTH_LIMIT`. Xem khối (A) ở đầu file.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("UNDO_DEPTH_LIMIT được EXPORT bằng ĐÚNG 100 — dây bẫy rẻ tiền, đỏ ngay khi ai đó đổi hằng số", () => {
  assert.equal(UNDO_DEPTH_LIMIT, 100)
})

test("ngăn xếp undo dừng ở ĐÚNG 100 bước — nới cận HAY siết cận đều làm bài này ĐỎ", () => {
  const seq = (n) => ({ kind: "set-prop", widgetId: "probe-a", path: "seq", value: n })

  let state = freshState()
  for (let i = 1; i <= 120; i++) {
    state = applyEdit(state, seq(i))
    assertAccepted(state, `lần sửa #${i}`)
  }
  assert.equal(widgetOf(state.doc, "probe-a").props.seq, 120)
  assert.equal(state.past.length, 100, "ngăn xếp undo giữ số bước KHÁC 100 sau 120 lần sửa")

  for (let i = 1; i <= 100; i++) state = undo(state)
  assert.equal(state.past.length, 0)
  assert.equal(state.future.length, 100)
  assert.equal(
    widgetOf(state.doc, "probe-a").props.seq,
    20,
    "sau 120 lần sửa và 100 lần undo, tài liệu phải là tài liệu SAU LẦN SỬA THỨ 20 — 20 bước đầu đã rơi khỏi đáy ngăn xếp"
  )

  // Tính lại đích đến một cách ĐỘC LẬP: phát lại 20 lần sửa đầu trên một state mới tinh.
  let replayed = freshState()
  for (let i = 1; i <= 20; i++) replayed = applyEdit(replayed, seq(i))
  assert.deepEqual(state.doc, replayed.doc)

  // 🔴 ĐÂY là câu bắt việc NỚI cận: ở cận 100 thì lần undo thứ 101 không còn gì để lấy; ở cận 200
  // thì nó vẫn lùi được một bước nữa, và assert này đỏ.
  const bottom = state
  const oneMore = undo(bottom)
  assertRefusedUnchanged(bottom, oneMore, "lần undo thứ 101 sau khi ngăn xếp đã cạn")
  assert.equal(widgetOf(oneMore.doc, "probe-a").props.seq, 20)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mệnh đề 5 — remove rồi undo khôi phục ĐÚNG VỊ TRÍ
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("remove một widget ở GIỮA rồi undo khôi phục nó ĐÚNG chỉ số cũ, không đẩy xuống cuối mảng", () => {
  const state = freshState()
  const orderBefore = idsOf(state.doc)
  const target = "kind-gauge"
  const index = orderBefore.indexOf(target)
  assert.ok(
    index > 0 && index < orderBefore.length - 1,
    `"${target}" phải nằm GIỮA mảng, nếu không "khôi phục đúng chỗ" và "đẩy xuống cuối" không phân biệt được (đang ở ${index}/${orderBefore.length})`
  )

  const removed = applyEdit(state, { kind: "remove", widgetId: target })
  assertAccepted(removed, "remove")
  assert.equal(widgetOf(removed.doc, target), undefined)
  assert.deepEqual(
    idsOf(removed.doc),
    orderBefore.filter((id) => id !== target),
    "remove đã xáo trộn những widget khác"
  )

  const restored = undo(removed)
  assert.equal(restored.lastRefusal, undefined)
  assert.equal(
    idsOf(restored.doc).indexOf(target),
    index,
    `undo khôi phục "${target}" ở chỉ số ${idsOf(restored.doc).indexOf(target)} thay vì ${index}`
  )
  // Toàn bộ THỨ TỰ, không chỉ sự có mặt: một hiện thực "thêm lại vào cuối" qua được phép kiểm có-mặt.
  assert.deepEqual(idsOf(restored.doc), orderBefore)
  assert.deepEqual(restored.doc, state.doc)
})

test("reorder đưa widget tới ĐÚNG chỉ số, thứ tự tương đối của phần còn lại giữ nguyên; undo trả lại thứ tự cũ", () => {
  const state = freshState()
  const orderBefore = idsOf(state.doc)

  const moved = applyEdit(state, ACCEPTED_EDITS.reorder)
  assertAccepted(moved, "reorder")
  const orderAfter = idsOf(moved.doc)

  assert.equal(orderAfter.indexOf("probe-a"), 5)
  assert.deepEqual(orderAfter.length, orderBefore.length)
  assert.deepEqual(
    orderAfter.filter((id) => id !== "probe-a"),
    orderBefore.filter((id) => id !== "probe-a"),
    "reorder đã xáo trộn thứ tự tương đối của những widget khác"
  )
  assert.deepEqual(idsOf(undo(moved).doc), orderBefore)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mệnh đề 6 — MỌI edit giữ tài liệu hợp lệ theo schema đóng băng (validate.mjs của Mốc 0)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

for (const [name, edit] of Object.entries(ACCEPTED_EDITS)) {
  test(`${name}: tài liệu SAU khi sửa vẫn hợp lệ theo contracts/hmi-screen.schema.json — và undo/redo của nó cũng vậy`, () => {
    const state = freshState()
    const next = applyEdit(state, edit)
    assertAccepted(next, `applyEdit(${name})`)
    assert.notDeepEqual(next.doc, state.doc, "không có gì đổi — bài này khi ấy validate lại đúng tài liệu nền")

    const after = docErrors(next.doc)
    assert.deepEqual(after, [], `tài liệu sau ${name} KHÔNG hợp lệ:\n${after.join("\n")}`)

    const undone = undo(next)
    assert.deepEqual(docErrors(undone.doc), [])
    assert.deepEqual(docErrors(redo(undone).doc), [])
  })
}

// ── corpus ĐỐI CHIẾU: `add` phải nhận ĐÚNG những widget schema đóng băng nhận ──────────────────────
//
// Mọi id ở đây đều KHÔNG có trên tài liệu demo, nên luật "id phải duy nhất" (nghiêm hơn schema)
// không can thiệp vào phép đối chiếu này; luật ấy có bài riêng bên dưới.
const WIDGET_CORPUS = [
  ["tối thiểu hợp lệ", { id: "w-min", kind: "readout", rect: FRESH_RECT }],
  ["id chỉ toàn chữ số", { id: "0", kind: "label", rect: FRESH_RECT }],
  ["id có gạch nối", { id: "a-b-c-9", kind: "label", rect: FRESH_RECT }],
  [
    "đủ trường tuỳ chọn",
    {
      id: "w-full",
      kind: "readout",
      rect: RECT(3, 2, 4, 2),
      component: "probe-temp",
      bindings: { value: "{component}" },
      props: { label: "x", nested: { a: [1, 2, null, "s"], b: true } },
    },
  ],
  [
    "policyAction trên một kind KHÔNG bắt buộc nó (schema cho phép — guard không được nghiêm hơn ở đây)",
    { id: "w-extra-policy", kind: "readout", rect: FRESH_RECT, policyAction: "machine.command" },
  ],
  [
    "command-button CÓ policyAction",
    { id: "w-cb-ok", kind: "command-button", rect: FRESH_RECT, policyAction: "machine.command" },
  ],
  [
    "setpoint-input CÓ policyAction",
    { id: "w-sp-ok", kind: "setpoint-input", rect: FRESH_RECT, policyAction: "machine.setpoint" },
  ],
  ["bindings rỗng", { id: "w-b-empty", kind: "label", rect: FRESH_RECT, bindings: {} }],
  ["props rỗng", { id: "w-p-empty", kind: "label", rect: FRESH_RECT, props: {} }],
  [
    "rect VƯỢT lưới của tài liệu (schema không có maximum — kẹp lưới là việc của gridLayout.ts)",
    { id: "w-far", kind: "label", rect: RECT(999, 999, 12, 12) },
  ],
  // ── phía TỪ CHỐI ──
  ["id VIẾT HOA", { id: "W-New", kind: "readout", rect: FRESH_RECT }],
  ["id RỖNG", { id: "", kind: "readout", rect: FRESH_RECT }],
  ["id có gạch dưới", { id: "w_new", kind: "readout", rect: FRESH_RECT }],
  ["id có khoảng trắng", { id: "w new", kind: "readout", rect: FRESH_RECT }],
  ["id KHÔNG phải chuỗi", { id: 7, kind: "readout", rect: FRESH_RECT }],
  ["thiếu id", { kind: "readout", rect: FRESH_RECT }],
  ["kind lạ", { id: "w-kind", kind: "not-a-kind", rect: FRESH_RECT }],
  ["thiếu kind", { id: "w-nokind", rect: FRESH_RECT }],
  ["thiếu rect", { id: "w-norect", kind: "readout" }],
  ["rect col âm", { id: "w-r1", kind: "readout", rect: RECT(-1, 0, 1, 1) }],
  ["rect colSpan bằng 0", { id: "w-r2", kind: "readout", rect: RECT(0, 0, 0, 1) }],
  ["rect col không nguyên", { id: "w-r3", kind: "readout", rect: RECT(0.5, 0, 1, 1) }],
  ["rect thiếu rowSpan", { id: "w-r4", kind: "readout", rect: { col: 0, row: 0, colSpan: 1 } }],
  ["rect có trường lạ", { id: "w-r5", kind: "readout", rect: { ...FRESH_RECT, z: 1 } }],
  ["widget có trường lạ", { id: "w-x", kind: "readout", rect: FRESH_RECT, label: "lạ" }],
  ["bindings có giá trị KHÔNG phải chuỗi", { id: "w-b1", kind: "readout", rect: FRESH_RECT, bindings: { value: 42 } }],
  ["bindings là MẢNG", { id: "w-b2", kind: "readout", rect: FRESH_RECT, bindings: ["value"] }],
  ["props là MẢNG", { id: "w-p1", kind: "readout", rect: FRESH_RECT, props: [] }],
  ["props là null", { id: "w-p2", kind: "readout", rect: FRESH_RECT, props: null }],
  ["component KHÔNG phải chuỗi", { id: "w-c1", kind: "readout", rect: FRESH_RECT, component: 42 }],
  ["policyAction sai HOA/thường", { id: "w-pa1", kind: "command-button", rect: FRESH_RECT, policyAction: "MACHINE.COMMAND" }],
  ["policyAction ngoài từ vựng", { id: "w-pa2", kind: "command-button", rect: FRESH_RECT, policyAction: "xyzzy" }],
  ["command-button THIẾU policyAction (bất biến §5)", { id: "w-cb-bad", kind: "command-button", rect: FRESH_RECT }],
  ["setpoint-input THIẾU policyAction (bất biến §5)", { id: "w-sp-bad", kind: "setpoint-input", rect: FRESH_RECT }],
]

for (const [why, widget] of WIDGET_CORPUS) {
  test(`add · ${why}: applyEdit và validate.mjs ĐỒNG Ý — guard viết tay không được nới cũng không được siết`, () => {
    const errs = widgetErrors(widget)
    const schemaAccepts = errs.length === 0

    const state = freshState()
    const next = applyEdit(state, { kind: "add", widget })
    const editorAccepts = next.lastRefusal === undefined

    assert.equal(
      editorAccepts,
      schemaAccepts,
      schemaAccepts
        ? `schema đóng băng NHẬN widget này, applyEdit TỪ CHỐI: ${next.lastRefusal}`
        : `schema đóng băng TỪ CHỐI widget này (${errs.join("; ")}), applyEdit lại NHẬN`
    )

    if (schemaAccepts) {
      assert.deepEqual(docErrors(next.doc), [], "widget hợp lệ được thêm vào nhưng TÀI LIỆU lại thành không hợp lệ")
      assert.equal(next.doc.widgets.length, state.doc.widgets.length + 1)
      assert.equal(next.doc.widgets[next.doc.widgets.length - 1].id, widget.id, "add không nối vào CUỐI mảng")
    } else {
      assertRefusedUnchanged(state, next, `add · ${why}`)
    }
  })
}

// ── corpus ĐỐI CHIẾU: `move` phải nhận ĐÚNG những rect schema đóng băng nhận ───────────────────────
//
// Không thành viên nào bằng rect hiện tại của "probe-a" ({col:0,row:0,colSpan:4,rowSpan:1}), nên luật
// "edit không đổi gì thì từ chối" không can thiệp; luật ấy có bài riêng bên dưới.
const RECT_CORPUS = [
  ["nhỏ nhất hợp lệ (đúng bốn minimum)", FRESH_RECT],
  ["thường gặp", RECT(5, 4, 3, 2)],
  ["vượt lưới (schema không có maximum)", RECT(999, 999, 40, 40)],
  ["col âm", RECT(-1, 0, 1, 1)],
  ["row âm", RECT(0, -1, 1, 1)],
  ["colSpan bằng 0", RECT(0, 0, 0, 1)],
  ["rowSpan bằng 0", RECT(0, 0, 1, 0)],
  ["rowSpan âm", RECT(0, 0, 1, -3)],
  ["col không nguyên", RECT(1.5, 0, 1, 1)],
  ["col là chuỗi", RECT("0", 0, 1, 1)],
  ["col là null", RECT(null, 0, 1, 1)],
  ["thiếu col", { row: 0, colSpan: 1, rowSpan: 1 }],
  ["có trường lạ", { ...RECT(1, 1, 1, 1), z: 1 }],
]

for (const [why, rect] of RECT_CORPUS) {
  test(`move · rect ${why}: applyEdit và validate.mjs ĐỒNG Ý về $defs/rect`, () => {
    const errs = rectErrors(rect)
    const schemaAccepts = errs.length === 0

    const state = freshState()
    const next = applyEdit(state, { kind: "move", widgetId: "probe-a", rect })
    const editorAccepts = next.lastRefusal === undefined

    assert.equal(
      editorAccepts,
      schemaAccepts,
      schemaAccepts
        ? `schema đóng băng NHẬN rect này, applyEdit TỪ CHỐI: ${next.lastRefusal}`
        : `schema đóng băng TỪ CHỐI rect này (${errs.join("; ")}), applyEdit lại NHẬN`
    )

    if (schemaAccepts) {
      assert.deepEqual(docErrors(next.doc), [])
      assert.deepEqual(widgetOf(next.doc, "probe-a").rect, rect)
    } else {
      assertRefusedUnchanged(state, next, `move · rect ${why}`)
    }
  })
}

// ── hai chỗ NGHIÊM HƠN schema, mỗi chỗ đo CẢ HAI PHÍA ─────────────────────────────────────────────

test("add id TRÙNG bị TỪ CHỐI — nghiêm hơn schema CÓ CHỦ Ý, và schema thật sự CHO PHÉP trùng (đo, không suy)", () => {
  const state = freshState()
  const duplicate = { id: "probe-a", kind: "label", rect: FRESH_RECT }

  // Phía schema, đo chứ không suy: nếu ngày nào `hmi-screen.schema.json` cấm id trùng, dòng này đỏ
  // và ghi chú "nghiêm hơn schema" trong editorState.ts phải được sửa lại.
  const withDuplicate = { ...state.doc, widgets: [...state.doc.widgets, duplicate] }
  assert.deepEqual(
    docErrors(withDuplicate),
    [],
    "schema đóng băng GIỜ cấm id trùng — luật 'nghiêm hơn schema' của editorState.ts không còn là ngoại lệ, hãy sửa doc comment ở đó"
  )

  const next = applyEdit(state, { kind: "add", widget: duplicate })
  assertRefusedUnchanged(state, next, "add id trùng")
  assert.ok(next.lastRefusal.includes("probe-a"), `lý do không nêu đích danh id: ${next.lastRefusal}`)
})

const NOT_JSON = [
  ["undefined", undefined],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["một hàm", () => 1],
  ["một Date", new Date(0)],
  ["một Map", new Map([["a", 1]])],
  ["một BigInt", 1n],
  ["một Symbol", Symbol("s")],
]

for (const [why, value] of NOT_JSON) {
  test(`set-prop giá trị KHÔNG-JSON (${why}) bị TỪ CHỐI — nghiêm hơn schema CÓ CHỦ Ý: nó không hề đi xuống props`, () => {
    const state = freshState()
    const next = applyEdit(state, { kind: "set-prop", widgetId: "probe-a", path: "x", value })
    assertRefusedUnchanged(state, next, `set-prop ${why}`)
  })
}

test("set-prop giá trị vòng lặp bị TỪ CHỐI — JSON.stringify sẽ NÉM, không phải nói dối", () => {
  const state = freshState()
  const cyclic = { name: "vòng" }
  cyclic.self = cyclic
  const next = applyEdit(state, { kind: "set-prop", widgetId: "probe-a", path: "x", value: cyclic })
  assertRefusedUnchanged(state, next, "set-prop vòng lặp")
})

test("phía schema của luật KHÔNG-JSON: schema đóng băng THẬT SỰ cho props chứa những giá trị ấy đi qua (đo, không suy)", () => {
  // `props` được khai là `{"type":"object"}` trần, nên `validate.mjs` không đi xuống dưới nó. Đây là
  // lý do luật KHÔNG-JSON phải nằm ở editorState.ts chứ không thể trông chờ vào schema — và là phép
  // đo chứng minh nó, thay vì một câu khẳng định trong comment.
  const widget = { id: "w-json", kind: "label", rect: FRESH_RECT, props: { when: new Date(0), missing: undefined } }
  assert.deepEqual(
    widgetErrors(widget),
    [],
    "schema đóng băng GIỜ đi xuống props — luật KHÔNG-JSON của editorState.ts không còn là ngoại lệ, hãy sửa doc comment ở đó"
  )

  const state = freshState()
  const next = applyEdit(state, { kind: "add", widget })
  assertRefusedUnchanged(state, next, "add widget có props không-JSON")
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Từ chối: hướng thất bại của từng edit
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const UNKNOWN_ID_EDITS = [
  ["move", { kind: "move", widgetId: "no-such-widget", rect: RECT(1, 1, 1, 1) }],
  ["set-prop", { kind: "set-prop", widgetId: "no-such-widget", path: "label", value: "x" }],
  ["remove", { kind: "remove", widgetId: "no-such-widget" }],
  ["reorder", { kind: "reorder", widgetId: "no-such-widget", toIndex: 0 }],
]

for (const [name, edit] of UNKNOWN_ID_EDITS) {
  test(`${name} nhắm tới widgetId KHÔNG TỒN TẠI bị TỪ CHỐI, và lý do NÊU ĐÍCH DANH id sai`, () => {
    const state = freshState()
    const next = applyEdit(state, edit)
    assertRefusedUnchanged(state, next, `${name} với id lạ`)
    assert.ok(
      next.lastRefusal.includes("no-such-widget"),
      `lý do không nêu id sai, người sửa không biết tìm đâu: ${next.lastRefusal}`
    )
  })
}

const BAD_PATHS = ["", ".", "a.", ".a", "a..b", 7, null]

for (const path of BAD_PATHS) {
  test(`set-prop với path ${JSON.stringify(path) ?? typeof path} bị TỪ CHỐI — một đoạn không tên không phải một prop`, () => {
    const state = freshState()
    const next = applyEdit(state, { kind: "set-prop", widgetId: "probe-a", path, value: 1 })
    assertRefusedUnchanged(state, next, `set-prop path ${JSON.stringify(path) ?? typeof path}`)
  })
}

test("set-prop KHÔNG đi xuyên qua một giá trị không phải object — nhãn đang có không bị XOÁ âm thầm", () => {
  const state = freshState()
  assert.equal(widgetOf(state.doc, "kind-label").props.text, "Nhãn tĩnh")

  const next = applyEdit(state, { kind: "set-prop", widgetId: "kind-label", path: "text.deep", value: 1 })
  assertRefusedUnchanged(state, next, "set-prop xuyên qua một chuỗi")
  assert.ok(next.lastRefusal.includes("text"), `lý do không nêu đoạn path gây lỗi: ${next.lastRefusal}`)
})

test("set-prop TẠO object trung gian trên một widget chưa có props nào", () => {
  const state = freshState()
  assert.equal(widgetOf(state.doc, "probe-a").props, undefined)

  const next = applyEdit(state, { kind: "set-prop", widgetId: "probe-a", path: "a.b.c", value: [1, { d: null }] })
  assertAccepted(next, "set-prop path lồng ba tầng")
  assert.deepEqual(widgetOf(next.doc, "probe-a").props, { a: { b: { c: [1, { d: null }] } } })
  assert.deepEqual(docErrors(next.doc), [])
})

const BAD_TO_INDEX = [-1, 17, 999, 1.5, "2", null]

for (const toIndex of BAD_TO_INDEX) {
  test(`reorder với toIndex ${JSON.stringify(toIndex) ?? typeof toIndex} bị TỪ CHỐI — KHÔNG kẹp lại âm thầm về một chỗ nào khác`, () => {
    const state = freshState()
    const next = applyEdit(state, { kind: "reorder", widgetId: "probe-a", toIndex })
    assertRefusedUnchanged(state, next, `reorder toIndex ${JSON.stringify(toIndex) ?? typeof toIndex}`)
  })
}

test("reorder tới chỉ số CUỐI (n-1) được NHẬN — biên trên là một vị trí thật, không phải một lỗi", () => {
  const state = freshState()
  const last = state.doc.widgets.length - 1
  const next = applyEdit(state, { kind: "reorder", widgetId: "probe-a", toIndex: last })
  assertAccepted(next, "reorder tới chỉ số cuối")
  assert.equal(idsOf(next.doc).indexOf("probe-a"), last)
  assert.deepEqual(docErrors(next.doc), [])
})

test("một edit KHÔNG đổi gì bị TỪ CHỐI — ngăn xếp có cận, một bước hoàn tác chết là một bước bị đánh cắp", () => {
  const state = freshState()

  const sameRect = structuredClone(widgetOf(state.doc, "probe-a").rect)
  assertRefusedUnchanged(state, applyEdit(state, { kind: "move", widgetId: "probe-a", rect: sameRect }), "move về đúng chỗ cũ")

  assertRefusedUnchanged(state, applyEdit(state, { kind: "reorder", widgetId: "probe-a", toIndex: 0 }), "reorder về đúng chỗ cũ")

  const sameValue = widgetOf(state.doc, "kind-gauge").props.thresholds.warn
  assertRefusedUnchanged(
    state,
    applyEdit(state, { kind: "set-prop", widgetId: "kind-gauge", path: "thresholds.warn", value: sameValue }),
    "set-prop về đúng giá trị cũ"
  )
})

test("một edit.kind KHÔNG NẰM TRONG EditorEdit bị TỪ CHỐI kèm tên nó — không bị bỏ qua âm thầm", () => {
  const state = freshState()
  const next = applyEdit(state, { kind: "resize", widgetId: "probe-a" })
  assertRefusedUnchanged(state, next, "edit.kind lạ")
  assert.ok(next.lastRefusal.includes("resize"), `lý do không nêu kind lạ: ${next.lastRefusal}`)
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Điều kiện tiên quyết của cả file: module này KHÔNG kéo theo React/DOM
// ─────────────────────────────────────────────────────────────────────────────────────────────────

test("editorState.ts import ĐÚNG hai kiểu từ hợp đồng đóng băng và KHÔNG GÌ KHÁC — cả hai đều là `import type`", () => {
  // 🔴 CRLF — cùng lý do mọi bài đọc mã nguồn trong cây này nêu: `core.autocrlf=true`, working tree
  // có \r\n, còn mẫu dưới đây viết \n.
  const src = readFileSync(join(WEB, "src", "editor", "editorState.ts"), "utf8").replace(/\r\n/g, "\n")

  const imports = [...src.matchAll(/^import\s+(type\s+)?[^"']*from\s+"([^"]+)"/gm)]
  assert.deepEqual(
    imports.map((m) => m[2]).sort(),
    ["../contracts/hmiScreen.ts", "../contracts/tagNamespace.ts"],
    "editorState.ts import thứ gì đó ngoài hai kiểu hợp đồng đóng băng — React, DOM hay một thư viện đều làm hỏng điều kiện để node --test thực thi file này"
  )
  assert.ok(
    imports.every((m) => m[1] !== undefined),
    "một import KHÔNG phải `import type` — module này không được nạp gì lúc chạy"
  )

  // Bằng chứng THẬT của cùng mệnh đề không nằm ở đoạn regex trên mà ở việc mọi bài phía trên đã
  // import và THỰC THI module này dưới `node --test`, nơi không có `document`, `window`, hay React.
  assert.equal(typeof globalThis.document, "undefined", "môi trường chạy có DOM — phép đo trên không còn là phép đo")
  assert.equal(typeof applyEdit, "function")
})
