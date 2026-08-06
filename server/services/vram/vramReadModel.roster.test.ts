/**
 * ★★★ Pha 4 — vá review TOÀN NHÁNH, **I-4: MỘT LƯỚI ĐƯỢC KHAI TRONG MÃ SẢN XUẤT PHẢI TỒN TẠI Ở
 * ĐÚNG CÁI TÊN NÓ ĐƯỢC KHAI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — VÀ ĐÍNH CHÍNH MỘT NỬA CỦA PHÁT HIỆN I-4
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vramReadModel.ts:508-517` khẳng định nguyên văn: *"`vramReadModel.roster.test.ts` đếm
 * `xinVramCoHoan({ owner: … })` trong mã sản xuất **bằng máy** … Một hộ `background` MỚI mà quên
 * khai ở đây ⇒ ca **ĐỎ**"*. Người review chạy `git ls-tree -r 4fdfdce9 | grep roster` → **không có
 * file nào**, và kết luận **lưới KHÔNG TỒN TẠI**.
 *
 * **ĐÍNH CHÍNH (đo được, `git show 4fdfdce9:server/routers/vramRouter.test.ts`):** *cơ chế* thì có
 * thật — nó nằm ở `server/routers/vramRouter.test.ts:376-421`, ba ca, cùng phép quét. Thứ SAI là
 * **cái tên**: mã sản xuất trỏ người đọc tới một đường dẫn không tồn tại. Và cái sai đó **không
 * nhỏ**: người sửa `HO_BACKGROUND` mở `server/services/vram/` ra, không thấy `roster`, rồi hoặc
 * tin là lưới đã mất (viết bản thứ hai) hoặc tin là docstring nói dối (thôi tin cả khối). Cả hai
 * kết cục đều tệ hơn không có docstring — đúng câu người review viết.
 *
 * ⇒ Bản vá: **DỜI** ba ca sang đúng cái tên đã khai, cạnh chính bản khai mà chúng canh. **KHÔNG
 * chép** — bản ở `vramRouter.test.ts` đã bị xoá trong cùng lượt vá này; hai bản sao của một vị từ
 * là đúng lớp lỗi cả nhánh đang gỡ.
 *
 * ⚠ VÌ SAO LƯỚI NÀY QUAN TRỌNG HƠN VẺ NGOÀI CỦA NÓ: bản khai tay `HO_BACKGROUND` là **NỀN của cả
 * ba mặt** Pha 4 dựng — mặt ĐỌC (`docSauHo()` → 6 ô `defer.hosts`), mặt LỆNH
 * (`vramBackgroundHostForOwner()` quyết định `retryDeferred` trả `unknown-background-host` hay
 * không), mặt UI (`vramRetryButtonDisabled()` đọc `retryReach` sinh ra từ chính bản khai đó). Một
 * hộ `background` mới mà quên khai ⇒ **cả ba mặt im lặng**: Agent không thấy nó đang hoãn, lệnh từ
 * chối nó với lý do sai, nút không bao giờ hiện.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  VRAM_BACKGROUND_HOST_IDS,
  VRAM_BACKGROUND_STATIC_OWNERS,
  vramBackgroundHostForOwner,
} from "./vramReadModel";

/**
 * ★★★ (E) — DÂN SỐ SÁU HỘ CÓ **MÁY QUÉT**, không phải một bản khai tay được miễn lưới.
 * Cùng khuôn `vramAllocationSites.test.ts` (thứ đã canh `WIRED_ALLOCATION_SITE_COUNT` bằng máy) —
 * tiền lệ nói rằng ở repo này một bản khai tay thì **nhận lưới**, không phải được miễn.
 */
