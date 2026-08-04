/**
 * Pha 1 Task 6 — dây nối VRAM cho HAI hộ tiêu thụ NGOÀI tiến trình:
 *   1. sidecar thị giác (llamaVisionSidecar.ts) — hộ LỚN NHẤT hệ, 7.825 MiB đo được ở Đợt 2,
 *      vắng mặt khỏi MỌI phép cộng VRAM suốt Đợt 0, chỉ bị bắt bởi một lượt review toàn nhánh.
 *   2. cron kb:sync (kbSyncScheduler.ts) — 1.251 MiB đo được ở Đợt 2.
 *
 * ⚠ CỐT LÕI (spec §3.1): ta KHÔNG sửa binary llama-server / node — ta sửa THỨ KHỞI ĐỘNG chúng.
 * "Người giám sát xin giấy phép THAY CHO tiến trình con" trước khi spawn, và trả khi tiến trình
 * con thoát (dù thoát sạch, bị kill, hay spawn lỗi).
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (xem wiring.inprocess.test.ts): `vi.resetModules()` tạo một THẾ HỆ
 * module mới; mã sản xuất `import()` ĐỘNG "./vram/vramBroker" nên MỌI lượt import (kể cả sổ
 * cái) phải nằm TRONG thân test, SAU cùng một `vi.resetModules()` — import tĩnh ở đầu file (như
 * bản nháp trong brief) soi vào một THẾ HỆ CŨ và luôn thấy sổ rỗng, xanh/đỏ đều sai lý do.
 *
 * Test file này CHỈ dùng `vi.mock()` tĩnh (không `vi.doMock()`) nên không cần `doUnmock` trong
 * `beforeEach` — không có gì rò giữa các ca vì không ca nào override mock bằng `vi.doMock()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ─── fs (sidecar dùng specifier "fs", KHÔNG phải "node:fs" — xem llamaVisionSidecar.ts:31 và
// aiGgufEngine.ts:19). validateGgufFile() cần existsSync + statSync().isFile() + magic "GGUF"
// qua openSync/readSync. Mọi đường dẫn đều "tồn tại" và là GGUF hợp lệ — test này không quan
// tâm nội dung file, chỉ quan tâm dây nối VRAM quanh spawn. ──────────────────────────────────
const fsApi = vi.hoisted(() => ({
  existsSync: () => true,
  statSync: () => ({ size: 5 * 1024 * 1024, isFile: () => true, mtime: new Date() }),
  openSync: () => 1,
  readSync: (_fd: number, buf: Buffer) => {
    buf[0] = 0x47;
    buf[1] = 0x47;
    buf[2] = 0x55;
    buf[3] = 0x46; // "GGUF"
    return 4;
  },
  closeSync: () => {},
  mkdirSync: () => {},
  readdirSync: () => [] as string[],
}));
vi.mock("fs", () => ({ default: fsApi, ...fsApi }));

// ─── child_process / node:child_process ───────────────────────────────────────────────────────
// ⚠ GOTCHA (đo được bằng một probe riêng trước khi viết bản này — xem báo cáo Task 6): Vitest gộp
// "child_process" VÀ "node:child_process" vào CÙNG MỘT khoá registry — `vi.mock()` cho specifier
// SAU đè lên specifier TRƯỚC cho CẢ HAI, bất kể module nào import bằng specifier nào.
// llamaVisionSidecar.ts dùng "child_process" (không tiền tố), kbSyncScheduler.ts dùng
// "node:child_process" — mock RIÊNG từng specifier bằng hai `vi.fn()` khác nhau khiến cái đăng ký
// SAU thầm lặng đè cái TRƯỚC cho CẢ HAI module, và `spawn()` phía "thua" trả `undefined` (đúng ca
// gặp phải ở bản nháp đầu: "Cannot read properties of undefined (reading 'stdout')" dù mock trông
// đúng — test XANH nhầm nếu không có đột biến, ĐỎ nhầm lý do nếu không truy đúng gốc). Sửa tận
// gốc: MỘT mock dùng chung cho cả hai specifier, tự phân biệt sidecar/cron bằng chính lệnh spawn
// (`cmd === "npm"` ⇒ cron; ngược lại ⇒ sidecar — xem `sharedSpawnMock.mockImplementation` dưới).
class FakeChildProc extends EventEmitter {
  killed = false;
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() {
    this.killed = true;
    return true;
  }
}
const sharedSpawnMock = vi.hoisted(() => vi.fn());
/** Tiến trình con THỨ BA của cùng file `kbSyncScheduler.ts` — cổng eval (review toàn nhánh, C-1). */
function isEvalGateSpawn(cmd: unknown, args: unknown): boolean {
  return Array.isArray(args) && args.some((a) => String(a).endsWith("eval-rag.mjs"));
}
vi.mock("child_process", () => ({
  spawn: (...a: unknown[]) => (sharedSpawnMock as unknown as (...a: unknown[]) => unknown)(...a),
}));
vi.mock("node:child_process", () => ({
  spawn: (...a: unknown[]) => (sharedSpawnMock as unknown as (...a: unknown[]) => unknown)(...a),
}));

