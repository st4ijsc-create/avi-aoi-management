// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterAlertsByPrefs,
  isSnoozed,
  loadNotifPrefs,
  saveNotifPrefs,
} from "./notificationPrefs";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("loadNotifPrefs", () => {
  it("(e) chưa lưu key ⇒ mặc định", () => {
    const result = loadNotifPrefs("u1");
    expect(result).toEqual({ highPriorityOnly: false, snoozeUntil: 0 });
  });

  it("(a) kết quả CHỈ có 2 khoá highPriorityOnly và snoozeUntil", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ highPriorityOnly: true, snoozeUntil: 500 }));
    const result = loadNotifPrefs("u1");
    const keys = Object.keys(result);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("highPriorityOnly");
    expect(keys).toContain("snoozeUntil");
  });

  it("(b) highPriorityOnly là chuỗi \"true\" ⇒ false", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ highPriorityOnly: "true" }));
    expect(loadNotifPrefs("u1").highPriorityOnly).toBe(false);
  });

  it("(c) snoozeUntil là chuỗi \"123\" ⇒ 0", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ snoozeUntil: "123" }));
    expect(loadNotifPrefs("u1").snoozeUntil).toBe(0);
  });

  it("(d) JSON là mảng ⇒ mặc định", () => {
    localStorage.setItem("notifPrefs:u1", "[1,2]");
    expect(loadNotifPrefs("u1")).toEqual({ highPriorityOnly: false, snoozeUntil: 0 });
  });

  it("(d) JSON là null ⇒ mặc định", () => {
    localStorage.setItem("notifPrefs:u1", "null");
    expect(loadNotifPrefs("u1")).toEqual({ highPriorityOnly: false, snoozeUntil: 0 });
  });

  it("(d) JSON là số ⇒ mặc định", () => {
    localStorage.setItem("notifPrefs:u1", "42");
    expect(loadNotifPrefs("u1")).toEqual({ highPriorityOnly: false, snoozeUntil: 0 });
  });

  it("(d) JSON là chuỗi ⇒ mặc định", () => {
    localStorage.setItem("notifPrefs:u1", '"abc"');
    expect(loadNotifPrefs("u1")).toEqual({ highPriorityOnly: false, snoozeUntil: 0 });
  });

  it("(f) mỗi lần gọi trả đối tượng MỚI (không share reference)", () => {
    const a = loadNotifPrefs("u1");
    const b = loadNotifPrefs("u1");
    expect(a).not.toBe(b);
  });

  it("(g) JSON hỏng ⇒ mặc định, không ném", () => {
    localStorage.setItem("notifPrefs:u1", '{"x"');
    expect(() => loadNotifPrefs("u1")).not.toThrow();
    expect(loadNotifPrefs("u1")).toEqual({ highPriorityOnly: false, snoozeUntil: 0 });
  });

  it("(j) giá trị đúng kiểu boolean và số ⇒ giữ nguyên", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ highPriorityOnly: true, snoozeUntil: 999999999999 }));
    const result = loadNotifPrefs("u1");
    expect(result.highPriorityOnly).toBe(true);
    expect(typeof result.highPriorityOnly).toBe("boolean");
    expect(result.snoozeUntil).toBe(999999999999);
    expect(typeof result.snoozeUntil).toBe("number");
  });

  it("(k) snoozeUntil âm ⇒ 0", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ snoozeUntil: -1 }));
    expect(loadNotifPrefs("u1").snoozeUntil).toBe(0);
  });

  it("(k) snoozeUntil NaN ⇒ 0", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ snoozeUntil: NaN }));
    expect(loadNotifPrefs("u1").snoozeUntil).toBe(0);
  });

  it("(k) snoozeUntil Infinity ⇒ 0", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ snoozeUntil: Infinity }));
    expect(loadNotifPrefs("u1").snoozeUntil).toBe(0);
  });

  it("(l) trường lạ trong JSON ⇒ bị bỏ qua", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ highPriorityOnly: true, extra: "x" }));
    const result = loadNotifPrefs("u1");
    expect(result).toEqual({ highPriorityOnly: true, snoozeUntil: 0 });
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("(l) trường lạ + snoozeUntil đúng ⇒ giữ đúng trường hợp lệ", () => {
    localStorage.setItem("notifPrefs:u1", JSON.stringify({ highPriorityOnly: false, snoozeUntil: 100, extra: "y" }));
    const result = loadNotifPrefs("u1");
    expect(result).toEqual({ highPriorityOnly: false, snoozeUntil: 100 });
  });
});

describe("saveNotifPrefs", () => {
  it("(h) không ném khi localStorage.setItem ném", () => {
    const boom = () => {
      throw new Error("chan");
    };
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: boom });
    expect(() => saveNotifPrefs("u1", { highPriorityOnly: true, snoozeUntil: 0 })).not.toThrow();
  });
});

describe("isSnoozed và filterAlertsByPrefs", () => {
  it("(i) isSnoozed: snoozeUntil > now ⇒ true", () => {
    expect(isSnoozed({ highPriorityOnly: false, snoozeUntil: 999999999999 }, 0)).toBe(true);
  });

  it("(i) isSnoozed: snoozeUntil <= now ⇒ false", () => {
    expect(isSnoozed({ highPriorityOnly: false, snoozeUntil: 0 }, 100)).toBe(false);
  });

  it("(i) filterAlertsByPrefs: highPriorityOnly lọc đúng", () => {
    const alerts = [
      { type: "NG_ALERT" },
      { type: "YIELD_WARNING" },
      { type: "INFO" },
    ];
    const result = filterAlertsByPrefs(alerts, { highPriorityOnly: true, snoozeUntil: 0 }, ["NG_ALERT"], 0);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("NG_ALERT");
  });

  it("(i) filterAlertsByPrefs: snoozed ⇒ trả mảng rỗng", () => {
    const alerts = [{ type: "NG_ALERT" }];
    expect(filterAlertsByPrefs(alerts, { highPriorityOnly: false, snoozeUntil: 999999999999 }, [], 0)).toEqual([]);
  });
});
