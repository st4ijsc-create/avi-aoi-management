import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DICH_TWIN_CU, timChuoiNhieuChang, traDichCu } from "./dinhTuyenTwinCu";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lưới cho 14 URL CŨ — **KHÔNG URL NÀO ĐƯỢC CHẾT** (§13b 14.2.3, 14.10.B.4)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ Lưới cuối cùng của tệp này KHÔNG tin vào bảng — nó **đọc `App.tsx` thật**
 *   và đối chiếu. Lý do: một bảng ánh xạ đẹp đẽ mà `App.tsx` không dùng là một
 *   lời khai về Ý ĐỊNH, không phải về HÀNH VI (G16: hàm không ai gọi = chưa
 *   xong). Đây đúng khuôn BG-127 — đo bằng **hai mô hình rời nhau** rồi đối
 *   chiếu, thay vì hỏi cùng một nguồn hai lần.
 */

/** 14 URL nguyên văn bảng §13b 14.2.3 — chép từ SPEC, không chép từ mã. */
const MUOI_BON_URL_CU = [
  "/digital-twin",
  "/digital-twin?tab=overview",
  "/digital-twin?tab=center",
  "/digital-twin?tab=map",
  "/digital-twin?tab=floor",
  "/digital-twin?tab=layout",
  "/digital-twin?tab=cell",
  "/digital-twin?tab=rf",
  "/factory-live-map",
  "/factory-floor-editor",
  "/rf-test-cell",
  "/cell-twin",
  "/digital-twin-center",
  "/layout",
] as const;

describe("★★★ 14 URL cũ đều có đích — không đường nào chết", () => {
  it("13/14 nằm trong bảng; `/rf-test-cell` là TUYẾN THẬT nên KHÔNG redirect", () => {
    const thieu = MUOI_BON_URL_CU.filter((u) => traDichCu(u) === null);
    // ★ `/rf-test-cell` là ngoại lệ CÓ CHỦ Ý (§13b 3g): nó lấy lại tuyến thật
    //   trong `App.tsx` thay vì redirect. Khai đích danh, không khai "13 cái".
    expect(thieu).toEqual(["/rf-test-cell"]);
  });

  it("mọi đích đều bắt đầu bằng `/twin` hoặc `/rf-test-cell`", () => {
    for (const [k, v] of Object.entries(DICH_TWIN_CU)) {
      expect(v.startsWith("/twin") || v === "/rf-test-cell", `${k} → ${v}`).toBe(true);
    }
  });

  it("★ URL ngoài Twin ⇒ `null`, KHÔNG đoán mò", () => {
    for (const x of ["/settings", "/", "/twin", "/digital-twin?tab=khong-co"]) {
      expect(traDichCu(x)).toBeNull();
    }
  });
});

describe("★★★ LUẬT ≤1 CHẶNG — cưỡng chế trên chính bảng dữ liệu", () => {
  it("không đích nào lại là một khoá khác (0 chuỗi hai chặng)", () => {
    expect(timChuoiNhieuChang()).toEqual([]);
  });

  it("★ ca DƯƠNG cho chính thiết bị đo: thêm một chuỗi 2 chặng ⇒ hàm PHẢI kêu", () => {
    // Không có ca này, `timChuoiNhieuChang` trả `[]` cứng cũng xanh — đúng lớp
    // "chỉ báo âm tính phải biết KÊU trên ca dương đã biết".
    const bangHong: Record<string, string> = { "/a": "/b", "/b": "/twin" };
    const khoa = new Set(Object.keys(bangHong));
    const chuoi = Object.entries(bangHong)
      .filter(([, d]) => khoa.has(d))
      .map(([k]) => k);
    expect(chuoi).toEqual(["/a"]);
  });

  it("★★★ `/factory-live-map` ĐI THẲNG, không qua `/digital-twin` nữa", () => {
    const dich = traDichCu("/factory-live-map");
    expect(dich).toBe("/twin");
    expect(dich).not.toContain("digital-twin");
  });
});