const ORIGINAL_ENV = { ...process.env };

/** Ảnh chụp sổ cái CÙNG THẾ HỆ module với mã sản xuất vừa chạy — import ĐỘNG, trong thân test. */
async function currentLeases() {
  const { snapshot } = await import("./vramBroker");
  return snapshot().leases;
}

function stubHealthyFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "ok" }) } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    }),
  );
}

let lastSidecarProc: FakeChildProc | undefined;
let lastCronChild: FakeChildProc | undefined;
let lastEvalChild: FakeChildProc | undefined;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  lastSidecarProc = undefined;
  lastCronChild = undefined;
  lastEvalChild = undefined;
  sharedSpawnMock.mockReset();
  sharedSpawnMock.mockImplementation((cmd: unknown, args: unknown) => {
    const proc = new FakeChildProc();
    // llamaVisionSidecar spawns the llama-server BINARY PATH directly; kbSyncScheduler spawns
    // "npm" (["run", "kb:sync"]) cho pipeline VÀ `process.execPath` (["…/eval-rag.mjs","--ci"])
    // cho cổng eval — BA đường spawn khác nhau, phân biệt bằng chính lệnh spawn.
    if (isEvalGateSpawn(cmd, args)) lastEvalChild = proc;
    else if (cmd === "npm") lastCronChild = proc;
    else lastSidecarProc = proc;
    return proc;
  });
  process.env = { ...ORIGINAL_ENV };
  process.env.LLAMA_SERVER_BIN = "/bin/llama-server";
  process.env.GGUF_VISION_MODEL = "qwen2-vl.gguf";
  process.env.GGUF_VISION_MMPROJ = "mmproj.gguf";
  process.env.LLAMA_VISION_READY_TIMEOUT_MS = "5000";
});

