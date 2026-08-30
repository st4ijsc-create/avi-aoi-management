// Chạy: npm run test:runtime   (node --test, không thêm package nào)
//
// Bài này đo `createMachineDetailSource` — adapter ĐẦU TIÊN của seam `TagValueSource`
// (`web/src/hmi-runtime/TagValueSource.ts`), bọc lại `MachineDetail` (gọi là `MachineDetailDto` trong
// kế hoạch WS-HMI-1) mà `web/src/lib/api.ts` đã trả về hôm nay.
//
// 🔴 Bài này KHÔNG đo: (1) một nguồn SỐNG thật — websocket/poll thật sự nối vào engine; adapter duy
// nhất tồn tại hôm nay bọc một snapshot tĩnh và tự mô phỏng "dữ liệu mới" bằng `source.update(dto)`
// do TEST gọi tay, không phải do một transport thật đẩy vào; (2) hợp đồng giá-trị-sống thật mà
// WS-HMI-0c sẽ định nghĩa — hợp đồng đó chưa tồn tại, nên không có gì để so khớp; (3) tích hợp với
// `ScreenRenderer`/`bindings.ts` (Task 2/3 của kế hoạch) — hai file đó chưa được viết; (4) toàn bộ bề
// mặt `MachineDetail` — chỉ các path liệt kê trong bảng "KNOWN PATHS" ở đầu `TagValueSource.ts` được
// đo ở đây (vd `spc`, `boardPoints`, `plan` không có path nào, và không bài nào bên dưới giả định
// chúng có).

import { test } from "node:test"
import assert from "node:assert/strict"
import { createMachineDetailSource } from "../src/hmi-runtime/TagValueSource.ts"

/** Fixture tối thiểu nhưng ĐỦ FIELD của `MachineDetail` (`lib/api.ts`) — mỗi test override đúng phần
 * nó cần, phần còn lại giữ nguyên giá trị "máy đang chạy bình thường, đã có dữ liệu". */
function baseMachine(overrides = {}) {
  return {
    code: "SCRW-01",
    class: "Automation",
    driverKind: "Simulated",
    statusText: "OK",
    passRate: 0.92,
    cycles: 10,
    spc: { values: [1, 2, 3], mean: 2, ucl: 3, lcl: 1 },
    telemetry: [],
    boardPoints: [],
    cycleLog: [],
    // "—" — sentinel CHÍNH THỨC của `MachineDetail.driftState` (doc-comment `lib/api.ts`): "'—' until
    // one has run". Ghi đè khi test cần một driftState đã thật sự chạy.
    driftState: "—",
    plan: null,
    ...overrides,
  }
}

// ── Đề xuất 1: path đã biết trả đúng value VÀ unit ──────────────────────────────────────────────
// `keyMetric` là path derive lại đúng cái hack `derive.ts` đang làm (`parseKeyMetric` parse chuỗi
// "Torque=4.2Nm" engine emit) — đây chính là lý do adapter này tồn tại, theo brief Task 1.
test("path đã biết (keyMetric) trả đúng value và unit, parse lại từ dòng cycleLog mới nhất", () => {
  const dto = baseMachine({
    cycles: 3,
    cycleLog: [
      { time: "2026-08-30T00:00:00Z", serial: "S1", verdict: "OK", keyMetric: "Torque=4.2Nm" },
    ],
  })
  const source = createMachineDetailSource(dto)
  assert.deepEqual(source.get("keyMetric"), { value: 4.2, unit: "Nm", quality: "good" })
})

test("keyMetric dùng ĐÚNG dòng cycleLog MỚI NHẤT (mảng newest-last, theo quy ước derive.ts)", () => {
  const dto = baseMachine({
    cycleLog: [
      { time: "t0", serial: "S1", verdict: "OK", keyMetric: "Torque=3.1Nm" },
      { time: "t1", serial: "S2", verdict: "OK", keyMetric: "Torque=4.2Nm" },
    ],
  })
  const source = createMachineDetailSource(dto)
  assert.deepEqual(source.get("keyMetric"), { value: 4.2, unit: "Nm", quality: "good" })
})

