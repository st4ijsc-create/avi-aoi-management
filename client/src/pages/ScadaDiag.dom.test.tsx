// @vitest-environment jsdom
//
// SCADA R0 Task 11 — M10 `/scada/diag` (chẩn đoán truyền thông). Render THẬT qua @testing-library/react với bundle vi.json THẬT;
// chỉ mock hợp đồng mạng (`@/lib/trpc`), khung trang (DashboardLayout), vai/quyền và `sonner`/`toastTrpcError`.
// Hợp đồng (task-11-brief + phán quyết điều phối):
//   - bảng: một hàng/adapter; hàng `lost` mang chữ "Mất kết nối" (+ thời gian); adapter edge: "do edge … sở hữu — chưa có số liệu R0"
//     KHÔNG BAO GIỜ là "Mất kết nối".
//   - nút "Kết nối lại" / "Tạm tắt" CHỈ cho engineer|admin có machine_control.canEdit (máy chủ vẫn là ranh giới bảo mật);
//     bấm ⇒ hộp xác nhận, lý do < 5 ký tự ⇒ nút gửi khoá.
//   - làm mới 2000 ms (tRPC polling); khối Lab chỉ khi `row.labStub`; ageMs âm/null ⇒ "—"; lỗi mutation ⇒ toastTrpcError;
//     sau mutation ⇒ làm mới danhSach + tagCuaAdapter.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { resolvePermissionModule } from "@shared/permissions";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const who = vi.hoisted(() => ({ role: "engineer", canEdit: true }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 9, role: who.role, name: "T" }, loading: false, isAuthenticated: true }),
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: who.role === "admin",
    hasPermission: (m: string, a: string) =>
      who.role === "admin" ||
      (resolvePermissionModule(m) === "machine_control" ? who.canEdit && (a === "canView" || a === "canEdit") : a === "canView"),
  }),
}));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastTrpcError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError }));

type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  tags: {} as Record<number, Record<string, unknown>[]>,
  kenh: {} as Record<number, Record<string, unknown>[]>,
  kenhOpts: [] as Array<{ i: unknown; o?: { enabled?: boolean } }>,
  mau: [] as Record<string, unknown>[],
  danhSachOpts: undefined as Record<string, unknown> | undefined,
  mutCalls: [] as Array<{ proc: string; vars: unknown }>,
  mutOpts: {} as Record<string, { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }>,
  invalidated: [] as string[],
  mauInput: undefined as unknown,
  loading: false,
}));
vi.mock("@/lib/trpc", () => {
  const mut = (proc: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      srv.mutOpts[proc] = opts;
      return { mutate: (vars: unknown) => srv.mutCalls.push({ proc, vars }), isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        scadaDiag: {
          danhSach: {
            invalidate: () => {
              srv.invalidated.push("danhSach");
              return Promise.resolve();
            },
          },
          tagCuaAdapter: {
            invalidate: () => {
              srv.invalidated.push("tagCuaAdapter");
              return Promise.resolve();
            },
          },
        },
      }),
      // R1a T14 — ngăn tag hỏi kênh (writable / loaiKenh) để biết hàng nào có nút Faceplate
      scadaKenh: {
        danhSach: {
          useQuery: (i: { adapterId: number }, o?: { enabled?: boolean }) => {
            srv.kenhOpts.push({ i, o });
            return { data: o?.enabled === false ? undefined : (srv.kenh[i.adapterId] ?? []), isLoading: false, isError: false };
          },
        },
      },
      scadaDiag: {
        danhSach: {
          useQuery: (_i: unknown, o: Record<string, unknown>) => {
            srv.danhSachOpts = o;
            return { data: srv.loading ? undefined : srv.rows, isLoading: srv.loading, isError: false, refetch: () => undefined };
          },
        },
        tagCuaAdapter: {
          useQuery: (i: { adapterId: number }, o?: { enabled?: boolean }) => ({
            data: o?.enabled === false ? undefined : (srv.tags[i.adapterId] ?? []),
            isLoading: false,
          }),
        },
        mauTho: {
          useQuery: (i: unknown, o?: { enabled?: boolean }) => {
            srv.mauInput = i;
            return { data: o?.enabled === false ? undefined : srv.mau, isLoading: false };
          },
        },
        ketNoiLai: mut("ketNoiLai"),
        tamTat: mut("tamTat"),
        datLoiStub: mut("datLoiStub"),
      },
    },
  };
});

