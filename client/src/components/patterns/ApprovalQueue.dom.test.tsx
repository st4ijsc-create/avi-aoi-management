// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — ApprovalQueue / TransitionDialog: luồng duyệt/từ chối dùng chung cho ECN và
// CR của Standards (FE2 §4.5). Hai bất biến PHẢI giữ khi đưa vào component chung (plan Global
// Constraint 3, doc 81 §1.5):
//   1. maker-checker: người tạo KHÔNG được phê duyệt mục của chính mình (server cũng chặn: ecnService
//      SoD, equipmentStandardsRouter selfReviewChangeRequest) — client chặn sớm và nói rõ lý do;
//      người xem xét không được phê duyệt khi trang khai `segregateFrom: ["reviewer"]` (ECN-05).
//   2. từ chối BẮT BUỘC có lý do (chuỗi trắng không tính), lý do đi vào `onTransition`.
// Không biết người dùng hiện tại ⇒ không cho quyết định (không đoán).
import { afterEach, beforeAll, describe, expect, it, vi as vitestVi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import {
  ApprovalQueue,
  TransitionDialog,
  checkSegregation,
  type ApprovalItem,
  type TransitionAction,
} from "./ApprovalQueue";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

const APPROVE: TransitionAction = { key: "approve", label: "Phê duyệt", kind: "approve", segregateFrom: ["reviewer"] };
const REJECT: TransitionAction = { key: "reject", label: "Từ chối", kind: "reject" };
const REVIEW: TransitionAction = { key: "review", label: "Bắt đầu xem xét", kind: "advance", segregateFrom: ["author"] };

function item(over: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 1,
    key: "ECN-0003",
    title: "Đổi keo SMT",
    status: "Đang xem xét",
    authorId: 5,
    authorName: "Kỹ sư A",
    reviewerId: 7,
    actions: [APPROVE, REJECT],
    ...over,
  };
}

function rowOf(key: string) {
  return screen.getByRole("row", { name: new RegExp(key) });
}

describe("checkSegregation — thuần, khớp luật server", () => {
  it("approve: tác giả bị chặn (luôn, không cần khai)", () => {
    expect(checkSegregation({ kind: "approve" }, { currentUserId: 5, authorId: 5 })).toEqual({ allowed: false, reason: "author" });
  });
  it("approve + segregateFrom reviewer: người xem xét bị chặn", () => {
    expect(checkSegregation(APPROVE, { currentUserId: 7, authorId: 5, reviewerId: 7 })).toEqual({ allowed: false, reason: "reviewer" });
  });
  it("tác giả hệ thống (null / ≤0) coi là không-phải-mình (như ecnService)", () => {
    expect(checkSegregation({ kind: "approve" }, { currentUserId: 5, authorId: null })).toEqual({ allowed: true });
    expect(checkSegregation({ kind: "approve" }, { currentUserId: 0, authorId: 0 })).toEqual({ allowed: false, reason: "userUnknown" });
    expect(checkSegregation({ kind: "approve" }, { currentUserId: 5, authorId: -1 })).toEqual({ allowed: true });
  });
  it("không biết người dùng hiện tại ⇒ chặn mọi hành động cần tách vai", () => {
    expect(checkSegregation({ kind: "approve" }, { currentUserId: null, authorId: 5 })).toEqual({ allowed: false, reason: "userUnknown" });
    expect(checkSegregation({ kind: "reject" }, { currentUserId: null, authorId: 5 })).toEqual({ allowed: false, reason: "userUnknown" });
  });
  it("reject không khai tách vai ⇒ tác giả được từ chối (rút lại) như ECN hiện nay", () => {
    expect(checkSegregation(REJECT, { currentUserId: 5, authorId: 5 })).toEqual({ allowed: true });
  });
});

