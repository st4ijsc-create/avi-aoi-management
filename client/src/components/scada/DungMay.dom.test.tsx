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
import { CanhBaoKhaNangDung, HopDungMay, NutDungMay, QUA_HAN_GUI_MS } from "./DungMay";
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

describe("fix round 1 — khảo sát khả năng dừng (hộp xác nhận + cảnh báo cấp máy) + quá hạn gửi", () => {
  const kn = (adapters: Array<Record<string, unknown>>, tongHop = "mot_phan") => ({ machineId: 10, adapters, tongHop }) as never;

  it("★ hộp xác nhận liệt kê TRƯỚC khi gửi điều sẽ xảy ra với TỪNG adapter (mọi kết luận)", () => {
    veHop({
      khaNang: kn([
        { adapterId: 1, code: "PLC-A", trangThai: "duoc" },
        { adapterId: 2, code: "PLC-E", trangThai: "qua_edge", edgeCode: "EN-02", edgeToiDuoc: true },
        { adapterId: 3, code: "PLC-C", trangThai: "mo_phong", lyDo: "chua_nghiem_thu" },
        { adapterId: 4, code: "PLC-O", trangThai: "mo_phong", lyDo: "ot_control_tat" },
        { adapterId: 5, code: "PLC-G", trangThai: "ghim_cu" },
        { adapterId: 6, code: "PLC-K", trangThai: "mat_ket_noi" },
        { adapterId: 7, code: "PLC-N", trangThai: "chua_ghim" },
      ]),
    });
    const h = hop();
    expect(within(h).getByText(S("scada.dungMay.khaNangTieuDe"))).toBeInTheDocument();
    const mong: Array<[number, string, string]> = [
      [1, "duoc", "scada.dungMay.khaNang.duoc"],
      [2, "qua_edge", "scada.dungMay.khaNang.quaEdge"],
      [3, "mo_phong", "scada.dungMay.khaNang.moPhongChuaNghiemThu"],
      [4, "mo_phong", "scada.dungMay.khaNang.moPhongOtTat"],
      [5, "ghim_cu", "scada.dungMay.khaNang.ghimCuKetNoiCu"],
      [6, "mat_ket_noi", "scada.dungMay.khaNang.matKetNoi"],
      [7, "chua_ghim", "scada.dungMay.khaNang.chuaGhim"],
    ];
    for (const [id, tt, k] of mong) {
      const li = within(h).getByTestId(`kha-nang-${id}`);
      expect(li).toHaveAttribute("data-trang-thai", tt);
      expect(li).toHaveTextContent(S(k, { code: "EN-02" }));
    }
    expect(within(h).getByTestId("kha-nang-2")).toHaveTextContent("STOP gửi qua node edge EN-02 — chỉ xác nhận khi edge báo lại");
    // vẫn MỘT bước: nút mặc định có focus, gửi được
    expect(nutMacDinh()).toHaveFocus();
  });

  it("★ cảnh báo cấp máy: ghim_cu ⇒ 'cần kết nối lại adapter {code}'; mo_phong chưa nghiệm thu ⇒ 'adapter {code} chưa nghiệm thu'; OT tắt ⇒ MỘT dòng riêng; mọi adapter chưa ghim ⇒ 'Máy chưa ghim STOP'; mọi adapter được ⇒ không cảnh báo", () => {
    render(
      <CanhBaoKhaNangDung
        khaNang={kn([
          { adapterId: 1, code: "PLC-G", trangThai: "ghim_cu" },
          { adapterId: 2, code: "PLC-C", trangThai: "mo_phong", lyDo: "chua_nghiem_thu" },
          { adapterId: 3, code: "PLC-O", trangThai: "mo_phong", lyDo: "ot_control_tat" },
          { adapterId: 4, code: "PLC-P", trangThai: "mo_phong", lyDo: "ot_control_tat" },
          { adapterId: 5, code: "PLC-A", trangThai: "duoc" },
        ])}
      />,
    );
    const cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent("Ghim STOP chưa có hiệu lực — cần kết nối lại adapter PLC-G");
    expect(cb).toHaveTextContent("STOP chỉ mô phỏng — adapter PLC-C chưa nghiệm thu");
    expect(cb).toHaveTextContent(S("scada.dungMay.canhBao.moPhongOtTat"));
    expect(cb.querySelectorAll("p")).toHaveLength(3); // OT tắt gộp một dòng
    expect(cb.getAttribute("style") ?? "").toContain("--packml-abort");
    cleanup();
    render(<CanhBaoKhaNangDung khaNang={kn([{ adapterId: 1, code: "A", trangThai: "chua_ghim" }, { adapterId: 2, code: "B", trangThai: "chua_ghim" }], "khong")} />);
    expect(screen.getByTestId("canh-bao-chua-ghim-stop")).toHaveTextContent("Máy chưa ghim STOP — nút dừng HMI không dùng được");
    cleanup();
    const { container } = render(<CanhBaoKhaNangDung khaNang={kn([{ adapterId: 1, code: "A", trangThai: "duoc" }], "duoc")} />);
    expect(container.textContent).toBe("");
  });

  it("★ faceplate (M4): cảnh báo theo khaNangDung của hàng máy (ghim chưa hiệu lực) và chuyển danh sách vào hộp xác nhận", () => {
    srv.cheDo = [may({ khaNangDung: { machineId: 10, adapters: [{ adapterId: 1, code: "PLC-G", trangThai: "ghim_cu" }], tongHop: "khong" } })];
    veFaceplate();
    expect(screen.getByTestId("canh-bao-kha-nang-dung")).toHaveTextContent("Ghim STOP chưa có hiệu lực — cần kết nối lại adapter PLC-G");
    fireEvent.click(screen.getByTestId("nut-dung-may"));
    expect(within(hop()).getByTestId("kha-nang-1")).toHaveTextContent(S("scada.dungMay.khaNang.ghimCuKetNoiCu"));
  });

  it("★ đang gửi quá 10 s ⇒ 'Kết quả chưa rõ — dùng E-STOP cứng tại máy' + nút Đóng mở", async () => {
    vi.useFakeTimers();
    try {
      const { onDong } = veHop();
      fireEvent.click(nutMacDinh());
      const dong = within(hop()).getByRole("button", { name: S("scada.dungMay.nutDong") });
      expect(dong).toBeDisabled();
      expect(within(hop()).queryByTestId("chua-ro")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(QUA_HAN_GUI_MS - 1);
      });
      expect(within(hop()).queryByTestId("chua-ro")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(within(hop()).getByTestId("chua-ro")).toHaveTextContent("Kết quả chưa rõ — dùng E-STOP cứng tại máy");
      const dong2 = within(hop()).getByRole("button", { name: S("scada.dungMay.nutDong") });
      expect(dong2).toBeEnabled();
      fireEvent.click(dong2);
      expect(onDong).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chữ khả năng dừng / cảnh báo / quá hạn ở en + zh không có chữ Việt", () => {
    for (const k of ["chuaRo", "khaNangTieuDe", "mayTieuDe", "khaNang.duoc", "khaNang.quaEdge", "khaNang.matKetNoi", "khaNang.khongKiemDuoc", "khaNang.moPhongChuaNghiemThu", "khaNang.moPhongOtTat", "khaNang.ghimCuKetNoiCu", "khaNang.chuaGhim", "canhBao.ghimCu", "canhBao.moPhong", "canhBao.moPhongOtTat", "canhBao.matKetNoi", "canhBao.quaEdge", "canhBao.edgeKhongToi", "canhBao.khongKiemDuoc", "canhBao.chuaGhimMotPhan", "daGuiDuPhong", "loiTaiDiag", "loiTaiMay"]) {
      expect(CHU_VIET.test(E(`scada.dungMay.${k}`)), k).toBe(false);
    }
  });
});

describe("fix round 2 — kết luận mới + cảnh báo một phần + nhánh dự phòng", () => {
  const kn = (adapters: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ machineId: 10, adapters, tongHop: "khong", ...extra }) as never;

  it("★ mat_ket_noi ⇒ 'Adapter {code} mất kết nối — STOP sẽ không tới máy (ADAPTER_OFFLINE)'; KHÔNG dùng câu 'cần kết nối lại' của ghim_cu", () => {
    render(<CanhBaoKhaNangDung khaNang={kn([{ adapterId: 1, code: "PLC-K", trangThai: "mat_ket_noi" }])} />);
    const cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent("Adapter PLC-K mất kết nối — STOP sẽ không tới máy (ADAPTER_OFFLINE)");
    expect(cb).not.toHaveTextContent("Ghim STOP chưa có hiệu lực");
  });

  it("★ qua_edge ⇒ 'STOP gửi qua node edge {code} — chỉ xác nhận khi edge báo lại'; node không liên lạc được ⇒ thêm cảnh báo", () => {
    render(<CanhBaoKhaNangDung khaNang={kn([{ adapterId: 1, code: "PLC-E", trangThai: "qua_edge", edgeCode: "EN-02", edgeToiDuoc: true }])} />);
    let cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent("STOP gửi qua node edge EN-02 — chỉ xác nhận khi edge báo lại");
    expect(cb).not.toHaveTextContent(S("scada.dungMay.canhBao.edgeKhongToi", { code: "EN-02" }));
    cleanup();
    render(<CanhBaoKhaNangDung khaNang={kn([{ adapterId: 1, code: "PLC-E", trangThai: "qua_edge", edgeCode: "EN-02", edgeToiDuoc: false }])} />);
    cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent(S("scada.dungMay.canhBao.edgeKhongToi", { code: "EN-02" }));
  });

  it("★ khong_kiem_duoc (adapter) và loiKhaoSat (cả máy) ⇒ 'Không kiểm được khả năng dừng — dùng E-STOP cứng nếu cần'; loiKhaoSat KHÔNG báo 'chưa ghim'", () => {
    render(<CanhBaoKhaNangDung khaNang={kn([{ adapterId: 1, code: "A", trangThai: "khong_kiem_duoc" }, { adapterId: 2, code: "B", trangThai: "khong_kiem_duoc" }])} />);
    let cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent("Không kiểm được khả năng dừng — dùng E-STOP cứng nếu cần");
    expect(cb.querySelectorAll("p")).toHaveLength(1);
    cleanup();
    render(<CanhBaoKhaNangDung khaNang={kn([], { loiKhaoSat: true })} />);
    cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent("Không kiểm được khả năng dừng — dùng E-STOP cứng nếu cần");
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
    cleanup();
    veHop({ khaNang: kn([], { loiKhaoSat: true }) });
    expect(within(hop()).getByTestId("kha-nang-dung-loi")).toHaveTextContent(S("scada.dungMay.canhBao.khongKiemDuoc"));
  });

  it("★ chua_ghim MỘT PHẦN ⇒ 'Adapter {list} chưa ghim STOP' (cùng các cảnh báo khác)", () => {
    render(
      <CanhBaoKhaNangDung
        khaNang={kn([
          { adapterId: 1, code: "PLC-A", trangThai: "duoc" },
          { adapterId: 2, code: "SENS-1", trangThai: "chua_ghim" },
          { adapterId: 3, code: "SENS-2", trangThai: "chua_ghim" },
        ])}
      />,
    );
    expect(screen.getByTestId("canh-bao-kha-nang-dung")).toHaveTextContent("Adapter SENS-1, SENS-2 chưa ghim STOP");
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
  });

  it("★ kết quả: edge không nhận, trung tâm gửi STOP dự phòng ⇒ chưa xác minh + chữ dự phòng + dòng đỏ E-STOP", async () => {
    veHop();
    fireEvent.click(nutMacDinh());
    await traLoi("onSuccess", {
      ketQua: [{ adapterId: 3, code: "PLC-E", status: "rejected", ok: false, simulated: false, reason: "ADAPTER_OWNED_BY_EDGE", centralFallbackSent: true, writes: [], commandLogIds: [9] }],
    });
    const e = screen.getByTestId("ket-qua-dung-3");
    expect(e).toHaveAttribute("data-loai", "chuaXacMinh");
    expect(e).toHaveTextContent(S("scada.dungMay.daGuiDuPhong"));
    expect(within(e).getByTestId("dung-estop")).toBeInTheDocument();
  });
});

