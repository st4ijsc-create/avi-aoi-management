/**
 * Unit tests — hotFolderParsers (doc 27 gap C1 · W2-A).
 *
 * Pure helpers only (no fs / db): glob matching, format detection, and the
 * CSV/XML/JSON → adapter-payload parsers incl. malformed-input errors.
 */
import { describe, it, expect } from "vitest";
import {
  globToRegex,
  matchesPattern,
  detectFormat,
  parseResultFile,
  parseCsvCells,
  parseCsvRecords,
  sha256Hex,
  type CsvPayloadEnvelope,
} from "./hotFolderParsers";

describe("globToRegex / matchesPattern", () => {
  it("matches * wildcards case-insensitively", () => {
    expect(matchesPattern("BOARD_001.CSV", "*.csv")).toBe(true);
    expect(matchesPattern("board.csv", "board.*")).toBe(true);
    expect(matchesPattern("board.xml", "*.csv")).toBe(false);
  });

  it("supports {a,b} alternation", () => {
    expect(matchesPattern("r1.csv", "*.{csv,xml,json}")).toBe(true);
    expect(matchesPattern("r1.xml", "*.{csv,xml,json}")).toBe(true);
    expect(matchesPattern("r1.json", "*.{csv,xml,json}")).toBe(true);
    expect(matchesPattern("r1.txt", "*.{csv,xml}")).toBe(false);
  });

  it("supports ? single-char wildcard and anchors the whole name", () => {
    expect(matchesPattern("a1.csv", "a?.csv")).toBe(true);
    expect(matchesPattern("a12.csv", "a?.csv")).toBe(false);
    expect(matchesPattern("xa1.csv", "a?.csv")).toBe(false);
  });

  it("escapes regex metacharacters (no pathological patterns)", () => {
    expect(matchesPattern("a+b(1).csv", "a+b(1).csv")).toBe(true);
    expect(globToRegex("**((((").test("anything")).toBe(false);
  });

  it("empty pattern falls back to match-all", () => {
    expect(matchesPattern("whatever.bin", "")).toBe(true);
  });
});

describe("detectFormat", () => {
  it("maps extensions (txt counts as csv — common AOI export)", () => {
    expect(detectFormat("a.csv")).toBe("csv");
    expect(detectFormat("a.TXT")).toBe("csv");
    expect(detectFormat("a.xml")).toBe("xml");
    expect(detectFormat("a.JSON")).toBe("json");
    expect(detectFormat("a.zip")).toBeNull();
    expect(detectFormat("noext")).toBeNull();
  });
});

describe("parseResultFile — JSON", () => {
  it("returns the parsed document as-is", () => {
    const { format, payload } = parseResultFile("r.json", '{"serial":"SN1","results":[]}');
    expect(format).toBe("json");
    expect(payload).toEqual({ serial: "SN1", results: [] });
  });

  it("throws a descriptive error on malformed JSON", () => {
    expect(() => parseResultFile("r.json", "{nope")).toThrow(/Invalid JSON in "r\.json"/);
  });

  it("throws on empty files", () => {
    expect(() => parseResultFile("r.json", "   ")).toThrow(/empty/);
  });

  it("strips a UTF-8 BOM", () => {
    const { payload } = parseResultFile("r.json", "﻿{\"a\":1}");
    expect(payload).toEqual({ a: 1 });
  });
});

describe("parseResultFile — XML", () => {
  it("parses a document with attributes preserved", () => {
    const { format, payload } = parseResultFile(
      "r.xml",
      `<Board serial="SN9"><Point name="MP1" judge="OK"/></Board>`,
    );
    expect(format).toBe("xml");
    const doc = payload as Record<string, any>;
    expect(doc.Board["@_serial"]).toBe("SN9");
    expect(doc.Board.Point["@_name"]).toBe("MP1");
  });

  it("throws on malformed XML", () => {
    expect(() => parseResultFile("r.xml", "<a><b></a>")).toThrow(/Invalid XML in "r\.xml"/);
  });
});

describe("parseResultFile — CSV", () => {
  it("returns the documented envelope with header-keyed rows", () => {
    const text = "serial,point,value,judged\nSN1,MP001,0.42,OK\nSN1,MP002,0.55,NG\n";
    const { format, payload } = parseResultFile("r.csv", text);
    expect(format).toBe("csv");
    const env = payload as CsvPayloadEnvelope;
    expect(env.fileName).toBe("r.csv");
    expect(env.rows).toHaveLength(2);
    expect(env.rows[0]).toEqual({ serial: "SN1", point: "MP001", value: "0.42", judged: "OK" });
    expect(env.raw).toBe(text);
  });

  it("handles quoted fields with embedded commas, quotes and newlines (RFC 4180)", () => {
    const text = 'name,remark\nA,"hello, ""world""\nsecond line"\n';
    const rows = parseCsvRecords(text);
    expect(rows[0].remark).toBe('hello, "world"\nsecond line');
  });

  it("handles CRLF and skips blank lines", () => {
    const rows = parseCsvRecords("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("throws on an unterminated quote", () => {
    expect(() => parseCsvCells('a,b\n1,"open', "bad.csv")).toThrow(/unterminated/);
  });

  it("throws when there is a header but no data rows", () => {
    expect(() => parseResultFile("r.csv", "a,b\n")).toThrow(/no data rows/);
  });
});

describe("sha256Hex", () => {
  it("is deterministic and 64 hex chars", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
  });
});
