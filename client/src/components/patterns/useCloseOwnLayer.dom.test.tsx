// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 7 (fix round 1) — `useCloseOwnLayer`: form trong một lớp flyout tự đóng CHÍNH lớp của nó sau
// khi lưu xong (Task 5 review M3), dùng chung cho Recipes và Equipment Integration (trước là 2 bản chép tay).
// Hợp đồng: `done()` đóng lớp chỉ khi lớp đó CÒN mount VÀ đang là lớp TRÊN CÙNG; đóng xong không hỏi "bỏ thay
// đổi" (setDirty(false) trước); mountedRef phản ánh trạng thái mount.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { FlyoutHost, useFlyout, type FlyoutDefinition } from "./FlyoutHost";
import { useCloseOwnLayer } from "./useCloseOwnLayer";

const grab: { done?: () => void; mounted?: { current: boolean } } = {};

function FormA() {
  const { layer, done, mountedRef } = useCloseOwnLayer();
  const f = useFlyout();
  grab.done = done;
  grab.mounted = mountedRef;
  useEffect(() => { layer.setDirty(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <p>form A</p>
      <button type="button" onClick={() => f.push("b")}>mở B</button>
    </div>
  );
}
const flyouts: Record<string, FlyoutDefinition> = {
  a: { title: "Lớp A", render: () => <FormA /> },
  b: { title: "Lớp B", render: () => <p>lớp B</p> },
};
function Opener() {
  const f = useFlyout();
  return <button type="button" onClick={() => f.open("a")}>mở A</button>;
}
const layer = (k: string) => document.querySelector(`[data-flyout-key="${k}"]`);

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  grab.done = undefined;
  grab.mounted = undefined;
  window.history.replaceState(null, "", "/x");
});
afterEach(() => cleanup());

describe("useCloseOwnLayer", () => {
  it("lớp của form đang trên cùng ⇒ done() đóng nó, KHÔNG hỏi bỏ thay đổi dù form đang dirty; URL sạch", async () => {
    const user = userEvent.setup();
    render(<FlyoutHost flyouts={flyouts}><Opener /></FlyoutHost>);
    await user.click(screen.getByRole("button", { name: "mở A" }));
    await waitFor(() => expect(layer("a")).toBeTruthy());
    expect(grab.mounted?.current).toBe(true);
    act(() => grab.done!());
    await waitFor(() => expect(layer("a")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("flyout")).toBeNull();
  });

  it("lớp KHÁC đang ở trên (A đẩy B) ⇒ done() của A không đóng gì", async () => {
    const user = userEvent.setup();
    render(<FlyoutHost flyouts={flyouts}><Opener /></FlyoutHost>);
    await user.click(screen.getByRole("button", { name: "mở A" }));
    await waitFor(() => expect(layer("a")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "mở B" }));
    await waitFor(() => expect(layer("b")).toBeTruthy());
    act(() => grab.done!());
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("b")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).getAll("flyout")).toEqual(["a", "b"]);
  });

  it("form đã unmount ⇒ mountedRef=false và done() là no-op (không đóng lớp mở sau đó)", async () => {
    const user = userEvent.setup();
    render(<FlyoutHost flyouts={flyouts}><Opener /></FlyoutHost>);
    await user.click(screen.getByRole("button", { name: "mở A" }));
    await waitFor(() => expect(layer("a")).toBeTruthy());
    const staleDone = grab.done!;
    const staleMounted = grab.mounted!;
    await user.keyboard("{Escape}");
    // form dirty ⇒ hỏi; chọn bỏ thay đổi
    const discard = await screen.findByRole("button", { name: /Bỏ thay đổi|Discard/ });
    await user.click(discard);
    await waitFor(() => expect(layer("a")).toBeNull());
    expect(staleMounted.current).toBe(false);
    await user.click(screen.getByRole("button", { name: "mở A" }));
    await waitFor(() => expect(layer("a")).toBeTruthy());
    act(() => staleDone());
    await new Promise((r) => setTimeout(r, 30));
    expect(layer("a")).toBeTruthy();
  });
});