// ── Đề xuất 2: path không biết trả undefined, không ném ─────────────────────────────────────────
test("path không biết trả undefined, không ném", () => {
  const source = createMachineDetailSource(baseMachine())
  assert.doesNotThrow(() => source.get("does/not/exist"))
  assert.equal(source.get("does/not/exist"), undefined)
})

test("path rỗng, hoặc kiểu không phải string, cũng trả undefined chứ không ném", () => {
  const source = createMachineDetailSource(baseMachine())
  assert.doesNotThrow(() => source.get(""))
  assert.equal(source.get(""), undefined)
  // Trang kiosk lắp binding hỏng vẫn phải sống — không giả định caller luôn gửi đúng kiểu.
  assert.doesNotThrow(() => source.get(/** @type {any} */ (42)))
  assert.equal(source.get(/** @type {any} */ (42)), undefined)
})

// ── Đề xuất 3: quality "stale" khi DTO CÓ khái niệm "chưa có dữ liệu mới", không bịa ─────────────
// Hai bằng chứng ĐỘC LẬP, cả hai đều lấy từ quy ước đã có sẵn trong chính codebase này (không phải
// suy diễn của adapter): (a) `driftState` còn nguyên sentinel "—" (doc-comment `lib/api.ts`); (b)
// `cycles === 0` cho các path bắt nguồn từ chu kỳ đã hoàn tất — ĐÚNG quy ước
// `ReadoutGrid.tsx`'s `passRateTone` đã ghi: "cycles === 0 nghĩa là chưa có dữ liệu, không phải kết
// quả tệ". Nếu adapter không có cách nào để biện minh cho "stale", nó phải trả "good" (xem test
// "không bao giờ trả bad" bên dưới, và doc-comment `TagValueSource.ts`) — hai test dưới đây tồn tại
// vì adapter THỰC SỰ đo được, không phải vì nó được yêu cầu bịa ra một sự phân biệt.
test('driftState còn sentinel "—" (chưa sync-config lần nào) ⇒ quality "stale"', () => {
  const source = createMachineDetailSource(baseMachine({ driftState: "—" }))
  assert.deepEqual(source.get("driftState"), { value: "—", quality: "stale" })
})

test("driftState đã có kết quả sync thật ⇒ quality \"good\" (đối chứng, không phải luôn luôn stale)", () => {
  const source = createMachineDetailSource(baseMachine({ driftState: "synced · v3 · applied=true" }))
  assert.deepEqual(source.get("driftState"), { value: "synced · v3 · applied=true", quality: "good" })
})

test('passRate khi cycles=0 (chưa chu kỳ nào được xét) ⇒ quality "stale"', () => {
  const source = createMachineDetailSource(baseMachine({ cycles: 0, passRate: 0 }))
  assert.deepEqual(source.get("passRate"), { value: 0, quality: "stale" })
})

test('passRate khi đã có ít nhất một chu kỳ ⇒ quality "good" (đối chứng)', () => {
  const source = createMachineDetailSource(baseMachine({ cycles: 10, passRate: 0.92 }))
  assert.deepEqual(source.get("passRate"), { value: 0.92, quality: "good" })
})

// Bằng chứng phủ định: adapter không bịa "bad" — DTO hôm nay không có bất kỳ tín hiệu lỗi/hư driver
// nào (không có quality bit, không có timestamp), nên "bad" không bao giờ được adapter này phát ra.
// Đây CHÍNH XÁC là điều brief yêu cầu ghi lại thay vì bịa: một khoảng trống có tài liệu, không phải
// một phép đo giả.
test('adapter KHÔNG BAO GIỜ trả quality "bad" — DTO không mang tín hiệu lỗi/hư nào để đo (xem doc-comment TagValueSource.ts)', () => {
  const dtos = [
    baseMachine(),
    baseMachine({ cycles: 0, passRate: 0, driftState: "—" }),
    baseMachine({ cycleLog: [{ time: "t", serial: "s", verdict: "NG", keyMetric: "12 pts, 1 NG" }] }),
    baseMachine({ telemetry: [{ metric: "temp", values: [21.4, 22.1] }] }),
  ]
  const paths = ["cycles", "passRate", "statusText", "driftState", "keyMetric", "telemetry/temp"]
  for (const dto of dtos) {
    const source = createMachineDetailSource(dto)
    for (const path of paths) {
      const tv = source.get(path)
      if (tv !== undefined) assert.notEqual(tv.quality, "bad", `path "${path}" không được trả quality "bad"`)
    }
  }
})