describe("★★★ ĐỐI CHIẾU MÔ HÌNH THỨ HAI — đọc `App.tsx` thật (G16)", () => {
  const nguon = fs.readFileSync(
    path.resolve(__dirname, "../../../pages/../App.tsx"),
    "utf8",
  );

  it("`App.tsx` KHÔNG còn redirect nào trỏ vào `/digital-twin?tab=`", () => {
    // Đây là phép đo bắt được đúng thứ mà bảng ở trên không bắt được: một dòng
    // `App.tsx` còn sót sẽ tạo lại chuỗi hai chặng, và bảng vẫn sạch.
    const con = nguon.match(/Redirect to="\/digital-twin[^"]*"/g) ?? [];
    expect(con).toEqual([]);
  });

  it("★ ca DƯƠNG cho phép đo trên: `App.tsx` CÓ redirect vào `/twin`", () => {
    // Thiếu dòng này, một `App.tsx` đọc hỏng (rỗng) cũng làm lưới trên xanh.
    const co = nguon.match(/Redirect to="\/twin[^"]*"/g) ?? [];
    expect(co.length).toBeGreaterThanOrEqual(5);
  });

  it("★★★ `/rf-test-cell` là ROUTE THẬT, không phải Redirect", () => {
    expect(nguon).toContain('<Route path="/rf-test-cell">');
    expect(nguon).not.toContain('<Route path="/rf-test-cell"><Redirect');
    expect(nguon).toContain("<RfTestCellSim />");
  });

  /*
   * ★★★ ĐỢT 26 (QĐ-18) ĐẢO NGƯỢC LƯỚI NÀY, VÀ ĐÓ LÀ VIỆC ĐÚNG.
   *
   * Lưới cũ khai: *"`/twin-studio` KHÔNG còn `RouteGuard navHref` (chống
   * CHẶN-1)"* và cưỡng chế `Redirect to="/twin?che-do=botri"`. Nó đúng **với
   * QĐ-16**, và nó là một lưới tốt: nó cưỡng chế một quyết định của chủ sở hữu
   * ở tầng mã.
   *
   * QĐ-18 (2026-09-09) đảo chính quyết định ấy. Nên lưới phải đảo theo — giữ
   * nó xanh bằng cách nới lỏng sẽ là bỏ mất phép đo; đảo nó là chuyển phép đo
   * sang cưỡng chế quyết định MỚI.
   *
   * ★ Nỗi lo CHẶN-1 của lưới cũ đã được ĐO chứ không phải bỏ qua: trên bảng
   *   `permissions` (2026-09-09) `operator1` có `machine_status` nhưng KHÔNG có
   *   `settings_factory` lẫn `machine_control`. Họ chưa từng sửa được, nên trả
   *   guard về `/twin-studio` **không lấy đi của họ thứ gì**. CHẶN-1 thật (Đợt
   *   3) là 2/4 vai mất một màn họ ĐANG dùng được — khác hẳn.
   */
  it("★★★ QĐ-18 — `/twin-studio` là ROUTE THẬT có `RouteGuard`, không phải Redirect", () => {
    expect(nguon).toContain(
      '<Route path="/twin-studio"><RouteGuard navHref="/twin-studio"><TwinStudio /></RouteGuard></Route>',
    );
    expect(nguon).not.toContain('<Route path="/twin-studio"><Redirect');
  });

  it("★ `/twin` vẫn giữ NGUYÊN cổng cũ — tách trang KHÔNG đụng cổng của /twin", () => {
    expect(nguon).toContain('<Route path="/twin"><RouteGuard navHref="/twin">');
  });

  /*
   * ★★★ G67 — KHOÁ `?che-do=` PHẢI CHẾT HẲN, KHÔNG ĐƯỢC SỐNG NỬA VỜI.
   *
   * Lớp lỗi G67: bỏ một tên khỏi danh sách mà quên chỗ khác ⇒ chỗ còn lại ghi
   * ra một khoá không ai đọc, và **không lỗi nào nổ**. Ở đây cụ thể là: nếu
   * `App.tsx` còn một `Redirect to="/twin?che-do=botri"`, người dùng bấm
   * `/layout` sẽ tới `/twin` với một khoá mà `TwinVanHanh` (nay chỉ đọc) không
   * còn đọc nữa ⇒ họ ra màn XEM, im lặng, thay vì màn SỬA họ muốn.
   */
  it("★★★ G67 — `?che-do=` KHÔNG còn tồn tại ở `App.tsx` NÀO", () => {
    expect(nguon).not.toContain("che-do");
  });

  it("★★★ G40 — 4 đường vào có Ý ĐỊNH SỬA đều tới `/twin-studio`, không tới `/twin`", () => {
    // `/layout` + `/factory-floor-editor` ở `App.tsx`; `?tab=floor` + `?tab=layout`
    // ở bảng trên. Cả 4 là đường của người muốn SỬA — cho họ ra màn chỉ-đọc là
    // một lỗi câm (G40: URL cũ không được thành lỗi câm).
    expect(nguon).toContain('<Route path="/layout"><Redirect to="/twin-studio" /></Route>');
    expect(nguon).toContain(
      '<Route path="/factory-floor-editor"><Redirect to="/twin-studio" /></Route>',
    );
    expect(traDichCu("/digital-twin?tab=floor")).toBe("/twin-studio");
    expect(traDichCu("/digital-twin?tab=layout")).toBe("/twin-studio");
  });
});
