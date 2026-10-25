// @vitest-environment jsdom
//
// SCADA R1a Task 13 — M12 `/scada/config/channels` (kênh & giới hạn + kênh chế độ theo máy). Render THẬT qua @testing-library/react với
// bundle vi.json THẬT; chỉ mock hợp đồng mạng (`@/lib/trpc`), khung trang, vai/quyền và `sonner` (toastTrpcError là hàm THẬT).
// Hợp đồng (task-13-brief + điều phối 2026-10-24):
//   - bảng theo adapter: loại kênh hiệu lực (+ "khai" / "suy từ writable"), dải, bước, mức hiệu lực (kênh ra không khai ⇒ "5 — mặc định đóng"),
//     tên hiển thị; kênh dừng chưa khai mức ⇒ cảnh báo nổi bật.
//   - khối "Kênh chế độ" theo máy: đủ 9 lý do `cheDoMay` bằng chữ người đọc (vi/en/zh); `chua_khai` ⇒ "Chưa khai ⇒ coi như LOCAL";
//     `canhBaoNguon` ⇒ cảnh báo trong khối VÀ trong hộp thoại đặt kênh, KHÔNG chặn lưu.
//   - nút sửa chỉ cho engineer|admin có machine_control.canEdit; hộp thoại bắt buộc lý do ≥ 5 ký tự; lỗi máy chủ ⇒ toast (đã i18n).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { resolvePermissionModule } from "@shared/permissions";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

/** kiem-dinh P1-2 — ba hộp thoại cấu hình M12 bắt buộc mã TOTP 6 số mỗi lần lưu. */
const MA = "123456";
const nhapMa = (dlg: HTMLElement, ma = MA) => fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.totp")), { target: { value: ma } });
/** Lý do + mã TOTP (đa số ca chỉ quan tâm lý do; mã luôn hợp lệ). */
const nhapLyDo = (dlg: HTMLElement, lyDo: string) => {
  fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.lyDo")), { target: { value: lyDo } });
  nhapMa(dlg);
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
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, warning: vi.fn() } }));

type Row = Record<string, unknown>;
const srv = vi.hoisted(() => ({
  adapters: [] as Record<string, unknown>[],
  kenh: {} as Record<number, Record<string, unknown>[]>,
  kenhInputs: [] as unknown[],
  cheDo: [] as Record<string, unknown>[],
  mutCalls: [] as Array<{ proc: string; vars: unknown }>,
  mutOpts: {} as Record<string, { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }>,
  invalidated: [] as string[],
  loading: false,
}));
vi.mock("@/lib/trpc", () => {
  const mut = (proc: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      srv.mutOpts[proc] = opts;
      return { mutate: (vars: unknown) => srv.mutCalls.push({ proc, vars }), isPending: false };
    },
  });
  const inv = (name: string) => ({
    invalidate: () => {
      srv.invalidated.push(name);
      return Promise.resolve();
    },
  });
  return {
    trpc: {
      useUtils: () => ({ scadaKenh: { danhSach: inv("kenh.danhSach"), cheDo: { danhSach: inv("cheDo.danhSach") } } }),
      scadaDiag: {
        danhSach: {
          useQuery: () => ({ data: srv.loading ? undefined : srv.adapters, isLoading: srv.loading, isError: false }),
        },
      },
      scadaKenh: {
        danhSach: {
          useQuery: (i: { adapterId: number }, o?: { enabled?: boolean }) => {
            if (o?.enabled !== false) srv.kenhInputs.push(i);
            return {
              data: o?.enabled === false ? undefined : (srv.kenh[i.adapterId] ?? []),
              isLoading: false,
              isError: false,
            };
          },
        },
        capNhat: mut("capNhat"),
        cheDo: {
          danhSach: { useQuery: () => ({ data: srv.loading ? undefined : srv.cheDo, isLoading: srv.loading, isError: false }) },
          dat: mut("dat"),
          go: mut("go"),
        },
      },
    },
  };
});

// R1a T14 — Faceplate thật có test riêng (Faceplate.dom.test.tsx); ở đây chỉ kiểm nút mở + đạo cụ truyền xuống.
vi.mock("@/components/scada/Faceplate", () => ({
  Faceplate: (p: { adapterId: number; tagKey: string; machineId: number | null; edgeCode: string | null }) => (
    <div data-testid="faceplate-stub">{JSON.stringify({ adapterId: p.adapterId, tagKey: p.tagKey, machineId: p.machineId, edgeCode: p.edgeCode })}</div>
  ),
}));

import ScadaKenh from "./ScadaKenh";

