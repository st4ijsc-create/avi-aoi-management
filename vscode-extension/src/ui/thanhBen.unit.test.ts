/**
 * ★★★ BA MỐI NỐI BẰNG CHUỖI mà `tsc` KHÔNG bắt được lệch.
 *
 * Thanh bên chỉ hiện ra khi ba thứ khớp nhau, và cả ba nối với nhau bằng **chuỗi thuần**:
 *   1. `MA_VIEW_THANH_BEN` trong mã  ==  `contributes.views[<container>][0].id` trong manifest
 *   2. khoá của `contributes.views`  ==  `contributes.viewsContainers.activitybar[0].id`
 *   3. `icon` trỏ tới một tệp CÓ THẬT trên đĩa
 *
 * Lệch bất kỳ cái nào ⇒ **thanh bên chết IM LẶNG**: extension vẫn cài được, `activate()` vẫn chạy,
 * mọi lệnh vẫn đăng ký, 480 ca lưới vẫn xanh — chỉ là người dùng mở VSCode và không thấy gì. Đó
 * đúng là trạng thái người dùng đã báo trước khi có thanh bên, nên nó phải có lưới canh.
 *
 * ⚠ Lưới này CỐ Ý đọc `package.json` THẬT thay vì một bản dựng sẵn: thứ VSCode đọc lúc chạy là tệp
 * đó, nên đó mới là thứ đáng đo.
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("vscode", () => ({ window: {}, commands: {}, workspace: {}, Uri: {} }));

type MucContainer = { id: string; title: string; icon: string; when?: string };
const GOC = join(__dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(GOC, "package.json"), "utf8")) as {
  contributes?: {
    viewsContainers?: { activitybar?: MucContainer[]; secondarySidebar?: MucContainer[] };
    views?: Record<string, Array<{ id: string; type?: string; when?: string }>>;
    commands?: Array<{ command: string; title: string; icon?: string }>;
    menus?: { "view/title"?: Array<{ command: string; when?: string; group?: string }> };
  };
};

describe("thanh bên — ba mối nối bằng chuỗi", () => {
  it("★★★ manifest KHAI một container ở thanh hoạt động (không có ⇒ người dùng không thấy gì)", () => {
    const ds = manifest.contributes?.viewsContainers?.activitybar ?? [];
    expect(ds.length).toBe(1);
    expect(ds[0].id.length).toBeGreaterThan(0);
    expect(ds[0].title.length).toBeGreaterThan(0);
  });

  it("★★★ khoá của `views` KHỚP id của container (lệch ⇒ view mồ côi, icon rỗng)", () => {
    // ★★★ ĐỢT F / TASK 4 — MỞ RỘNG: từ đây có HAI container (activitybar "lùi" + secondarySidebar
    // "chính", xem describe TASK 4 dưới), nên `views` phải có ĐÚNG hai khoá, không nhiều không ít
    // — so bằng TẬP HỢP (không quan tâm thứ tự) để không đỏ oan nếu ai đó đổi thứ tự khai báo.
    const idActivitybar = manifest.contributes!.viewsContainers!.activitybar![0].id;
    const idPhu = manifest.contributes!.viewsContainers!.secondarySidebar![0].id;
    expect(new Set(Object.keys(manifest.contributes?.views ?? {}))).toEqual(new Set([idActivitybar, idPhu]));
  });

  it("★★★ `MA_VIEW_THANH_BEN` trong MÃ khớp NGUYÊN VĂN id trong MANIFEST", async () => {
    const { MA_VIEW_THANH_BEN } = await import("./bangChatView");
    const idContainer = manifest.contributes!.viewsContainers!.activitybar![0].id;
    const dsView = manifest.contributes!.views![idContainer];
    expect(dsView.map((v) => v.id)).toContain(MA_VIEW_THANH_BEN);
  });

  it("★★★ view khai `type: \"webview\"` (thiếu ⇒ VSCode chờ TreeDataProvider, khung trắng)", () => {
    const idContainer = manifest.contributes!.viewsContainers!.activitybar![0].id;
    expect(manifest.contributes!.views![idContainer][0].type).toBe("webview");
  });

  it("★★★ tệp icon TỒN TẠI trên đĩa và là SVG (thiếu ⇒ ô trống ở thanh hoạt động)", () => {
    const icon = manifest.contributes!.viewsContainers!.activitybar![0].icon;
    const duong = join(GOC, icon);
    expect(existsSync(duong)).toBe(true);
    expect(readFileSync(duong, "utf8")).toContain("<svg");
  });

  it("★ icon dùng `currentColor` để theo theme sáng/tối (màu cứng ⇒ tàng hình ở một theme)", () => {
    const icon = manifest.contributes!.viewsContainers!.activitybar![0].icon;
    expect(readFileSync(join(GOC, icon), "utf8")).toContain("currentColor");
  });
});

/**
 * ★★★ ĐỢT F / TASK 3 / B2 — MỞ RỘNG lưới ba-mối-nối cho thanh công cụ đầu khung (`menus.view/title`,
 * nút "Chat mới"/"Lịch sử"). Đây là hai mối nối bằng chuỗi THÊM MÀ `tsc` KHÔNG bắt được lệch:
 *   4. mọi `when: "view == X"` trong `view/title`  ==  `view == ${MA_VIEW_THANH_BEN}` NGUYÊN VĂN
 *   5. mọi `command` trong `view/title`  ==  một chuỗi THẬT SỰ được `registerCommand(...)` trong
 *      `extension.ts` (không chỉ khai trong `contributes.commands` — VSCode KHÔNG đòi hai danh sách
 *      này khớp nhau, nút vẫn VẼ RA dù lệnh chưa từng được đăng ký, chỉ là BẤM VÀO KHÔNG LÀM GÌ và
 *      VSCode tự log một lỗi "command not found" mà không ai để ý tới console đó).
 *
 * Lệch (4) ⇒ nút hiện ở SAI khung (hoặc không hiện ở đâu cả nếu `when` trỏ một view không tồn tại).
 * Lệch (5) ⇒ nút hiện ĐÚNG chỗ nhưng bấm vào KHÔNG LÀM GÌ — đúng lớp lỗi "khai mà không đọc kết
 * cục" dự án này đã trả giá nhiều lần, chỉ khác lần này là "khai một nút mà không đăng ký nó".
 */
