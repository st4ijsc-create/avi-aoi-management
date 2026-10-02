// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — FlyoutHost + useFlyout(): một stack sheet phải mỗi trang.
// Hợp đồng (brief Task 3 + Review Focus 1/4 + Global Constraint 9):
//   - open / push / close; đồng bộ URL `?flyout=key&flyoutId=…`, GIỮ các tham số khác (?tab=, ?filter=);
//   - F5 (nạp lại với URL có flyout) dựng lại đúng lớp; nút back đóng lớp trên cùng;
//   - bẫy focus, Esc đóng TỪNG lớp, trả focus về nút đã mở;
//   - còn dữ liệu chưa lưu thì HỎI trước khi đóng — cả khi đóng bằng Esc lẫn bằng nút back.
// Chạy trên wouter THẬT với history của jsdom (không mock router).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import {
  FlyoutHost,
  buildFlyoutSearch,
  parseFlyoutStack,
  useFlyout,
  useFlyoutLayer,
  type FlyoutDefinition,
} from "./FlyoutHost";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
beforeEach(() => {
  window.history.replaceState(null, "", "/engineering-changes?tab=list&filter=pending");
});
afterEach(() => cleanup());

function DetailBody({ id }: { id: string | null }) {
  const f = useFlyout();
  return (
    <div>
      <p>chi tiết {id}</p>
      <button type="button" onClick={() => f.push("edit", { id })}>
        sửa
      </button>
    </div>
  );
}

function EditForm() {
  const layer = useFlyoutLayer();
  const [v, setV] = useState("");
  return (
    <input
      aria-label="tên"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        layer.setDirty(e.target.value !== "");
      }}
    />
  );
}

const flyouts: Record<string, FlyoutDefinition> = {
  detail: { title: (id) => `ECN ${id}`, render: ({ id }) => <DetailBody id={id} /> },
  edit: { title: () => "Sửa ECN", render: () => <EditForm /> },
};

function Opener() {
  const f = useFlyout();
  return (
    <button type="button" onClick={() => f.open("detail", { id: 42 })}>
      mở chi tiết
    </button>
  );
}

function renderHost() {
  return render(
    <FlyoutHost flyouts={flyouts}>
      <Opener />
    </FlyoutHost>,
  );
}

const params = () => new URLSearchParams(window.location.search);

describe("parse/build — tham số URL", () => {
  it("cặp flyout/flyoutId theo thứ tự; giữ tham số khác", () => {
    const s = buildFlyoutSearch("tab=list&filter=pending", [
      { key: "detail", id: "42" },
      { key: "edit", id: null },
    ]);
    const p = new URLSearchParams(s);
    expect(p.get("tab")).toBe("list");
    expect(p.get("filter")).toBe("pending");
    expect(p.getAll("flyout")).toEqual(["detail", "edit"]);
    expect(p.getAll("flyoutId")).toEqual(["42", ""]);
    expect(parseFlyoutStack(s)).toEqual([
      { key: "detail", id: "42" },
      { key: "edit", id: null },
    ]);
  });
  it("stack rỗng ⇒ xoá sạch flyout/flyoutId", () => {
    expect(buildFlyoutSearch("tab=a&flyout=x&flyoutId=1", [])).toBe("tab=a");
  });
});

