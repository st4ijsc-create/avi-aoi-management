import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Pha 2B Task 1 — CỔNG: nền KHÔNG được tuyên bố SẠCH khi có tàn dư của lượt chạy trước giữ GPU.
 *
 * ⚠⚠ ĐỌC TRƯỚC KHI SỬA BẤT CỨ CA NÀO — HAI LẦN ĐỊNH NGHĨA LẠI, CẢ HAI ĐỀU DO SỐ HỌC ÉP.
 *
 * **(1) "PID lạ" hẹp lại thành "MỒ CÔI".** Kế hoạch viết *"PID nào không phải tiến trình của ta ⇒
 * TỪ CHỐI"*. Đo trực tiếp trên máy này (2026-08-04, RTX 5090 / WDDM):
 *   nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
 *   → **15 dòng**: explorer.exe · ShellHost.exe · SearchHost.exe · StartMenuExperienceHost.exe ·
 *     Code.exe · msedge.exe · msedgewebview2.exe ×2 · Docker Desktop.exe · SystemSettings.exe ·
 *     ApplicationFrameHost.exe · CrossDeviceResume.exe · Display Driver.exe · ShellExperienceHost.exe
 *     · một PID `[Insufficient Permissions]`.  (used_memory = [N/A] cả 15)
 * Tập "không phải của ta" KHÔNG BAO GIỜ rỗng trên máy Windows có người dùng ⇒ nền không bao giờ
 * chụp được ⇒ `attributable` vĩnh viễn `null`.
 *
 * **(2) Hành động của cổng đổi từ "TỪ CHỐI" sang "CHỐT + ĐÁNH DẤU".** Cả (1) và (2) đều là hệ quả
 * của MỘT bất đẳng thức: `headroom = trần − max(L, A)` và `max(L, A) ≥ L` ⇒
 *
 *     attributable = null (chỉ-sổ)  ⟹  headroom = trần − L  =  CHẶN TRÊN của mọi headroom
 *
 * Nghĩa là mọi đường đẩy hệ vào `null` **không làm hệ nghiêm khắc hơn — nó làm hệ nghiêm khắc
 * BẰNG 0**. Từ chối chốt nền vì thấy mồ côi là **tự nới dư địa đúng lúc phát hiện nguy hiểm**;
 * một nền NHIỄM X vẫn cho `max(L, A)` **≥** chỉ-sổ. ⇒ Cổng giữ **TẦM NHÌN** (nêu đích danh + ghi
 * sổ + `baselineVerified: false`) và giữ luôn **CON SỐ**. Ca ★★ "CHẶT HƠN chỉ-sổ" khoá tính chất đó.
 *
 * ⚠ Ràng buộc KHÔNG đổi: **TUYỆT ĐỐI không đoán byte của hộ lạ** (ca ★★ "KHÔNG ĐOÁN BYTE").
 */

const MIB = 1024 * 1024;

// Ràng buộc toàn cục 7 — fixture đủ lớn để phân biệt: khối BỊ NUỐT cỡ 17.000 MiB.
const SWALLOWED = 17_000 * MIB; // sidecar mồ côi còn sống sau khi server khởi động lại
const DESKTOP = 1_000 * MIB; // nền THẬT của máy (compositor, trình duyệt…) — nền phải hấp thụ
const DEVICE_USED = SWALLOWED + DESKTOP; // 18.000 MiB
const CEILING = 32_607 * MIB;

type Holder = { pid: number; name: string };
function census(p: Partial<Record<"ours" | "siblings" | "orphans" | "thirdParty", Holder[]>>) {
  const ours = p.ours ?? [];
  const siblings = p.siblings ?? [];
  const orphans = p.orphans ?? [];
  const thirdParty = p.thirdParty ?? [];
  return { holders: [...ours, ...siblings, ...orphans, ...thirdParty], ours, siblings, orphans, thirdParty };
}

