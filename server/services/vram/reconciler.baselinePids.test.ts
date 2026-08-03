import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Pha 2B Task 1 — CỔNG CỨNG: nền TỪ CHỐI tuyên bố sạch khi có tiến trình LẠ giữ GPU.
 *
 * ⚠⚠ ĐỌC TRƯỚC KHI SỬA BẤT CỨ CA NÀO Ở ĐÂY — SỐ ĐO ĐÃ LÀM HẸP LẠI ĐỊNH NGHĨA "PID LẠ".
 *
 * Kế hoạch Pha 2B viết: *"PID nào không phải tiến trình của ta ⇒ TỪ CHỐI tuyên bố nền sạch"*.
 * Đo TRỰC TIẾP trên chính máy này (2026-08-04, RTX 5090 / WDDM), lệnh mà kế hoạch chỉ định:
 *
 *   nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
 *   → 15 dòng: explorer.exe · ShellHost.exe · SearchHost.exe · StartMenuExperienceHost.exe ·
 *     Code.exe · msedge.exe · msedgewebview2.exe ×2 · Docker Desktop.exe · SystemSettings.exe ·
 *     ApplicationFrameHost.exe · CrossDeviceResume.exe · "Display Driver.exe" ·
 *     ShellExperienceHost.exe · một PID `[Insufficient Permissions]`.  (used_memory = [N/A] cả 15)
 *
 * Tức trên máy WDDM, danh sách này KHÔNG PHẢI "các tiến trình CUDA" mà là **cả desktop**. Áp
 * nguyên văn câu trên thì tập "PID lạ" **KHÔNG BAO GIỜ rỗng** ⇒ nền **KHÔNG BAO GIỜ** chụp được
 * ⇒ (a) chuông đối chiếu của Pha 1 chết hẳn, (b) `attributable` vĩnh viễn `null` ⇒ theo §5.6c,
 * `headroom` rơi về **chỉ-sổ** — tức nhánh **RỘNG RÃI NHẤT** trong cả mô hình. Đọc nguyên văn
 * sẽ làm hệ **KÉM an toàn hơn**, không phải an toàn hơn. Bằng chứng số nằm ở ca ★ "desktop".
 *
 * ⇒ VỊ TỪ THẬT SỰ ĐƯỢC CÀI (hẹp hơn, và trúng ĐÚNG lỗ mà `vramReconciler.ts:250-257` tự khai):
 *
 *     MỒ CÔI = tiến trình đang giữ GPU mà (1) **chạy đúng thứ CHÍNH TA được cấu hình để sinh ra**
 *              (`process.execPath`, `LLAMA_SERVER_BIN`, `LOCAL_TRAINER_CMD`, `LLM_FINETUNE_CMD`,
 *              hoặc bất cứ ảnh thực thi nào nằm trong thư mục ứng dụng) VÀ (2) **KHÔNG nằm trong
 *              cây tiến trình của ta**.
 *
 * Đó CHÍNH LÀ ca mà khối chú thích tự khai mô tả: server khởi động lại trong khi sidecar thị giác
 * 7,8 GB còn sống ⇒ khối đó bị NUỐT vào nền và không ai còn thấy nó. Desktop (explorer/Code/Edge)
 * là thứ nền **sinh ra để hấp thụ** (Pha 1 I-1: máy sạch đã dùng 1.090 MiB) — từ chối vì chúng là
 * tự bắn vào chân.
 *
 * ⚠ PHẦN CÒN LẠI CỦA LỖ (ghi thẳng, không giấu): một hộ tiêu thụ CUDA **của người khác** cỡ lớn
 * (ví dụ `ollama.exe`) vẫn bị hấp thụ vào nền y như cũ. Phân biệt được nó thì phải có **BYTE theo
 * tiến trình**, mà `nvidia-smi` ở đây trả `[N/A]`. Bộ đếm PDH (`vramProcessProbe`) CÓ số đó, nhưng
 * dùng nó ở đây là **trộn hai thước** (ràng buộc Đ4) và cần một ngưỡng mới — cả hai đều là quyết
 * định của chủ dự án, KHÔNG phải của task này. Task này ghi TOÀN BỘ danh sách hộ đang giữ vào sự
 * kiện `baseline` để lượt sau có DỮ LIỆU mà quyết, thay vì đoán.
 */

const MIB = 1024 * 1024;

// Ràng buộc toàn cục 7 — fixture đủ lớn để phân biệt: khối BỊ NUỐT cỡ 17.000 MiB.
const SWALLOWED = 17_000 * MIB; // sidecar mồ côi còn sống sau khi server khởi động lại
const DESKTOP = 1_000 * MIB; // nền THẬT của máy (compositor, trình duyệt…) — nền phải hấp thụ
const DEVICE_USED = SWALLOWED + DESKTOP; // 18.000 MiB
const CEILING = 32_607 * MIB;

