/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — **CENSUS CHO ĐƯỜNG NẠP LẠI PHIÊN Ở CLIENT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MỘT LƯỚI ĐỌC MÃ NGUỒN, KHÔNG PHẢI MỘT LƯỚI RENDER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba bất biến của mục (C) là **hình dạng của đường đi**, không phải hành vi của một component:
 * *nạp một phiên có xoá thẻ duyệt không* · *có đặt lại vòng tự động không* · *payload gửi lên có
 * mang đường dẫn không*. Trả lời bằng cách đọc mã thì **không thể xanh vì một mock** — và một lưới
 * render CÓ THỂ xanh vì một mock (bài học `aiCodingWorkspaceVong.unit.test.ts`, cùng khuôn).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC (đã chạy — xem báo cáo):
 *   • `chonPhien` bỏ `setPending(null)` / `setPendingDiff(null)`  ⇒ §1 ĐỎ  (ca iv của brief)
 *   • `chonPhien` bỏ đặt lại `VONG_RONG`                          ⇒ §2 ĐỎ
 *   • payload lưu gửi thẳng `transcript` thay vì `locLuot(...)`    ⇒ §3 ĐỎ
 *   • thêm một điểm gọi `confirmM.mutateAsync` thứ hai            ⇒ §4 ĐỎ
 *   • một nhãn phiên thiếu ở en/zh                                ⇒ §5 ĐỎ
 *   • `xoaPhienNay` xoá mà KHÔNG hỏi xác nhận (hoặc hỏi SAU khi đã xoá) ⇒ §6 ĐỎ
 *
 * ★★★ 2026-08-23 — danh sách phiên đã thu thành nút + popover (`@/components/ai/BoChonPhien`);
 * phần HIỂN THỊ có lưới render cây thật riêng (`boChonPhien.unit.test.ts`). File này vẫn canh
 * ĐƯỜNG ĐI ở trang (nạp/lưu/xoá/HITL) — chúng không đổi theo hình dạng UI — và §5 nay quét nhãn
 * trên CẢ HAI tệp, vì các nhãn phiên đã dọn nhà sang tệp thành phần.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANG = join(HERE, "AICodingWorkspace.tsx");
/** Bộ chọn phiên (nút + popover) — nơi các nhãn `repoWs.sessions.*` hiển thị sống từ 2026-08-23. */
const BO_CHON = resolve(HERE, "..", "components", "ai", "BoChonPhien.tsx");
const LOCALES = resolve(HERE, "..", "i18n", "locales");
/**
 * ⚠ CHUẨN HOÁ **CRLF → LF** ngay lúc đọc. Repo này ở Windows và tệp lưu bằng `\r\n`; một phép so
 * nhiều dòng viết bằng `\n` sẽ ĐỎ trong khi mã hoàn toàn đúng — lưới đỏ vì thiết bị đo, đúng lớp
 * lỗi đã ăn nhiều lượt (và đã ăn lượt đầu tiên của chính ca "mọi lượt đổi id đi qua `datSessionId`").
 */
const NGUON = readFileSync(TRANG, "utf8").replace(/\r\n/g, "\n");
const NGUON_BO_CHON = readFileSync(BO_CHON, "utf8").replace(/\r\n/g, "\n");

/** Bỏ comment khối + comment dòng — phép ĐẾM không được tính một lời gọi nằm trong chú thích. */
function boComment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const MA = boComment(NGUON);
const MA_BO_CHON = boComment(NGUON_BO_CHON);

function dem(hay: string, kim: string): number {
  return hay.split(kim).length - 1;
}

/**
 * Thân của một `const <ten> = useCallback(` … cho tới lời gọi đóng ở cùng mức ngoặc.
 * ⚠ Đếm ngoặc **ngoài chuỗi** — một `"("` trong câu chữ tiếng Việt sẽ làm lệch phép đếm và biến
 *   lưới này thành thứ đỏ vì lý do chẳng liên quan.
 */