describe("FlyoutHost — URL là nguồn sự thật", () => {
  it("open ⇒ sheet phải + URL ?flyout=detail&flyoutId=42, giữ ?tab & ?filter", async () => {
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const dlg = await screen.findByRole("dialog", { name: "ECN 42" });
    expect(dlg).toHaveAttribute("data-flyout-key", "detail");
    expect(dlg).toHaveAttribute("data-slot", "sheet-content");
    expect(params().get("flyout")).toBe("detail");
    expect(params().get("flyoutId")).toBe("42");
    expect(params().get("tab")).toBe("list");
    expect(params().get("filter")).toBe("pending");
  });

  it("F5: nạp lại với ?flyout=detail&flyoutId=7 ⇒ dựng lại đúng lớp", async () => {
    window.history.replaceState(null, "", "/engineering-changes?tab=list&flyout=detail&flyoutId=7");
    renderHost();
    const dlg = await screen.findByRole("dialog", { name: "ECN 7" });
    expect(within(dlg).getByText("chi tiết 7")).toBeInTheDocument();
  });

  it("F5 với stack 2 lớp ⇒ dựng lại cả hai theo thứ tự", async () => {
    window.history.replaceState(null, "", "/x?flyout=detail&flyoutId=7&flyout=edit&flyoutId=7");
    renderHost();
    await screen.findByRole("dialog", { name: "Sửa ECN" });
    expect(document.querySelectorAll("[data-flyout-key]")).toHaveLength(2);
  });

  it("khoá lạ trong URL bị bỏ qua và URL được dọn (sau thời gian ân hạn — fix round 1)", async () => {
    window.history.replaceState(null, "", "/x?tab=a&flyout=khong-co&flyoutId=1");
    render(
      <FlyoutHost flyouts={flyouts} unknownKeyGraceMs={30}>
        <Opener />
      </FlyoutHost>,
    );
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    expect(params().get("tab")).toBe("a");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nút back của trình duyệt đóng lớp vừa mở; URL không còn flyout", async () => {
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    await screen.findByRole("dialog", { name: "ECN 42" });
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(params().get("flyout")).toBeNull();
    expect(params().get("tab")).toBe("list");
  });

  it("đóng bằng Esc rồi back KHÔNG mở lại sheet (Esc lùi đúng một mục lịch sử)", async () => {
    window.history.replaceState(null, "", "/a");
    window.history.pushState(null, "", "/engineering-changes?tab=list");
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const dlg = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.keyDown(dlg, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    expect(window.location.pathname).toBe("/engineering-changes");
    // Back tiếp theo phải về TRANG TRƯỚC (/a), không dừng ở một bản sao "/engineering-changes" do
    // Esc thay (replace) mục lịch sử của sheet thay vì lùi lại nó.
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/a"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FlyoutHost — stack, Esc từng lớp, focus", () => {
  it("push chồng lớp; Esc chỉ đóng lớp TRÊN CÙNG; URL còn đúng một cặp", async () => {
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const d1 = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(d1).getByRole("button", { name: "sửa" }));
    const d2 = await screen.findByRole("dialog", { name: "Sửa ECN" });
    expect(params().getAll("flyout")).toEqual(["detail", "edit"]);

    fireEvent.keyDown(d2, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "ECN 42" })).toBeInTheDocument();
    await waitFor(() => expect(params().getAll("flyout")).toEqual(["detail"]));
  });

  it("mở ⇒ focus vào trong sheet; Tab không thoát ra ngoài; Esc ⇒ focus về nút đã mở", async () => {
    const user = userEvent.setup();
    renderHost();
    const opener = screen.getByRole("button", { name: "mở chi tiết" });
    await user.click(opener);
    const dlg = await screen.findByRole("dialog", { name: "ECN 42" });
    await waitFor(() => expect(dlg).toContainElement(document.activeElement as HTMLElement));
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dlg).toContainElement(document.activeElement as HTMLElement);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("FlyoutHost — hỏi trước khi đóng form còn dữ liệu chưa lưu", () => {
  async function openEditAndType() {
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const d1 = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(d1).getByRole("button", { name: "sửa" }));
    const d2 = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(d2).getByLabelText("tên"), { target: { value: "bản nháp" } });
    return d2;
  }

  it("Esc khi còn dữ liệu ⇒ hỏi; 'Tiếp tục sửa' giữ nguyên dữ liệu; 'Bỏ thay đổi' mới đóng", async () => {
    const d2 = await openEditAndType();
    fireEvent.keyDown(d2, { key: "Escape" });
    const confirm = await screen.findByRole("alertdialog", { name: vi.layoutKit.flyout.unsavedTitle });
    fireEvent.click(within(confirm).getByRole("button", { name: vi.layoutKit.flyout.keepEditing }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("tên")).toHaveValue("bản nháp");
    expect(params().getAll("flyout")).toEqual(["detail", "edit"]);

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Sửa ECN" }), { key: "Escape" });
    const confirm2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm2).getByRole("button", { name: vi.layoutKit.flyout.discard }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "ECN 42" })).toBeInTheDocument();
    await waitFor(() => expect(params().getAll("flyout")).toEqual(["detail"]));
  });

  it("nút back khi còn dữ liệu ⇒ form KHÔNG mất, URL được khôi phục, và hỏi", async () => {
    await openEditAndType();
    act(() => window.history.back());
    const confirm = await screen.findByRole("alertdialog", { name: vi.layoutKit.flyout.unsavedTitle });
    expect(screen.getByLabelText("tên")).toHaveValue("bản nháp");
    await waitFor(() => expect(params().getAll("flyout")).toEqual(["detail", "edit"]));

    fireEvent.click(within(confirm).getByRole("button", { name: vi.layoutKit.flyout.discard }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull());
    await waitFor(() => expect(params().getAll("flyout")).toEqual(["detail"]));
  });

  it("open() lớp khác khi lớp cũ còn dữ liệu ⇒ cũng hỏi", async () => {
    function Other() {
      const f = useFlyout();
      return (
        <button type="button" onClick={() => f.open("detail", { id: 99 })}>
          mở 99
        </button>
      );
    }
    render(
      <FlyoutHost flyouts={{ ...flyouts, edit: { title: () => "Sửa ECN", render: () => <><EditForm /><Other /></> } }}>
        <Opener />
      </FlyoutHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const d1 = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(d1).getByRole("button", { name: "sửa" }));
    const d2 = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(d2).getByLabelText("tên"), { target: { value: "x" } });
    fireEvent.click(within(d2).getByRole("button", { name: "mở 99" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("tên")).toHaveValue("x");
  });

  it("form sạch (không dirty) ⇒ Esc đóng ngay, không hỏi", async () => {
    renderHost();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const d1 = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.keyDown(d1, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

// ── Fix round 1 (review I5 + minors) — sổ sách lịch sử nhất quán ────────────────────────────────
function OpenOther() {
  const f = useFlyout();
  return (
    <>
      <button type="button" onClick={() => f.open("detail", { id: 99 })}>
        mở 99
      </button>
      <button type="button" onClick={() => f.closeAll()}>
        đóng hết
      </button>
    </>
  );
}
const flyouts2: Record<string, FlyoutDefinition> = {
  detail: flyouts.detail,
  edit: { title: () => "Sửa ECN", render: () => <><EditForm /><OpenOther /></> },
};
function Page() {
  return (
    <>
      <h1>Trang ECN</h1>
      <Opener />
    </>
  );
}
function renderHost2(defs: Record<string, FlyoutDefinition> = flyouts2, graceMs?: number) {
  return render(
    <FlyoutHost flyouts={defs} unknownKeyGraceMs={graceMs}>
      <Page />
    </FlyoutHost>,
  );
}
function startAt(search: string) {
  window.history.replaceState(null, "", "/a");
  window.history.pushState(null, "", `/engineering-changes${search}`);
}

describe("FlyoutHost — open() khi đang có stack đã push", () => {
  it("mở A, push B, open C, đóng ⇒ KHÔNG hồi sinh A; back tiếp ⇒ về trang trước", async () => {
    startAt("?tab=list");
    renderHost2();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const a = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.click(within(b).getByRole("button", { name: "mở 99" }));
    const c = await screen.findByRole("dialog", { name: "ECN 99" });
    await waitFor(() => expect(params().getAll("flyout")).toEqual(["detail"]));
    expect(params().getAll("flyoutId")).toEqual(["99"]);
    fireEvent.keyDown(c, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/a"));
  });

  it("biến thể còn dữ liệu: hỏi ⇒ Bỏ thay đổi ⇒ C mở; đóng C ⇒ không còn sheet nào", async () => {
    startAt("?tab=list");
    renderHost2();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const a = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(b).getByLabelText("tên"), { target: { value: "nháp" } });
    fireEvent.click(within(b).getByRole("button", { name: "mở 99" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: vi.layoutKit.flyout.discard }));
    const c = await screen.findByRole("dialog", { name: "ECN 99" });
    expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull();
    fireEvent.keyDown(c, { key: "Escape" });
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FlyoutHost — closeAll trên stack trộn F5 + push", () => {
  it("F5 [A] rồi push B, đóng hết ⇒ không sheet; back ⇒ về trang trước, KHÔNG mở lại stack", async () => {
    startAt("?flyout=detail&flyoutId=7");
    renderHost2();
    const a = await screen.findByRole("dialog", { name: "ECN 7" });
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.click(within(b).getByRole("button", { name: "đóng hết" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    expect(window.location.pathname).toBe("/engineering-changes");
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/a"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FlyoutHost — lớp dựng từ F5 trả focus về chỗ hợp lý", () => {
  it("F5 rồi Esc ⇒ focus về h1 của trang (không rơi về body)", async () => {
    startAt("?flyout=detail&flyoutId=7");
    renderHost2();
    const a = await screen.findByRole("dialog", { name: "ECN 7" });
    fireEvent.keyDown(a, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Trang ECN" })));
  });
});

describe("FlyoutHost — deep link tới khoá CHƯA đăng ký (gated theo quyền/dữ liệu)", () => {
  it("giữ nguyên URL trong thời gian ân hạn; đăng ký muộn ⇒ sheet mở", async () => {
    startAt("?tab=list&flyout=detail&flyoutId=7");
    const { rerender } = renderHost2({ edit: flyouts2.edit }, 5000);
    await new Promise((r) => setTimeout(r, 60));
    expect(params().get("flyout")).toBe("detail");
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(
      <FlyoutHost flyouts={flyouts2} unknownKeyGraceMs={5000}>
        <Page />
      </FlyoutHost>,
    );
    expect(await screen.findByRole("dialog", { name: "ECN 7" })).toBeInTheDocument();
  });

  it("hết ân hạn mà vẫn chưa đăng ký ⇒ dọn khỏi URL (giữ tham số khác)", async () => {
    startAt("?tab=list&flyout=detail&flyoutId=7");
    renderHost2({ edit: flyouts2.edit }, 40);
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    expect(params().get("tab")).toBe("list");
  });
});