const NOW_ISO = new Date().toISOString();
const adapter = (o: Row): Row => ({
  protocol: "modbus",
  endpoint: "10.0.0.1:502",
  machineId: 10,
  soHuu: { loai: "trung_tam" },
  ...o,
});
const tag = (o: Row): Row => ({
  tagId: 100,
  tagKey: "T",
  dataType: "float",
  unit: null,
  writable: false,
  isEnabled: true,
  loaiKenh: "input",
  channelKindKhai: null,
  displayName: null,
  displayFormat: null,
  writeMin: null,
  writeMax: null,
  writeStep: null,
  actuationLevel: null,
  mucHieuLuc: 5,
  stopValue: null,
  laKenhCheDo: false,
  canhBaoKenhDung: false,
  ...o,
});
const may = (o: Row): Row => ({
  machineId: 10,
  code: "M-10",
  ten: "Machine ten",
  kenhAn: false,
  kenh: { adapterId: 1, tagKey: "mode_sel", giaTriRemote: 1, dataType: "int", updatedBy: 1, updatedAt: NOW_ISO },
  cheDo: "REMOTE",
  lyDo: "remote",
  canhBaoNguon: null,
  ...o,
});
const LY_DO = ["remote", "chua_khai", "bo_dem_tat", "chua_co_mau", "chat_luong_xau", "cu", "khac_remote", "loi_doc", "kenh_sai_may"] as const;
const KHOA_LY_DO: Record<(typeof LY_DO)[number], string> = {
  remote: "remote",
  chua_khai: "chuaKhai",
  bo_dem_tat: "boDemTat",
  chua_co_mau: "chuaCoMau",
  chat_luong_xau: "chatLuongXau",
  cu: "cu",
  khac_remote: "khacRemote",
  loi_doc: "loiDoc",
  kenh_sai_may: "kenhSaiMay",
};

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
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
});
beforeEach(() => {
  who.role = "engineer";
  who.canEdit = true;
  srv.adapters = [
    adapter({ adapterId: 1, code: "AD-1", ten: "Adapter one" }),
    adapter({ adapterId: 2, code: "AD-EDGE", ten: "Adapter edge", machineId: 11, protocol: "opcua", soHuu: { loai: "edge", edgeNodeId: 7, edgeCode: "E7" } }),
  ];
  srv.kenh = {
    1: [
      tag({ tagId: 101, tagKey: "cmd_stop", dataType: "bool", writable: true, loaiKenh: "output", channelKindKhai: "output", canhBaoKenhDung: true }),
      tag({ tagId: 102, tagKey: "speed_sp", unit: "rpm", writable: true, loaiKenh: "input_output", displayName: "Speed setpoint", writeMin: 0, writeMax: 100, writeStep: 0.5, actuationLevel: 3, mucHieuLuc: 3 }),
      tag({ tagId: 103, tagKey: "temp", unit: "C" }),
      tag({ tagId: 104, tagKey: "valve", dataType: "bool", writable: true, loaiKenh: "output", channelKindKhai: "output" }),
      tag({ tagId: 105, tagKey: "mode_sel", dataType: "int", laKenhCheDo: true }),
      tag({ tagId: 106, tagKey: "off_tag", dataType: "int", isEnabled: false }),
    ],
    2: [tag({ tagId: 201, tagKey: "edge_mode", dataType: "int" })],
  };
  srv.kenhInputs = [];
  srv.cheDo = [may({}), may({ machineId: 11, code: "M-11", kenh: null, cheDo: "LOCAL", lyDo: "chua_khai" })];
  srv.mutCalls = [];
  srv.mutOpts = {};
  srv.invalidated = [];
  srv.loading = false;
  toastSuccess.mockReset();
  toastError.mockReset();
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("vi");
  });
});

const hangTag = (key: string) => within(screen.getByTestId("bang-kenh")).getByText(key).closest("tr") as HTMLElement;
const hangMay = (code: string) => within(screen.getByTestId("khoi-che-do")).getByText(code).closest("tr") as HTMLElement;

const CHU_VIET = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