const DESK: Holder[] = [
  { pid: 7824, name: "C:\\Windows\\explorer.exe" },
  { pid: 19520, name: "C:\\Users\\Admin\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
  { pid: 2056, name: "[Insufficient Permissions]" },
];
const ORPHAN: Holder = { pid: 31337, name: "D:\\tools\\llama.cpp\\llama-server.exe" };
const WORKER: Holder = { pid: 4711, name: "C:\\Program Files\\nodejs\\node.exe" };

const cleanCensus = census({ thirdParty: DESK });
const orphanCensus = census({ orphans: [ORPHAN], thirdParty: DESK });

function mockEmptyLedger() {
  vi.doMock("./vramBroker", () => ({
    snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
    leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
      l.actualBytes ?? l.request.estimatedBytes,
  }));
}

function mockDevice(usedBytes: number = DEVICE_USED) {
  vi.doMock("./vramProbe", () => ({
    readDeviceVram: async () => ({ usedBytes, totalBytes: CEILING, source: "smi" }),
  }));
}

type Logged = { event: string; detail?: Record<string, unknown> };

describe("Pha 2B Task 1 — nền + tàn dư giữ GPU", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("★★★ CỔNG: tàn dư 17.000 MiB đang giữ GPU ⇒ nền VẪN chốt nhưng KHÔNG XÁC MINH, sự kiện nêu ĐÚNG TÊN", async () => {
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => orphanCensus }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");

    // ★ TẦM NHÌN: sự kiện + câu cảnh báo phải nêu ĐÚNG tên và PID — người trực phải biết xem CÁI GÌ.
    expect(await captureVramBaseline()).toBe(DEVICE_USED);
    const ev = logged.find((l) => l.event === "baseline_foreign_pid");
    expect(ev, "phải GHI SỔ — không ghi thì lỗ này vô hình như trước").toBeDefined();
    expect(JSON.stringify(ev!.detail)).toContain("llama-server.exe");
    expect(JSON.stringify(ev!.detail)).toContain("31337");
    expect(warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")).toContain("llama-server.exe");

    const r = await reconcileOnce();
    // ★ CON SỐ ĐƯỢC GIỮ (I-1): vứt nó đi là rơi về chỉ-sổ = CHẶN TRÊN của headroom = nới dư địa.
    expect(r.attributableBytes).toBe(0); // 18.000 thiết bị − 18.000 nền (nhiễm)
    // ★ …nhưng trạng thái "không biết" phải đi ra ngoài, để Task 2/5 chạy CHẶT HƠN.
    expect(r.baselineVerified).toBe(false);
  });

  it("★★ nền NHIỄM luôn CHẶT HƠN chỉ-sổ — bất đẳng thức khoá bằng SỐ, không bằng lời", async () => {
    // Đây là ca canh chính lập luận I-1. Nếu ai đó "sửa lại cho nghiêm" bằng cách trả `null` khi
    // chưa xác minh, ca này ĐỎ với đúng con số chứng minh điều ngược lại.
    mockEmptyLedger();
    mockDevice();
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => orphanCensus }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    await captureVramBaseline();
    const r = await reconcileOnce();

    const ledgerOnly = CEILING - r.ledgerTotalBytes;
    const withAttributable = CEILING - Math.max(r.ledgerTotalBytes, r.attributableBytes ?? -Infinity);
    expect(withAttributable).toBeLessThanOrEqual(ledgerOnly);
    expect(r.attributableBytes).not.toBeNull();
  });

  it("★★ KHÔNG ĐOÁN BYTE của hộ lạ: sự kiện KHÔNG chứa con số nào quy cho tàn dư", async () => {
    // ⚠ `used_memory` của nvidia-smi là `[N/A]` trên máy này ⇒ "bao nhiêu" là thứ ta KHÔNG BIẾT,
    // và phải tiếp tục không biết. Đoán rồi trừ = biến trạng thái mù CÓ TIẾNG thành số sai IM LẶNG.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => orphanCensus }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();

    const ev = logged.find((l) => l.event === "baseline_foreign_pid")!;
    expect(JSON.stringify(ev.detail)).not.toContain(String(SWALLOWED));
    for (const key of Object.keys(ev.detail ?? {})) {
      expect(key, "không được có trường byte quy cho hộ lạ").not.toMatch(/orphan.*bytes|foreign.*bytes|assumed/i);
    }
  });

  it("★ MÙ PHẢI CÓ TIẾNG: quét hộ giữ GPU KHÔNG dùng được ⇒ nền vẫn chốt, verified=false, số vẫn giữ", async () => {
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => null }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);

    const ev = logged.find((l) => l.event === "baseline")!;
    expect(ev.detail!.baselineVerified).toBe(false);
    expect(warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")).toMatch(/CHƯA XÁC MINH/i);

    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(DEVICE_USED);
    expect(r.attributableBytes).toBe(0); // vẫn dùng được — xem ca ★★ bất đẳng thức
    expect(r.baselineVerified).toBe(false);
  });

  it("★ desktop (explorer/Code/Edge) KHÔNG phải tàn dư ⇒ nền XÁC MINH ĐƯỢC, sự kiện ghi lại từng hộ", async () => {
    // ⚠ Bằng chứng chống lại bản đọc nguyên văn "PID nào không phải của ta ⇒ từ chối": trên máy đo
    // được, danh sách luôn có ≥15 hộ như thế.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => cleanCensus }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);

    const ev = logged.find((l) => l.event === "baseline")!;
    expect(ev.detail!.baselineVerified).toBe(true);
    expect(JSON.stringify(ev.detail!.gpuHolders)).toContain("explorer.exe");
    expect(logged.some((l) => l.event === "baseline_foreign_pid")).toBe(false);

    const r = await reconcileOnce();
    expect(r.baselineVerified).toBe(true);
    expect(r.attributableBytes).toBe(0);
  });

  it("★★★ C-1: vai trò ANH EM (api ⇄ worker) đang sống ⇒ nền VẪN XÁC MINH ĐƯỢC, KHÔNG ai bị vu là tàn dư", async () => {
    // `package.json`: `start` = node dist/index.js, `start:worker` = node dist/worker.js ⇒ hai tiến
    // trình ANH EM, và cả hai vai trò đều gọi `startVramReconciler()`. Nếu anh em bị xếp `orphans`,
    // mỗi vai trò sẽ đánh dấu nền KHÔNG XÁC MINH VĨNH VIỄN và bảo người trực tắt tiến trình sản
    // xuất của vai trò kia.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => census({ siblings: [WORKER], thirdParty: DESK }),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);
    const r = await reconcileOnce();

    expect(r.baselineVerified).toBe(true); // ★ KHÔNG bị hạ cấp vì có anh em
    expect(logged.some((l) => l.event === "baseline_foreign_pid")).toBe(false); // ★ KHÔNG cáo buộc
    expect(warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")).not.toMatch(/tàn dư|Stop-Process/i);
    // …nhưng anh em VẪN phải xuất hiện trong nhật ký: byte của chúng là của HỆ NÀY, chỉ nằm ở sổ khác.
    const ev = logged.find((l) => l.event === "baseline")!;
    expect(JSON.stringify((ev.detail!.gpuHolders as Record<string, unknown>).siblings)).toContain("4711");
  });

  it("hậu duệ CỦA TA đang giữ GPU (sidecar còn sống, cùng cây) ⇒ KHÔNG phải tàn dư", async () => {
    mockEmptyLedger();
    mockDevice();
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => census({ ours: [{ pid: 4242, name: "D:\\tools\\llama.cpp\\llama-server.exe" }] }),
    }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);
    expect((await reconcileOnce()).baselineVerified).toBe(true);
  });

  it("★★ I-1 TỰ LÀNH: tàn dư rời GPU ⇒ nền NHIỄM bị HUỶ và chụp lại ĐÚNG (không kẹt vĩnh viễn)", async () => {
    // ⚠ VÌ SAO CA NÀY LÀ BẮT BUỘC: `baselineCaptured` là cờ MỘT CHIỀU. Chốt một nền nhiễm mà không
    // có lối thoát thì khi mồ côi chết, `attributable = thiết bị − nền` tụt ÂM đúng bằng khối đó ⇒
    // chuông kêu mỗi 60 giây MÃI MÃI — đúng thứ Pha 1 dựng nền để tránh.
    let orphanAlive = true;
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: () => 0,
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({
        usedBytes: orphanAlive ? DEVICE_USED : DESKTOP,
        totalBytes: CEILING,
        source: "smi",
      }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => (orphanAlive ? orphanCensus : cleanCensus),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED); // nền NHIỄM, chưa xác minh
    expect((await reconcileOnce()).baselineVerified).toBe(false);

    orphanAlive = false;
    // ★ Nền ĐÚNG = 1.000 MiB (desktop), KHÔNG phải 18.000 MiB đã nhiễm, và nay XÁC MINH ĐƯỢC.
    expect(await captureVramBaseline()).toBe(DESKTOP);
    const healed = await reconcileOnce();
    expect(healed.baselineUsedBytes).toBe(DESKTOP);
    expect(healed.baselineVerified).toBe(true);
    expect(healed.driftBytes).toBe(0); // KHÔNG còn khoản âm 17.000 MiB giả
  });

  it("★★ QUÉT phải chạy TRƯỚC lượt đọc thiết bị — nếu ngược, một tàn dư chết giữa hai bước sẽ được đóng dấu 'đã xác minh'", async () => {
    // ⚠ Ca này sinh ra từ NGHIỆM THU SỐNG, không phải từ suy đoán. Thứ tự ngược (đọc thiết bị →
    // quét) tạo một cửa sổ đua chiều NGUY HIỂM: số thiết bị VẪN chứa byte của tàn dư, lượt quét đã
    // báo sạch ⇒ ghim nền NHIỄM và đóng dấu `verified: true`. Một con số sai được TIN tệ hơn hẳn
    // một con số sai bị gắn cờ. Thứ tự đúng đẩy cửa sổ đua sang chiều bi quan (tự lành nhịp sau).
    const order: string[] = [];
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }), leaseBytes: () => 0 }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => {
        order.push("device");
        return { usedBytes: DEVICE_USED, totalBytes: CEILING, source: "smi" };
      },
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => {
        order.push("scan");
        return cleanCensus;
      },
    }));

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();
    expect(order).toEqual(["scan", "device"]);
  });

  it("nền ĐÃ XÁC MINH thì KHÔNG quét lại ở mỗi nhịp (chi phí nvidia-smi chỉ trả một lần)", async () => {
    mockEmptyLedger();
    mockDevice();
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    let scans = 0;
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => {
        scans++;
        return cleanCensus;
      },
    }));

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();
    await captureVramBaseline();
    await captureVramBaseline();
    expect(scans).toBe(1);
  });
});