describe("fix round 3 — khảo sát LỖI ⇒ 'không kiểm được', không bao giờ 'chưa ghim'", () => {
  const KKD = "Không kiểm được khả năng dừng — dùng E-STOP cứng nếu cần";

  it("★ faceplate (M4): coGhimStop null + loiKhaoSat ⇒ 'không kiểm được', KHÔNG 'Máy chưa ghim STOP'; hộp xác nhận không nói '0 adapter'", () => {
    srv.cheDo = [may({ coGhimStop: null, soAdapterGhimStop: null, khaNangDung: { machineId: 10, adapters: [], tongHop: "khong", loiKhaoSat: true } })];
    veFaceplate();
    expect(screen.getByTestId("canh-bao-kha-nang-dung")).toHaveTextContent(KKD);
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
    fireEvent.click(screen.getByTestId("nut-dung-may"));
    expect(within(hop()).getByText(S("scada.dungMay.moTaKhongRo"))).toBeInTheDocument();
    expect(within(hop()).queryByText(S("scada.dungMay.moTa", { n: 0 }))).toBeNull();
    expect(within(hop()).getByTestId("kha-nang-dung-loi")).toHaveTextContent(KKD);
  });

  it("★ faceplate: MODE_LOCAL khi KHÔNG BIẾT có ghim ⇒ gợi ý E-STOP cứng thuần (không hứa nút DỪNG MÁY, không nói 'chưa ghim')", async () => {
    srv.cheDo = [may({ coGhimStop: null, soAdapterGhimStop: null, khaNangDung: { machineId: 10, adapters: [], tongHop: "khong", loiKhaoSat: true } })];
    veFaceplate();
    const fp = screen.getByTestId("faceplate");
    fireEvent.change(within(fp).getByLabelText(S("scada.faceplate.giaTriMoi")), { target: { value: "245" } });
    fireEvent.change(within(fp).getByLabelText(S("scada.kenh.dialog.lyDo")), { target: { value: "Giam SP Z7" } });
    fireEvent.click(within(fp).getByRole("button", { name: S("scada.faceplate.nutDoi") }));
    await act(async () => {
      srv.opts.request.onError?.({ message: "x", data: { appCode: "SCADA_MACHINE_NOT_REMOTE", appParams: { ma: "MODE_LOCAL", lyDo: "khac_remote" } } });
    });
    const g = within(fp).getByTestId("goi-y-stop");
    expect(g).toHaveTextContent(S("scada.lenh.loi.goiYStopKhongGhim"));
    expect(g).not.toHaveTextContent("chưa ghim");
  });

  it("★ NutDungMay chỉ có coGhimStop null (chưa có khaNang) ⇒ 'không kiểm được'; M12 coGhimStop null ⇒ 'không kiểm được', không 'chưa ghim'", () => {
    render(<NutDungMay machineId={10} tenMay="RF-2" coGhimStop={null} />);
    expect(screen.getByTestId("canh-bao-kha-nang-dung")).toHaveTextContent(KKD);
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
    cleanup();
    render(<KenhCheDoMay rows={[may({ machineId: 10, coGhimStop: null, soAdapterGhimStop: null })] as never} adapters={[]} canAct={false} />);
    expect(screen.getByTestId("canh-bao-kha-nang-dung")).toHaveTextContent(KKD);
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
  });
});