describe("ScadaKenh — bảng kênh theo adapter", () => {
  it("một hàng/tag; adapter đầu tiên được chọn sẵn và hỏi scadaKenh.danhSach theo adapterId đó", () => {
    render(<ScadaKenh />);
    expect(srv.kenhInputs.at(-1)).toEqual({ adapterId: 1 });
    for (const k of ["cmd_stop", "speed_sp", "temp", "valve", "mode_sel", "off_tag"]) expect(hangTag(k)).toBeInTheDocument();
  });

  it("kênh ra KHÔNG khai mức hiện '5 — mặc định đóng'; kênh khai mức 3 hiện '3'; kênh vào hiện '—' (mức không áp dụng)", () => {
    render(<ScadaKenh />);
    expect(within(hangTag("valve")).getByText(S("scada.kenh.mucMacDinhDong"))).toBeInTheDocument();
    expect(S("scada.kenh.mucMacDinhDong")).toBe("5 — mặc định đóng");
    const toc = hangTag("speed_sp");
    expect(within(toc).getByTestId("muc")).toHaveTextContent(/^3$/);
    expect(within(toc).queryByText(S("scada.kenh.mucMacDinhDong"))).toBeNull();
    expect(within(hangTag("temp")).getByTestId("muc")).toHaveTextContent(/^—$/);
  });

  it("mức hiển thị là mucHieuLuc của MÁY CHỦ (không tự suy): khai 3 nhưng máy chủ nói 4 ⇒ \"4\"; chưa khai + kênh ra + máy chủ nói 5 ⇒ mặc định đóng", () => {
    srv.kenh[1] = [
      tag({ tagId: 301, tagKey: "sv_muc", writable: true, loaiKenh: "output", actuationLevel: 3, mucHieuLuc: 4 }),
      tag({ tagId: 302, tagKey: "sv_macdinh", writable: true, loaiKenh: "output", actuationLevel: null, mucHieuLuc: 5 }),
      tag({ tagId: 303, tagKey: "sv_vao", loaiKenh: "input", actuationLevel: null, mucHieuLuc: 5 }),
    ];
    render(<ScadaKenh />);
    expect(within(hangTag("sv_muc")).getByTestId("muc")).toHaveTextContent(/^4$/);
    expect(within(hangTag("sv_macdinh")).getByTestId("muc")).toHaveTextContent(S("scada.kenh.mucMacDinhDong"));
    expect(within(hangTag("sv_vao")).getByTestId("muc")).toHaveTextContent(/^—$/);
  });

  it("loại kênh hiệu lực kèm 'khai' / 'suy từ writable'; dải, bước, tên hiển thị", () => {
    render(<ScadaKenh />);
    const khai = hangTag("valve");
    expect(within(khai).getByText(S("scada.kenh.loai.output"))).toBeInTheDocument();
    expect(within(khai).getByText(S("scada.kenh.nguon.khai"))).toBeInTheDocument();
    const suy = hangTag("speed_sp");
    expect(within(suy).getByText(S("scada.kenh.loai.input_output"))).toBeInTheDocument();
    expect(within(suy).getByText(S("scada.kenh.nguon.suy"))).toBeInTheDocument();
    expect(within(suy).getByTestId("dai")).toHaveTextContent("0 … 100");
    expect(within(suy).getByTestId("buoc")).toHaveTextContent("0,5");
    expect(within(suy).getByText("Speed setpoint")).toBeInTheDocument();
    expect(within(hangTag("temp")).getByTestId("dai")).toHaveTextContent(/^—$/);
  });

  it("tag là kênh chế độ của một máy ⇒ có nhãn 'Kênh chế độ'", () => {
    render(<ScadaKenh />);
    expect(within(hangTag("mode_sel")).getByText(S("scada.kenh.laKenhCheDo"))).toBeInTheDocument();
    expect(within(hangTag("temp")).queryByText(S("scada.kenh.laKenhCheDo"))).toBeNull();
  });
});

describe("ScadaKenh — nút Faceplate (R1a T14)", () => {
  const nutFp = (tr: HTMLElement) => within(tr).queryByRole("button", { name: S("scada.faceplate.nutMo") });
  it("CHỈ kênh ghi được (writable + kênh ra + bật) có nút — kể cả operator (không cần quyền sửa kênh)", () => {
    who.role = "operator";
    who.canEdit = false;
    render(<ScadaKenh />);
    for (const k of ["cmd_stop", "speed_sp", "valve"]) expect(nutFp(hangTag(k)), k).not.toBeNull();
    for (const k of ["temp", "mode_sel", "off_tag"]) expect(nutFp(hangTag(k)), k).toBeNull();
    expect(within(hangTag("speed_sp")).queryByRole("button", { name: S("scada.kenh.nut.sua") })).toBeNull();
  });

  it("bấm ⇒ Faceplate nhận adapterId / tagKey / machineId của adapter đang chọn", () => {
    render(<ScadaKenh />);
    fireEvent.click(nutFp(hangTag("speed_sp"))!);
    expect(JSON.parse(screen.getByTestId("faceplate-stub").textContent ?? "{}")).toEqual({ adapterId: 1, tagKey: "speed_sp", machineId: 10, edgeCode: null });
  });

  it("adapter edge ⇒ Faceplate nhận mã edge", () => {
    srv.kenh[2] = [tag({ tagId: 202, tagKey: "edge_sp", writable: true, loaiKenh: "output" })];
    render(<ScadaKenh />);
    fireEvent.change(screen.getByLabelText(S("scada.kenh.adapter")), { target: { value: "2" } });
    fireEvent.click(nutFp(hangTag("edge_sp"))!);
    expect(JSON.parse(screen.getByTestId("faceplate-stub").textContent ?? "{}")).toEqual({ adapterId: 2, tagKey: "edge_sp", machineId: 11, edgeCode: "E7" });
  });
});

describe("ScadaKenh — cảnh báo kênh dừng chưa khai mức", () => {
  const CAU = "Kênh dừng chưa khai mức — AI và lệnh từ xa không dừng được máy này; đặt mức 1 hoặc ghim stop_value";
  it("hiện đúng câu điều phối trên kênh canhBaoKenhDung và CHỈ ở đó", () => {
    expect(S("scada.kenh.canhBaoKenhDung")).toBe(CAU);
    render(<ScadaKenh />);
    expect(within(hangTag("cmd_stop")).getByText(CAU)).toBeInTheDocument();
    expect(screen.getAllByText(CAU)).toHaveLength(1);
    expect(within(hangTag("valve")).queryByText(CAU)).toBeNull();
  });
  it("không có kênh dừng nào thiếu mức ⇒ không có cảnh báo", () => {
    srv.kenh[1] = srv.kenh[1].map((t) => ({ ...t, canhBaoKenhDung: false }));
    render(<ScadaKenh />);
    expect(screen.queryByText(CAU)).toBeNull();
  });
});

