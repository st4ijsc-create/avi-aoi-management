// @vitest-environment jsdom
//
// doc 81 Đợt 4 Task D1 — "Hiện Labs" theo TÀI KHOẢN: hook ghi localStorage (bộ đệm tức thời) rồi đẩy lên server; giá trị
// server được áp vào kho lúc đăng nhập ⇒ hook đang mở hiện ngay giá trị đó. Server giả dùng CHÍNH `checkUiPrefsPatch`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useShowLabs } from "./useShowLabs";
import { startUiPrefsSync, type UiPrefsSync, type UiPrefsTransport } from "@/lib/uiPrefsSync";
import { checkUiPrefsPatch } from "@shared/uiPrefs";

const UID = 9;
const KEY = `layoutKit:nav-labs:u${UID}:show`;

function fakeServer(initial: Record<string, unknown> = {}) {
  const prefs: Record<string, unknown> = { ...initial };
  const sets: Array<Record<string, unknown>> = [];
  let gate: Promise<void> = Promise.resolve();
  const transport: UiPrefsTransport = {
    get: async () => {
      await gate;
      return { prefs: { ...prefs }, available: true };
    },
    set: async (patch) => {
      const c = checkUiPrefsPatch(patch, UID);
      if (!c.ok) throw Object.assign(new Error("BAD_REQUEST"), { data: { code: "BAD_REQUEST" } });
      sets.push(patch);
      Object.assign(prefs, c.value);
      return { prefs };
    },
  };
  return { prefs, sets, transport, hold: (p: Promise<void>) => (gate = p) };
}

function Labs() {
  const { showLabs, toggleShowLabs } = useShowLabs(UID);
  return (
    <button type="button" data-testid="labs" aria-pressed={showLabs} onClick={toggleShowLabs}>
      labs
    </button>
  );
}

let sync: UiPrefsSync | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  sync?.stop();
  sync = null;
  cleanup();
});

describe("useShowLabs — theo tài khoản (D1)", () => {
  it("★ bật Labs ⇒ localStorage NGAY (bộ đệm) và server nhận showLabs:true (sau debounce)", async () => {
    const srv = fakeServer();
    sync = startUiPrefsSync(UID, srv.transport, 5);
    await sync.start();
    render(<Labs />);
    act(() => {
      fireEvent.click(screen.getByTestId("labs"));
    });
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(screen.getByTestId("labs")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(srv.prefs.showLabs).toBe(true));
    expect(srv.sets).toEqual([{ showLabs: true }]);
  });

  it("★ máy MỚI: hook đã vẽ (kho rỗng ⇒ tắt) rồi giá trị server về ⇒ bật, không cần tải lại", async () => {
    const srv = fakeServer({ showLabs: true });
    let mo!: () => void;
    srv.hold(new Promise<void>((r) => (mo = r)));
    render(<Labs />);
    expect(screen.getByTestId("labs")).toHaveAttribute("aria-pressed", "false"); // lượt vẽ đầu dùng bộ đệm
    sync = startUiPrefsSync(UID, srv.transport, 5);
    await act(async () => {
      mo();
      await sync!.start();
    });
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(screen.getByTestId("labs")).toHaveAttribute("aria-pressed", "true");
    expect(srv.sets).toEqual([]); // không đẩy lại thứ vừa nhận
  });

  it("không có bản đồng bộ (chưa đăng nhập / server không tới được) ⇒ hook vẫn chạy trên localStorage", () => {
    const set = vi.fn();
    render(<Labs />);
    act(() => {
      fireEvent.click(screen.getByTestId("labs"));
    });
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(set).not.toHaveBeenCalled();
  });
});
