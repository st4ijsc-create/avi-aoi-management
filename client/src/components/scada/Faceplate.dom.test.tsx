// @vitest-environment jsdom
//
// SCADA R1a Task 14 — M4 faceplate (`Faceplate`). Render THẬT với bundle vi THẬT; chỉ mock hợp đồng mạng (`@/lib/trpc`), socket dùng chung
// và danh tính. Hợp đồng (brief Task 14 + báo cáo §4.5):
//   - LOCAL ⇒ ẩn MỌI lệnh, hiện "Đang điều khiển tại chỗ" + lý do;
//   - giá trị kèm chất lượng / tuổi; dải + mức;
//   - ô nhập theo displayFormat: số = ô + dải; `bool:Tắt,Bật` = hai nút có nhãn; `enum:A,B,C` = mỗi giá trị một nút;
//   - lý do ≥ 5 ký tự nhập TRƯỚC khi gọi request; "Đổi…" gọi request rồi mở M5;
//   - OFF_STEP ⇒ chữ có bước + goiY; nút gợi ý CHỈ điền ô (không gọi request, không tự làm tròn).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  kenhInput: undefined as unknown,
  tagInput: undefined as unknown,
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
      scadaCommands: { request: mut("request"), confirm: mut("confirm"), huy: mut("huy") },
      scadaKenh: {
        danhSach: {
          useQuery: (i: unknown) => {
            srv.kenhInput = i;
            return { data: srv.kenh, isLoading: false, isError: false };
          },
        },
        cheDo: { danhSach: { useQuery: () => ({ data: srv.cheDo, isLoading: false, isError: false }) } },
      },
      scadaDiag: {
        tagCuaAdapter: {
          useQuery: (i: unknown) => {
            srv.tagInput = i;
            return { data: srv.tags, isLoading: false, isError: false };
          },
        },
      },
    },
  };
});

import { Faceplate } from "./Faceplate";

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
const may = (o: Row): Row => ({ machineId: 10, code: "RF-2", ten: "Reflow 2", kenhAn: false, kenh: null, cheDo: "REMOTE", lyDo: "remote", canhBaoNguon: null, ...o });
const RID = "11111111-2222-4333-8444-555555555555";

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

const ve = (props: Partial<React.ComponentProps<typeof Faceplate>> = {}) => {
  const onDong = vi.fn();
  render(<Faceplate adapterId={1} tagKey="sp" machineId={10} edgeCode={null} onDong={onDong} {...props} />);
  return { onDong };
};
const fp = () => screen.getByTestId("faceplate");
const nutDoi = () => within(fp()).getByRole("button", { name: S("scada.faceplate.nutDoi") });
const oLyDo = () => within(fp()).getByLabelText(S("scada.kenh.dialog.lyDo"));
const oSo = () => within(fp()).getByLabelText(S("scada.faceplate.giaTriMoi"));
const goi = (proc: string) => srv.calls.filter((c) => c.proc === proc);
const loi = (appCode: string, appParams: Record<string, unknown>) => ({ message: "x", data: { appCode, appParams } });

