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
/**
 * ★★★ I-2 (review Task 5) — **HỎI CÂY CÚ PHÁP, KHÔNG HỎI VĂN BẢN.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐO ĐƯỢC: hai máy quét `readFileSync` + regex của bản trước **XANH BẰNG MỘT DÒNG CHÚ THÍCH**.
 * Người review bỏ **hết** literal `"sidecar:llm-finetune"` khỏi mã sản xuất ⇒ **5/7 ĐỎ**; thêm
 * **một** dòng `// … xinVramCoHoan({ owner: "sidecar:llm-finetune" … })` ⇒ **7/7 XANH**.
 * ⇒ Lưới xác nhận "xong" cho một bản vá **không chạm mã**, và câu báo lỗi của chính nó
 * (*"không có owner nào trong MÃ SẢN XUẤT"*) **chỉ đường tới đúng bản vá sai đó**.
 *
 * ⚠⚠ Đây là lớp lỗi repo NÀY **đã bắt và đã sửa một lần**: `errorCodes.vramCommands.unit.test.ts`
 * (cổng (ii), C-2) — chú-thích-hoá một lời gọi ⇒ **119/119 XANH** ⇒ bản vá là **chuyển sang AST**.
 * File này dùng **đúng bộ máy đó** (`ts.createSourceFile` + `forEachChild`), không đẻ máy thứ ba:
 * **chú thích KHÔNG PHẢI node của AST**, nên một literal bị comment ra **biến mất khỏi cây**.
 */
