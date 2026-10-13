// @vitest-environment jsdom
/**
 * doc 81 Đợt 10 task F2 — R-10-af / R-10-ax panel: the screen's contract with edgeResolution.*
 *   • every pending-STOP flag is shown (needsResolution with its outcome, ownerCannotList, overdue, undeliverable);
 *   • "Record resolution" only on a needsResolution STOP, only when canResolve; "Record unknown outcome" only on an intent old
 *     enough (else the waiting text), only when canResolve;
 *   • the dialog needs a reason ≥ 3 chars and calls resolveStop({requestId, resolution}) / resolveIntent({intentId, reason}).
 * The server is the wall (router + service tests); this measures the UI only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

const srv = vi.hoisted(() => ({ data: null as unknown, calls: {} as Record<string, unknown[]>, queryInput: [] as unknown[] }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: string | Record<string, unknown>) => {
      if (typeof d === "string") return d;
      if (d && typeof d === "object" && typeof d.defaultValue === "string") return (d.defaultValue as string).replace(/\{\{(\w+)\}\}/g, (_m, n) => String(d[n] ?? ""));
      return k;
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn() }));
vi.mock("@/lib/trpc", () => {
  const proc = (router: string, name: string) => {
    const key = `${router}.${name}`;
    return {
      useQuery: (input: unknown) => (srv.queryInput.push(input), { data: key === "edgeResolution.list" ? srv.data : undefined, isLoading: false }),
      useMutation: () => ({ isPending: false, mutate: (input: unknown) => void (srv.calls[key] ??= []).push(input) }),
    };
  };
  const utils = new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: () => Promise.resolve() }) }) });
  return { trpc: new Proxy({}, { get: (_t, r: string) => (r === "useUtils" ? () => utils : new Proxy({}, { get: (_t2, p: string) => proc(r, p) })) }) };
});

import EdgeResolutionPanel from "./EdgeResolutionPanel";

const stop = (requestId: number, o: Record<string, unknown>) => ({
  requestId, deviceKind: "robot", deviceId: 9, deviceCode: `R9`, requestEdgeNodeId: 3, requestNodeCode: "edge-line1", currentEdgeNodeId: 3, currentNodeCode: "edge-line1",
  reason: "operator", createdAt: "2026-10-13T01:00:00.000Z", outcome: null, needsResolution: false, ownerCannotList: false, overdue: false, undeliverable: false, ...o,
});
beforeEach(() => {
  srv.calls = {};
  srv.queryInput = [];
  srv.data = {
    available: true,
    stops: [
      stop(1, { outcome: "failed", needsResolution: true }),
      stop(2, { ownerCannotList: true, overdue: true }),
      stop(3, { undeliverable: true }),
      stop(4, {}),
    ],
    intents: [
      { intentId: 50, adapterId: 7, adapterCode: "PLC-7", commandType: "setpoint", tagKey: "speed", createdAt: "2026-10-13T00:00:00.000Z", ageMinutes: 42, resolvable: true },
      { intentId: 51, adapterId: 7, adapterCode: "PLC-7", commandType: "setpoint", tagKey: "speed", createdAt: "2026-10-13T01:00:00.000Z", ageMinutes: 2, resolvable: false },
    ],
    lateResults: [{ lateResultId: 77, intentId: 50, adapterId: 7, adapterCode: "PLC-7", status: "acked", commandType: "setpoint", tagKey: "speed", createdAt: "2026-10-13T02:00:00.000Z" }],
    stopTotal: 4,
    intentTotal: 2,
    lateResultTotal: 1,
    intentMinAgeMinutes: 10,
  };
});
afterEach(cleanup);

const rowOf = (text: string) => screen.getAllByRole("row").find((r) => within(r).queryByText(text, { exact: false })) as HTMLElement;

describe("EdgeResolutionPanel", () => {
  it("shows every flag and the totals", () => {
    render(<EdgeResolutionPanel canResolve />);
    expect(screen.getByText("Lệnh DỪNG chưa được xác nhận (4/4)")).toBeInTheDocument();
    expect(screen.getByText("Thất bại — cần người xử lý")).toBeInTheDocument();
    expect(screen.getByText("Nút edge không thấy thiết bị — trung tâm thực thi")).toBeInTheDocument();
    expect(screen.getByText("Quá hạn — vẫn phải DỪNG")).toBeInTheDocument();
    expect(screen.getByText("Không giao được — nút không còn thông tin xác thực")).toBeInTheDocument();
    expect(screen.getByText("Đang chờ thực thi")).toBeInTheDocument();
    expect(screen.getByText("Lệnh ghi OT mồ côi — chưa có kết quả (2/2)")).toBeInTheDocument();
    expect(screen.getByText("Có thể vẫn đang ghi — chờ đủ 10 phút")).toBeInTheDocument();
  });

  it("resolve buttons: only on a needsResolution STOP and an old-enough intent; none without canResolve", () => {
    const { unmount } = render(<EdgeResolutionPanel canResolve />);
    expect(screen.getAllByRole("button", { name: "Ghi nhận xử lý" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Ghi nhận kết cục không rõ" })).toHaveLength(1);
    unmount();
    render(<EdgeResolutionPanel canResolve={false} />);
    expect(screen.queryByRole("button", { name: "Ghi nhận xử lý" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ghi nhận kết cục không rõ" })).toBeNull();
  });

  it("STOP dialog: reason < 3 ⇒ confirm disabled; then resolveStop({requestId, resolution})", () => {
    render(<EdgeResolutionPanel canResolve />);
    fireEvent.click(screen.getByRole("button", { name: "Ghi nhận xử lý" }));
    const confirm = screen.getByRole("button", { name: "Xác nhận và ghi kiểm toán" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Lý do \/ cách đã xử lý/), { target: { value: "ab" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Lý do \/ cách đã xử lý/), { target: { value: "  stopped by hand  " } });
    fireEvent.click(confirm);
    expect(srv.calls["edgeResolution.resolveStop"]).toEqual([{ requestId: 1, resolution: "stopped by hand" }]);
    expect(srv.calls["edgeResolution.resolveIntent"]).toBeUndefined();
  });

  it("intent dialog ⇒ resolveIntent({intentId, reason}) for the old intent only", () => {
    render(<EdgeResolutionPanel canResolve />);
    fireEvent.click(within(rowOf("42")).getByRole("button", { name: "Ghi nhận kết cục không rõ" }));
    fireEvent.change(screen.getByLabelText(/Lý do \/ cách đã xử lý/), { target: { value: "gateway crashed" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và ghi kiểm toán" }));
    expect(srv.calls["edgeResolution.resolveIntent"]).toEqual([{ intentId: 50, reason: "gateway crashed" }]);
  });

  it("schema missing / nothing pending / an unexpected payload never crash", () => {
    srv.data = { available: false, stops: [], intents: [], stopTotal: 0, intentTotal: 0, intentMinAgeMinutes: 10 };
    const a = render(<EdgeResolutionPanel canResolve />);
    expect(screen.getByText(/migration 0374 chưa áp/)).toBeInTheDocument();
    a.unmount();
    srv.data = { available: true, stops: [], intents: [], stopTotal: 0, intentTotal: 0, intentMinAgeMinutes: 10 };
    const b = render(<EdgeResolutionPanel canResolve />);
    expect(screen.getByText(/Không có lệnh DỪNG nào đang chờ/)).toBeInTheDocument();
    b.unmount();
    srv.data = [];
    render(<EdgeResolutionPanel canResolve robotId={9} />);
    expect(screen.getByTestId("edge-resolution-panel")).toBeInTheDocument();
    expect(srv.queryInput.at(-1)).toEqual({ robotId: 9 });
  });
});

describe("EdgeResolutionPanel — round 3 late results", () => {
  it("lists the late result with its device status + the hold, and 'Mark reviewed' calls reviewLateResult({lateResultId, note})", () => {
    render(<EdgeResolutionPanel canResolve />);
    expect(screen.getByText("Kết quả ghi đến SAU khi đã ghi nhận 'kết cục không rõ' (1/1)")).toBeInTheDocument();
    expect(screen.getByText("Chặn đổi chủ tới khi có người xem xét")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đã xem" }));
    expect(screen.getByText("Xác nhận đã xem kết quả ghi đến muộn #77?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Lý do \/ cách đã xử lý/), { target: { value: "value applied, checked" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận và ghi kiểm toán" }));
    expect(srv.calls["edgeResolution.reviewLateResult"]).toEqual([{ lateResultId: 77, note: "value applied, checked" }]);
  });
  it("no button without canResolve", () => {
    render(<EdgeResolutionPanel canResolve={false} />);
    expect(screen.queryByRole("button", { name: "Xác nhận đã xem" })).toBeNull();
  });
});
