/**
 * doc 81 Đợt 1B Task 4 — DANH SÁCH TRẮNG script Techman (BE2 T1-G).
 *
 * `params.script` của một job `custom` được TechmanDriver đặt nguyên văn vào khung TMSCT gửi xuống
 * Listen Node. Trước đây mọi chuỗi đều được nhận ⇒ `robot.actuate` gửi được BẤT KỲ TM script nào.
 *
 * Danh sách chỉ gồm các lệnh mà repo ĐÃ gửi tới Techman dưới dạng một câu script đứng riêng
 * (grep `server/`, `client/`, `shared/` ngày 2026-09-27):
 *   • `ScriptExit()`         — mặc định của job `custom` không kèm script (techmanDriver.ts jobToScript);
 *   • `StopAndClearBuffer()` — job `abort` (techmanDriver.ts jobToScript).
 * `PTP("JPP",…)` do driver TỰ dựng từ job `home`/`move`/… với tham số đã ép kiểu số — KHÔNG thuộc
 * danh sách này (nhận `PTP` từ script tuỳ ý sẽ mở chuyển động tự do qua đường console actuate).
 * `ChangeBase`, `QueueTag`… KHÔNG có nơi nào trong repo gửi ⇒ không có trong danh sách.
 *
 * So khớp NGUYÊN VĂN (không trim, không phân biệt hoa/thường không được nới): một ký tự thừa, một
 * câu thứ hai sau `\r\n`/`;` đều bị từ chối. Mở rộng danh sách = quyết định an toàn có test, không
 * phải sửa lặng lẽ.
 */
export const TECHMAN_SCRIPT_ALLOWLIST = ["ScriptExit()", "StopAndClearBuffer()"] as const;

export type TechmanAllowedScript = (typeof TECHMAN_SCRIPT_ALLOWLIST)[number];

/** Mã lý do ổn định khi một script bị từ chối (driver `detail.reasonCode`). */
export const TECHMAN_SCRIPT_NOT_ALLOWLISTED = "tm_script_not_allowlisted" as const;

export function isTechmanScriptAllowed(script: unknown): script is TechmanAllowedScript {
  return typeof script === "string" && (TECHMAN_SCRIPT_ALLOWLIST as readonly string[]).includes(script);
}

/**
 * doc 81 Đợt 1B Task 5 (R10a) — console verbs `start`/`reset`/`pause` map to a `custom` job
 * (robotRouter verbToJobType) whose default Techman script is `ScriptExit()`: the Listen
 * Node exits and TMflow CONTINUES the flow — possibly with motion. None of the three is what
 * the operator asked for, and none has been validated on a real TM (FAT). Refused (router
 * FORBIDDEN + driver refusal) until FAT defines them.
 */
export const TECHMAN_UNVALIDATED_CONSOLE_VERBS = ["start", "reset", "pause"] as const;

/** Stable reason code for a refused unvalidated console verb (driver `detail.reasonCode`). */
export const TECHMAN_CONSOLE_VERB_UNVALIDATED = "techman_console_verb_unvalidated" as const;

export function isTechmanUnvalidatedConsoleVerb(verb: unknown): boolean {
  return typeof verb === "string" && (TECHMAN_UNVALIDATED_CONSOLE_VERBS as readonly string[]).includes(verb);
}
