/**
 * ★★★ Pha 3 Task 1 · M-2 — **`vramTicket.release()` NÉM ⇒ MỐC "ĐÃ CHẾT" KHÔNG ĐƯỢC BỊ NUỐT.**
 *
 * `llamaVisionSidecar.proc.on("exit")` gọi `vramTicket.release()` trong một `try/catch`, rồi gọi
 * `daChet.danhDau()` **NGOÀI** `try` đó. Vị trí ấy là CÓ CHỦ Ý và cho tới nay **không có ca nào
 * khoá nó lại**. Dời `danhDau()` vào trong `try` thì một `release()` ném sẽ nuốt mốc ⇒
 * `stopSidecar()` chờ hết hạn rồi khai `false` cho một tiến trình **đã** chết và **đã** nhả sổ ⇒
 * hộ 7,8 GB vào `failed` trong khi sổ đã trống: **một lời từ chối cứng trên chỗ đang rỗng**.
 *
 * ⚠⚠ VÌ SAO FILE RIÊNG (và đây là một phát hiện, không phải sở thích): bản đầu đặt mock này trong
 * `wiring.outofprocess.test.ts` — file đó gọi `vi.resetModules()` ở MỖI `beforeEach`. Nhà máy
 * `vi.mock` **không** đi theo vòng đời reset ấy: mô-đun `vramWiring` bị giả bám lại THẾ HỆ CŨ trong
 * khi `currentLeases()` đọc thế hệ MỚI ⇒ giấy phép **tích luỹ qua các ca** (đo được: 3 hộ
 * `sidecar:vision` cùng lúc, rồi TỪ CHỐI vì hết dư địa) và **18/18 ca đỏ**. Đúng cái bẫy
 * module-identity mà chính đầu file kia cảnh báo. ⇒ File này cố ý **MỘT thế hệ, MỘT ca, KHÔNG
 * `resetModules()`**.
 *
 * ⚠ HÔM NAY `release()` KHÔNG NÉM ĐƯỢC: `vramWiring.ts` bọc toàn thân nó trong `try/catch`. Lưới
 * này canh một rủi ro **TÁI CẤU TRÚC**, và nó phải có **TRƯỚC Task 2** — Task 2 đưa một lượt ghi DB
 * vào đường nhả, tức tạo ra một bề mặt ném THẬT ở đúng chỗ này.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";

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
const lastProc = vi.hoisted(() => ({ p: undefined as unknown }));
vi.mock("child_process", () => ({
  spawn: () => {
    const p = new FakeChildProc();
    lastProc.p = p;
    return p;
  },
}));

/**
 * Seam: `importOriginal` rồi **chỉ bọc** `release()` của ticket THẬT. Sổ vẫn nhả thật — ta chỉ
 * thêm một lượt ném NGAY SAU. Đây không phải "nhảy qua cổng thật": `beginVramAllocation` được lấy
 * bằng `await import("./vram/vramWiring")`, tức cùng hạng với `fs`/`child_process` mà file này giả.
 */
const nemLan = vi.hoisted(() => ({ n: 0 }));
vi.mock("./vramWiring", async (goc) => {
  const that = await goc<typeof import("./vramWiring")>();
  return {
    ...that,
    beginVramAllocation: async (opts: Parameters<typeof that.beginVramAllocation>[0]) => {
      const ve = await that.beginVramAllocation(opts);
      return {
        ...ve,
        release: () => {
          ve.release();
          nemLan.n += 1;
          throw new Error("release() ném (ca thử nghiệm M-2)");
        },
      };
    },
  };
});

describe("Pha 3 Task 1 · M-2 — giấy phép NÉM khi nhả không được nuốt mốc 'đã chết'", () => {
  it("★★★ M-2 — `release()` NÉM ở `proc.on('exit')` ⇒ `stopSidecar()` vẫn khai `true`, sổ vẫn nhả", async () => {
    process.env.LLAMA_SERVER_BIN = "/bin/llama-server";
    process.env.GGUF_VISION_MODEL = "qwen2-vl.gguf";
    process.env.GGUF_VISION_MMPROJ = "mmproj.gguf";
    process.env.LLAMA_VISION_READY_TIMEOUT_MS = "5000";
    // Hạn ngắn để bản HỎNG đỏ NHANH (khai `false` sau 300 ms) thay vì treo 8 giây.
    process.env.LLAMA_VISION_STOP_WAIT_MS = "300";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/health")) {
          return { ok: true, json: async () => ({ status: "ok" }) } as unknown as Response;
        }
        return { ok: false, status: 404, text: async () => "" } as unknown as Response;
      }),
    );

    const { __startSidecarForTests, __stopSidecarForTests } = await import("../llamaVisionSidecar");
    const { snapshot } = await import("./vramBroker");

    await __startSidecarForTests();
    expect(snapshot().leases.some((x) => x.request.owner === "sidecar:vision")).toBe(true);

    const p = __stopSidecarForTests();
    (lastProc.p as FakeChildProc).emit("exit", 0, "SIGTERM");

    await expect(
      p,
      "release() ném không được phép nuốt mốc 'đã chết' — nếu nuốt, lượt chờ hết hạn rồi khai false",
    ).resolves.toBe(true);

    // ⚠ Ca này TỰ KIỂM: nếu lượt ném không xảy ra thì nó chỉ đang chứng minh đường thường, vô nghĩa.
    expect(nemLan.n, "seam phải thật sự ném, nếu không ca này không canh gì cả").toBe(1);
    // Và sổ vẫn nhả THẬT — lượt ném xảy ra SAU khi `broker.release()` đã chạy.
    expect(snapshot().leases.some((x) => x.request.owner === "sidecar:vision")).toBe(false);
  });
});
