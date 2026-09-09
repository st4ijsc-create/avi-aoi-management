/**
 * `tang1KhongTachDuoc.unit.test.ts` — ★★★ ĐỢT 28: **TẦNG 1 ĐỂ NGUYÊN, CÓ ĐO**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO CÓ MỘT TỆP TEST CHO MỘT THỨ **KHÔNG LÀM**
 * ════════════════════════════════════════════════════════════════════════════
 * Brief Đợt 28 dặn: *"Tầng nào không tách an toàn được thì để nguyên và nói
 * thẳng — thà còn 3.674 dòng hơn làm chậm một cảnh báo an toàn."*
 *
 * Nhưng một lời từ chối viết trong báo cáo sẽ **bay hơi**: đợt sau đọc §15.5.2
 * thấy "gom 14 useQuery thành 1 hook, rủi ro THẤP", không thấy lý do bác, và
 * làm lại từ đầu. Đợt 27 đã tốn một lượt để bác đúng câu ấy (G90); Đợt 28 tốn
 * lượt thứ hai. Tệp này để **không có lượt thứ ba**.
 *
 * ⇒ Nó biến một **kết luận** thành một **phép đo chạy được**: nếu cấu trúc
 *   khiến tầng 1 không tách được thay đổi, tệp này ĐỎ, và khi đó việc tách mới
 *   đáng xét lại. Chừng nào nó còn xanh, câu trả lời vẫn là KHÔNG.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA SỰ THẬT ĐO ĐƯỢC KHIẾN TẦNG 1 KHÁC HẲN TẦNG 2/3/4
 * ════════════════════════════════════════════════════════════════════════════
 * Tầng 4, 3, 2 tách được vì chúng là **LÁ**: không truy vấn nào khác đọc kết
 * quả của chúng để quyết định có bắn hay không. Tầng 1 thì ngược lại — nó là
 * **THÂN CÂY**, và ba sự thật sau đo được trên mã thật:
 *
 *   ① **CHUỖI XEN KẼ TRUY VẤN ↔ MEMO.** Bốn truy vấn không đứng liền nhau; mỗi
 *      cái ăn đầu ra dẫn xuất của cái trước:
 *
 *        factoriesQ → factories → mucNhaMay → factoryId
 *          → toaNhaQ → dsToaNha → mucToaNha → toaNhaId
 *            → chiTietQ → dsTang → mucTang/tangIdsHoi
 *              → canhQ
 *
 *      Một hook "trả 1 object" cho cả bốn phải trả luôn **mọi memo ở giữa** —
 *      chúng là đầu vào của nhau. Đó không còn là tách mảnh; đó là chuyển cả
 *      thân trang sang tệp khác rồi trả về 17 thứ.
 *
 *   ② **`useKhoTrangThai` NẰM GIỮA CHUỖI, VÀ PHẢI NẰM ĐÓ.** Nó nhận `factoryId`
 *      (mắt xích 4) và sinh ra `ketNoi` → `coLuongDay` → `nhipTongQuanMs` —
 *      thứ mà **tầng 2 và tầng 3** cần cho `refetchInterval`. Docblock tại chỗ
 *      gọi ghi rõ đây là bài học Đợt 8: đặt hook xuống dưới thì nhịp thích nghi
 *      **không tới được** các truy vấn, và đó chính là lý do cơ học khiến ba
 *      `refetchInterval` nằm nguyên dạng hằng số cứng suốt hai đợt.
 *
 *      ⇒ Gói tầng 1 vào một hook đặt `useKhoTrangThai` vào thế kẹt: hoặc nó
 *        chui vào trong (thì hook tầng 1 phải trả `ketNoi` — một thứ chẳng liên
 *        quan gì đến "phạm vi"), hoặc nó ở ngoài (thì phải gọi hook tầng 1 hai
 *        lần, một lần lấy `factoryId`, một lần lấy phần còn lại). **Vòng tròn.**
 *
 *   ③ **17 GIÁ TRỊ, DÙNG 220+ LẦN, RẢI KHẮP TRANG.** `factoryId` 36 chỗ,
 *      `canhQ` 44 chỗ, `phamVi` 37 chỗ, `tangId` 23 chỗ. Một hook trả về từng
 *      ấy thứ không giảm được độ phức tạp — nó chỉ **dời** độ phức tạp qua một
 *      lần gián tiếp nữa, đúng thứ §15.5.2 tưởng là mình đang gỡ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐÁNH ĐỔI, NÓI THẲNG
 * ════════════════════════════════════════════════════════════════════════════
 * Giữ tầng 1 nghĩa là `TwinVanHanh.tsx` còn ~3.573 dòng thay vì ~3.400. Đổi
 * lại: **0 rủi ro** với chuỗi phân giải URL → nhà máy → toà → tầng → cảnh, thứ
 * mà mọi màn 3D đều đứng trên. Đợt 10 lô F đã trả giá một lần cho đúng chuỗi
 * này (ba chỉ số `[0]` viết cứng làm banner khai sai 373 máy "chưa xếp chỗ").
 *
 * ⚠ Nếu một ngày muốn tách thật: điều kiện là **gỡ ràng buộc ② trước** — tách
 *   `useKhoTrangThai` khỏi giữa chuỗi, hoặc cho nhịp thích nghi một đường khác
 *   tới `refetchInterval`. Chừng nào ② còn đó, mọi phương án đều là vòng tròn.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const TRANG = readFileSync(resolve(GOC, "src/pages/TwinVanHanh.tsx"), "utf8");

/** Số dòng (1-based) của lần khai đầu tiên; `-1` nếu không có. */
const dongKhai = (ten: string) => {
  const dong = TRANG.split("\n");
  for (let i = 0; i < dong.length; i++) {
    if (new RegExp(`^  const (\\{[^}]*\\b${ten}\\b[^}]*\\}|${ten}) `).test(dong[i])) return i + 1;
  }
  return -1;
};