describe("vramGpuHolders — phân loại tiến trình đang giữ GPU (hàm THUẦN, không I/O)", () => {
  beforeEach(() => {
    // ⚠ `vi.doMock()` của nhóm ca TRÊN sống tới hết FILE — `vi.resetModules()` chỉ xoá bộ nhớ đệm
    // module, KHÔNG xoá đăng ký mock. Không gỡ ở đây thì `import("./vramGpuHolders")` dưới đây trả
    // về bản GIẢ (chỉ có `readGpuHolders`) và cả nhóm ca này đỏ với lý do chẳng liên quan gì —
    // đúng loại "test hỏng vì file, không vì mã" khó truy nhất khi chạy `--sequence.shuffle.tests`.
    vi.doUnmock("./vramGpuHolders");
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.VRAM_GPU_HOLDER_SCAN = "off";
  });

  it("parseComputeApps đọc ĐÚNG dạng CSV đo được của nvidia-smi (kể cả [Insufficient Permissions])", async () => {
    const { parseComputeApps } = await import("./vramGpuHolders");
    const raw =
      "2056, [Insufficient Permissions]\r\n" +
      "7824, C:\\Windows\\explorer.exe\r\n" +
      "19388, C:\\Program Files\\Display Driver\\Display Driver.exe\r\n" +
      "\r\n";
    expect(parseComputeApps(raw)).toEqual([
      { pid: 2056, name: "[Insufficient Permissions]" },
      { pid: 7824, name: "C:\\Windows\\explorer.exe" },
      { pid: 19388, name: "C:\\Program Files\\Display Driver\\Display Driver.exe" },
    ]);
  });

  it("parseComputeApps bỏ HEADER khi ai đó quên --format=csv,noheader", async () => {
    const { parseComputeApps } = await import("./vramGpuHolders");
    expect(parseComputeApps("pid, process_name\n7824, C:\\Windows\\explorer.exe\n")).toEqual([
      { pid: 7824, name: "C:\\Windows\\explorer.exe" },
    ]);
  });

  it("★★ desktop ⇒ thirdParty (KHÔNG cáo buộc); ảnh thực thi CỦA TA ngoài cây ⇒ TÀN DƯ", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [
        { pid: 7824, name: "C:\\Windows\\explorer.exe" },
        { pid: 31337, name: "D:\\tools\\llama.cpp\\llama-server.exe" }, // tàn dư: đúng bin của ta
        { pid: 4242, name: "D:\\tools\\llama.cpp\\llama-server.exe" }, // hậu duệ ⇒ của ta
        { pid: 100, name: "C:\\Program Files\\nodejs\\node.exe" }, // CHÍNH ta
      ],
      procs: [
        { pid: 100, ppid: 50, cmdline: "" },
        { pid: 50, ppid: 20, cmdline: "" }, // npm/supervisor
        { pid: 4242, ppid: 100, cmdline: "" },
        { pid: 31337, ppid: 9999, cmdline: "" }, // cha đã chết ⇒ không chung neo với ta
        { pid: 7824, ppid: 1000, cmdline: "" },
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.orphans.map((h) => h.pid)).toEqual([31337]);
    expect(c.ours.map((h) => h.pid).sort()).toEqual([100, 4242]);
    expect(c.thirdParty.map((h) => h.pid)).toEqual([7824]);
    expect(c.siblings).toEqual([]);
  });

  it("★★★ C-1: ANH EM cùng người giám sát (chung cha còn sống) ⇒ siblings, KHÔNG phải tàn dư", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [
        { pid: 100, name: "C:\\Program Files\\nodejs\\node.exe" }, // api = CHÍNH ta
        { pid: 200, name: "C:\\Program Files\\nodejs\\node.exe" }, // worker = ANH EM
        { pid: 300, name: "C:\\Program Files\\nodejs\\node.exe" }, // tàn dư lượt TRƯỚC (cha đã chết)
      ],
      procs: [
        { pid: 50, ppid: 20, cmdline: "npm run start" }, // người giám sát CHUNG, còn sống
        { pid: 100, ppid: 50, cmdline: "node dist/index.js" },
        { pid: 200, ppid: 50, cmdline: "node dist/worker.js" },
        { pid: 300, ppid: 60001, cmdline: "node dist/worker.js" }, // ppid không tồn tại trong bảng
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.siblings.map((h) => h.pid)).toEqual([200]); // ★ anh em SỐNG — không được cáo buộc
    expect(c.orphans.map((h) => h.pid)).toEqual([300]); // ★ tàn dư thật vẫn bị bắt
    expect(c.ours.map((h) => h.pid)).toEqual([100]);
  });

  it("★★ I-3: `python.exe` CỦA NGƯỜI KHÁC KHÔNG bị nhận vơ, dù LOCAL_TRAINER_CMD khai `python …`", async () => {
    // Bản đầu so khớp TÊN FILE TRẦN ⇒ mọi python.exe giữ GPU bị vu là mồ côi của ta ⇒ chẩn đoán
    // sai + bảo người trực giết job của người khác.
    const prev = process.env.LOCAL_TRAINER_CMD;
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    try {
      const { classifyHolders, ownExecutablePaths, ownCommandSignatures } = await import("./vramGpuHolders");
      expect(ownExecutablePaths(), "lệnh trần KHÔNG được vào danh sách ảnh thực thi").not.toContain("python");
      const c = classifyHolders({
        holders: [{ pid: 777, name: "C:\\Python312\\python.exe" }],
        procs: [{ pid: 777, ppid: 9999, cmdline: "python C:\\ai-cua-nguoi-khac\\train.py" }],
        roots: [100],
        ownExecutables: ownExecutablePaths(),
        appRoot: "D:\\SOURCES\\avi-aoi-management",
        commandSignatures: ownCommandSignatures(),
      });
      expect(c.orphans).toEqual([]);
      expect(c.thirdParty.map((h) => h.pid)).toEqual([777]);
    } finally {
      if (prev === undefined) delete process.env.LOCAL_TRAINER_CMD;
      else process.env.LOCAL_TRAINER_CMD = prev;
    }
  });

  it("★★ I-3 bù: trainer CỦA TA (python trần) VẪN bị bắt qua dòng lệnh — chữ ký lệnh + thư mục ứng dụng", async () => {
    const prev = process.env.LOCAL_TRAINER_CMD;
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    try {
      const { classifyHolders, ownExecutablePaths, ownCommandSignatures } = await import("./vramGpuHolders");
      const c = classifyHolders({
        holders: [
          { pid: 778, name: "C:\\Python312\\python.exe" }, // khớp CHỮ KÝ LỆNH
          { pid: 779, name: "C:\\Python312\\python.exe" }, // khớp THƯ MỤC ỨNG DỤNG trong dòng lệnh
        ],
        procs: [
          { pid: 778, ppid: 9999, cmdline: "python tools/trainer/train.py D:\\x\\jobs\\7" },
          { pid: 779, ppid: 9999, cmdline: "python x.py D:\\SOURCES\\avi-aoi-management\\uploads\\training\\jobs\\7" },
        ],
        roots: [100],
        ownExecutables: ownExecutablePaths(),
        appRoot: "D:\\SOURCES\\avi-aoi-management",
        commandSignatures: ownCommandSignatures(),
      });
      expect(c.orphans.map((h) => h.pid).sort()).toEqual([778, 779]);
    } finally {
      if (prev === undefined) delete process.env.LOCAL_TRAINER_CMD;
      else process.env.LOCAL_TRAINER_CMD = prev;
    }
  });

  it("ảnh thực thi nằm TRONG thư mục ứng dụng mà ngoài cây ⇒ TÀN DƯ (venv python, tool đóng gói)", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [{ pid: 555, name: "D:\\SOURCES\\avi-aoi-management\\.venv\\Scripts\\python.exe" }],
      procs: [{ pid: 555, ppid: 9999, cmdline: "" }],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.orphans.map((h) => h.pid)).toEqual([555]);
  });

  it("so khớp ảnh thực thi KHÔNG phân biệt hoa/thường và dấu gạch (Windows)", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [{ pid: 31337, name: "d:/tools/llama.cpp/LLAMA-SERVER.EXE" }],
      procs: [{ pid: 31337, ppid: 9999, cmdline: "" }],
      roots: [100],
      ownExecutables: ["D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.orphans.map((h) => h.pid)).toEqual([31337]);
  });

  it("★ M-2: parseProcTable phân biệt 'RỖNG' với 'KHÔNG PARSE ĐƯỢC'", async () => {
    const { parseProcTable } = await import("./vramGpuHolders");
    expect(parseProcTable("khong-phai-json"), "hỏng ⇒ null").toBeNull();
    expect(parseProcTable("[]"), "rỗng hợp lệ ⇒ mảng rỗng, KHÔNG phải null").toEqual([]);
    // `ConvertTo-Json` trả OBJECT khi chỉ có một phần tử.
    expect(parseProcTable('{"pid":4,"ppid":0,"cmd":"x"}')).toEqual([{ pid: 4, ppid: 0, cmdline: "x" }]);
  });

  it("★ M-3: nền tảng KHÔNG phải Windows ⇒ trả null NGAY, KHÔNG gọi powershell/nvidia-smi", async () => {
    let goi = 0;
    vi.doMock("node:child_process", () => ({ execFile: () => { goi++; } }));
    const desc = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.VRAM_GPU_HOLDER_SCAN = "on";
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { readGpuHolders } = await import("./vramGpuHolders");
      await expect(readGpuHolders([process.pid])).resolves.toBeNull();
      expect(goi).toBe(0);
    } finally {
      Object.defineProperty(process, "platform", desc);
    }
  });

  it("công tắc VRAM_GPU_HOLDER_SCAN=off ⇒ trả null NGAY, KHÔNG sinh tiến trình con", async () => {
    let goi = 0;
    vi.doMock("node:child_process", () => ({ execFile: () => { goi++; } }));
    process.env.VRAM_GPU_HOLDER_SCAN = "off";
    const { readGpuHolders } = await import("./vramGpuHolders");
    await expect(readGpuHolders([process.pid])).resolves.toBeNull();
    expect(goi).toBe(0);
  });

  it("nvidia-smi lỗi/vắng ⇒ trả null, KHÔNG NÉM (máy không GPU vẫn chạy)", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error | null, s?: string) => void) =>
        cb(new Error("spawn nvidia-smi ENOENT")),
    }));
    process.env.VRAM_GPU_HOLDER_SCAN = "on";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { readGpuHolders } = await import("./vramGpuHolders");
    await expect(readGpuHolders([process.pid])).resolves.toBeNull();
  });
});

