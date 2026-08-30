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

/**
 * ★★★ TASK 6/D.1 (LỖI 3) — mô phỏng ĐÚNG hành vi `fetch`/undici thật đo được ở Task 6: huỷ GIỮA
 * LÚC ĐANG ĐỌC THÂN SSE khiến promise reject bằng CHÍNH `signal.reason` — khi `dungVongHienTai()`
 * gọi `abort(lyDo)` với một LÝ DO TUỲ CHỈNH (chuỗi), `reason` đó LÀ MỘT CHUỖI TRẦN, không phải
 * `Error`/`AbortError`. Promise KHÔNG BAO GIỜ tự resolve — treo y hệt một luồng SSE thật đang bay,
 * chỉ thoát khi tín hiệu huỷ bắn (đúng thời điểm đang "ĐỌC THÂN", không phải TRƯỚC KHI CÓ RESPONSE
 * như kịch bản Task 4 đã đo).
 */
vi.mock("../mang/dongSse", () => ({
  moDongSse: (dv: { tinHieu?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      dv.tinHieu?.addEventListener("abort", () => reject(dv.tinHieu!.reason), { once: true });
    }),
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

describe("hoi — TASK 6/D.1 (LỖI 3): nút Dừng phải khai 'đã dừng', KHÔNG PHẢI 'lỗi rỗng'", () => {
  it("★★★ huỷ GIỮA LÚC ĐANG ĐỌC THÂN SSE (reject bằng CHUỖI TRẦN, không phải AbortError) ⇒ báo 'đã dừng', KHÔNG báo lỗi", async () => {
    /**
     * ★★★ Đo Task 6 (`t6-chan-doan-dung.json`): bấm Dừng trong lúc `moDongSse` ĐANG đọc thân SSE
     * khiến undici reject bằng `signal.reason` — MỘT CHUỖI TRẦN (`"nguoi_dung_dung"`), không phải
     * `Error`. Bản cũ kiểm `(e as Error).name === "AbortError"` ⇒ luôn `undefined` trên một chuỗi
     * ⇒ rơi xuống nhánh lỗi chung với `thongDiep: undefined` — bong bóng "Lỗi" HIỆN RỖNG cho một
     * lượt người dùng CHỦ Ý dừng. Ca này tái hiện ĐÚNG hình dạng đó (mock ở đầu tệp).
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];

    may.nhanTin?.({ loai: "hoi", cauHoi: "đọc giúp tôi tệp a.ts" });
    // Nhường nhịp cho `hoi()` chạy qua `await` đọc cookie rồi tới `await moDongSse(...)` (mocked ở
    // đầu tệp — ĐANG TREO chờ tín hiệu huỷ, đúng mô phỏng "đang đọc thân SSE").
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Bấm Dừng — CHÍNH `dungVongHienTai()` gọi `abort(LY_DO_NGUOI_DUNG_DUNG)`, đồng bộ khiến
    // listener trong mock `reject(signal.reason)` với ĐÚNG chuỗi đó.
    may.nhanTin?.({ loai: "dung_hoi" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const loi = may.daGui.filter((m) => m.loai === "loi");
    expect(loi, `KHÔNG được có bong bóng lỗi cho một lượt DỪNG có chủ ý; thực tế: ${JSON.stringify(may.daGui)}`).toEqual(
      [],
    );

    const thongBao = may.daGui.filter((m) => m.loai === "thong_bao");
    expect(thongBao.some((m) => String(m.thongDiep).includes("Đã dừng"))).toBe(true);
    // `hoan_tat` PHẢI tới để webview ẩn nút Dừng — không tín hiệu nào khác làm việc đó.
    expect(may.daGui.some((m) => m.loai === "hoan_tat")).toBe(true);
  });

  it("★★ huỷ NGẦM (câu hỏi MỚI đè lên câu cũ, KHÔNG kèm lý do) ⇒ vẫn im lặng — NHÁNH KIA không bị vá nhầm", () => {
    /**
     * ★★★ KIỂM NHÁNH KIA của bản vá LỖI 3: nguồn sự thật đổi từ "hình dạng của `e`" sang
     * "`dieuKhien.signal.aborted`" — phải xác nhận nhánh HUỶ NGẦM (một câu hỏi mới tự `abort()`
     * KHÔNG kèm lý do, xem đầu `hoi()`) vẫn im lặng như hành vi cũ, KHÔNG bỗng dưng hiện "đã dừng"
     * cho một lượt người dùng không hề bấm Dừng.
     *
     * ⚠ Ca này KHÔNG cần đợi bất kỳ điều gì huỷ giữa lúc SSE đang treo — `hoi()` tự `abort()` NGAY
     *   ĐẦU của chính nó cho `this.huy` (bộ điều khiển của lượt TRƯỚC, nếu có). Gọi `hoi()` hai lần
     *   liên tiếp mà không đợi lần đầu xong là đủ để kích hoạt đúng nhánh này — synchronous, không
     *   cần mock SSE treo.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];

    may.nhanTin?.({ loai: "hoi", cauHoi: "câu đầu tiên" });
    // Câu hỏi THỨ HAI đè lên ngay lập tức — `this.huy?.abort()` (không lý do) huỷ bộ điều khiển của
    // câu đầu TRƯỚC khi nó kịp nhận được response nào.
    may.nhanTin?.({ loai: "hoi", cauHoi: "câu thứ hai" });

    // KHÔNG assert bất đồng bộ ở đây: ca này chỉ cần xác nhận KHÔNG có bong bóng "đã dừng"/"lỗi"
    // lạc vào giữa — hai điều đó chỉ có thể tới từ nhánh bị huỷ NGẦM nếu bản vá sai hướng.
    expect(may.daGui.filter((m) => m.loai === "loi")).toEqual([]);
    expect(may.daGui.filter((m) => m.loai === "thong_bao" && String(m.thongDiep).includes("Đã dừng"))).toEqual([]);
  });
});