// R1a T14 — Faceplate thật có test riêng (Faceplate.dom.test.tsx); ở đây chỉ kiểm điểm vào + đạo cụ truyền xuống.
vi.mock("@/components/scada/Faceplate", () => ({
  Faceplate: (p: { adapterId: number; tagKey: string; machineId: number | null; edgeCode: string | null }) => (
    <div data-testid="faceplate-stub">{JSON.stringify({ adapterId: p.adapterId, tagKey: p.tagKey, machineId: p.machineId, edgeCode: p.edgeCode })}</div>
  ),
}));

import ScadaDiag from "./ScadaDiag";

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const base = {
  protocol: "opcua",
  endpoint: "opc.tcp://10.0.0.1:4840",
  machineId: 1,
  soHuu: { loai: "trung_tam" },
  loi: null,
  soLanMat: 0,
  pollMs: 500,
  p95Ms: 42,
  boDem1h: { request: 100, loi: 0, timeout: 0, lenh: 0, lenhLoi: 0 },
  tag: { tot: 4, nghiNgo: 0, xau: 0 },
  labStub: false,
  tu: null,
};
function rows3(): Row[] {
  return [
    { ...base, adapterId: 1, code: "AD-OK", ten: "Ổn", trangThai: "connected", tu: iso(10_000) },
    {
      ...base,
      adapterId: 2,
      code: "AD-LOST",
      ten: "Mất",
      trangThai: "lost",
      tu: iso(180_000),
      loi: "ECONNRESET",
      soLanMat: 2,
      boDem1h: { request: 80, loi: 12, timeout: 3, lenh: 0, lenhLoi: 0 },
      tag: { tot: 0, nghiNgo: 1, xau: 3 },
    },
    { ...base, adapterId: 3, code: "AD-EDGE", ten: "Edge", trangThai: "edge_chua_co_so_lieu", soHuu: { loai: "edge", edgeNodeId: 7, edgeCode: "EDGE-07" } },
  ];
}

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
});
beforeEach(() => {
  who.role = "engineer";
  who.canEdit = true;
  srv.rows = rows3();
  srv.tags = {};
  srv.kenh = {};
  srv.kenhOpts = [];
  srv.mau = [];
  srv.mutCalls = [];
  srv.mutOpts = {};
  srv.invalidated = [];
  srv.loading = false;
  srv.mauInput = undefined;
  toastSuccess.mockReset();
  toastTrpcError.mockReset();
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("vi");
  });
});

const hang = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;

describe("ScadaDiag — bảng", () => {
  it("render 3 hàng; hàng lost có chữ 'Mất kết nối' + thời gian '3 ph'; làm mới mỗi 2000 ms", () => {
    render(<ScadaDiag />);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 3);
    expect(within(hang("AD-LOST")).getByText(new RegExp(`${S("scada.diag.matKetNoi")}\\s*3 ph`))).toBeInTheDocument();
    expect(within(hang("AD-OK")).queryByText(S("scada.diag.matKetNoi"))).toBeNull();
    expect(srv.danhSachOpts).toMatchObject({ refetchInterval: 2000 });
  });

  it("adapter edge: 'do edge EDGE-07 sở hữu — chưa có số liệu R0', KHÔNG phải mất kết nối; hàng lost hiện lỗi gần nhất + tag tốt/?/xấu", () => {
    render(<ScadaDiag />);
    const edge = hang("AD-EDGE");
    expect(within(edge).getByText(S("scada.diag.edgeChuaCoSoLieu", { edgeCode: "EDGE-07" }))).toBeInTheDocument();
    expect(within(edge).queryByText(new RegExp(S("scada.diag.matKetNoi")))).toBeNull();
    const lost = hang("AD-LOST");
    expect(within(lost).getByText("ECONNRESET")).toBeInTheDocument();
    expect(within(lost).getByText("0 / 1 / 3")).toBeInTheDocument();
    expect(within(lost).getByText(/80 · 12 · 3/)).toBeInTheDocument();
  });

  it("lọc 'chỉ lỗi' ẩn adapter ổn và adapter edge, giữ adapter lỗi", () => {
    render(<ScadaDiag />);
    fireEvent.click(screen.getByRole("switch", { name: S("scada.diag.loc.chiLoi") }));
    expect(screen.queryByText("AD-OK")).toBeNull();
    expect(screen.queryByText("AD-EDGE")).toBeNull();
    expect(screen.getByText("AD-LOST")).toBeInTheDocument();
  });
});

