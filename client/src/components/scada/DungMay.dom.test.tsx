// @vitest-environment jsdom
//
// SCADA R1b-1 Task 2 — nút "DỪNG MÁY" (STOP HMI một bước) + cảnh báo cấp máy. Render THẬT với bundle vi/en THẬT; chỉ mock hợp đồng mạng
// (`@/lib/trpc`), socket dùng chung và danh tính. Hợp đồng (điều phối 2026-10-24):
//   - hộp xác nhận MỘT bước: nút MẶC ĐỊNH "Dừng máy" có focus ⇒ một lần Enter là gửi; KHÔNG ô lý do;
//   - kết quả theo TỪNG adapter (đạt / không đạt / chưa xác minh); không đạt / chưa xác minh ⇒ dòng đỏ + "Dùng E-STOP cứng tại máy";
//   - nút hiện cả khi LOCAL; cảnh báo "Máy chưa ghim STOP" ở faceplate (M4) và khối chế độ máy (M12);
//   - gợi ý MODE_LOCAL mới (ruling R-2) ở locale en không còn chữ Việt.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};
const E = (k: string): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], en_);
  if (typeof v !== "string") throw new Error(`thiếu khoá en: ${k}`);
  return v;
};
const CHU_VIET = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 9, role: "operator", name: "T" }, loading: false, isAuthenticated: true }),
}));
vi.mock("@/lib/socketManager", () => {
  const s = { connected: false, on: () => s, off: () => s, emit: () => s };
  return { getSharedSocket: () => s, releaseSharedSocket: () => undefined };
});

type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  kenh: [] as Record<string, unknown>[],
  tags: [] as Record<string, unknown>[],
  cheDo: [] as Record<string, unknown>[],
  calls: [] as Array<{ proc: string; vars: unknown }>,
  opts: {} as Record<string, { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }>,
}));
vi.mock("@/lib/trpc", () => {
  const mut = (proc: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      srv.opts[proc] = opts;
      return { mutate: (vars: unknown) => srv.calls.push({ proc, vars }), isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({ scadaKenh: { cheDo: { danhSach: { invalidate: () => undefined } }, danhSach: { invalidate: () => undefined } } }),
      scadaCommands: { request: mut("request"), confirm: mut("confirm"), huy: mut("huy"), dungMay: mut("dungMay") },
      scadaKenh: {
        danhSach: { useQuery: () => ({ data: srv.kenh, isLoading: false, isError: false }) },
        cheDo: {
          danhSach: { useQuery: () => ({ data: srv.cheDo, isLoading: false, isError: false }) },
          dat: mut("dat"),
          go: mut("go"),
        },
      },
      scadaDiag: { tagCuaAdapter: { useQuery: () => ({ data: srv.tags, isLoading: false, isError: false }) } },
    },
  };
});

import { Faceplate } from "./Faceplate";
import { HopDungMay, NutDungMay } from "./DungMay";
import { KenhCheDoMay } from "./KenhCheDoMay";

const kenh = (o: Row): Row => ({
  tagId: 100,
  tagKey: "sp",
  dataType: "float",
  unit: "°C",
  writable: true,
  isEnabled: true,
  loaiKenh: "input_output",
  channelKindKhai: null,
  displayName: "Zone 7 SP",
  displayFormat: "0.0",
  writeMin: 240,
  writeMax: 250,
  writeStep: 0.5,
  actuationLevel: 3,
  mucHieuLuc: 3,
  stopValue: null,
  laKenhCheDo: false,
  canhBaoKenhDung: false,
  ...o,
});
const live = (o: Row): Row => ({ tagKey: "sp", address: "40001", v: 245, q: "good", ts: null, ageMs: 800, stale: false, statusCode: null, ...o });
const may = (o: Row): Row => ({
  machineId: 10,
  code: "RF-2",
  ten: "Reflow 2",
  kenhAn: false,
  kenh: null,
  cheDo: "REMOTE",
  lyDo: "remote",
  canhBaoNguon: null,
  coGhimStop: true,
  soAdapterGhimStop: 2,
  ...o,
});

beforeAll(async () => {
  await initLayoutKitTestI18n();
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
});
beforeEach(() => {
  srv.kenh = [kenh({})];
  srv.tags = [live({})];
  srv.cheDo = [may({})];
  srv.calls = [];
  srv.opts = {};
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("vi");
  });
});

