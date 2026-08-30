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
  /**
   * ★★★ H3 (review 2026-08-30) — HÀNG ĐỢI các "lượt gọi SSE" kế tiếp, mỗi phần tử là một hàm nhận
   * `dv` (đúng tham số `moDongSse` thật) và trả `{hong}` sau khi bắn token/done qua `dv.nhan`. Rỗng
   * ⇒ rơi về hành vi TREO mặc định (giữ nguyên cho hai nhóm ca cũ bên dưới, không đổi hành vi của
   * chúng). Cho phép lưới H3 mô phỏng NHIỀU vòng (model xin đọc ở vòng 1, trả lời ở vòng 2) mà
   * không cần một stream thật.
   */
  hangDoiSse: [] as Array<
    (dv: { nhan: (sk: Record<string, unknown>) => void; tinHieu?: AbortSignal }) => Promise<{ hong: string[] }>
  >,
  /** ★★★ H3 — thân POST (`dungYeuCauStream(...)`) của TỪNG lượt gọi SSE, theo đúng thứ tự vòng. */
  thanGoi: [] as Array<Record<string, unknown>>,
}));

/**
 * ★★★ TASK 6/D.1 (LỖI 3) — mô phỏng ĐÚNG hành vi `fetch`/undici thật đo được ở Task 6: huỷ GIỮA
 * LÚC ĐANG ĐỌC THÂN SSE khiến promise reject bằng CHÍNH `signal.reason` — khi `dungVongHienTai()`
 * gọi `abort(lyDo)` với một LÝ DO TUỲ CHỈNH (chuỗi), `reason` đó LÀ MỘT CHUỖI TRẦN, không phải
 * `Error`/`AbortError`. Promise KHÔNG BAO GIỜ tự resolve — treo y hệt một luồng SSE thật đang bay,
 * chỉ thoát khi tín hiệu huỷ bắn (đúng thời điểm đang "ĐỌC THÂN", không phải TRƯỚC KHI CÓ RESPONSE
 * như kịch bản Task 4 đã đo). ★★★ H3 — `may.hangDoiSse` cho phép GHI ĐÈ hành vi này cho MỘT vài
 * lượt gọi kế tiếp (dùng cho lưới nhiều vòng); rỗng thì vẫn treo y hệt bản cũ.
 */
vi.mock("../mang/dongSse", () => ({
  moDongSse: (dv: { than: Record<string, unknown>; tinHieu?: AbortSignal; nhan: (sk: Record<string, unknown>) => void }) => {
    may.thanGoi.push(dv.than);
    const ke = may.hangDoiSse.shift();
    if (ke) return ke(dv);
    return new Promise((_resolve, reject) => {
      dv.tinHieu?.addEventListener("abort", () => reject(dv.tinHieu!.reason), { once: true });
    });
  },
}));

/**
 * ★★★ H3(a) — lưới cho vòng ≥2 cần `chayToolCucBo` trả lời NGAY (không chạm `vscode`/đĩa thật, mà
 * bản giả `vscode` ở đầu tệp này cố ý TỐI THIỂU không có `workspace.findFiles`). Kết quả ở đây
 * không mang bí mật nào — chỉ cần đủ để vòng lặp tác nhân đi tiếp sang vòng kế.
 */
