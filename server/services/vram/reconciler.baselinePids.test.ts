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
function census(p: Partial<Record<"ours" | "peers" | "orphans" | "thirdParty", Holder[]>>) {
  const ours = p.ours ?? [];
  const peers = p.peers ?? [];
  const orphans = p.orphans ?? [];
  const thirdParty = p.thirdParty ?? [];
  return { holders: [...ours, ...peers, ...orphans, ...thirdParty], ours, peers, orphans, thirdParty };
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

  it("★★★ C-1+(A): vai trò ANH EM đang sống ⇒ KHÔNG ai bị vu là tàn dư, NHƯNG nền vẫn CHƯA XÁC MINH", async () => {
    // `package.json`: `start` = node dist/index.js, `start:worker` = node dist/worker.js ⇒ hai tiến
    // trình ANH EM, và cả hai vai trò đều gọi `startVramReconciler()`. Nếu anh em bị xếp `orphans`,
    // mỗi vai trò sẽ đánh dấu nền KHÔNG XÁC MINH VĨNH VIỄN và bảo người trực tắt tiến trình sản
    // xuất của vai trò kia.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => census({ peers: [WORKER], thirdParty: DESK }),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);
    const r = await reconcileOnce();

    // ★★ (A) — mã của hệ nằm NGOÀI cây tiến trình thì nền KHÔNG được đóng dấu TIN, kể cả khi đó là
    // anh em đang phục vụ: byte của anh em nằm ở sổ KHÁC (sổ chung là Pha 3) nên nền vẫn có thể đã
    // nuốt chúng. Đây là chỗ lỗ (A) bị đóng bằng CẤU TRÚC thay vì bằng độ chính xác của vị từ.
    expect(r.baselineVerified).toBe(false);
    // ★★★ …nhưng TUYỆT ĐỐI không được cáo buộc nó là tàn dư, và không được khuyên tắt.
    const warns = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(warns).toMatch(/VAI TRÒ ANH EM/);
    expect(warns).toMatch(/ĐỪNG TẮT/);
    expect(warns).not.toMatch(/TÀN DƯ/);
    const ev = logged.find((l) => l.event === "baseline_foreign_pid")!;
    expect(ev.detail!.orphanHolders).toEqual([]); // không ai bị xếp nhầm vào ngăn "tắt được"
    expect(JSON.stringify(ev.detail!.peerHolders)).toContain("4711");
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


  /**
   * ★★★ N-1 (re-review vòng 1) — LỖI DO CHÍNH BẢN VÁ I-1 ĐẺ RA.
   *
   * Bản trước VỨT nền ngay khi thấy "đã sạch", rồi mới đi qua hai lá chắn hoãn. Nếu một lá chắn
   * chặn (còn giấy phép ĐANG NẠP — ttl `sidecar:local-trainer` tới **2 GIỜ**), hàm `return null` ⇒
   * `attributableBytes` thành `null` ⇒ **rơi thẳng về chỉ-sổ, tức CHẶN TRÊN** — đúng thứ I-1 vừa
   * sửa để tránh, chỉ khác cửa vào.
   *
   * ⚠ Ca `TỰ LÀNH` phía trên dùng SỔ RỖNG nên KHÔNG phủ được lối này — re-review chỉ ra đúng chỗ
   * đó. Ca này dùng sổ CÓ một giấy phép đang nạp.
   */
  it("★★★ N-1: tàn dư rời GPU nhưng còn giấy phép ĐANG NẠP ⇒ GIỮ nền cũ, TUYỆT ĐỐI không rơi về null", async () => {
    let orphanAlive = true;
    let loading = false;
    const acquiredAt = new Date();
    const pendingLease = {
      id: "lease-trainer",
      request: {
        owner: "sidecar:local-trainer",
        kind: "external-process",
        estimatedBytes: 4_000 * MIB,
        priority: "background",
      },
      acquiredAt,
      actualBytes: null, // ĐANG NẠP ⇒ `holdsUncommittedBytes()` ⇒ lá chắn HOÃN bật
      measureFailed: false,
      lastHeartbeatAt: acquiredAt,
      released: false,
    };
    vi.doMock("./vramBroker", () => ({
      snapshot: () =>
        loading
          ? { totalReservedBytes: 4_000 * MIB, leases: [pendingLease] }
          : { totalReservedBytes: 0, leases: [] },
      leaseBytes: () => 4_000 * MIB,
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

    // Tàn dư chết, NHƯNG đúng lúc một sidecar đang nạp ⇒ lá chắn HOÃN chặn lượt chụp lại.
    orphanAlive = false;
    loading = true;
    const kept = await captureVramBaseline();
    expect(kept, "PHẢI giữ nền cũ — trả null là rơi về chỉ-sổ, tức nới dư địa").toBe(DEVICE_USED);
    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(DEVICE_USED);
    expect(r.attributableBytes, "TUYỆT ĐỐI không được null ở đây").not.toBeNull();

    // Sidecar nạp xong ⇒ nhịp sau mới thật sự chụp lại được.
    loading = false;
    expect(await captureVramBaseline()).toBe(DESKTOP);
    expect((await reconcileOnce()).baselineVerified).toBe(true);
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
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 200 },
        { pid: 50, ppid: 20, cmdline: "npm run start", ctime: 100 },
        { pid: 4242, ppid: 100, cmdline: "llama-server --port 8081", ctime: 300 },
        { pid: 31337, ppid: 9999, cmdline: "llama-server --port 8081", ctime: 50 }, // cha đã chết
        { pid: 7824, ppid: 1000, cmdline: "explorer.exe", ctime: 10 },
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.orphans.map((h) => h.pid)).toEqual([31337]);
    expect(c.ours.map((h) => h.pid).sort()).toEqual([100, 4242]);
    expect(c.thirdParty.map((h) => h.pid)).toEqual([7824]);
    expect(c.peers).toEqual([]);
  });

  /**
   * ★★★ (D) re-review vòng 1 — TOPOLOGY THẬT MÀ TÀI LIỆU CỦA DỰ ÁN CHỈ ĐỊNH.
   *
   * `backgroundJobs.ts` ghi chính thức "run `npm run start:worker` alongside", và `package.json`
   * bọc mỗi vai trò trong `cross-env`; `npm run` còn chèn `cmd.exe` + `npm-cli.js`. Neo tổ tiên
   * chung vì thế nằm ở ĐỘ SÂU 3-5 — cơ chế cũ (`ANCESTOR_DEPTH = 2`) trượt và vu cho anh em ĐANG
   * SỐNG là tàn dư. Bảng dưới dựng ĐÚNG chuỗi đó, và còn tách hẳn hai nhánh (đúng ca "hai
   * terminal") để chứng minh vị từ MỚI không phụ thuộc neo chung nữa.
   */
  it("★★★ C-1/(D): chuỗi npm → cmd → cross-env → node (sâu 4, KHÔNG neo chung) vẫn nhận ra ANH EM", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [
        { pid: 100, name: "C:\\Program Files\\nodejs\\node.exe" }, // api = CHÍNH ta
        { pid: 200, name: "C:\\Program Files\\nodejs\\node.exe" }, // worker = ANH EM (sâu 4)
        { pid: 300, name: "C:\\Program Files\\nodejs\\node.exe" }, // TÀN DƯ: không mang điểm vào
      ],
      procs: [
        { pid: 10, ppid: 4, cmdline: "C:\\Windows\\explorer.exe", ctime: 1 },
        // nhánh api
        { pid: 40, ppid: 10, cmdline: "cmd.exe /c npm run start", ctime: 10 },
        { pid: 45, ppid: 40, cmdline: "node npm-cli.js run start", ctime: 11 },
        { pid: 48, ppid: 45, cmdline: "cross-env NODE_ENV=production node dist/index.js", ctime: 12 },
        { pid: 100, ppid: 48, cmdline: "node dist/index.js", ctime: 13 },
        // nhánh worker — người giám sát KHÁC ở tầng trên, đúng ca "hai terminal riêng"
        { pid: 60, ppid: 10, cmdline: "cmd.exe /c npm run start:worker", ctime: 20 },
        { pid: 65, ppid: 60, cmdline: "node npm-cli.js run start:worker", ctime: 21 },
        { pid: 68, ppid: 65, cmdline: "cross-env NODE_ENV=production node dist/worker.js", ctime: 22 },
        { pid: 200, ppid: 68, cmdline: "node dist/worker.js", ctime: 23 },
        // tàn dư lượt trước: cha đã chết, dòng lệnh KHÔNG mang điểm vào vai trò
        { pid: 300, ppid: 60001, cmdline: "node D:\\SOURCES\\avi-aoi-management\\tools\\x.js", ctime: 5 },
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.peers.map((h) => h.pid)).toEqual([200]); // ★ anh em SỐNG — không được cáo buộc
    expect(c.orphans.map((h) => h.pid)).toEqual([300]); // ★ tàn dư thật vẫn bị bắt
    expect(c.ours.map((h) => h.pid)).toEqual([100]);
  });

  /**
   * ★★★ RÀNG BUỘC VỊ TỪ Ở **CHIỀU NỚI** — thứ re-review đòi và bản trước không có.
   * Ai cho "chạy `process.execPath` ngoài cây ⇒ anh em" (bỏ đòi hỏi ĐIỂM VÀO) thì ca này ĐỎ: một
   * sidecar mất chủ được miễn tội, và người trực mất luôn lời khuyên duy nhất đúng.
   */
  it("★★★ CHIỀU NỚI: hộ chạy mã của ta nhưng KHÔNG mang điểm vào vai trò ⇒ TÀN DƯ, không được thành anh em", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [{ pid: 31337, name: "D:\\tools\\llama.cpp\\llama-server.exe" }],
      procs: [
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 100 },
        { pid: 31337, ppid: 60001, cmdline: "llama-server -m model.gguf", ctime: 50 },
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.orphans.map((h) => h.pid)).toEqual([31337]);
    expect(c.peers).toEqual([]);
  });

  /**
   * ★★★ (A) re-review vòng 1 — PID ĐƯỢC CẤP LẠI: `ppid` trùng số KHÔNG phải bằng chứng cha-con.
   * Reviewer chạy thật vị từ cũ và nó cho `orphans=[] peers=[300]` — một tàn dư THẬT được miễn tội
   * đúng trong vòng lặp kill→restart, tức đúng lúc cổng này sinh ra để bắt.
   * `ctime(cha) ≤ ctime(con)` là thứ duy nhất phân biệt được, và ba nhánh dưới khoá cả ba ca.
   */
  it("★★★ (A) PID CẤP LẠI: cha trẻ hơn con ⇒ KHÔNG được nhận là con của vai trò", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const base = {
      holders: [{ pid: 300, name: "D:\\tools\\llama.cpp\\llama-server.exe" }],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    };
    // Cha khai báo (worker pid 200) SINH SAU con (pid 300) ⇒ số 200 kia là PID ĐƯỢC CẤP LẠI.
    const reused = classifyHolders({
      ...base,
      procs: [
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 10 },
        { pid: 200, ppid: 60, cmdline: "node dist/worker.js", ctime: 900 },
        { pid: 300, ppid: 200, cmdline: "llama-server -m model.gguf", ctime: 100 },
      ],
    });
    expect(reused.orphans.map((h) => h.pid), "cha trẻ hơn con ⇒ tàn dư").toEqual([300]);
    expect(reused.peers).toEqual([]);

    // Cha sinh TRƯỚC con ⇒ quan hệ thật ⇒ sidecar của một vai trò đang sống, ĐỪNG tắt.
    const real = classifyHolders({
      ...base,
      procs: [
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 10 },
        { pid: 200, ppid: 60, cmdline: "node dist/worker.js", ctime: 100 },
        { pid: 300, ppid: 200, cmdline: "llama-server -m model.gguf", ctime: 900 },
      ],
    });
    expect(real.peers.map((h) => h.pid)).toEqual([300]);
    expect(real.orphans).toEqual([]);

    // KHÔNG đọc được mốc tạo (thiếu quyền) ⇒ KHÔNG có bằng chứng ⇒ không cấp tư cách anh em.
    const unknown = classifyHolders({
      ...base,
      procs: [
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 10 },
        { pid: 200, ppid: 60, cmdline: "node dist/worker.js", ctime: 0 },
        { pid: 300, ppid: 200, cmdline: "llama-server -m model.gguf", ctime: 0 },
      ],
    });
    expect(unknown.orphans.map((h) => h.pid)).toEqual([300]);
  });


  /**
   * ★★★ (A) MỞ RỘNG — PID CẤP LẠI ĐÁNH LỪA CẢ NGĂN `ours`, VÀ ĐÓ LÀ CHỖ NGUY HIỂM NHẤT.
   *
   * Reviewer chỉ ra ca "tàn dư → anh em". Khi viết ca đó tôi tìm ra ca NẶNG HƠN: nếu `ppid` được
   * cấp lại trùng đúng PID của TIẾN TRÌNH NÀY, `collectDescendants()` xếp tàn dư vào `ours` —
   * và `ours` **KHÔNG tắt cờ `baselineVerified`**, cũng **không có ngăn nào để lộ ra**. Nền nhiễm
   * được TIN, im lặng, vĩnh viễn. Đây chính là lối hỏng (A) mô tả, ở cửa mà không ai canh.
   *
   * `pruneUnprovenParentLinks()` cắt liên kết đó TRƯỚC khi dựng cây; ca này khoá nó.
   */
  it("★★★ (A) ours: liên kết cha-con KHÔNG có bằng chứng thời gian ⇒ KHÔNG được nhận vào cây của ta", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const args = {
      holders: [{ pid: 300, name: "D:\\tools\\llama.cpp\\llama-server.exe" }],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    };
    // Tàn dư (sinh lúc 100) mang ppid = 100 — nhưng TIẾN TRÌNH 100 CỦA TA mới sinh lúc 900.
    // Tức số 100 kia là PID của một tiến trình ĐÃ CHẾT, được cấp lại cho ta.
    const reused = classifyHolders({
      ...args,
      procs: [
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 900 },
        { pid: 300, ppid: 100, cmdline: "llama-server -m model.gguf", ctime: 100 },
      ],
    });
    expect(reused.ours, "KHÔNG được nhận vơ vào cây của ta").toEqual([]);
    expect(reused.orphans.map((h) => h.pid), "phải LỘ RA, vì `ours` không tắt cờ verified").toEqual([300]);

    // Cha sinh TRƯỚC con ⇒ quan hệ thật ⇒ đúng là hậu duệ của ta.
    const real = classifyHolders({
      ...args,
      procs: [
        { pid: 100, ppid: 50, cmdline: "node dist/index.js", ctime: 100 },
        { pid: 300, ppid: 100, cmdline: "llama-server -m model.gguf", ctime: 900 },
      ],
    });
    expect(real.ours.map((h) => h.pid)).toEqual([300]);
    expect(real.orphans).toEqual([]);
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
        procs: [{ pid: 777, ppid: 9999, cmdline: "python C:\\ai-cua-nguoi-khac\\train.py", ctime: 1 }],
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

  it("★★ m-6: dòng lệnh chỉ ĐỌC một file trong thư mục ứng dụng KHÔNG biến hộ của người khác thành của ta", async () => {
    // `cmd.includes(appRoot)` trần là biến thể HẸP của I-3: một job của người khác đọc dữ liệu
    // trong repo ta là đủ bị nhận vơ. Nay đòi đường dẫn trỏ vào thư mục ta THẬT SỰ sinh tiến trình.
    const { classifyHolders } = await import("./vramGpuHolders");
    const c = classifyHolders({
      holders: [{ pid: 888, name: "C:\\Python312\\python.exe" }],
      procs: [
        { pid: 888, ppid: 9999, cmdline: "python doc.py D:\\SOURCES\\avi-aoi-management\\data\\x.csv", ctime: 1 },
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(c.thirdParty.map((h) => h.pid)).toEqual([888]);
    expect(c.orphans).toEqual([]);
  });

  it("★★ I-3 bù: trainer CỦA TA (python trần) VẪN bị bắt qua dòng lệnh — chữ ký lệnh + thư mục job", async () => {
    const prev = process.env.LOCAL_TRAINER_CMD;
    process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
    try {
      const { classifyHolders, ownExecutablePaths, ownCommandSignatures } = await import("./vramGpuHolders");
      const c = classifyHolders({
        holders: [
          { pid: 778, name: "C:\\Python312\\python.exe" }, // khớp CHỮ KÝ LỆNH
          { pid: 779, name: "C:\\Python312\\python.exe" }, // khớp thư mục job (uploads\)
        ],
        procs: [
          { pid: 778, ppid: 9999, cmdline: "python tools/trainer/train.py D:\\x\\jobs\\7", ctime: 1 },
          {
            pid: 779,
            ppid: 9999,
            cmdline: "python x.py D:\\SOURCES\\avi-aoi-management\\uploads\\training\\jobs\\7",
            ctime: 1,
          },
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
      procs: [{ pid: 555, ppid: 9999, cmdline: "", ctime: 1 }],
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
      procs: [{ pid: 31337, ppid: 9999, cmdline: "", ctime: 1 }],
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
    expect(parseProcTable('{"pid":4,"ppid":0,"cmd":"x","ct":7}')).toEqual([{ pid: 4, ppid: 0, cmdline: "x", ctime: 7 }]);
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


  /**
   * ★★★ (D) — LƯỚI cho `ROLE_ENTRYPOINT_MARKERS`, thứ thay thế hằng số độ sâu đã bị gỡ.
   *
   * ⚠ VÌ SAO BẮT BUỘC: re-review chạy đột biến `ANCESTOR_DEPTH = 2 → 6` và `→ 1` ⇒ **0 ca đỏ cả
   * hai chiều**. Một hằng số chịu lực mà không ai canh thì coi như chưa có. Cơ chế mới không còn
   * hằng số nào, nhưng nó có một DANH SÁCH — và danh sách cũng mục y hệt nếu không ai canh: thêm
   * một vai trò vào `package.json` mà quên khai marker ⇒ vai trò đó bị vu là "tàn dư" và người
   * trực được khuyên tắt một tiến trình đang phục vụ (đúng lỗi C-1, tái sinh qua cửa khác).
   */
  it("★★★ mọi điểm vào trong package.json (start*/dev*) phải có marker trong ROLE_ENTRYPOINT_MARKERS", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "..", "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const { ROLE_ENTRYPOINT_MARKERS } = await import("./vramGpuHolders");
    const markers = ROLE_ENTRYPOINT_MARKERS.map((m) => m.toLowerCase().replace(/\\/g, "/"));

    const missing: string[] = [];
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      if (!/^(start|dev)(:|$)/.test(name)) continue;
      // Điểm vào = token cuối trông như một file .ts/.js mà lệnh đem chạy.
      const entry = cmd
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => /\.(ts|js|mjs)$/.test(t))
        .pop();
      if (!entry) continue;
      if (!markers.some((m) => entry.includes(m))) missing.push(`${name} → ${entry}`);
    }

    expect(
      missing,
      "Có vai trò trong package.json mà cổng nền KHÔNG nhận ra được.\n" +
        "Hệ quả: vai trò đó đang PHỤC VỤ nhưng bị xếp là TÀN DƯ, và người trực được khuyên tắt nó.\n" +
        "Thêm điểm vào tương ứng vào ROLE_ENTRYPOINT_MARKERS (vramGpuHolders.ts).\n" +
        `Thiếu: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("★ m-5: ảnh thực thi khai bằng TÊN TRẦN phải KÊU — khai kiểu đó không bao giờ khớp", async () => {
    // nvidia-smi luôn trả ĐƯỜNG DẪN ĐẦY ĐỦ, nên `WHISPER_BIN=whisper-cli.exe` là một khai báo VÔ
    // HÌNH: lưới I-2 vẫn thấy tên biến (nên nó im), còn cổng thì không bao giờ khớp được hộ đó.
    const prev = process.env.WHISPER_BIN;
    process.env.WHISPER_BIN = "whisper-cli.exe";
    process.env.VRAM_GPU_HOLDER_SCAN = "on";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.doMock("node:child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error | null, s?: string) => void) =>
        cb(null, "7824, C:\\Windows\\explorer.exe\n"),
    }));
    try {
      const { readGpuHolders } = await import("./vramGpuHolders");
      await readGpuHolders([process.pid]);
      const msg = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(msg).toMatch(/TÊN TRẦN/);
      expect(msg).toContain("whisper-cli.exe");
    } finally {
      warnSpy.mockRestore();
      if (prev === undefined) delete process.env.WHISPER_BIN;
      else process.env.WHISPER_BIN = prev;
    }
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