describe("★★★ TẦNG 1 — BỐN TRUY VẤN PHẠM VI VẪN Ở TRANG (có chủ ý)", () => {
  it("★★★ cả bốn còn nguyên tại `TwinVanHanh.tsx`", () => {
    // Nếu ca này đỏ vì ai đó ĐÃ tách tầng 1: đừng vá bằng cách xoá ca. Đọc
    // docblock đầu tệp, kiểm ràng buộc ② còn đúng không, rồi mới quyết định.
    for (const thu of [
      "trpc.factory.list.useQuery",
      "trpc.twinCanh.danhSachToaNha.useQuery",
      "trpc.twinCanh.chiTietToaNha.useQuery",
      "trpc.twinCanh.canhThietKe.useQuery",
    ]) {
      expect(TRANG, `${thu}: đã rời trang — xem docblock trước khi mừng`).toContain(thu);
    }
  });

  it("★★★ ① CHUỖI XEN KẼ: mỗi truy vấn ăn đầu ra DẪN XUẤT của cái trước", () => {
    // Đây là sự thật cấu trúc, không phải sở thích trình bày: thứ tự khai phải
    // là truy vấn → memo → truy vấn → memo. Không có thứ tự nào khác hợp lệ.
    const thuTu = [
      "factoriesQ",
      "factories",
      "mucNhaMay",
      "factoryId",
      "toaNhaQ",
      "dsToaNha",
      "mucToaNha",
      "toaNhaId",
      "chiTietQ",
      "dsTang",
      "mucTang",
      "tangIdsHoi",
      "canhQ",
    ];
    const dong = thuTu.map((t) => ({ ten: t, d: dongKhai(t) }));
    for (const { ten, d } of dong) {
      expect(d, `${ten}: không tìm thấy chỗ khai`).toBeGreaterThan(0);
    }
    // Tăng nghiêm ngặt ⇒ chuỗi phụ thuộc thật, không phải bốn thứ rời nhau.
    for (let i = 1; i < dong.length; i++) {
      expect(
        dong[i].d,
        `${dong[i].ten} phải khai SAU ${dong[i - 1].ten} — chuỗi đã đổi hình`,
      ).toBeGreaterThan(dong[i - 1].d);
    }
  });

  it("★★★ ② `useKhoTrangThai` NẰM GIỮA chuỗi — nguồn của vòng tròn", () => {
    // Nó ăn `factoryId` (mắt xích 4) và sinh `coLuongDay` cho tầng 2/3.
    // CHÍNH ràng buộc này khiến tầng 1 không gói được thành một hook.
    const dFactoryId = dongKhai("factoryId");
    const dKho = dongKhai("kho");
    const dColuong = dongKhai("coLuongDay");
    const dToaNha = dongKhai("toaNhaQ");

    expect(dFactoryId).toBeGreaterThan(0);
    expect(dKho, "useKhoTrangThai: không tìm thấy").toBeGreaterThan(0);

    // `useKhoTrangThai` phải đứng SAU `factoryId` (nó nhận factoryId)…
    expect(dKho).toBeGreaterThan(dFactoryId);
    // …và TRƯỚC truy vấn tầng 1 kế tiếp ⇒ nó CHẺ ĐÔI chuỗi tầng 1.
    expect(dKho, "kho không còn nằm giữa chuỗi — ràng buộc ② đã đổi").toBeLessThan(dToaNha);
    // …và `coLuongDay` (đầu vào nhịp tầng 2/3) sinh ra từ nó, cũng nằm giữa.
    expect(dColuong).toBeGreaterThan(dKho);
    expect(dColuong).toBeLessThan(dToaNha);
  });

  it("★★★ ② hook trạng thái vẫn khai TRƯỚC mọi truy vấn có nhịp thích nghi", () => {
    // Bài học Đợt 8, giữ nguyên từ `noiChoGoi.unit.test.ts`: đặt hook xuống dưới
    // thì nhịp thích nghi KHÔNG TỚI ĐƯỢC `refetchInterval` — lý do cơ học khiến
    // ba nhịp nằm nguyên dạng hằng số cứng suốt hai đợt.
    expect(dongKhai("coLuongDay")).toBeLessThan(dongKhai("nhipTongQuanMs") + 1);
    expect(TRANG.indexOf("const coLuongDay =")).toBeLessThan(
      TRANG.indexOf("useTrangThaiSong({"),
    );
    expect(TRANG.indexOf("const coLuongDay =")).toBeLessThan(
      TRANG.indexOf("usePhanTichLine({"),
    );
  });

  it("★★★ ③ tầng 1 sinh ra RẤT NHIỀU giá trị dùng khắp trang", () => {
    // Một hook trả về từng ấy thứ không GIẢM độ phức tạp, nó chỉ DỜI độ phức
    // tạp qua một lần gián tiếp nữa. Con số dưới đây là lý lẽ, đo lại mỗi lần
    // chạy chứ không chép từ báo cáo.
    const dem = (t: string) => (TRANG.match(new RegExp(`\\b${t}\\b`, "g")) ?? []).length;
    expect(dem("factoryId")).toBeGreaterThan(20);
    expect(dem("canhQ")).toBeGreaterThan(20);
    expect(dem("phamVi")).toBeGreaterThan(20);
    expect(dem("tangId")).toBeGreaterThan(10);
  });
});

