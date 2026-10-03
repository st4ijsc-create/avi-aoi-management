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

// ── Fix round 2 (Ruling R-2-h, re-review N1–N4) — sổ sách theo dấu history.state ─────────────────
function B2Body() {
  const f = useFlyout();
  const layer = useFlyoutLayer();
  return (
    <>
      <EditForm />
      <button type="button" onClick={() => layer.close()}>
        đóng lớp
      </button>
      <button type="button" onClick={() => f.closeAll()}>
        đóng hết
      </button>
      <button type="button" onClick={() => f.open("detail", { id: 99 })}>
        mở 99
      </button>
      <button type="button" onClick={() => f.open("detail", { id: 42 })}>
        mở lại 42
      </button>
    </>
  );
}
function NoteA() {
  const layer = useFlyoutLayer();
  const [v, setV] = useState("");
  return (
    <input
      aria-label="ghi chú A"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
        layer.setDirty(e.target.value !== "");
      }}
    />
  );
}
function A2Body({ id }: { id: string | null }) {
  const f = useFlyout();
  return (
    <>
      <p>chi tiết {id}</p>
      <NoteA />
      <button type="button" onClick={() => f.push("edit", { id })}>
        sửa
      </button>
      <button type="button" onClick={() => f.open("detail", { id })}>
        mở lại chính nó
      </button>
    </>
  );
}
const flyouts3: Record<string, FlyoutDefinition> = {
  detail: { title: (id) => `ECN ${id}`, render: ({ id }) => <A2Body id={id} /> },
  edit: { title: () => "Sửa ECN", render: () => <B2Body /> },
};
function renderHost3(defs: Record<string, FlyoutDefinition> = flyouts3, graceMs?: number) {
  return render(
    <FlyoutHost flyouts={defs} unknownKeyGraceMs={graceMs}>
      <Page />
    </FlyoutHost>,
  );
}
const P = "/engineering-changes";
const flyoutParams = () => params().getAll("flyout");
const hist = () => window.history.length;

/** Tới P?A&B theo hai đường: "push" (P → mở A → push B) hoặc "f5" (nạp thẳng P?A&B, trang trước /a). */
async function arriveAB(how: "push" | "f5") {
  if (how === "push") {
    startAt("");
    renderHost3();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const a = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
  } else {
    startAt("?flyout=detail&flyoutId=42&flyout=edit&flyoutId=42");
    renderHost3();
  }
  const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
  await waitFor(() => expect(flyoutParams()).toEqual(["detail", "edit"]));
  return b;
}

/** Dirty B ⇒ Back ⇒ hỏi ⇒ Giữ. Khẳng định: form còn, URL về P?A&B, lịch sử KHÔNG dài thêm. */
async function dirtyBackKeep() {
  const L0 = hist();
  fireEvent.change(within(screen.getByRole("dialog", { name: "Sửa ECN" })).getByLabelText("tên"), { target: { value: "nháp" } });
  act(() => window.history.back());
  const confirm = await screen.findByRole("alertdialog", { name: vi.layoutKit.flyout.unsavedTitle });
  fireEvent.click(within(confirm).getByRole("button", { name: vi.layoutKit.flyout.keepEditing }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(flyoutParams()).toEqual(["detail", "edit"]));
  expect(window.location.pathname).toBe(P);
  expect(screen.getByLabelText("tên")).toHaveValue("nháp");
  expect(hist()).toBe(L0);
  return L0;
}

async function discard() {
  const confirm = await screen.findByRole("alertdialog");
  fireEvent.click(within(confirm).getByRole("button", { name: vi.layoutKit.flyout.discard }));
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 60)));