/** Bản census "sạch": chỉ desktop đang giữ GPU, KHÔNG có mồ côi. */
const cleanCensus = {
  holders: [
    { pid: 7824, name: "C:\\Windows\\explorer.exe" },
    { pid: 19520, name: "C:\\Users\\Admin\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
    { pid: 2056, name: "[Insufficient Permissions]" },
  ],
  ours: [],
  orphans: [],
  thirdParty: [
    { pid: 7824, name: "C:\\Windows\\explorer.exe" },
    { pid: 19520, name: "C:\\Users\\Admin\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" },
    { pid: 2056, name: "[Insufficient Permissions]" },
  ],
};

/** Bản census có MỒ CÔI: một `llama-server.exe` của lượt chạy TRƯỚC vẫn còn sống. */
const orphanCensus = {
  holders: [
    { pid: 7824, name: "C:\\Windows\\explorer.exe" },
    { pid: 31337, name: "D:\\tools\\llama.cpp\\llama-server.exe" },
  ],
  ours: [],
  orphans: [{ pid: 31337, name: "D:\\tools\\llama.cpp\\llama-server.exe" }],
  thirdParty: [{ pid: 7824, name: "C:\\Windows\\explorer.exe" }],
};

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

describe("Pha 2B Task 1 — nền TỪ CHỐI tuyên bố sạch khi có tiến trình MỒ CÔI giữ GPU", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("★★★ CỔNG: sidecar MỒ CÔI 17.000 MiB đang giữ GPU ⇒ KHÔNG chốt nền, sự kiện nêu ĐÚNG TÊN tiến trình", async () => {
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => orphanCensus }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");

    // ★ TRỌNG TÂM: TRƯỚC bản vá này, nền chốt = 18.000 − 0 = 18.000 MiB, nuốt trọn 17.000 MiB của
    // sidecar mồ côi VĨNH VIỄN (`baselineCaptured` không bao giờ tự gỡ) ⇒ `attributable` hụt đúng
    // 17.000 MiB ⇒ dư địa phóng đại đúng 17.000 MiB.
    expect(await captureVramBaseline()).toBeNull();

    const ev = logged.find((l) => l.event === "baseline_foreign_pid");
    expect(ev, "phải GHI SỔ lượt từ chối — không ghi thì lỗ này vô hình như trước").toBeDefined();
    // Nêu TÊN, không chỉ PID: người trực phải biết đi tắt CÁI GÌ.
    expect(JSON.stringify(ev!.detail)).toContain("llama-server.exe");
    expect(JSON.stringify(ev!.detail)).toContain("31337");
    // …và câu cảnh báo trên console cũng phải nêu tên (người trực đọc log trước khi đọc DB).
    expect(warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")).toContain("llama-server.exe");

    // Nền giữ nguyên trạng thái CHƯA XÁC ĐỊNH ⇒ không con số nhiễm nào được ghim.
    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBeNull();
    // Nền chưa xác định ⇒ `attributable` KHÔNG TÍNH ĐƯỢC (mục 3 của brief).
    expect(r.attributableBytes).toBeNull();
    expect(r.baselineVerified).toBe(false);
  });

  it("★★ KHÔNG ĐOÁN BYTE của PID lạ: sự kiện từ chối KHÔNG chứa con số nào quy cho tiến trình mồ côi", async () => {
    // ⚠ Đoán một con số rồi TRỪ đi thì tệ hơn thừa nhận không biết — nó biến trạng thái mù CÓ
    // TIẾNG thành một con số sai IM LẶNG. `used_memory` của nvidia-smi là `[N/A]` trên máy này,
    // nên "bao nhiêu" là thứ ta KHÔNG BIẾT, và phải tiếp tục không biết.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => orphanCensus }));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline } = await import("./vramReconciler");
    await captureVramBaseline();

    const ev = logged.find((l) => l.event === "baseline_foreign_pid")!;
    const flat = JSON.stringify(ev.detail);
    // KHÔNG có bất kỳ trường byte nào gán cho hộ mồ côi, và tuyệt đối không có con số 17.000 MiB
    // (kích thước THẬT của khối) ở bất cứ đâu — ta không biết nó, nên không được viết ra.
    expect(flat).not.toContain(String(SWALLOWED));
    for (const key of Object.keys(ev.detail ?? {})) {
      expect(key, "không được có trường byte quy cho PID lạ").not.toMatch(/orphan.*bytes|foreign.*bytes|assumed/i);
    }
  });

  it("★ MÙ PHẢI CÓ TIẾNG: quét hộ giữ GPU KHÔNG dùng được ⇒ nền vẫn chốt (chuông Pha 1 sống) nhưng attributable = null", async () => {
    // Ràng buộc toàn cục 10 — đầu dò hỏng ⇒ suy biến AN TOÀN + GHI RÕ đang chạy mù.
    // ⚠ VÌ SAO KHÔNG từ chối luôn ở nhánh này: huỷ nền cũng CHỈ dẫn tới `attributable = null`
    // (đúng nhánh mù), nhưng nó GIẾT THÊM chuông đối chiếu của Pha 1 — mất mát thuần tuý, không
    // đổi lại được gì về an toàn số học.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => null }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED); // nền vẫn chốt

    const ev = logged.find((l) => l.event === "baseline")!;
    expect(ev.detail!.baselineVerified).toBe(false); // ★ ghi rõ: nền này CHƯA XÁC MINH ĐƯỢC
    expect(warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")).toMatch(/MÙ|chưa xác minh/i);

    const r = await reconcileOnce();
    expect(r.baselineUsedBytes).toBe(DEVICE_USED); // chuông Pha 1 vẫn so được
    expect(r.attributableBytes).toBeNull(); // ★ nhưng cưỡng chế thì KHÔNG được tin con số này
    expect(r.baselineVerified).toBe(false);
  });

  it("★ desktop (explorer/Code/Edge) KHÔNG phải mồ côi ⇒ nền VẪN chụp được, và sự kiện ghi lại TỪNG hộ", async () => {
    // ⚠ Ca này là bằng chứng chống lại bản đọc nguyên văn "PID nào không phải của ta ⇒ từ chối":
    // trên máy đo được, danh sách luôn có ≥15 hộ như thế. Từ chối vì chúng = nền không bao giờ
    // chụp được = mù vĩnh viễn.
    mockEmptyLedger();
    mockDevice();
    const logged: Logged[] = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
    vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => cleanCensus }));

    const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);

    const ev = logged.find((l) => l.event === "baseline")!;
    expect(ev.detail!.baselineVerified).toBe(true);
    // Danh sách hộ đang giữ đi vào nhật ký: đây là dữ liệu để lượt sau quyết "có cần byte theo
    // tiến trình không", thay vì đoán.
    expect(JSON.stringify(ev.detail!.gpuHolders)).toContain("explorer.exe");

    const r = await reconcileOnce();
    expect(r.baselineVerified).toBe(true);
    expect(r.attributableBytes).toBe(0); // 18.000 thiết bị − 18.000 nền
  });

  it("hậu duệ CỦA TA đang giữ GPU (sidecar còn sống, cùng cây tiến trình) ⇒ KHÔNG phải mồ côi", async () => {
    mockEmptyLedger();
    mockDevice();
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    vi.doMock("./vramGpuHolders", () => ({
      readGpuHolders: async () => ({
        holders: [{ pid: 4242, name: "D:\\tools\\llama.cpp\\llama-server.exe" }],
        ours: [{ pid: 4242, name: "D:\\tools\\llama.cpp\\llama-server.exe" }],
        orphans: [],
        thirdParty: [],
      }),
    }));

    const { captureVramBaseline } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBe(DEVICE_USED);
  });

  it("TỰ LÀNH đúng MỘT NHỊP: mồ côi thoát ⇒ nhịp sau chụp được nền ĐÚNG", async () => {
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

    const { captureVramBaseline } = await import("./vramReconciler");
    expect(await captureVramBaseline()).toBeNull();
    orphanAlive = false;
    // ★ Nền ĐÚNG = 1.000 MiB (desktop), KHÔNG phải 18.000 MiB đã nhiễm.
    expect(await captureVramBaseline()).toBe(DESKTOP);
  });

  it("★★ hoãn quá lâu vì mồ côi ⇒ BÁO ĐỘNG nêu TÊN tiến trình, KHÔNG đổ oan 'cấp phát chui'", async () => {
    const prev = process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
    process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = "0"; // trip ngay ở lượt hoãn đầu
    try {
      mockEmptyLedger();
      mockDevice();
      const logged: Logged[] = [];
      vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: Logged) => logged.push(e) }));
      vi.doMock("./vramGpuHolders", () => ({ readGpuHolders: async () => orphanCensus }));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { startVramReconciler, stopVramReconciler, __runReconcileTick } = await import("./vramReconciler");
      try {
        startVramReconciler();
        await new Promise((r) => setImmediate(r));

        const blocked = await __runReconcileTick();
        expect(blocked.baselineBlocked).toBe(true);
        expect(blocked.alarm).toBe(true); // mù thì KHÔNG được im lặng
        expect(blocked.baselineUsedBytes).toBeNull();
        expect(blocked.attributableBytes).toBeNull();

        const ev = logged.find((l) => l.event === "baseline_blocked")!;
        expect(ev.detail!.reason).toBe("foreign-gpu-holder");
        expect(JSON.stringify(ev.detail)).toContain("llama-server.exe");

        const msg = warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
        expect(msg).toContain("llama-server.exe"); // đi tắt ĐÚNG tiến trình
        expect(msg).not.toContain("KHÔNG XIN PHÉP"); // nguyên nhân KHÁC "cấp phát chui"
      } finally {
        stopVramReconciler();
      }
    } finally {
      if (prev === undefined) delete process.env.VRAM_BASELINE_BLOCKED_ALARM_MS;
      else process.env.VRAM_BASELINE_BLOCKED_ALARM_MS = prev;
    }
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
    // Nguyên văn dạng đầu ra đo được trên máy này, có CRLF và dòng rỗng cuối.
    const raw =
      "2056, [Insufficient Permissions]\r\n" +
      "7824, C:\\Windows\\explorer.exe\r\n" +
      "19388, C:\\Program Files\\Display Driver\\Display Driver.exe\r\n" +
      "\r\n";
    expect(parseComputeApps(raw)).toEqual([
      { pid: 2056, name: "[Insufficient Permissions]" },
      { pid: 7824, name: "C:\\Windows\\explorer.exe" },
      // ⚠ Tên có DẤU PHẨY? Không — nhưng có KHOẢNG TRẮNG; tách theo dấu phẩy ĐẦU TIÊN, không split hết.
      { pid: 19388, name: "C:\\Program Files\\Display Driver\\Display Driver.exe" },
    ]);
  });

  it("parseComputeApps bỏ HEADER khi ai đó quên --format=csv,noheader", async () => {
    const { parseComputeApps } = await import("./vramGpuHolders");
    expect(parseComputeApps("pid, process_name\n7824, C:\\Windows\\explorer.exe\n")).toEqual([
      { pid: 7824, name: "C:\\Windows\\explorer.exe" },
    ]);
  });

  it("★★ desktop ⇒ thirdParty (KHÔNG từ chối); ảnh thực thi CỦA TA ngoài cây ⇒ MỒ CÔI", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const census = classifyHolders({
      holders: [
        { pid: 7824, name: "C:\\Windows\\explorer.exe" },
        { pid: 31337, name: "D:\\tools\\llama.cpp\\llama-server.exe" }, // mồ côi: đúng bin của ta
        { pid: 4242, name: "D:\\tools\\llama.cpp\\llama-server.exe" }, // hậu duệ ⇒ của ta
        { pid: 100, name: "C:\\Program Files\\nodejs\\node.exe" }, // CHÍNH ta
      ],
      procs: [
        { pid: 100, ppid: 1 },
        { pid: 4242, ppid: 100 },
        { pid: 31337, ppid: 1 }, // mồ côi — cha đã chết
        { pid: 7824, ppid: 1 },
      ],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(census.orphans.map((h) => h.pid)).toEqual([31337]);
    expect(census.ours.map((h) => h.pid).sort()).toEqual([100, 4242]);
    expect(census.thirdParty.map((h) => h.pid)).toEqual([7824]);
  });

  it("ảnh thực thi nằm TRONG thư mục ứng dụng mà ngoài cây ⇒ MỒ CÔI (venv python, tool đóng gói)", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const census = classifyHolders({
      holders: [{ pid: 555, name: "D:\\SOURCES\\avi-aoi-management\\.venv\\Scripts\\python.exe" }],
      procs: [{ pid: 555, ppid: 1 }],
      roots: [100],
      ownExecutables: ["C:\\Program Files\\nodejs\\node.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(census.orphans.map((h) => h.pid)).toEqual([555]);
  });

  it("so khớp ảnh thực thi KHÔNG phân biệt hoa/thường và dấu gạch (Windows)", async () => {
    const { classifyHolders } = await import("./vramGpuHolders");
    const census = classifyHolders({
      holders: [{ pid: 31337, name: "d:/tools/llama.cpp/LLAMA-SERVER.EXE" }],
      procs: [{ pid: 31337, ppid: 1 }],
      roots: [100],
      ownExecutables: ["D:\\tools\\llama.cpp\\llama-server.exe"],
      appRoot: "D:\\SOURCES\\avi-aoi-management",
    });
    expect(census.orphans.map((h) => h.pid)).toEqual([31337]);
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