describe("★★★ ĐỢT 28 — BỐN TẦNG KIA ĐÃ TÁCH, VÀ TRANG THẬT SỰ GỌI CHÚNG", () => {
  it("★★★ ba hook còn ở trang đều có CHỖ GỌI theo TÊN HÀM (G16)", () => {
    // ★ Đợt 34 (QĐ-24): `useMoPhongTwin({` KHÔNG còn trong danh sách này — nó chuyển sang
    //   `TwinLine.tsx` (ghim ở `useMoPhongTwin.unit.test.ts`). Sau QĐ-23 `/twin` không bao giờ ở cấp
    //   Line ⇒ ngăn Mô phỏng ở đây chỉ nói được `chua_chon_line` (Đợt 33 K11).
    for (const goi of ["usePhanTichLine({", "useTrangThaiSong({", "useAnhLichSu({"]) {
      expect(TRANG, `${goi}: hook tồn tại mà trang không gọi`).toContain(goi);
    }
  });

  it("★★★ Đợt 34 (QĐ-24) — trang KHÔNG còn gọi `useMoPhongTwin` và KHÔNG còn dựng `<NganMoPhong` (gỡ có chủ ý)", () => {
    const MA = TRANG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(MA).not.toContain("useMoPhongTwin({");
    expect(MA).not.toContain("<NganMoPhong");
    expect(MA).not.toContain("dungDauVaoWhatIf(");
    // Lý do gỡ phải ĐỌC ĐƯỢC trong mã (không gỡ câm): docblock nêu QĐ-24 và `chua_chon_line`.
    expect(TRANG).toContain("QĐ-24");
    expect(TRANG).toContain("chua_chon_line");
  });

  it("★★★ mười truy vấn đã tách KHÔNG còn sót bản thứ hai ở trang", () => {
    // Tách nửa vời (hook có, trang vẫn giữ bản cũ) cho hai bản cùng chạy: gấp
    // đôi lưu lượng và hai nguồn sự thật lệch nhau.
    for (const thu of [
      "trpc.digitalTwin.whatIf.useQuery",
      "trpc.orchestration.listWorkflows.useQuery",
      "trpc.orchestration.simulate.useQuery",
      "trpc.digitalTwin.wipFlowState.useQuery",
      "trpc.wip.lineBalance.useQuery",
      "trpc.factoryCommand.overview.useQuery",
      "trpc.andon.active.useQuery",
      "trpc.twinCanh.anToanRobot.useQuery",
      "trpc.twinCanh.sucKhoeMay.useQuery",
      "trpc.twinCanh.anhLichSu.useQuery",
    ]) {
      expect(TRANG, `${thu}: CÒN SÓT ở trang`).not.toContain(thu);
    }
  });
});