// Path không parse được thành number+unit (hình dạng tóm tắt AOI "N pts, M NG", không khớp lưới
// "name=value+unit") vẫn phải trả một giá trị TRUNG THỰC (chuỗi thô), quality "good" — KHÔNG phải
// "bad": đây là một hình dạng dữ liệu hợp lệ khác của cùng field, không phải một lỗi.
test("keyMetric không khớp lưới name=value+unit (hình AOI) vẫn trả chuỗi thô, quality \"good\", không unit", () => {
  const dto = baseMachine({ cycleLog: [{ time: "t", serial: "s", verdict: "NG", keyMetric: "12 pts, 1 NG" }] })
  const source = createMachineDetailSource(dto)
  assert.deepEqual(source.get("keyMetric"), { value: "12 pts, 1 NG", quality: "good" })
})

// ── WS-HMI-1 Task 5: path "code" — không phải tag, nhưng faceplate cần nó ───────────────────────
// Xem doc-comment "WS-HMI-1 Task 5" ở đầu `TagValueSource.ts`: `widgets/faceplate.tsx` cần biết máy
// nào để tự gọi `useMachine(code)` lấy `plan` (CyclePlan) — thứ `TagValue.value` (number|boolean|
// string) không mang được. "good" luôn — `code` không có khái niệm "cũ"/"mới" như `passRate`/
// `driftState`.
test('path "code" trả đúng MachineDetail.code, quality luôn "good"', () => {
  const source = createMachineDetailSource(baseMachine({ code: "AOI-01" }))
  assert.deepEqual(source.get("code"), { value: "AOI-01", quality: "good" })
})

// ── Đề xuất 4: subscribe trả hàm huỷ hoạt động thật ─────────────────────────────────────────────
test("subscribe trả về một hàm huỷ, và gọi hàm đó thì callback thôi chạy", () => {
  const source = createMachineDetailSource(baseMachine({ cycles: 1 }))
  let calls = 0
  const unsubscribe = source.subscribe(() => {
    calls += 1
  })
  assert.equal(typeof unsubscribe, "function")

  source.update(baseMachine({ cycles: 2 }))
  assert.equal(calls, 1, "callback phải chạy đúng một lần khi update() đẩy dữ liệu mới")

  unsubscribe()
  source.update(baseMachine({ cycles: 3 }))
  assert.equal(calls, 1, "sau khi huỷ đăng ký, update() KHÔNG được gọi lại callback — rò rỉ listener là lỗi thật trong kiosk chạy nhiều ngày")
})

test("huỷ đăng ký hai lần không ném, và không ảnh hưởng tới subscriber khác", () => {
  const source = createMachineDetailSource(baseMachine())
  let calls1 = 0
  let calls2 = 0
  const unsubscribe1 = source.subscribe(() => {
    calls1 += 1
  })
  source.subscribe(() => {
    calls2 += 1
  })

  unsubscribe1()
  assert.doesNotThrow(() => unsubscribe1())

  source.update(baseMachine({ cycles: 99 }))
  assert.equal(calls1, 0, "subscriber đã huỷ không được gọi")
  assert.equal(calls2, 1, "subscriber còn lại vẫn phải được gọi bình thường")
})

test("get() phản ánh đúng dữ liệu MỚI NHẤT sau update(), không kẹt ở snapshot lúc tạo source", () => {
  const source = createMachineDetailSource(baseMachine({ cycles: 5 }))
  assert.deepEqual(source.get("cycles"), { value: 5, quality: "good" })
  source.update(baseMachine({ cycles: 42 }))
  assert.deepEqual(source.get("cycles"), { value: 42, quality: "good" })
})
