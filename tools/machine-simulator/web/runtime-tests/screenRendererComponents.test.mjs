// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// WS-HMI-2 Task 5 — `components` reaches the widget, and `{component}` resolves in the product.
//
// The DEFECT this task closed was never in `bindings.ts`: that module implemented `{component}` in
// full at WS-HMI-1 Task 3 and `bindings.test.mjs` executes it directly. It was that the ONE
// `<ScreenRenderer>` in the whole client (`Hmi.tsx`) was mounted with no `components` prop, so
// `componentTagPrefixOf` was always called with `undefined` and every `{component}` binding came back
// with its braces still in it. Measured at `71e3af4c` before any of this task's code existed — see
// `task-5-report.md` §1.
//
// 🔴 What this file measures, and what it CANNOT:
//
// (1) EXECUTED — the widget-facing read path. `widgets/shared.ts`'s `readBinding` is the function every
//     widget calls, and `resolve` is built here EXACTLY the way `ScreenRenderer.tsx`'s `RenderedWidget`
//     builds it (`resolveBinding(b, componentTagPrefixOf(components, widget.component))`). Real
//     functions, real `TagValueSource`, real widget/component documents — not a re-description of them.
//
// (2) SOURCE TEXT — that `ScreenRenderer.tsx`/`Hmi.tsx` actually pass the prop, and that the shape is
//     declared ONCE. `.tsx` cannot be `import()`-ed under `node --test` at all (measured repeatedly
//     across this tree — see `widgetRegistry.test.mjs`'s header for the exact probe), so these are
//     pattern matches and carry that technique's known weakness: a cosmetic edit can defeat them
//     (`hmiWiring.test.mjs`'s own header documents a reviewer doing exactly that, 5/5 green, with the
//     whole deliverable reverted). They are NOT the guarantee — `tests/35-hmi-indirect-binding.spec.ts`
//     is, in a real browser, on a real screen, reading what two tiles actually SAY. These exist because
//     they are cheap and because they name the specific line a revert would delete.
//
// (3) NOT MEASURED HERE — that a widget RENDERS the resolved value. That needs a DOM; same file.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { componentTagPrefixOf, resolveBinding, unresolvedComponentBindingWarning } from "../src/hmi-runtime/bindings.ts"
import { createMachineDetailSource } from "../src/hmi-runtime/TagValueSource.ts"
import { NO_DATA, readBinding } from "../src/hmi-runtime/widgets/shared.ts"
import { validate } from "../contract-tests/validate.mjs"

// web/runtime-tests → web
const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const DEMO_SCREEN_PATH = join(WEB, "screens", "demo", "component-demo.json")
const SCHEMA_PATH = join(WEB, "..", "contracts", "hmi-screen.schema.json")

// 🔴 CRLF — same reason every source-text test in this tree states: `core.autocrlf=true`, a fresh
// checkout has \r\n in the working tree, and the patterns below hard-code \n.
const readSource = (...parts) => readFileSync(join(WEB, ...parts), "utf8").replace(/\r\n/g, "\n")

const demoScreen = JSON.parse(readFileSync(DEMO_SCREEN_PATH, "utf8"))

/** The live snapshot the demo route reads through — the same shape `Hmi.tsx` hands
 * `createMachineDetailSource`, with the two telemetry series `IotSensorSim` actually produces. */
const IOT_SNAPSHOT = {
  code: "IOT-01",
  cycles: 41,
  passRate: 1,
  statusText: "TELEMETRY",
  driftState: "—",
  cycleLog: [],
  telemetry: [
    { metric: "temperature", values: [23.97] },
    { metric: "humidity", values: [62.65] },
  ],
}

/** The component tree `35-hmi-indirect-binding.spec.ts` PUTs for the same machine, kept in step with it
 * by naming the same ids and prefixes the demo screen's widgets reference. */
const DECLARED_COMPONENTS = [
  { id: "probe-temp", typeId: "sensor.probe", label: "T", tagPrefix: "telemetry/temperature" },
  { id: "probe-hum", typeId: "sensor.probe", label: "H", tagPrefix: "telemetry/humidity" },
]

