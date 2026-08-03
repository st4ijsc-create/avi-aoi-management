import { describe, expect, it } from "vitest";
import { collectDescendants, parseProcessCounters } from "./vramProcessProbe";

const RAW = JSON.stringify({
  counters: [
    { i: "pid_100_luid_0x00000000_0x00016d43_phys_0", v: 17_512_000_000 },
    { i: "pid_200_luid_0x00000000_0x00016d43_phys_0", v: 1_193_000_000 },
    { i: "pid_300_luid_0x00000000_0x00016d43_phys_0", v: 900_000_000 },
    { i: "pid_100_luid_0x00000000_0x0000abcd_phys_0", v: 4_000_000 },
    { i: "khong-dung-dinh-dang", v: 999 },
  ],
  procs: [
    { pid: 100, ppid: 1 },
    { pid: 200, ppid: 100 },
    { pid: 300, ppid: 1 },
  ],
});

describe("collectDescendants", () => {
  it("gom con va chau, khong gom tien trinh khong lien quan", () => {
    const set = collectDescendants([{ pid: 100, ppid: 1 }, { pid: 200, ppid: 100 }, { pid: 250, ppid: 200 }, { pid: 300, ppid: 1 }], [100]);
    expect([...set].sort((a, b) => a - b)).toEqual([100, 200, 250]);
  });

  it("khong treo khi cay tien trinh co vong", () => {
    const set = collectDescendants([{ pid: 10, ppid: 11 }, { pid: 11, ppid: 10 }], [10]);
    expect([...set].sort((a, b) => a - b)).toEqual([10, 11]);
  });
});

describe("parseProcessCounters", () => {
  it("cong theo CAY tien trinh, khong chi rieng pid goc", () => {
    const s = parseProcessCounters(RAW, [100], 1_000)!;
    // 100 tren hai LUID + 200 la con cua 100; 300 KHONG thuoc cay
    expect(s.totalBytes).toBe(17_512_000_000 + 4_000_000 + 1_193_000_000);
    expect(s.byPid.get(300)).toBeUndefined();
  });

  it("giu chi tiet theo LUID de chan doan", () => {
    const s = parseProcessCounters(RAW, [100], 1_000)!;
    expect(s.byLuid.get("0x00000000_0x00016d43")).toBe(17_512_000_000 + 1_193_000_000);
    expect(s.byLuid.get("0x00000000_0x0000abcd")).toBe(4_000_000);
  });

  it("bo qua dong sai dinh dang thay vi nem", () => {
    expect(parseProcessCounters(RAW, [100], 1_000)).not.toBeNull();
  });

  it("tra null khi JSON hong", () => {
    expect(parseProcessCounters("{khong phai json", [100], 1_000)).toBeNull();
  });

  it("tra mau 0 byte khi cay tien trinh khong dung GPU", () => {
    const s = parseProcessCounters(RAW, [999], 1_000)!;
    expect(s.totalBytes).toBe(0);
  });
});
