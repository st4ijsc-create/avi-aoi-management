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