const goi = (proc: string) => srv.calls.filter((c) => c.proc === proc);
const hop = () => screen.getByTestId("hop-dung-may");
const nutMacDinh = () => within(hop()).getByTestId("nut-xac-nhan-dung");
const veHop = (o: Partial<React.ComponentProps<typeof HopDungMay>> = {}) => {
  const onDong = vi.fn();
  render(<HopDungMay machineId={10} tenMay="RF-2 · Reflow 2" soAdapter={2} onDong={onDong} {...o} />);
  return { onDong };
};
const veFaceplate = (props: Partial<React.ComponentProps<typeof Faceplate>> = {}) =>
  render(<Faceplate adapterId={1} tagKey="sp" machineId={10} edgeCode={null} onDong={vi.fn()} {...props} />);
const traLoi = async (kieu: "onSuccess" | "onError", v: unknown) => {
  await act(async () => {
    srv.opts.dungMay[kieu]?.(v);
  });
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("hộp xác nhận MỘT bước", () => {
  it("★ nút MẶC ĐỊNH 'Dừng máy' có focus sẵn; MỘT lần Enter là gửi dungMay {machineId, clientRequestId} — không lyDo", async () => {
    veHop();
    expect(within(hop()).getByText(S("scada.dungMay.tieuDe", { may: "RF-2 · Reflow 2" }))).toBeInTheDocument();
    expect(within(hop()).getByText(S("scada.dungMay.moTa", { n: 2 }))).toBeInTheDocument();
    expect(nutMacDinh()).toHaveTextContent(S("scada.dungMay.nutXacNhan"));
    expect(nutMacDinh()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(goi("dungMay")).toHaveLength(1);
    const v = goi("dungMay")[0].vars as Record<string, unknown>;
    expect(v.machineId).toBe(10);
    expect(String(v.clientRequestId)).toMatch(UUID);
    expect(v).not.toHaveProperty("lyDo");
    expect(within(hop()).getByRole("status")).toHaveTextContent(S("scada.dungMay.dangGui"));
  });

  it("★ KHÔNG có ô lý do (không ô nhập nào) — bấm thẳng 'Dừng máy' là gửi", () => {
    veHop();
    expect(within(hop()).queryByRole("textbox")).toBeNull();
    expect(within(hop()).queryByLabelText(S("scada.kenh.dialog.lyDo"))).toBeNull();
    fireEvent.click(nutMacDinh());
    expect(goi("dungMay")).toHaveLength(1);
  });

  it("nút mặc định dùng token DỪNG (--packml-abort), không phải màu cảnh báo", () => {
    veHop();
    const st = nutMacDinh().getAttribute("style") ?? "";
    expect(st).toContain("--packml-abort");
    expect(st).not.toMatch(/--alarm-/);
  });

  it("hai cú (Enter + bấm) trong cùng lượt ⇒ MỘT lần gửi; Huỷ ⇒ không gửi", async () => {
    const { onDong } = veHop();
    const nut = nutMacDinh();
    fireEvent.click(nut);
    fireEvent.click(nut);
    expect(goi("dungMay")).toHaveLength(1);
    cleanup();
    srv.calls = [];
    const h = veHop();
    fireEvent.click(within(hop()).getByRole("button", { name: S("scada.dungMay.nutHuy") }));
    expect(goi("dungMay")).toHaveLength(0);
    expect(h.onDong).toHaveBeenCalledTimes(1);
    expect(onDong).not.toHaveBeenCalled();
  });
});

describe("kết quả theo TỪNG adapter", () => {
  it("★ đạt / không đạt / chưa xác minh (edge ⇒ 'đã gửi tới edge'); chỉ dòng KHÔNG đạt hoặc chưa xác minh có dòng đỏ 'Dùng E-STOP cứng tại máy'", async () => {
    veHop({ soAdapter: 3 });
    fireEvent.click(nutMacDinh());
    await traLoi("onSuccess", {
      ketQua: [
        { adapterId: 1, code: "PLC-A", status: "acked_verified", ok: true, simulated: false, writes: [{ tagKey: "stop_cmd", value: true }], commandLogIds: [5] },
        { adapterId: 2, code: "PLC-B", status: "rejected", ok: false, simulated: false, reason: "SAFETY_BLOCKED", writes: [{ tagKey: "speed_sp", value: 0 }], commandLogIds: [6] },
        { adapterId: 3, code: "PLC-E", status: "rejected", ok: false, simulated: false, reason: "ADAPTER_OWNED_BY_EDGE", edgeStopRequest: true, writes: [{ tagKey: "stop_cmd", value: true }], commandLogIds: [7] },
      ],
    });
    const a = screen.getByTestId("ket-qua-dung-1");
    const b = screen.getByTestId("ket-qua-dung-2");
    const e = screen.getByTestId("ket-qua-dung-3");
    expect(a).toHaveAttribute("data-loai", "dat");
    expect(a).toHaveTextContent(S("scada.dungMay.dat"));
    expect(a).toHaveTextContent(S("scada.lenh.ketQua.ackedVerified", { v: "stop_cmd=true" }));
    expect(within(a).queryByTestId("dung-estop")).toBeNull();

    expect(b).toHaveAttribute("data-loai", "khongDat");
    expect(b).toHaveTextContent(S("scada.dungMay.khongDat"));
    expect(b).toHaveTextContent(S("scada.lenh.cong.SAFETY_BLOCKED"));
    expect(within(b).getByTestId("dung-estop")).toHaveTextContent("Dùng E-STOP cứng tại máy");
    expect(b.getAttribute("style") ?? "").toContain("--packml-abort");

    expect(e).toHaveAttribute("data-loai", "chuaXacMinh");
    expect(e).toHaveTextContent(S("scada.dungMay.chuaXacMinh"));
    expect(e).toHaveTextContent(S("scada.dungMay.daGuiEdge"));
    expect(within(e).getByTestId("dung-estop")).toHaveTextContent("Dùng E-STOP cứng tại máy");
    for (const el of [a, b, e]) expect(el.getAttribute("style") ?? "").not.toMatch(/--alarm-/);
  });

  it("acked_unverified ⇒ chưa xác minh + dòng đỏ E-STOP", async () => {
    veHop();
    fireEvent.click(nutMacDinh());
    await traLoi("onSuccess", {
      ketQua: [{ adapterId: 1, code: "PLC-A", status: "acked_unverified", ok: true, simulated: false, writes: [], commandLogIds: [5] }],
    });
    const a = screen.getByTestId("ket-qua-dung-1");
    expect(a).toHaveAttribute("data-loai", "chuaXacMinh");
    expect(within(a).getByTestId("dung-estop")).toBeInTheDocument();
  });

  it("★ máy chưa ghim (CHUA_GHIM_STOP) ⇒ chữ M5 của điều phối + dòng đỏ E-STOP", async () => {
    veHop();
    fireEvent.click(nutMacDinh());
    await traLoi("onError", { message: "x", data: { appCode: "SCADA_STOP_NOT_PINNED", appParams: { ma: "CHUA_GHIM_STOP" } } });
    expect(within(hop()).getByTestId("loi-lenh")).toHaveTextContent(
      "Máy chưa ghim giá trị STOP — kỹ sư ghim ở /scada/config/channels; dừng bằng E-STOP cứng",
    );
    expect(within(hop()).getByTestId("dung-estop")).toBeInTheDocument();
  });

  it("lỗi KHÔNG mã (mạng) ⇒ đọc như confirm: 'không rõ máy đã nhận' + E-STOP", async () => {
    veHop();
    fireEvent.click(nutMacDinh());
    await traLoi("onError", new Error("network"));
    expect(within(hop()).getByTestId("loi-lenh")).toBeInTheDocument();
    expect(within(hop()).getByTestId("dung-estop")).toBeInTheDocument();
  });
});

describe("faceplate (M4) + khối chế độ máy (M12)", () => {
  it("★ nút DỪNG MÁY hiện cả khi máy LOCAL (mọi lệnh ghi khác ẩn); mở hộp xác nhận với số adapter", () => {
    srv.cheDo = [may({ cheDo: "LOCAL", lyDo: "khac_remote", soAdapterGhimStop: 2 })];
    veFaceplate();
    const fp = screen.getByTestId("faceplate");
    expect(within(fp).getByText(S("scada.faceplate.taiCho"))).toBeInTheDocument();
    expect(within(fp).queryByRole("button", { name: S("scada.faceplate.nutDoi") })).toBeNull();
    const nut = within(fp).getByTestId("nut-dung-may");
    expect(nut).toHaveTextContent(S("scada.dungMay.nut"));
    fireEvent.click(nut);
    expect(within(hop()).getByText(S("scada.dungMay.moTa", { n: 2 }))).toBeInTheDocument();
  });

  it("nút hiện cả trên kênh CHỈ ĐỌC; adapter không gắn máy ⇒ không có nút (không có máy để dừng)", () => {
    srv.kenh = [kenh({ writable: false, loaiKenh: "input" })];
    veFaceplate();
    expect(screen.getByTestId("nut-dung-may")).toBeInTheDocument();
    cleanup();
    veFaceplate({ machineId: null });
    expect(screen.queryByTestId("nut-dung-may")).toBeNull();
  });

  it("★ cảnh báo cấp máy 'Máy chưa ghim STOP — nút dừng HMI không dùng được' khi coGhimStop false (M4); có ghim ⇒ không", () => {
    srv.cheDo = [may({ coGhimStop: false, soAdapterGhimStop: 0 })];
    veFaceplate();
    expect(screen.getByTestId("canh-bao-chua-ghim-stop")).toHaveTextContent("Máy chưa ghim STOP — nút dừng HMI không dùng được");
    expect(screen.getByTestId("nut-dung-may")).toBeEnabled(); // máy chủ quyết (CHUA_GHIM_STOP), client không chặn theo cờ có thể cũ
    cleanup();
    srv.cheDo = [may({ coGhimStop: true })];
    veFaceplate();
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
  });

  it("★ cảnh báo cấp máy ở khối chế độ máy (M12) cho đúng máy chưa ghim", () => {
    render(<KenhCheDoMay rows={[may({ machineId: 10, coGhimStop: false }), may({ machineId: 11, code: "RF-3", coGhimStop: true })] as never} adapters={[]} canAct={false} />);
    const ds = screen.getAllByTestId("canh-bao-chua-ghim-stop");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toHaveTextContent(S("scada.dungMay.canhBaoChuaGhim"));
  });

  it("NutDungMay: coGhimStop vắng (đang tải) ⇒ không cảnh báo", () => {
    render(<NutDungMay machineId={10} tenMay="RF-2" />);
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
  });
});

describe("ruling R-2 — gợi ý MODE_LOCAL ở locale en", () => {
  it("★ máy có ghim ⇒ 'STOP MACHINE button (sends the pinned STOP) or the hardwired E-STOP' — không còn chữ Việt; máy chưa ghim ⇒ chữ E-STOP cứng", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
    veFaceplate();
    const fp = screen.getByTestId("faceplate");
    fireEvent.change(within(fp).getByLabelText(E("scada.faceplate.giaTriMoi")), { target: { value: "245" } });
    fireEvent.change(within(fp).getByLabelText(E("scada.kenh.dialog.lyDo")), { target: { value: "Lower SP Z7" } });
    fireEvent.click(within(fp).getByRole("button", { name: E("scada.faceplate.nutDoi") }));
    await act(async () => {
      srv.opts.request.onError?.({ message: "x", data: { appCode: "SCADA_MACHINE_NOT_REMOTE", appParams: { ma: "MODE_LOCAL", lyDo: "khac_remote" } } });
    });
    const g = within(fp).getByTestId("goi-y-stop");
    expect(g).toHaveTextContent(E("scada.lenh.loi.goiYStop"));
    expect(g.textContent).toMatch(/STOP MACHINE/);
    expect(CHU_VIET.test(g.textContent ?? "")).toBe(false);
    expect(CHU_VIET.test(within(fp).getByTestId("loi-lenh").textContent ?? "")).toBe(false);
    expect(CHU_VIET.test(within(fp).getByTestId("khoi-dung-may").textContent ?? "")).toBe(false);
    cleanup();
    srv.cheDo = [may({ coGhimStop: false })];
    veFaceplate();
    const fp2 = screen.getByTestId("faceplate");
    fireEvent.change(within(fp2).getByLabelText(E("scada.faceplate.giaTriMoi")), { target: { value: "245" } });
    fireEvent.change(within(fp2).getByLabelText(E("scada.kenh.dialog.lyDo")), { target: { value: "Lower SP Z7" } });
    fireEvent.click(within(fp2).getByRole("button", { name: E("scada.faceplate.nutDoi") }));
    await act(async () => {
      srv.opts.request.onError?.({ message: "x", data: { appCode: "SCADA_MACHINE_NOT_REMOTE", appParams: { ma: "MODE_LOCAL", lyDo: "khac_remote" } } });
    });
    expect(within(fp2).getByTestId("goi-y-stop")).toHaveTextContent(E("scada.lenh.loi.goiYStopKhongGhim"));
    expect(CHU_VIET.test(within(fp2).getByTestId("khoi-dung-may").textContent ?? "")).toBe(false);
  });
});