/** `RenderedWidget`'s two lines (`ScreenRenderer.tsx`), reproduced exactly — this is the seam under
 * test, so it is built the same way rather than approximated. */
function renderValueOf(widget, components, source) {
  const tagPrefix = componentTagPrefixOf(components, widget.component)
  const resolve = (binding) => resolveBinding(binding, tagPrefix)
  const tv = readBinding({ widget, source, resolve }, "value")
  return { resolved: resolve(widget.bindings?.value), rendered: tv ? String(tv.value) : NO_DATA }
}

const widgetById = (id) => {
  const w = demoScreen.widgets.find((x) => x.id === id)
  assert.ok(w, `screens/demo/component-demo.json thiếu widget "${id}"`)
  return w
}

// ─────────────────────────────────────────────────────────────────────────
// EXECUTED — the defect, and the fix, at the widget-facing seam
// ─────────────────────────────────────────────────────────────────────────

test("KHÔNG có components (đúng thứ Hmi.tsx truyền trước Task 5): cả hai instance ra CÙNG một chỗ giữ", () => {
  const source = createMachineDetailSource(IOT_SNAPSHOT)
  const a = renderValueOf(widgetById("probe-a"), undefined, source)
  const b = renderValueOf(widgetById("probe-b"), undefined, source)

  // The braces survive — `TagValueSource` never sees a path it could answer.
  assert.equal(a.resolved, "{component}")
  assert.equal(b.resolved, "{component}")
  assert.equal(a.rendered, NO_DATA)
  assert.equal(b.rendered, NO_DATA)
  // …and that is the whole defect: two DIFFERENT instances, one indistinguishable placeholder.
  assert.equal(a.rendered, b.rendered)
})

test("CÓ components: một widget soạn một lần phục vụ hai instance, mỗi cái ra tag CỦA RIÊNG NÓ", () => {
  const source = createMachineDetailSource(IOT_SNAPSHOT)
  const a = renderValueOf(widgetById("probe-a"), DECLARED_COMPONENTS, source)
  const b = renderValueOf(widgetById("probe-b"), DECLARED_COMPONENTS, source)

  assert.equal(a.resolved, "telemetry/temperature")
  assert.equal(b.resolved, "telemetry/humidity")
  assert.equal(a.rendered, "23.97")
  assert.equal(b.rendered, "62.65")
  // The assertion a implementation that ignored `widget.component` cannot pass.
  assert.notEqual(a.rendered, b.rendered)
})

test("§5-bis: components VẮNG MẶT và components RỖNG là CÙNG một trạng thái hợp lệ — không ném, không khác nhau", () => {
  const source = createMachineDetailSource(IOT_SNAPSHOT)
  for (const components of [undefined, []]) {
    const label = components === undefined ? "undefined" : "[]"
    // Not a throw, not a crash — a value.
    const a = renderValueOf(widgetById("probe-a"), components, source)
    assert.equal(a.rendered, NO_DATA, `components=${label}: phải hạ cấp thành chỗ giữ, không ném`)
    // A DIRECT binding on the same screen is untouched by any of this — that is the other half of
    // §5-bis: a machine that declared nothing still renders a working screen.
    const direct = renderValueOf(widgetById("direct-cycles"), components, source)
    assert.equal(direct.resolved, "cycles")
    assert.equal(direct.rendered, "41", `components=${label}: binding trực tiếp phải vẫn chạy`)
    // And the degrade is VISIBLE, naming the offending binding key — not a silent "—".
    const warning = unresolvedComponentBindingWarning(widgetById("probe-a"), componentTagPrefixOf(components, "probe-temp"))
    assert.match(String(warning), /\[value\]/)
    assert.equal(
      unresolvedComponentBindingWarning(widgetById("direct-cycles"), undefined),
      undefined,
      `components=${label}: một widget KHÔNG dùng {component} không được sinh cảnh báo`
    )
  }
})

test("một component id lạ hạ cấp giống hệt components vắng mặt — không có đường đi thứ hai", () => {
  const source = createMachineDetailSource(IOT_SNAPSHOT)
  const stale = { ...widgetById("probe-a"), component: "probe-that-was-deleted" }
  assert.equal(renderValueOf(stale, DECLARED_COMPONENTS, source).rendered, NO_DATA)
})

