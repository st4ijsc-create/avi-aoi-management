// @vitest-environment jsdom
//
/**
 * modelErrorBoundary.dom.test.tsx — ★★★ CA DƯƠNG: MỘT MODEL HỎNG, CẢNH VẪN SỐNG.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO PHẢI LÀ CA DƯƠNG, KHÔNG PHẢI CA "KHÔNG HỎNG"
 * ════════════════════════════════════════════════════════════════════════════
 * Một bộ test chỉ dựng model TỐT rồi thấy nó hiện KHÔNG chứng minh gì về
 * boundary: cùng kết quả xanh nếu boundary bị gỡ hoàn toàn. Đây đúng lớp lỗi G5
 * ("cổng xanh trên tập rỗng trùng khít cổng xanh của hệ đúng").
 *
 * Nên mọi ca ở đây NÉM THẬT trong lúc render — cách duy nhất `GLTFLoader` báo
 * lỗi — và đo ba thứ mà chỉ boundary đúng mới cho được cùng lúc:
 *   1. Thứ hỏng KHÔNG hiện.
 *   2. Khối thay thế CỦA ĐÚNG MÁY ĐÓ hiện.
 *   3. Anh em cạnh nó VẪN HIỆN (cảnh không sập).
 *
 * ★ jsdom không có WebGL, nên test này KHÔNG dựng `<Canvas>`. Boundary là logic
 *   React thuần (`getDerivedStateFromError`), không chạm three — đo nó ở tầng
 *   React là đo đúng thứ nó là. Phần chạm three (`<Gltf>`) đo bằng e2e/thị giác.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState, type JSX } from "react";

import { ModelErrorBoundary } from "./ModelErrorBoundary";
import { duongDanCungGoc } from "./ModelMay";

/** Component NÉM THẬT — đúng cách `useLoader` báo lỗi nạp. */
function ModelHong({ thongDiep = "404 /uploads/models/hong.glb" }: { thongDiep?: string }): JSX.Element {
  throw new Error(thongDiep);
}

function ModelTot({ id }: { id: number }) {
  return <div data-testid={`model-${id}`}>model {id}</div>;
}

function Khoi({ id }: { id: number }) {
  return <div data-testid={`khoi-${id}`}>khối {id}</div>;
}

let loiConsole: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Boundary CỐ Ý console.error (model hỏng câm là thứ không ai sửa). Nuốt nó ở
  // đây để đầu ra test đọc được — nhưng vẫn ĐẾM, xem ca cuối.
  loiConsole = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  loiConsole.mockRestore();
  cleanup();
});

