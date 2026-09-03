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

const GOC = join(__dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(GOC, "package.json"), "utf8")) as {
  contributes?: {
    viewsContainers?: { activitybar?: Array<{ id: string; title: string; icon: string }> };
    views?: Record<string, Array<{ id: string; type?: string }>>;
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
    const idContainer = manifest.contributes!.viewsContainers!.activitybar![0].id;
    expect(Object.keys(manifest.contributes?.views ?? {})).toEqual([idContainer]);
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

  it("★★★ có ÍT NHẤT hai mục trong view/title (Chat mới + Lịch sử)", () => {
    expect(dsMenu().length).toBeGreaterThanOrEqual(2);
    const lenh = dsMenu().map((m) => m.command);
    expect(lenh).toContain("aviAiLocal.chatMoi");
    expect(lenh).toContain("aviAiLocal.lichSu");
  });

  it("★★★ MỐI NỐI 4 — mọi `when` trong view/title khớp NGUYÊN VĂN `view == <MA_VIEW_THANH_BEN>`", async () => {
    const { MA_VIEW_THANH_BEN } = await import("./bangChatView");
    expect(dsMenu().length).toBeGreaterThan(0); // không lặng lẽ xanh trên một mảng rỗng
    for (const m of dsMenu()) {
      expect(m.when, `mục "${m.command}" có when="${m.when}"`).toBe(`view == ${MA_VIEW_THANH_BEN}`);
    }
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

  it("★★ cả hai mục đứng trong group \"navigation\" (đầu khung, cạnh icon container)", () => {
    for (const id of ["aviAiLocal.chatMoi", "aviAiLocal.lichSu"]) {
      const m = dsMenu().find((x) => x.command === id);
      expect(m, `thiếu mục view/title cho "${id}"`).toBeDefined();
      expect(m!.group).toBe("navigation");
    }
  });

  it("★★ hai lệnh khai ĐÚNG codicon: chatMoi = $(add), lichSu = $(history)", () => {
    const ds = manifest.contributes?.commands ?? [];
    expect(ds.find((c) => c.command === "aviAiLocal.chatMoi")?.icon).toBe("$(add)");
    expect(ds.find((c) => c.command === "aviAiLocal.lichSu")?.icon).toBe("$(history)");
  });
});