describe("ScadaDiag — đang tải", () => {
  it("isLoading ⇒ khung chờ, KHÔNG nhá 'chưa có adapter trong phạm vi'; có dữ liệu ⇒ hết khung chờ", () => {
    srv.loading = true;
    const { unmount } = render(<ScadaDiag />);
    expect(screen.getByRole("status", { name: S("scada.diag.dangTai") })).toBeInTheDocument();
    expect(screen.queryByText(S("scada.diag.trong"))).toBeNull();
    unmount();
    srv.loading = false;
    render(<ScadaDiag />);
    expect(screen.queryByRole("status", { name: S("scada.diag.dangTai") })).toBeNull();
  });
});

describe("ScadaDiag — quyền hiển thị nút", () => {
  it("operator KHÔNG thấy 'Kết nối lại' / 'Tạm tắt'", () => {
    who.role = "operator";
    render(<ScadaDiag />);
    expect(screen.queryByRole("button", { name: S("scada.diag.nut.ketNoiLai") })).toBeNull();
    expect(screen.queryByRole("button", { name: S("scada.diag.nut.tamTat") })).toBeNull();
  });
  it("engineer thiếu machine_control.canEdit cũng không thấy", () => {
    who.canEdit = false;
    render(<ScadaDiag />);
    expect(screen.queryByRole("button", { name: S("scada.diag.nut.ketNoiLai") })).toBeNull();
  });
  it("adapter edge không có nút (máy chủ từ chối); engineer thấy nút ở 2 adapter trung tâm", () => {
    render(<ScadaDiag />);
    expect(within(hang("AD-EDGE")).queryByRole("button", { name: S("scada.diag.nut.ketNoiLai") })).toBeNull();
    expect(screen.getAllByRole("button", { name: S("scada.diag.nut.ketNoiLai") })).toHaveLength(2);
  });
});

