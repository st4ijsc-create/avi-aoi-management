/**
 * doc 81 Đợt 1B Task 3 — fix round 1 (R9): kiểm "đích giả lập không phải thiết bị thật" phải
 * FAIL-CLOSED và so địa chỉ theo dạng CHUẨN.
 *
 * Lỗ reviewer đo: resolver mặc định trả [] khi lỗi/hết giờ ⇒ một robot đăng ký bằng TÊN MÁY
 * không phân giải được bị bỏ qua, URSIM_HOST là IP thật của chính robot đó vẫn lọt (power on +
 * brake release tới cánh tay thật). IPv4-mapped / IPv6 viết đầy đủ so như chữ. Và: kiểm một
 * địa chỉ, rồi UrsimClient tự phân giải lại tên — kiểm/dùng lệch nhau.
 *
 * Mọi phân giải ở đây là resolver TIÊM (không DNS thật); địa chỉ dùng dải tài liệu RFC 5737 /
 * RFC 3849 — không một kết nối nào được mở.
 */
import { describe, it, expect, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { readAppErrorMeta } from "../../../_core/appError";
import { resolveSimTarget, canonicalIp, type SimTargetRegistryDeps } from "./simTargetRegistry";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`bounded timeout ${ms}ms`)), ms).unref?.()),
  ]);
}

/** Resolver tiêm: bảng tên → địa chỉ; tên vắng ⇒ ném như ENOTFOUND. Đếm lượt gọi từng tên. */
function dns(table: Record<string, string[]>) {
  const calls: string[] = [];
  const resolveAddresses = async (host: string) => {
    calls.push(host);
    const a = table[host];
    if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return a;
  };
  return { resolveAddresses, calls };
}

async function outcome(p: Promise<unknown>): Promise<{ code: string; reason?: string; host?: string }> {
  try {
    const r = (await withTimeout(p, 5000)) as { endpoint: { host: string } };
    return { code: "OK", host: r.endpoint.host };
  } catch (e) {
    if (!(e instanceof TRPCError)) throw e;
    const meta = readAppErrorMeta(e);
    return { code: e.code, reason: (meta?.appParams as { reason?: string } | undefined)?.reason };
  }
}

function run(simHost: string, devices: string[], deps: SimTargetRegistryDeps) {
  process.env.URSIM_HOST = simHost;
  return outcome(resolveSimTarget("default", { listRealDeviceEndpoints: async () => devices, ...deps }));
}

afterEach(() => {
  delete process.env.URSIM_HOST;
});

describe("canonicalIp", () => {
  it("chuẩn hoá IPv4-mapped, IPv6 đầy đủ/rút gọn, ngoặc, hoa/thường, dấu chấm cuối", () => {
    expect(canonicalIp("::ffff:192.0.2.5")).toBe("192.0.2.5");
    expect(canonicalIp("::FFFF:C000:0205")).toBe("192.0.2.5");
    expect(canonicalIp("[::ffff:c000:205]")).toBe("192.0.2.5");
    expect(canonicalIp("0:0:0:0:0:0:0:1")).toBe("::1");
    expect(canonicalIp("[0000:0000:0000:0000:0000:0000:0000:0001]")).toBe("::1");
    expect(canonicalIp("2001:DB8:0:0:0:0:0:7")).toBe("2001:db8::7");
    expect(canonicalIp("192.0.2.5")).toBe("192.0.2.5");
    expect(canonicalIp("ur-arm.plant")).toBeNull();
  });
});

