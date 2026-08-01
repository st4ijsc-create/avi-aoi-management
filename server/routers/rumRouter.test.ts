/**
 * Doc 44 G5.9 — rumRouter tests: zod chặt reject giá trị bẩn, accept batch hợp lệ,
 * chuẩn hoá route label (chống nổ cardinality Prometheus) + throttle per-IP.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../_core/metrics", () => ({
  observeRumWebVital: vi.fn(),
}));

import { observeRumWebVital } from "../_core/metrics";
import { rumRouter, normalizeRumRouteLabel, __resetRumThrottleForTest } from "./rumRouter";

const observeSpy = vi.mocked(observeRumWebVital);

function makeCaller(ip = "10.0.0.1") {
  return rumRouter.createCaller({ user: null, req: { ip } } as any);
}

const validSample = { metric: "lcp" as const, value: 1234, route: "/dashboard" };

beforeEach(() => {
  observeSpy.mockClear();
  __resetRumThrottleForTest();
});

describe("rum.report — accept batch hợp lệ", () => {
  it("ghi từng mẫu vào prom histogram và trả accepted count", async () => {
    const caller = makeCaller();
    const result = await caller.report({
      samples: [
        { metric: "lcp", value: 2500, route: "/products" },
        { metric: "cls", value: 0.12, route: "/products" },
        { metric: "inp", value: 350, route: "/machines/42" },
        { metric: "ttfb", value: 180.5, route: "/" },
      ],
    });
    expect(result).toEqual({ accepted: 4 });
    expect(observeSpy).toHaveBeenCalledTimes(4);
    expect(observeSpy).toHaveBeenCalledWith("lcp", "/products", 2500);
    expect(observeSpy).toHaveBeenCalledWith("cls", "/products", 0.12);
    // route id số phải được chuẩn hoá → ":id" (server không tin client)
    expect(observeSpy).toHaveBeenCalledWith("inp", "/machines/:id", 350);
    expect(observeSpy).toHaveBeenCalledWith("ttfb", "/", 180.5);
  });

  it("chấp nhận đúng 50 mẫu (max batch)", async () => {
    const caller = makeCaller();
    const samples = Array.from({ length: 50 }, () => ({ ...validSample }));
    const result = await caller.report({ samples });
    expect(result.accepted).toBe(50);
  });
});

describe("rum.report — zod reject giá trị bẩn", () => {
  it("reject metric ngoài enum [lcp,cls,inp,ttfb]", async () => {
    const caller = makeCaller();
    await expect(
      caller.report({ samples: [{ metric: "fid" as any, value: 100, route: "/" }] }),
    ).rejects.toThrow();
    expect(observeSpy).not.toHaveBeenCalled();
  });

  it("reject value âm", async () => {
    const caller = makeCaller();
    await expect(
      caller.report({ samples: [{ metric: "lcp", value: -1, route: "/" }] }),
    ).rejects.toThrow();
  });

  it("reject value > 120000", async () => {
    const caller = makeCaller();
    await expect(
      caller.report({ samples: [{ metric: "lcp", value: 120001, route: "/" }] }),
    ).rejects.toThrow();
  });

  it("reject value không hữu hạn (Infinity/NaN)", async () => {
    const caller = makeCaller();
    await expect(
      caller.report({ samples: [{ metric: "lcp", value: Infinity, route: "/" }] }),
    ).rejects.toThrow();
    await expect(
      caller.report({ samples: [{ metric: "lcp", value: NaN, route: "/" }] }),
    ).rejects.toThrow();
  });

  it("reject route rỗng hoặc dài quá 200 ký tự", async () => {
    const caller = makeCaller();
    await expect(
      caller.report({ samples: [{ metric: "lcp", value: 1, route: "" }] }),
    ).rejects.toThrow();
    await expect(
      caller.report({ samples: [{ metric: "lcp", value: 1, route: "/" + "a".repeat(200) }] }),
    ).rejects.toThrow();
  });

  it("reject batch rỗng và batch > 50 mẫu", async () => {
    const caller = makeCaller();
    await expect(caller.report({ samples: [] })).rejects.toThrow();
    const tooMany = Array.from({ length: 51 }, () => ({ ...validSample }));
    await expect(caller.report({ samples: tooMany })).rejects.toThrow();
  });
});

describe("normalizeRumRouteLabel — chống nổ cardinality", () => {
  it("bỏ query/hash, thay segment số → :id, whitelist ký tự, cắt 120", () => {
    expect(normalizeRumRouteLabel("/products/123/points/456?tab=x#y")).toBe(
      "/products/:id/points/:id",
    );
    expect(normalizeRumRouteLabel("/a b<script>")).toBe("/a_b_script_");
    expect(normalizeRumRouteLabel("/" + "x".repeat(300))).toHaveLength(120);
    expect(normalizeRumRouteLabel("")).toBe("/");
  });
});

describe("throttle per-IP", () => {
  it("chặn TOO_MANY_REQUESTS sau 60 report/phút cùng IP; IP khác không bị", async () => {
    const caller = makeCaller("10.9.9.9");
    for (let i = 0; i < 60; i++) {
      await caller.report({ samples: [validSample] });
    }
    await expect(caller.report({ samples: [validSample] })).rejects.toThrow(/rate limit/i);
    // IP khác vẫn đi bình thường
    const other = makeCaller("10.9.9.10");
    await expect(other.report({ samples: [validSample] })).resolves.toEqual({ accepted: 1 });
  });
});