describe("ScadaDiag — hộp xác nhận lý do", () => {
  it("bấm 'Kết nối lại' ⇒ hộp; lý do 3 ký tự ⇒ nút gửi khoá; ≥ 5 ký tự ⇒ gửi {adapterId, lyDo}", () => {
    render(<ScadaDiag />);
    fireEvent.click(within(hang("AD-LOST")).getByRole("button", { name: S("scada.diag.nut.ketNoiLai") }));
    const dlg = screen.getByRole("dialog");
    const gui = within(dlg).getByRole("button", { name: S("scada.diag.dialog.gui") });
    const o = within(dlg).getByLabelText(S("scada.diag.dialog.lyDo")) as HTMLTextAreaElement;
    fireEvent.change(o, { target: { value: "abc" } });
    expect(gui).toBeDisabled();
    fireEvent.change(o, { target: { value: "  ab  " } }); // cắt khoảng trắng: 2 ký tự
    expect(gui).toBeDisabled();
    fireEvent.change(o, { target: { value: "đổi cáp mạng" } });
    expect(gui).toBeEnabled();
    fireEvent.click(gui);
    expect(srv.mutCalls).toEqual([{ proc: "ketNoiLai", vars: { adapterId: 2, lyDo: "đổi cáp mạng" } }]);
  });

  it("'Tạm tắt' dùng tamTat", () => {
    render(<ScadaDiag />);
    fireEvent.click(within(hang("AD-OK")).getByRole("button", { name: S("scada.diag.nut.tamTat") }));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(S("scada.diag.dialog.lyDo")), { target: { value: "bảo trì định kỳ" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: S("scada.diag.dialog.gui") }));
    expect(srv.mutCalls).toEqual([{ proc: "tamTat", vars: { adapterId: 1, lyDo: "bảo trì định kỳ" } }]);
  });

  it("thành công ⇒ làm mới danhSach + tagCuaAdapter, toast, đóng hộp; lỗi máy chủ ⇒ toastTrpcError, hộp giữ mở", () => {
    render(<ScadaDiag />);
    fireEvent.click(within(hang("AD-LOST")).getByRole("button", { name: S("scada.diag.nut.ketNoiLai") }));
    const err = { data: { code: "NOT_FOUND" } };
    act(() => srv.mutOpts.ketNoiLai.onError?.(err));
    expect(toastTrpcError).toHaveBeenCalledWith(err);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => srv.mutOpts.ketNoiLai.onSuccess?.({ reset: true }));
    expect(srv.invalidated).toEqual(expect.arrayContaining(["danhSach", "tagCuaAdapter"]));
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ScadaDiag — ngăn tag của adapter", () => {
  const tag = (o: Row): Row => ({
    tagKey: "T",
    address: "ns=2;s=T",
    v: 1,
    q: "good",
    statusCode: "Good",
    reason: null,
    ageMs: 1200,
    stale: false,
    boDem: { request: 5, loi: 0, good: 5, uncertain: 0, bad: 0 },
    ...o,
  });
  const o = (sh: HTMLElement, key: string, id: string) => within(sh).getByText(key).closest("tr")!.querySelector(`[data-testid=${id}]`) as HTMLElement;

  it("bấm hàng ⇒ danh sách tag có giá trị, chất lượng, tuổi, statusCode; ageMs âm / null ⇒ '—'; D10: uncertain viền chấm, cũ gạch tím", () => {
    srv.tags[2] = [
      tag({ tagKey: "TEMP", v: 21.5, ageMs: 1500, statusCode: "Good" }),
      tag({ tagKey: "NEG", v: 3, ageMs: -250, q: "uncertain", statusCode: "UncertainSubNormal" }),
      tag({ tagKey: "NOVAL", v: null, q: null, ageMs: null, stale: true, statusCode: null }),
      tag({ tagKey: "OLD", v: 9, q: "good", ageMs: 90_000, stale: true }),
    ];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-LOST"));
    const sh = screen.getByRole("dialog");
    expect(within(sh).getByText("UncertainSubNormal")).toBeInTheDocument();
    expect(o(sh, "NEG", "tuoi")).toHaveTextContent("—");
    expect(o(sh, "NOVAL", "tuoi")).toHaveTextContent("—");
    expect(o(sh, "TEMP", "tuoi")).toHaveTextContent("1,5 s");
    expect(o(sh, "NEG", "gia-tri").getAttribute("data-vien")).toBe("dotted-grey");
    expect(o(sh, "OLD", "gia-tri").getAttribute("data-vien")).toBe("purple-strike");
    expect(o(sh, "TEMP", "gia-tri").getAttribute("data-vien")).toBe("none");
  });

  it("ngôn ngữ en: tuổi dùng đơn vị + dấu thập phân của en (không 'giờ' / 'ph' / dấu phẩy)", async () => {
    i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
    await act(async () => {
      await i18next.changeLanguage("en");
    });
    srv.tags[2] = [tag({ tagKey: "A1", ageMs: 1500 }), tag({ tagKey: "A2", ageMs: 90_000 }), tag({ tagKey: "A3", ageMs: 5 * 3_600_000, stale: true })];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-LOST"));
    const sh = screen.getByRole("dialog");
    expect(o(sh, "A1", "tuoi")).toHaveTextContent(/^1\.5 s$/);
    expect(o(sh, "A2", "tuoi")).toHaveTextContent(/^1 min$/);
    expect(o(sh, "A3", "tuoi")).toHaveTextContent(/^5 h$/);
    for (const id of ["A1", "A2", "A3"]) expect(o(sh, id, "tuoi").textContent).not.toMatch(/giờ|ph|,/);
  });

  it("đóng ngăn rồi mở lại ⇒ KHÔNG còn bảng mẫu thô cũ / không bắn mauTho", () => {
    srv.tags[1] = [tag({ tagKey: "SPD" })];
    srv.mau = [{ ts: iso(1000), giaTri: 4242, quality: "good", statusCode: "Good", tsSource: "server" }];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-OK"));
    fireEvent.click(screen.getByRole("button", { name: S("scada.diag.nut.mauTho") }));
    expect(screen.getByText("4242")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    srv.mauInput = undefined;
    fireEvent.click(screen.getByText("AD-OK"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("4242")).toBeNull();
    expect(srv.mauInput).toBeUndefined();
  });

  it("'100 mẫu thô' ⇒ hỏi mauTho đúng (adapterId, tagKey) và liệt kê mẫu", () => {
    srv.tags[1] = [tag({ tagKey: "SPD" })];
    srv.mau = [{ ts: iso(1000), giaTri: 4242, quality: "good", statusCode: "Good", tsSource: "server" }];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-OK"));
    fireEvent.click(screen.getByRole("button", { name: S("scada.diag.nut.mauTho") }));
    expect(srv.mauInput).toEqual({ adapterId: 1, tagKey: "SPD" });
    expect(screen.getByText("4242")).toBeInTheDocument();
  });
});

describe("ScadaDiag — nút Faceplate trên hàng tag ghi được (R1a T14)", () => {
  const tag = (o: Row): Row => ({ tagKey: "T", address: "a", v: 1, q: "good", statusCode: "Good", reason: null, ageMs: 100, stale: false, boDem: { request: 1, loi: 0, good: 1, uncertain: 0, bad: 0 }, ...o });
  const kenh = (o: Row): Row => ({ tagKey: "T", writable: false, isEnabled: true, loaiKenh: "input", ...o });
  const nutFp = (tr: HTMLElement) => within(tr).queryByRole("button", { name: S("scada.faceplate.nutMo") });

  it("CHỈ hàng ghi được (writable + kênh ra + bật) có nút; bấm ⇒ Faceplate nhận adapterId/tagKey/machineId/edgeCode", () => {
    who.role = "operator"; // operator được ghi kênh mức 1–3 (Q4) — nút không bị khoá theo vai, máy chủ quyết
    srv.tags[1] = [tag({ tagKey: "SP" }), tag({ tagKey: "PV" }), tag({ tagKey: "OFF" }), tag({ tagKey: "RO" })];
    srv.kenh[1] = [
      kenh({ tagKey: "SP", writable: true, loaiKenh: "input_output" }),
      kenh({ tagKey: "PV" }),
      kenh({ tagKey: "OFF", writable: true, loaiKenh: "output", isEnabled: false }),
      kenh({ tagKey: "RO", writable: false, loaiKenh: "output" }),
    ];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-OK"));
    const sh = screen.getByRole("dialog");
    expect(srv.kenhOpts.at(-1)).toEqual({ i: { adapterId: 1 }, o: { enabled: true } });
    const tr = (k: string) => within(sh).getByText(k).closest("tr") as HTMLElement;
    expect(nutFp(tr("SP"))).not.toBeNull();
    for (const k of ["PV", "OFF", "RO"]) expect(nutFp(tr(k)), k).toBeNull();
    fireEvent.click(nutFp(tr("SP"))!);
    expect(JSON.parse(screen.getByTestId("faceplate-stub").textContent ?? "{}")).toEqual({ adapterId: 1, tagKey: "SP", machineId: 1, edgeCode: null });
  });

  it("ngăn đóng ⇒ không hỏi kênh", () => {
    render(<ScadaDiag />);
    expect(srv.kenhOpts.every((x) => x.o?.enabled === false)).toBe(true);
  });
});

describe("ScadaDiag — Lab stub", () => {
  const stub = (labStub: boolean): Row => ({ ...base, adapterId: 1, code: "AD-STUB", ten: "s", protocol: "stub", trangThai: "connected", labStub });

  it("không có khối Lab khi labStub=false (kể cả protocol stub), kể cả engineer", () => {
    srv.rows = [stub(false)];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-STUB"));
    expect(screen.queryByText(S("scada.diag.lab.tieuDe"))).toBeNull();
  });
  // final M2 — đặt / xoá lỗi Lab đi qua hộp lý do (như Kết nối lại / Tạm tắt): lý do < 5 ký tự ⇒ nút gửi khoá; gửi kèm `lyDo` đã cắt.
  const hopLab = (kieu: "apDung" | "xoaLoi") =>
    screen.getByRole("dialog", { name: S(kieu === "apDung" ? "scada.diag.lab.dialogApDungTieuDe" : "scada.diag.lab.dialogXoaLoiTieuDe", { code: "AD-STUB" }) });
  it("labStub=true ⇒ khối Lab; bật 'mất kết nối' + áp dụng ⇒ hộp lý do ⇒ gửi datLoiStub {matKetNoi:true, lyDo}; 'Xoá lỗi' ⇒ hộp ⇒ gửi {} + lyDo", () => {
    srv.rows = [stub(true)];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-STUB"));
    expect(screen.getByText(S("scada.diag.lab.tieuDe"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: S("scada.diag.lab.matKetNoi") }));
    fireEvent.click(screen.getByRole("button", { name: S("scada.diag.lab.apDung") }));
    expect(srv.mutCalls).toEqual([]); // chưa gửi khi chưa có lý do
    let dlg = hopLab("apDung");
    const gui = within(dlg).getByRole("button", { name: S("scada.diag.dialog.gui") });
    const o = within(dlg).getByLabelText(S("scada.diag.dialog.lyDo")) as HTMLTextAreaElement;
    fireEvent.change(o, { target: { value: "abc" } });
    expect(gui).toBeDisabled();
    expect(within(dlg).getByText(S("scada.diag.dialog.lyDoNgan", { min: 5 }))).toBeInTheDocument();
    fireEvent.change(o, { target: { value: "  mô phỏng rút cáp  " } });
    expect(gui).toBeEnabled();
    fireEvent.click(gui);
    expect(srv.mutCalls.at(-1)).toEqual({ proc: "datLoiStub", vars: { adapterId: 1, loi: { matKetNoi: true }, lyDo: "mô phỏng rút cáp" } });
    act(() => srv.mutOpts.datLoiStub.onSuccess?.({ apDung: true }));
    expect(screen.queryByRole("dialog", { name: S("scada.diag.lab.dialogApDungTieuDe", { code: "AD-STUB" }) })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: S("scada.diag.lab.xoaLoi") }));
    dlg = hopLab("xoaLoi");
    fireEvent.change(within(dlg).getByLabelText(S("scada.diag.dialog.lyDo")), { target: { value: "gỡ lỗi mô phỏng" } });
    fireEvent.click(within(dlg).getByRole("button", { name: S("scada.diag.dialog.gui") }));
    expect(srv.mutCalls.at(-1)).toEqual({ proc: "datLoiStub", vars: { adapterId: 1, loi: {}, lyDo: "gỡ lỗi mô phỏng" } });
    expect(srv.mutCalls).toHaveLength(2);
  });
  it("hộp lý do Lab: Huỷ ⇒ không gửi gì", () => {
    srv.rows = [stub(true)];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-STUB"));
    fireEvent.click(screen.getByRole("button", { name: S("scada.diag.lab.apDung") }));
    const dlg = hopLab("apDung");
    fireEvent.change(within(dlg).getByLabelText(S("scada.diag.dialog.lyDo")), { target: { value: "lý do đủ dài" } });
    fireEvent.click(within(dlg).getByRole("button", { name: S("scada.diag.dialog.huy") }));
    expect(srv.mutCalls).toEqual([]);
  });
  it("operator không thấy khối Lab dù labStub=true", () => {
    who.role = "operator";
    srv.rows = [stub(true)];
    render(<ScadaDiag />);
    fireEvent.click(screen.getByText("AD-STUB"));
    expect(screen.queryByText(S("scada.diag.lab.tieuDe"))).toBeNull();
  });
});
