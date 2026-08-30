// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// Bài này ghim HAI CHIỀU giữa `widgetRegistry` (`web/src/hmi-runtime/widgetRegistry.ts`) và `WidgetKind`
// (`web/src/contracts/hmiScreen.ts`, đóng băng từ Mốc 0): mọi giá trị của union có một mục trong
// registry (thiếu ⇒ một tài liệu HỢP LỆ theo schema làm runtime nổ ở `widgetRegistry[kind]` —
// `ScreenRenderer`, Task 3, tra thẳng bảng này, không có fallback), và mọi mục trong registry là một
// giá trị của union (thừa ⇒ runtime nhận một `kind` mà schema đã TỪ CHỐI từ lâu — đúng lớp drift
// `contracts.test.mjs` tồn tại để chặn ở phía schema/type, áp dụng sang phía runtime-widget).
//
// 🔴 Bài này KHÔNG `import()` `widgetRegistry.ts` như một ES module. Lý do đo được, không suy diễn:
//
//   $ node --experimental-strip-types -e "import(new URL('file:///.../probe.tsx'))..."
//   ERR Unknown file extension ".tsx" for .../probe.tsx
//
// Nhiều widget dưới `web/src/hmi-runtime/widgets/*.tsx` bọc primitive `.tsx` của
// `web/src/components/industrial/` (spec §Task 2 đòi WRAP chúng, không vẽ lại) — và loader `.ts` gốc
// của Node CHỈ xoá cú pháp KIỂU, không BIẾN ĐỔI cú pháp JSX thành `React.createElement`, nên nó từ chối
// mọi `.tsx`, bất kể cờ `--experimental-strip-types`/`--experimental-transform-types` nào. Vì
// `widgetRegistry.ts` import cả 15 widget đó, `import()` chính nó cũng rơi vào đúng lỗi trên. Bài này vì
// vậy dùng ĐÚNG kỹ thuật `web/contract-tests/contracts.test.mjs`'s `tsUnionMembers`/`tsProps` đã dùng
// cho đúng lý do đó (đọc theo hướng dẫn của task brief, không chép hàm của nó — hai bài không dùng
// chung file, và `contract-tests/` là cổng của Mốc 0, không được đụng): đọc SOURCE TEXT bằng
// `readFileSync` rồi bóc bằng regex, không thực thi file.
//
// `widgets/shared.ts` thì NGƯỢC LẠI — nó cố ý KHÔNG có JSX (xem header file đó) đúng để bài `policyGate`
// bên dưới có thể `import` THẬT và THỰC THI, không chỉ đọc văn bản.
//
// 🔴 Bài này KHÔNG đo: (1) một widget `.tsx` thật có RENDER được không, có đúng axe AA không, có đúng
// visual baseline không — ba việc đó cần một trình duyệt/Playwright thật, Node trần không làm được vì lý
// do JSX nêu trên (Task 4/5 của kế hoạch là nơi Playwright thật sự chạy qua các widget này); (2)
// `ScreenRenderer`/`bindings.ts` (Task 3) — chưa được viết, `resolve()` ở đây chỉ là một CHỮ KÝ hàm;
// (3) PolicyEngine/role/HALT thật ở server (`.claude/skills/st4i-machine-edition/SKILL.md` §3) —
// `policyGate` chỉ là điều kiện PHÍA WEB đủ để không hiện một điều khiển bật khi tài liệu thiếu
// `policyAction`, không phải bản sao hay thay thế cho gác cổng phía server; (4) rằng DOM THẬT phản ánh
// đúng những gì `policyGate` trả về. Bài dưới đo được BA việc, không chỉ hai như trước fix round 1: (a)
// bản thân `policyGate` đúng (thực thi hàm thật); (b) `command-button.tsx`/`setpoint-input.tsx` CÓ GỌI
// nó; và (c) cả hai file đó THAM CHIẾU cả `gate.disabled` LẪN `gate.reason` trong văn bản nguồn — bắt
// được cả lớp regression "gọi rồi vứt kết quả" (gọi `policyGate()` nhưng không dùng gì từ nó) LẪN lớp
// "chỉ dùng disabled mà bỏ lý do" (thread `gate.disabled` vào nhưng không bao giờ hiện `gate.reason`).
// Cái vẫn KHÔNG đo được, và chỉ còn đúng phần này: liệu thuộc tính `disabled` THẬT trên phần tử DOM có
// thực sự được set, đoạn văn lý do THẬT có thực sự hiện ra trên trang, `aria-describedby` THẬT có trỏ
// đúng chỗ — đó là một khẳng định RENDER (cần cây DOM thật), `node --test` không tạo ra được; nó thuộc
// Playwright của Task 4/5 (kế hoạch), không phải một khoảng trống bị bỏ qua ở đây.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { policyGate } from "../src/hmi-runtime/widgets/shared.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, "..", "src")

