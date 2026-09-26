/**
 * ★ Pha 3 Task 4 — **LƯỚI ĐỐI CHIẾU cho một BẢN SAO HẰNG SỐ.**
 *
 * `vramAdoption.moTaSidecarNhanNuoi()` phải biết CỔNG của sidecar thị giác để trả lời nửa thứ hai
 * của bằng chứng §6 (*"cổng + PID đã biết"*), nhưng nó là **module LÁ** nên không được nhập
 * `llamaVisionSidecar` (module đó kéo theo `aiGgufEngine` + `fs`). ⇒ mặc định `8081` là một **bản
 * sao**, và ràng buộc 12 đòi bản sao phải có lưới: ca dưới đây so thẳng hai con số.
 *
 * ⚠ VÌ SAO PHẢI Ở FILE RIÊNG: nó cần `vi.resetModules()` (hằng `VISION_PORT` của
 * `llamaVisionSidecar` đóng băng lúc nạp module). Trong `adoption.test.ts`, một lượt
 * `resetModules()` giữa chừng làm `await import("./vramBroker")` **bên trong mã sản xuất** trả về
 * một bản sao KHÁC của sổ so với bản mà ca test đang đọc — bốn ca của nhóm D đã đỏ vì đúng bẫy đó.
 * Cùng bài học với GOTCHA của Task 1: *"seam phải ở FILE RIÊNG"*.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const CU = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...CU };
  vi.resetModules();
});

it("★ cổng MẶC ĐỊNH của `moTaSidecarNhanNuoi()` phải KHỚP `getVisionSidecarConfig().port`", async () => {
  delete process.env.LLAMA_VISION_PORT;
  process.env.LLAMA_SERVER_BIN = "D:\\x\\llama-server.exe";
  process.env.GGUF_VISION_MODEL = "m.gguf";
  process.env.GGUF_VISION_MMPROJ = "p.gguf";
  const { moTaSidecarNhanNuoi } = await import("./vramAdoption");
  const { getVisionSidecarConfig } = await import("../llamaVisionSidecar");
  expect(moTaSidecarNhanNuoi()!.port).toBe(getVisionSidecarConfig()!.port);
});

it("★ cổng KHAI TƯỜNG MINH cũng phải khớp — hai bên đọc CÙNG một biến môi trường", async () => {
  process.env.LLAMA_VISION_PORT = "9099";
  process.env.LLAMA_SERVER_BIN = "D:\\x\\llama-server.exe";
  process.env.GGUF_VISION_MODEL = "m.gguf";
  process.env.GGUF_VISION_MMPROJ = "p.gguf";
  const { moTaSidecarNhanNuoi } = await import("./vramAdoption");
  const { getVisionSidecarConfig } = await import("../llamaVisionSidecar");
  expect(moTaSidecarNhanNuoi()!.port).toBe(9099);
  expect(moTaSidecarNhanNuoi()!.port).toBe(getVisionSidecarConfig()!.port);
});

it("chưa khai `LLAMA_SERVER_BIN` ⇒ KHÔNG có hộ nào nhận nuôi được", async () => {
  delete process.env.LLAMA_SERVER_BIN;
  const { moTaSidecarNhanNuoi } = await import("./vramAdoption");
  expect(moTaSidecarNhanNuoi()).toBeNull();
});
