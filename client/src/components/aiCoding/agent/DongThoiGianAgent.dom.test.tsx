// @vitest-environment jsdom
//
// Đợt 1 · T5 — chế độ Agent: hook `useLuotChayAgent` THẬT + `DongThoiGianAgent` THẬT; chỉ mock hạ tầng (i18n,
// Streamdown, HunkDiffView nặng) và `fetch` = SSE ReadableStream do lưới tự bơm + tRPC thô (superjson).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, a?: unknown, b?: unknown) =>
      typeof a === "string"
        ? noiSuy(a, b as Record<string, unknown>)
        : a && typeof a === "object" && "defaultValue" in (a as object)
          ? noiSuy(String((a as { defaultValue: unknown }).defaultValue), a as Record<string, unknown>)
          : k,
  }),
}));
vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div>{p.children}</div> }));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));

import { useLuotChayAgent } from "./useLuotChayAgent";
import { DongThoiGianAgent } from "./DongThoiGianAgent";

// ─── fetch giả ────────────────────────────────────────────────────────────────────────────────
interface LuongGia {
  url: string;
  body: Record<string, unknown> | null;
  day: (e: SuKienAgent) => void;
  dong: () => void;
}
interface GoiTrpc {
  thuTuc: string;
  input: unknown;
}
let luong: LuongGia[] = [];
let goiTrpc: GoiTrpc[] = [];
let goiHuy: string[] = [];
let danhSachTra: unknown[] = [];
let hoanTacTra: unknown = { khoiPhuc: [], xungDot: [] };
let nhoTra: unknown = { ok: true, note: null, ketQua: "them" };
let phanHoiCuaToiTra: unknown = { ok: true, note: null, phieu: [] };

function traJson(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

function fetchGia(input: string, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url.startsWith("/api/trpc/aiAgent.")) {
    const thuTuc = url.slice("/api/trpc/aiAgent.".length).split("?")[0]!;
    let inp: unknown;
    if (method === "POST") inp = (JSON.parse(String(init?.body)) as { json: unknown }).json;
    goiTrpc.push({ thuTuc, input: inp });
    const data =
      thuTuc === "danhSach"
        ? danhSachTra
        : thuTuc === "hoanTac"
          ? hoanTacTra
          : thuTuc === "nhoDeXuat"
            ? nhoTra
            : thuTuc === "phanHoiCuaToi"
              ? phanHoiCuaToiTra
              : thuTuc === "phanHoi"
                ? { ok: true, note: null, phieu: { danhGia: (inp as { danhGia?: unknown }).danhGia ?? null } }
                : { ok: true };
    return Promise.resolve(traJson({ result: { data: { json: data } } }));
  }
  if (/\/api\/ai\/agent\/runs\/[^/]+\/huy$/.test(url)) {
    goiHuy.push(url);
    return Promise.resolve(traJson({ ok: true }));
  }
  if (url.startsWith("/api/ai/agent/runs")) {
    const enc = new TextEncoder();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    let daDong = false;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) });
    const signal = init?.signal as AbortSignal | undefined;
    signal?.addEventListener("abort", () => {
      if (!daDong) {
        daDong = true;
        ctl.error(new DOMException("Aborted", "AbortError"));
      }
    });
    luong.push({
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      day: (e) => !daDong && ctl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)),
      dong: () => {
        if (!daDong) {
          daDong = true;
          ctl.close();
        }
      },
    });
    return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  }
  return Promise.reject(new Error(`fetch lạ: ${url}`));
}

async function nhip() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function day(...es: SuKienAgent[]) {
  const l = luong[luong.length - 1]!;
  for (const e of es) l.day(e);
  await nhip();
}

const onTep = vi.fn();
const onMoTep = vi.fn();

function Harness() {
  const a = useLuotChayAgent({ projectId: "p1", ngonNgu: "vi", onTepDaDoi: onTep });
  return (
    <>
      <button type="button" onClick={() => void a.gui("sửa lỗi X", "sua")}>
        gui
      </button>
      <button type="button" onClick={() => void a.dung()}>
        dung
      </button>
      <DongThoiGianAgent agent={a} onMoTep={onMoTep} />
    </>
  );
}

