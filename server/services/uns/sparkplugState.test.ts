/**
 * Sprint F3a — sparkplugState: seq wrap, bdSeq wrap, alias ổn định.
 */
import { describe, it, expect } from "vitest";
import { SparkplugSeqCounter, SparkplugNodeState } from "./sparkplugState";

describe("SparkplugSeqCounter", () => {
  it("next() trả 0..255 rồi wrap 255→0", () => {
    const c = new SparkplugSeqCounter();
    expect(c.next()).toBe(0);
    expect(c.next()).toBe(1);
    for (let i = 2; i <= 255; i++) c.next(); // tiến tới sau khi trả 255
    // Sau khi trả 255 (lần thứ 256), giá trị nội bộ wrap về 0.
    expect(c.peek()).toBe(0);
    expect(c.next()).toBe(0);
  });

  it("reset() đưa về 0", () => {
    const c = new SparkplugSeqCounter();
    c.next();
    c.next();
    c.reset();
    expect(c.next()).toBe(0);
  });
});

describe("SparkplugNodeState bdSeq", () => {
  it("nextBdSeq tăng và wrap 255→0", () => {
    const s = new SparkplugNodeState();
    expect(s.bdSeq).toBe(0);
    expect(s.nextBdSeq()).toBe(1);
    for (let i = 2; i <= 255; i++) s.nextBdSeq();
    expect(s.bdSeq).toBe(255);
    expect(s.nextBdSeq()).toBe(0);
  });
});

describe("SparkplugNodeState alias", () => {
  it("getAlias tăng dần & ổn định cho cùng name", () => {
    const s = new SparkplugNodeState();
    const a = s.getAlias("temp");
    const b = s.getAlias("pressure");
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(s.getAlias("temp")).toBe(0); // ổn định
    expect(s.getAlias("pressure")).toBe(1);
  });

  it("resetAliases cấp lại từ 0", () => {
    const s = new SparkplugNodeState();
    s.getAlias("a");
    s.getAlias("b");
    s.resetAliases();
    expect(s.getAlias("c")).toBe(0);
  });
});

describe("SparkplugNodeState birth state", () => {
  it("theo dõi node + device birth/death", () => {
    const s = new SparkplugNodeState();
    expect(s.isNodeBirthed()).toBe(false);
    s.markNodeBirthed();
    expect(s.isNodeBirthed()).toBe(true);

    expect(s.isDeviceBirthed("d1")).toBe(false);
    s.markDeviceBirthed("d1");
    expect(s.isDeviceBirthed("d1")).toBe(true);

    s.markNodeDead();
    expect(s.isNodeBirthed()).toBe(false);
    expect(s.isDeviceBirthed("d1")).toBe(false); // node dead xoá devices
  });
});
