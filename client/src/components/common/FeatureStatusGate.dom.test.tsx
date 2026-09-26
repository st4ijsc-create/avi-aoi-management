// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho component dùng chung mới
// `FeatureStatusGate` + hàm suy trạng thái `deriveFeatureStatus`. Bốn trang Engineering
// từng mặc định LẠC QUAN `statusQ.data?.enabled ?? true` (hoặc BI QUAN `?? false` ở
// `/engineering`) khi query trạng thái CHƯA xong hoặc LỖI — "chưa biết" bị hiển thị như
// một trong hai trạng thái ĐÃ BIẾT. Bài test này khoá đúng bốn nhánh: loading/off/on/error
// không bao giờ trộn vào nhau, và `deriveFeatureStatus` không bao giờ coi query
// pending/error là `true` hay `false`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  deriveFeatureStatus,
  featureStatusLabel,
  featureStatusTone,
  FeatureStatusGate,
  isFeatureStatusUnsettled,
} from "./FeatureStatusGate";

afterEach(() => {
  cleanup();
});

describe("deriveFeatureStatus — không bao giờ đoán khi chưa có dữ liệu", () => {
  it("query đang tải (isLoading, data undefined) ⇒ 'loading', KHÔNG PHẢI 'on'/'off'", () => {
    expect(
      deriveFeatureStatus({ data: undefined, isLoading: true }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("loading");
  });

  it("query isPending (React Query v5) + data undefined ⇒ 'loading'", () => {
    expect(
      deriveFeatureStatus({ data: undefined, isPending: true }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("loading");
  });

  it("data vẫn undefined dù không cờ pending nào bật (enabled:false trên query) ⇒ vẫn 'loading', không đoán", () => {
    expect(
      deriveFeatureStatus({ data: undefined, isLoading: false, isPending: false }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("loading");
  });

  it("query lỗi (isError) ⇒ 'error' dù data cũ còn nằm trong cache", () => {
    expect(
      deriveFeatureStatus({ data: { enabled: true }, isError: true }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("error");
  });

  it("query xong, cờ bật ⇒ 'on'", () => {
    expect(
      deriveFeatureStatus({ data: { enabled: true }, isLoading: false }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("on");
  });

  it("query xong, cờ tắt ⇒ 'off'", () => {
    expect(
      deriveFeatureStatus({ data: { enabled: false }, isLoading: false }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("off");
  });

  it("query xong nhưng selector không tìm thấy field (undefined) ⇒ 'error', không đoán 'on'", () => {
    expect(
      deriveFeatureStatus({ data: {}, isLoading: false }, (d: { enabled?: boolean }) => d.enabled),
    ).toBe("error");
  });

  // ĐỘT BIẾN (mutation-test bằng tay): nếu ai đó "sửa nhanh" hàm bằng cách quay lại
  // `?? true` (vd `return enabled ?? true` thay vì phân biệt undefined selector = "error"),
  // ca trên ("selector không tìm thấy field") sẽ ĐỎ vì nhận "on" thay vì "error". Ca dưới
  // khoá luôn nhánh pending: nếu ai đó thay điều kiện pending bằng `query.data ? ... : true`
  // (mặc định lạc quan) thì ca đầu ("đang tải") sẽ ĐỎ (nhận "on"/"true" thay vì "loading").
});

describe("isFeatureStatusUnsettled", () => {
  it("loading và error đều 'chưa ổn định' ⇒ true", () => {
    expect(isFeatureStatusUnsettled("loading")).toBe(true);
    expect(isFeatureStatusUnsettled("error")).toBe(true);
  });

  it("on và off đã biết ⇒ false", () => {
    expect(isFeatureStatusUnsettled("on")).toBe(false);
    expect(isFeatureStatusUnsettled("off")).toBe(false);
  });
});

describe("FeatureStatusGate — bốn nhánh hiển thị tách biệt", () => {
  it("'on' ⇒ không hiện gì (không skeleton, không banner)", () => {
    const { container } = render(
      <FeatureStatusGate status="on" offMessage="Tắt (preview)" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("'loading' ⇒ hiện skeleton, KHÔNG hiện chuỗi OFF hay bất kỳ câu nào", () => {
    render(<FeatureStatusGate status="loading" offMessage="Tắt (preview) — đặt cờ FOO_ENABLED=true" />);
    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
    expect(screen.queryByText(/Tắt \(preview\)/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
  });

  it("'off' ⇒ hiện đúng banner thân thiện đã truyền vào, KHÔNG chứa tên biến môi trường", () => {
    render(<FeatureStatusGate status="off" offMessage="Chế độ xem trước — thao tác ghi tạm bị chặn." />);
    const banner = screen.getByTestId("feature-status-off");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toBe("Chế độ xem trước — thao tác ghi tạm bị chặn.");
    // Hợp đồng: offMessage do TRANG truyền vào — bài test này chỉ xác nhận component
    // không tự thêm gì khác (vd không tự nối tên biến); trang tự chịu trách nhiệm không
    // truyền tên biến vào offMessage (xem sửa ở các trang FleetOrchestration/...).
    expect(banner.textContent).not.toMatch(/_ENABLED/);
  });

  it("'error' ⇒ hiện banner lỗi riêng biệt (không phải banner 'off', không rỗng như 'on')", () => {
    render(
      <FeatureStatusGate
        status="error"
        offMessage="Tắt (preview)"
        errorMessage="Không đọc được trạng thái tính năng."
      />,
    );
    expect(screen.getByTestId("feature-status-error")).toHaveTextContent("Không đọc được trạng thái tính năng.");
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
  });

  it("'error' không truyền errorMessage ⇒ vẫn hiện banner lỗi với câu mặc định (không rơi về 'on' im lặng)", () => {
    render(<FeatureStatusGate status="error" offMessage="Tắt (preview)" />);
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
  });
});

describe("featureStatusLabel / featureStatusTone — badge không in literal ON/OFF khi chưa biết", () => {
  const labels = { on: "ON", off: "OFF", loading: "…", error: "?" };

  it("loading ⇒ nhãn riêng, không phải 'OFF'", () => {
    expect(featureStatusLabel("loading", labels)).toBe("…");
    expect(featureStatusLabel("loading", labels)).not.toBe("OFF");
  });

  it("error ⇒ nhãn riêng, không phải 'ON' hay 'OFF'", () => {
    const v = featureStatusLabel("error", labels);
    expect(v).toBe("?");
    expect(v).not.toBe("ON");
    expect(v).not.toBe("OFF");
  });

  it("on/off ⇒ đúng nhãn đã biết", () => {
    expect(featureStatusLabel("on", labels)).toBe("ON");
    expect(featureStatusLabel("off", labels)).toBe("OFF");
  });

  it("tone: on→good, off→warning, loading/error→default (không tô 'warning' khi chưa biết)", () => {
    expect(featureStatusTone("on")).toBe("good");
    expect(featureStatusTone("off")).toBe("warning");
    expect(featureStatusTone("loading")).toBe("default");
    expect(featureStatusTone("error")).toBe("default");
  });
});