import ts from "typescript";

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
  /**
   * ★ M-5 (review) — **CHÂN TRỜI LÀ `server/`, KHÔNG PHẢI `server/services/`.**
   * Đo được: cùng một hộ mới, đặt ở `server/` ngoài `services/` ⇒ **7/7 XANH**. `xinVramCoHoan`
   * là hàm **export**; một job/worker/router gọi nó từ ngoài `services/` là **vô hình** với lưới
   * dân số — và hướng mù ấy hỏng **im lặng**.
   */
  const GOC_QUET = path.resolve(__dirname, "..", "..");

  /** Mọi file `.ts` **SẢN XUẤT** dưới `server/`. `boQua` loại thêm những file không được làm nhân chứng. */
  function fileSanXuat(boQua: (duongDayDu: string) => boolean): string[] {
    const ra: string[] = [];
    const di = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          di(p);
          continue;
        }
        if (!e.name.endsWith(".ts") || e.name.includes(".test.")) continue;
        if (boQua(p)) continue;
        ra.push(p);
      }
    };
    di(GOC_QUET);
    return ra;
  }

  /**
   * ★★★ I-2 — **MỘT bộ máy AST, hai người dùng.** Trả về text TĨNH của mọi
   * `owner: <chuỗi>` trong file — `StringLiteral` (nguyên văn) hoặc `TemplateExpression`
   * (**phần đầu tĩnh**, đúng ngữ nghĩa mà regex cũ có: `` `gguf-embed-ctx:${id}` `` ⇒
   * `"gguf-embed-ctx:"`).
   * `trongLoiGoi !== null` ⇒ chỉ tính những `owner` nằm **bên trong** một lời gọi tên đó.
   * ⚠ Chú thích **không phải node** ⇒ không lọt vào đây; đó là toàn bộ điểm của I-2.
   */
  function ownerTrongFile(file: string, trongLoiGoi: string | null): string[] {
    const src = fs.readFileSync(file, "utf8");
    // Lọc rẻ trước khi dựng AST (987 file `.ts` dưới `server/`, 87 file có chữ "owner").
    if (!src.includes("owner")) return [];
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const ra: string[] = [];

    const textTinh = (n: ts.Node): string | null => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
      if (ts.isTemplateExpression(n)) return n.head.text;
      return null;
    };
    const gomOwner = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && !ts.isComputedPropertyName(n.name) && n.name.getText(sf) === "owner") {
        const t = textTinh(n.initializer);
        if (t !== null) ra.push(t);
      }
      ts.forEachChild(n, gomOwner);
    };

    if (trongLoiGoi === null) {
      gomOwner(sf);
      return ra;
    }
    /**
     * ⚠⚠ **CHỈ THAM SỐ TRỰC TIẾP, KHÔNG ĐỆ QUY VÀO THÂN CALLBACK.** Mỗi lời gọi
     * `xinVramCoHoan({ owner, …, xin: async () => beginVramAllocation({ owner, … }) })` mang **HAI**
     * literal `owner`: một của lượt xin-có-hoãn, một của giấy phép bên trong. Đếm cả hai làm con số
     * điểm gọi **nhân đôi** (đo được: 12 thay vì 6) — và một con số dân số sai là đúng thứ lưới này
     * tồn tại để chặn. Ngữ nghĩa của regex cũ (`xinVramCoHoan({\s*owner:`) là **ô trực tiếp**; giữ nguyên.
     */
    const ownerTrucTiep = (n: ts.Node): void => {
      if (!ts.isObjectLiteralExpression(n)) return;
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p) || ts.isComputedPropertyName(p.name)) continue;
        if (p.name.getText(sf) !== "owner") continue;
        const t = textTinh(p.initializer);
        if (t !== null) ra.push(t);
      }
    };
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
        if (ten === trongLoiGoi) for (const a of n.arguments) ownerTrucTiep(a);
      }
      ts.forEachChild(n, di);
    };
    di(sf);
    return ra;
  }

  /** Quét `server/**` (bỏ file test) tìm `xinVramCoHoan({ owner: "…" })` — **trên AST**. */
  function quetOwnerXinVramCoHoan(): string[] {
    return fileSanXuat(() => false).flatMap((f) => ownerTrongFile(f, "xinVramCoHoan"));
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

  /** Quét MỌI `owner: "…"` trong `server/**` — **trên AST**, và **trừ** chính file khai bảng. */
  function quetOwnerSanXuat(): string[] {
    return fileSanXuat((p) => path.basename(p) === "vramReadModel.ts").flatMap((f) => ownerTrongFile(f, null));
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
        `hộ "${host}" KHÔNG có một ĐIỂM GỌI nào trong mã sản xuất chứng thực cái tên đó ` +
          `(owner mà hộ nhận: ${JSON.stringify(cuaHo)}).\n` +
          `⚠ CÁCH SỬA ĐÚNG: đổi tên hộ cho khớp owner mà mã sản xuất THẬT SỰ truyền vào, hoặc ` +
          `sửa điểm gọi. ⚠ KHÔNG sửa được bằng cách viết cái tên vào một CHÚ THÍCH: lưới này đọc ` +
          `CÂY CÚ PHÁP (ts.createSourceFile), và chú thích không phải node — nó sẽ không được tính.`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * ★★★ I-2 — **LƯỚI CHO CHÍNH LƯỚI.** Cùng khuôn ca *"một lời gọi BỊ COMMENT không được tính"* của
   * cổng (ii). Không có ca này thì việc "đã chuyển sang AST" chỉ là một lời khai trong docstring.
   */
  it("★★★ I-2 — một literal `owner` BỊ COMMENT KHÔNG được tính (chứng minh lưới đọc AST, không đọc văn bản)", () => {
    const nguon = `
      // await xinVramCoHoan({ owner: "sidecar:bi-comment", leaseKind: "gguf-context" });
      /* xinVramCoHoan({ owner: "sidecar:trong-block-comment" }) */
      const nhan = "xinVramCoHoan({ owner: \\"sidecar:trong-chuoi\\" })";
      export async function that() {
        return await xinVramCoHoan({ owner: "sidecar:that-su-goi", leaseKind: "gguf-context" });
      }
    `;
    const f = path.join(__dirname, "__zz_ast_probe_khong_ghi_ra_dia.ts");
    // ⚠ KHÔNG ghi file thật: dựng AST thẳng từ chuỗi, đúng như cổng (ii) làm.
    const sf = ts.createSourceFile(f, nguon, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const thay: string[] = [];
    const gom = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
        if (ten === "xinVramCoHoan") {
          const di = (m: ts.Node): void => {
            if (ts.isPropertyAssignment(m) && m.name.getText(sf) === "owner" && ts.isStringLiteral(m.initializer)) {
              thay.push(m.initializer.text);
            }
            ts.forEachChild(m, di);
          };
          for (const a of n.arguments) di(a);
        }
      }
      ts.forEachChild(n, gom);
    };
    gom(sf);
    // ⚠ Đúng MỘT: hai dòng chú thích và một chuỗi-trông-giống-mã đều KHÔNG phải điểm gọi.
    expect(thay).toEqual(["sidecar:that-su-goi"]);
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