describe("★★★ CA DƯƠNG — model hỏng không làm sập cảnh", () => {
  it("model NÉM ⇒ fallback hiện, thứ hỏng không hiện", () => {
    render(
      <ModelErrorBoundary nhan="machine:7" fallback={<Khoi id={7} />}>
        <ModelHong />
      </ModelErrorBoundary>,
    );
    expect(screen.getByTestId("khoi-7")).toBeTruthy();
    expect(screen.queryByTestId("model-7")).toBeNull();
  });

  it("★★★ BA MÁY, MỘT HỎNG ⇒ hai máy kia VẪN HIỆN (cảnh sống)", () => {
    render(
      <div>
        <ModelErrorBoundary nhan="machine:1" fallback={<Khoi id={1} />}>
          <ModelTot id={1} />
        </ModelErrorBoundary>
        <ModelErrorBoundary nhan="machine:2" fallback={<Khoi id={2} />}>
          <ModelHong />
        </ModelErrorBoundary>
        <ModelErrorBoundary nhan="machine:3" fallback={<Khoi id={3} />}>
          <ModelTot id={3} />
        </ModelErrorBoundary>
      </div>,
    );
    // Máy hỏng rơi về khối…
    expect(screen.getByTestId("khoi-2")).toBeTruthy();
    expect(screen.queryByTestId("model-2")).toBeNull();
    // …và ĐÚNG MỘT máy rơi. Hai máy kia giữ nguyên model.
    expect(screen.getByTestId("model-1")).toBeTruthy();
    expect(screen.getByTestId("model-3")).toBeTruthy();
    expect(screen.queryByTestId("khoi-1")).toBeNull();
    expect(screen.queryByTestId("khoi-3")).toBeNull();
  });

  it("★ ĐỐI CHỨNG — một boundary bọc CẢ NHÓM thì mất cả nhóm", () => {
    // Ca này chứng minh vì sao `LopModelMay` bọc TỪNG máy. Không có nó, luật
    // "bọc từng cái" chỉ là một lời khuyên không ai đo.
    render(
      <ModelErrorBoundary nhan="ca-nhom" fallback={<Khoi id={0} />}>
        <ModelTot id={1} />
        <ModelHong />
        <ModelTot id={3} />
      </ModelErrorBoundary>,
    );
    expect(screen.getByTestId("khoi-0")).toBeTruthy();
    expect(screen.queryByTestId("model-1")).toBeNull();
    expect(screen.queryByTestId("model-3")).toBeNull();
  });

  it("không có fallback ⇒ null, KHÔNG ném tiếp (cảnh vẫn sống)", () => {
    expect(() =>
      render(
        <div data-testid="canh">
          <ModelErrorBoundary nhan="machine:9">
            <ModelHong />
          </ModelErrorBoundary>
        </div>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("canh")).toBeTruthy();
  });

  it("model TỐT ⇒ hiện model, KHÔNG hiện fallback (đối chứng: boundary không nuốt bừa)", () => {
    render(
      <ModelErrorBoundary nhan="machine:5" fallback={<Khoi id={5} />}>
        <ModelTot id={5} />
      </ModelErrorBoundary>,
    );
    expect(screen.getByTestId("model-5")).toBeTruthy();
    expect(screen.queryByTestId("khoi-5")).toBeNull();
  });
});

describe("khoaLamMoi — người dùng tải tệp mới thì được thử lại", () => {
  /** Bấm nút = đổi URI = đổi khoá; con đổi từ HỎNG sang TỐT. */
  function Khung() {
    const [uri, setUri] = useState("/uploads/models/hong.glb");
    const tot = uri.includes("tot");
    return (
      <div>
        <button data-testid="doi-tep" onClick={() => setUri("/uploads/models/tot.glb")}>
          đổi
        </button>
        <ModelErrorBoundary nhan="machine:7" khoaLamMoi={uri} fallback={<Khoi id={7} />}>
          {tot ? <ModelTot id={7} /> : <ModelHong />}
        </ModelErrorBoundary>
      </div>
    );
  }

  it("★★★ ĐỔI URI ⇒ boundary QUÊN lỗi cũ và thử lại", () => {
    render(<Khung />);
    // Trước: hỏng.
    expect(screen.getByTestId("khoi-7")).toBeTruthy();
    expect(screen.queryByTestId("model-7")).toBeNull();

    // Người dùng tải lên tệp mới.
    fireEvent.click(screen.getByTestId("doi-tep"));

    // Sau: model mới hiện. Không có `khoaLamMoi` thì ô này ở nguyên "khoi-7"
    // cho tới khi reload trang — người dùng đã sửa mà màn hình vẫn khai hỏng.
    expect(screen.getByTestId("model-7")).toBeTruthy();
    expect(screen.queryByTestId("khoi-7")).toBeNull();
  });

  it("KHÔNG đổi khoá ⇒ giữ nguyên fallback (không thử lại vô hạn)", () => {
    const { rerender } = render(
      <ModelErrorBoundary nhan="machine:7" khoaLamMoi="/a.glb" fallback={<Khoi id={7} />}>
        <ModelHong />
      </ModelErrorBoundary>,
    );
    expect(screen.getByTestId("khoi-7")).toBeTruthy();
    rerender(
      <ModelErrorBoundary nhan="machine:7" khoaLamMoi="/a.glb" fallback={<Khoi id={7} />}>
        <ModelHong />
      </ModelErrorBoundary>,
    );
    expect(screen.getByTestId("khoi-7")).toBeTruthy();
  });
});

describe("onLoi — báo ra ngoài để UI hiện huy hiệu", () => {
  it("gọi đúng MỘT lần với thông điệp THẬT của lỗi nạp", () => {
    const bat = vi.fn();
    render(
      <ModelErrorBoundary nhan="machine:7" fallback={<Khoi id={7} />} onLoi={bat}>
        <ModelHong thongDiep="Unexpected token in JSON at position 0" />
      </ModelErrorBoundary>,
    );
    expect(bat).toHaveBeenCalledTimes(1);
    // Nội dung KHÁC RỖNG và đúng thứ ném ra — không phải một Error chung chung.
    expect((bat.mock.calls[0][0] as Error).message).toBe(
      "Unexpected token in JSON at position 0",
    );
  });

  it("★ boundary VẪN console.error — model hỏng câm là thứ không ai sửa", () => {
    render(
      <ModelErrorBoundary nhan="machine:42" fallback={<Khoi id={42} />}>
        <ModelHong />
      </ModelErrorBoundary>,
    );
    const cauCuaTa = loiConsole.mock.calls.filter((c) =>
      String(c[0] ?? "").includes("[twin3d] model 3D hỏng"),
    );
    expect(cauCuaTa.length).toBeGreaterThan(0);
    // Log phải nói MÁY NÀO — "một model nào đó hỏng" không sửa được.
    expect(String(cauCuaTa[0][0])).toContain("machine:42");
  });
});

describe("duongDanCungGoc — allowlist §7.4 / RB-5", () => {
  it("nhận đường dẫn nội bộ", () => {
    expect(duongDanCungGoc("/uploads/models/machine-7-1.glb")).toBe(true);
    expect(duongDanCungGoc("/uploads/twin-assets/abc.glb")).toBe(true);
  });

  it("★★★ TỪ CHỐI `//evil.com/x.glb` — giao thức-tương-đối LÀ tuyệt đối", () => {
    // Phép kiểm chỉ hỏi startsWith("/") sẽ cho ca này QUA và trình duyệt đi tải
    // từ evil.com. Đây là ca duy nhất trong khối này mà một bản vá cẩu thả trượt.
    expect(duongDanCungGoc("//evil.com/x.glb")).toBe(false);
  });

  it("từ chối http/https tuyệt đối và chuỗi rỗng", () => {
    expect(duongDanCungGoc("https://cdn.example.com/a.glb")).toBe(false);
    expect(duongDanCungGoc("http://cdn.example.com/a.glb")).toBe(false);
    expect(duongDanCungGoc("")).toBe(false);
    expect(duongDanCungGoc(null)).toBe(false);
    expect(duongDanCungGoc(undefined)).toBe(false);
  });

  it("từ chối đường dẫn tương đối không có gốc", () => {
    expect(duongDanCungGoc("models/a.glb")).toBe(false);
  });
});
