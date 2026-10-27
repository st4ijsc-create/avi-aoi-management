// @vitest-environment jsdom
//
// R1b-2b-2 — bề mặt ExecutiveMobile (hộp AlertDialog xác nhận "Duyệt" + toast) khi `aiCopilot.confirmAction` từ chối VĨNH VIỄN
// lệnh AI mức ≥ 4 bằng lỗi tRPC FORBIDDEN `SCADA_AI_LEVEL_TOO_HIGH` (data.appParams {ma, level:4}):
//   (1) hộp xác nhận ĐÓNG (setConfirmTarget(null) chạy trước mutateAsync) và toast.error nhận câu đã dịch;
//   (2) câu errors.SCADA_AI_LEVEL_TOO_HIGH (vi THẬT, chứa "mức tác động 4") — toast.error gọi đúng 1 lần, không toast thứ hai;
//   (3) bề mặt dạng toast: sau khi hộp đóng, nút "Duyệt" TRONG HỘP không còn; confirmAction đã gọi đúng 1 lần.
//       Máy chủ giữ nguyên hàng đề xuất ⇒ nút "Duyệt" ở hàng danh sách bị KHOÁ (không mở lại hộp để bấm xác nhận lần nữa).
// Đối chứng: lỗi khác (SCADA_ROLE_FLOOR) ⇒ toast câu khác, không phải câu mức tác động.
// i18n THẬT (vi.json, mapTrpcError thật); chỉ mock hạ tầng (trpc, quyền, sonner, wouter, ContextDrawer).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const H = vi.hoisted(() => ({ confirm: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: H.toastError, success: H.toastSuccess, warning: vi.fn() } }));
vi.mock("wouter", () => ({ useLocation: () => ["/", () => undefined], Link: ({ children }: { children: unknown }) => <a>{children as never}</a> }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: () => true, isAdmin: true }) }));
vi.mock("@/components/workspace/ContextDrawer", () => ({ ContextDrawer: () => null }));
vi.mock("@/lib/trpc", () => {
  const q = (data?: unknown) => ({ useQuery: () => ({ data, isLoading: false, isFetching: false, isError: false, dataUpdatedAt: 0, refetch: async () => undefined }) });
  const mut = () => ({ useMutation: () => ({ isPending: false, mutate: () => undefined, mutateAsync: async () => ({ ok: true }) }) });
  return {
    trpc: {
      useUtils: () => ({ aiInbox: { list: { invalidate: () => undefined }, count: { invalidate: () => undefined } }, aiInsight: { list: { invalidate: () => undefined } } }),
      dashboard: { getStats: q(undefined) },
      mqttClient: { getAllOEE: q(undefined) },
      warRoom: { briefing: q(undefined) },
      aiInsight: { list: q([]), setStatus: mut() },
      executiveReport: { latest: q(undefined) },
      thresholdApproval: { list: q([]) },
      aiInbox: {
        list: q({ items: [{ id: "act-1", type: "proposal", title: "Đặt SP máy A", actions: ["approve", "dismiss"], actionId: "act-1", token: "act-1", tool: "set_machine_param" }] }),
        dismiss: mut(),
      },
      programming: { listDeployApprovals: q([]) },
      aiCopilot: { confirmAction: { useMutation: () => ({ isPending: false, mutateAsync: H.confirm }) } },
    },
  };
});

import ExecutiveMobile from "./ExecutiveMobile";

const CAU = (vi_ as any).errors.SCADA_AI_LEVEL_TOO_HIGH.replace("{{level}}", "4") as string;
const loi = (appCode: string, appParams?: object) =>
  Object.assign(new Error("FORBIDDEN"), { data: { code: "FORBIDDEN", appCode, appParams } });

/** Mở hộp xác nhận từ hàng đề xuất rồi bấm "Duyệt" TRONG hộp. */
async function duyetTrongHop() {
  render(<ExecutiveMobile />);
  fireEvent.click(await screen.findByRole("button", { name: /^Duyệt: Đặt SP máy A$/ }));
  const hop = await screen.findByRole("alertdialog");
  fireEvent.click(within(hop).getByRole("button", { name: /^Duyệt$/ }));
}

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  H.confirm.mockReset();
  H.toastError.mockReset();
  H.toastSuccess.mockReset();
});
afterEach(() => cleanup());

describe("ExecutiveMobile — MUC_QUA_CAO (SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("câu vi thật chứa 'mức tác động 4' (hàng rào chống test rỗng)", () => {
    expect(CAU).toContain("mức tác động 4");
  });

  it("★ SCADA_AI_LEVEL_TOO_HIGH ⇒ hộp đóng, toast.error đúng 1 lần với câu đã dịch, confirmAction gọi đúng 1 lần", async () => {
    H.confirm.mockRejectedValue(loi("SCADA_AI_LEVEL_TOO_HIGH", { ma: "X", level: 4 }));
    await duyetTrongHop();
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).toHaveBeenCalledWith(CAU);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // Hộp xác nhận đã đóng ⇒ không còn nút xác nhận nào để bấm lại.
    expect(H.confirm).toHaveBeenCalledTimes(1);
    expect(H.toastSuccess).not.toHaveBeenCalled();
    // Máy chủ GIỮ NGUYÊN hàng ⇒ nút Duyệt của hàng bị khoá: bấm không mở lại hộp, không gọi confirmAction lần hai.
    const nutHang = screen.getByRole("button", { name: /^Duyệt: Đặt SP máy A$/ });
    expect(nutHang).toBeDisabled();
    fireEvent.click(nutHang);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(H.confirm).toHaveBeenCalledTimes(1);
    expect(H.toastError).toHaveBeenCalledTimes(1);
  });

  it("đối chứng: lỗi khác (SCADA_ROLE_FLOOR) ⇒ toast.error một lần nhưng KHÔNG phải câu mức tác động", async () => {
    H.confirm.mockRejectedValue(loi("SCADA_ROLE_FLOOR"));
    await duyetTrongHop();
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError).not.toHaveBeenCalledWith(CAU);
    expect(String(H.toastError.mock.calls[0][0])).not.toContain("mức tác động 4");
    expect(H.confirm).toHaveBeenCalledTimes(1);
  });
});
