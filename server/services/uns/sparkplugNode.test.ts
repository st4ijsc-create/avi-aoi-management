/**
 * Sprint F3a — sparkplugNode: NBIRTH/DBIRTH/DDATA/NDEATH topic + payload (decode thật).
 */
import { describe, it, expect } from "vitest";
import { SparkplugNode } from "./sparkplugNode";
import { decodePayload } from "./sparkplugEncoder";

describe("SparkplugNode", () => {
  it("NBIRTH: topic, có metric bdSeq + metric defs, seq=0", () => {
    const node = new SparkplugNode();
    const { topic, buffer } = node.buildNbirth("grp", "edge", [
      { name: "temp", type: "Double", value: 0 },
      { name: "run", type: "Boolean", value: false },
    ]);
    expect(topic).toBe("spBv1.0/grp/NBIRTH/edge");

    const p = decodePayload(buffer);
    expect(p.seq).toBe(0);
    const byName = Object.fromEntries(p.metrics.map((m) => [m.name, m]));
    expect(Number(byName.bdSeq.value)).toBe(1); // bdSeq tăng từ 0 → 1
    expect(byName.temp.alias).toBe(0);
    expect(byName.run.alias).toBe(1);
    expect(node.state.isNodeBirthed()).toBe(true);
  });

  it("DDATA: seq tăng sau NBIRTH, dùng alias không name", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", [{ name: "temp", type: "Double", value: 0 }]);
    // NBIRTH lấy seq 0; DDATA tiếp theo seq 1.
    const { topic, buffer } = node.buildDdata("grp", "edge", "dev", [
      { name: "temp", type: "Double", value: 23.4 },
    ]);
    expect(topic).toBe("spBv1.0/grp/DDATA/edge/dev");
    const p = decodePayload(buffer);
    expect(p.seq).toBe(1);
    expect(p.metrics[0].alias).toBe(0); // alias ổn định với "temp"
    expect(p.metrics[0].name).toBeUndefined();
    expect(p.metrics[0].value).toBeCloseTo(23.4);
  });

  it("DBIRTH: topic có device, đăng ký device birthed", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []);
    const { topic } = node.buildDbirth("grp", "edge", "dev1", [
      { name: "x", type: "Int64", value: 1 },
    ]);
    expect(topic).toBe("spBv1.0/grp/DBIRTH/edge/dev1");
    expect(node.state.isDeviceBirthed("dev1")).toBe(true);
  });

  it("NDEATH: chỉ metric bdSeq khớp bdSeq hiện tại", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []); // bdSeq → 1
    const { topic, buffer } = node.buildNdeath("grp", "edge");
    expect(topic).toBe("spBv1.0/grp/NDEATH/edge");
    const p = decodePayload(buffer);
    expect(p.metrics).toHaveLength(1);
    expect(p.metrics[0].name).toBe("bdSeq");
    expect(Number(p.metrics[0].value)).toBe(1);
  });

  it("DDATA seq tiếp tục tăng qua nhiều lần", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []); // seq 0
    expect(decodePayload(node.buildDdata("grp", "edge", "d", []).buffer).seq).toBe(1);
    expect(decodePayload(node.buildDdata("grp", "edge", "d", []).buffer).seq).toBe(2);
  });
});
