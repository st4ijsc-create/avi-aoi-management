// @vitest-environment jsdom
//
// Doc 80 · Đợt 1 · Task 8 · fix round 1 #2 — PANEL COPILOT qua SSE: tiến độ stage, mã hiện dần, Huỷ,
// lượt bị thay thế, lùi về `copilotGenerate`, huỷ khi unmount. Dựng component THẬT; chỉ mock hạ tầng
// (trpc · i18n · auth · CodeEditor/HunkDiffView nặng CodeMirror · sonner) và `fetch` = SSE ReadableStream
// do lưới tự bơm từng khung.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    programming: {
      copilotGenerate: {
        useMutation: () => ({ mutate: h.mutate, reset: h.reset, data: undefined, isPending: false, isError: false }),
      },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 7, role: "engineer" } }) }));
vi.mock("@/components/engineering/CodeEditor", () => ({
  CodeEditor: (p: { value: string; "aria-label"?: string }) => <textarea aria-label={p["aria-label"]} value={p.value} readOnly />,
}));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, warning: vi.fn(), success: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, a?: unknown) =>
      typeof a === "string" ? a : a && typeof a === "object" && "defaultValue" in (a as object) ? String((a as { defaultValue: unknown }).defaultValue) : k,
  }),
}));

import { ProgrammingCopilotPanel } from "./ProgrammingCopilotPanel";

// ─── fetch giả: mỗi lượt gọi là một SSE ReadableStream lưới tự bơm ───────────────────────────────
interface LuongGia {
  body: Record<string, unknown>;
  signal: AbortSignal;
  day: (o: unknown) => void;
  dong: () => void;
}
let luot: LuongGia[] = [];
/** "tuan-thu": huỷ ⇒ luồng lỗi AbortError (như trình duyệt). "phot-lo": luồng KHÔNG phản ứng huỷ (mạng chậm tháo). */
let cheDoHuy: "tuan-thu" | "phot-lo" = "tuan-thu";
let phanHoiHttp: Response | null = null;

function fetchGia(_url: string, init: RequestInit): Promise<Response> {
  if (phanHoiHttp) {
    const r = phanHoiHttp;
    phanHoiHttp = null;
    return Promise.resolve(r);
  }
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  let daDong = false;
  const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
  const signal = init.signal as AbortSignal;
  const l: LuongGia = {
    body: JSON.parse(String(init.body)),
    signal,
    day: (o) => !daDong && ctl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)),
    dong: () => {
      if (!daDong) {
        daDong = true;
        ctl.close();
      }
    },
  };
  if (cheDoHuy === "tuan-thu") {
    signal.addEventListener("abort", () => {
      if (!daDong) {
        daDong = true;
        ctl.error(new DOMException("Aborted", "AbortError"));
      }
    });
  }
  luot.push(l);
  return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
}

const nghi = () => act(() => new Promise((r) => setTimeout(r, 20)));

async function batDauLuot() {
  fireEvent.change(screen.getByPlaceholderText(/Describe what to generate/), { target: { value: "toggle a run bit" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Generate$/ }));
  });
  await nghi();
}

