import { describe, it, expect, beforeEach, vi } from "vitest";

// Review round 1: mock `execFile` dưới đây gọi `cb(null, { stdout })` — CHỈ một tham số
// thành công. `promisify(execFile)` (không có `[util.promisify.custom]` trên mock) resolve
// GENERIC thẳng ra giá trị đó, nên `const { stdout } = await promisify(execFile)(...)` khớp.
// Node THẬT không hoạt động vì lý do này — `execFile` thật có `promisify.custom` riêng, gọi
// callback BA tham số `(err, stdout, stderr)` rồi tự đóng gói `{ stdout, stderr }`. Mock ở
// đây khớp HÌNH DẠNG kết quả một cách tình cờ, không mô phỏng đúng cơ chế `promisify.custom`.
describe("vramProbe", () => {
  beforeEach(() => vi.resetModules());

  /**
   * ★★★ 2026-09-22 — ĐẢO HỢP ĐỒNG: `nvidia-smi` (toàn thiết bị) THẮNG native (của riêng tiến trình).
   * Ca cũ "dùng getVramState native khi có" khẳng định điều ngược lại, và điều ngược lại đã được ĐO
   * là sai: native báo 6.489 MiB khi card dùng 25.601 MiB (hiệu ≈ dấu chân model trong llama-server —
   * tiến trình KHÁC). Xem docblock `probeOnce`. Ca này là phép PHÂN BIỆT: cả hai nguồn đều sẵn, mỗi
   * nguồn một số khác nhau ⇒ kết quả phải là số của `nvidia-smi`.
   */
  it("★★★ CẢ HAI sẵn, hai số KHÁC nhau ⇒ lấy nvidia-smi (toàn thiết bị), KHÔNG lấy native (riêng tiến trình)", async () => {
    vi.doMock("./llamaHandle", () => ({
      getLlamaInstanceIfReady: () => ({ getVramState: async () => ({ used: 6489 * 1024 * 1024, total: 32607 * 1024 * 1024 }) }),
    }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
        cb(null, { stdout: "25601, 32607\n" }),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    const v = await readDeviceVram();
    expect(v!.source).toBe("smi");
    expect(v!.usedBytes).toBe(25601 * 1024 * 1024); // KHÔNG phải 6489 — số ấy là của riêng node
  });
  it("native chỉ còn là LỐI LÙI: không có nvidia-smi ⇒ mới dùng getVramState", async () => {
    vi.doMock("./llamaHandle", () => ({
      getLlamaInstanceIfReady: () => ({ getVramState: async () => ({ used: 5, total: 10 }) }),
    }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error) => void) => cb(new Error("ENOENT")),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    expect(await readDeviceVram()).toEqual({ usedBytes: 5, totalBytes: 10, source: "native" });
  });

  it("lùi về nvidia-smi khi không có native", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
        cb(null, { stdout: "1200, 32607\n" }),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    const v = await readDeviceVram();
    expect(v!.usedBytes).toBe(1200 * 1024 * 1024);
    expect(v!.totalBytes).toBe(32607 * 1024 * 1024);
    expect(v!.source).toBe("smi");
  });

  it("KHÔNG có GPU thì trả null — KHÔNG được ném", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error) => void) => cb(new Error("ENOENT")),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    expect(await readDeviceVram()).toBeNull();
  });

  it("có ĐỆM — hai lượt liên tiếp chỉ gọi nvidia-smi MỘT lần", async () => {
    const exec = vi.fn((_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: "1200, 32607\n" }));
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({ execFile: exec }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    await readDeviceVram();
    await readDeviceVram();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  // Pha 1.5 Task 1 — MỘT THƯỚC DUY NHẤT. `startVramReconciler()` chụp nền TRƯỚC khi
  // `getLlama()` gắn handle ⇒ nền đo bằng nvidia-smi, mọi phép so sau đó dùng getVramState
  // native. Hai thước lệch 165-178 MiB. Đầu dò phải khai rõ nó vừa đo bằng thước nào.
  it("báo rõ ĐÃ ĐO BẰNG THƯỚC NÀO — native (chỉ khi KHÔNG có nvidia-smi; xem đảo hợp đồng 2026-09-22)", async () => {
    vi.doMock("./llamaHandle", () => ({
      getLlamaInstanceIfReady: () => ({ getVramState: async () => ({ used: 5, total: 10 }) }),
    }));
    // ⚠ Phải mock nvidia-smi HỎNG: máy đo thật có nvidia-smi, và nay nó là nguồn CHÍNH. Bản cũ không mock
    //   ⇒ trên máy có GPU, ca này đo cả nvidia-smi thật — một lưới lệ thuộc máy chạy.
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error) => void) => cb(new Error("ENOENT")),
    }));
    const { readDeviceVramUncached } = await import("./vramProbe");
    expect((await readDeviceVramUncached())!.source).toBe("native");
  });

  it("báo rõ ĐÃ ĐO BẰNG THƯỚC NÀO — smi", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
        cb(null, { stdout: "1200, 32607\n" }),
    }));
    const { readDeviceVramUncached } = await import("./vramProbe");
    expect((await readDeviceVramUncached())!.source).toBe("smi");
  });
});