describe("I-2 — lưới: mọi biến môi trường khai ẢNH THỰC THI phải được cổng nền biết tới", () => {
  /**
   * ⚠⚠ VÌ SAO LƯỚI NÀY TỒN TẠI: `WHISPER_BIN` ĐÃ LỌT khỏi bản đầu của `ownExecutablePaths()`.
   * whisper.cpp dựng với CUDA là hộ tiêu thụ THẬT (chính `vramAllocationSites.ts` gọi tên nó như
   * vậy), `wired:false`, đường dẫn `C:/tools/…` NGOÀI thư mục ứng dụng nên lưới `appRoot` không
   * đỡ, và nó cách một dấu `#` trong `.env` với `VIDEO_INGEST_ENABLED=true` ngay trên.
   *
   * Bảng `KNOWN_ALLOCATION_SITES` đã nêu ĐÍCH DANH các biến đó trong `note` ⇒ đối chiếu được BẰNG
   * MÁY. Thêm một hộ tiêu thụ mới mà quên khai vào `OWN_EXECUTABLE_ENV_VARS` ⇒ ca này ĐỎ.
   * Loại trừ phải khai TƯỜNG MINH kèm lý do — im lặng bỏ qua là đúng lớp lỗi đang vá.
   */
  // ⚠ BẮT BUỘC, VÀ `--sequence.shuffle.tests` ĐÃ BẮT ĐƯỢC LÚC THIẾU: `vi.doMock("./vramGpuHolders")`
  // của nhóm ca ĐẦU sống tới hết FILE, nên khi nhóm này chạy TRƯỚC nhóm "hàm thuần" (thứ tự xáo),
  // `import("./vramGpuHolders")` trả về bản GIẢ và `OWN_EXECUTABLE_ENV_VARS` là `undefined` ⇒ hai
  // ca dưới đỏ vì lý do chẳng liên quan. `vi.resetModules()` KHÔNG xoá đăng ký mock — phải `doUnmock`.
  beforeEach(() => {
    vi.doUnmock("./vramGpuHolders");
    vi.resetModules();
  });

  const EXCLUDED: Record<string, string> = {
    PDFTOPPM_BIN: "poppler/pdftoppm — kết xuất ảnh CHẠY CPU, không chạm GPU (bảng: 'KHÔNG chạm GPU').",
    APS_SOLVER_CMD: "CP-SAT solver tổ hợp — bảng ghi rõ 'CHẠY CPU — KHÔNG phải hộ VRAM'.",
    LLAMA_CODER_BIN:
      "KHÔNG có điểm gọi nào trong repo sinh tiến trình này — bảng ghi 'cấu hình cho một tiến trình mà mã " +
      "không biết tới'. Người vận hành tự chạy thì nó là hộ của NGƯỜI KHÁC ⇒ đúng ngữ nghĩa thirdParty.",
  };

  it("★★ không biến *_BIN/*_CMD nào trong KNOWN_ALLOCATION_SITES bị bỏ quên", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "vramAllocationSites.ts"), "utf8");
    const named = new Set(src.match(/[A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)*_(?:BIN|CMD)\b/g) ?? []);
    expect(named.size, "bảng phải nêu đích danh ít nhất vài biến — nếu ít hơn thì regex đã mục").toBeGreaterThan(3);

    const { OWN_EXECUTABLE_ENV_VARS } = await import("./vramGpuHolders");
    const covered = new Set<string>(OWN_EXECUTABLE_ENV_VARS);
    const forgotten = [...named].filter((v) => !covered.has(v) && !(v in EXCLUDED)).sort();

    expect(
      forgotten,
      "Có biến môi trường khai ảnh thực thi mà cổng nền KHÔNG biết tới.\n" +
        "Mồ côi của hộ đó sẽ VÔ HÌNH: nền nuốt trọn byte của nó mà không ai được báo.\n" +
        "Thêm vào OWN_EXECUTABLE_ENV_VARS (vramGpuHolders.ts), HOẶC khai vào EXCLUDED ở ca test này\n" +
        "kèm LÝ DO vì sao nó không thể là hộ tiêu thụ VRAM.\n" +
        `Bỏ quên: ${forgotten.join(", ")}`,
    ).toEqual([]);
  });

  it("WHISPER_BIN — ca hồi quy cho đúng hộ đã lọt ở bản đầu", async () => {
    const { OWN_EXECUTABLE_ENV_VARS } = await import("./vramGpuHolders");
    expect(OWN_EXECUTABLE_ENV_VARS).toContain("WHISPER_BIN");
  });

  it("mọi mục EXCLUDED phải THẬT SỰ có mặt trong bảng (danh sách loại trừ không được mục)", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "vramAllocationSites.ts"), "utf8");
    for (const key of Object.keys(EXCLUDED)) {
      expect(src.includes(key), `${key} không còn trong bảng — gỡ nó khỏi EXCLUDED`).toBe(true);
    }
  });
});
