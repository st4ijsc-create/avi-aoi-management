/**
 * xuatAnh.unit.test.ts — Export PNG (§11.9 #57).
 *
 * ★★★ G20 — import `./xuatAnh`, module giao hàng.
 * ★★★ Chỉ báo quan trọng nhất ở đây KHÔNG phải "có ra data URL không" mà là
 *   **THỨ TỰ**: `veLai()` phải chạy TRƯỚC `toDataURL()`. Với
 *   `preserveDrawingBuffer=false` (mặc định của three, đo tại
 *   `node_modules/three/src/renderers/WebGLRenderer.js:82`), sai thứ tự cho
 *   một ảnh TRẮNG mà không có lỗi nào — nên test phải đo được thứ tự, không
 *   chỉ đo kết quả.
 */

import { describe, expect, it } from "vitest";

import {
  chupCanvas,
  lamSlug,
  taiXuong,
  tenTepAnh,
  xuatPng,
  type CanvasChupDuoc,
  type DocTaiXuong,
} from "./xuatAnh";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Canvas giả ghi lại THỨ TỰ các lời gọi. */
function canvasGia(nhatKy: string[], tuyChon: { url?: string; rong?: number; cao?: number; nem?: boolean } = {}) {
  return {
    width: tuyChon.rong ?? 1280,
    height: tuyChon.cao ?? 720,
    toDataURL: () => {
      nhatKy.push("toDataURL");
      if (tuyChon.nem) throw new Error("SecurityError");
      return tuyChon.url ?? PNG;
    },
  } satisfies CanvasChupDuoc;
}