describe("Faceplate — hiển thị", () => {
  it("hỏi đúng adapter; tiêu đề = máy + kênh + chế độ; giá trị kèm chất lượng/tuổi; dải + bước + mức", () => {
    ve();
    expect(srv.kenhInput).toEqual({ adapterId: 1 });
    expect(srv.tagInput).toEqual({ adapterId: 1 });
    const f = fp();
    expect(within(f).getByText("Zone 7 SP", { exact: false })).toBeInTheDocument();
    expect(within(f).getByTestId("che-do-may")).toHaveTextContent("REMOTE");
    expect(within(f).getByTestId("gia-tri-song")).toHaveTextContent("245,0");
    expect(within(f).getByTestId("gia-tri-song")).toHaveTextContent("°C");
    expect(within(f).getByTestId("chat-luong")).toHaveTextContent(S("scada.diag.chatLuong.tot"));
    expect(within(f).getByTestId("tuoi")).toHaveTextContent(`0,8 ${S("scada.diag.donVi.giay")}`);
    expect(within(f).getByTestId("dai")).toHaveTextContent("240 … 250");
    expect(within(f).getByTestId("buoc")).toHaveTextContent("0,5");
    expect(within(f).getByTestId("muc")).toHaveTextContent(/^3$/);
  });

  it("giá trị xấu ⇒ gạch tím (D10), chữ 'Xấu'", () => {
    srv.tags = [live({ q: "bad", stale: true })];
    ve();
    expect(within(fp()).getByTestId("gia-tri-song")).toHaveAttribute("data-vien", "purple-strike");
  });

  it("kênh ra chưa khai mức ⇒ '5 — mặc định đóng'", () => {
    srv.kenh = [kenh({ actuationLevel: null, mucHieuLuc: 5, loaiKenh: "output" })];
    ve();
    expect(within(fp()).getByTestId("muc")).toHaveTextContent(S("scada.kenh.mucMacDinhDong"));
  });
});

describe("Faceplate — chế độ LOCAL", () => {
  it("LOCAL ⇒ ẩn MỌI lệnh (không ô nhập, không nút giá trị, không 'Đổi…', không ô lý do) + 'Đang điều khiển tại chỗ' + lý do", () => {
    srv.cheDo = [may({ cheDo: "LOCAL", lyDo: "khac_remote" })];
    ve();
    const f = fp();
    expect(within(f).getByText(S("scada.faceplate.taiCho"))).toBeInTheDocument();
    expect(within(f).getByText(S("scada.lenh.local.khacRemote"), { exact: false })).toBeInTheDocument();
    expect(within(f).queryByRole("button", { name: S("scada.faceplate.nutDoi") })).toBeNull();
    expect(within(f).queryByLabelText(S("scada.faceplate.giaTriMoi"))).toBeNull();
    expect(within(f).queryByLabelText(S("scada.kenh.dialog.lyDo"))).toBeNull();
    expect(within(f).getByTestId("che-do-may")).toHaveTextContent("LOCAL");
  });

  it("LOCAL bool ⇒ không có hai nút giá trị", () => {
    srv.kenh = [kenh({ dataType: "bool", displayFormat: "bool:Tắt,Bật", writeMin: null, writeMax: null, writeStep: null })];
    srv.cheDo = [may({ cheDo: "LOCAL", lyDo: "bo_dem_tat" })];
    ve();
    expect(within(fp()).queryByRole("button", { name: "Tắt" })).toBeNull();
    expect(within(fp()).queryByRole("button", { name: "Bật" })).toBeNull();
    expect(within(fp()).getByText(S("scada.lenh.local.boDemTat"), { exact: false })).toBeInTheDocument();
  });

  it("adapter không gắn máy / máy không có trong danh sách chế độ ⇒ coi như LOCAL (fail-closed)", () => {
    ve({ machineId: null });
    expect(within(fp()).getByText(S("scada.faceplate.taiCho"))).toBeInTheDocument();
    expect(within(fp()).queryByRole("button", { name: S("scada.faceplate.nutDoi") })).toBeNull();
  });

  it("máy edge chưa có mẫu chế độ ⇒ chữ R1c", () => {
    srv.cheDo = [may({ cheDo: "LOCAL", lyDo: "chua_co_mau" })];
    ve({ edgeCode: "EN-02" });
    expect(within(fp()).getByText(S("scada.lenh.local.chuaCoMauEdge"), { exact: false })).toBeInTheDocument();
  });
});