describe("Pha 1 Task 6 — dây nối ngoài tiến trình: người giám sát xin phép thay tiến trình con", () => {
  describe("sidecar thị giác (llamaVisionSidecar) — hộ 7.825 MiB", () => {
    it("1. spawn sidecar ⇒ có giấy phép external-process kèm ttlMs", async () => {
      stubHealthyFetch();
      const { __startSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();

      const l = (await currentLeases()).find((x) => x.request.owner.startsWith("sidecar:"));
      expect(l).toBeDefined();
      expect(l!.request.kind).toBe("external-process");
      expect(l!.request.priority).toBe("interactive");
      expect(typeof l!.request.ttlMs).toBe("number");
      // Sidecar tự tắt sau 10 phút nhàn rỗi — ttlMs PHẢI dài hơn, nếu không reconciler tưởng
      // nó chết trong khi nó đang sống khoẻ.
      expect(l!.request.ttlMs!).toBeGreaterThan(10 * 60 * 1000);
      // Lượt đầu tiên — chưa có số học được, dùng hằng số 7.825 MiB (Đợt 2) qua configDefaultBytes.
      expect(l!.request.estimateSource).toBe("config-default");
      expect(l!.request.estimatedBytes).toBe(7825 * 1024 * 1024);
      expect(lastSidecarProc).toBeDefined();
      expect(lastCronChild).toBeUndefined();
    });

    /**
     * I-1 (review TOÀN NHÁNH) — KỶ LUẬT THỨ TỰ: sổ chỉ được nhả SAU khi thiết bị đã nhả.
     *
     * Bản trước gọi `release()` NGAY TRƯỚC `kill("SIGTERM")` (llamaVisionSidecar.ts:393) rồi mới
     * SIGKILL sau 5.000 ms. Trong cửa sổ đó sổ = 0 nhưng thiết bị vẫn giữ 7.825 MiB ⇒ một nhịp
     * đối chiếu rơi vào đó in "LỆCH +7825 MiB … cấp phát KHÔNG XIN PHÉP" — module TỰ SINH ra
     * đúng cái báo động giả nó được viết ra để bắt. Sidecar tự tắt sau MỖI 10 phút nhàn rỗi ⇒
     * hàng chục lượt/24 h. `aiGgufEngine.ts:987` đã làm ĐÚNG chiều và ghi rõ lý do; hai task đi
     * hai hướng với hai comment cùng tự tin — test này khoá chiều đúng lại.
     */
    it("2. stopSidecar ⇒ GIỮ giấy phép cho tới khi tiến trình THẬT SỰ chết (không nhả sổ trước thiết bị)", async () => {
      process.env.LLAMA_VISION_STOP_WAIT_MS = "40";
      stubHealthyFetch();
      const { __startSidecarForTests, __stopSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(true);

      // ★ C-2 — lượt stop KHÔNG quan sát được cái chết ⇒ phải khai `false`, không phải `undefined`
      // (bản trước) mà người thi hành đè lên bằng `return true`.
      expect(await __stopSidecarForTests()).toBe(false);
      // SIGTERM đã gửi nhưng tiến trình CHƯA thoát — thiết bị VẪN giữ 7.825 MiB ⇒ sổ phải giữ.
      expect(lastSidecarProc!.killed).toBe(true);
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(true);

      // Tiến trình chết thật ⇒ ĐÂY mới là lúc sổ được nhả.
      lastSidecarProc!.emit("exit", 0, "SIGTERM");
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(false);
    });

    /**
     * ★★★ Pha 3 Task 1 — **HẠN CHỜ LÀ MỘT DÂY `?? <mặc_định>`, VÀ DÂY PHẢI CÓ LƯỚI.**
     *
     * `stopWaitMs()` (llamaVisionSidecar.ts) là `Number.isFinite(n) && n >= 1 ? Math.floor(n) : 8000`
     * — một đường ra duy nhất, không ai canh. Đổi vế `else` thành `0`, hoặc bỏ điều kiện sàn `>= 1`,
     * biến lượt chờ thành **một phép đo tức thời**: `Promise.race` thấy hết giờ NGAY, `stopSidecar()`
     * khai `false` cho MỌI lượt dừng, `preempt()` xếp hộ 7,8 GB vào `failed` VĨNH VIỄN ⇒ thu hồi
     * không bao giờ chạy và mọi lượt hết chỗ thành từ chối cứng. Đó đúng là **nửa còn lại** của C-2
     * (nửa kia là khai `true` khi chưa chết) và nó **không có một ca nào canh** trước task này.
     *
     * ⚠ Lưới đi theo ĐƯỜNG THOÁT: ca gọi chính `stopSidecar()` công khai và đo **hành vi chờ**, chứ
     * không đọc hằng số `8000` ở đâu cả — một ca so hằng số vẫn xanh khi `Promise.race` bị gỡ.
     * ⚠ Đo SỐNG (báo cáo Task 1 §1): lượt chờ thật trên sidecar THẬT là **485–500 ms** (5/5 lượt),
     * nên hạn 8.000 ms còn ~16 lần biên; điều phải khoá ở đây là *"có CHỜ"*, không phải con số.
     */
    it("★★★ Task 1 — hạn chờ RÁC/DƯỚI SÀN (`LLAMA_VISION_STOP_WAIT_MS=0`) ⇒ vẫn CHỜ, không thành phép đo tức thời", async () => {
      process.env.LLAMA_VISION_STOP_WAIT_MS = "0";
      stubHealthyFetch();
      const { __startSidecarForTests, __stopSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();

      let daTraLoi = false;
      const p = __stopSidecarForTests().then((v) => {
        daTraLoi = true;
        return v;
      });
      await new Promise((r) => setTimeout(r, 150));
      // `0` là RÁC (dưới sàn 1) ⇒ phải rơi về mặc định 8.000, tức SAU 150 ms vẫn đang chờ.
      expect(daTraLoi, "hạn rác kéo lượt chờ về 0 ⇒ dựng lại C-2 theo chiều 'luôn khai false'").toBe(false);

      lastSidecarProc!.emit("exit", 0, "SIGTERM");
      await expect(p).resolves.toBe(true);
    });

    it("★★★ Task 1 — hạn chờ KHÔNG ĐẶT ⇒ dùng mặc định (vẫn CHỜ), rồi khai `true` khi tiến trình chết", async () => {
      delete process.env.LLAMA_VISION_STOP_WAIT_MS;
      stubHealthyFetch();
      const { __startSidecarForTests, __stopSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();

      let daTraLoi = false;
      const p = __stopSidecarForTests().then((v) => {
        daTraLoi = true;
        return v;
      });
      await new Promise((r) => setTimeout(r, 150));
      expect(daTraLoi).toBe(false);

      lastSidecarProc!.emit("exit", 0, "SIGTERM");
      await expect(p).resolves.toBe(true);
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(false);
    });

    /**
     * ★★★ C-2 (review TOÀN NHÁNH) — NGỮ NGHĨA **THẬT** CỦA NGƯỜI THI HÀNH, KHÔNG PHẢI BẢN GIẢ.
     *
     * `consolidation.test.ts` thay `stopSidecar` bằng một bản giả, nên đường bất đồng bộ THẬT
     * (SIGTERM → `setTimeout(SIGKILL).unref()` → `proc.on("exit")` mới `release()`) **chưa từng
     * chạy trong test** — và đó chính là chỗ bug C-2 sống: người thi hành `return true` vô điều
     * kiện ⇒ `vramWiring` xin lại NGAY trên một sổ chưa đổi ⇒ **TỪ CHỐI LẦN HAI sau khi đã giết
     * 7,8 GB**. File này KHÔNG giả `llamaVisionSidecar`: nó giả `fs`/`child_process`/`fetch`, tức
     * đúng ba biên của thế giới ngoài, nên `preempt()` ở đây đi qua đường thật từ đầu tới cuối.
     */
    it("★★★ C-2a — `preempt()` THẬT: tiến trình chưa chết ⇒ `failed`, sổ KHÔNG nhả, `freedBytes = 0`", async () => {
      process.env.LLAMA_VISION_STOP_WAIT_MS = "40";
      stubHealthyFetch();
      const { __startSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();

      const { setLeaseRefCount, snapshot } = await import("./vramBroker");
      const l = (await currentLeases()).find((x) => x.request.owner === "sidecar:vision")!;
      expect(l).toBeDefined();
      setLeaseRefCount(l.id, 0); // nhàn rỗi ⇒ đủ điều kiện thu hồi (`nguoiThiHanhThuHoi`)
      const truoc = snapshot().totalReservedBytes;

      const { preempt } = await import("./vramPreempt");
      const kq = await preempt("production", Number.POSITIVE_INFINITY);

      expect(kq.planned).toBe(1);                       // đã có kế hoạch …
      expect(lastSidecarProc!.killed).toBe(true);       // … và đã THẬT SỰ gửi tín hiệu giết …
      expect(kq.reclaimed).toEqual([]);                 // … nhưng KHÔNG được khai là xong
      expect(kq.failed).toEqual(["sidecar:vision"]);
      expect(kq.freedBytes).toBe(0);
      expect(snapshot().totalReservedBytes).toBe(truoc); // sổ y nguyên ⇒ xin lại là chắc chắn hỏng
    });

    it("★★★ C-2b — `preempt()` THẬT: tiến trình CHẾT trong lúc chờ ⇒ `reclaimed`, sổ nhả ĐỦ 7.825 MiB", async () => {
      process.env.LLAMA_VISION_STOP_WAIT_MS = "2000";
      stubHealthyFetch();
      const { __startSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();

      const { setLeaseRefCount, snapshot } = await import("./vramBroker");
      const l = (await currentLeases()).find((x) => x.request.owner === "sidecar:vision")!;
      setLeaseRefCount(l.id, 0);
      const truoc = snapshot().totalReservedBytes;
      expect(truoc).toBe(7825 * 1024 * 1024);

      /**
       * llama-server chết SAU khi SIGTERM tới — đúng hình dạng sản xuất, và là lý do lượt chờ của
       * `stopSidecar()` phải là một lượt chờ THẬT chứ không phải một phép đo tức thời.
       * ⚠ Móc vào `kill()` chứ KHÔNG hẹn giờ tuyệt đối: một `setTimeout(…, 5)` có thể nổ TRƯỚC khi
       * `preempt()` kịp lập kế hoạch (lượt `await import()` đầu tiên đủ chậm), khi đó giấy phép đã
       * rời sổ và ca xanh/đỏ vì lý do KHÁC hẳn thứ nó canh — đúng một lượt bất định đo được.
       */
      const proc = lastSidecarProc!;
      const killGoc = proc.kill.bind(proc);
      (proc as { kill: (s?: string) => boolean }).kill = (s?: string) => {
        const r = killGoc();
        setTimeout(() => proc.emit("exit", 0, s ?? "SIGTERM"), 1);
        return r;
      };

      const { preempt } = await import("./vramPreempt");
      const kq = await preempt("production", Number.POSITIVE_INFINITY);

      expect(kq.reclaimed).toEqual(["sidecar:vision"]);
      expect(kq.failed).toEqual([]);
      // ⚠ Đo bằng SỔ: con số này chỉ khác 0 khi giấy phép ĐÃ rời sổ, tức khi OS đã thu hồi VRAM.
      expect(kq.freedBytes).toBe(truoc);
      expect(snapshot().totalReservedBytes).toBe(0);
    });

    it('3. ĐỘT BIẾN — sidecar CHẾT ĐỘT NGỘT (proc "exit", KHÔNG qua stopSidecar) ⇒ vẫn TRẢ giấy phép', async () => {
      stubHealthyFetch();
      const { __startSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();
      expect(lastSidecarProc).toBeDefined();
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(true);

      // Không gọi stopSidecar() — mô phỏng crash: chỉ tiến trình con tự thoát.
      lastSidecarProc!.emit("exit", 1, null);

      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(false);
    });

    it('4. ĐỘT BIẾN — sidecar báo LỖI (proc "error") sau khi đã chạy ⇒ vẫn TRẢ giấy phép, không treo', async () => {
      stubHealthyFetch();
      const { __startSidecarForTests } = await import("../llamaVisionSidecar");
      await __startSidecarForTests();
      expect(lastSidecarProc).toBeDefined();
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(true);

      lastSidecarProc!.emit("error", new Error("ECONNRESET (ca thử nghiệm)"));

      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(false);
    });

    it('5. NHÁNH THOÁT THỨ TƯ (review vòng 1) — spawn() NÉM ĐỒNG BỘ ⇒ vẫn TRẢ giấy phép, không treo vĩnh viễn', async () => {
      stubHealthyFetch();
      // Tái hiện ĐÚNG probe của reviewer: reserve() đã thành công (beginVramAllocation await
      // xong ở dòng 246-260), rồi NGAY lượt spawn() kế tiếp ném đồng bộ — mô phỏng EACCES/thiếu
      // quyền thực thi, hoặc bất kỳ lỗi nào Node ném THẲNG thay vì phát ra qua "error"/"exit".
      sharedSpawnMock.mockImplementationOnce(() => {
        throw new Error("EACCES — không đủ quyền thực thi llama-server (ca thử nghiệm)");
      });

      const { __startSidecarForTests } = await import("../llamaVisionSidecar");
      await expect(__startSidecarForTests()).rejects.toThrow(/EACCES/);

      // Giấy phép ĐÃ được reserve() (nhánh thoát thứ tư nằm SAU điểm xin phép) — nếu không có
      // try/catch quanh spawn(), biến `sidecar` cấp module cũng chưa từng được set (nó set SAU
      // spawn()) nên KHÔNG CÒN chỗ nào khác có thể trả lease này — treo tới khi restart tiến trình.
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("sidecar:"))).toBe(false);
    });
  });

  describe("cron kb:sync (kbSyncScheduler) — hộ 1.251 MiB", () => {
    it("5. cron kb:sync xin giấy phép BACKGROUND NGAY TRƯỚC khi spawn", async () => {
      const { __runKbSyncForTests } = await import("../kbSyncScheduler");
      await __runKbSyncForTests();

      const l = (await currentLeases()).find((x) => x.request.owner.startsWith("cron:kb-sync"));
      expect(l).toBeDefined();
      expect(l!.request.kind).toBe("external-process");
      expect(l!.request.priority).toBe("background");
      expect(typeof l!.request.ttlMs).toBe("number");
      expect(l!.request.ttlMs!).toBeGreaterThan(0);
      // Lượt đầu tiên — hằng số 1.251 MiB (Đợt 2) qua configDefaultBytes, chưa có số học được.
      expect(l!.request.estimateSource).toBe("config-default");
      expect(l!.request.estimatedBytes).toBe(1251 * 1024 * 1024);
      expect(lastCronChild).toBeDefined();
      expect(lastSidecarProc).toBeUndefined();

      // Reserve xảy ra TRƯỚC spawn: __runKbSyncForTests() await beginKbSyncVram() TRƯỚC khi gọi
      // spawnKbSyncWithVram() (kbSyncScheduler.ts) — spawn ĐÃ được gọi tại đây (lastCronChild
      // tồn tại) chứng minh cả hai bước đã chạy theo đúng thứ tự đó, không phải một cuộc đua.
    });

    it('6. ĐỘT BIẾN — tiến trình con thoát ("exit") ⇒ TRẢ giấy phép', async () => {
      const { __runKbSyncForTests } = await import("../kbSyncScheduler");
      await __runKbSyncForTests();
      expect(lastCronChild).toBeDefined();
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("cron:kb-sync"))).toBe(true);

      lastCronChild!.emit("exit", 0, null);

      expect((await currentLeases()).some((x) => x.request.owner.startsWith("cron:kb-sync"))).toBe(false);
    });

    it('7. ĐỘT BIẾN — spawn LỖI ("error", vd ENOENT npm) ⇒ TRẢ giấy phép, không treo', async () => {
      const { __runKbSyncForTests } = await import("../kbSyncScheduler");
      await __runKbSyncForTests();
      expect(lastCronChild).toBeDefined();
      expect((await currentLeases()).some((x) => x.request.owner.startsWith("cron:kb-sync"))).toBe(true);

      lastCronChild!.emit("error", new Error("ENOENT — npm không tìm thấy (ca thử nghiệm)"));

      expect((await currentLeases()).some((x) => x.request.owner.startsWith("cron:kb-sync"))).toBe(false);
    });
  });

  /**
   * C-1 (review TOÀN NHÁNH) — hộ tiêu thụ THỨ BA của CÙNG file `kbSyncScheduler.ts`, cách
   * `spawnKbSyncWithVram()` đúng 143 dòng BÊN TRÊN, và Task 6 đã bỏ sót.
   *
   * `runEvalHarness()` spawn `node scripts/ai-kb/eval-rag.mjs --ci`. Script đó gọi
   * `getLlama({ gpu: "auto" })` (eval-rag.mjs:211 cho đường rerank, và `_gguf-embed.mjs:73` cho
   * đường nhúng câu hỏi mà `--ci` LUÔN đi qua) rồi `loadModel(...)` ⇒ backend CUDA + embedding
   * context trong một tiến trình Node THỨ HAI.
   *
   * ⚠ KHÔNG phải giả thuyết: `.env:748` `KB_AUTOSYNC_ENABLED=true`, `.env:749`
   * `KB_AUTOSYNC_EVAL_GATE=true` (mặc định mã cũng "true", kbSyncScheduler.ts:85) ⇒ 03:00 mỗi
   * đêm, `reconcileOnce()` báo "cấp phát KHÔNG XIN PHÉP" cho chính tiến trình con app tự spawn.
   */
  describe("cổng eval kb (kbSyncScheduler.runEvalHarness) — tiến trình con THỨ HAI của cùng file", () => {
    it("8. cổng eval xin giấy phép BACKGROUND NGAY TRƯỚC khi spawn eval-rag.mjs", async () => {
      const { __runEvalGateForTests } = await import("../kbSyncScheduler");
      await __runEvalGateForTests();

      const l = (await currentLeases()).find((x) => x.request.owner === "cron:kb-eval-gate");
      expect(l).toBeDefined();
      expect(l!.request.kind).toBe("external-process");
      expect(l!.request.priority).toBe("background");
      // ttlMs = trần thời lượng gate (KB_AUTOSYNC_EVAL_TIMEOUT_MS, sàn 30 s) — giấy phép không
      // được sống lâu hơn khoảng thời gian tiến trình con được PHÉP sống.
      expect(typeof l!.request.ttlMs).toBe("number");
      expect(l!.request.ttlMs!).toBeGreaterThanOrEqual(30_000);
      expect(l!.request.estimateSource).toBe("config-default");
      expect(lastEvalChild).toBeDefined();
      // Tiến trình eval KHÔNG phải tiến trình kb:sync — hai hộ tiêu thụ RIÊNG.
      expect(lastCronChild).toBeUndefined();
    });

    it('9. ĐỘT BIẾN — eval thoát ("exit") ⇒ TRẢ giấy phép', async () => {
      const { __runEvalGateForTests } = await import("../kbSyncScheduler");
      await __runEvalGateForTests();
      expect((await currentLeases()).some((x) => x.request.owner === "cron:kb-eval-gate")).toBe(true);

      lastEvalChild!.emit("exit", 0, null);

      expect((await currentLeases()).some((x) => x.request.owner === "cron:kb-eval-gate")).toBe(false);
    });

    it('10. ĐỘT BIẾN — eval spawn LỖI ("error") ⇒ TRẢ giấy phép, không treo', async () => {
      const { __runEvalGateForTests } = await import("../kbSyncScheduler");
      await __runEvalGateForTests();
      expect((await currentLeases()).some((x) => x.request.owner === "cron:kb-eval-gate")).toBe(true);

      lastEvalChild!.emit("error", new Error("ENOENT — node không tìm thấy (ca thử nghiệm)"));

      expect((await currentLeases()).some((x) => x.request.owner === "cron:kb-eval-gate")).toBe(false);
    });

    it("11. ĐỘT BIẾN — spawn() NÉM ĐỒNG BỘ ⇒ vẫn TRẢ giấy phép (bài học Task 6 vòng 1)", async () => {
      sharedSpawnMock.mockImplementationOnce(() => {
        throw new Error("EACCES — không thực thi được node (ca thử nghiệm)");
      });
      const { __runEvalGateForTests } = await import("../kbSyncScheduler");
      await __runEvalGateForTests();

      expect((await currentLeases()).some((x) => x.request.owner === "cron:kb-eval-gate")).toBe(false);
    });
  });
});
