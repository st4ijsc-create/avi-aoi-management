// @vitest-environment jsdom
//
// Đợt 10.2 — ô chọn model dùng chung: nhóm + trạng thái + vô hiệu mục tắt + mã hết hiệu lực ⇒ auto + toast MỘT lần + lưu dính.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  data: undefined as unknown,
  toasts: [] as string[],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, def?: unknown, o?: Record<string, unknown>) => {
      const p = (typeof def === "object" && def ? def : o) as Record<string, unknown> | undefined;
      const mau = typeof def === "string" ? def : typeof p?.defaultValue === "string" ? p.defaultValue : k;
      return p ? mau.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(p[n] ?? "")) : mau;
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { info: (m: string) => h.toasts.push(m), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: h.data }) } } } }));

import ChonModel from "./ChonModel";

const DM = [
  { ma: "auto", loai: "auto", nhan: "Tự động", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:code.software", loai: "vai-tro", nhan: "Lập trình", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:embed", loai: "vai-tro", nhan: "Nhúng", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:vision", loai: "vai-tro", nhan: "Thị giác", moTa: "", trangThai: "can-doi-khe", uocTinhDoiKheGiay: 9 },
  { ma: "ho-so:p1", loai: "ho-so", nhan: "Hồ sơ 1", moTa: "", trangThai: "tat" },
];

function Boc({ dau = "auto", beMat = "chat" as const }: { dau?: string; beMat?: "chat" | "luong" }) {
  const [v, setV] = useState(dau);
  return (
    <>
      <ChonModel beMat={beMat} giaTri={v} onDoi={setV} />
      <span data-testid="gia-tri">{v}</span>
    </>
  );
}

beforeEach(() => {
  h.data = DM;
  h.toasts.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("ChonModel", () => {
  it("hiện Tự động + Vai trò (ẩn embed/vision) + Hồ sơ; mục tắt bị vô hiệu", () => {
    render(<Boc />);
    const opts = Array.from(screen.getByTestId("chon-model-chat").querySelectorAll("option"));
    const ma = opts.map((o) => o.getAttribute("value"));
    expect(ma).toEqual(["auto", "vai-tro:code.software", "ho-so:p1"]);
    expect(opts.find((o) => o.value === "ho-so:p1")).toBeDisabled();
    expect(opts.find((o) => o.value === "ho-so:p1")!.textContent).toContain("tắt");
  });

  it("chọn ⇒ gọi onDoi và lưu dính theo bề mặt", () => {
    render(<Boc />);
    fireEvent.change(screen.getByTestId("chon-model-chat"), { target: { value: "vai-tro:code.software" } });
    expect(screen.getByTestId("gia-tri").textContent).toBe("vai-tro:code.software");
    expect(localStorage.getItem("aiChon.chat")).toBe("vai-tro:code.software");
  });

  it("mã đã lưu không còn trong danh mục ⇒ về auto + toast đúng MỘT lần", () => {
    localStorage.setItem("aiChon.chat", "vai-tro:cu");
    render(<Boc dau="vai-tro:cu" />);
    expect(screen.getByTestId("gia-tri").textContent).toBe("auto");
    expect(localStorage.getItem("aiChon.chat")).toBeNull();
    expect(h.toasts).toHaveLength(1);
  });

  it("danh mục chưa tải ⇒ KHÔNG đổi lựa chọn, KHÔNG toast; chỉ có Tự động", () => {
    h.data = undefined;
    render(<Boc dau="vai-tro:code.software" />);
    expect(screen.getByTestId("gia-tri").textContent).toBe("vai-tro:code.software");
    expect(h.toasts).toHaveLength(0);
  });

  it("bề mặt luồng không ghi localStorage khi nho=false", () => {
    function B() {
      const [v, setV] = useState("auto");
      return <ChonModel beMat="luong" giaTri={v} onDoi={setV} nho={false} testId="x" />;
    }
    render(<B />);
    fireEvent.change(screen.getByTestId("x"), { target: { value: "vai-tro:code.software" } });
    expect(localStorage.getItem("aiChon.luong")).toBeNull();
  });
});

describe("ChonModel — mục ngoai theo duocDungO (10.4 T0)", () => {
  const NGOAI = { ma: "ngoai:openai_compat:gpt-x", loai: "ngoai", nhan: "GPT X", moTa: "", trangThai: "san-sang" };
  it("máy chủ chưa khai duocDungO ⇒ ô KHÔNG có nhóm Model ngoài", () => {
    h.data = [...DM, NGOAI];
    render(<Boc />);
    expect(Array.from(screen.getByTestId("chon-model-chat").querySelectorAll("option")).map((o) => o.getAttribute("value"))).not.toContain(NGOAI.ma);
  });
  it("khai ['luong','kiem-dinh'] ⇒ vẫn ẩn ở chat; khai ['chat'] ⇒ hiện", () => {
    h.data = [...DM, { ...NGOAI, duocDungO: ["luong", "kiem-dinh"] }];
    const { unmount } = render(<Boc />);
    expect(Array.from(screen.getByTestId("chon-model-chat").querySelectorAll("option")).map((o) => o.getAttribute("value"))).not.toContain(NGOAI.ma);
    unmount();
    h.data = [...DM, { ...NGOAI, duocDungO: ["chat"] }];
    render(<Boc />);
    expect(Array.from(screen.getByTestId("chon-model-chat").querySelectorAll("option")).map((o) => o.getAttribute("value"))).toContain(NGOAI.ma);
  });
  it("mã ngoai đã lưu mà bề mặt không còn phục vụ ⇒ về auto + toast (không âm thầm gửi 404)", () => {
    h.data = [...DM, { ...NGOAI, duocDungO: ["luong"] }];
    localStorage.setItem("aiChon.chat", NGOAI.ma);
    render(<Boc dau={NGOAI.ma} />);
    expect(screen.getByTestId("gia-tri").textContent).toBe("auto");
    expect(h.toasts).toHaveLength(1);
  });
});

describe("ChonModel — nhãn ngoài + đồng ý theo phiên (10.4b L0b)", () => {
  const NG = { ma: "ngoai:openai_compat:gpt-x", loai: "ngoai", nhan: "GPT X", moTa: "", trangThai: "san-sang", nhaCungCap: "openai_compat", duocDungO: ["chat"] };
  const NG2 = { ...NG, ma: "ngoai:anthropic:claude-x", nhan: "Claude X", nhaCungCap: "anthropic" };
  function BocH({ hoi }: { hoi?: (ma: string) => boolean | Promise<boolean> }) {
    const [v, setV] = useState("auto");
    return (
      <>
        <ChonModel beMat="chat" giaTri={v} onDoi={setV} xacNhanNgoai={hoi} />
        <span data-testid="gia-tri">{v}</span>
      </>
    );
  }
  const chon = (ma: string) => fireEvent.change(screen.getByTestId("chon-model-chat"), { target: { value: ma } });
  beforeEach(() => {
    h.data = [...DM, NG, NG2];
    sessionStorage.clear();
  });
  it("mục ngoài mang nhãn 'ngoài · gửi dữ liệu ra <ncc>'; mục Local thì không", () => {
    render(<BocH />);
    const opts = Array.from(screen.getByTestId("chon-model-chat").querySelectorAll("option"));
    expect(opts.find((o) => o.value === NG.ma)!.textContent).toContain("ngoài · gửi dữ liệu ra openai_compat");
    expect(opts.find((o) => o.value === "ho-so:p1")!.textContent).not.toContain("ngoài");
  });
  it("từ chối ⇒ KHÔNG đổi lựa chọn; đồng ý ⇒ đổi + nhớ trong phiên (lần sau không hỏi); đổi model ⇒ hỏi lại", async () => {
    const hoi = vi.fn(async (ma: string) => ma === NG.ma);
    render(<BocH hoi={hoi} />);
    chon(NG2.ma);
    await Promise.resolve();
    await Promise.resolve();
    expect(hoi).toHaveBeenCalledWith(NG2.ma);
    expect(screen.getByTestId("gia-tri").textContent).toBe("auto");
    chon(NG.ma);
    await vi.waitFor(() => expect(screen.getByTestId("gia-tri").textContent).toBe(NG.ma));
    chon("auto");
    chon(NG.ma);
    expect(hoi).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("gia-tri").textContent).toBe(NG.ma);
    chon(NG2.ma);
    await Promise.resolve();
    expect(hoi).toHaveBeenCalledTimes(3);
  });
  it("mã không phải ngoài ⇒ không hỏi", () => {
    const hoi = vi.fn(async () => false);
    render(<BocH hoi={hoi} />);
    chon("vai-tro:code.software");
    expect(hoi).not.toHaveBeenCalled();
    expect(screen.getByTestId("gia-tri").textContent).toBe("vai-tro:code.software");
  });
});

describe("ChonModel — đua hai lần chọn khi hộp đồng ý còn mở (10.4b)", () => {
  it("lần chọn cũ đồng ý MUỘN sau khi đã chọn model khác ⇒ bỏ kết quả cũ", async () => {
    const NA = { ma: "ngoai:openai_compat:gpt-x", loai: "ngoai", nhan: "GPT X", moTa: "", trangThai: "san-sang", nhaCungCap: "openai_compat", duocDungO: ["chat"] };
    const NB = { ...NA, ma: "ngoai:anthropic:claude-x", nhan: "Claude X", nhaCungCap: "anthropic" };
    h.data = [...DM, NA, NB];
    sessionStorage.clear();
    const dong: Array<(v: boolean) => void> = [];
    const hoi = vi.fn(() => new Promise<boolean>((r) => dong.push(r)));
    function B() {
      const [v, setV] = useState("auto");
      return (
        <>
          <ChonModel beMat="chat" giaTri={v} onDoi={setV} xacNhanNgoai={hoi} />
          <span data-testid="gia-tri">{v}</span>
        </>
      );
    }
    render(<B />);
    const sel = screen.getByTestId("chon-model-chat");
    fireEvent.change(sel, { target: { value: NA.ma } });
    fireEvent.change(sel, { target: { value: NB.ma } });
    dong[1]!(true);
    await vi.waitFor(() => expect(screen.getByTestId("gia-tri").textContent).toBe(NB.ma));
    await act(async () => {
      dong[0]!(true);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByTestId("gia-tri").textContent).toBe(NB.ma);
  });
});