beforeEach(() => {
  luot = [];
  cheDoHuy = "tuan-thu";
  phanHoiHttp = null;
  h.mutate.mockReset();
  h.reset.mockReset();
  h.toastError.mockReset();
  vi.stubGlobal("fetch", vi.fn(fetchGia));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProgrammingCopilotPanel — SSE", () => {
  it("stage hiện theo tiến độ, mã hiện DẦN, Huỷ chỉ hiện khi đang chạy; result ⇒ khung kết quả cũ", async () => {
    render(<ProgrammingCopilotPanel />);
    expect(screen.queryByTestId("copilot-cancel")).toBeNull();
    await batDauLuot();
    expect(luot).toHaveLength(1);
    expect(luot[0].body).toMatchObject({ kind: "iec61131-st", mode: "generate", request: "toggle a run bit" });
    expect(screen.getByTestId("copilot-cancel")).toBeInTheDocument();

    luot[0].day({ type: "stage", stage: "gate", elapsedMs: 0 });
    luot[0].day({ type: "stage", stage: "retrieve", elapsedMs: 5 });
    luot[0].day({ type: "stage", stage: "generate", elapsedMs: 300 });
    await nghi();
    const tienDo = screen.getByRole("list", { name: "Progress" });
    expect(tienDo).toHaveTextContent("gate");
    expect(tienDo).toHaveTextContent("retrieve");
    expect(tienDo).toHaveTextContent("generate");

    luot[0].day({ type: "token", token: "PROGRAM " });
    await nghi();
    expect(screen.getByLabelText("Writing…")).toHaveTextContent("PROGRAM");
    expect(screen.getByLabelText("Writing…")).not.toHaveTextContent("P1");
    luot[0].day({ type: "token", token: "P1" });
    await nghi();
    expect(screen.getByLabelText("Writing…")).toHaveTextContent("PROGRAM P1");

    luot[0].day({ type: "stage", stage: "validate", elapsedMs: 900 });
    luot[0].day({ type: "result", result: { ok: true, refused: false, kind: "iec61131-st", code: "PROGRAM P1\nEND_PROGRAM", validation: { ok: true, diagnostics: [] } } });
    luot[0].dong();
    await nghi();
    expect(screen.queryByTestId("copilot-cancel")).toBeNull();
    expect(screen.getByLabelText("copilot-result")).toHaveValue("PROGRAM P1\nEND_PROGRAM");
    expect(screen.getByText("Validated")).toBeInTheDocument();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("★ bấm Huỷ ⇒ signal của fetch bị abort, hiện trạng thái ĐÃ HUỶ, nút Huỷ biến mất", async () => {
    render(<ProgrammingCopilotPanel />);
    await batDauLuot();
    luot[0].day({ type: "stage", stage: "gate", elapsedMs: 0 });
    await nghi();
    await act(async () => {
      fireEvent.click(screen.getByTestId("copilot-cancel"));
    });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(/Cancelled/);
    expect(screen.queryByTestId("copilot-cancel")).toBeNull();
    expect(screen.getByRole("button", { name: /^Generate$/ })).toBeEnabled();
  });

  it("★ lượt bị THAY THẾ (luồng cũ tháo chậm, còn bắn sự kiện) KHÔNG ghi đè lượt mới", async () => {
    cheDoHuy = "phot-lo";
    render(<ProgrammingCopilotPanel />);
    await batDauLuot();
    luot[0].day({ type: "stage", stage: "generate", elapsedMs: 1 });
    await nghi();
    await act(async () => {
      fireEvent.click(screen.getByTestId("copilot-cancel"));
    });
    await nghi();
    expect(luot[0].signal.aborted).toBe(true);
    // Người dùng chạy lại NGAY — luồng cũ vẫn chưa tháo xong.
    await batDauLuot();
    expect(luot).toHaveLength(2);
    luot[1].day({ type: "stage", stage: "generate", elapsedMs: 1 });
    luot[1].day({ type: "token", token: "NEW" });
    await nghi();
    // Luồng cũ bắn nốt sự kiện muộn rồi đóng.
    luot[0].day({ type: "token", token: "OLD" });
    luot[0].day({ type: "result", result: { ok: true, refused: false, kind: "iec61131-st", code: "OLD CODE", validation: { ok: true, diagnostics: [] } } });
    luot[0].dong();
    await nghi();
    expect(screen.getByLabelText("Writing…")).toHaveTextContent("NEW");
    expect(screen.getByLabelText("Writing…")).not.toHaveTextContent("OLD");
    expect(screen.getByTestId("copilot-cancel")).toBeInTheDocument(); // lượt mới vẫn đang chạy
    luot[1].day({ type: "result", result: { ok: true, refused: false, kind: "iec61131-st", code: "NEW CODE", validation: { ok: true, diagnostics: [] } } });
    luot[1].dong();
    await nghi();
    expect(screen.getByLabelText("copilot-result")).toHaveValue("NEW CODE");
  });

  it.each([
    ["403 MODULE_NOT_LICENSED (MOD_AI)", 403, { success: false, code: "MODULE_NOT_LICENSED", module: "MOD_AI" }],
    ["404 (server cũ chưa có tuyến)", 404, {}],
  ])("%s ⇒ lùi về copilotGenerate với ĐÚNG payload", async (_ten, st, than) => {
    phanHoiHttp = new Response(JSON.stringify(than), { status: st, headers: { "content-type": "application/json" } });
    render(<ProgrammingCopilotPanel />);
    await batDauLuot();
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toMatchObject({ kind: "iec61131-st", mode: "generate", request: "toggle a run bit" });
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("403 MODULE_NOT_LICENSED cho MOD_ENGINEERING ⇒ KHÔNG lùi (copilotGenerate cũng bị chặn bởi đúng module ấy), báo lỗi", async () => {
    phanHoiHttp = new Response(JSON.stringify({ success: false, code: "MODULE_NOT_LICENSED", module: "MOD_ENGINEERING" }), { status: 403 });
    render(<ProgrammingCopilotPanel />);
    await batDauLuot();
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0][0]).toMatch(/Engineering module/);
  });

  it("403 PERMISSION_DENIED ⇒ KHÔNG lùi, báo lỗi", async () => {
    phanHoiHttp = new Response(JSON.stringify({ success: false, code: "PERMISSION_DENIED" }), { status: 403 });
    render(<ProgrammingCopilotPanel />);
    await batDauLuot();
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0][0]).toMatch(/permission to use the programming assistant/);
  });

  it("★ unmount giữa lượt ⇒ abort", async () => {
    const { unmount } = render(<ProgrammingCopilotPanel />);
    await batDauLuot();
    expect(luot[0].signal.aborted).toBe(false);
    unmount();
    expect(luot[0].signal.aborted).toBe(true);
  });
});
