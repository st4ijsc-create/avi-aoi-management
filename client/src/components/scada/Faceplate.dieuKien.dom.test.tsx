// @vitest-environment jsdom
//
// R1b-2b-2b B-T11 (M4, mục 2) — khối "Điều kiện cho phép" trên faceplate. Component THẬT + bundle vi THẬT + react-query THẬT (đếm lượt gọi thật);
// chỉ mock hợp đồng mạng. Hợp đồng (C5): query `scadaCommands.dieuKienChoPhep {adapterId, tagKey, value}` — chạy khô, CHỈ hiển thị,
// debounce 400 ms, KHÔNG poll, KHÔNG khoá nút Đổi (máy chủ là trọng tài ở `request`), lỗi chạy khô ⇒ ẩn khối.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
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
const CHUA_TINH = ["khoa-chon", "totp-xac-minh", "han-gui"];
const srv = vi.hoisted(() => ({
  kenh: [] as Record<string, unknown>[],
  cheDo: [] as Record<string, unknown>[],
  /** mỗi lượt gọi THẬT của queryFn dieuKienChoPhep */
  dk: [] as unknown[],
  traDk: (() => ({})) as (i: unknown) => unknown,
  loiDk: null as unknown,
  request: [] as unknown[],
  reqOpts: undefined as { onSuccess?: (r: unknown) => void } | undefined,
  dkOpts: [] as unknown[],
}));
vi.mock("@/lib/trpc", () => {
  return {
    trpc: {
      scadaCommands: {
        request: {
          useMutation: (o: { onSuccess?: (r: unknown) => void }) => {
            srv.reqOpts = o;
            return { mutate: (v: unknown) => srv.request.push(v), isPending: false };
          },
        },
        confirm: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
        huy: { useMutation: () => ({ mutate: () => undefined }) },
        dieuKienChoPhep: {
          useQuery: (input: unknown, opts: Record<string, unknown>) => {
            srv.dkOpts.push(opts);
            return useQuery({
              queryKey: ["dk", input],
              queryFn: async () => {
                srv.dk.push(input);
                if (srv.loiDk) throw srv.loiDk;
                return srv.traDk(input);
              },
              ...opts,
            });
          },
        },
      },
      scadaKenh: {
        danhSach: { useQuery: () => ({ data: srv.kenh, isLoading: false, isError: false }) },
        cheDo: { danhSach: { useQuery: () => ({ data: srv.cheDo, isLoading: false, isError: false }) } },
      },
      scadaDiag: { tagCuaAdapter: { useQuery: () => ({ data: [], isLoading: false, isError: false }) } },
    },
  };
});

import { mapTrpcError } from "@/lib/trpcErrors";
import { Faceplate } from "./Faceplate";

const kenh = (o: Row = {}): Row => ({
  tagId: 100, tagKey: "sp", dataType: "float", unit: "°C", writable: true, isEnabled: true, loaiKenh: "input_output", channelKindKhai: null,
  displayName: "Zone 7 SP", displayFormat: "0.0", writeMin: 240, writeMax: 250, writeStep: 0.5, actuationLevel: 3, mucHieuLuc: 3, stopValue: null,
  laKenhCheDo: false, canhBaoKenhDung: false, ...o,
});
const may = (): Row => ({ machineId: 10, code: "RF-2", ten: "Reflow 2", kenhAn: false, kenh: null, cheDo: "REMOTE", lyDo: "remote", canhBaoNguon: null });
const duoc = (canTotp = false, canhBao: string[] = []) => ({ quaCongTinh: true, canTotp, muc: 3, canhBao, chuaTinh: CHUA_TINH });
const NGOAI_DAI = {
  quaCongTinh: false,
  tuChoi: { code: "SCADA_VALUE_OUT_OF_RANGE", params: { ma: "OUT_OF_RANGE", tagKey: "sp", min: 240, max: 250 } },
  chuaTinh: CHUA_TINH,
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
});
beforeEach(() => {
  vi.useFakeTimers();
  srv.kenh = [kenh()];
  srv.cheDo = [may()];
  srv.dk = [];
  srv.dkOpts = [];
  srv.request = [];
  srv.loiDk = null;
  srv.traDk = () => duoc();
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await act(async () => {
    await i18next.changeLanguage("vi");
  });
});

const ve = (edgeCode: string | null = null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Faceplate adapterId={1} tagKey="sp" machineId={10} edgeCode={edgeCode} onDong={() => undefined} />
    </QueryClientProvider>,
  );
};
const oSo = () => screen.getByLabelText(S("scada.faceplate.giaTriMoi"));
const nhapSo = (v: string) => fireEvent.change(oSo(), { target: { value: v } });
const nhapLyDo = (v: string) => fireEvent.change(screen.getByLabelText(S("scada.kenh.dialog.lyDo")), { target: { value: v } });
const troi = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
/** đợi hết debounce + cho react-query giao kết quả */
const hoi = async () => {
  await troi(400);
  await troi(50);
};
const ketQua = () => screen.queryByTestId("dieu-kien-ket-qua");