// 🔴 CRLF: cùng lý do `contracts.test.mjs`'s `tsSource` đã đo — `core.autocrlf=true` trên kho này,
// checkout MỚI (không phải máy vừa ghi file bằng LF) nhận `\r\n`, và mọi regex bóc tách bên dưới
// hard-code `\n`. Chuẩn hoá MỘT LẦN ở đây, như file kia đã làm.
const readNormalized = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n")

/** Trích `WidgetKind` từ CHÍNH hợp đồng đóng băng — KHÔNG chép tay 15 chuỗi vào bài test (task brief:
 * "một danh sách chép tay là bản sao thứ hai để lệch"). */
function readWidgetKindMembers() {
  const src = readNormalized(join(SRC, "contracts", "hmiScreen.ts"))
  const m = /export type WidgetKind =((?:.|\n)*?)(?=\n(?!\s*\|)|$)/.exec(src)
  assert.ok(m, 'không tìm thấy "export type WidgetKind =" trong contracts/hmiScreen.ts')
  const members = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
  assert.ok(members.length > 0, "trích được 0 thành viên WidgetKind — regex bóc tách đã hỏng, bài dưới không đo được gì cả")
  return members
}

/** Trích tập khoá đã đăng ký trong `widgetRegistry.ts` — ĐỌC VĂN BẢN, không `import()` (xem header).
 *
 * 🔴 Regex `/^\s*"([^"]+)":/gm` khớp ĐÚNG một khoá CÓ NGOẶC KÉP — không phải vì mọi kind đều chứa dấu
 * gạch nối (SAI: bảy trong mười lăm — `readout`, `gauge`, `trend`, `log`, `faceplate`, `label`,
 * `sheet` — là định danh TypeScript hợp lệ KHÔNG cần ngoặc kép). Đây là một RÀNG BUỘC bài test đặt ra
 * cho `widgetRegistry.ts`, không phải một tính chất tự nhiên của chuỗi: nếu một trong bảy khoá đó bị bỏ
 * ngoặc kép (một lần "dọn code TS" bình thường, `tsc`/`oxlint` không bắt), khoá đó biến mất KHỎI tập
 * trích xuất — bài ghim hai chiều bên dưới sẽ báo nó "thiếu trong registry", một cảnh báo TO nhưng SAI
 * LÝ DO (registry vẫn đúng, chỉ là quy trình đọc văn bản không thấy dòng đó nữa). `widgetRegistry.ts`'s
 * own header nêu đúng ràng buộc này ở phía nó. */
function readRegisteredKinds() {
  const src = readNormalized(join(SRC, "hmi-runtime", "widgetRegistry.ts"))
  const m = /export const widgetRegistry:[^\n]*=\s*\{([\s\S]*?)\n\}/.exec(src)
  assert.ok(m, 'không tìm thấy "export const widgetRegistry: ... = {" trong widgetRegistry.ts')
  return [...m[1].matchAll(/^\s*"([^"]+)":/gm)].map((x) => x[1])
}

// ── Bài ghim chính: hai chiều, và đỏ khi rỗng (registryKinds.length === 0 ⇒ missingFromRegistry ===
// TOÀN BỘ 15 thành viên WidgetKind, assert.deepEqual với [] thất bại ngay) ─────────────────────────
test("widgetRegistry ⟷ WidgetKind: mọi giá trị enum có một mục registry, không thừa mục nào", () => {
  const widgetKindMembers = readWidgetKindMembers()
  const registeredKinds = readRegisteredKinds()

  const missingFromRegistry = widgetKindMembers.filter((k) => !registeredKinds.includes(k)).sort()
  const extraInRegistry = registeredKinds.filter((k) => !widgetKindMembers.includes(k)).sort()

  assert.deepEqual(
    missingFromRegistry,
    [],
    `WidgetKind cho phép nhưng registry KHÔNG có mục: ${missingFromRegistry.join(", ")} — một tài liệu hợp lệ dùng kind này làm runtime nổ ở widgetRegistry[kind]`
  )
  assert.deepEqual(
    extraInRegistry,
    [],
    `registry có mục nhưng WidgetKind KHÔNG cho phép: ${extraInRegistry.join(", ")} — runtime chấp nhận một kind mà schema đã từ chối, hai bên lệch nhau`
  )
})

