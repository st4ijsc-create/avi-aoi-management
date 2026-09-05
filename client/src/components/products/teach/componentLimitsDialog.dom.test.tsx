// @vitest-environment jsdom
//
// BG-129 Mục 2 (Lô 9) — trả món PARK của Lô 2: ca "onError end-to-end" của `ComponentLimitsDialog`
// đã park ở `lo-2-report.md` (mục "VÒNG SỬA 1") vì hạ tầng render-test KHÔNG TỒN TẠI khi đó (0
// jsdom, 0 `@testing-library/react` — xem docblock đó, và docblock `componentLimitsDialogLogic.ts`
// tự khai "test HÀM THUẦN, không render"). BG-129 Mục 1 (cùng lô) đã mở hạ tầng — bài test này là
// LẦN ĐẦU TIÊN dialog thật được render qua `@testing-library/react`, KHÔNG mock component ra
// ngoài (chỉ mock `@/lib/trpc` — hợp đồng mạng — và `sonner` — để spy).
//
// Mutation THẬT dialog gọi khi Lưu là `measurementPoint.setLimitsBatch` (`ComponentLimitsDialog.tsx`
// dòng `trpc.measurementPoint.setLimitsBatch.useMutation`) — brief Lô 9 Mục 2 viết
// "measurementPoint.update" nhưng ĐỌC MÃ xác nhận dialog này KHÔNG BAO GIỜ gọi `update` (đó là
// mutation của một dialog khác, MeasurementPointEditor); sửa theo ĐÚNG mutation thật, không theo
// brief (đúng luật dự án: brief sai thì đọc mã, không đoán theo brief — ghi trong report).
//
// Hai ca hành vi `onError` (`ComponentLimitsDialog.tsx` dòng ~199-210):
//   1. Lỗi HÌNH DẠNG cần-duyệt (`docLoiCanDuyetNguong` nhận diện: FORBIDDEN + appCode
//      OPERATION_FAILED + appParams.operation==="editThresholdDirectly") ⇒ dialog KHÔNG đóng,
//      Alert cần-duyệt HIỆN (tiêu đề "Chưa lưu" + nút "Gửi yêu cầu duyệt", Lô 7 Mục 3).
//   2. Lỗi THƯỜNG (không khớp hình dạng trên) ⇒ dialog KHÔNG đóng, KHÔNG có Alert cần-duyệt,
//      `toastTrpcError`→`toast.error` được gọi (assert qua spy `sonner`).
//
// Cả hai ca đều assert dialog CÒN MỞ bằng cách DOM còn hiện field/nút Lưu (KHÔNG dùng cờ nội bộ
// `open` — component cha giữ `open`, test chỉ điều khiển được nó qua `onOpenChange` KHÔNG được gọi
// với `false` — assert trực tiếp mock `onOpenChange` đó, cách đo mạnh nhất và không suy luận DOM).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const setLimitsBatchState: {
  mutate: ReturnType<typeof vi.fn>;
  onError?: (err: unknown) => void;
  onSuccess?: (res: unknown) => void;
  isPending: boolean;
} = { mutate: vi.fn(), isPending: false };

const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      cayDay: {
        listComponents: { invalidate: vi.fn() },
        thongKeGioiHan: { invalidate: vi.fn() },
      },
    }),
    measurementPoint: {
      getById: {
        // donMode ON nhưng KHÔNG trả `data` — tránh nhánh canvas `nguonAnh==="he"` (không cần
        // mock MeasurementPointCanvas cho bài test onError này; xem docblock trên, out-of-scope).
        useQuery: () => ({ data: undefined, isLoading: false, isFetching: false }),
      },
      setLimitsBatch: {
        useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
          setLimitsBatchState.onSuccess = opts.onSuccess;
          setLimitsBatchState.onError = opts.onError;
          return {
            mutate: setLimitsBatchState.mutate,
            isPending: setLimitsBatchState.isPending,
          };
        },
      },
    },
    thresholdApproval: {
      request: {
        useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
      },
    },
  },
}));

import { ComponentLimitsDialog } from "./ComponentLimitsDialog";
import type { ComponentLimitsRow } from "./teachTreeLogic";

const ROW: ComponentLimitsRow = {
  id: 501,
  componentExtId: "R101",
  name: "R101",
  roi: "—",
  coGioiHan: false,
  gioiHanHienThi: {},
};

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <ComponentLimitsDialog
      rows={[ROW]}
      captureRowId={1}
      productModelId={1}
      machineId={1}
      open={true}
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