describe("Faceplate — Điều kiện cho phép (B-T11)", () => {
  it("★ nhập 50 ⇒ SAU 400 ms đúng MỘT lượt dieuKienChoPhep {adapterId, tagKey, value: 50}; trước 400 ms chưa gọi", async () => {
    ve();
    expect(srv.dk).toEqual([]);
    nhapSo("50");
    await troi(399);
    expect(srv.dk).toEqual([]);
    await troi(1);
    expect(srv.dk).toEqual([{ adapterId: 1, tagKey: "sp", value: 50 }]);
  });

  it("★ gõ nhanh 5 ký tự ⇒ MỘT lượt (debounce theo giá trị cuối)", async () => {
    ve();
    for (const v of ["2", "24", "245", "245.", "245.5"]) {
      nhapSo(v);
      await troi(100);
    }
    expect(srv.dk).toEqual([]);
    await troi(400);
    expect(srv.dk).toEqual([{ adapterId: 1, tagKey: "sp", value: 245.5 }]);
  });

  it("ô không hợp lệ ⇒ không gọi, không hiện khối", async () => {
    ve();
    nhapSo("abc");
    await troi(1000);
    expect(srv.dk).toEqual([]);
    expect(screen.queryByTestId("dieu-kien")).toBeNull();
  });

  it("★ KHÔNG poll: không refetchInterval, không refetchOnWindowFocus, retry false; 10 s trôi qua ⇒ vẫn MỘT lượt", async () => {
    ve();
    nhapSo("50");
    await troi(400);
    await troi(10_000);
    expect(srv.dk).toHaveLength(1);
    const o = srv.dkOpts.at(-1) as Record<string, unknown>;
    expect(o.refetchInterval).toBe(false);
    expect(o.refetchOnWindowFocus).toBe(false);
    expect(o.retry).toBe(false);
  });

  it("ba kết quả ⇒ ba câu: Được phép · Được phép — cần mã · Không được phép: <câu dịch của tuChoi>", async () => {
    ve();
    nhapSo("1");
    await hoi();
    expect(ketQua()).toHaveTextContent(new RegExp(`^${S("scada.dieuKien.duocPhep")}$`));
    expect(ketQua()).toHaveAttribute("data-ket-qua", "duoc-phep");

    srv.traDk = () => duoc(true);
    nhapSo("2");
    await hoi();
    expect(ketQua()).toHaveTextContent(S("scada.dieuKien.duocPhepTotp"));
    expect(ketQua()).toHaveAttribute("data-ket-qua", "duoc-phep-totp");

    srv.traDk = () => NGOAI_DAI;
    nhapSo("999");
    await hoi();
    expect(ketQua()).toHaveAttribute("data-ket-qua", "khong-duoc-phep");
    expect(ketQua()).toHaveTextContent(S("scada.lenh.loi.OUT_OF_RANGE", { min: "240", max: "250" }));
    expect(ketQua()?.textContent).toMatch(/^Không được phép: /);
  });

  it("cảnh báo (preview.warnings) hiện dạng danh sách; chuaTinh hiện MỘT câu nêu 3 phần chưa kiểm", async () => {
    ve();
    srv.traDk = () => duoc(false, ["SAFETY_KIEM_LUC_GUI"]);
    nhapSo("50");
    await hoi();
    expect(within(screen.getByTestId("dieu-kien-canh-bao")).getAllByRole("listitem")).toHaveLength(1);
    const ct = screen.getByTestId("dieu-kien-chua-tinh").textContent ?? "";
    for (const c of CHUA_TINH) expect(ct).toContain(S(`scada.dieuKien.chuaTinhMuc.${c}`));
  });

  it("★ quaCongTinh:false mà nút Đổi VẪN bấm được và gửi request (không khoá theo chạy khô)", async () => {
    ve();
    srv.traDk = () => NGOAI_DAI;
    nhapSo("999");
    nhapLyDo("thử ngưỡng");
    await hoi();
    expect(ketQua()).toHaveAttribute("data-ket-qua", "khong-duoc-phep");
    const nut = screen.getByRole("button", { name: S("scada.faceplate.nutDoi") });
    expect(nut).toBeEnabled();
    fireEvent.click(nut);
    expect(srv.request).toHaveLength(1);
    expect(srv.request[0]).toMatchObject({ adapterId: 1, tagKey: "sp", value: 999 });
  });

  it("★ lỗi chạy khô (rateLimited) ⇒ ẨN khối, nút Đổi vẫn bấm được", async () => {
    ve();
    srv.loiDk = { message: "x", data: { code: "TOO_MANY_REQUESTS", appCode: "OPERATION_FAILED", appParams: { operation: "scadaDryRun", reason: "rateLimited" } } };
    nhapSo("50");
    nhapLyDo("thử lại giá trị");
    await hoi();
    expect(srv.dk).toHaveLength(1);
    expect(screen.queryByTestId("dieu-kien")).toBeNull();
    expect(screen.getByRole("button", { name: S("scada.faceplate.nutDoi") })).toBeEnabled();
  });

  it("đổi giá trị: kết quả CŨ ẩn ngay (không giữ kết luận của giá trị khác) tới khi có kết quả mới", async () => {
    ve();
    nhapSo("50");
    await hoi();
    expect(ketQua()).not.toBeNull();
    nhapSo("51");
    expect(screen.queryByTestId("dieu-kien")).toBeNull();
    await hoi();
    expect(ketQua()).not.toBeNull();
    expect(srv.dk).toHaveLength(2);
  });
});