describe("kiem-dinh R1b-1 H1 (b) — ghim của tag mức tác động > 1 'không tới bằng STOP HMI' (cùng luật máy chủ)", () => {
  const kn = (adapters: Array<Record<string, unknown>>, tongHop = "mot_phan") => ({ machineId: 10, adapters, tongHop }) as never;

  it("★ hộp xác nhận: ghim_muc_cao ⇒ 'không tới bằng STOP HMI' nêu tag; adapter được nhưng có ghim mức cao ⇒ thêm 'bỏ qua ghim của tag mức > 1'", () => {
    veHop({
      khaNang: kn([
        { adapterId: 1, code: "PLC-A", trangThai: "duoc", ghimBoQua: ["van_m4"] },
        { adapterId: 2, code: "PLC-H", trangThai: "ghim_muc_cao", ghimBoQua: ["servo_m5", "bom_m3"] },
      ]),
    });
    const h = hop();
    expect(within(h).getByTestId("kha-nang-2")).toHaveAttribute("data-trang-thai", "ghim_muc_cao");
    expect(within(h).getByTestId("kha-nang-2")).toHaveTextContent("Chỉ có ghim trên tag mức tác động > 1 (servo_m5, bom_m3) — không tới bằng STOP HMI, không gửi gì");
    expect(within(h).getByTestId("kha-nang-bo-qua-1")).toHaveTextContent("bỏ qua ghim của tag mức tác động > 1: van_m4");
    expect(within(h).queryByTestId("kha-nang-bo-qua-2")).toBeNull();
  });

  it("★ cảnh báo cấp máy (M4 / M10 / M12): ghim_muc_cao và ghim bị bỏ qua đều có dòng riêng; KHÔNG nói 'Máy chưa ghim STOP'", () => {
    render(
      <CanhBaoKhaNangDung
        khaNang={kn([
          { adapterId: 1, code: "PLC-A", trangThai: "duoc", ghimBoQua: ["van_m4"] },
          { adapterId: 2, code: "PLC-H", trangThai: "ghim_muc_cao", ghimBoQua: ["servo_m5"] },
        ])}
      />,
    );
    const cb = screen.getByTestId("canh-bao-kha-nang-dung");
    expect(cb).toHaveTextContent("Adapter PLC-H: mọi ghim STOP nằm trên tag mức tác động > 1 (servo_m5) — không tới bằng STOP HMI; khai mức tác động 1 cho tag dừng");
    expect(cb).toHaveTextContent("Adapter PLC-A: STOP HMI bỏ qua ghim của tag mức tác động > 1 (van_m4)");
    cleanup();
    // M12: coGhimStop false vì chỉ có ghim mức cao ⇒ câu theo khảo sát, không phải "chưa ghim"
    render(
      <KenhCheDoMay
        rows={[may({ machineId: 10, coGhimStop: false, soAdapterGhimStop: 0, khaNangDung: kn([{ adapterId: 2, code: "PLC-H", trangThai: "ghim_muc_cao", ghimBoQua: ["servo_m5"] }], "khong") })] as never}
        adapters={[]}
        canAct={false}
      />,
    );
    expect(screen.getByTestId("canh-bao-kha-nang-dung")).toHaveTextContent("mọi ghim STOP nằm trên tag mức tác động > 1 (servo_m5)");
    expect(screen.queryByTestId("canh-bao-chua-ghim-stop")).toBeNull();
  });

  it("★ kết quả: máy chủ báo boQua ⇒ khối 'Không gửi (tag mức tác động > 1 …)' liệt kê từng tag + dòng đỏ E-STOP; ghim hợp lệ vẫn hiện đạt", async () => {
    veHop();
    fireEvent.click(nutMacDinh());
    await traLoi("onSuccess", {
      ketQua: [{ adapterId: 1, code: "PLC-A", status: "acked_verified", ok: true, simulated: false, writes: [{ tagKey: "stop_cmd", value: true }], commandLogIds: [5] }],
      boQua: [{ adapterId: 1, code: "PLC-A", tagKey: "van_m4", ly_do: "muc_cao", muc: 4 }],
    });
    expect(screen.getByTestId("ket-qua-dung-1")).toHaveAttribute("data-loai", "dat");
    const bq = screen.getByTestId("ket-qua-bo-qua");
    expect(bq).toHaveTextContent("Không gửi (tag mức tác động > 1 — không tới bằng STOP HMI):");
    expect(bq).toHaveTextContent("PLC-A · van_m4 (mức 4)");
    expect(within(bq).getByTestId("dung-estop")).toBeInTheDocument();
  });

  it("★ máy chủ từ chối GHIM_MUC_CAO ⇒ chữ nêu tag + dòng đỏ E-STOP", async () => {
    veHop();
    fireEvent.click(nutMacDinh());
    await traLoi("onError", { message: "x", data: { appCode: "SCADA_STOP_PINS_HIGH_LEVEL", appParams: { ma: "GHIM_MUC_CAO", soTag: 1, tagKeys: "van_m3" } } });
    expect(within(hop()).getByTestId("loi-lenh")).toHaveTextContent("Mọi ghim STOP của máy nằm trên tag mức tác động > 1 (van_m3) — nút DỪNG MÁY không gửi gì; dừng bằng E-STOP cứng");
    expect(within(hop()).getByTestId("dung-estop")).toBeInTheDocument();
  });

  it("chữ mới ở en không có chữ Việt", () => {
    for (const k of [
      "scada.dungMay.khaNang.ghimMucCao",
      "scada.dungMay.khaNang.boQuaMucCao",
      "scada.dungMay.canhBao.ghimMucCao",
      "scada.dungMay.canhBao.boQuaMucCao",
      "scada.dungMay.boQua.tieuDe",
      "scada.dungMay.boQua.dong",
      "scada.lenh.loi.GHIM_MUC_CAO",
      "errors.SCADA_STOP_PINS_HIGH_LEVEL",
    ]) {
      expect(CHU_VIET.test(E(k)), k).toBe(false);
    }
  });
});
