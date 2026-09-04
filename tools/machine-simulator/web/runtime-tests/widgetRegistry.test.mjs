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

/** Trích `PolicyAction` từ CHÍNH hợp đồng đóng băng (`contracts/tagNamespace.ts`) — cùng kỹ thuật, cùng
 * lý do như `readWidgetKindMembers` ngay trên: một danh sách chép tay là bản sao thứ hai để lệch.
 * `contracts.test.mjs` đã ghim union này hai chiều với CẢ BA schema (`hmi-screen`, `component-model`,
 * `tag-namespace`), nên đây đúng là từ vựng đóng mà schema định nghĩa, đọc qua kiểu chứ không gõ lại. */
function readPolicyActionMembers() {
  const src = readNormalized(join(SRC, "contracts", "tagNamespace.ts"))
  const m = /export type PolicyAction =([^\n]*)/.exec(src)
  assert.ok(m, 'không tìm thấy "export type PolicyAction =" trong contracts/tagNamespace.ts')
  const members = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1])
  assert.ok(members.length > 0, "trích được 0 thành viên PolicyAction — regex bóc tách đã hỏng, mọi vòng lặp dưới chạy 0 lần và bài sẽ xanh mà không đo gì cả")
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

// ── 🔴 WS-HMI-2 Task 6, ruling của controller: policyGate là phép kiểm THÀNH VIÊN, không phải phép
// kiểm TRUTHINESS ─────────────────────────────────────────────────────────────────────────────────
// Ba bài policyGate ở trên hỏi đúng BA câu — vắng mặt, "machine.setpoint", "machine.command". Chiều
// "một action LẠ" chưa từng được hỏi, và đó chính là lý do một phép kiểm truthiness sống sót qua mọi
// vòng review: ĐO ĐƯỢC, không suy diễn, `policyAction: "xyzzy"` render CẢ HAI điều khiển ở trạng thái
// BẬT, không kèm lý do nào (task-6-report.md §4, có cả quan sát trong trình duyệt thật).
//
// Phép kiểm thành viên KHÔNG bịa ra hợp đồng mới: cả ba schema đóng băng đều ràng buộc trường này vào
// đúng hai giá trị, và `contracts/tagNamespace.ts` phản chiếu chúng thành `PolicyAction`. Nó chỉ thi
// hành hợp đồng vốn đã có, ở đúng chỗ `ScreenRenderer` đã thi hành luật tương đương cho `kind` lạ.

test("policyGate: từ vựng RUNTIME khớp union PolicyAction của hợp đồng — MỌI thành viên đều BẬT, và tập trích ra không rỗng", () => {
  const members = readPolicyActionMembers()
  // Sàn (SKILL.md §2): `readPolicyActionMembers` đã chặn tập RỖNG; con số cụ thể ở đây chặn thêm lỗ
  // "union bị thu hẹp còn một thành viên mà không ai để ý" — vòng lặp dưới khi ấy vẫn xanh.
  assert.equal(
    members.length,
    2,
    `PolicyAction có ${members.length} giá trị, kỳ vọng 2 — nếu hợp đồng đổi, cập nhật CẢ POLICY_ACTIONS trong widgets/shared.ts (Record<PolicyAction, true> ở đó sẽ đỏ ngay ở tsc, bài này là lớp thứ hai)`
  )
  for (const action of members) {
    const gate = policyGate({ kind: "command-button", policyAction: action })
    assert.equal(
      gate.disabled,
      false,
      `"${action}" là thành viên HỢP LỆ của PolicyAction nhưng policyGate vẫn khoá — phép kiểm thành viên đang từ chối chính từ vựng của hợp đồng`
    )
    assert.equal(gate.reason, undefined)
  }
})

test('policyGate: một action KHÔNG thuộc từ vựng ("xyzzy") ⇒ disabled=true, và lý do NÊU ĐÍCH DANH giá trị sai', () => {
  const gate = policyGate({ kind: "command-button", policyAction: "xyzzy" })
  assert.equal(
    gate.disabled,
    true,
    'policyAction "xyzzy" mở khoá điều khiển — đây CHÍNH LÀ hành vi ruling Task 6 sửa; một action PolicyEngine chưa từng nghe tới không bao giờ có thể được cấp'
  )
  assert.match(String(gate.reason), /xyzzy/, "lý do phải nêu chính giá trị sai — không nêu thì tác giả không biết mình đã gõ gì")
  assert.match(String(gate.reason), /machine\.setpoint/, "lý do phải nêu cả từ vựng được chấp nhận")
  assert.match(String(gate.reason), /machine\.command/)
  // 🔴 task-6-review.md LOW-2 — câu này TỪNG kết thúc bằng "an action the PolicyEngine has never heard
  // of could never be granted", và đó là một khẳng định SAI: từ vựng của PolicyEngine là
  // `machine.setpoint.write` / `machine.command.invoke` (`Policy/MachineWriteGate.cs:38,43`), còn của
  // hợp đồng màn hình là `machine.setpoint` / `machine.command` — HAI TẬP RỜI NHAU, không có lớp ánh xạ
  // nào trong cây. Tầng web không nhìn thấy từ vựng của engine, nên không được khẳng định gì về nó. Bài
  // này giữ cho lời sửa ấy không lặng lẽ quay lại: thông điệp chỉ được nói về từ vựng của HỢP ĐỒNG.
  assert.doesNotMatch(
    String(gate.reason),
    /PolicyEngine/,
    'lý do cho một action LẠ đang khẳng định điều gì đó về PolicyEngine — tầng web không thấy từ vựng của engine (machine.setpoint.write / machine.command.invoke), và hai tập từ vựng hôm nay RỜI NHAU; chỉ được nói về từ vựng của hợp đồng màn hình'
  )
})