describe("ScadaKenh — khối kênh chế độ theo máy", () => {
  it("máy chưa khai kênh ⇒ chữ khoá scada.kenh.cheDo.chuaKhai = 'Chưa khai ⇒ coi như LOCAL'", () => {
    render(<ScadaKenh />);
    expect(S("scada.kenh.cheDo.chuaKhai")).toBe("Chưa khai ⇒ coi như LOCAL");
    expect(within(hangMay("M-11")).getByText(S("scada.kenh.cheDo.chuaKhai"))).toBeInTheDocument();
    expect(within(hangMay("M-11")).getByText("LOCAL")).toBeInTheDocument();
  });

  it("hiện tag + giá trị REMOTE + adapter của máy đã khai, chế độ REMOTE", () => {
    render(<ScadaKenh />);
    const h = hangMay("M-10");
    expect(within(h).getByText("mode_sel")).toBeInTheDocument();
    expect(within(h).getByText("AD-1")).toBeInTheDocument();
    expect(within(h).getByTestId("gia-tri-remote")).toHaveTextContent(/^1$/);
    expect(within(h).getByText("REMOTE")).toBeInTheDocument();
    expect(within(h).getByText(S("scada.kenh.cheDo.remote"))).toBeInTheDocument();
  });

  it("đủ 9 lý do của cheDoMay, mỗi lý do một câu người đọc KHÁC nhau", () => {
    srv.cheDo = LY_DO.map((ly, i) =>
      may({ machineId: 20 + i, code: `MX-${ly}`, ten: `m${i}`, lyDo: ly, cheDo: ly === "remote" ? "REMOTE" : "LOCAL" }),
    );
    render(<ScadaKenh />);
    const chu = LY_DO.map((ly) => S(`scada.kenh.cheDo.${KHOA_LY_DO[ly]}`));
    expect(new Set(chu).size).toBe(9);
    LY_DO.forEach((ly, i) => {
      expect(within(hangMay(`MX-${ly}`)).getByText(chu[i])).toBeInTheDocument();
    });
  });

  it("lý do KHÔNG có trong bản đồ (máy chủ thêm lý do mới) ⇒ vẫn hiện chế độ + câu dự phòng có mã, không sập", () => {
    srv.cheDo = [may({ cheDo: "LOCAL", lyDo: "ly_do_moi" })];
    render(<ScadaKenh />);
    const h = hangMay("M-10");
    expect(within(h).getByText("LOCAL")).toBeInTheDocument();
    expect(within(h).getByText(S("scada.kenh.cheDo.khongRo", { lyDo: "ly_do_moi" }))).toBeInTheDocument();
    expect(h.textContent).not.toMatch(/scada.kenh./);
  });

  it("kênh bị che (kenhAn) ⇒ chữ 'kênh không hiển thị', vẫn hiện chế độ + lý do, không lộ tag", () => {
    srv.cheDo = [may({ kenhAn: true, kenh: null, cheDo: "LOCAL", lyDo: "kenh_sai_may" })];
    render(<ScadaKenh />);
    const h = hangMay("M-10");
    expect(within(h).getByText(S("scada.kenh.cheDo.kenhAn"))).toBeInTheDocument();
    expect(within(h).getByText(S("scada.kenh.cheDo.kenhSaiMay"))).toBeInTheDocument();
    expect(within(h).queryByText("mode_sel")).toBeNull();
  });

  const CANH_BAO = "Kênh chế độ nên là tag poll định kỳ trên adapter trung tâm — nguồn báo-khi-đổi/edge có thể làm máy rơi về LOCAL (giá trị cũ / chưa có mẫu)";
  it.each(["deadband", "edge", "bao_khi_doi", "poll_cham"] as const)("canhBaoNguon=%s ⇒ hiện cảnh báo nguồn trong khối", (nguon) => {
    expect(S("scada.kenh.canhBaoNguon")).toBe(CANH_BAO);
    srv.cheDo = [may({ canhBaoNguon: nguon })];
    render(<ScadaKenh />);
    const h = hangMay("M-10");
    expect(within(h).getByText(CANH_BAO)).toBeInTheDocument();
    expect(within(h).getByText(S(`scada.kenh.canhBaoNguonLoai.${nguon}`))).toBeInTheDocument();
  });
  it("canhBaoNguon=null ⇒ không có cảnh báo", () => {
    render(<ScadaKenh />);
    expect(screen.queryByText(CANH_BAO)).toBeNull();
  });

  it("hộp thoại 'đặt kênh chế độ' cũng hiện cảnh báo nguồn khi máy đang có canhBaoNguon — và KHÔNG chặn lưu", () => {
    srv.cheDo = [may({ canhBaoNguon: "deadband" })];
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).getByText(CANH_BAO)).toBeInTheDocument();
    nhapLyDo(dlg, "đổi sang tag poll");
    expect(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") })).toBeEnabled();
  });
  it("hộp thoại: chọn adapter do edge sở hữu ⇒ cảnh báo nguồn hiện (kể cả máy chưa có cảnh báo)", () => {
    srv.adapters = [adapter({ adapterId: 1, code: "AD-1", ten: "a" }), adapter({ adapterId: 3, code: "AD-E3", ten: "e", soHuu: { loai: "edge", edgeNodeId: 3, edgeCode: "E3" } })];
    srv.kenh[3] = [tag({ tagId: 301, tagKey: "edge_mode", dataType: "int" })];
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    expect(within(dlg).queryByText(CANH_BAO)).toBeNull();
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.adapter")), { target: { value: "3" } });
    expect(within(dlg).getByText(CANH_BAO)).toBeInTheDocument();
  });

  it("đặt kênh chế độ: gửi {machineId, adapterId, tagKey, giaTriRemote (đúng kiểu), lyDo đã cắt}; chỉ tag BẬT được chọn", () => {
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    const chonTag = within(dlg).getByLabelText(S("scada.kenh.dialog.tag")) as HTMLSelectElement;
    expect(Array.from(chonTag.options).map((o) => o.value)).not.toContain("off_tag");
    fireEvent.change(chonTag, { target: { value: "mode_sel" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.giaTriRemote")), { target: { value: "2" } });
    nhapLyDo(dlg, "  khai kênh chế độ  ");
    fireEvent.click(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") }));
    expect(srv.mutCalls).toEqual([{ proc: "dat", vars: { machineId: 10, adapterId: 1, tagKey: "mode_sel", giaTriRemote: 2, lyDo: "khai kênh chế độ", totpCode: MA } }]);
  });

  it("gỡ kênh chế độ: hộp lý do ≥ 5 ký tự ⇒ gửi {machineId, lyDo}", () => {
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S("scada.kenh.nut.goKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    const gui = within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") });
    nhapLyDo(dlg, "abc");
    expect(gui).toBeDisabled();
    nhapLyDo(dlg, "máy bỏ kênh");
    fireEvent.click(gui);
    expect(srv.mutCalls).toEqual([{ proc: "go", vars: { machineId: 10, lyDo: "máy bỏ kênh", totpCode: MA } }]);
  });
  it("máy chưa có kênh ⇒ không có nút 'Gỡ'", () => {
    render(<ScadaKenh />);
    expect(within(hangMay("M-11")).queryByRole("button", { name: S("scada.kenh.nut.goKenhCheDo") })).toBeNull();
  });
});

describe("ScadaKenh — quyền hiển thị nút sửa", () => {
  const nutSua = () => screen.queryAllByRole("button", { name: S("scada.kenh.nut.sua") });
  const nutCheDo = () => [
    ...screen.queryAllByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }),
    ...screen.queryAllByRole("button", { name: S("scada.kenh.nut.goKenhCheDo") }),
  ];
  it("engineer có canEdit thấy nút sửa trên mọi tag và nút kênh chế độ", () => {
    render(<ScadaKenh />);
    expect(nutSua()).toHaveLength(6);
    expect(nutCheDo().length).toBeGreaterThan(0);
  });
  it("operator KHÔNG thấy nút sửa nào (kể cả nút kênh chế độ) nhưng vẫn thấy dữ liệu", () => {
    who.role = "operator";
    render(<ScadaKenh />);
    expect(hangTag("valve")).toBeInTheDocument();
    expect(nutSua()).toHaveLength(0);
    expect(nutCheDo()).toHaveLength(0);
  });
  it("engineer thiếu machine_control.canEdit cũng không thấy", () => {
    who.canEdit = false;
    render(<ScadaKenh />);
    expect(nutSua()).toHaveLength(0);
    expect(nutCheDo()).toHaveLength(0);
  });
});