/** Nhập một số hợp lệ vào lowerLimit rồi bấm Lưu — điều kiện tối thiểu để `coTheLuu` cho qua
 * (xem `componentLimitsDialogLogic.ts: coTheLuu` — cần ≥1 trường thay đổi + form không lỗi). */
function nhapVaLuu() {
  const input = document.getElementById("cld-lowerLimit") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "1.5" } });
  // `t("common.save")` KHÔNG có default value truyền vào (`ComponentLimitsDialog.tsx:510`) — không
  // có i18next instance trong test (đúng chủ đích, xem docblock đầu file), react-i18next rơi về
  // hiện NGUYÊN KHOÁ "common.save" thay vì bản dịch "Lưu"/"Save" (xác nhận bằng RED đầu tiên: query
  // theo "Save" không thấy nút nào — screen.debug() in ra text nút là "common.save").
  const nutLuu = screen.getByRole("button", { name: "common.save" });
  fireEvent.click(nutLuu);
}

const LOI_CAN_DUYET = {
  data: {
    code: "FORBIDDEN",
    appCode: "OPERATION_FAILED",
    appParams: { operation: "editThresholdDirectly", reason: "productLifecycleRequiresApproval" },
  },
  message: "Bạn không có quyền sửa trực tiếp",
};

const LOI_THUONG = {
  data: { code: "BAD_REQUEST" },
  message: "Đầu vào không hợp lệ",
};

beforeEach(() => {
  setLimitsBatchState.mutate = vi.fn();
  setLimitsBatchState.isPending = false;
  toastError.mockClear();
  toastSuccess.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ComponentLimitsDialog — onError end-to-end (món park Lô 2, BG-129)", () => {
  it("ca 1 — lỗi HÌNH DẠNG cần-duyệt: dialog KHÔNG đóng + Alert cần-duyệt hiện", () => {
    const { onOpenChange } = renderDialog();
    nhapVaLuu();

    expect(setLimitsBatchState.mutate).toHaveBeenCalledTimes(1);
    // Gọi ĐÚNG callback onError mà component đã đăng ký với useMutation — mô phỏng trpc thật
    // reject, KHÔNG gọi hàm logic thuần trực tiếp (đó là thứ Lô 2 park lại vì không exercise
    // được component thật). `act()` — callback gọi `setCanDuyet` (state React) NGOÀI một sự kiện
    // DOM (`fireEvent` tự bọc act cho click, nhưng lời gọi callback trực tiếp này thì không).
    act(() => {
      setLimitsBatchState.onError!(LOI_CAN_DUYET);
    });

    // (a) dialog KHÔNG tự đóng — cha không hề nhận được onOpenChange(false).
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // (b) Alert cần-duyệt HIỆN — tiêu đề "Chưa lưu" + nút "Gửi yêu cầu duyệt" (Lô 7 Mục 3).
    expect(screen.getByText("Chưa lưu")).toBeInTheDocument();
    // `thongBaoCanDuyet` (componentLimitsDialogLogic.ts) chọn câu theo `lyDo`: LOI_CAN_DUYET dưới
    // mang reason "productLifecycleRequiresApproval" ⇒ câu LIFECYCLE (không phải câu "chương trình
    // kiểm phát hành", dành riêng cho reason "releasedProgramRequiresApproval") — RED đầu tiên ở
    // đây đã bắt đúng: asserted nhầm câu "chương trình" trong khi input test gửi lyDo lifecycle.
    expect(
      screen.getByText(
        "Chưa lưu — sản phẩm đang hoạt động, thay đổi giới hạn phải qua hàng đợi duyệt ngưỡng",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gửi yêu cầu duyệt" })).toBeInTheDocument();
    // Field vẫn còn hiện — giá trị người dùng vừa nhập KHÔNG mất (dialog không reset/đóng).
    expect((document.getElementById("cld-lowerLimit") as HTMLInputElement).value).toBe("1.5");
  });

  it("ca 2 — lỗi THƯỜNG: dialog KHÔNG đóng + KHÔNG có Alert cần-duyệt + toast.error được gọi", () => {
    const { onOpenChange } = renderDialog();
    nhapVaLuu();

    expect(setLimitsBatchState.mutate).toHaveBeenCalledTimes(1);
    act(() => {
      setLimitsBatchState.onError!(LOI_THUONG);
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText("Chưa lưu")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gửi yêu cầu duyệt" })).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