function thanHam(ten: string): string {
  const mo = MA.indexOf(`const ${ten} = useCallback(`);
  expect(mo, `không tìm thấy \`${ten}\` — nó bị đổi tên hay gỡ bỏ?`).toBeGreaterThanOrEqual(0);
  let d = 0;
  let trongChuoi: string | null = null;
  for (let i = mo; i < MA.length; i++) {
    const c = MA[i];
    if (trongChuoi) {
      if (c === "\\") i++;
      else if (c === trongChuoi) trongChuoi = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { trongChuoi = c; continue; }
    if (c === "(") d++;
    else if (c === ")") {
      d--;
      if (d === 0) return MA.slice(mo, i + 1);
    }
  }
  throw new Error(`không đóng được thân \`${ten}\``);
}

function docLocale(lg: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")) as Record<string, unknown>;
  const ra: Record<string, unknown> = {};
  const di = (o: unknown, tien: string) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const khoa = tien ? `${tien}.${k}` : k;
      if (v && typeof v === "object") di(v, khoa);
      else ra[khoa] = v;
    }
  };
  di(raw, "");
  return ra;
}
const VI = docLocale("vi");
const EN = docLocale("en");
const ZH = docLocale("zh");

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§0 — CẦU CHÌ: lưới có thật sự đọc trúng thứ nó tưởng không", () => {
  it("trang tồn tại, đủ dài, và có đường phiên", () => {
    expect(NGUON.length).toBeGreaterThan(20_000);
    expect(MA).toContain("repoWorkspace.moPhien");
    expect(MA).toContain("repoWorkspace.luuPhien");
    expect(MA).toContain("repoWorkspace.danhSachPhien");
    expect(MA).toContain("repoWorkspace.xoaPhien");
  });

  it("★ 2026-08-23 — trang NỐI đúng bộ chọn phiên mới (nút + popover), không dựng cột thứ hai", () => {
    // Lưới render cây thật của bộ chọn ở `boChonPhien.unit.test.ts`; ở đây chỉ canh DÂY NỐI:
    // trang render `<BoChonPhien` đúng MỘT lần và không còn cột `DanhSachPhienCot` nào.
    expect(dem(MA, "<BoChonPhien")).toBe(1);
    expect(MA).not.toContain("DanhSachPhienCot");
    expect(NGUON_BO_CHON.length).toBeGreaterThan(2_000);
  });

  it("bộ cắt thân hàm hoạt động (chống 'xanh vì thân RỖNG')", () => {
    for (const ten of ["chonPhien", "phienMoi", "luuTranscript"]) {
      expect(thanHam(ten).length, `thân \`${ten}\` quá ngắn — bộ cắt hỏng`).toBeGreaterThan(80);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — NẠP LẠI MỘT PHIÊN **KHÔNG** TÁI PHÁT THẺ DUYỆT HITL", () => {
  const THAN_CHON = thanHam("chonPhien");
  const THAN_MOI = thanHam("phienMoi");

  it("★★★ `chonPhien` XOÁ tường minh thẻ duyệt đang treo", () => {
    expect(THAN_CHON, "nạp phiên mà giữ `pending` ⇒ thẻ duyệt của mạch CŨ đi lạc sang mạch MỚI").toContain("setPending(null)");
    expect(THAN_CHON, "diff xem trước của mạch cũ phải biến mất cùng thẻ").toContain("setPendingDiff(null)");
  });

  it("★★★ `phienMoi` cũng vậy (một trang sạch là SẠCH, không nửa vời)", () => {
    expect(THAN_MOI).toContain("setPending(null)");
    expect(THAN_MOI).toContain("setPendingDiff(null)");
  });

  it("★★★ KHÔNG có đường nào từ kết quả `moPhien` tới `setPending(` — theo cấu tạo", () => {
    // Dữ liệu phiên chỉ có `{role, content}` (server chiếu bằng `locLuot`), nên không có gì để
    // dựng một `KbPendingAction`. Ca này canh chiều còn lại: không ai được viết một đường như thế.
    expect(THAN_CHON.match(/setPending\((?!null\))/g) ?? []).toEqual([]);
    // Và `setPending` chỉ được nhận một `KbPendingAction` từ ĐÚNG một chỗ: callback SSE của lượt
    // đang chạy (`onPendingAction`). Đếm để không ai mở nguồn thứ hai.
    expect(dem(MA, "onPendingAction: (pa) =>")).toBe(1);
  });

  it("★★ `setTranscript` từ phiên nạp về chỉ lấy `role`/`content` — không trải object", () => {
    expect(THAN_CHON).toContain("({ role: x.role, content: x.content })");
    expect(THAN_CHON, "`{...x}` sẽ chở mọi ô lạ của một hàng bị đầu độc vào trạng thái màn hình").not.toContain("...x");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — VÒNG TỰ ĐỘNG KHÔNG SỐNG DẬY TỪ MỘT PHIÊN CŨ", () => {
  it("★★★ `chonPhien` đặt lại vòng về RỖNG (không có 'lượt 2/3' ma)", () => {
    const t = thanHam("chonPhien");
    expect(t).toContain("vongRef.current = { ...VONG_RONG }");
    expect(t).toContain("setVong({ ...VONG_RONG })");
  });

  it("★★ `phienMoi` đặt lại vòng về RỖNG", () => {
    const t = thanHam("phienMoi");
    expect(t).toContain("vongRef.current = { ...VONG_RONG }");
    expect(t).toContain("setVong({ ...VONG_RONG })");
  });

  it("★★ đường nạp phiên KHÔNG chạm bộ chạy kiểm chứng (không tự khởi động một vòng)", () => {
    for (const ten of ["chonPhien", "phienMoi", "luuTranscript"]) {
      const t = thanHam(ten);
      expect(t, `\`${ten}\` không được gọi vòng`).not.toContain("chayLuotVong");
      expect(t, `\`${ten}\` không được chạy lệnh kiểm chứng`).not.toContain("kiemChungM");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — PAYLOAD LƯU: CHIẾU + CHỈ MANG **ID DỰ ÁN**", () => {
  const THAN_LUU = thanHam("luuTranscript");

  it("★★★ mạch được CHIẾU bằng `locLuot` trước khi rời client", () => {
    expect(THAN_LUU, "gửi thẳng `transcript` là gửi cả những ô mà `ChatTurn` mọc thêm ngày mai").toContain("locLuot(turns)");
    expect(THAN_LUU).toContain("turns: sach");
  });

  it("★★★ payload mang `projectId`, KHÔNG mang một đường dẫn nào", () => {
    expect(THAN_LUU).toContain("projectId");
    for (const cam of ["goc", "root", "sandboxRoot", "absPath", "cwd"]) {
      expect(THAN_LUU, `payload lưu phiên không được mang \`${cam}\``).not.toContain(`${cam}:`);
    }
    // `selectedPath`/`codingEditPath` là chuyện của LƯỢT CHAT, không phải của bản lưu trữ.
    expect(THAN_LUU).not.toContain("selectedPath");
    expect(THAN_LUU).not.toContain("codingEditPath");
  });

  it("★ client KHÔNG tự đặt nhãn phiên (nhãn do server suy từ câu hỏi đầu)", () => {
    expect(THAN_LUU, "client gửi `title` ⇒ nhãn thành thứ client tự khai").not.toContain("title:");
  });

  it("★★ đổi DỰ ÁN ⇒ RỜI phiên (phiên bám một gốc suốt đời)", () => {
    expect(thanHam("changeProject")).toContain("datSessionId(null)");
  });

  it("★★★ lượt lưu đọc `sessionIdRef.current`, KHÔNG đọc `sessionId` của bao đóng", () => {
    // Lớp lỗi đã đo: lượt lưu thứ nhất (câu người hỏi) TẠO phiên; lượt thứ hai (câu AI trả lời)
    // dựng bao đóng trước khi state kịp cập nhật ⇒ cũng thấy `null` ⇒ **đẻ phiên thứ hai cho cùng
    // một mạch**. Cùng lớp với `vongRef` (xem docblock của trang).
    expect(THAN_LUU).toContain("sessionIdRef.current");
    expect(THAN_LUU).toContain("sessionId: idHienTai");
    // Và không được có một đường nào đọc thẳng biến state trong thân lưu.
    expect(THAN_LUU.match(/\bsessionId\b(?!Ref)(?!:)/g) ?? []).toEqual([]);
  });

  it("★ mọi lượt đổi id phiên đi qua `datSessionId` (ref TRƯỚC, state SAU)", () => {
    // `setSessionId` chỉ được gọi ở ĐÚNG một chỗ: bên trong `datSessionId`.
    expect(dem(MA, "setSessionId(")).toBe(1);
    expect(MA).toContain("sessionIdRef.current = id;\n    setSessionId(id);");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — HITL: VẪN ĐÚNG **MỘT** ĐIỂM GỌI XÁC NHẬN GHI", () => {
  it("★★★ `confirmM.mutateAsync(` xuất hiện ĐÚNG một lần trong toàn trang", () => {
    // Bất biến này có từ vòng tự động (`aiCodingWorkspaceVong.unit.test.ts` §1); lặp lại ở đây vì
    // danh sách phiên là lần thứ hai một tính năng có thể lén thêm một đường ghi "cho tiện".
    expect(dem(MA, "confirmM.mutateAsync(")).toBe(1);
  });

  it("★★★ không đường nào của phiên gọi xác nhận/huỷ", () => {
    for (const ten of ["chonPhien", "phienMoi", "luuTranscript", "xoaPhienNay"]) {
      const t = thanHam(ten);
      expect(t, `\`${ten}\` không được xác nhận một hành động ghi`).not.toContain("confirmM");
      expect(t).not.toContain("cancelM");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — MỌI NHÃN PHIÊN CÓ ĐỦ BA LOCALE", () => {
  /**
   * Mọi khoá `repoWs.sessions.*` THỰC SỰ được dùng — quét trên CẢ trang LẪN `BoChonPhien.tsx`
   * (2026-08-23: các nhãn hiển thị đã dọn sang tệp thành phần; chỉ quét trang là lượng từ chạy
   * trên tập RỖNG DẦN — đúng lớp "glob rỗng ⇒ lưới im lặng khai xanh" mà cầu chì dưới canh).
   */
  const KHOA = [...new Set(
    [...`${MA}\n${MA_BO_CHON}`.matchAll(/t\(\s*"(repoWs\.sessions\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]!),
  )];

  it("cầu chì: quét ra một tập KHÔNG rỗng (glob rỗng ⇒ lưới im lặng khai xanh)", () => {
    // ≥14: trang giữ 3 nhãn (openFailed/deleteFailed/confirmDelete), bộ chọn giữ phần còn lại
    // (search/noMatch/history/rel.* …). Tụt dưới 14 nghĩa là một NGUỒN quét đã rơi — đỏ để tra.
    expect(KHOA.length).toBeGreaterThanOrEqual(14);
  });

  for (const k of KHOA) {
    it(`\`${k}\` có ở vi + en + zh`, () => {
      expect(typeof VI[k], `thiếu ở vi.json`).toBe("string");
      expect(typeof EN[k], `thiếu ở en.json ⇒ người dùng en đọc tiếng Việt`).toBe("string");
      expect(typeof ZH[k], `thiếu ở zh.json ⇒ người dùng zh đọc tiếng Việt`).toBe("string");
    });
  }

  it("★ nhãn siêu dữ liệu giữ đủ CẢ HAI chỗ nội suy ở cả ba locale", () => {
    for (const [ten, L] of [["vi", VI], ["en", EN], ["zh", ZH]] as const) {
      const s = String(L["repoWs.sessions.meta"] ?? "");
      expect(s, `${ten}: mất {{n}}`).toContain("{{n}}");
      expect(s, `${ten}: mất {{luc}}`).toContain("{{luc}}");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — XOÁ PHIÊN PHẢI HỎI TRƯỚC (2026-08-23)", () => {
  const THAN_XOA = thanHam("xoaPhienNay");

  it("★★★ `xoaPhienNay` gọi `window.confirm` — và hỏi TRƯỚC khi chạm server", () => {
    // Xoá là KHÔNG HOÀN TÁC; một cú trượt chuột trên nút thùng rác không được phép là đủ.
    const viTriHoi = THAN_XOA.indexOf("window.confirm(");
    const viTriXoa = THAN_XOA.indexOf("xoaPhienM.mutateAsync(");
    expect(viTriHoi, "xoá mà không hỏi xác nhận").toBeGreaterThanOrEqual(0);
    expect(viTriXoa).toBeGreaterThanOrEqual(0);
    // THỨ TỰ là một nửa của luật: hỏi SAU khi đã xoá thì câu hỏi là đồ trang trí.
    expect(viTriHoi, "câu hỏi phải đứng TRƯỚC lời gọi xoá").toBeLessThan(viTriXoa);
  });

  it("★ câu hỏi dùng nhãn i18n `confirmDelete`, không phải chuỗi trần", () => {
    expect(THAN_XOA).toContain('"repoWs.sessions.confirmDelete"');
  });

  it("★ bộ chọn phiên KHÔNG tự hỏi/tự xoá — MỘT đường xoá, một chỗ hỏi (ở trang)", () => {
    // Nếu component cũng hỏi thì người dùng bị hỏi HAI lần (hoặc tệ hơn: ai đó gỡ câu hỏi ở trang
    // vì "component đã hỏi rồi" — rồi một ngày component được tái dùng chỗ khác mà không hỏi).
    expect(MA_BO_CHON).not.toContain("window.confirm");
    expect(MA_BO_CHON).not.toContain("mutateAsync");
  });
});
