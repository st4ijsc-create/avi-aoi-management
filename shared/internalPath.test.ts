/**
 * doc 81 Đợt 3b Task 3 — `safeInternalPath`: chỉ đường dẫn NỘI BỘ tương đối mới được đi theo
 * (Review Focus #2 — không open redirect). Oracle viết tay theo luật của trình duyệt (WHATWG URL):
 * "//x" và "/\x" là URL cùng giao thức tới máy KHÁC; TAB/LF/CR bị trình duyệt BỎ khi phân tích nên
 * "/\t/evil" thành "//evil"; mọi thứ có scheme (http:, javascript:, data:) đều ra khỏi app.
 */
import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./internalPath";

describe("safeInternalPath", () => {
  it.each([
    "/",
    "/engineering-changes?flyout=ecn&flyoutId=12",
    "/recipes?code=R%2F1&tab=approval",
    "/interlock-rules?filter=pending&rule=7",
    "/alerts#top",
    "/scheduled-reports",
  ])("giữ đường nội bộ %s", (p) => {
    expect(safeInternalPath(p)).toBe(p);
  });

  it.each([
    ["URL tuyệt đối", "https://evil.example/x"],
    ["không scheme nhưng cùng giao thức", "//evil.example/x"],
    ["gạch chéo ngược", "/\\evil.example"],
    ["gạch chéo ngược giữa đường", "/a\\b"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,x"],
    ["tương đối không có /", "engineering-changes"],
    ["./", "./x"],
    ["TAB bị trình duyệt bỏ ⇒ //", "/\t/evil.example"],
    ["LF", "/\n/evil.example"],
    ["CR", "/\r/evil.example"],
    ["khoảng trắng đầu", " /x"],
    ["NUL", "/x\u0000"],
    ["DEL", "/x\u007f"],
    ["rỗng", ""],
    ["quá dài (>500, cột varchar 500)", "/" + "a".repeat(500)],
    // doc 81 Đợt 3b final wave (minor 1): đoạn chấm làm đường đã phân tích bắt đầu bằng "//" (WHATWG: "/..//evil" ⇒ pathname
    // "//evil"; "%2e%2e" là ".." đã mã hoá) — cùng gốc hôm nay, nhưng "//evil" trong href là máy KHÁC.
    ["đoạn chấm ⇒ //", "/..//evil.example"],
    ["đoạn chấm mã hoá ⇒ //", "/%2e%2e//evil.example"],
    ["đoạn chấm mã hoá HOA ⇒ //", "/%2E%2E//evil.example"],
    ["đoạn chấm giữa đường ⇒ //", "/a/../..//evil.example"],
    ["./ rồi .. ⇒ //", "/./..//evil.example/x?y=1"],
  ])("chặn %s", (_n, p) => {
    expect(safeInternalPath(p)).toBeNull();
  });

  it.each(["/a/../b", "/a/./b", "/..", "/x/%2e%2e/y"])("đoạn chấm KHÔNG ra '//' vẫn là đường nội bộ (%s)", (p) => {
    expect(safeInternalPath(p)).toBe(p);
  });

  it.each([null, undefined, 42, {}, ["/x"]])("không phải chuỗi ⇒ null (%s)", (v) => {
    expect(safeInternalPath(v as unknown)).toBeNull();
  });
});
