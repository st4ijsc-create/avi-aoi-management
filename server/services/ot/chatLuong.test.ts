/**
 * SCADA R0 Task 1 — hợp đồng chất lượng 3 mức + ánh xạ lỗi sang (statusCode, reason).
 */
import { describe, it, expect } from "vitest";
import { DeviceUnreachableError } from "../../_core/deviceErrors";
import {
  chatLuongOpcua,
  chatLuongLoiChung,
  chatLuongLoiModbus,
  chatLuongEndCodeSlmp,
  mauXauChoMoiTag,
  laLoiTimeout,
} from "./chatLuong";
import type { OtTagAddress } from "./otDriver";

describe("chatLuongOpcua", () => {
  it("0 => good, khong statusCode/reason", () => {
    expect(chatLuongOpcua(0, "Good")).toEqual({ quality: "good" });
  });

  it("0x40920000 => uncertain/device_error, giu ma trong statusCode", () => {
    const r = chatLuongOpcua(0x40920000, "UncertainLastUsableValue (0x40920000)");
    expect(r.quality).toBe("uncertain");
    expect(r.reason).toBe("device_error");
    expect(r.statusCode).toContain("0x40920000");
  });

  it.each([0x80310000, 0x808a0000, 0x800a0000, 0x800d0000, 0x80050000])("%i => bad/comm_lost", (sc) => {
    const r = chatLuongOpcua(sc, `Bad (0x${sc.toString(16)})`);
    expect(r.quality).toBe("bad");
    expect(r.reason).toBe("comm_lost");
  });

  it.each([0x80340000, 0x80330000])("%i => bad/config_error", (sc) => {
    const r = chatLuongOpcua(sc, `Bad (0x${sc.toString(16)})`);
    expect(r.quality).toBe("bad");
    expect(r.reason).toBe("config_error");
  });

  it("bit thong tin o 16 bit thap khong lam truot tap comm_lost/config_error (0x80310400, 0x80340400)", () => {
    expect(chatLuongOpcua(0x80310400, "BadNoCommunication+info").reason).toBe("comm_lost");
    expect(chatLuongOpcua(0x80340400, "BadNodeIdUnknown+info").reason).toBe("config_error");
  });

  it("0x80000000 => bad/device_error", () => {
    const r = chatLuongOpcua(0x80000000, "Bad (0x80000000)");
    expect(r.quality).toBe("bad");
    expect(r.reason).toBe("device_error");
  });
});

describe("chatLuongLoiModbus", () => {
  it("PortNotOpenError cua modbus-serial => port_not_open/comm_lost", () => {
    const e = Object.assign(new Error("Port Not Open"), { name: "PortNotOpenError", errno: "ECONNREFUSED" });
    expect(chatLuongLoiModbus(e)).toEqual({ statusCode: "port_not_open", reason: "comm_lost" });
  });

  it("ma exception van uu tien hon ten loi (modbusCode 2 + ten la)", () => {
    expect(chatLuongLoiModbus({ modbusCode: 2, name: "PortNotOpenError" })).toEqual({
      statusCode: "modbus_exc_02",
      reason: "config_error",
    });
  });

  it("ma exception 2 => modbus_exc_02/config_error", () => {
    expect(chatLuongLoiModbus({ modbusCode: 2 })).toEqual({ statusCode: "modbus_exc_02", reason: "config_error" });
  });
  it.each([1, 3])("ma %i => config_error", (c) => {
    expect(chatLuongLoiModbus({ modbusCode: c }).reason).toBe("config_error");
  });
  it.each([4, 5, 6, 11])("ma %i => device_error", (c) => {
    expect(chatLuongLoiModbus({ modbusCode: c }).reason).toBe("device_error");
  });
  it("TransactionTimedOutError => timeout/comm_lost", () => {
    const e = Object.assign(new Error("Timed out"), { name: "TransactionTimedOutError" });
    expect(chatLuongLoiModbus(e)).toEqual({ statusCode: "timeout", reason: "comm_lost" });
  });
  it.each(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"])("code %s => comm_lost, statusCode = ma", (code) => {
    const e = Object.assign(new Error(`connect ${code}`), { code });
    expect(chatLuongLoiModbus(e)).toEqual({ statusCode: code, reason: "comm_lost" });
  });
});

describe("chatLuongLoiChung", () => {
  it("DeviceUnreachableError => unreachable/comm_lost", () => {
    expect(chatLuongLoiChung(new DeviceUnreachableError("s7"))).toEqual({ statusCode: "unreachable", reason: "comm_lost" });
  });
  it("loi la => message/device_error", () => {
    expect(chatLuongLoiChung(new Error("weird"))).toEqual({ statusCode: "weird", reason: "device_error" });
  });
  it("cat message o 80 ky tu", () => {
    expect(chatLuongLoiChung(new Error("x".repeat(200))).statusCode).toHaveLength(80);
  });
  it("EHOSTUNREACH => comm_lost", () => {
    const e = Object.assign(new Error("no route"), { code: "EHOSTUNREACH" });
    expect(chatLuongLoiChung(e)).toEqual({ statusCode: "EHOSTUNREACH", reason: "comm_lost" });
  });
  it("gia tri khong phai Error van khong nem", () => {
    expect(chatLuongLoiChung("boom").reason).toBe("device_error");
    expect(chatLuongLoiChung(undefined).reason).toBe("device_error");
  });
});

describe("laLoiTimeout", () => {
  it("nhan TransactionTimedOutError / TimeoutError / message 'timed out'", () => {
    expect(laLoiTimeout(Object.assign(new Error("x"), { name: "TransactionTimedOutError" }))).toBe(true);
    expect(laLoiTimeout(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(laLoiTimeout(new Error("read timed out after 1500ms"))).toBe(true);
  });
  it("khong nhan loi thuong / ma ETIMEDOUT (do la nhanh ma he dieu hanh)", () => {
    expect(laLoiTimeout(new Error("weird"))).toBe(false);
    expect(laLoiTimeout(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe(false);
    expect(laLoiTimeout(null)).toBe(false);
  });
});

describe("chatLuongEndCodeSlmp", () => {
  it("0xC059 => slmp_end_0xC059/config_error", () => {
    expect(chatLuongEndCodeSlmp(0xc059)).toEqual({ statusCode: "slmp_end_0xC059", reason: "config_error" });
  });
  it.each([0xc056, 0xc05b])("%i => config_error", (c) => {
    expect(chatLuongEndCodeSlmp(c).reason).toBe("config_error");
  });
  it("0xC051 => device_error", () => {
    expect(chatLuongEndCodeSlmp(0xc051).reason).toBe("device_error");
  });
});

describe("mauXauChoMoiTag", () => {
  it("moi tag mot mau bad, value/raw null, tsSource server", () => {
    const tags: OtTagAddress[] = [
      { tagKey: "a", address: "40001", dataType: "int" },
      { tagKey: "b", address: "40002", dataType: "int" },
    ];
    const t = new Date("2026-10-23T01:02:03Z");
    const out = mauXauChoMoiTag(tags, "comm_lost", "comm_lost", t);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.tagKey)).toEqual(["a", "b"]);
    for (const s of out) {
      expect(s).toMatchObject({
        quality: "bad",
        value: null,
        raw: null,
        timestamp: t,
        tsSource: "server",
        statusCode: "comm_lost",
        reason: "comm_lost",
      });
    }
  });
});
