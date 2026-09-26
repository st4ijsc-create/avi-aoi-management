/**
 * occtWorker.ts — Worker chuyển STEP/IGES/BREP sang lưới tam giác, CHẠY TRÊN
 * TRÌNH DUYỆT (§10A.1).
 *
 * ★★★ VÌ SAO PHẢI LÀ WORKER: `occt-import-js` là OpenCascade biên dịch sang
 *   WebAssembly. Đọc một file STEP vài chục MB là hàng giây CPU đặc; chạy trên
 *   luồng chính thì giao diện ĐỨNG HÌNH và người dùng tưởng ứng dụng chết. Spec
 *   nói thẳng "không chặn giao diện".
 *
 * ⚠ KHÔNG dùng `dist/occt-import-js-worker.js` có sẵn trong gói: nó gọi
 *   `importScripts('occt-import-js.js')` bằng đường dẫn TƯƠNG ĐỐI, và sau khi
 *   Vite băm tên file thì đường dẫn đó không còn tồn tại — worker chết câm, không
 *   một lỗi nào nổi lên giao diện. File này thay bằng `import` ESM để Vite tự
 *   giải quyết cả `.js` lẫn `.wasm` đi kèm.
 *
 * ⚠ `linearUnit: 'millimeter'` LUÔN LUÔN — xem `docBanVe.DON_VI_OCCT`: ta cố ý
 *   KHÔNG để occt tự quy đổi, vì đơn vị thật do NGƯỜI xác nhận trong hộp thoại
 *   hiệu chỉnh (có thước tỉ lệ + hình người 1,7 m), không do một lời khai trong
 *   file.
 */

/// <reference lib="webworker" />

export interface YeuCauOcct {
  /** Định dạng CAD đặc. glTF KHÔNG đi qua đây (GLTFLoader nạp thẳng). */
  dinhDang: "step" | "iges" | "brep";
  /** Nội dung file. Chuyển bằng transferable để không sao chép vài chục MB. */
  buffer: ArrayBuffer;
}

export interface PhanHoiOcct {
  ok: boolean;
  /** Kết quả thô của occt (`{success, root, meshes}`) khi `ok`. */
  ketQua?: unknown;
  /** Thông điệp lỗi kỹ thuật khi `!ok` — UI dịch riêng, không hiện nguyên văn. */
  loi?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OcctModule = {
  ReadStepFile: (buf: Uint8Array, params: unknown) => unknown;
  ReadIgesFile: (buf: Uint8Array, params: unknown) => unknown;
  ReadBrepFile: (buf: Uint8Array, params: unknown) => unknown;
};

let nap: Promise<OcctModule> | null = null;

/**
 * Nạp module WASM MỘT LẦN cho cả vòng đời worker.
 *
 * ⚠ `locateFile` bắt buộc: emscripten mặc định tìm `occt-import-js.wasm` cạnh
 * file .js theo tên GỐC, nhưng Vite đã băm tên. `new URL(..., import.meta.url)`
 * cho ra URL đã băm ĐÚNG, và đây là mắt xích hay đứt nhất của cả con đường A.
 */
async function napOcct(): Promise<OcctModule> {
  if (!nap) {
    nap = (async () => {
      const mod = await import("occt-import-js");
      const khoiTao = (mod as unknown as { default: (o?: unknown) => Promise<OcctModule> }).default;
      const duongWasm = new URL(
        "occt-import-js/dist/occt-import-js.wasm",
        import.meta.url,
      ).href;
      return khoiTao({
        locateFile: (duong: string) => (duong.endsWith(".wasm") ? duongWasm : duong),
      });
    })();
  }
  return nap;
}

self.onmessage = async (ev: MessageEvent<YeuCauOcct>) => {
  const { dinhDang, buffer } = ev.data;
  try {
    const occt = await napOcct();
    const bytes = new Uint8Array(buffer);
    // ⚠ millimeter LUÔN — người dùng chọn đơn vị thật ở hộp thoại, không phải ở đây.
    const params = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio" };
    const ketQua =
      dinhDang === "step"
        ? occt.ReadStepFile(bytes, params)
        : dinhDang === "iges"
          ? occt.ReadIgesFile(bytes, params)
          : occt.ReadBrepFile(bytes, params);
    const phanHoi: PhanHoiOcct = { ok: true, ketQua };
    (self as unknown as { postMessage: (m: PhanHoiOcct) => void }).postMessage(phanHoi);
  } catch (e) {
    const phanHoi: PhanHoiOcct = {
      ok: false,
      loi: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as { postMessage: (m: PhanHoiOcct) => void }).postMessage(phanHoi);
  }
};