// Khẳng định KHÔNG RỖNG / KHÔNG CŨ (SKILL.md §2, thành phần thứ 3 của một bài ghim hai chiều đúng
// khuôn): một registry RỖNG có 0 mục "thừa" và phép so trên VẪN bắt được nó qua "thiếu", nhưng bài này
// khẳng định trực tiếp con số — nếu quy ước "15 kind" của Mốc 0 từng đổi mà không ai cập nhật bài trên,
// một lỗi ở CHÍNH quy trình bóc tách (không phải ở registry) có thể vẫn cho ra hai tập bằng nhau nhưng
// đều rỗng và bài trên vẫn xanh một cách vô nghĩa. Con số cụ thể ở đây chặn đúng lỗ đó.
test("WidgetKind hôm nay có đúng 15 giá trị, registry đăng ký đúng chừng đó, và không khoá trùng lặp", () => {
  const widgetKindMembers = readWidgetKindMembers()
  const registeredKinds = readRegisteredKinds()
  assert.equal(
    widgetKindMembers.length,
    15,
    `WidgetKind có ${widgetKindMembers.length} giá trị, kỳ vọng 15 — nếu Mốc 0 đã đổi enum, cập nhật số này VÀ registry`
  )
  assert.equal(registeredKinds.length, 15)
  assert.equal(
    new Set(registeredKinds).size,
    registeredKinds.length,
    "registry có khoá TRÙNG LẶP — một object literal JS âm thầm giữ giá trị SAU CÙNG của một khoá trùng, che mất một widget mà bài so-hai-chiều ở trên không thấy được (Set khử trùng trước khi so)"
  )
})

// ── 🔴 Bất biến §5: setpoint-input/command-button không có policyAction ⇒ vô hiệu hoá + lý do ───────
// `policyGate` (widgets/shared.ts) là hàm THẬT hai widget đó gọi, không phải một mô tả lại nó — ba bài
// dưới đây THỰC THI hàm thật, không đọc văn bản nguồn.
test("policyGate: policyAction vắng mặt ⇒ disabled=true kèm một lý do có nội dung, nhìn thấy được", () => {
  const gate = policyGate({ kind: "command-button" })
  assert.equal(gate.disabled, true)
  assert.equal(typeof gate.reason, "string")
  assert.ok(gate.reason.length > 0, 'lý do phải là chuỗi CÓ NỘI DUNG — một lý do rỗng ("") không phải "nhìn thấy được"')
})

test('policyGate: policyAction có mặt ("machine.setpoint") ⇒ disabled=false, không lý do', () => {
  const gate = policyGate({ kind: "setpoint-input", policyAction: "machine.setpoint" })
  assert.equal(gate.disabled, false)
  assert.equal(gate.reason, undefined)
})

test('policyGate: policyAction có mặt ("machine.command") ⇒ disabled=false, không lý do (đối chứng action còn lại)', () => {
  const gate = policyGate({ kind: "command-button", policyAction: "machine.command" })
  assert.equal(gate.disabled, false)
  assert.equal(gate.reason, undefined)
})

// 🔴 Fix round 1, Important finding 2. Bài CŨ chỉ đo "có gọi policyGate(" — không đo GÌ về việc kết quả
// gọi đó có được DÙNG hay không. Hai regression thực tế lọt qua bài cũ hoàn toàn: (a) gọi
// `policyGate(widget)` rồi VỨT kết quả (không gán vào đâu, hoặc gán rồi không đọc trường nào); (b) chỉ
// thread `gate.disabled` vào điều khiển nhưng ÂM THẦM BỎ `gate.reason` (điều khiển vô hiệu hoá đúng,
// nhưng không còn "kèm lý do nhìn thấy được" — đúng bất biến §5 mà brief đòi ghim). Bài dưới đóng cả hai
// khoảng trống bằng cách khẳng định văn bản nguồn tham chiếu ĐÚNG hai tên trường thật sự được dùng trong
// mã hôm nay (`gate.disabled`, `gate.reason` — biến được đặt tên `gate` ở cả hai file, đọc lại chính mã
// nguồn trước khi viết bài này, không giả định tên biến).
//
// Vẫn KHÔNG đo (xem header điểm KHÔNG đo (4)): rằng DOM RENDER RA đúng những gì hai dòng này ám chỉ —
// đó cần Playwright thật.
test("command-button.tsx và setpoint-input.tsx GỌI policyGate VÀ DÙNG cả disabled lẫn reason nó trả về — không gọi-rồi-vứt, không bỏ lý do", () => {
  for (const file of ["command-button.tsx", "setpoint-input.tsx"]) {
    const src = readNormalized(join(SRC, "hmi-runtime", "widgets", file))
    assert.ok(
      src.includes("policyGate("),
      `${file} không gọi policyGate(...) — bài đo policyGate ở trên không còn chứng minh gì về widget thật nếu widget không dùng nó`
    )
    assert.ok(
      src.includes("gate.disabled"),
      `${file} gọi policyGate nhưng không thấy "gate.disabled" ở đâu trong văn bản nguồn — một regression gọi-rồi-vứt-kết-quả (policyGate() được gọi nhưng kết quả không đi đâu cả) sẽ lọt qua bài "có gọi" một mình nhưng bị bài này bắt`
    )
    assert.ok(
      src.includes("gate.reason"),
      `${file} có dùng gate.disabled nhưng không thấy "gate.reason" trong văn bản nguồn — một regression chỉ vô hiệu hoá điều khiển mà KHÔNG hiện lý do (vi phạm đúng bất biến §5: "vô hiệu hoá KÈM lý do nhìn thấy được") sẽ lọt qua nếu thiếu assert này`
    )
  }
})
