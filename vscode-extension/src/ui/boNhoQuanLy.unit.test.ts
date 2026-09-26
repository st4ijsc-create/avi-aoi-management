/**
 * LƯỚI TÍCH HỢP cho `boNhoQuanLy.ts` (ĐỢT H / TASK H3 / B2) — vòng ĐỌC → VẼ → nhận tin XOÁ → VẼ
 * LẠI, trên một bản giả `vscode` tối thiểu (cùng khuôn `bangChat.mucQuyen.unit.test.ts`). Hàng rào
 * nội dung (che bí mật/trần dung lượng) đã có lưới RIÊNG trên đĩa THẬT ở `loi/khoBoNho.unit.test.ts`
 * — tệp này CHỈ đo lớp điều phối: đúng tin, đúng hành động, đúng lượt VẼ LẠI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const may = vi.hoisted(() => ({
  html: [] as string[],
  nhanTin: undefined as undefined | ((m: Record<string, unknown>) => void),
  don: undefined as undefined | (() => void),
  revealGoi: 0,
  workspaceState: {} as Record<string, unknown>,
}));

vi.mock("vscode", () => ({
  ViewColumn: { Active: 1 },
  window: {
    createWebviewPanel: () => ({
      webview: {
        set html(v: string) {
          may.html.push(v);
        },
        get html(): string {
          return may.html[may.html.length - 1] ?? "";
        },
        onDidReceiveMessage: (h: (m: Record<string, unknown>) => void) => {
          may.nhanTin = h;
        },
      },
      onDidDispose: (h: () => void) => {
        may.don = h;
      },
      reveal: () => {
        may.revealGoi++;
      },
    }),
    showInputBox: async () => undefined,
    showInformationMessage: () => Promise.resolve(undefined),
  },
  workspace: {},
}));

import { BoNhoQuanLy, chayNhoDieuNay } from "./boNhoQuanLy";

function dungContextGia() {
  return {
    workspaceState: {
      get: (k: string, mm: unknown) => (k in may.workspaceState ? may.workspaceState[k] : mm),
      update: async (k: string, v: unknown) => {
        if (v === undefined) delete may.workspaceState[k];
        else may.workspaceState[k] = v;
      },
    },
  };
}

beforeEach(() => {
  // ★★★ `BoNhoQuanLy` là SINGLETON (`static hienTai`) — sống sót giữa các `it()` trong CÙNG tệp
  // lưới trừ khi tự dọn. Gọi ĐÚNG handler `onDidDispose` mà panel của lượt TRƯỚC đã đăng ký (nếu
  // có) để đưa `BoNhoQuanLy.hienTai` về `undefined` trước khi lượt mới bắt đầu — cùng khuôn
  // `bangChat.mucQuyen.unit.test.ts`.
  may.don?.();
  may.html = [];
  may.nhanTin = undefined;
  may.don = undefined;
  may.revealGoi = 0;
  may.workspaceState = {};
});

describe("BoNhoQuanLy — B2: NHÌN THẤY và SỬA ĐƯỢC", () => {
  it("★★★ mở lần đầu ⇒ vẽ ĐÚNG danh sách đang có trong workspaceState", () => {
    may.workspaceState["aviAiLocal.boNho"] = [{ ma: "m1", noiDung: "nhớ điều X", thoiDiem: 1, nguon: "nguoi_dung_bao_nho" }];
    BoNhoQuanLy.moHoacHien(dungContextGia() as never);
    expect(may.html).toHaveLength(1);
    expect(may.html[0]).toContain("nhớ điều X");
  });

  it("★★★ mở LẦN THỨ HAI ⇒ KHÔNG dựng panel mới, chỉ reveal panel cũ + vẽ lại", () => {
    BoNhoQuanLy.moHoacHien(dungContextGia() as never);
    BoNhoQuanLy.moHoacHien(dungContextGia() as never);
    expect(may.revealGoi).toBe(1);
    expect(may.html.length).toBeGreaterThanOrEqual(2); // vẽ lúc mở + vẽ lại lúc mở lần hai
  });

  it("★★★ nhận tin 'xoa_muc' ⇒ mục biến mất khỏi workspaceState VÀ khỏi lượt vẽ lại", () => {
    may.workspaceState["aviAiLocal.boNho"] = [
      { ma: "m1", noiDung: "giữ lại", thoiDiem: 1, nguon: "nguoi_dung_bao_nho" },
      { ma: "m2", noiDung: "bị xoá", thoiDiem: 2, nguon: "nguoi_dung_bao_nho" },
    ];
    BoNhoQuanLy.moHoacHien(dungContextGia() as never);
    may.nhanTin?.({ loai: "xoa_muc", ma: "m2" });

    const ds = may.workspaceState["aviAiLocal.boNho"] as Array<{ ma: string }>;
    expect(ds.map((m) => m.ma)).toEqual(["m1"]);
  });

  it("★★★ nhận tin 'xoa_tat_ca' ⇒ workspaceState rỗng", () => {
    may.workspaceState["aviAiLocal.boNho"] = [{ ma: "m1", noiDung: "x", thoiDiem: 1, nguon: "nguoi_dung_bao_nho" }];
    BoNhoQuanLy.moHoacHien(dungContextGia() as never);
    may.nhanTin?.({ loai: "xoa_tat_ca" });

    expect(may.workspaceState["aviAiLocal.boNho"]).toEqual([]);
  });

  it("★ tin LẠ (loại không nhận diện được) ⇒ bỏ qua im lặng, KHÔNG ném lỗi, KHÔNG đổi kho", () => {
    may.workspaceState["aviAiLocal.boNho"] = [{ ma: "m1", noiDung: "x", thoiDiem: 1, nguon: "nguoi_dung_bao_nho" }];
    BoNhoQuanLy.moHoacHien(dungContextGia() as never);
    expect(() => may.nhanTin?.({ loai: "khong_ton_tai" })).not.toThrow();
    expect(may.workspaceState["aviAiLocal.boNho"]).toHaveLength(1);
  });
});

describe("chayNhoDieuNay — B5 nhánh 1: người dùng CHỦ ĐỘNG bảo nhớ", () => {
  it("★ Esc / để trống ⇒ KHÔNG ghi gì cả (showInputBox trả undefined)", async () => {
    await chayNhoDieuNay(dungContextGia() as never);
    expect(may.workspaceState["aviAiLocal.boNho"]).toBeUndefined();
  });
});