// ─────────────────────────────────────────────────────────────────────────
// The demo document itself
// ─────────────────────────────────────────────────────────────────────────

test("screens/demo/component-demo.json: hợp lệ theo contracts/hmi-screen.schema.json", () => {
  // `screens.test.mjs`'s census covers the three top-level `*-overview.json` documents and deliberately
  // does not see this one (it lives in `screens/demo/`, a subdirectory, precisely so that census stays
  // exactly as sharp as it was). Its schema validation therefore has to happen here instead — a
  // document nothing validates is a document that can drift out of the contract silently.
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))
  const errs = validate(schema, schema, demoScreen)
  assert.deepEqual(errs, [], `đáng lẽ hợp lệ nhưng validate.mjs báo lỗi:\n${errs.join("\n")}`)
})

test("hai widget {component} được soạn MỘT LẦN — chỉ khác id/rect/component, không khác gì nữa", () => {
  // This is what makes `35-hmi-indirect-binding.spec.ts`'s "two different values" assertion mean
  // anything: if the two widgets differed in `props` or `bindings`, a difference on screen could come
  // from the AUTHORING rather than from the component model, and the test would prove nothing.
  const indirect = demoScreen.widgets.filter((w) => JSON.stringify(w.bindings ?? {}).includes("{component}"))
  assert.equal(indirect.length, 2, "màn demo phải có ĐÚNG hai widget dùng {component}")
  const [a, b] = indirect
  assert.equal(a.kind, b.kind)
  assert.deepEqual(a.bindings, b.bindings)
  assert.deepEqual(a.props, b.props)
  assert.notEqual(a.component, b.component)
  assert.ok(a.component && b.component, "cả hai widget phải khai `component`")
})

test("màn demo cũng mang một binding TRỰC TIẾP — §5-bis cần một chứng cứ đối chứng trên cùng tài liệu", () => {
  const direct = demoScreen.widgets.filter((w) => {
    const values = Object.values(w.bindings ?? {})
    return values.length > 0 && values.every((v) => !String(v).includes("{component}"))
  })
  assert.ok(direct.length >= 1, "màn demo phải có ít nhất một widget binding trực tiếp")
})

// ─────────────────────────────────────────────────────────────────────────
// SOURCE TEXT — the prop is actually passed, and the shape is declared once
// ─────────────────────────────────────────────────────────────────────────

test("widget CHỈ nhận resolve — không nhận cả mô hình linh kiện (ruling: một affordance sai còn tệ hơn một prop thừa)", () => {
  // 🔴 Bài này ĐẢO CHIỀU so với bản round 1, theo ruling của controller. Round 1 ghim rằng
  // `RenderedWidget` TRUYỀN `components={components}` xuống widget; không widget nào đọc nó. Một prop
  // không ai đọc ở đây không chỉ là thừa — nó là một AFFORDANCE SAI: `resolve` tồn tại chính là để
  // widget không bao giờ cầm mô hình và không bao giờ tự tra id→tagPrefix, nên đưa mô hình thô cho mọi
  // widget là mời tác giả widget kế tiếp đi vòng qua cái seam ấy — một đường vòng sẽ qua được cả
  // type-check lẫn review, và để lại HAI hiện thực cho MỘT luật. Widget nào thật sự cần mô hình như DỮ
  // LIỆU thì thêm prop CÙNG người đọc nó trong cùng một commit. Bài này là thứ khiến việc lặng lẽ thêm
  // lại prop ấy không thể xảy ra.
  const renderer = readSource("src", "hmi-runtime", "ScreenRenderer.tsx")
  // Lọc theo `widget={widget}` chứ không lấy khớp <Widget…/> ĐẦU TIÊN: file này có một doc-comment
  // nhắc tới `<Widget .../>` bằng văn xuôi (giải thích vì sao error boundary phải là class component),
  // và khớp đầu tiên chính là đoạn văn xuôi ấy — đo được, không phải phòng xa.
  const widgetElements = [...renderer.matchAll(/<Widget\b[^>]*\/>/g)]
    .map((m) => m[0])
    .filter((el) => el.includes("widget={widget}"))
  assert.equal(widgetElements.length, 1, "kỳ vọng đúng MỘT phần tử <Widget widget={widget} …/> trong ScreenRenderer.tsx")
  const widgetElement = widgetElements[0]
  assert.match(widgetElement, /\bresolve=\{resolve\}/, "widget phải nhận resolve — đó là seam duy nhất")
  assert.doesNotMatch(
    widgetElement,
    /\bcomponents=/,
    "ScreenRenderer đang truyền components xuống widget — xem widgetRegistry.ts's resolve doc comment: nếu có widget thật sự cần, prop phải về CÙNG người đọc nó"
  )
})