describe.each(["push", "f5"] as const)("R-2-h — tới P?A&B bằng %s, dirty B, Back, Giữ, rồi…", (how) => {
  it("…đóng lớp (Bỏ thay đổi) ⇒ URL P?A, lịch sử không dài thêm; Back tiếp không hồi sinh B", async () => {
    await arriveAB(how);
    const L0 = await dirtyBackKeep();
    fireEvent.click(screen.getByRole("button", { name: "đóng lớp" }));
    await discard();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull());
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    await settle();
    expect(screen.getByRole("dialog", { name: "ECN 42" })).toBeInTheDocument();
    expect(hist()).toBe(L0);
    expect(window.location.pathname).toBe(P);
    act(() => window.history.back());
    await settle();
    expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull();
    expect(window.location.pathname).toBe(how === "push" ? P : "/a");
    expect(flyoutParams()).toEqual([]);
  });

  it("…đóng hết (Bỏ thay đổi) ⇒ URL P sạch, lịch sử không dài thêm; Back ⇒ trang trước, không sheet", async () => {
    await arriveAB(how);
    const L0 = await dirtyBackKeep();
    fireEvent.click(screen.getByRole("button", { name: "đóng hết" }));
    await discard();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(flyoutParams()).toEqual([]));
    await settle();
    expect(window.location.pathname).toBe(P);
    expect(hist()).toBe(L0);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/a"));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("…open(99) (Bỏ thay đổi) ⇒ URL P?flyout=detail&flyoutId=99 đúng một lớp; đóng ⇒ sạch; lịch sử đúng", async () => {
    await arriveAB(how);
    const L0 = await dirtyBackKeep();
    fireEvent.click(screen.getByRole("button", { name: "mở 99" }));
    await discard();
    const c = await screen.findByRole("dialog", { name: "ECN 99" });
    await waitFor(() => expect(params().getAll("flyoutId")).toEqual(["99"]));
    await settle();
    expect(document.querySelectorAll("[data-flyout-key]")).toHaveLength(1);
    // push: lùi về P rồi push C ⇒ [/a, P, P?C]; f5: không lùi qua /a ⇒ thay tại chỗ ⇒ [/a, P?C].
    expect(hist()).toBe(how === "push" ? L0 - 1 : L0);
    fireEvent.keyDown(c, { key: "Escape" });
    await waitFor(() => expect(flyoutParams()).toEqual([]));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.pathname).toBe(P);
  });

  it("…Back lần nữa (Bỏ thay đổi) ⇒ rời đúng một mục, không kẹt; không push trùng", async () => {
    await arriveAB(how);
    const L0 = await dirtyBackKeep();
    act(() => window.history.back());
    await discard();
    await settle();
    expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull();
    expect(hist()).toBe(L0);
    if (how === "push") {
      expect(window.location.pathname).toBe(P);
      expect(flyoutParams()).toEqual(["detail"]);
    } else {
      expect(window.location.pathname).toBe("/a");
    }
  });
});