vi.mock("../mang/toolCucBo", () => ({
  chayToolCucBo: async () => ({ ok: true, ketQua: "--- TỆP a.ts ---\nnội dung tệp giả" }),
  danhSachTepGoiY: async () => [],
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
import { dungVanBanDayGiaoThucDoc, nhacLaiCuoiCauHoi } from "../loi/dayGiaoThucDoc";

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
  may.hangDoiSse = [];
  may.thanGoi = [];
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

describe("hoi — H3(a) (review toàn nhánh 2026-08-30): vòng ≥2 KHÔNG được vứt câu hỏi GỐC", () => {
  it("★★★ vòng 2 vẫn chứa NGUYÊN VĂN câu hỏi gốc — không chỉ mỗi 'KẾT QUẢ TOOL'", async () => {
    /**
     * ★★★ Bản cũ: `cauHoiVong = "KẾT QUẢ TOOL:\n..."` THAY HẲN câu hỏi gốc. Vòng 1 model xin đọc
     * `doc_tep` (khối ```avi-tool```); vòng 2 phải hỏi lại model ĐÚNG câu hỏi gốc kèm kết quả đọc —
     * mất câu hỏi gốc ở đây là mất luôn thứ máy chủ dùng để truy hồi RAG VÀ (với Cmd+K) mất luôn
     * chỉ dẫn `de_xuat_sua_doan`.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      // Vòng 1 — model xin đọc một tệp.
      async (dv) => {
        dv.nhan({
          type: "token",
          token: '```avi-tool\n{"tool":"doc_tep","args":{"path":"a.ts"}}\n```',
        });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      // Vòng 2 — trả lời bình thường, KHÔNG xin đọc thêm ⇒ vòng lặp dừng ở đây.
      async (dv) => {
        dv.nhan({ type: "token", token: "Đây là câu trả lời cuối cùng." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    const cauHoiGoc = "Hàm Divide trong Calculator.cs sai chỗ nào?";
    may.nhanTin?.({ loai: "hoi", cauHoi: cauHoiGoc });
    // Nhường đủ nhịp cho CẢ HAI vòng (đọc cookie, gọi SSE vòng 1, chạy tool, gọi SSE vòng 2).
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length, `phải có đúng 2 lượt gọi SSE; thực tế: ${may.thanGoi.length}`).toBe(2);
    const qVong2 = String(may.thanGoi[1].question);
    expect(qVong2, `question vòng 2: ${qVong2}`).toContain(cauHoiGoc);
    expect(qVong2).toContain("KẾT QUẢ TOOL");
  });
});

describe("hoi — H3(b) (review toàn nhánh 2026-08-30): Cmd+K KHÔNG được dạy giao thức ĐỌC", () => {
  /**
   * Giao thức dạy-đọc (`dungVanBanDayGiaoThucDoc`/`nhacLaiCuoiCauHoi`) cạnh tranh với giao thức
   * riêng của Cmd+K (đòi ĐÚNG MỘT khối `de_xuat_sua_doan`). Trước bản vá, D.1 chèn giao thức dạy-đọc
   * vào MỌI câu hỏi LOCAL — kể cả câu hỏi webview đánh dấu `tuLenh:true` (đến từ `dat_cau_hoi_tu_lenh`
   * / Cmd+K, xem `htmlBang.ts`).
   */
  it("★★★ `tuLenh:true` ⇒ question KHÔNG chứa văn bản dạy giao thức đọc", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Đã hiểu, không cần đọc thêm." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Sửa đoạn mã sau...", tuLenh: true });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi).toHaveLength(1);
    const q = String(may.thanGoi[0].question);
    expect(q).not.toContain(dungVanBanDayGiaoThucDoc());
    expect(q).not.toContain(nhacLaiCuoiCauHoi());
  });

  it("★★ NHÁNH KIA: câu hỏi THƯỜNG (không `tuLenh`) ⇒ vẫn được dạy giao thức đọc như cũ", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Trả lời bình thường." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm Divide sai chỗ nào?" });
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi).toHaveLength(1);
    const q = String(may.thanGoi[0].question);
    expect(q).toContain(dungVanBanDayGiaoThucDoc());
    expect(q).toContain(nhacLaiCuoiCauHoi());
  });
});

/**
 * ★★★ PDCA vòng 2 (Đợt D) — T09 (`pdca1-report.md`): hết trần vòng đọc GIỮA LÚC câu trả lời cuối
 * còn một khối ```avi-tool``` chưa thực thi ⇒ trước bản vá, `hoan_tat.vanBanCuoi` là `null` nên
 * webview GIỮ NGUYÊN chữ đã stream thô (bao gồm khối JSON nội bộ) làm nội dung bong bóng cuối cùng
 * — người dùng thấy JSON thô. Ba ca dưới đây đo ĐÚNG ba nhánh: có khối dở dang (phải đổi), không có
 * khối dở dang (giữ nguyên — "đừng thêm cảnh báo thừa"), và NHÁNH KIA `nguoi_dung_dung` (không được
 * đổi dù văn bản CŨNG có khối dở dang — chỉ `het_tran` mới được phép đổi trình bày).
 */