test("WidgetProps KHÔNG khai components chừng nào chưa widget nào đọc nó", () => {
  // Phía kia của cùng một luật, tách thành bài RIÊNG có chủ ý: hai chỗ có thể hỏng độc lập (ai đó khai
  // lại kiểu mà không truyền, hoặc truyền mà không khai — cái sau tsc bắt được, cái trước thì không),
  // và một bài gộp chỉ báo được cái hỏng ĐẦU TIÊN. Cả hai đều được kiểm chứng bằng cách phá thật: thêm
  // lại prop làm ĐÚNG bài tương ứng đỏ, không bài nào khác.
  const registry = readSource("src", "hmi-runtime", "widgetRegistry.ts")
  assert.doesNotMatch(
    registry,
    /^\s*components\??:/m,
    "WidgetProps khai một prop components — chỉ hợp lệ khi có widget thực sự ĐỌC nó, và khi đó bài này phải được sửa cùng lúc với người đọc ấy"
  )
})

test("Hmi.tsx TRUYỀN components vào <ScreenRenderer> — đúng dòng đã bỏ trống từ đầu", () => {
  const src = readSource("src", "routes", "Hmi.tsx")
  assert.match(
    src,
    /<ScreenRenderer\b[\s\S]{0,400}?\bcomponents=\{/,
    "Hmi.tsx render <ScreenRenderer> mà không truyền components — đây CHÍNH LÀ khuyết tật Task 5 đóng"
  )
  assert.match(src, /useMachineComponents\(/, "Hmi.tsx không còn lấy cây linh kiện qua useMachineComponents()")
})

test("MỘT kiểu duy nhất cho components — readonly ComponentNode[], không phải ComponentModelDocument thứ hai", () => {
  // Owner ruling, WS-HMI-2 Task 5: `ScreenRenderer.tsx`'s own field is the authority and its comment
  // explains why the narrow shape was chosen deliberately. A second declaration of the same thing under
  // a different type is a defect here, not a preference — this test is what makes that enforceable
  // instead of advisory.
  // 🔴 Round 2 (controller ruling): `widgetRegistry.ts` dropped out of this loop because it no longer
  // declares a `components` prop AT ALL — the test directly above is what guards that absence, and this
  // one keeps guarding the SHAPE wherever the prop does legitimately live. The rule itself is unchanged
  // and NOT weakened: every surviving declaration must still read exactly `readonly ComponentNode[]`.
  for (const file of [["src", "hmi-runtime", "ScreenRenderer.tsx"]]) {
    const src = readSource(...file)
    const declarations = [...src.matchAll(/^\s*components\??:\s*(.+)$/gm)].map((m) => m[1].trim())
    // At least one, and EVERY one spelled the same way. Not "exactly one": `ScreenRenderer.tsx`
    // legitimately declares it twice — once on `ScreenRendererProps` and once on `RenderedWidget`'s own
    // inline parameter type, which is the value being forwarded, not a second concept. What must never
    // appear is a DIFFERENT type for the same thing (`ComponentModelDocument`, an inlined object, a
    // widened `unknown[]`), and that is what this measures.
    assert.ok(declarations.length >= 1, `${file.join("/")}: không tìm thấy khai báo prop components nào`)
    for (const declared of declarations) {
      assert.equal(
        declared,
        "readonly ComponentNode[]",
        `${file.join("/")}: prop components phải là readonly ComponentNode[] — xem ScreenRenderer.tsx:20`
      )
    }
  }
})
