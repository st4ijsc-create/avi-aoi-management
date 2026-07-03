/**
 * W3-11 — unit tests for the shared line-diff logic (pure; no React render).
 */
import { describe, it, expect } from "vitest";
import { computeLineDiff, prettyJson } from "./LineDiff";

describe("computeLineDiff", () => {
  it("marks every line 'same' for identical inputs", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(rows.every((r) => r.kind === "same")).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("detects an added line", () => {
    const rows = computeLineDiff("a\nc", "a\nb\nc");
    const add = rows.filter((r) => r.kind === "add");
    expect(add).toHaveLength(1);
    expect(add[0]).toMatchObject({ kind: "add", text: "b" });
    // Dòng "a" và "c" vẫn giữ nguyên.
    expect(rows.filter((r) => r.kind === "same").map((r) => r.text)).toEqual(["a", "c"]);
  });

  it("detects a removed line", () => {
    const rows = computeLineDiff("a\nb\nc", "a\nc");
    const del = rows.filter((r) => r.kind === "del");
    expect(del).toHaveLength(1);
    expect(del[0]).toMatchObject({ kind: "del", text: "b" });
  });

  it("detects a changed line as one del + one add", () => {
    const rows = computeLineDiff("x = 1", "x = 2");
    expect(rows.filter((r) => r.kind === "del")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(1);
  });

  it("keeps per-side line numbers", () => {
    const rows = computeLineDiff("a\nb", "a\nB");
    const same = rows.find((r) => r.kind === "same")!;
    expect(same).toMatchObject({ leftNo: 1, rightNo: 1 });
  });
});

describe("prettyJson", () => {
  it("pretty-prints an object with 2-space indent", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("re-formats a JSON string", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("returns '' for null/undefined", () => {
    expect(prettyJson(null)).toBe("");
    expect(prettyJson(undefined)).toBe("");
  });

  it("leaves a non-JSON string untouched", () => {
    expect(prettyJson("hello")).toBe("hello");
  });
});
