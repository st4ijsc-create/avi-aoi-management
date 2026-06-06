/**
 * Sprint F3a — topicBuilder: format có/không device + sanitize.
 */
import { describe, it, expect } from "vitest";
import { buildTopic } from "./topicBuilder";

describe("buildTopic", () => {
  it("không deviceId → 4 segment", () => {
    expect(buildTopic("g", "NBIRTH", "edge")).toBe("spBv1.0/g/NBIRTH/edge");
  });

  it("có deviceId → 5 segment", () => {
    expect(buildTopic("g", "DDATA", "edge", "dev1")).toBe("spBv1.0/g/DDATA/edge/dev1");
  });

  it("namespace tuỳ biến", () => {
    expect(buildTopic("g", "NDEATH", "e", undefined, "spBv2.0")).toBe("spBv2.0/g/NDEATH/e");
  });

  it("sanitize loại / # + khỏi group/edge/device", () => {
    expect(buildTopic("a/b#c", "DDATA", "e+d/g", "d#1")).toBe("spBv1.0/abc/DDATA/edg/d1");
  });

  it("deviceId rỗng coi như không có", () => {
    expect(buildTopic("g", "DDATA", "e", "")).toBe("spBv1.0/g/DDATA/e");
  });
});
