// @vitest-environment jsdom
//
// doc 81 Đợt 4 Task D1 — kích thước/gập panel WorkbenchShell theo TÀI KHOẢN: thao tác của người dùng (kéo separator, nút
// gập) được đẩy lên server dưới khoá ĐÚNG như `userLayoutKey`; giá trị server áp vào kho SAU khi shell đã vẽ (đăng nhập ở
// máy mới) ⇒ shell đọc lại và áp ngay. Server giả dùng CHÍNH `checkUiPrefsPatch` của server.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-resizable-panels", async () => (await import("./layoutKitTestPanels")).browserPanels());
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import VI from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { WorkbenchShell, type WorkbenchShellProps } from "./WorkbenchShell";
import { userLayoutKey } from "./layoutKitHooks";
import { installMatchMedia, presetNarrow } from "./layoutKitTestMedia";
import { startUiPrefsSync, type UiPrefsSync, type UiPrefsTransport } from "@/lib/uiPrefsSync";
import { checkUiPrefsPatch } from "@shared/uiPrefs";

const UID = 5;
const W = 1600;
const H = 800;
const KH = userLayoutKey("test-ide", UID, "hpx")!;
const KB = userLayoutKey("test-ide", UID, "bottomCollapsed")!;

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  installMatchMedia();
  await initLayoutKitTestI18n();
});
let sync: UiPrefsSync | null = null;
let spy: { mockRestore: () => void } | null = null;
beforeEach(() => {
  presetNarrow(false);
  localStorage.clear();
  const original = HTMLElement.prototype.getBoundingClientRect;
  spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-workbench-group")) return DOMRect.fromRect({ x: 0, y: 0, width: W, height: H });
    return original.call(this);
  });
});
afterEach(() => {
  sync?.stop();
  sync = null;
  spy?.mockRestore();
  cleanup();
});

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

const props = (over: Partial<WorkbenchShellProps> = {}): WorkbenchShellProps => ({
  layoutId: "test-ide",
  userId: UID,
  main: <textarea aria-label="editor" />,
  left: { label: "Explorer", content: <p>cây</p>, minPx: 220, defaultPx: 240, maxPx: 360 },
  right: { label: "Copilot", content: <p>trợ lý</p>, minPx: 300, defaultPx: 340, maxPx: 480 },
  bottom: { label: "Vấn đề", content: <p>vấn đề</p>, minPx: 160, defaultPx: 260, maxPx: 480 },
  ...over,
});
const renderShell = (over: Partial<WorkbenchShellProps> = {}) =>
  render(
    <main>
      <WorkbenchShell {...props(over)} />
    </main>,
  );
const size = (id: string) => Number((document.querySelector(`[data-panel-id="${id}"]`) as HTMLElement).getAttribute("data-panel-size"));
const leftPx = () => (size("left") * W) / 100;
const toggle = () => screen.getByRole("button", { name: VI.layoutKit.shell.toggleBottom });

describe("WorkbenchShell — sở thích theo tài khoản (D1)", () => {
  it("★ máy MỚI: shell đã vẽ theo mặc định rồi giá trị server về ⇒ panel trái đúng px của tài khoản + panel dưới gập", async () => {
    const srv = fakeServer({ [KH]: { left: { px: 330, pct: 20.6 } }, [KB]: true });
    let mo!: () => void;
    srv.hold(new Promise<void>((r) => (mo = r)));
    renderShell();
    expect(Math.abs(leftPx() - 240)).toBeLessThan(3); // lượt vẽ đầu: mặc định (kho rỗng)
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    sync = startUiPrefsSync(UID, srv.transport, 5);
    await act(async () => {
      mo();
      await sync!.start();
    });
    expect(Math.abs(leftPx() - 330)).toBeLessThan(3);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(size("bottom")).toBe(0);
    expect(srv.sets).toEqual([]);
  });

  it("★ người dùng gập panel dưới ⇒ localStorage ngay + server nhận khoá userLayoutKey(…, bottomCollapsed)", async () => {
    const srv = fakeServer();
    sync = startUiPrefsSync(UID, srv.transport, 5);
    await sync.start();
    renderShell();
    act(() => {
      fireEvent.click(toggle());
    });
    expect(localStorage.getItem(KB)).toBe("1");
    await waitFor(() => expect(srv.prefs[KB]).toBe(true));
  });

  it("★ người dùng kéo separator (bàn phím) ⇒ server nhận kích thước px dưới khoá userLayoutKey(…, hpx) — một lượt gửi", async () => {
    const srv = fakeServer();
    sync = startUiPrefsSync(UID, srv.transport, 30);
    await sync.start();
    renderShell();
    const h = screen.getByRole("separator", { name: VI.layoutKit.shell.resizeLeft });
    fireEvent.keyDown(h, { key: "ArrowRight" });
    fireEvent.keyDown(h, { key: "ArrowRight" });
    const local = JSON.parse(localStorage.getItem(KH) ?? "null");
    expect(local?.left?.px).toBeGreaterThan(240);
    await waitFor(() => expect(srv.prefs[KH]).toEqual(local));
    expect(srv.sets).toHaveLength(1);
  });

  it("người dùng đã tự gập/mở TRONG phiên ⇒ giá trị server về sau KHÔNG lật lại lựa chọn đó", async () => {
    const srv = fakeServer({ [KB]: false });
    let mo!: () => void;
    srv.hold(new Promise<void>((r) => (mo = r)));
    renderShell();
    sync = startUiPrefsSync(UID, srv.transport, 5);
    act(() => {
      fireEvent.click(toggle()); // gập trước khi server trả lời
    });
    await act(async () => {
      mo();
      await sync!.start();
    });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem(KB)).toBe("1");
    await waitFor(() => expect(srv.prefs[KB]).toBe(true));
  });
});
