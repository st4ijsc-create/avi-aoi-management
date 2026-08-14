/**
 * Nhóm C 2026-08-14 — bảng Trust & Enforcement phải nói ĐÚNG SỰ THẬT về hai cờ
 * xác thực yếu của máy.
 *
 * BỆNH ĐÃ CÓ THẬT (đo được, không phải giả định):
 * `collectFlagMatrix()` từng đọc cờ bằng `env.MACHINE_SHARED_KEY_ALLOWED !== "false"`.
 * Runbook doc 52 và `scripts/machine-key-rotation-report.mjs` đều bảo đặt `=deny`.
 * Với phép so chuỗi cũ thì `"deny" !== "false"` ⇒ bảng báo **"bypass — vẫn chấp nhận
 * shared plaintext key cũ"** TRONG KHI `machineAuthService.parseWeakAuthPolicy` đã
 * hiểu `"deny"` và đường cưỡng chế đã đóng thật.
 * ⇒ Người vận hành làm ĐÚNG runbook, rồi nhìn bảng và tưởng mình làm hỏng. Đây đúng
 *   lớp lỗi "thiết bị đo nói dối" mà nhánh này đã trả giá nhiều lần.
 *
 * Và cờ THỨ HAI của runbook (`MACHINE_CODE_ONLY_ALLOWED`) trước đó **vắng mặt hoàn
 * toàn** khỏi bảng — sau khi flip không có cách nào xác nhận nó từ giao diện.
 *
 * Lưới này canh cả hai. Nếu ai đó thay lời gọi `parseWeakAuthPolicy` bằng một phép so
 * chuỗi khác, ca `deny`/`off`/`no`/`0` sẽ đỏ ngay.
 */
import { describe, it, expect } from "vitest";
import { collectFlagMatrix } from "./readinessRouter";

function itemFor(key: string, env: NodeJS.ProcessEnv) {
  const found = collectFlagMatrix(env).find((i) => i.key === key);
  if (!found) throw new Error(`Bảng readiness KHÔNG có mục "${key}"`);
  return found;
}

/** Mọi cách viết mà `parseWeakAuthPolicy` coi là ĐÓNG. Runbook doc 52 dùng "deny". */
const CACH_VIET_DONG = ["deny", "false", "0", "off", "no", "DENY", " deny "];
/** Mọi cách viết mà nó coi là MỞ. */
const CACH_VIET_MO = ["allow", "true", "1", "on", "yes", "ALLOW"];

describe("readiness — MACHINE_SHARED_KEY_ALLOWED nói đúng sự thật", () => {
  it("vắng cờ ⇒ bypass (mặc định cho phép, đúng nghĩa thế trận yếu)", () => {
    const it0 = itemFor("MACHINE_SHARED_KEY_ALLOWED", {});
    expect(it0.state).toBe("bypass");
    expect(it0.enabled).toBe(true);
  });

  // ⚠ ĐÂY là ca chứng minh bệnh cũ: bản `!== "false"` sẽ ĐỎ ở mọi giá trị trừ "false".
  it.each(CACH_VIET_DONG)('"%s" ⇒ armed (đường yếu ĐÃ đóng)', (raw) => {
    const it0 = itemFor("MACHINE_SHARED_KEY_ALLOWED", { MACHINE_SHARED_KEY_ALLOWED: raw });
    expect(it0.state).toBe("armed");
    expect(it0.enabled).toBe(false);
  });

  it.each(CACH_VIET_MO)('"%s" ⇒ bypass (đường yếu còn mở)', (raw) => {
    const it0 = itemFor("MACHINE_SHARED_KEY_ALLOWED", { MACHINE_SHARED_KEY_ALLOWED: raw });
    expect(it0.state).toBe("bypass");
    expect(it0.enabled).toBe(true);
  });

  it('"read-only" ⇒ warn, KHÔNG phải armed và cũng KHÔNG phải bypass', () => {
    const it0 = itemFor("MACHINE_SHARED_KEY_ALLOWED", { MACHINE_SHARED_KEY_ALLOWED: "read-only" });
    expect(it0.state).toBe("warn");
    // còn đọc được ⇒ chưa đóng hẳn, `enabled` phải phản ánh điều đó
    expect(it0.enabled).toBe(true);
  });

  it("giá trị RÁC ⇒ rơi về mặc định bypass, KHÔNG âm thầm coi là đã đóng", () => {
    const it0 = itemFor("MACHINE_SHARED_KEY_ALLOWED", { MACHINE_SHARED_KEY_ALLOWED: "denied" });
    expect(it0.state).toBe("bypass");
  });

  it("câu gợi ý phải nêu đúng giá trị runbook dùng (=deny), không phải =false", () => {
    const it0 = itemFor("MACHINE_SHARED_KEY_ALLOWED", {});
    expect(it0.reason).toContain("deny");
  });
});

describe("readiness — MACHINE_CODE_ONLY_ALLOWED phải CÓ MẶT trên bảng", () => {
  it("cờ thứ hai của runbook không được vắng mặt", () => {
    // Trước bản vá, dòng này ném: bảng chỉ có cờ thứ nhất.
    expect(() => itemFor("MACHINE_CODE_ONLY_ALLOWED", {})).not.toThrow();
  });

  it.each(CACH_VIET_DONG)('"%s" ⇒ armed', (raw) => {
    const it0 = itemFor("MACHINE_CODE_ONLY_ALLOWED", { MACHINE_CODE_ONLY_ALLOWED: raw });
    expect(it0.state).toBe("armed");
    expect(it0.enabled).toBe(false);
  });

  it("vắng cờ ⇒ bypass", () => {
    expect(itemFor("MACHINE_CODE_ONLY_ALLOWED", {}).state).toBe("bypass");
  });
});

describe("hai cờ độc lập nhau", () => {
  it("đóng cờ này KHÔNG được làm bảng báo cờ kia cũng đóng", () => {
    const env = { MACHINE_SHARED_KEY_ALLOWED: "deny" };
    expect(itemFor("MACHINE_SHARED_KEY_ALLOWED", env).state).toBe("armed");
    expect(itemFor("MACHINE_CODE_ONLY_ALLOWED", env).state).toBe("bypass");
  });
});