function docGia(nhatKy: string[], tuyChon: { nem?: boolean } = {}) {
  const the: Record<string, unknown> = {};
  return {
    doc: {
      createElement: () => {
        if (tuyChon.nem) throw new Error("no");
        return {
          set href(v: string) {
            the.href = v;
          },
          get href() {
            return the.href as string;
          },
          set download(v: string) {
            the.download = v;
          },
          get download() {
            return the.download as string;
          },
          style: {} as Record<string, string>,
          click: () => void nhatKy.push("click"),
          remove: () => void nhatKy.push("remove"),
        };
      },
      body: {
        appendChild: () => void nhatKy.push("appendChild"),
        removeChild: () => void nhatKy.push("removeChild"),
      },
    } as unknown as DocTaiXuong,
    the,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */

describe("lamSlug", () => {
  it("★ BỎ DẤU tiếng Việt thay vì băm chữ ra từng mảnh", () => {
    expect(lamSlug("Tầng trệt")).toBe("tang-tret");
    expect(lamSlug("Xưởng SIM-FAC")).toBe("xuong-sim-fac");
    expect(lamSlug("Đông Đô")).toBe("dong-do");
  });

  it("★ loại ký tự Windows cấm trong tên tệp", () => {
    const s = lamSlug('a\\b/c:d*e?f"g<h>i|j');
    expect(s).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("không để lại dấu gạch thừa hai đầu", () => {
    expect(lamSlug("  --- Tầng 1 --- ")).toBe("tang-1");
  });

  it("chuỗi toàn ký tự lạ ⇒ rỗng (người gọi phải xử lý)", () => {
    expect(lamSlug("???")).toBe("");
  });

  it("cắt ở 60 ký tự", () => {
    expect(lamSlug("a".repeat(200)).length).toBe(60);
  });
});

describe("tenTepAnh — TẤT ĐỊNH (nhận Date, không tự gọi new Date)", () => {
  const khi = new Date(2026, 8, 7, 14, 30, 5); // 2026-09-07 14:30:05 giờ ĐỊA PHƯƠNG

  it("dựng đúng khuôn twin-<slug>-<ngày>-<giờ>.png", () => {
    expect(tenTepAnh("Tầng trệt", khi)).toBe("twin-tang-tret-20260907-143005.png");
  });

  it("★ CÙNG đầu vào ⇒ CÙNG đầu ra (không có Date.now ẩn)", () => {
    expect(tenTepAnh("X", khi)).toBe(tenTepAnh("X", khi));
  });

  it("★ ĐỔI thời điểm ⇒ ĐỔI tên — không phải hằng số", () => {
    expect(tenTepAnh("X", new Date(2026, 0, 1, 0, 0, 0))).not.toBe(tenTepAnh("X", khi));
  });

  it("nhãn không slug được ⇒ vẫn có tên tệp hợp lệ", () => {
    expect(tenTepAnh("???", khi)).toBe("twin-20260907-143005.png");
  });

  it("đệm 0 cho tháng/ngày/giờ một chữ số", () => {
    expect(tenTepAnh("a", new Date(2026, 0, 2, 3, 4, 5))).toBe("twin-a-20260102-030405.png");
  });
});

describe("chupCanvas — THỨ TỰ là bản chất", () => {
  it("★★★ `veLai()` chạy TRƯỚC `toDataURL()` — nếu ngược lại, ảnh TRẮNG", () => {
    const nhatKy: string[] = [];
    const kq = chupCanvas(canvasGia(nhatKy), () => void nhatKy.push("veLai"));
    expect(nhatKy).toEqual(["veLai", "toDataURL"]);
    expect(kq.dataUrl).toBe(PNG);
    expect(kq.lyDo).toBeNull();
  });

  it("trả kích thước THẬT của canvas", () => {
    const kq = chupCanvas(canvasGia([], { rong: 1920, cao: 1080 }), () => {});
    expect([kq.rong, kq.cao]).toEqual([1920, 1080]);
  });

  it("canvas null ⇒ lyDo 'khong-canvas', KHÔNG gọi veLai", () => {
    const nhatKy: string[] = [];
    const kq = chupCanvas(null, () => void nhatKy.push("veLai"));
    expect(kq.lyDo).toBe("khong-canvas");
    expect(kq.dataUrl).toBeNull();
    expect(nhatKy).toEqual([]);
  });

  it("★ canvas 0×0 ⇒ 'canvas-rong' — không giao một tệp 0 byte", () => {
    const kq = chupCanvas(canvasGia([], { rong: 0, cao: 0 }), () => {});
    expect(kq.lyDo).toBe("canvas-rong");
    expect(kq.dataUrl).toBeNull();
  });

  it("★ toDataURL NÉM (canvas tainted) ⇒ 'chup-loi', không nổ ra ngoài", () => {
    const kq = chupCanvas(canvasGia([], { nem: true }), () => {});
    expect(kq.lyDo).toBe("chup-loi");
    expect(kq.dataUrl).toBeNull();
  });

  it("★ toDataURL trả chuỗi KHÔNG phải PNG ⇒ 'chup-loi'", () => {
    const kq = chupCanvas(canvasGia([], { url: "data:," }), () => {});
    expect(kq.lyDo).toBe("chup-loi");
  });
});

describe("taiXuong", () => {
  it("★★★ appendChild TRƯỚC click — Firefox bỏ qua click trên <a> ngoài document", () => {
    const nhatKy: string[] = [];
    const { doc } = docGia(nhatKy);
    expect(taiXuong(doc, PNG, "a.png")).toBe(true);
    expect(nhatKy.indexOf("appendChild")).toBeLessThan(nhatKy.indexOf("click"));
  });

  it("★ dọn node sau khi bấm — không rò <a> vào DOM", () => {
    const nhatKy: string[] = [];
    const { doc } = docGia(nhatKy);
    taiXuong(doc, PNG, "a.png");
    expect(nhatKy.indexOf("remove")).toBeGreaterThan(nhatKy.indexOf("click"));
  });

  it("đặt đúng href và download", () => {
    const nhatKy: string[] = [];
    const { doc, the } = docGia(nhatKy);
    taiXuong(doc, PNG, "twin-x.png");
    expect(the.href).toBe(PNG);
    expect(the.download).toBe("twin-x.png");
  });

  it("doc null / dataUrl rỗng ⇒ false, không ném", () => {
    expect(taiXuong(null, PNG, "a.png")).toBe(false);
    expect(taiXuong(docGia([]).doc, "", "a.png")).toBe(false);
  });

  it("createElement ném ⇒ false, không nổ ra ngoài", () => {
    expect(taiXuong(docGia([], { nem: true }).doc, PNG, "a.png")).toBe(false);
  });
});

describe("xuatPng — hàm mà NÚT gọi", () => {
  const khi = new Date(2026, 8, 7, 14, 30, 5);

  it("★★★ CA DƯƠNG đầy-đủ-đường: vẽ lại → chụp → gắn → bấm → dọn", () => {
    const nhatKy: string[] = [];
    const { doc } = docGia(nhatKy);
    const kq = xuatPng(canvasGia(nhatKy), () => void nhatKy.push("veLai"), doc, "Tầng trệt", khi);
    expect(kq.xong).toBe(true);
    expect(kq.lyDo).toBeNull();
    expect(kq.ten).toBe("twin-tang-tret-20260907-143005.png");
    expect(nhatKy).toEqual(["veLai", "toDataURL", "appendChild", "click", "remove"]);
  });

  it("★ canvas hỏng ⇒ KHÔNG bấm tải, và lyDo nói đúng nguyên nhân", () => {
    const nhatKy: string[] = [];
    const { doc } = docGia(nhatKy);
    const kq = xuatPng(null, () => {}, doc, "x", khi);
    expect(kq.xong).toBe(false);
    expect(kq.lyDo).toBe("khong-canvas");
    expect(nhatKy).not.toContain("click");
  });

  it("★ chụp được nhưng tải hỏng ⇒ lyDo 'tai-loi' (phân biệt được hai kiểu hỏng)", () => {
    const kq = xuatPng(canvasGia([]), () => {}, null, "x", khi);
    expect(kq.xong).toBe(false);
    expect(kq.lyDo).toBe("tai-loi");
  });

  it("tên tệp có mặt kể cả khi hỏng — để thông báo lỗi nói được nó định lưu gì", () => {
    expect(xuatPng(null, () => {}, null, "Tầng trệt", khi).ten).toBe(
      "twin-tang-tret-20260907-143005.png",
    );
  });
});