describe("ApprovalQueue — maker-checker", () => {
  it("tác giả: nút Phê duyệt bị khoá và nói lý do; Từ chối vẫn mở (trang không khai tách vai)", () => {
    render(<ApprovalQueue items={[item()]} status="ready" currentUserId={5} onTransition={() => {}} />);
    const row = rowOf("ECN-0003");
    const approve = within(row).getByRole("button", { name: "Phê duyệt" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(vi.layoutKit.approval.sodAuthor);
    expect(within(row).getByRole("button", { name: "Từ chối" })).toBeEnabled();
  });

  it("người đã xem xét: Phê duyệt bị khoá (segregateFrom reviewer)", () => {
    render(<ApprovalQueue items={[item()]} status="ready" currentUserId={7} onTransition={() => {}} />);
    const approve = within(rowOf("ECN-0003")).getByRole("button", { name: "Phê duyệt" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(vi.layoutKit.approval.sodReviewer);
  });

  it("chưa biết người dùng ⇒ mọi quyết định bị khoá", () => {
    render(<ApprovalQueue items={[item()]} status="ready" currentUserId={null} onTransition={() => {}} />);
    const row = rowOf("ECN-0003");
    for (const name of ["Phê duyệt", "Từ chối"]) {
      expect(within(row).getByRole("button", { name })).toBeDisabled();
    }
  });

  it("người khác: Phê duyệt mở sheet, xác nhận ⇒ onTransition(item, action, ý kiến)", async () => {
    const onTransition = vitestVi.fn().mockResolvedValue(undefined);
    render(<ApprovalQueue items={[item()]} status="ready" currentUserId={9} onTransition={onTransition} />);
    fireEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Phê duyệt" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveAttribute("data-slot", "sheet-content");
    fireEvent.change(within(sheet).getByLabelText(vi.layoutKit.approval.commentLabel), { target: { value: "  đạt  " } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Phê duyệt" }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledTimes(1));
    expect(onTransition.mock.calls[0][1]).toBe(APPROVE);
    expect(onTransition.mock.calls[0][2]).toBe("đạt");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("hành động advance có tách vai: tác giả bị khoá; người khác gọi thẳng, không mở sheet", async () => {
    const onTransition = vitestVi.fn();
    const it1 = item({ actions: [REVIEW] });
    const { unmount } = render(<ApprovalQueue items={[it1]} status="ready" currentUserId={5} onTransition={onTransition} />);
    expect(within(rowOf("ECN-0003")).getByRole("button", { name: "Bắt đầu xem xét" })).toBeDisabled();
    unmount();
    render(<ApprovalQueue items={[it1]} status="ready" currentUserId={9} onTransition={onTransition} />);
    fireEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Bắt đầu xem xét" }));
    expect(onTransition).toHaveBeenCalledWith(it1, REVIEW, undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ApprovalQueue — từ chối bắt buộc lý do", () => {
  it("lý do trống/chỉ khoảng trắng ⇒ nút Từ chối trong sheet bị khoá; có lý do ⇒ gửi lý do đã trim", async () => {
    const onTransition = vitestVi.fn().mockResolvedValue(undefined);
    render(<ApprovalQueue items={[item()]} status="ready" currentUserId={9} onTransition={onTransition} />);
    fireEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Từ chối" }));
    const sheet = await screen.findByRole("dialog");
    const confirm = within(sheet).getByRole("button", { name: "Từ chối" });
    expect(confirm).toBeDisabled();
    const box = within(sheet).getByLabelText(vi.layoutKit.approval.reasonLabel);
    expect(box).toBeRequired();
    fireEvent.change(box, { target: { value: "    " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(box, { target: { value: "  Thiếu phân tích tác động " } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onTransition).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), REJECT, "Thiếu phân tích tác động"));
  });

  it("minReasonLength của hành động được tôn trọng", async () => {
    render(
      <ApprovalQueue
        items={[item({ actions: [{ ...REJECT, minReasonLength: 10 }] })]}
        status="ready"
        currentUserId={9}
        onTransition={() => {}}
      />,
    );
    fireEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Từ chối" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText(vi.layoutKit.approval.reasonLabel), { target: { value: "ngắn" } });
    expect(within(sheet).getByRole("button", { name: "Từ chối" })).toBeDisabled();
    expect(within(sheet).getByText("Lý do cần tối thiểu 10 ký tự.")).toBeInTheDocument();
  });

  it("onTransition lỗi ⇒ sheet GIỮ mở (người dùng không mất lý do vừa gõ)", async () => {
    const onTransition = vitestVi.fn().mockRejectedValue(new Error("SOD"));
    render(<ApprovalQueue items={[item()]} status="ready" currentUserId={9} onTransition={onTransition} />);
    fireEvent.click(within(rowOf("ECN-0003")).getByRole("button", { name: "Từ chối" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.change(within(sheet).getByLabelText(vi.layoutKit.approval.reasonLabel), { target: { value: "lý do" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Từ chối" }));
    await waitFor(() => expect(onTransition).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByLabelText(vi.layoutKit.approval.reasonLabel)).toHaveValue("lý do");
  });
});

describe("TransitionDialog — tự kiểm tách vai (phòng khi trang mở thẳng)", () => {
  it("mở cho chính tác giả ⇒ alert lý do + nút xác nhận khoá", () => {
    render(
      <TransitionDialog
        open
        onOpenChange={() => {}}
        action={APPROVE}
        subject="ECN-0003"
        segregation={checkSegregation(APPROVE, { currentUserId: 5, authorId: 5, reviewerId: 7 })}
        onConfirm={() => {}}
      />,
    );
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("alert")).toHaveTextContent(vi.layoutKit.approval.sodAuthor);
    expect(within(sheet).getByRole("button", { name: "Phê duyệt" })).toBeDisabled();
  });
});

describe("ApprovalQueue — trạng thái danh sách", () => {
  it("đang tải / lỗi / trống — ba câu riêng, lỗi là role=alert", () => {
    const { rerender } = render(<ApprovalQueue items={undefined} status="loading" currentUserId={1} onTransition={() => {}} />);
    expect(screen.getByText(vi.layoutKit.approval.loading)).toBeInTheDocument();
    rerender(<ApprovalQueue items={[]} status="error" currentUserId={1} onTransition={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(vi.layoutKit.approval.error);
    expect(screen.queryByText(vi.layoutKit.approval.empty)).toBeNull();
    rerender(<ApprovalQueue items={[]} status="ready" currentUserId={1} onTransition={() => {}} />);
    expect(screen.getByText(vi.layoutKit.approval.empty)).toBeInTheDocument();
  });
});