test('policyGate: action RỖNG ("") và chỉ-khoảng-trắng ("  ", "\\t") ⇒ disabled=true — "có ghi gì đó" không phải là được cấp quyền', () => {
  for (const raw of ["", "  ", "\t"]) {
    const gate = policyGate({ kind: "setpoint-input", policyAction: raw })
    assert.equal(gate.disabled, true, `policyAction ${JSON.stringify(raw)} không được mở khoá điều khiển`)
    assert.ok(String(gate.reason).length > 0, `policyAction ${JSON.stringify(raw)} bị khoá nhưng KHÔNG kèm lý do nhìn thấy được`)
  }
})

test('policyGate: sai HOA/thường ("MACHINE.COMMAND") ⇒ disabled=true — enum của hợp đồng là chữ thường, không có "gần đúng là được"', () => {
  const gate = policyGate({ kind: "command-button", policyAction: "MACHINE.COMMAND" })
  assert.equal(gate.disabled, true, 'một phép so KHÔNG phân biệt hoa thường sẽ cho qua giá trị này — schema thì không')
  assert.match(String(gate.reason), /MACHINE\.COMMAND/)
})

test("policyGate: một giá trị KHÔNG PHẢI CHUỖI cũng bị khoá — JSON không đảm bảo kiểu của trường này", () => {
  for (const raw of [1, 0, true, null, {}, []]) {
    const gate = policyGate({ kind: "command-button", policyAction: raw })
    assert.equal(gate.disabled, true, `policyAction ${JSON.stringify(raw)} phải bị khoá`)
    assert.ok(String(gate.reason).length > 0)
  }
})

test("policyGate: lý do cho action LẠ KHÁC HẲN lý do cho action VẮNG MẶT — hai lỗi khác nhau cần hai bước sửa khác nhau", () => {
  const absent = policyGate({ kind: "command-button" })
  const unknown = policyGate({ kind: "command-button", policyAction: "xyzzy" })
  assert.equal(absent.disabled, true)
  assert.equal(unknown.disabled, true)
  assert.notEqual(
    absent.reason,
    unknown.reason,
    "hai trạng thái hỏng khác nhau đang nói cùng một câu — tác giả viết SAI một action sẽ đi tìm một trường vốn đang nằm ngay đó"
  )
  assert.match(String(absent.reason), /has no policyAction/)
  assert.doesNotMatch(String(unknown.reason), /has no policyAction/)
})

// ── 🔴 WS-HMI-2 Task 6 fix round 1 (task-6-review.md LOW-4): NỬA "KHAI BÁO" CỦA PHÉP GHIM PHỦ KIND ─
// Hai bài dưới đây SỐNG Ở ĐÂY chứ không phải trong `tests/36-hmi-all-widget-kinds.spec.ts`, nơi chúng
// ra đời. Cả hai KHÔNG cần `page` fixture nào — chúng chỉ đọc văn bản nguồn và một tệp JSON — nhưng ở
// đó chúng chỉ chạy dưới `npx playwright test`, mất 10–13 phút tuỳ máy. Kịch bản cụ thể: một tác giả
// thêm kind thứ mười sáu vào registry, chạy `npm run test:runtime` (0.2 giây, xanh), `tsc`, `oxlint`,
// `check-contracts` — xanh hết — rồi mới biết mình quên đặt instance lên màn demo sau 13 phút, hoặc ở
// CI. Bài THẬT SỰ cần trình duyệt (widget có VẼ ra gì không, có tụt xuống chỗ giữ lỗi không) ở lại
// spec 36; hai bài này chuyển về đây, vào đúng tệp vốn đã đọc `widgetRegistry.ts` bằng đúng regex đó.
//
// Không thêm tệp *.test.mjs mới — thêm vào tệp CÓ SẴN, nên `package.json`'s `test:runtime` (danh sách
// tên tệp tường minh, cố ý) và bài `testRuntimeScript.test.mjs` ghim nó đều không phải đổi.