describe("hoi — PDCA vòng 2: chỉ het_tran + khối avi-tool dở dang mới thay vanBanCuoi", () => {
  const KHOI_DOC = (path: string) => '```avi-tool\n{"tool":"doc_tep","args":{"path":"' + path + '"}}\n```';

  it("★★★ het_tran (vong 3/3) VÀ câu trả lời cuối còn khối avi-tool ⇒ vanBanCuoi là câu tiếng Việt, KHÔNG PHẢI JSON thô/null", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    // Cả BA vòng đều xin đọc thêm ⇒ chạm trần TRAN_VONG_MAC_DINH=3 trong khi câu trả lời vòng 3
    // VẪN còn một khối chưa thực thi (đúng hình dạng T09 đo được).
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Để trả lời, tôi cần đọc:\n" + KHOI_DOC("a.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc thêm:\n" + KHOI_DOC("b.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Vẫn cần đọc thêm:\n" + KHOI_DOC("c.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhLoiNhuanRongSauThue ở đâu?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length, `phải dừng ĐÚNG sau 3 lượt SSE (trần); thực tế: ${may.thanGoi.length}`).toBe(3);

    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    const vanBanCuoi = hoanTat[0].vanBanCuoi;
    expect(vanBanCuoi, "vanBanCuoi KHÔNG được là null khi còn khối dở dang").not.toBeNull();
    const vb = String(vanBanCuoi);
    // Không lộ hàng rào/JSON của giao thức nội bộ ra bong bóng chat.
    expect(vb).not.toContain("```");
    expect(vb).not.toContain("avi-tool");
    expect(vb).not.toContain('"tool":"doc_tep"');
    // Câu tiếng Việt phải nói rõ: chạm trần (kèm số vòng), chưa hoàn tất, có thể hỏi lại.
    expect(vb).toContain("3/3");
    expect(vb).toMatch(/chưa hoàn tất/i);
    expect(vb).toMatch(/hỏi lại/i);
  });

  it("★★ NHÁNH KIA — het_tran (vong 3/3) nhưng câu trả lời cuối KHÔNG còn khối dở dang ⇒ vanBanCuoi giữ NGUYÊN null (không thêm cảnh báo thừa)", async () => {
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    // Hai vòng đầu xin đọc; vòng 3 (đúng lúc chạm trần) trả lời XONG XUÔI, không xin đọc thêm —
    // `buocKeTiep` vẫn trả het_tran (vong>=tran được kiểm TRƯỚC coYeuCauDoc, xem vongTacNhan.ts)
    // nhưng KHÔNG có khối nào sót lại trong `traLoiCuoi`.
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc:\n" + KHOI_DOC("a.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc thêm:\n" + KHOI_DOC("b.ts") });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
      async (dv) => {
        dv.nhan({ type: "token", token: "Đây là câu trả lời cuối cùng, xong xuôi." });
        dv.nhan({ type: "done" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhTonKhoConLai làm gì?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    expect(may.thanGoi.length).toBe(3);
    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    expect(hoanTat[0].vanBanCuoi).toBeNull();
  });

  it("★★★ NHÁNH KIA — dừng vì nguoi_dung_dung GIỮA hai vòng dù văn bản CŨNG còn khối dở dang ⇒ vanBanCuoi KHÔNG bị đổi", async () => {
    /**
     * Người dùng bấm Dừng ngay khi vòng 1 vừa xong (trước khi vòng 2 kịp gọi) — `buocKeTiep` đọc
     * `biHuy=true` và trả `nguoi_dung_dung`, THẮNG trước cả het_tran/khong_con_tool (thứ tự ưu
     * tiên của `vongTacNhan.ts`). Dù câu trả lời vòng 1 CŨNG mang một khối avi-tool dở dang y hệt
     * ca het_tran ở trên, nhánh này KHÔNG được phép đổi `vanBanCuoi` — chỉ `het_tran` mới được.
     */
    const bang = moBang();
    bang.dsDuAn = [{ id: "local:C:\\ws", nhan: "LOCAL · C:\\ws", loai: "local" }];
    bang.duAnChon = "local:C:\\ws";
    may.daGui = [];
    may.hangDoiSse = [
      async (dv) => {
        dv.nhan({ type: "token", token: "Cần đọc:\n" + KHOI_DOC("a.ts") });
        dv.nhan({ type: "done" });
        // Mô phỏng người dùng bấm nút Dừng NGAY khi vòng 1 vừa đóng (đồng bộ, TRƯỚC khi vòng lặp
        // kịp gọi buocKeTiep) — dungVongHienTai() là hàm ĐỒNG BỘ (chỉ gọi AbortController.abort).
        may.nhanTin?.({ loai: "dung_hoi" });
        return { hong: [] };
      },
    ];

    may.nhanTin?.({ loai: "hoi", cauHoi: "Hàm tinhTonKhoConLai làm gì?" });
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));

    // Chỉ MỘT lượt SSE — vòng 2 không bao giờ được gọi vì đã dừng theo yêu cầu người dùng ngay sau
    // vòng 1.
    expect(may.thanGoi.length, `chỉ được 1 lượt SSE (dừng ngay sau vòng 1); thực tế: ${may.thanGoi.length}`).toBe(1);

    const thongBao = may.daGui.filter((m) => m.loai === "thong_bao");
    expect(thongBao.some((m) => String(m.thongDiep).includes("Đã dừng"))).toBe(true);

    const hoanTat = may.daGui.filter((m) => m.loai === "hoan_tat");
    expect(hoanTat).toHaveLength(1);
    // Hành vi CŨ (trước PDCA vòng 2): het_tran vẫn null. `nguoi_dung_dung` KHÔNG được chạm tới
    // logic mới — vanBanCuoi phải giữ NGUYÊN null dù văn bản vòng 1 CŨNG mang khối dở dang.
    expect(hoanTat[0].vanBanCuoi).toBeNull();
  });
});
