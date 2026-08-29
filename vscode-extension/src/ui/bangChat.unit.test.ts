/**
 * LƯỚI cho hai hàng rào của `ui/bangChat.ts` mà không lưới thuần nào với tới được:
 *   · **Minor** — `quenDeXuat` phải xoá `nhanNguonHienTai` VÔ ĐIỀU KIỆN (bản cũ `return` sớm khi
 *     không có `actionId`, bỏ lại nhãn — tức bỏ lại CHẾ ĐỘ — của lượt trước);
 *   · **I-5** — không xác định được chế độ ⇒ **từ chối cả lượt hỏi**, để không thẻ duyệt nào được
 *     vẽ ra từ một chế độ ĐOÁN.
 *
 * ⚠ Bản giả `vscode` ở đây cố ý TỐI THIỂU: chỉ đủ để dựng bảng và bơm tin nhắn webview. Mọi thứ
 *   nặng hơn (`hoi` đi tới mạng, `apBanVa`) đã có lưới riêng — dựng thêm ở đây chỉ đẻ ra một bản
 *   mô phỏng thứ hai để rồi trôi khỏi bản kia.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const may = vi.hoisted(() => ({
  /** Hàm nhận tin nhắn từ webview mà `BangChat` đăng ký. */
  nhanTin: undefined as undefined | ((m: Record<string, unknown>) => void),
  /** Hàm dọn mà `BangChat` đăng ký (dùng để reset trạng thái tĩnh giữa các ca). */
  don: undefined as undefined | (() => void),
  daGui: [] as Array<Record<string, unknown>>,
  cookie: undefined as string | undefined,
  thuMucWorkspace: [] as string[],
}));

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  Uri: { file: (p: string) => ({ fsPath: p, toString: () => `file://${p}` }) },
  window: {
    createWebviewPanel: () => ({
      webview: {
        html: "",
        onDidReceiveMessage: (h: (m: Record<string, unknown>) => void) => {
          may.nhanTin = h;
        },
        postMessage: async (m: Record<string, unknown>) => {
          may.daGui.push(m);
          return true;
        },
      },
      onDidDispose: (h: () => void) => {
        may.don = h;
      },
      reveal: () => undefined,
    }),
    activeTextEditor: undefined,
  },
  workspace: {
    get workspaceFolders() {
      return may.thuMucWorkspace.map((p) => ({ uri: { fsPath: p } }));
    },
    getConfiguration: () => ({ get: <T>(_k: string, mm: T) => mm }),
  },
}));

import { BangChat } from "./bangChat";

/** Kho đề xuất giả — chỉ cần `quen()` để `quenDeXuat` gọi được. */
const khoGia = { quen: () => undefined, moDiff: async () => undefined, moDiffCucBo: async () => undefined };

function moBang(): Record<string, unknown> {
  BangChat.moHoacHien(
    { secrets: { get: async () => may.cookie, delete: async () => undefined } } as never,
    khoGia as never,
  );
  // Instance nằm ở field tĩnh `hienTai` — lưới này cố ý soi TRẠNG THÁI RIÊNG, vì thứ cần đo chính
  // là một mảnh trạng thái riêng bị bỏ sót.
  return (BangChat as unknown as { hienTai: Record<string, unknown> }).hienTai;
}

beforeEach(() => {
  may.don?.();
  may.nhanTin = undefined;
  may.don = undefined;
  may.daGui = [];
  may.cookie = "cookie-gia";
  may.thuMucWorkspace = [];
});

describe("quenDeXuat — xoá trạng thái VÔ ĐIỀU KIỆN (Minor)", () => {
  it("★★★ không còn đề xuất nào nhưng nhãn nguồn của lượt trước vẫn sót ⇒ PHẢI bị xoá", () => {
    const bang = moBang();
    // Trạng thái sót: nhãn (mang chữ "LOCAL ·", tức mang CHẾ ĐỘ) còn, đề xuất thì không.
    bang.nhanNguonHienTai = "LOCAL · C:\\ws";
    expect(bang.deXuatHienTai).toBeUndefined();
    expect(bang.deXuatCucBoHienTai).toBeUndefined();

    // Đổi dự án ⇒ `quenDeXuat`. Bản cũ `return` ngay vì không có `actionId` ⇒ nhãn sống sót.
    may.nhanTin?.({ loai: "doi_du_an", duAnId: "local:C:\\khac" });

    expect(bang.nhanNguonHienTai).toBeUndefined();
  });

  it("★★ không có đề xuất ⇒ KHÔNG bắn tin ẩn thẻ / thông báo (đừng làm ồn cho một việc không xảy ra)", () => {
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "doi_du_an", duAnId: "local:C:\\khac" });
    expect(may.daGui).toEqual([]);
  });
});

describe("hoi — I-5: không xác định được chế độ ⇒ TỪ CHỐI, không đoán", () => {
  it("★★★ danh sách dự án RỖNG (chưa nạp xong) ⇒ báo lỗi và KHÔNG hỏi", async () => {
    /**
     * ★★★ Bản cũ suy ra `{loai:"local", nhan:"workspace"}` từ một danh sách RỖNG rồi chạy tiếp cả
     * lượt hỏi — nghĩa là một lượt trả lời có thể đẻ ra thẻ "Ghi vào workspace" cho một chế độ chưa
     * ai xác định. Ở một cửa ghi đĩa, "không biết" phải dừng lại.
     */
    moBang();
    may.daGui = [];
    may.nhanTin?.({ loai: "hoi", cauHoi: "sửa a.ts giúp tôi" });
    // `hoi` là async (đọc cookie trước) — nhường vài nhịp cho chuỗi promise chạy hết.
    await new Promise((r) => setTimeout(r, 0));

    const loi = may.daGui.filter((m) => m.loai === "loi");
    expect(loi).toHaveLength(1);
    expect(String(loi[0].thongDiep)).toContain("Chưa xác định được dự án");
    // Và không có khung trả lời nào được mở ra.
    expect(may.daGui.some((m) => m.loai === "hoan_tat")).toBe(false);
  });
});
