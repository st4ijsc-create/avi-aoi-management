import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  // Review vòng 1 (Important): pid 100 xuất hiện ở HAI LUID (17_512_000_000 và 4_000_000) —
  // đột biến ghi-đè `byPid.set(pid, bytes)` thay vì cộng dồn `byPid.set(pid, (byPid.get(pid) ??
  // 0) + bytes)` lọt qua MỌI ca khác (chưa ca nào từng đọc GIÁ TRỊ của byPid). Ca này khẳng định
  // đúng giá trị cộng dồn — pid 200 (chỉ một LUID) đi kèm để phân biệt "cộng đúng theo PID" với
  // "vô tình cộng lẫn giữa các PID".
  it("cong DON theo PID qua nhieu LUID, khong GHI DE", () => {
    const s = parseProcessCounters(RAW, [100], 1_000)!;
    expect(s.byPid.get(100)).toBe(17_512_000_000 + 4_000_000);
    expect(s.byPid.get(200)).toBe(1_193_000_000);
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

// Review vòng 1 (Important) — ràng buộc toàn cục 8 (máy không GPU/không powershell.exe/bộ đếm
// vắng ⇒ trả null, log MỘT LẦN, không ném) chỉ được kiểm bằng đọc mã, chưa có test — theo ràng
// buộc 5 (mọi lưới an toàn phải chứng minh bằng đột biến), lưới chưa có test coi như chưa tồn
// tại. Ba kịch bản dưới đây đi qua `readProcessVram()` thật (không mock lại chính module này —
// chỉ mock phụ thuộc `node:child_process`).
//
// GOTCHA đã trả giá ở dự án này (xem vramProbe.test.ts):
//  - `vi.resetModules()` KHÔNG gỡ đăng ký `vi.doMock` — mỗi ca dưới đây tự gọi `vi.doMock` lại
//    TRƯỚC khi `import()` để không phụ thuộc mock của ca trước.
//  - `"child_process"` và `"node:child_process"` gộp về CÙNG một khoá mock trong Vitest — module
//    thật import bằng specifier `"node:child_process"`, nên mock cũng đăng ký đúng specifier đó.
//  - `warnedUnavailable` là biến module-level (không export) — `vi.resetModules()` ở `beforeEach`
//    buộc mỗi ca `import()` lại một THỂ HIỆN MODULE MỚI (biến về `false`), nếu không ca sau sẽ ăn
//    theo trạng thái "đã cảnh báo" của ca trước và phụ thuộc THỨ TỰ chạy — bộ test này chạy cả với
//    `--sequence.shuffle.tests`.
describe("readProcessVram", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("execFile loi ENOENT (khong co powershell.exe) -> tra null, KHONG nem", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error | null, s?: string) => void) =>
        cb(new Error("spawn powershell.exe ENOENT")),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readProcessVram } = await import("./vramProcessProbe");
    await expect(readProcessVram([123])).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("execFile loi TIMEOUT -> tra null, KHONG nem", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error | null, s?: string) => void) => {
        const err = new Error("Command failed") as Error & { killed?: boolean; signal?: string };
        err.killed = true;
        err.signal = "SIGTERM";
        cb(err);
      },
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readProcessVram } = await import("./vramProcessProbe");
    await expect(readProcessVram([123])).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("stdout khong phai JSON hop le -> tra null, KHONG nem", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, s: string) => void) =>
        cb(null, "{khong phai json hop le"),
    }));
    const { readProcessVram } = await import("./vramProcessProbe");
    await expect(readProcessVram([123])).resolves.toBeNull();
  });

  it("hai loi LIEN TIEP cung mot the hien module -> console.warn CHI mot lan", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error | null) => void) =>
        cb(new Error("ENOENT")),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readProcessVram } = await import("./vramProcessProbe");
    await readProcessVram([1]);
    await readProcessVram([2]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