beforeEach(() => {
  luong = [];
  goiTrpc = [];
  goiHuy = [];
  danhSachTra = [];
  hoanTacTra = { khoiPhuc: [], xungDot: [] };
  nhoTra = { ok: true, note: null, ketQua: "them" };
  phanHoiCuaToiTra = { ok: true, note: null, phieu: [] };
  onTep.mockReset();
  onMoTep.mockReset();
  vi.stubGlobal("fetch", vi.fn(fetchGia));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function batDau() {
  render(<Harness />);
  await nhip();
  fireEvent.click(screen.getByText("gui"));
  await nhip();
  await day({ loai: "bat-dau", runId: "r1", cheDo: "sua" });
}

describe("DongThoiGianAgent — luồng SSE giả", () => {
  it("gửi đúng thân POST; kế hoạch ghim hiện việc + trạng thái; dòng tool mở ra tóm tắt", async () => {
    await batDau();
    expect(luong[0]!.url).toBe("/api/ai/agent/runs");
    expect(luong[0]!.body).toEqual({ cauHoi: "sửa lỗi X", projectId: "p1", cheDo: "sua", ngonNgu: "vi" });

    await day(
      { loai: "dang-cho-model", phiaTruoc: 2 },
    );
    expect(screen.getByTestId("agent-trang-thai")).toHaveTextContent("Đang chờ lượt model (2 phía trước)");

    await day(
      { loai: "ke-hoach", viec: [{ noiDung: "Đọc mã", trangThai: "xong" }, { noiDung: "Sửa hàm", trangThai: "dang-lam" }, { noiDung: "Chạy test", trangThai: "cho" }] },
      { loai: "chu", noiDung: "Tôi sẽ đọc tệp." },
      { loai: "goi-tool", goi: { id: "c1", ten: "read_file", thamSo: { path: "src/a.ts" } }, luot: 1 },
      { loai: "ket-qua-tool", id: "c1", ten: "read_file", ok: true, tomTat: "120 dòng đã đọc" },
    );
    const kh = screen.getByTestId("agent-ke-hoach");
    expect(kh).toHaveTextContent("1/3 xong");
    expect(within(kh).getByText("Sửa hàm").closest("li")).toHaveAttribute("data-trang-thai", "dang-lam");
    expect(screen.getByText("Tôi sẽ đọc tệp.")).toBeInTheDocument();

    const dong = screen.getByTestId("agent-dong-tool");
    expect(dong).toHaveTextContent("read_file");
    expect(dong).toHaveTextContent("src/a.ts");
    expect(screen.queryByText("120 dòng đã đọc")).toBeNull();
    fireEvent.click(within(dong).getByRole("button"));
    expect(screen.getByText("120 dòng đã đọc")).toBeInTheDocument();
  });

  it("thẻ cần duyệt (xoá tệp): Bác mở ô lý do, lý do gửi tới aiAgent.bac; sự kiện bi-bac hiện lý do", async () => {
    await batDau();
    await day({ loai: "can-duyet", id: "c9", deXuat: { ten: "delete_file", thamSo: { path: "old.ts" }, pendingActionId: 41 } });
    const the = screen.getByTestId("agent-the-duyet");
    expect(the).toHaveTextContent("XOÁ tệp old.ts");
    expect(screen.getByTestId("agent-trang-thai")).toHaveTextContent("Đang chờ bạn duyệt");

    fireEvent.click(within(the).getByText("Bác"));
    const o = screen.getByTestId("agent-o-ly-do");
    const nutGui = within(o).getByText("Gửi lời bác");
    expect(nutGui).toBeDisabled();
    fireEvent.change(within(o).getByRole("textbox"), { target: { value: "tệp này còn dùng" } });
    expect(nutGui).not.toBeDisabled();
    fireEvent.click(nutGui);
    await nhip();
    expect(goiTrpc.find((g) => g.thuTuc === "bac")).toEqual({ thuTuc: "bac", input: { actionId: "41", lyDo: "tệp này còn dùng" } });

    await day({ loai: "bi-bac", id: "c9", lyDo: "tệp này còn dùng" });
    expect(screen.getByTestId("agent-ket-cuc-duyet")).toHaveTextContent("Đã bác — lý do: tệp này còn dùng");
    expect(screen.queryByTestId("agent-o-ly-do")).toBeNull();
  });

  it("thẻ diff dùng lại TheDuyetDiff; Duyệt & ghi gọi aiAgent.duyet", async () => {
    await batDau();
    await day({
      loai: "can-duyet",
      id: "c2",
      deXuat: {
        ten: "edit_file",
        thamSo: { path: "a.ts" },
        pendingActionId: "77",
        xemTruoc: {
          pendingAction: {
            tool: "apply_diff",
            args: { path: "a.ts", original: "const a = 1;\n", modified: "const a = 2;\n" },
            expiresAt: new Date(Date.now() + 120_000).toISOString(),
            preview: { warnings: [] },
          },
        },
      },
    });
    const the = screen.getByTestId("agent-the-duyet");
    expect(the).toHaveAttribute("data-loai", "diff");
    expect(the.querySelector('[data-the-duyet="apply_diff"]')).not.toBeNull();
    fireEvent.click(within(the).getByText(/^Duyệt & ghi/));
    await nhip();
    expect(goiTrpc.find((g) => g.thuTuc === "duyet")).toEqual({ thuTuc: "duyet", input: { actionId: "77" } });
  });

  it("xong: lý do i18n + tệp đã đổi (mở được) + làm mới trang + Hoàn tác hiện khôi phục/xung đột", async () => {
    hoanTacTra = { khoiPhuc: ["a.ts"], xungDot: [{ duong: "b.ts", lyDo: "đã bị sửa tiếp" }] };
    await batDau();
    await day(
      { loai: "checkpoint", checkpointId: "k1", tep: ["a.ts", "b.ts"] },
      { loai: "goi-tool", goi: { id: "c1", ten: "edit_file", thamSo: { path: "a.ts", edits: [] } }, luot: 1 },
      { loai: "ket-qua-tool", id: "c1", ten: "edit_file", ok: true, tomTat: "đã sửa" },
    );
    expect(onTep).toHaveBeenCalledWith(["a.ts"]);
    await day(
      { loai: "goi-tool", goi: { id: "c2", ten: "write_file", thamSo: { path: "b.ts", content: "x" } }, luot: 2 },
      { loai: "ket-qua-tool", id: "c2", ten: "write_file", ok: true, tomTat: "đã ghi" },
      { loai: "xong", lyDo: "hoan-thanh", tomTat: "Đã sửa 2 tệp." },
    );
    expect(onTep).toHaveBeenLastCalledWith(["b.ts"]);
    const kt = screen.getByTestId("agent-ket-thuc");
    expect(kt).toHaveTextContent("Hoàn thành.");
    expect(kt).toHaveTextContent("Đã sửa 2 tệp.");
    expect(kt).toHaveTextContent("Tệp đã đổi (2)");
    expect(screen.queryByTestId("agent-trang-thai")).toBeNull();

    fireEvent.click(within(kt).getByText("b.ts"));
    expect(onMoTep).toHaveBeenCalledWith("b.ts");

    onTep.mockReset();
    fireEvent.click(within(kt).getByText("Hoàn tác lượt chạy"));
    await nhip();
    expect(goiTrpc.find((g) => g.thuTuc === "hoanTac")).toEqual({ thuTuc: "hoanTac", input: { runId: "r1" } });
    const kq = screen.getByTestId("agent-ket-qua-hoan-tac");
    expect(kq).toHaveTextContent("Đã khôi phục 1 tệp.");
    expect(kq).toHaveTextContent("b.ts — đã bị sửa tiếp");
    expect(onTep).toHaveBeenCalledWith(["a.ts"]);
  });

  it("★ Đợt 2 — thẻ 'Đề xuất nhớ': nội dung + phạm vi; Nhớ gọi aiAgent.nhoDeXuat {runId,id} ⇒ 'Đã nhớ'; Bỏ qua gọi boDeXuat", async () => {
    await batDau();
    await day(
      { loai: "goi-tool", goi: { id: "c5", ten: "find_symbol", thamSo: { name: "cong", kind: "function" } }, luot: 1 },
      { loai: "ket-qua-tool", id: "c5", ten: "find_symbol", ok: true, tomTat: "src/a.ts:1" },
      { loai: "de-xuat-nho", id: "nho-1", note: "Dự án dùng pnpm.", scope: "project" },
      { loai: "de-xuat-nho", id: "nho-2", note: "Thích trả lời ngắn.", scope: "user" },
    );
    const dongTool = screen.getAllByTestId("agent-dong-tool").find((d) => d.getAttribute("data-tool") === "find_symbol")!;
    expect(dongTool).toHaveTextContent("cong · function");

    const the = screen.getAllByTestId("agent-de-xuat-nho");
    expect(the).toHaveLength(2);
    expect(the[0]).toHaveTextContent("Đề xuất nhớ");
    expect(the[0]).toHaveTextContent("Dự án dùng pnpm.");
    expect(the[0]).toHaveTextContent("Dự án này");
    expect(the[1]).toHaveTextContent("Sở thích của bạn");

    fireEvent.click(within(the[0]!).getByText("Nhớ"));
    await nhip();
    expect(goiTrpc.find((g) => g.thuTuc === "nhoDeXuat")).toEqual({ thuTuc: "nhoDeXuat", input: { runId: "r1", id: "nho-1" } });
    expect(screen.getAllByTestId("agent-de-xuat-nho")[0]).toHaveTextContent("Đã nhớ");
    expect(within(screen.getAllByTestId("agent-de-xuat-nho")[0]!).queryByText("Nhớ")).toBeNull();

    fireEvent.click(within(screen.getAllByTestId("agent-de-xuat-nho")[1]!).getByText("Bỏ qua"));
    await nhip();
    expect(goiTrpc.find((g) => g.thuTuc === "boDeXuat")).toEqual({ thuTuc: "boDeXuat", input: { runId: "r1", id: "nho-2" } });
    expect(screen.getAllByTestId("agent-de-xuat-nho")[1]).toHaveTextContent("Đã bỏ qua");
  });

  it("★ Đợt 2 — máy chủ từ chối (ok:false) ⇒ thẻ báo lỗi, không giả 'Đã nhớ'", async () => {
    nhoTra = { ok: false, note: "NOT_FOUND", ketQua: null };
    await batDau();
    await day({ loai: "de-xuat-nho", id: "nho-1", note: "x", scope: "project" });
    fireEvent.click(within(screen.getByTestId("agent-de-xuat-nho")).getByText("Nhớ"));
    await nhip();
    const the = screen.getByTestId("agent-de-xuat-nho");
    expect(the).not.toHaveTextContent("Đã nhớ");
    expect(the).toHaveTextContent("hết hiệu lực");
  });

  it("mọi LyDoDung có câu riêng (không rơi về mã thô)", async () => {
    const { cauLyDoDung } = await import("./DongThoiGianAgent");
    const t = ((_k: string, d: string) => d) as unknown as Parameters<typeof cauLyDoDung>[0];
    const ds = ["hoan-thanh", "het-luot", "het-gio", "het-token", "huy", "lap-lai", "menh-lenh-trong-du-lieu", "loi-model"] as const;
    const cau = ds.map((l) => cauLyDoDung(t, l));
    expect(new Set(cau).size).toBe(ds.length);
    for (let i = 0; i < ds.length; i++) expect(cau[i]).not.toBe(ds[i]);
  });

  it("Dừng gọi /huy của đúng lượt; unmount KHÔNG gọi /huy", async () => {
    await batDau();
    fireEvent.click(screen.getByText("dung"));
    await nhip();
    expect(goiHuy).toEqual(["/api/ai/agent/runs/r1/huy"]);
    goiHuy = [];
    cleanup();
    await nhip();
    expect(goiHuy).toEqual([]);
  });

  it("vào trang có lượt chạy còn sống ⇒ mời nối lại; Nối lại phát lại từ ?tu=0 và dựng lại dòng thời gian", async () => {
    danhSachTra = [{ id: "r7", trangThai: "cho-duyet", projectId: "p1", cauHoi: "việc dở" }];
    render(<Harness />);
    await nhip();
    expect(goiTrpc[0]!.thuTuc).toBe("danhSach");
    const moi = screen.getByTestId("agent-moi-noi-lai");
    expect(moi).toHaveTextContent("việc dở");
    fireEvent.click(within(moi).getByText("Nối lại"));
    await nhip();
    expect(luong[0]!.url).toBe("/api/ai/agent/runs/r7/events?tu=0");
    await day(
      { loai: "bat-dau", runId: "r7", cheDo: "sua" },
      { loai: "can-duyet", id: "c1", deXuat: { ten: "run_command", thamSo: { command: "npm test" } } },
    );
    expect(screen.queryByTestId("agent-moi-noi-lai")).toBeNull();
    expect(screen.getByTestId("agent-the-duyet")).toHaveTextContent("npm test");
  });

  it("luồng đóng khi lượt chưa xong ⇒ báo mất kết nối + Nối lại tiếp từ ?tu=<số sự kiện đã nhận>", async () => {
    await batDau();
    await day({ loai: "chu", noiDung: "a" });
    luong[0]!.dong();
    await nhip();
    const mk = screen.getByTestId("agent-mat-ket-noi");
    fireEvent.click(within(mk).getByText("Nối lại"));
    await nhip();
    expect(luong[1]!.url).toBe("/api/ai/agent/runs/r1/events?tu=2");
  });
});

describe("DongThoiGianAgent — nội dung đáng ngờ (2026-10-17: cảnh báo, không dừng)", () => {
  it("canh-bao-du-lieu + ha-tu-tri ⇒ dòng cảnh báo; thẻ duyệt sau đó nêu nguồn đáng ngờ; lượt vẫn chạy", async () => {
    await batDau();
    await day(
      { loai: "canh-bao-du-lieu", id: "c1", ten: "read_file", nguon: "shared/agentCore/loiNhac.ts", mau: ["ignore_instructions"] },
      { loai: "ha-tu-tri", lyDo: "noi-dung-dang-ngo", nguon: "shared/agentCore/loiNhac.ts", mau: ["ignore_instructions"] },
      { loai: "can-duyet", id: "c2", deXuat: { ten: "delete_file", thamSo: { path: "old.ts" }, nguonDangNgo: ["shared/agentCore/loiNhac.ts"] } },
    );
    const cb = screen.getAllByTestId("agent-canh-bao");
    expect(cb).toHaveLength(2);
    expect(cb[0]).toHaveTextContent("shared/agentCore/loiNhac.ts");
    expect(cb[0]).toHaveAttribute("data-loai", "du-lieu");
    expect(cb[1]).toHaveAttribute("data-loai", "ha-tu-tri");
    expect(within(screen.getByTestId("agent-the-duyet")).getByTestId("agent-the-dang-ngo")).toHaveTextContent("shared/agentCore/loiNhac.ts");
    expect(screen.getByTestId("agent-trang-thai")).toBeInTheDocument();
  });
});

// ★ Đợt 5.1 — nút 👍/👎 gắn dưới câu trả lời CUỐI của lượt ĐÃ XONG. `chiSoTin` = thứ tự khối `chu` trên dòng thời gian
// (cùng luật gộp với `khoiTraLoiTuSuKien` máy chủ). Thẻ duyệt diff KHÔNG mang nút (quyết định duyệt/bác máy chủ tự ghi).
describe("DongThoiGianAgent — phản hồi 👍/👎 (Đợt 5.1)", () => {
  const DIFF = {
    loai: "can-duyet" as const,
    id: "c2",
    deXuat: {
      ten: "edit_file",
      thamSo: { path: "a.ts" },
      pendingActionId: "77",
      xemTruoc: { path: "a.ts", original: "const a = 1;\n", modified: "const a = 2;\n" },
    },
  };

  it("lượt ĐANG chạy ⇒ không có nút phản hồi (kể cả khi đã có chữ)", async () => {
    await batDau();
    await day({ loai: "chu", noiDung: "Đang xem xét…" });
    expect(screen.getByTestId("agent-chu")).toBeInTheDocument();
    expect(screen.queryByTestId("nut-phan-hoi")).toBeNull();
    expect(goiTrpc.some((g) => g.thuTuc === "phanHoiCuaToi")).toBe(false);
  });

  it("lượt XONG ⇒ đúng MỘT nút, ngay dưới câu trả lời CUỐI; bấm 👍 gửi {tra-loi, runId, chiSoTin} đúng khối; thẻ diff không có nút", async () => {
    await batDau();
    await day(
      { loai: "chu", noiDung: "Tôi sẽ đọc tệp." },
      { loai: "goi-tool", goi: { id: "t1", ten: "read_file", thamSo: { path: "a.ts" } }, luot: 1 },
      { loai: "ket-qua-tool", id: "t1", ten: "read_file", ok: true, tomTat: "ok" },
      DIFF,
      { loai: "da-duyet", id: "c2" },
      { loai: "chu", noiDung: "Đã sửa " },
      { loai: "usage", vao: 1, ra: 1 }, // không lên dòng thời gian ⇒ KHÔNG cắt khối
      { loai: "chu", noiDung: "xong." },
    );
    expect(screen.queryByTestId("nut-phan-hoi")).toBeNull();
    await day({ loai: "xong", lyDo: "hoan-thanh" });

    const nut = screen.getAllByTestId("nut-phan-hoi");
    expect(nut).toHaveLength(1);
    const chu = screen.getAllByTestId("agent-chu");
    expect(chu).toHaveLength(2);
    expect(chu[1]).toHaveTextContent("Đã sửa xong.");
    expect(chu[1]!.nextElementSibling).toContainElement(nut[0]!);
    expect(within(screen.getByTestId("agent-the-duyet")).queryByTestId("nut-phan-hoi")).toBeNull();

    fireEvent.click(within(nut[0]!).getByRole("button", { name: "Hữu ích" }));
    await nhip();
    expect(goiTrpc.find((g) => g.thuTuc === "phanHoi")).toEqual({
      thuTuc: "phanHoi",
      input: { loai: "tra-loi", runId: "r1", chiSoTin: 1, danhGia: 1 },
    });
    expect(within(nut[0]!).getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "true");
  });

  it("mở lại: phiếu CỦA MÌNH cho đúng (runId, chiSoTin) được tải lại từ phanHoiCuaToi", async () => {
    phanHoiCuaToiTra = {
      ok: true,
      note: null,
      phieu: [
        { loai: "tra-loi", runId: "r-khac", chiSoTin: 0, danhGia: 1 },
        { loai: "tra-loi", runId: "r1", chiSoTin: 5, danhGia: 1 },
        { loai: "diff", runId: "r1", chiSoTin: null, actionId: "77", danhGia: 1 },
        { loai: "tra-loi", runId: "r1", chiSoTin: 0, danhGia: -1 },
      ],
    };
    await batDau();
    await day({ loai: "chu", noiDung: "Trả lời." }, { loai: "xong", lyDo: "hoan-thanh" });
    const nut = screen.getByTestId("nut-phan-hoi");
    expect(within(nut).getByRole("button", { name: "Chưa tốt" })).toHaveAttribute("aria-pressed", "true");
    expect(within(nut).getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "false");
  });

  it("đọc phiếu hỏng (ok:false) ⇒ vẫn hiện nút, chưa chọn gì", async () => {
    phanHoiCuaToiTra = { ok: false, note: "PERMISSION_DENIED", phieu: [] };
    await batDau();
    await day({ loai: "chu", noiDung: "Trả lời." }, { loai: "xong", lyDo: "hoan-thanh" });
    const nut = screen.getByTestId("nut-phan-hoi");
    expect(within(nut).getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "false");
    expect(within(nut).getByRole("button", { name: "Chưa tốt" })).toHaveAttribute("aria-pressed", "false");
  });

  it("lượt xong mà KHÔNG có chữ trả lời ⇒ không có nút", async () => {
    await batDau();
    await day({ loai: "loi", ma: "E", thongDiep: "hỏng" }, { loai: "xong", lyDo: "loi-model" });
    expect(screen.queryByTestId("nut-phan-hoi")).toBeNull();
  });

  it("dừng TRƯỚC bat-dau (chưa có runId phía máy chủ) ⇒ không có nút", async () => {
    render(<Harness />);
    await nhip();
    fireEvent.click(screen.getByText("gui"));
    await nhip();
    fireEvent.click(screen.getByText("dung"));
    await nhip();
    expect(screen.getByTestId("agent-ket-thuc")).toBeInTheDocument();
    expect(screen.queryByTestId("nut-phan-hoi")).toBeNull();
  });
});
