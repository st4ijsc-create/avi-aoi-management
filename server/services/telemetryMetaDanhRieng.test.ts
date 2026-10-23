/**
 * SCADA R0 Task 7 (fix bao mat) - duong ingest NGOAI phai go khoa meta danh rieng cua duong OT trong tien trinh.
 */
import { describe, it, expect } from "vitest";
import { boKhoaMetaDanhRieng, KHOA_META_DANH_RIENG } from "./telemetryMetaDanhRieng";
import { toOtCanonicalSample } from "../_core/otIngestRoute";
import { toCanonicalSample } from "../api/v1/router";
import { parseCanonicalTelemetry } from "./mqttService";

const GIA = { adapterId: 5, tagKey: "x", statusCode: "S", reason: "comm_lost", tsSource: "device", other: 1 };

describe("boKhoaMetaDanhRieng", () => {
  it("go du 5 khoa danh rieng, giu khoa khac, khong sua ban goc", () => {
    const goc = { ...GIA };
    expect(boKhoaMetaDanhRieng(goc)).toEqual({ other: 1 });
    expect(goc).toEqual(GIA);
    expect(KHOA_META_DANH_RIENG).toHaveLength(5);
  });
  it("khong phai object => null", () => {
    expect(boKhoaMetaDanhRieng(null)).toBeNull();
    expect(boKhoaMetaDanhRieng("x")).toBeNull();
    expect(boKhoaMetaDanhRieng([1])).toBeNull();
  });
});

describe("duong ingest ngoai", () => {
  it("/api/ot/ingest: toOtCanonicalSample go khoa danh rieng", () => {
    const s = toOtCanonicalSample({ deviceId: "D", metric: "m", value: 1, meta: GIA });
    expect(s.meta).toEqual({ other: 1 });
  });
  it("/api/v1: toCanonicalSample go khoa danh rieng", () => {
    const s = toCanonicalSample({ deviceId: "D", metric: "m", value: 1, meta: GIA });
    expect(s.meta).toEqual({ other: 1 });
  });
  it("cau MQTT: parseCanonicalTelemetry khong de khoa danh rieng lot vao meta", () => {
    const out = parseCanonicalTelemetry(
      "synapse/x/telemetry",
      JSON.stringify({ asset_id: "D", seq: 3, metrics: [{ name: "m", value: 1, meta: GIA, adapterId: 5, tagKey: "x" }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].meta).toEqual({ topic: "synapse/x/telemetry", seq: 3 });
  });
});