describe("ScadaKenh — hộp thoại sửa kênh (lý do ≥ 5 ký tự)", () => {
  const moSua = (key: string) => {
    fireEvent.click(within(hangTag(key)).getByRole("button", { name: S("scada.kenh.nut.sua") }));
    return screen.getByRole("dialog");
  };
  it("lý do 3 ký tự ⇒ nút gửi khoá (kể cả khi đã đổi trường); ≥ 5 ký tự ⇒ gửi {tagId, patch chỉ chứa trường ĐỔI, lyDo}", () => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    const gui = within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.muc")), { target: { value: "4" } });
    nhapMa(dlg);
    const o = within(dlg).getByLabelText(S("scada.kenh.dialog.lyDo")) as HTMLTextAreaElement;
    fireEvent.change(o, { target: { value: "abc" } });
    expect(gui).toBeDisabled();
    expect(within(dlg).getByText(S("scada.kenh.dialog.lyDoNgan", { min: 5 }))).toBeInTheDocument();
    fireEvent.change(o, { target: { value: "  ab  " } });
    expect(gui).toBeDisabled();
    fireEvent.change(o, { target: { value: "  nâng mức tác động  " } });
    expect(gui).toBeEnabled();
    fireEvent.click(gui);
    expect(srv.mutCalls).toEqual([{ proc: "capNhat", vars: { tagId: 102, patch: { actuationLevel: 4 }, lyDo: "nâng mức tác động", totpCode: MA } }]);
  });

  it("chưa đổi gì ⇒ nút gửi khoá dù lý do đủ dài (patch rỗng bị máy chủ từ chối)", () => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    nhapLyDo(dlg, "lý do đủ dài");
    expect(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") })).toBeDisabled();
  });

  it("xoá một giá trị đang khai ⇒ gửi null (bỏ khai); bỏ mức ⇒ actuationLevel null; đổi dải ⇒ số", () => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.tenHienThi")), { target: { value: "" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.muc")), { target: { value: "" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.min")), { target: { value: "5" } });
    nhapLyDo(dlg, "dọn khai báo");
    fireEvent.click(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") }));
    expect(srv.mutCalls).toEqual([
      { proc: "capNhat", vars: { tagId: 102, patch: { displayName: null, actuationLevel: null, writeMin: 5 }, lyDo: "dọn khai báo", totpCode: MA } },
    ]);
  });

  it("xoá trắng ô giới hạn dưới đang khai ⇒ gửi writeMin: null (chỉ ô NGƯỜI DÙNG xoá mới thành null)", () => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.min")), { target: { value: "" } });
    nhapLyDo(dlg, "bỏ giới hạn dưới");
    fireEvent.click(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") }));
    expect(srv.mutCalls).toEqual([{ proc: "capNhat", vars: { tagId: 102, patch: { writeMin: null }, lyDo: "bỏ giới hạn dưới", totpCode: MA } }]);
  });

  it("chọn lại \"Không khai (suy từ writable)\" ở loại kênh đang khai ⇒ gửi channelKind: null", () => {
    render(<ScadaKenh />);
    const dlg = moSua("valve");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.loaiKenh")), { target: { value: "" } });
    nhapLyDo(dlg, "bỏ khai loại kênh");
    fireEvent.click(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") }));
    expect(srv.mutCalls).toEqual([{ proc: "capNhat", vars: { tagId: 104, patch: { channelKind: null }, lyDo: "bỏ khai loại kênh", totpCode: MA } }]);
  });

  // An toàn: <input type=number> trả "" cho chữ gõ dở ("-", "1e") ⇒ trước đây thành null và LẶNG LẼ bỏ một giới hạn đã khai (nới dải ngoài ý muốn).
  it.each(["-", "1e", "1.2.3", "abc", "0x10", "1,5"])("giới hạn dưới gõ dở / không phải số %j ⇒ nút gửi khoá + báo lỗi, KHÔNG gửi null", (go) => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.min")), { target: { value: go } });
    nhapLyDo(dlg, "lý do đủ dài");
    const gui = within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") });
    expect(gui).toBeDisabled();
    expect(within(dlg).getByText(S("scada.kenh.dialog.soLoi"))).toBeInTheDocument();
    expect(within(dlg).getByLabelText(S("scada.kenh.dialog.min"))).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(gui);
    expect(srv.mutCalls).toEqual([]);
    // sửa lại thành số hợp lệ ⇒ mở khoá, gửi số (không null)
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.min")), { target: { value: "-5" } });
    expect(within(dlg).queryByText(S("scada.kenh.dialog.soLoi"))).toBeNull();
    fireEvent.click(gui);
    expect(srv.mutCalls).toEqual([{ proc: "capNhat", vars: { tagId: 102, patch: { writeMin: -5 }, lyDo: "lý do đủ dài", totpCode: MA } }]);
  });

  it("bước và giới hạn trên gõ dở cũng khoá nút gửi", () => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    nhapLyDo(dlg, "lý do đủ dài");
    for (const nhan of ["scada.kenh.dialog.max", "scada.kenh.dialog.buoc"]) {
      const o = within(dlg).getByLabelText(S(nhan));
      fireEvent.change(o, { target: { value: "-" } });
      expect(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") })).toBeDisabled();
      fireEvent.change(o, { target: { value: nhan.endsWith("max") ? "100" : "0.5" } });
    }
  });

  it("dải sai (min > max) hoặc bước ≤ 0 ⇒ nút gửi khoá + báo lỗi", () => {
    render(<ScadaKenh />);
    const dlg = moSua("speed_sp");
    nhapLyDo(dlg, "lý do đủ dài");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.min")), { target: { value: "500" } });
    expect(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") })).toBeDisabled();
    expect(within(dlg).getByText(S("scada.kenh.dialog.daiLoi"))).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.min")), { target: { value: "0" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.buoc")), { target: { value: "0" } });
    expect(within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") })).toBeDisabled();
  });

  it("tag không phải số (bool) ⇒ ô dải/bước bị khoá", () => {
    render(<ScadaKenh />);
    const dlg = moSua("valve");
    expect(within(dlg).getByLabelText(S("scada.kenh.dialog.min"))).toBeDisabled();
    expect(within(dlg).getByLabelText(S("scada.kenh.dialog.buoc"))).toBeDisabled();
  });

  it("thành công ⇒ làm mới danh sách kênh + chế độ, toast, đóng hộp", () => {
    render(<ScadaKenh />);
    moSua("speed_sp");
    act(() => srv.mutOpts.capNhat.onSuccess?.({ changed: true }));
    expect(srv.invalidated).toEqual(expect.arrayContaining(["kenh.danhSach", "cheDo.danhSach"]));
    expect(toastSuccess).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("STOP_PIN_NGOAI_DAI ⇒ toast lỗi ĐÃ DỊCH (có tagKey + giá trị ghim, không phải mã trần); hộp giữ mở", () => {
    render(<ScadaKenh />);
    moSua("speed_sp");
    act(() =>
      srv.mutOpts.capNhat.onError?.({
        message: "Giá trị DỪNG đang ghim …",
        // R1b-2a T2 (K17) — máy chủ luôn gửi goiY (giá trị hoặc "—")
        data: { code: "BAD_REQUEST", appCode: "STOP_PIN_NGOAI_DAI", appParams: { ma: "STOP_PIN_NGOAI_DAI", lyDo: "OUT_OF_RANGE", tagKey: "speed_sp", stopValue: "0", min: "10", max: "100", step: "—", goiY: "—" } },
      }),
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    const cau = String(toastError.mock.calls[0][0]);
    expect(cau).toContain("speed_sp");
    expect(cau).toContain("DỪNG");
    expect(cau).not.toBe("STOP_PIN_NGOAI_DAI");
    expect(cau).not.toContain("{{"); // không placeholder thô (goiY mới)
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it.each(["INTERLOCK_NGOAI_DAI", "SCADA_CHANNEL_READ_ONLY"])("%s ⇒ toast lỗi đã dịch", (appCode) => {
    render(<ScadaKenh />);
    moSua("speed_sp");
    act(() =>
      srv.mutOpts.capNhat.onError?.({
        message: "x",
        data: { code: "BAD_REQUEST", appCode, appParams: { ma: appCode, lyDo: "OUT_OF_RANGE", tagKey: "speed_sp", min: "0", max: "1", step: "—" } },
      }),
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toContain("speed_sp");
  });

  it("CONFLICT (thử lại được) ⇒ toast lỗi với message máy chủ; hộp giữ mở để thử lại", () => {
    render(<ScadaKenh />);
    moSua("speed_sp");
    // đúng hình lỗi máy chủ ném (scadaKenhRouter.thuLai): CONFLICT + OPERATION_FAILED / reason scadaKenhThuLai
    const loi = Object.assign(new Error("Kênh vừa bị thay đổi đồng thời — tải lại rồi thử lại."), {
      data: { code: "CONFLICT", appCode: "OPERATION_FAILED", appParams: { operation: "scadaKenhCapNhat", reason: "scadaKenhThuLai" } },
    });
    act(() => srv.mutOpts.capNhat.onError?.(loi));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toContain("tải lại rồi thử lại");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("kiem-dinh P1-2 — mã TOTP 6 số bắt buộc ở cả ba hộp thoại cấu hình (capNhat / cheDo.dat / cheDo.go)", () => {
  const gui = (dlg: HTMLElement) => within(dlg).getByRole("button", { name: S("scada.kenh.dialog.gui") });
  const oMa = (dlg: HTMLElement) => within(dlg).getByLabelText(S("scada.kenh.dialog.totp")) as HTMLInputElement;

  it("sửa kênh: đủ lý do + có đổi nhưng THIẾU mã / mã 5 số ⇒ nút lưu khoá; ô mã chỉ nhận chữ số (tối đa 6)", () => {
    render(<ScadaKenh />);
    fireEvent.click(within(hangTag("speed_sp")).getByRole("button", { name: S("scada.kenh.nut.sua") }));
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.muc")), { target: { value: "4" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.lyDo")), { target: { value: "nâng mức tác động" } });
    expect(gui(dlg)).toBeDisabled();
    nhapMa(dlg, "12a34-5");
    expect(oMa(dlg).value).toBe("12345");
    expect(gui(dlg)).toBeDisabled();
    nhapMa(dlg, "1234567");
    expect(oMa(dlg).value).toBe("123456");
    expect(gui(dlg)).toBeEnabled();
    fireEvent.click(gui(dlg));
    expect(srv.mutCalls).toEqual([{ proc: "capNhat", vars: { tagId: 102, patch: { actuationLevel: 4 }, lyDo: "nâng mức tác động", totpCode: "123456" } }]);
  });

  it("đặt kênh chế độ: thiếu mã ⇒ khoá, không gửi", () => {
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S("scada.kenh.nut.datKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.tag")), { target: { value: "mode_sel" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.giaTriRemote")), { target: { value: "2" } });
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.lyDo")), { target: { value: "khai kênh chế độ" } });
    expect(gui(dlg)).toBeDisabled();
    fireEvent.click(gui(dlg));
    expect(srv.mutCalls).toEqual([]);
    nhapMa(dlg);
    expect(gui(dlg)).toBeEnabled();
  });

  it("gỡ kênh chế độ: thiếu mã ⇒ khoá, không gửi", () => {
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S("scada.kenh.nut.goKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText(S("scada.kenh.dialog.lyDo")), { target: { value: "máy bỏ kênh" } });
    expect(gui(dlg)).toBeDisabled();
    fireEvent.click(gui(dlg));
    expect(srv.mutCalls).toEqual([]);
    nhapMa(dlg);
    expect(gui(dlg)).toBeEnabled();
  });

  it.each([
    ["capNhat", "SCADA_CONFIG_TOTP_INVALID", { ma: "TOTP_SAI" }, "đã được dùng"],
    ["dat", "SCADA_CONFIG_TOTP_REQUIRED", { ma: "TOTP_CAN" }, "mã xác thực hai lớp"],
    ["go", "TOTP_TAM_KHOA", { ma: "TOTP_TAM_KHOA", remainingMinutes: 4 }, "4 phút"],
  ] as const)("%s + %s ⇒ toast ĐÃ DỊCH, ô mã bị XOÁ (nhập mã mới), hộp giữ mở", (proc, appCode, appParams, chu) => {
    render(<ScadaKenh />);
    if (proc === "capNhat") fireEvent.click(within(hangTag("speed_sp")).getByRole("button", { name: S("scada.kenh.nut.sua") }));
    else fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: S(proc === "dat" ? "scada.kenh.nut.datKenhCheDo" : "scada.kenh.nut.goKenhCheDo") }));
    const dlg = screen.getByRole("dialog");
    nhapMa(dlg);
    expect(oMa(dlg).value).toBe(MA);
    act(() => srv.mutOpts[proc].onError?.({ message: "x", data: { code: "PRECONDITION_FAILED", appCode, appParams } }));
    expect(toastError).toHaveBeenCalledTimes(1);
    const cau = String(toastError.mock.calls[0][0]);
    expect(cau).toContain(chu);
    expect(cau).not.toBe(appCode);
    expect(oMa(dlg).value).toBe("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ScadaKenh — trạng thái tải", () => {
  it("đang tải ⇒ khung chờ, không nhá 'chưa có adapter'", () => {
    srv.loading = true;
    render(<ScadaKenh />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    expect(screen.queryByText(S("scada.kenh.khongCoAdapter"))).toBeNull();
  });
  it("không có adapter nào trong phạm vi ⇒ thông báo trống", () => {
    srv.adapters = [];
    render(<ScadaKenh />);
    expect(screen.getByText(S("scada.kenh.khongCoAdapter"))).toBeInTheDocument();
  });
});

describe("ScadaKenh — ngôn ngữ", () => {
  it.each(["en", "zh"] as const)("%s: toàn trang (bảng, cảnh báo, 9 lý do, hộp thoại) KHÔNG còn chữ Việt và không lộ khoá i18n trần", async (lng) => {
    await act(async () => {
      await i18next.changeLanguage(lng);
    });
    srv.cheDo = LY_DO.map((ly, i) =>
      may({ machineId: 20 + i, code: `MX-${ly}`, ten: `m${i}`, lyDo: ly, cheDo: ly === "remote" ? "REMOTE" : "LOCAL", canhBaoNguon: i === 0 ? "edge" : null }),
    );
    render(<ScadaKenh />);
    expect(hangTag("cmd_stop")).toBeInTheDocument();
    // R1a T14 — hàng có thêm nút Faceplate ⇒ chọn đúng nút Sửa theo tên đã dịch của ngôn ngữ đang dùng
    fireEvent.click(within(hangTag("speed_sp")).getByRole("button", { name: i18next.t("scada.kenh.nut.sua") }));
    const text = () => document.body.textContent ?? "";
    expect(text()).not.toMatch(CHU_VIET);
    expect(text()).not.toMatch(/scada\.kenh\./);
    // đúng ngôn ngữ đang chọn (không rơi về vi): câu cảnh báo kênh dừng nằm trong bundle của ngôn ngữ đó
    const bundle = (lng === "en" ? en_ : zh_) as Record<string, any>;
    expect(text()).toContain(bundle.scada.kenh.canhBaoKenhDung);
    expect(text()).toContain(bundle.scada.kenh.cheDo.chuaKhai);
    for (const ly of LY_DO) expect(text()).toContain(bundle.scada.kenh.cheDo[KHOA_LY_DO[ly]]);
  });

  it("en: cả hộp thoại đặt kênh chế độ + cảnh báo nguồn cũng không có chữ Việt", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
    srv.cheDo = [may({ canhBaoNguon: "bao_khi_doi" })];
    render(<ScadaKenh />);
    fireEvent.click(within(hangMay("M-10")).getByRole("button", { name: /^Set mode channel$/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(CHU_VIET);
    expect(document.body.textContent ?? "").not.toMatch(/scada\.kenh\./);
  });
});