describe("R-2-h N2 — không ref nào kẹt", () => {
  it("stack [A, B đã push] rồi open(A) ⇒ URL ?A; push B, dirty, Back ⇒ VẪN hỏi", async () => {
    await arriveAB("push");
    fireEvent.click(screen.getByRole("button", { name: "mở lại 42" }));
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    await settle();
    const a = screen.getByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(b).getByLabelText("tên"), { target: { value: "x" } });
    act(() => window.history.back());
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("tên")).toHaveValue("x");
  });

  it("stack [A, B đã push] rồi open(A); A có dữ liệu; Back ⇒ VẪN hỏi (không có cờ 'cho phép' nào kẹt lại)", async () => {
    await arriveAB("push");
    fireEvent.click(screen.getByRole("button", { name: "mở lại 42" }));
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    await settle();
    fireEvent.change(screen.getByLabelText("ghi chú A"), { target: { value: "a" } });
    act(() => window.history.back());
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("ghi chú A")).toHaveValue("a");
  });

  it("open(A) khi stack đúng là [A] (URL KHÔNG đổi) ⇒ không đặt gì; push B, dirty, Back ⇒ VẪN hỏi", async () => {
    startAt("");
    renderHost3();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const a = await screen.findByRole("dialog", { name: "ECN 42" });
    const L = hist();
    fireEvent.click(within(a).getByRole("button", { name: "mở lại chính nó" }));
    await settle();
    expect(hist()).toBe(L);
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(b).getByLabelText("tên"), { target: { value: "y" } });
    act(() => window.history.back());
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("R-2-h N3 — ân hạn chỉ cho URL lúc nạp; dọn từ khoá lạ đầu tiên", () => {
  it("người dùng điều hướng trong ân hạn ⇒ huỷ ân hạn, dọn ngay; đăng ký muộn sau đó KHÔNG mở lại", async () => {
    startAt("?tab=list&flyout=detail&flyoutId=7");
    const { rerender } = renderHost3({ edit: flyouts3.edit }, 5000);
    await settle();
    expect(params().get("flyout")).toBe("detail");
    act(() => window.history.pushState(null, "", `${P}?tab=other&flyout=detail&flyoutId=7`));
    await waitFor(() => expect(params().get("flyout")).toBeNull());
    expect(params().get("tab")).toBe("other");
    rerender(
      <FlyoutHost flyouts={flyouts3} unknownKeyGraceMs={5000}>
        <Page />
      </FlyoutHost>,
    );
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open() trong ân hạn huỷ ân hạn (khoá lạ không quay lại khi đăng ký muộn)", async () => {
    startAt("?flyout=khong-co&flyoutId=1");
    const { rerender } = renderHost3(flyouts3, 5000);
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    await screen.findByRole("dialog", { name: "ECN 42" });
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    rerender(
      <FlyoutHost flyouts={{ ...flyouts3, "khong-co": flyouts3.detail }} unknownKeyGraceMs={5000}>
        <Page />
      </FlyoutHost>,
    );
    await settle();
    expect(document.querySelectorAll("[data-flyout-key]")).toHaveLength(1);
  });

  it("[lạ, edit] hết ân hạn ⇒ dọn CẢ lớp con edit (không để con mồ côi cha)", async () => {
    startAt("?tab=list&flyout=khong-co&flyoutId=1&flyout=edit&flyoutId=1");
    renderHost3(flyouts3, 40);
    await waitFor(() => expect(flyoutParams()).toEqual([]));
    expect(params().getAll("flyoutId")).toEqual([]);
    expect(params().get("tab")).toBe("list");
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("R-2-h N4 — gỡ đăng ký khoá của lớp đang có dữ liệu", () => {
  async function setup() {
    startAt("");
    const r = renderHost3();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const a = await screen.findByRole("dialog", { name: "ECN 42" });
    fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(b).getByLabelText("tên"), { target: { value: "giữ tôi" } });
    await waitFor(() => expect(flyoutParams()).toEqual(["detail", "edit"]));
    const L0 = hist();
    const href0 = window.location.href;
    r.rerender(
      <FlyoutHost flyouts={{ detail: flyouts3.detail }}>
        <Page />
      </FlyoutHost>,
    );
    await screen.findByRole("alertdialog");
    await settle();
    expect(hist()).toBe(L0);
    expect(window.location.href).toBe(href0);
    expect(screen.getByLabelText("tên")).toHaveValue("giữ tôi");
    return { L0, href0 };
  }

  it("Giữ ⇒ lớp còn, dữ liệu còn, URL và độ dài lịch sử không đổi (không push trùng)", async () => {
    const { L0, href0 } = await setup();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: vi.layoutKit.flyout.keepEditing }));
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("tên")).toHaveValue("giữ tôi");
    expect(window.location.href).toBe(href0);
    expect(hist()).toBe(L0);
    // Lớp đã "Giữ" phải sống qua lần đổi location kế tiếp (vd trang đổi ?tab=) — không bị dọn/gỡ.
    act(() => window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}&tab=x`));
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("tên")).toHaveValue("giữ tôi");
    expect(flyoutParams()).toEqual(["detail", "edit"]);
  });

  it("Bỏ ⇒ lớp B gỡ, URL ?A, lịch sử không dài thêm", async () => {
    const { L0 } = await setup();
    await discard();
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    await settle();
    expect(screen.queryByRole("dialog", { name: "Sửa ECN" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "ECN 42" })).toBeInTheDocument();
    expect(hist()).toBe(L0);
  });
});

describe("R-2-h — mục do host tạo mang dấu history.state", () => {
  it("push mục mới ⇒ state = {flyoutHost, depth, stackSig, chain}; mục của trang không bị ghi dấu", async () => {
    startAt("");
    renderHost3();
    const pageState = window.history.state;
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    await screen.findByRole("dialog", { name: "ECN 42" });
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    const st = window.history.state as { flyoutHost: string; depth: number; stackSig: string; chain: string[] };
    expect(typeof st.flyoutHost).toBe("string");
    expect(st.depth).toBe(1);
    expect(st.chain).toEqual([`${P}?`]);
    expect(st.stackSig).toBe(`${P}?flyout=detail&flyoutId=42`);
    act(() => window.history.back());
    await waitFor(() => expect(flyoutParams()).toEqual([]));
    expect(window.history.state).toEqual(pageState);
  });
});

describe("R-2-h — replace giữ dấu / giữ state của trang; kỳ vọng không kẹt", () => {
  it("F5 tới P?A&B, Back+Giữ, đóng lớp ⇒ mục hiện tại VẪN mang dấu với stackSig mới (replace giữ dấu)", async () => {
    await arriveAB("f5");
    await dirtyBackKeep();
    fireEvent.click(screen.getByRole("button", { name: "đóng lớp" }));
    await discard();
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    const st = window.history.state as { flyoutHost?: string; depth?: number; stackSig?: string };
    expect(typeof st?.flyoutHost).toBe("string");
    expect(st.depth).toBe(1);
    expect(st.stackSig).toBe(`${P}?flyout=detail&flyoutId=42`);
  });

  it("mục GỐC của trang (F5) bị replace khi đóng ⇒ state riêng của trang được giữ nguyên", async () => {
    window.history.replaceState(null, "", "/a");
    window.history.pushState({ trang: "riêng" }, "", `${P}?flyout=detail&flyoutId=7`);
    renderHost3();
    const a = await screen.findByRole("dialog", { name: "ECN 7" });
    fireEvent.keyDown(a, { key: "Escape" });
    await waitFor(() => expect(flyoutParams()).toEqual([]));
    expect(window.history.state).toEqual({ trang: "riêng" });
  });

  it("kỳ vọng cũ bị xoá ở lần đổi location kế tiếp: đóng B, Forward, B dirty, Back ⇒ VẪN hỏi", async () => {
    await arriveAB("push");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Sửa ECN" }), { key: "Escape" });
    await waitFor(() => expect(flyoutParams()).toEqual(["detail"]));
    await settle();
    act(() => window.history.forward());
    const b = await screen.findByRole("dialog", { name: "Sửa ECN" });
    fireEvent.change(within(b).getByLabelText("tên"), { target: { value: "f" } });
    act(() => window.history.back());
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("tên")).toHaveValue("f");
  });

  it("đổi location KHÔNG tới đích host đặt ⇒ coi là bên ngoài (A dirty bị gỡ ⇒ hỏi)", async () => {
    startAt("");
    renderHost3();
    fireEvent.click(screen.getByRole("button", { name: "mở chi tiết" }));
    const a = await screen.findByRole("dialog", { name: "ECN 42" });
    await settle();
    fireEvent.change(within(a).getByLabelText("ghi chú A"), { target: { value: "dở" } });
    act(() => {
      fireEvent.click(within(a).getByRole("button", { name: "sửa" }));
      window.history.pushState(null, "", `${P}?tab=khac`);
    });
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("ghi chú A")).toHaveValue("dở");
  });
});

describe("final wave (T3 minor) — một FlyoutHost mỗi trang", () => {
  it("FlyoutHost lồng trong FlyoutHost ⇒ báo lỗi khi dựng (không hỏng im lặng lịch sử/?flyout=)", () => {
    const spy = (globalThis as { console: Console }).console;
    const orig = spy.error;
    spy.error = () => undefined; // React in lỗi ranh giới ra console — nuốt cho gọn đầu ra
    try {
      expect(() =>
        render(
          <FlyoutHost flyouts={{}}>
            <FlyoutHost flyouts={{}}>
              <p>trong</p>
            </FlyoutHost>
          </FlyoutHost>,
        ),
      ).toThrow(/must not be nested/);
    } finally {
      spy.error = orig;
    }
  });
});