describe("vramReadModel — bảng sáu hộ khớp ĐÚNG các điểm gọi `xinVramCoHoan` trong mã sản xuất", () => {
  /** Quét `server/services/**` (bỏ file test) tìm `xinVramCoHoan({ owner: "…" })`. */
  function quetOwnerXinVramCoHoan(): string[] {
    const goc = path.resolve(__dirname, "..");
    const ra: string[] = [];
    const di = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          di(p);
          continue;
        }
        if (!e.name.endsWith(".ts") || e.name.includes(".test.")) continue;
        const src = fs.readFileSync(p, "utf8");
        const re = /xinVramCoHoan\(\{\s*owner:\s*[`"']([^`"'$]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) ra.push(m[1]!);
      }
    };
    di(goc);
    return ra;
  }

  it("★★★ MỌI `owner` quét được đều khớp MỘT hàng trong bảng — một hộ MỚI mà quên khai ⇒ ĐỎ", () => {
    const owners = quetOwnerXinVramCoHoan();
    // Lưới của lưới: mẫu quét phải THẬT SỰ thấy các điểm gọi, không phải im lặng trả rỗng.
    expect(owners.length, "máy quét không thấy điểm gọi nào ⇒ chính lưới này đã mù").toBeGreaterThanOrEqual(6);
    for (const o of owners) {
      expect(vramBackgroundHostForOwner(o), `owner "${o}" KHÔNG có hàng nào trong HO_BACKGROUND`).not.toBeNull();
    }
  });

  it("★★ và NGƯỢC LẠI — mọi hàng trong bảng đều được ít nhất một điểm gọi chạm tới (không có hàng CHẾT)", () => {
    const owners = quetOwnerXinVramCoHoan();
    // `cron:kb-sync` có cơ chế hẹn giờ RIÊNG (không qua `xinVramCoHoan`) ⇒ nó tự khớp bằng tên hộ.
    const chamToi = new Set<string>(["cron:kb-sync"]);
    for (const o of owners) {
      const h = vramBackgroundHostForOwner(o);
      if (h !== null) chamToi.add(h);
    }
    expect([...chamToi].sort()).toEqual([...VRAM_BACKGROUND_HOST_IDS].sort());
  });

  it("máy quét thấy ĐÚNG sáu điểm gọi `xinVramCoHoan` (số này đổi ⇒ đọc lại bảng, đừng sửa ca cho xanh)", () => {
    expect(quetOwnerXinVramCoHoan().length).toBe(6);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ Pha 5 Task 5 (N14) — **LƯỚI CANH *TÊN*, KHÔNG CHỈ CANH *DÂN SỐ*.**
  //
  // ⚠⚠⚠ ĐO ĐƯỢC Ở PHA 4: đột biến **đổi TÊN** một hộ ⇒ **4/4 ca trên vẫn XANH.** Vì sao: cả hai
  // vế của mọi phép so đều suy ra từ **CÙNG MỘT BẢNG** (`VRAM_BACKGROUND_HOST_IDS` là
  // `HO_BACKGROUND.map(h => h.host)`, còn `vramBackgroundHostForOwner()` **trả về** `h.host`) —
  // đúng lớp *"hai bản sao của một vị từ trùng nhau dưới một bất biến"*. Đổi tên thì **cả hai vế
  // đổi theo**, và phép so vẫn đúng. **Thêm ca không giải được lớp này.**
  //
  // ⇒ Vế đối chiếu phải đến từ **một NGUỒN ĐỘC LẬP**: chính **mã sản xuất**. Luật được phát biểu ở
  // chiều **PHẢI-LÀ** (không liệt kê cái bị cấm):
  //
  //     **TÊN của mỗi hộ PHẢI LÀ một `owner` có thật trong mã sản xuất** — hoặc **chính** owner đó
  //     (`owner === host`, hộ có owner TĨNH), hoặc **tiền tố tĩnh** của một owner ĐỘNG
  //     (`owner === host + ":"`, tức điểm gọi viết `` `${host}:${…}` ``).
  //
  // ⚠ Vì sao **không** chấp nhận `owner.startsWith(host + ":")` chung chung: nó cho một cái tên bị
  // **cắt cụt** đi lọt (`"sidecar:local-trainer"` → đổi tên thành `"sidecar"` vẫn xanh). Điều kiện
  // đúng là owner literal **kết thúc ngay tại ranh giới**, tức nó **bằng** `host + ":"`.
  // ⚠ Máy quét **BỎ chính `vramReadModel.ts`** — quét cả nó là quay lại đúng "một bảng, hai vế".
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /** Quét MỌI `owner: "…"` / `owner: \`…\`` trong `server/services/**` — **trừ** bảng đang bị canh. */
  function quetOwnerSanXuat(): string[] {
    const goc = path.resolve(__dirname, "..");
    const ra: string[] = [];
    const di = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          di(p);
          continue;
        }
        if (!e.name.endsWith(".ts") || e.name.includes(".test.")) continue;
        // ⚠ ĐỘC LẬP: nguồn đối chiếu KHÔNG được là chính file khai bảng.
        if (e.name === "vramReadModel.ts") continue;
        const src = fs.readFileSync(p, "utf8");
        const re = /\bowner:\s*[`"']([^`"'$]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) ra.push(m[1]!);
      }
    };
    di(goc);
    return ra;
  }

  it("★★★ N14 — TÊN mỗi hộ PHẢI LÀ một `owner` có thật trong mã sản xuất (đổi tên một hộ ⇒ ĐỎ)", () => {
    const owners = quetOwnerSanXuat();
    // Lưới của lưới: máy quét mù thì mọi khẳng định dưới đây vô nghĩa.
    expect(owners.length, "máy quét không thấy `owner:` nào ⇒ chính lưới này đã mù").toBeGreaterThanOrEqual(10);

    for (const host of VRAM_BACKGROUND_HOST_IDS) {
      /** Những `owner` sản xuất mà **chính hàng này** nhận (dùng đúng vị từ của mặt đọc). */
      const cuaHo = owners.filter((o) => vramBackgroundHostForOwner(o) === host);
      const chungThuc = cuaHo.filter((o) => o === host || o === `${host}:`);
      expect(
        chungThuc.length,
        `hộ "${host}" KHÔNG có owner nào trong mã sản xuất chứng thực cái tên đó ` +
          `(owner mà hộ nhận: ${JSON.stringify(cuaHo)}). Đổi tên một hộ mà mã sản xuất không đổi ` +
          `theo là mặt đọc/lệnh/UI nói về một hộ KHÔNG TỒN TẠI.`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("★★ N14 — chiều KHÔNG BẮT NHẦM: máy quét thấy đủ SÁU tên hộ, không phải xanh vì quét rỗng", () => {
    const owners = new Set(quetOwnerSanXuat());
    const thay = VRAM_BACKGROUND_HOST_IDS.filter((h) => owners.has(h) || owners.has(`${h}:`));
    expect(thay.sort()).toEqual([...VRAM_BACKGROUND_HOST_IDS].sort());
  });

  it("★★ N12/N14 — DANH TÍNH TĨNH đã khai phải phân giải NGƯỢC về đúng hàng của nó", () => {
    expect(VRAM_BACKGROUND_STATIC_OWNERS.map((x) => x.host).sort()).toEqual([...VRAM_BACKGROUND_HOST_IDS].sort());
    for (const x of VRAM_BACKGROUND_STATIC_OWNERS) {
      if (x.ownerStatic === null) continue;
      expect(vramBackgroundHostForOwner(x.ownerStatic), `danh tính "${x.ownerStatic}" của hộ "${x.host}"`).toBe(
        x.host,
      );
    }
  });

  /**
   * ★★ LƯỚI CHO LỜI KHAI (I-4 nguyên bản). Docstring của `vramReadModel.ts` trỏ đích danh **file
   * này**. Nếu ai đổi tên/di chuyển file mà không sửa docstring thì ta quay lại đúng trạng thái mà
   * I-4 mô tả: mã sản xuất hứa một cơ chế không có ở chỗ nó chỉ. Ca này khoá lời hứa đó lại.
   */
  it("★★ mã sản xuất trỏ ĐÚNG tên file này (một lời khai về lưới phải tự chịu lưới)", () => {
    const src = fs.readFileSync(path.join(__dirname, "vramReadModel.ts"), "utf8");
    expect(src, "vramReadModel.ts phải viện dẫn đúng đường dẫn của lưới đang canh nó").toContain(
      "vramReadModel.roster.test.ts",
    );
    expect(path.basename(__filename)).toBe("vramReadModel.roster.test.ts");
  });
});
