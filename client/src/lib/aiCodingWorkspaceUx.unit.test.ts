/**
 * ★★★ doc 81 · VIỆC 3 — LƯỚI CHO BA CHỖ CHẶN DÙNG HẰNG NGÀY CỦA `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA THỨ ĐANG THIẾU, ĐO ĐƯỢC TRƯỚC LƯỢT NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1 Ô nhập là `<Input>` (một `<input>` THẬT) ⇒ **không dán được stack trace nhiều dòng**.
 *   §2 `<Markdown>` trần ⇒ mã không tô cú pháp, không nút chép.
 *   §3 `grep ai-coding-workspace client/src/lib/navigation.tsx` = **0** ⇒ phải gõ URL bằng tay.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO §2/§3 LÀ LƯỚI TRÊN MÃ NGUỒN, KHÔNG PHẢI LƯỚI RENDER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `AICodingWorkspace` kéo theo tRPC + auth + i18n + Shiki; dựng nó trong jsdom là một bộ máy mock
 * lớn hơn cả thứ được đo, và nó xanh/đỏ vì hàng chục lý do KHÁC. Vị từ ở đây là mệnh đề TĨNH
 * ("trang này KHÔNG còn dùng `<Input>` cho ô chat", "mục menu ghim đúng bit quyền"), nên đọc mã
 * nguồn là phép đo ĐÚNG TRỤC. §1 thì đo hàm THUẦN — thứ thật sự cưỡng chế Shift+Enter.
 *
 * ⚠ CRLF: tệp nguồn trên máy này lưu `\r\n`. Mọi phép so chuỗi phải chuẩn hoá NGAY LÚC ĐỌC — sửa ở
 *   thiết bị đo, không ở vật được đo (bài học đã ghi ở doc 79).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { phanQuyetPhimNhap, phanGiaiPhimTatKhung, TRAN_CAO_O_NHAP_PX } from "./aiCodingInput";

function doc(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}
const TRANG = "client/src/pages/AICodingWorkspace.tsx";
const NAV = "client/src/lib/navigation.tsx";

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — Ô NHẬP NHIỀU DÒNG: Enter gửi, Shift+Enter XUỐNG DÒNG", () => {
  it("★★★ Enter trần ⇒ GỬI", () => {
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: false })).toBe("gui");
  });

  /**
   * ★★★ BẤT BIẾN SỐ MỘT CỦA VIỆC 3(1). Một đột biến đổi `e.shiftKey` thành `!e.shiftKey` (hoặc bỏ
   * hẳn nhánh) làm Shift+Enter GỬI — tức người dán stack trace nhiều dòng vừa gửi đi dòng đầu tiên.
   */
  it("★★★ Shift+Enter ⇒ XUỐNG DÒNG, KHÔNG gửi", () => {
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: true })).toBe("xuong_dong");
  });

  /**
   * ★★★ ĐỢT 3 UX — ĐẢO chính sách modifier: Ctrl/Cmd+Enter nay ⇒ GỬI (quy ước "gửi cưỡng bức" Slack/
   * GitHub, khớp Enter=gửi); CHỈ Shift/Alt+Enter còn XUỐNG DÒNG. Một đột biến đổi `altKey`→`ctrlKey` ở
   * nhánh xuống-dòng biến Ctrl+Enter thành xuống-dòng, phá phím tắt gửi — ba dòng đầu bắt đúng chỗ đó.
   */
  it("★★★ Ctrl/Cmd + Enter ⇒ GỬI; Alt+Enter ⇒ XUỐNG DÒNG", () => {
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: false, ctrlKey: true })).toBe("gui");
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: false, metaKey: true })).toBe("gui");
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: false, altKey: true })).toBe("xuong_dong");
    // IME vẫn thắng mọi modifier (đang chốt từ — không được gửi dù có Ctrl).
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: false, ctrlKey: true, isComposing: true })).toBe("bo_qua");
  });

  /**
   * ★★★ Bộ gõ tiếng Việt/Trung phát Enter để CHỐT một từ đang gõ. Gửi ở nhịp ấy là cắt câu người
   * dùng làm đôi. Giao diện này chạy ba locale, hai trong đó dùng bộ gõ có trạng thái.
   */
  it("★★★ Enter trong lúc ĐANG GÕ (IME composing) ⇒ BỎ QUA, không gửi", () => {
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: false, isComposing: true })).toBe("bo_qua");
    expect(phanQuyetPhimNhap({ key: "Enter", shiftKey: true, isComposing: true })).toBe("bo_qua");
  });

  it("★ phím khác ⇒ BỎ QUA (không nuốt phím của người dùng)", () => {
    for (const k of ["a", "Escape", "Tab", "ArrowUp", " "]) {
      expect(phanQuyetPhimNhap({ key: k, shiftKey: false }), k).toBe("bo_qua");
      expect(phanQuyetPhimNhap({ key: k, shiftKey: true }), k).toBe("bo_qua");
    }
  });

  it("★★★ CENSUS: ô chat là `<textarea>`, và `<Input>` KHÔNG còn được dùng trong trang", () => {
    const src = doc(TRANG);
    expect(src, "ô nhập phải là textarea — `<input>` không giữ được xuống dòng").toContain("<textarea");
    expect(/<Input[\s/>]/.test(src), "còn một `<Input>` nào trong trang = còn một ô một-dòng").toBe(false);
    expect(/from "@\/components\/ui\/input"/.test(src)).toBe(false);
  });

  it("★★ CENSUS: `onKeyDown` của ô chat đi qua `phanQuyetPhimNhap` (không có bản so phím thứ hai)", () => {
    const src = doc(TRANG);
    expect(src).toContain("phanQuyetPhimNhap({");
    // Không được còn một phép so phím viết thẳng trong JSX — đó là bản sao thứ hai của chính sách,
    // và nó nằm NGOÀI tầm mọi ca ở trên.
    expect(/e\.key === "Enter" && !e\.shiftKey/.test(src)).toBe(false);
  });

  it("★ trần chiều cao có thật và hợp lý (ô nhập không nuốt cả khung hội thoại)", () => {
    expect(TRAN_CAO_O_NHAP_PX).toBeGreaterThan(60);
    expect(TRAN_CAO_O_NHAP_PX).toBeLessThan(400);
    expect(doc(TRANG)).toContain("tuGianChieuCao");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§phím-tắt — PHÍM TẮT TOÀN KHUNG (Đợt 3 UX)", () => {
  const P = phanGiaiPhimTatKhung;

  it("★★★ Ctrl/Cmd + ` ⇒ bật/tắt Terminal (kể cả đang trong ô nhập); thiếu modifier ⇒ để yên", () => {
    expect(P({ key: "`", ctrlKey: true, trongONhap: false, dangStream: false })).toBe("terminal");
    expect(P({ key: "`", metaKey: true, trongONhap: true, dangStream: false })).toBe("terminal");
    expect(P({ key: "`", trongONhap: false, dangStream: false })).toBe("bo_qua");
  });

  it("★★★ Ctrl/Cmd + P ⇒ mở nhanh (nhảy ô lọc cây); hoa/thường đều nhận; thiếu modifier ⇒ để yên", () => {
    expect(P({ key: "p", ctrlKey: true, trongONhap: false, dangStream: false })).toBe("mo_nhanh");
    expect(P({ key: "P", metaKey: true, trongONhap: true, dangStream: false })).toBe("mo_nhanh");
    expect(P({ key: "p", trongONhap: false, dangStream: false })).toBe("bo_qua");
  });

  it("★★★ Ctrl/Cmd + F ⇒ tìm-trong-tệp (hoa/thường, kể cả đang gõ); thiếu modifier ⇒ để yên", () => {
    expect(P({ key: "f", ctrlKey: true, trongONhap: false, dangStream: false })).toBe("tim_trong_tep");
    expect(P({ key: "F", metaKey: true, trongONhap: true, dangStream: false })).toBe("tim_trong_tep");
    expect(P({ key: "f", trongONhap: false, dangStream: false })).toBe("bo_qua");
  });

  /** ★★★ Gửi ĐÔI là cái bẫy: trong ô chat, `onKeyDown` của nó (qua `phanQuyetPhimNhap`) đã gửi rồi. */
  it("★★★ Ctrl/Cmd + Enter ⇒ GỬI CHỈ khi NGOÀI ô nhập; Enter trần ngoài ô nhập ⇒ để yên", () => {
    expect(P({ key: "Enter", ctrlKey: true, trongONhap: false, dangStream: false })).toBe("gui");
    expect(P({ key: "Enter", metaKey: true, trongONhap: false, dangStream: false })).toBe("gui");
    expect(P({ key: "Enter", ctrlKey: true, trongONhap: true, dangStream: false })).toBe("bo_qua");
    expect(P({ key: "Enter", trongONhap: false, dangStream: false })).toBe("bo_qua");
  });

  it("★★★ Esc ⇒ dừng stream CHỈ khi NGOÀI ô nhập VÀ đang stream (ô nhập tự lo Esc @-mention/lọc-cây)", () => {
    expect(P({ key: "Escape", trongONhap: false, dangStream: true })).toBe("dung_stream");
    expect(P({ key: "Escape", trongONhap: false, dangStream: false })).toBe("bo_qua");
    expect(P({ key: "Escape", trongONhap: true, dangStream: true })).toBe("bo_qua");
  });

  it("★ phím thường / không modifier ⇒ BỎ QUA (không nuốt phím gõ)", () => {
    for (const k of ["a", "x", "1", "ArrowDown", " ", "Enter", "p", "f", "`"]) {
      expect(P({ key: k, trongONhap: true, dangStream: false }), k).toBe("bo_qua");
    }
  });

  it("★★ CENSUS: trang nghe keydown cấp document QUA `phanGiaiPhimTatKhung` (một nguồn chính sách)", () => {
    const src = doc(TRANG);
    expect(src).toContain("phanGiaiPhimTatKhung({");
    expect(src).toContain('addEventListener("keydown"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — MÃ TÔ CÚ PHÁP + NÚT CHÉP, KHÔNG CÀI GÓI MỚI", () => {
  it("★★★ trang dùng `Streamdown` (Shiki + nút chép sẵn có), KHÔNG còn `react-markdown` trần", () => {
    const src = doc(TRANG);
    expect(src).toContain('from "streamdown"');
    expect(/from "react-markdown"/.test(src), "`<Markdown>` trần = không tô cú pháp, không nút chép").toBe(false);
    expect(/<Markdown[\s>]/.test(src)).toBe(false);
    expect(src).toContain("<Streamdown");
  });

  /**
   * ★★★ KHÔNG CÀI GÓI MỚI — và ca này phải đo `package.json`, KHÔNG đo `node_modules`.
   * `shiki`/`rehype-raw`/`remark-gfm` CÓ trong `node_modules` nhưng chỉ là dependency BẮC CẦU của
   * `streamdown`. Nhập thẳng chúng là "phantom dependency": chạy hôm nay, vỡ ở lượt nâng cấp sau
   * mà không ai đổi một dòng mã nào.
   */
  it("★★★ `streamdown` là dependency TRỰC TIẾP; KHÔNG thêm `rehype-highlight`/`lowlight`/`shiki` vào package.json", () => {
    const pkg = JSON.parse(doc("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tatCa = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(tatCa.streamdown, "streamdown phải là dep TRỰC TIẾP thì mới được nhập thẳng").toBeDefined();
    for (const cam of ["rehype-highlight", "lowlight", "shiki", "react-syntax-highlighter", "prismjs"]) {
      expect(tatCa[cam], `${cam} KHÔNG được thêm — brief cấm cài gói mới`).toBeUndefined();
    }
  });

  it("★★ `Streamdown` đã được dùng ở nơi khác trong repo ⇒ lựa chọn ĐÃ CHẠY THẬT, không phải cược", () => {
    expect(doc("client/src/components/AIChatBox.tsx")).toContain('from "streamdown"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — MỤC MENU: có mặt, và tôn trọng CẢ `ai_repo_read` LẪN `MOD_AI`", () => {
  it("★★★ `/ai-coding-workspace` CÓ trong nhóm điều hướng (trước lượt này grep = 0)", () => {
    expect(doc(NAV), "không có mục menu ⇒ kỹ sư phải gõ URL bằng tay").toContain('href: "/ai-coding-workspace"');
  });

  /**
   * ★★★ CỔNG RBAC. `isItemAccessible` chỉ đọc `requiredPermission`; `permissionCategory` **không**
   * có tác dụng ở cấp item (ghi chú m-2 ở `/ai-brain`). Nên bit phải nằm ĐÚNG ở ô này, và phải
   * KHỚP bit mà `App.tsx` ghim cho tuyến — hai chỗ lệch nhau nghĩa là menu hiện một mục dẫn thẳng
   * tới một tường từ chối.
   */
  it("★★★ mục menu ghim `ai_repo_read`, KHỚP `requirePermission` của tuyến trong App.tsx", () => {
    const nav = doc(NAV);
    const i = nav.indexOf('href: "/ai-coding-workspace"');
    expect(i).toBeGreaterThan(-1);
    const khoi = nav.slice(i, i + 400);
    expect(khoi, "thiếu bit ⇒ mọi tài khoản đăng nhập đều thấy mục này").toContain('requiredPermission: "ai_repo_read"');

    const dong = doc("client/src/App.tsx").split("\n").find((l) => l.includes('path="/ai-coding-workspace"'));
    expect(dong).toBeDefined();
    expect(dong!, "bit ở menu phải KHỚP bit ở tuyến").toContain('requirePermission="ai_repo_read"');
  });

  /**
   * ★★★ CỔNG GIẤY PHÉP — cưỡng chế theo CẤU TẠO, và ca này đo đúng dây chuyền đó:
   *   `DashboardLayout` lọc `items.filter(item => isLicenseRouteAllowed(item.href))`
   *   → `isRouteAllowed` tra `module-registry`
   *   → `/ai-coding-workspace` nằm trong `MOD_AI`.
   * Gỡ tuyến khỏi `MOD_AI` (hoặc gỡ dòng lọc) ⇒ ca này ĐỎ ⇒ khách không mua AI sẽ thấy mục này.
   */
  it("★★★ khách KHÔNG mua AI không thấy mục: tuyến thuộc MOD_AI và nav LỌC theo giấy phép", () => {
    const reg = doc("shared/module-registry.ts");
    const iAi = reg.indexOf('code: "MOD_AI"');
    expect(iAi, "MOD_AI phải tồn tại trong sổ module").toBeGreaterThan(-1);
    // Cắt tới module KẾ TIẾP để không nhận nhầm một tuyến khai ở module khác.
    const sauAi = reg.slice(iAi);
    const iSau = sauAi.indexOf('code: "MOD_', 10);
    const khoiAi = iSau > -1 ? sauAi.slice(0, iSau) : sauAi;
    expect(khoiAi, "tuyến không thuộc MOD_AI ⇒ cổng giấy phép MÙ với nó").toContain('"/ai-coding-workspace"');

    // Tuyến vẫn giữ `requireModule="MOD_AI"` ở App.tsx (hai cổng, cùng MỘT nguồn sự thật).
    const dong = doc("client/src/App.tsx").split("\n").find((l) => l.includes('path="/ai-coding-workspace"'));
    expect(dong!).toContain('requireModule="MOD_AI"');

    // Dây chuyền lọc ở thanh bên phải còn nguyên — gỡ dòng này thì mọi lập luận trên vô nghĩa.
    expect(doc("client/src/components/DashboardLayout.tsx")).toContain(
      "items.filter(item => isLicenseRouteAllowed(item.href))",
    );
  });

  it("★★ mục nằm TRONG nhóm `ai` (nhóm này còn bị lọc giấy phép ở CẤP NHÓM qua `isNavGroupAllowed`)", () => {
    const nav = doc(NAV);
    const iNhomAi = nav.indexOf('id: "ai",');
    const iMuc = nav.indexOf('href: "/ai-coding-workspace"');
    expect(iNhomAi).toBeGreaterThan(-1);
    expect(iMuc).toBeGreaterThan(iNhomAi);
    const iNhomSau = nav.indexOf('id: "admin"', iNhomAi);
    if (iNhomSau > -1) expect(iMuc).toBeLessThan(iNhomSau);
  });

  it("★★ nhãn + mô tả có ĐỦ ba locale (vi/en/zh) — không ghim một ngôn ngữ vào menu", () => {
    for (const loc of ["vi", "en", "zh"]) {
      const j = JSON.parse(doc(`client/src/i18n/locales/${loc}.json`)) as { nav?: Record<string, string> };
      expect(j.nav?.aiCodingWorkspace, `${loc}: thiếu nav.aiCodingWorkspace`).toBeTruthy();
      expect(j.nav?.aiCodingWorkspaceDesc, `${loc}: thiếu nav.aiCodingWorkspaceDesc`).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — VÒNG LẶP TOOL PHẢI NHÌN THẤY ĐƯỢC (điều kiện brief nêu đích danh cho việc 2)", () => {
  it("★★★ trang có ĐỌC sự kiện `tool_loop` và HIỆN số vòng", () => {
    const src = doc(TRANG);
    expect(src, "không nối `onToolLoop` ⇒ người dùng nhìn màn hình đứng im tới 180 s").toContain("onToolLoop:");
    expect(src).toContain("repoWs.toolLoop.running");
  });

  it("★★★ hook `useKbChatStream` PHÂN GIẢI sự kiện `tool_loop` (trước lượt này client không đọc nó lần nào)", () => {
    const src = doc("client/src/hooks/useKbChatStream.ts");
    expect(src).toContain('payload.type === "tool_loop"');
    expect(src, "callback hiển thị ném ⇒ giết cả lượt stream nếu không nuốt").toContain("onToolLoop?.(");
  });

  it("★★ trần vòng hiện trên giao diện lấy từ SERVER (`tranTool`), không phải hằng chép tay ở client", () => {
    expect(doc(TRANG)).toContain("tranTool");
    expect(doc("server/routers/repoWorkspaceRouter.ts")).toContain("tranTool: tranVongLapTrinh()");
  });
});