describe("Faceplate — Điều kiện cho phép: ghim đột biến sống của kiem-dinh (B-T11)", () => {
  const tuChoi = (code: string, params: Record<string, unknown>) => ({ quaCongTinh: false, tuChoi: { code, params }, chuaTinh: CHUA_TINH });

  it("d6 — truy vấn KHÔNG retry (retry === false, không phải số)", async () => {
    ve();
    nhapSo("50");
    await hoi();
    expect((srv.dkOpts.at(-1) as Record<string, unknown>).retry).toBe(false);
  });

  it("★ f1 — hộp xác nhận (M5) đang mở ⇒ khối Điều kiện ẨN; đóng M5 mà còn giá trị ⇒ hiện lại", async () => {
    ve();
    nhapSo("240.5");
    nhapLyDo("Giam SP Z7");
    await hoi();
    expect(screen.getByTestId("dieu-kien")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: S("scada.faceplate.nutDoi") }));
    await act(async () => {
      srv.reqOpts?.onSuccess?.({
        requestId: "11111111-2222-4333-8444-555555555555",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        preview: {
          machine: "RF-2", channel: "Zone 7 SP", unit: "°C", current: { v: 245, q: "good", ageMs: 500 }, requested: 240.5, afterFormula: 240.5,
          range: { min: 240, max: 250, step: 0.5 }, level: 3, needsTotp: false, mode: "real", simulatedReasons: [], route: "central", warnings: [],
        },
      });
    });
    expect(screen.queryByTestId("dieu-kien")).toBeNull();
  });

  it("★ d20/d19 — tuChoi với mã LẠ (params.ma = XYZ) ⇒ câu dự phòng giai đoạn REQUEST (\"Không tạo được yêu cầu\") kèm CHI TIẾT, không phải câu của confirm", async () => {
    ve();
    const t = tuChoi("OPERATION_FAILED", { operation: "x", reason: "y", ma: "XYZ" });
    srv.traDk = () => t;
    nhapSo("50");
    await hoi();
    const chiTiet = mapTrpcError({ data: { appCode: t.tuChoi.code, appParams: t.tuChoi.params } });
    expect(chiTiet.trim()).not.toBe("");
    const cau = ketQua()?.textContent ?? "";
    expect(cau).toContain(S("scada.lenh.loi.khac", { chiTiet }));
    expect(cau).not.toContain(S("scada.lenh.loi.khacXacNhan", { chiTiet }));
  });

  it("★ d12/f2 — máy do EDGE sở hữu + lý do local chua_co_mau ⇒ chữ riêng của edge; máy thường ⇒ chữ thường", async () => {
    srv.traDk = () => tuChoi("SCADA_MACHINE_NOT_REMOTE", { ma: "MODE_LOCAL", lyDo: "chua_co_mau" });
    ve("E1");
    nhapSo("50");
    await hoi();
    expect(ketQua()).toHaveTextContent(S("scada.lenh.local.chuaCoMauEdge"));
    cleanup();
    ve(null);
    nhapSo("50");
    await hoi();
    expect(ketQua()).toHaveTextContent(S("scada.lenh.local.chuaCoMau"));
    expect(ketQua()?.textContent).not.toContain(S("scada.lenh.local.chuaCoMauEdge"));
  });

  it("★ d18 — nhập 50 → xoá → nhập lại 50: KHÔNG hiện kết quả cũ ngay; phải chờ đủ 400 ms (debounce không bị bỏ qua)", async () => {
    ve();
    nhapSo("50");
    await hoi();
    expect(ketQua()).not.toBeNull();
    nhapSo("");
    await troi(50);
    expect(screen.queryByTestId("dieu-kien")).toBeNull();
    nhapSo("50");
    await troi(100);
    expect(screen.queryByTestId("dieu-kien")).toBeNull();
    await hoi();
    expect(ketQua()).not.toBeNull();
  });
});