describe("thanh bên — ĐỢT F / TASK 3: view/title (Chat mới + Lịch sử)", () => {
  const dsMenu = () => manifest.contributes?.menus?.["view/title"] ?? [];

  /**
   * ★★★ ĐỢT H / TASK H3 (vá 2026-09-04) — MỞ RỘNG danh sách BA lệnh, không còn đúng hai như Task 3.
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * VÌ SAO MỞ RỘNG ĐÚNG LƯỚI NÀY, KHÔNG DỰNG MỘT DESCRIBE RIÊNG
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bài học người dùng ĐÃ TRẢ GIÁ MỘT LẦN: manifest thiếu `viewsContainers`/`views` ⇒ extension cài
   * được, chạy tốt, MỌI lưới xanh — nhưng KHÔNG CÓ GÌ ĐỂ NHÌN THẤY. Bảng "Bộ nhớ dài hạn" (H3/B2)
   * ban đầu chỉ vào được qua Bảng lệnh (Command Palette) — ĐÚNG hình dạng lỗi đó, chỉ nhẹ hơn một
   * bậc: tính năng CÓ THẬT, có lưới, nhưng không ai TÌM RA nó từ khung chat. Một describe MỚI, TÁCH
   * RIÊNG sẽ không buộc các phép đếm/tích Đề-các ĐÃ CÓ (dưới đây) phải lớn lên theo — tức có thể
   * quên cập nhật `toHaveLength(...)` và lưới vẫn xanh trong khi thực ra "hai mối nối 4/5" chỉ mới
   * canh HAI lệnh cũ, không canh lệnh mới. Mở rộng đúng TẬP BA LỆNH này buộc MỌI khẳng định đếm ở
   * dưới phải đổi theo, nên một mục bị BỎ SÓT khỏi `view/title` (hoặc khỏi MỘT trong hai view id) sẽ
   * làm phép đếm lệch NGAY LẬP TỨC, không cần nhớ thêm một ca lưới riêng.
   */
  const BA_LENH_VIEW_TITLE = ["aviAiLocal.chatMoi", "aviAiLocal.lichSu", "aviAiLocal.boNho"];

  it("★★★ có ÍT NHẤT ba mục trong view/title (Chat mới + Lịch sử + Bộ nhớ)", () => {
    expect(dsMenu().length).toBeGreaterThanOrEqual(3);
    const lenh = dsMenu().map((m) => m.command);
    for (const l of BA_LENH_VIEW_TITLE) expect(lenh).toContain(l);
  });

  it("★★★ MỐI NỐI 4 — mọi `when` trong view/title khớp NGUYÊN VĂN `view == <một trong hai MA_VIEW_...>`", async () => {
    // ★★★ ĐỢT F / TASK 4 / B4 — MỞ RỘNG: từ Task 4 có HAI view id sống song song (activitybar
    // "lùi" + secondarySidebar "chính"). Mỗi mục `view/title` phải khớp NGUYÊN VĂN với MỘT TRONG
    // HAI hằng — không còn đúng một hằng duy nhất như Task 3 nữa.
    const { MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU } = await import("./bangChatView");
    const dsHopLe = new Set([`view == ${MA_VIEW_THANH_BEN}`, `view == ${MA_VIEW_THANH_BEN_PHU}`]);
    expect(dsMenu().length).toBeGreaterThan(0); // không lặng lẽ xanh trên một mảng rỗng
    for (const m of dsMenu()) {
      expect(dsHopLe.has(m.when ?? ""), `mục "${m.command}" có when="${m.when}"`).toBe(true);
    }
  });

  it("★★★ ĐỢT F / TASK 4 / B4 — mọi menu (Chat mới + Lịch sử + Bộ nhớ) áp cho CẢ HAI view id, không riêng một bên", async () => {
    // Lệch ⇒ thanh công cụ (nút Chat mới/Lịch sử/Bộ nhớ) BIẾN MẤT ở vùng chứa còn lại — đúng cảnh
    // báo trong kế hoạch Đợt F / Task 4 / B4, và đúng bài học người dùng đã trả giá (H3, xem docblock
    // `BA_LENH_VIEW_TITLE` ở trên): thiếu MỘT view id là nút biến mất Ở MỘT TRONG HAI vị trí, người
    // dùng mở đúng vị trí thiếu thì coi như tính năng không tồn tại. Đo bằng tích Đề-các:
    // 3 lệnh × 2 view id = 6 mục.
    const { MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU } = await import("./bangChatView");
    for (const lenh of BA_LENH_VIEW_TITLE) {
      for (const view of [MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU]) {
        const co = dsMenu().some((m) => m.command === lenh && m.when === `view == ${view}`);
        expect(co, `thiếu mục view/title cho lệnh "${lenh}" ở view "${view}"`).toBe(true);
      }
    }
    expect(dsMenu()).toHaveLength(6);
  });

  it("★★★ MỐI NỐI 5 — mọi `command` trong view/title THẬT SỰ được `registerCommand(...)` trong extension.ts", () => {
    const maNguon = readFileSync(join(GOC, "src", "extension.ts"), "utf8");
    const daDangKy = new Set(
      Array.from(maNguon.matchAll(/registerCommand\(\s*["']([^"']+)["']/g), (m) => m[1]),
    );
    expect(dsMenu().length).toBeGreaterThan(0);
    for (const m of dsMenu()) {
      expect(daDangKy.has(m.command), `lệnh "${m.command}" KHÔNG thấy registerCommand trong extension.ts`).toBe(
        true,
      );
    }
  });

  it("★★ cả ba mục đứng trong group \"navigation\" (đầu khung, cạnh icon container)", () => {
    for (const id of BA_LENH_VIEW_TITLE) {
      const m = dsMenu().find((x) => x.command === id);
      expect(m, `thiếu mục view/title cho "${id}"`).toBeDefined();
      expect(m!.group).toBe("navigation");
    }
  });

  it("★★ ba lệnh khai ĐÚNG codicon: chatMoi = $(add), lichSu = $(history), boNho = $(book)", () => {
    const ds = manifest.contributes?.commands ?? [];
    expect(ds.find((c) => c.command === "aviAiLocal.chatMoi")?.icon).toBe("$(add)");
    expect(ds.find((c) => c.command === "aviAiLocal.lichSu")?.icon).toBe("$(history)");
    expect(ds.find((c) => c.command === "aviAiLocal.boNho")?.icon).toBe("$(book)");
  });
});

/**
 * ★★★ ĐỢT F / TASK 4 — đặt được ở ĐÚNG VỊ TRÍ Claude Code (thanh bên phụ / secondarySidebar).
 *
 * ĐO ĐƯỢC (B1, không đoán): manifest `anthropic.claude-code-2.1.259-win32-x64` (đang cài trên máy
 * đo) khai CẶP `viewsContainers` loại trừ nhau — `activitybar` (khi
 * `claude-code:doesNotSupportSecondarySidebar`) + `secondarySidebar` (khi PHỦ ĐỊNH của cùng khoá
 * đó) — và context key ấy do CHÍNH Claude Code đặt lúc `activate()`, dựa trên phiên bản VSCode
 * (ngưỡng đo được: major>1 || major===1 && minor>=106; xem `loi/thanhBenPhu.ts`). Đợt F mirror
 * ĐÚNG khuôn đó bằng context key riêng `aviAiLocal:khongHoTroThanhBenPhu`.
 *
 * BA MỐI NỐI THÊM (6, 7, 8) mà `tsc` KHÔNG bắt được lệch, nối tiếp đánh số 4/5 ở Task 3:
 *   6. context key trong `when` của CẢ HAI container (bỏ dấu "!" ở secondarySidebar) khớp NGUYÊN
 *      VĂN `KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU` (`loi/thanhBenPhu.ts`) — chuỗi extension.ts
 *      dùng để `setContext`.
 *   7. `extension.ts` THẬT SỰ `registerWebviewViewProvider(...)` cho CẢ HAI view id (không chỉ
 *      view id activitybar cũ) — lệch ⇒ container hợp lệ mà VSCode báo lỗi "no view registered".
 *   8. hai biểu thức `when` của `viewsContainers` là PHỦ ĐỊNH CỦA NHAU — lệch ⇒ HAI icon AI Local
 *      cùng hiện (khi cả hai context cùng đúng) hoặc KHÔNG icon nào hiện (khi cả hai cùng sai).
 */
describe("thanh bên — ĐỢT F / TASK 4: cặp vùng chứa (secondarySidebar CHÍNH + activitybar LÙI)", () => {
  it("★★★ manifest KHAI một container ở thanh bên phụ (không có ⇒ không có bản 'CHÍNH' nào để lùi từ đó)", () => {
    const ds = manifest.contributes?.viewsContainers?.secondarySidebar ?? [];
    expect(ds.length).toBe(1);
    expect(ds[0].id.length).toBeGreaterThan(0);
    expect(ds[0].title.length).toBeGreaterThan(0);
  });

  it("★★★ `MA_VIEW_THANH_BEN_PHU` trong MÃ khớp NGUYÊN VĂN id view của container secondarySidebar", async () => {
    const { MA_VIEW_THANH_BEN_PHU } = await import("./bangChatView");
    const idContainer = manifest.contributes!.viewsContainers!.secondarySidebar![0].id;
    const dsView = manifest.contributes!.views![idContainer];
    expect(dsView.map((v) => v.id)).toContain(MA_VIEW_THANH_BEN_PHU);
    expect(dsView[0]!.type).toBe("webview");
  });

  it("★★★ hai view id (activitybar vs secondarySidebar) KHÁC NHAU — trùng ⇒ VSCode từ chối đăng ký view thứ hai", async () => {
    const { MA_VIEW_THANH_BEN, MA_VIEW_THANH_BEN_PHU } = await import("./bangChatView");
    expect(MA_VIEW_THANH_BEN_PHU).not.toBe(MA_VIEW_THANH_BEN);
  });

  it("★★★ icon của CẢ HAI container trỏ tệp CÓ THẬT trên đĩa, là SVG dùng currentColor", () => {
    for (const icon of [
      manifest.contributes!.viewsContainers!.activitybar![0].icon,
      manifest.contributes!.viewsContainers!.secondarySidebar![0].icon,
    ]) {
      const duong = join(GOC, icon);
      expect(existsSync(duong), `icon "${icon}" không tồn tại trên đĩa`).toBe(true);
      const noiDung = readFileSync(duong, "utf8");
      expect(noiDung).toContain("<svg");
      expect(noiDung).toContain("currentColor");
    }
  });

  it("★★★ MỐI NỐI 6 — context key trong `when` khớp NGUYÊN VĂN với hằng `extension.ts` dùng để setContext", async () => {
    const { KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU } = await import("../loi/thanhBenPhu");
    const whenActivitybar = manifest.contributes!.viewsContainers!.activitybar![0].when;
    const whenPhu = manifest.contributes!.viewsContainers!.secondarySidebar![0].when;
    expect(whenActivitybar).toBe(KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU);
    expect(whenPhu).toBe(`!${KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU}`);
  });

  it("★★★ MỐI NỐI 8 / B4 — hai `when` của viewsContainers là PHỦ ĐỊNH CỦA NHAU (không đoán từ chuỗi cứng)", () => {
    // Đo bằng CẤU TRÚC (bóc dấu "!" rồi so phần còn lại), không phải so hai chuỗi cứng viết tay —
    // một bản vá đổi TÊN context key ở cả hai nơi vẫn phải xanh, chỉ đỏ khi MỐI QUAN HỆ phủ định
    // (không phải giá trị cụ thể) bị phá.
    const whenActivitybar = manifest.contributes!.viewsContainers!.activitybar![0].when ?? "";
    const whenPhu = manifest.contributes!.viewsContainers!.secondarySidebar![0].when ?? "";
    expect(whenActivitybar.startsWith("!"), `activitybar.when="${whenActivitybar}" không nên có "!"`).toBe(false);
    expect(whenPhu.startsWith("!"), `secondarySidebar.when="${whenPhu}" PHẢI có "!" (phủ định)`).toBe(true);
    expect(whenPhu.slice(1)).toBe(whenActivitybar);
    // Cùng khoá `when` ở `views[...][0]` (Claude Code cũng lặp lại `when` ở cả container LẪN view,
    // xem B1) — lệch ⇒ container đúng vị trí nhưng view bên trong tự ẩn/hiện SAI theo context khác.
    const idActivitybar = manifest.contributes!.viewsContainers!.activitybar![0].id;
    const idPhu = manifest.contributes!.viewsContainers!.secondarySidebar![0].id;
    expect(manifest.contributes!.views![idActivitybar][0]!.when).toBe(whenActivitybar);
    expect(manifest.contributes!.views![idPhu][0]!.when).toBe(whenPhu);
  });

  it("★★★ MỐI NỐI 7 — extension.ts THẬT SỰ registerWebviewViewProvider CẢ HAI view id", async () => {
    // ⚠ Khác MỐI NỐI 5 (Task 3): `registerCommand` nhận CHUỖI literal, còn
    // `registerWebviewViewProvider` ở đây nhận HẰNG (`MA_VIEW_THANH_BEN`/`MA_VIEW_THANH_BEN_PHU`,
    // import từ `bangChatView.ts`) — nên đo bằng TÊN định danh, không phải giá trị chuỗi của nó
    // (dò theo giá trị sẽ không bao giờ khớp, vì mã nguồn không viết chuỗi "aviAiLocal.bangChat"
    // trực tiếp ở lệnh gọi này).
    const maNguon = readFileSync(join(GOC, "src", "extension.ts"), "utf8");
    for (const ten of ["MA_VIEW_THANH_BEN", "MA_VIEW_THANH_BEN_PHU"]) {
      const mau = new RegExp(`registerWebviewViewProvider\\(\\s*${ten}\\b`);
      expect(mau.test(maNguon), `KHÔNG thấy registerWebviewViewProvider(${ten}, …) trong extension.ts`).toBe(true);
    }
    // Và HẰNG đó phải THẬT SỰ được import từ đúng module khai id (không phải một biến trùng tên
    // định nghĩa lại ở nơi khác, thứ regex trên không phân biệt được).
    expect(maNguon).toMatch(/import\s*\{[^}]*MA_VIEW_THANH_BEN_PHU[^}]*\}\s*from\s*["']\.\/ui\/bangChatView["']/);
  });

  it("★ extension.ts THẬT SỰ gọi setContext với ĐÚNG hằng context key (không phải chuỗi viết tay lệch)", async () => {
    const { KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU } = await import("../loi/thanhBenPhu");
    const maNguon = readFileSync(join(GOC, "src", "extension.ts"), "utf8");
    expect(maNguon).toMatch(/executeCommand\(\s*["']setContext["']/);
    expect(maNguon).toContain("KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU");
    // Hằng số IMPORT từ `loi/thanhBenPhu.ts` — nếu tồn tại (đã xác nhận ở lưới thuần riêng), giá trị
    // dùng ở đây LUÔN khớp vì cùng một hằng, không phải hai chuỗi viết tay có thể trôi dần.
    expect(KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU.length).toBeGreaterThan(0);
  });
});