// web/runtime-tests → web/screens/demo/component-demo.json
const DEMO_SCREEN_PATH = join(HERE, "..", "screens", "demo", "component-demo.json")

/** Phép trích THỨ HAI, độc lập với `readRegisteredKinds` ở trên: mỗi mục registry có đúng một dòng
 * `import { XWidget } from "./widgets/<tên>"`. Khác anchor, khác dòng, khác token — nên một khiếm
 * khuyết ở riêng phép trích khoá không thể làm hai con số/hai tập cùng dịch chuyển. */
function readWidgetModuleImports() {
  const src = readNormalized(join(SRC, "hmi-runtime", "widgetRegistry.ts"))
  return [...src.matchAll(/^import \{[^}]*\} from "\.\/widgets\/([^"]+)"$/gm)].map((x) => x[1])
}

test('floor: hai phép trích độc lập trên widgetRegistry.ts ra CÙNG MỘT TẬP tên kind, và không phép nào ra tập RỖNG', () => {
  const kinds = readRegisteredKinds()
  const imports = readWidgetModuleImports()

  // Sàn trước, so sánh sau — hai tập RỖNG "bằng nhau" là đúng khuyết tật chữ ký của kho này.
  assert.ok(
    kinds.length > 0,
    "trích được 0 khoá kind có ngoặc kép từ widgetRegistry.ts — phép trích đã hỏng, và bài KHAI BÁO ngay dưới sẽ lặp 0 lần rồi xanh mà không đo gì cả"
  )
  assert.ok(
    imports.length > 0,
    "trích được 0 dòng import ./widgets/… từ widgetRegistry.ts — phép đối chứng của sàn này tự nó đã hỏng"
  )

  // 🔴 task-6-review.md LOW-3 — so TẬP, không so SỐ LƯỢNG. Mọi khiếm khuyết MỘT PHÍA mà reviewer dựng
  // (tám đột biến) đều đỏ với phép so số lượng, nhưng một CẶP BÙ TRỪ thì không: một khoá rơi khỏi phép
  // trích ĐỒNG THỜI một dòng import thừa xuất hiện chỗ khác — hai con số vẫn là 15, tập kind thì sai
  // một phần tử. Phép so tập dưới đây nêu ĐÍCH DANH kind lệch, theo cả hai chiều riêng biệt.
  //
  // Điều kiện phép so này dựa vào: TÊN TỆP module của mỗi widget bằng đúng chuỗi kind của nó
  // (`"gauge": GaugeWidget` import từ `./widgets/gauge`) — đúng cho cả mười lăm mục hôm nay. Đây là
  // cùng loại ràng buộc mà header của chính `widgetRegistry.ts` đã đặt ra vì một bài test (mọi khoá
  // phải giữ ngoặc kép), nêu ra ở đây để một lần đổi tên tệp không trông giống một lỗi bí ẩn.
  const importSet = new Set(imports)
  const keySet = new Set(kinds)
  assert.deepEqual(
    {
      keysWithoutModule: kinds.filter((k) => !importSet.has(k)).sort(),
      modulesWithoutKey: imports.filter((m) => !keySet.has(m)).sort(),
    },
    { keysWithoutModule: [], modulesWithoutKey: [] },
    `hai phép đọc độc lập của widgetRegistry.ts đang gọi tên NHỮNG KIND KHÁC NHAU — hoặc một mục được thêm mà thiếu import (hoặc ngược lại), hoặc một phép trích thôi không còn thấy thứ nó đọc, hoặc một module widget đã bị đổi tên khác chuỗi kind của nó`
  )
})

test('mọi kind trong registry đều được KHAI BÁO ít nhất một lần trên screens/demo/component-demo.json', () => {
  const registeredKinds = readRegisteredKinds()
  assert.ok(registeredKinds.length > 0, 'trích được 0 kind — vòng lặp dưới sẽ chạy 0 lần và bài này xanh vô nghĩa')

  const doc = JSON.parse(readFileSync(DEMO_SCREEN_PATH, "utf8"))
  assert.ok(
    Array.isArray(doc.widgets) && doc.widgets.length > 0,
    "screens/demo/component-demo.json không khai widget nào — không có gì để đối chiếu, và bài này sẽ báo MỌI kind là thiếu vì một lý do sai"
  )

  const declared = new Set(doc.widgets.map((w) => w.kind))
  const undrawn = registeredKinds.filter((kind) => !declared.has(kind)).sort()
  assert.deepEqual(
    undrawn,
    [],
    `đã đăng ký nhưng KHÔNG có mặt trên màn demo nào: ${undrawn.join(", ")} — thêm một instance vào web/screens/demo/component-demo.json; một kind không bao giờ được render là một kind không bao giờ được CHẠY. (Việc nó có VẼ ra gì thật không, và có tụt xuống chỗ giữ lỗi không, là bài tests/36-hmi-all-widget-kinds.spec.ts trong trình duyệt thật.)`
  )
})
