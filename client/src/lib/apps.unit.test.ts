/**
 * apps.unit.test.ts — ĐỢT 33 twin3d (Pareto #3): VỎ SHELL KHI DEEP-LINK ROUTE CON.
 *
 * Đợt 32 a6 đo được: `/twin/line/2` · `/twin/may/14` ⇒ `getAppForRoute` trả
 * `undefined` (ba tra cứu đều khớp CHÍNH XÁC) ⇒ `useActiveApp` rơi về
 * `listApps()[0]` = "Overview" ⇒ sidebar RỖNG, không lỗi nào nổ.
 *
 * Bản vá: route CON thừa app của route CHA (cắt dần đuôi đường dẫn). Lưới này
 * đo HAI chiều:
 *   ① hai route con của twin về đúng app "production";
 *   ② KHÔNG mục nav nào đổi app vì bước cắt đuôi — mọi href nav đều khớp chính
 *     xác trước khi tới bước ấy (đo trên TOÀN BỘ `navGroups`, không trên mẫu).
 */
import { describe, expect, it } from "vitest";
import { getAppForRoute, getAppForRouteChinhXac, listApps } from "./apps";
import { navGroups } from "./navigation";

describe("★★★ Đợt 33 — route con thừa app của route cha", () => {
  it("★★★ /twin/line/2 và /twin/may/14 ⇒ app của /twin (production), không còn undefined", () => {
    const cha = getAppForRoute("/twin");
    expect(cha?.appId).toBe("production");
    expect(getAppForRoute("/twin/line/2")?.appId).toBe("production");
    expect(getAppForRoute("/twin/may/14")?.appId).toBe("production");
    // query string không làm lệch
    expect(getAppForRoute("/twin/line/2?cam=1,2,3,4,5")?.appId).toBe("production");
  });

  it("★ ĐỐI CHỨNG — chính hai route ấy KHỚP CHÍNH XÁC vẫn là undefined (bước cắt đuôi là thứ mua được kết cục)", () => {
    expect(getAppForRouteChinhXac("/twin/line/2")).toBeUndefined();
    expect(getAppForRouteChinhXac("/twin/may/14")).toBeUndefined();
    expect(getAppForRouteChinhXac("/twin")?.appId).toBe("production");
  });

  it("★ gốc lạ vẫn undefined — cắt đuôi dừng ở gốc, KHÔNG rơi về `/` (mục nav Overview có sẵn)", () => {
    expect(getAppForRoute("/khong-ton-tai/1/2")).toBeUndefined();
    expect(getAppForRoute("/khong-ton-tai")).toBeUndefined();
    expect(getAppForRoute("")).toBeUndefined();
    // `/` là MỘT MỤC NAV THẬT (dashboard) ⇒ overview — hành vi cũ, không phải do cắt đuôi.
    expect(getAppForRouteChinhXac("/")?.appId).toBe("overview");
  });

  it("★★★ KHÔNG MỤC NAV NÀO đổi app vì bước cắt đuôi — đo trên toàn bộ navGroups", () => {
    const lech: string[] = [];
    let soMuc = 0;
    for (const g of navGroups) {
      for (const it_ of g.items) {
        soMuc += 1;
        const truoc = getAppForRouteChinhXac((it_.href || "").split("?")[0])?.appId;
        const sau = getAppForRoute(it_.href)?.appId;
        if (truoc !== sau) lech.push(`${it_.href}: ${truoc} → ${sau}`);
      }
    }
    expect(soMuc).toBeGreaterThan(100); // ca dương: vòng lặp thật sự chạy
    expect(lech).toEqual([]);
  });

  it("★ override doc 67 W5 (`/corporate-dashboard` → overview) vẫn thắng", () => {
    expect(getAppForRoute("/corporate-dashboard")?.appId).toBe("overview");
    expect(listApps()[0].appId).toBe("overview"); // fallback cũ của useActiveApp — nay không còn phải dùng cho twin
  });
});