describe("Faceplate — ô nhập theo displayFormat", () => {
  it("bool:Tắt,Bật ⇒ HAI nút có nhãn; chọn 'Bật' + lý do ⇒ request value=true", () => {
    srv.kenh = [kenh({ dataType: "bool", displayFormat: "bool:Tắt,Bật", writeMin: null, writeMax: null, writeStep: null })];
    srv.tags = [live({ v: false })];
    ve();
    const tat = within(fp()).getByRole("button", { name: "Tắt" });
    const bat = within(fp()).getByRole("button", { name: "Bật" });
    expect(within(fp()).queryByLabelText(S("scada.faceplate.giaTriMoi"))).toBeNull();
    expect(within(fp()).getByTestId("gia-tri-song")).toHaveTextContent("Tắt");
    expect(bat).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(bat);
    expect(bat).toHaveAttribute("aria-pressed", "true");
    expect(tat).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(oLyDo(), { target: { value: "Bat quat Z7" } });
    fireEvent.click(nutDoi());
    expect(goi("request")).toHaveLength(1);
    const v = goi("request")[0].vars as Record<string, unknown>;
    expect(v).toMatchObject({ adapterId: 1, tagKey: "sp", value: true, lyDo: "Bat quat Z7" });
    expect(String(v.clientRequestId)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("enum:A,B,C ⇒ MỖI giá trị một nút; kênh số ⇒ gửi chỉ số (B = 1)", () => {
    srv.kenh = [kenh({ dataType: "int", displayFormat: "enum:Auto,Manual,Off", writeMin: null, writeMax: null, writeStep: null })];
    srv.tags = [live({ v: 0 })];
    ve();
    for (const n of ["Auto", "Manual", "Off"]) expect(within(fp()).getByRole("button", { name: n })).toBeInTheDocument();
    expect(within(fp()).getByTestId("gia-tri-song")).toHaveTextContent("Auto");
    fireEvent.click(within(fp()).getByRole("button", { name: "Manual" }));
    fireEvent.change(oLyDo(), { target: { value: "Chuyen tay" } });
    fireEvent.click(nutDoi());
    expect((goi("request")[0].vars as Record<string, unknown>).value).toBe(1);
  });

  it("số ⇒ ô nhập + dải; chữ gõ dở ⇒ nút khoá; số hợp lệ ⇒ gửi số (không tự làm tròn)", () => {
    ve();
    expect(within(fp()).getByText(S("scada.faceplate.trongDai", { min: "240", max: "250" }))).toBeInTheDocument();
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.change(oSo(), { target: { value: "24x" } });
    expect(nutDoi()).toBeDisabled();
    fireEvent.change(oSo(), { target: { value: "240.2" } });
    expect(nutDoi()).toBeEnabled();
    fireEvent.click(nutDoi());
    expect((goi("request")[0].vars as Record<string, unknown>).value).toBe(240.2);
  });

  it("lý do < 5 ký tự ⇒ 'Đổi…' khoá; chưa chọn giá trị ⇒ khoá", () => {
    ve();
    expect(nutDoi()).toBeDisabled();
    fireEvent.change(oSo(), { target: { value: "245" } });
    fireEvent.change(oLyDo(), { target: { value: "abcd" } });
    expect(nutDoi()).toBeDisabled();
    fireEvent.change(oLyDo(), { target: { value: "  abcd  " } });
    expect(nutDoi()).toBeDisabled();
    fireEvent.change(oLyDo(), { target: { value: "abcde" } });
    expect(nutDoi()).toBeEnabled();
    fireEvent.click(nutDoi());
    expect((goi("request")[0].vars as Record<string, unknown>).lyDo).toBe("abcde");
  });

  it("kênh không ghi được (chỉ đọc) ⇒ không có lệnh, có chữ 'chỉ đọc'", () => {
    srv.kenh = [kenh({ writable: false, loaiKenh: "input" })];
    ve();
    expect(within(fp()).getByText(S("scada.faceplate.chiDoc"))).toBeInTheDocument();
    expect(within(fp()).queryByRole("button", { name: S("scada.faceplate.nutDoi") })).toBeNull();
  });
});

describe("Faceplate — request ⇒ M5 / lỗi request", () => {
  it("request thành công ⇒ mở M5 với bản xem trước + lý do", async () => {
    ve();
    fireEvent.change(oSo(), { target: { value: "240.5" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.click(nutDoi());
    await act(async () => {
      srv.opts.request.onSuccess?.({
        requestId: RID,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        preview: {
          machine: "RF-2",
          channel: "Zone 7 SP",
          unit: "°C",
          current: { v: 245, q: "good", ageMs: 500 },
          requested: 240.5,
          afterFormula: 240.5,
          range: { min: 240, max: 250, step: 0.5 },
          level: 3,
          needsTotp: false,
          mode: "real",
          simulatedReasons: [],
          route: "central",
          warnings: [],
        },
      });
    });
    const m5 = screen.getByRole("dialog", { name: S("scada.lenh.tieuDe") });
    expect(within(m5).getByTestId("truong-lyDo")).toHaveTextContent("Giam SP Z7");
    expect(within(m5).getByTestId("truong-yeuCau")).toHaveTextContent("240,5");
  });

  it("OFF_STEP ⇒ 'Giá trị phải theo bước {step}. Giá trị hợp lệ gần nhất: {goiY}'; bấm gợi ý CHỈ điền ô, KHÔNG gọi request", async () => {
    ve();
    fireEvent.change(oSo(), { target: { value: "240.2" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.click(nutDoi());
    expect(goi("request")).toHaveLength(1);
    await act(async () => {
      srv.opts.request.onError?.(loi("SCADA_VALUE_OFF_STEP", { ma: "OFF_STEP", tagKey: "sp", step: 0.5, goiY: 240 }));
    });
    const tb = within(fp()).getByTestId("loi-lenh");
    expect(tb).toHaveTextContent("Giá trị phải theo bước 0,5. Giá trị hợp lệ gần nhất: 240");
    fireEvent.click(within(tb).getByRole("button", { name: S("scada.lenh.loi.nutDungGoiY", { goiY: "240" }) }));
    expect(oSo()).toHaveValue("240");
    expect(goi("request")).toHaveLength(1); // không tự gửi
    expect(screen.queryByRole("dialog", { name: S("scada.lenh.tieuDe") })).toBeNull();
    expect(within(fp()).queryByTestId("loi-lenh")).toBeNull(); // gợi ý đã dùng ⇒ thông báo cũ gỡ
  });

  it("MODE_LOCAL ở request ⇒ chữ theo lyDo + gợi ý STOP; EDGE_CHUA_HO_TRO ⇒ mã edge", async () => {
    ve({ edgeCode: "EN-02" });
    fireEvent.change(oSo(), { target: { value: "245" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.click(nutDoi());
    await act(async () => {
      srv.opts.request.onError?.(loi("SCADA_EDGE_NOT_SUPPORTED", { ma: "EDGE_CHUA_HO_TRO", edgeCode: "EN-02" }));
    });
    expect(within(fp()).getByTestId("loi-lenh")).toHaveTextContent(
      "Máy này do edge EN-02 sở hữu — lệnh từ SCADA tới máy edge chưa được hỗ trợ (đợt R1c)",
    );
    fireEvent.click(nutDoi());
    await act(async () => {
      srv.opts.request.onError?.(loi("SCADA_MACHINE_NOT_REMOTE", { ma: "MODE_LOCAL", lyDo: "bo_dem_tat" }));
    });
    const tb = within(fp()).getByTestId("loi-lenh");
    expect(tb).toHaveTextContent("Bộ đệm giá trị sống đang tắt — mọi máy coi như LOCAL");
    expect(tb).toHaveTextContent("Cần dừng máy? Dùng STOP đã ghim hoặc E-STOP cứng tại máy");
  });
});

describe("Faceplate — R1a final I-1 (429 ở request)", () => {
  it("429 của bộ giới hạn ở request ⇒ 'Không gửi — vượt giới hạn tần suất, thử lại sau'", async () => {
    ve();
    fireEvent.change(oSo(), { target: { value: "245" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.click(nutDoi());
    await act(async () => {
      srv.opts.request.onError?.({ message: "x", data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, appCode: "TRPC_GIOI_HAN_THU_TUC", nhom: "2fa", retryAfterGiay: 9 } });
    });
    expect(within(fp()).getByTestId("loi-lenh")).toHaveTextContent("Không gửi — vượt giới hạn tần suất, thử lại sau");
  });
});

describe("Faceplate — fix round 1 (khuôn × kiểu, chặn gửi bằng ref)", () => {
  it("MINOR 3 — khuôn bool: trên kênh int ⇒ hai nút gửi 0 / 1", () => {
    srv.kenh = [kenh({ dataType: "int", displayFormat: "bool:Dung,Chay", writeMin: null, writeMax: null, writeStep: null })];
    srv.tags = [live({ v: 0 })];
    ve();
    expect(within(fp()).getByTestId("gia-tri-song")).toHaveTextContent("Dung");
    fireEvent.click(within(fp()).getByRole("button", { name: "Chay" }));
    fireEvent.change(oLyDo(), { target: { value: "Chay may Z7" } });
    fireEvent.click(nutDoi());
    expect((goi("request")[0].vars as Record<string, unknown>).value).toBe(1);
  });

  it("MINOR 3 — khuôn enum trên kênh bool, ĐÚNG 2 giá trị ⇒ chỉ số 0 = false, 1 = true", () => {
    srv.kenh = [kenh({ dataType: "bool", displayFormat: "enum:Shut,Open", writeMin: null, writeMax: null, writeStep: null })];
    srv.tags = [live({ v: true })];
    ve();
    expect(within(fp()).getByTestId("gia-tri-song")).toHaveTextContent("Open");
    fireEvent.click(within(fp()).getByRole("button", { name: "Shut" }));
    fireEvent.change(oLyDo(), { target: { value: "Dong van Z7" } });
    fireEvent.click(nutDoi());
    expect((goi("request")[0].vars as Record<string, unknown>).value).toBe(false);
  });

  it("MINOR 3 — khuôn enum trên kênh bool KHÁC 2 giá trị ⇒ khoá nút + gợi ý sửa cấu hình, không gửi được", () => {
    srv.kenh = [kenh({ dataType: "bool", displayFormat: "enum:A,B,C", writeMin: null, writeMax: null, writeStep: null })];
    ve();
    for (const n of ["A", "B", "C"]) expect(within(fp()).getByRole("button", { name: n })).toBeDisabled();
    expect(within(fp()).getByText(S("scada.faceplate.enumBoolSai", { n: 3 }))).toBeInTheDocument();
    fireEvent.change(oLyDo(), { target: { value: "Thu doi gia tri" } });
    expect(nutDoi()).toBeDisabled();
  });

  it("MINOR 4 — hai cú bấm 'Đổi…' trong CÙNG một lượt render ⇒ request đúng một lần (chặn bằng ref)", () => {
    ve();
    fireEvent.change(oSo(), { target: { value: "245" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    const n = nutDoi();
    act(() => {
      n.click();
      n.click();
    });
    expect(goi("request")).toHaveLength(1);
  });

  it("request bị từ chối ⇒ gửi lại được (ref nhả khi lỗi)", async () => {
    ve();
    fireEvent.change(oSo(), { target: { value: "245" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.click(nutDoi());
    await act(async () => {
      srv.opts.request.onError?.(loi("SCADA_TAG_SELECTED_BY_OTHER", { ma: "KHOA_CHON_LOI" }));
    });
    fireEvent.click(nutDoi());
    expect(goi("request")).toHaveLength(2);
  });

  it("faceplate đã gỡ khi request mới trả về ⇒ huy yêu cầu đó ngay (không giữ khoá chọn tới hết TTL)", async () => {
    ve();
    fireEvent.change(oSo(), { target: { value: "245" } });
    fireEvent.change(oLyDo(), { target: { value: "Giam SP Z7" } });
    fireEvent.click(nutDoi());
    const onSuccess = srv.opts.request.onSuccess;
    cleanup();
    await act(async () => {
      onSuccess?.({ requestId: RID, expiresAt: new Date(Date.now() + 60_000).toISOString(), preview: {} });
    });
    expect(goi("huy")).toEqual([{ proc: "huy", vars: { requestId: RID } }]);
  });
});