describe("resolveSimTarget — fail-closed theo R9", () => {
  it("URSIM_HOST không phân giải được (lỗi DNS) ⇒ PRECONDITION_FAILED simTargetUnresolvable", async () => {
    const d = dns({});
    expect(await run("ursim.lab.example", [], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetUnresolvable" });
  });

  it("URSIM_HOST phân giải HẾT GIỜ ⇒ PRECONDITION_FAILED simTargetUnresolvable (có hạn, không treo)", async () => {
    const r = await run("ursim.lab.example", [], {
      resolveAddresses: () => new Promise<string[]>(() => { /* never */ }),
      dnsTimeoutMs: 50,
    });
    expect(r).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetUnresolvable" });
  });

  it("resolver trả danh sách RỖNG cho URSIM_HOST ⇒ coi như không phân giải được", async () => {
    expect(await run("ursim.lab.example", [], { resolveAddresses: async () => [] })).toEqual({
      code: "PRECONDITION_FAILED",
      reason: "simTargetUnresolvable",
    });
  });

  it("LỖ CŨ: robot đăng ký bằng TÊN không phân giải được + URSIM_HOST là IP KHÔNG loopback ⇒ từ chối deviceHostUnresolvable", async () => {
    const d = dns({});
    expect(await run("192.0.2.5", ["ur-arm-3.plant.example:30002"], d)).toEqual({
      code: "PRECONDITION_FAILED",
      reason: "deviceHostUnresolvable",
    });
  });

  it("tên thiết bị phân giải HẾT GIỜ + URSIM_HOST không loopback ⇒ từ chối", async () => {
    const r = await run("192.0.2.5", ["ur-arm-3.plant.example:30002"], {
      resolveAddresses: () => new Promise<string[]>(() => { /* never */ }),
      dnsTimeoutMs: 50,
    });
    expect(r).toEqual({ code: "PRECONDITION_FAILED", reason: "deviceHostUnresolvable" });
  });

  it("NGOẠI LỆ loopback: tên thiết bị không phân giải được nhưng MỌI địa chỉ sim là loopback ⇒ chấp nhận", async () => {
    const d = dns({ localhost: ["127.0.0.1", "::1"] });
    expect(await run("127.0.0.1", ["stub://x", "ur-arm-3.plant.example:30002"], d)).toEqual({ code: "OK", host: "127.0.0.1" });
    expect(await run("localhost", ["stub://x"], d)).toEqual({ code: "OK", host: "127.0.0.1" });
    expect(await run("::1", ["stub://x"], d)).toEqual({ code: "OK", host: "::1" });
    expect(await run("127.1.2.3", ["stub://x"], d)).toEqual({ code: "OK", host: "127.1.2.3" }); // cả dải 127.0.0.0/8
  });

  it("sim phân giải ra loopback LẪN địa chỉ thật ⇒ KHÔNG hưởng ngoại lệ loopback", async () => {
    const d = dns({ "ursim.lab.example": ["127.0.0.1", "192.0.2.9"] });
    expect(await run("ursim.lab.example", ["ur-arm-3.plant.example"], d)).toEqual({
      code: "PRECONDITION_FAILED",
      reason: "deviceHostUnresolvable",
    });
  });

  it("IPv4-mapped: URSIM_HOST ::ffff:192.0.2.5 vs robot 192.0.2.5 (và chiều ngược lại) ⇒ trùng thiết bị thật", async () => {
    const d = dns({});
    expect(await run("::ffff:192.0.2.5", ["192.0.2.5:30002"], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetIsRealDevice" });
    expect(await run("192.0.2.5", ["[::ffff:c000:205]:502"], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetIsRealDevice" });
  });

  it("IPv6 viết đầy đủ vs rút gọn: URSIM_HOST 0:0:0:0:0:0:0:1 vs robot [::1] ⇒ trùng", async () => {
    const d = dns({});
    expect(await run("0:0:0:0:0:0:0:1", ["[::1]:30002"], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetIsRealDevice" });
    expect(await run("2001:db8::7", ["tcp://[2001:DB8:0:0:0:0:0:7]:502"], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetIsRealDevice" });
  });

  it("bí danh localhost: URSIM_HOST localhost vs robot 127.0.0.1 ⇒ trùng", async () => {
    const d = dns({ localhost: ["127.0.0.1"] });
    expect(await run("localhost", ["127.0.0.1:30002"], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetIsRealDevice" });
  });

  it("hoa/thường + dấu chấm cuối: URSIM_HOST 'UR-Cell.Plant.Example.' vs robot 'ur-cell.plant.example' ⇒ trùng", async () => {
    const d = dns({ "ur-cell.plant.example": ["198.51.100.7"] });
    expect(await run("UR-Cell.Plant.Example.", ["ur-cell.plant.example:30002"], d)).toEqual({
      code: "PRECONDITION_FAILED",
      reason: "simTargetIsRealDevice",
    });
  });

  it("tên thiết bị phân giải ra đúng IP của URSIM_HOST ⇒ trùng", async () => {
    const d = dns({ "ur-arm-3.plant.example": ["192.0.2.5"] });
    expect(await run("192.0.2.5", ["ur-arm-3.plant.example:30002"], d)).toEqual({ code: "PRECONDITION_FAILED", reason: "simTargetIsRealDevice" });
  });

  it("KIỂM = DÙNG: endpoint trả về mang IP đã phân giải (không phải tên), tên sim chỉ được phân giải MỘT lần", async () => {
    const d = dns({ "ursim.lab.example": ["198.51.100.20"], "plc-1.plant.example": ["198.51.100.30"] });
    const r = await run("ursim.lab.example", ["plc-1.plant.example:502", "192.0.2.40:30002"], d);
    expect(r).toEqual({ code: "OK", host: "198.51.100.20" });
    expect(d.calls.filter((h) => h === "ursim.lab.example")).toHaveLength(1);
  });
});
