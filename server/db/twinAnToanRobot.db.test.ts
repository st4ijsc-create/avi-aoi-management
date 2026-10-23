/**
 * CỔNG CSDL THẬT — §11 #26: **E-STOP NỔI LÊN TWIN**, đường dữ liệu.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY PHẢI CHẠM DB THẬT, KHÔNG ĐƯỢC LÀ UNIT TEST
 * ══════════════════════════════════════════════════════════════════════════════
 * Logic quy ba trạng thái (`nhan|nha|khong_ro`) ĐÃ có 11 test thuần ở
 * `client/src/components/twin3d/van-hanh/canhBaoAnToan.unit.test.ts`, và chúng
 * xanh suốt Đợt 6 **trong khi badge E-STOP không thể nổi lên được**. Lý do:
 * `TwinVanHanh.tsx:412` gọi `tomTatAnToan([])` — MẢNG RỖNG HARDCODE. Tức là
 * toàn bộ phần đã test nằm **sau** chỗ hỏng, nên không test nào chạm tới nó.
 *
 * ⇒ Thứ chưa ai đo là **ĐƯỜNG DỮ LIỆU**: robot có thật trong DB có ra tới hàm
 *   tóm tắt không. Lưới này đo đúng đoạn ấy, và nó đo bằng **CA DƯƠNG DỰNG
 *   TAY** (G5/G22): DB dev có 3 robot, phân bố `status` = `online` 2 · `idle` 1
 *   — **KHÔNG con nào `estop`**. Một phép nghiệm thu "không thấy cảnh báo nào"
 *   trên tập ấy trông **y hệt nhau** dù mã đúng hay hỏng hoàn toàn.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN mà lưới này bắt được (đã tiêm tay, xem báo cáo đóng nợ)
 * ══════════════════════════════════════════════════════════════════════════════
 *   (a) `traAnToanRobot` trả `[]` (mô phỏng lại chính lỗi Đợt 6) ⇒ ca dương ĐỎ
 *   (b) `estop: t?.estop ?? false` thay vì `?? null`                ⇒ ca `khong_ro` ĐỎ
 *   (c) bỏ lọc `isEnabled = true`                                   ⇒ ca đếm ĐỎ
 *   (d) lọc `status <> 'estop'` (bỏ mất tập đang đi tìm)            ⇒ ca dương ĐỎ
 *
 * ⚠ KHÔI PHỤC BYTE-EXACT: ca dương sửa `robots.status` của MỘT hàng rồi trả lại
 *   đúng giá trị cũ trong `afterAll`, và có một ca đối chiếu TỔNG để chứng minh
 *   việc khôi phục đã xảy ra thật (không chỉ được khai là đã xảy ra).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { traAnToanRobot } from "./twinCanh";
// ★★★ G20 — import CHÍNH module giao hàng mà `/twin` gọi. Nếu xoá sạch
//   `tomTatAnToan` thì lưới này ĐỎ, không phải xanh nhờ một bản chép.
import { tomTatAnToan, trangThaiAnToan } from "../../client/src/components/twin3d/van-hanh/canhBaoAnToan";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;

/** SIM-FAC — nhà máy duy nhất có máy/robot thật (xem báo cáo Đợt 0). */
const FACTORY_ID = 1;

let sql: ReturnType<typeof postgres>;
/** Trạng thái gốc của robot bị mượn làm ca dương — để trả lại BYTE-EXACT. */
let goc: { id: number; status: string } | null = null;
/** Robot đã mượn ở ca dương + trạng thái gốc — GIỮ LẠI sau khi khôi phục để ca đối chiếu chỉ khẳng định trên ĐÚNG robot của mình. */
let daMuon: { id: number; ma: string; status: string } | null = null;

describe.skipIf(!DB_URL)("§11 #26 — E-STOP: đường dữ liệu robot ra tới tóm tắt an toàn", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    // KHÔI PHỤC trước khi đóng kết nối — nếu ca dương đã mượn một hàng.
    if (goc) {
      await sql`UPDATE robots SET status = ${goc.status} WHERE id = ${goc.id}`;
    }
    await sql.end();
  });

  it("cầu chì: phải CÓ robot đang bật trong nhà máy đo, nếu không mọi ca dưới xanh giả", async () => {
    // Không có cầu chì này, `traAnToanRobot` trả `[]` và mọi assertion bên dưới
    // đúng một cách vô nghĩa — đúng lớp lỗi G5 "đo trên tập rỗng".
    const ds = await traAnToanRobot(FACTORY_ID);
    expect(ds.length, "SIM-FAC phải có ít nhất 1 robot đang bật để lưới này có nghĩa").toBeGreaterThan(0);
  });

  it("★★★ CA ÂM — robot KHÔNG `estop` thì KHÔNG nằm trong danh sách đang nhãn", async () => {
    const ds = await traAnToanRobot(FACTORY_ID);
    // ⚠ KHÔNG khẳng định "cả nhà máy không có estop": `_test` dùng chung — test/phiên khác có thể để lại robot estop ở đây. Chỉ khẳng định trên robot KHÔNG estop.
    // Ca này chỉ có nghĩa vì ca DƯƠNG bên dưới chứng minh cùng đường mã BIẾT KÊU.
    const khongEstop = ds.filter((r) => r.status !== "estop");
    expect(khongEstop.length, "phải có robot không-estop để ca này có nghĩa").toBeGreaterThan(0);
    const tt = tomTatAnToan(ds);
    const idNhan = new Set(tt.dangNhan.map((r) => r.id));
    for (const r of khongEstop) expect(idNhan.has(r.id), `robot ${r.ma} (${r.status}) không được bị nhãn estop`).toBe(false);
  });

  it("★★★ CA DƯƠNG DỰNG TAY — một robot `estop` PHẢI nổi lên `coCanhBao=true`", async () => {
    const truoc = await traAnToanRobot(FACTORY_ID);

    // Mượn robot KHÔNG-estop có id nhỏ nhất — tất định, và không dính robot estop do test/phiên khác để lại.
    const muon = [...truoc].filter((r) => r.status !== "estop").sort((a, b) => a.id - b.id)[0];
    expect(muon, "phải có robot không-estop để mượn").toBeTruthy();
    expect(tomTatAnToan(truoc).dangNhan.map((r) => r.id), "nền: robot sắp mượn CHƯA bị nhãn").not.toContain(muon.id);
    const [hangGoc] = await sql`SELECT id, status FROM robots WHERE id = ${muon.id}`;
    goc = { id: Number(hangGoc.id), status: String(hangGoc.status) };
    daMuon = { id: muon.id, ma: muon.ma, status: goc.status };

    await sql`UPDATE robots SET status = 'estop' WHERE id = ${muon.id}`;

    const sau = await traAnToanRobot(FACTORY_ID);
    const tt = tomTatAnToan(sau);

    // ★ Ba assertion, không một: badge nổi lên · ĐÚNG robot · nêu được MÃ nó.
    expect(tt.coCanhBao, "đặt một robot sang `estop` PHẢI làm badge nổi lên").toBe(true);
    expect(tt.dangNhan.map((r) => r.id)).toContain(muon.id);
    expect(tt.dangNhan.map((r) => r.ma)).toContain(muon.ma);
    // Và hàm quy trạng thái phải nói `nhan` cho đúng hàng đó.
    const hang = sau.find((r) => r.id === muon.id)!;
    expect(trangThaiAnToan(hang)).toBe("nhan");

    // ── Khôi phục NGAY trong ca, không đợi `afterAll` ──────────────────────
    await sql`UPDATE robots SET status = ${goc.status} WHERE id = ${goc.id}`;
    goc = null;

    const lai = await traAnToanRobot(FACTORY_ID);
    expect(tomTatAnToan(lai).dangNhan.map((r) => r.id), "khôi phục xong robot đã mượn PHẢI hết bị nhãn").not.toContain(muon.id);
  });

  it("★★★ ĐỐI CHIẾU — robot đã mượn được khôi phục THẬT (đúng trạng thái gốc), không phải lời khai", async () => {
    // Đo bằng đường ĐỘC LẬP (SQL thô), không qua `traAnToanRobot`: nếu hàm đọc sai thì cả hai nửa cùng sai một kiểu (BG-127 — độc lập phải ở MÔ HÌNH, không ở người đo).
    // ⚠ CHỈ robot của chính ca này. Trước đây ca đếm phân bố `status` TOÀN BẢNG và đòi "không còn estop nào" ⇒ đỏ 10/10 vì 3 robot estop do TEST KHÁC để lại ở `_test` dùng chung.
    expect(daMuon, "ca dương phải đã mượn một robot").not.toBeNull();
    const [hang] = await sql`SELECT status FROM robots WHERE id = ${daMuon!.id}`;
    expect(String(hang.status), `robot ${daMuon!.ma} phải về đúng trạng thái gốc`).toBe(daMuon!.status);
    expect(String(hang.status)).not.toBe("estop");
  });

  it("★★★ robot KHÔNG có telemetry ⇒ `estop = null` ⇒ `khong_ro`, KHÔNG suy thành `nha`", async () => {
    /*
     * ⚠⚠ CA NÀY TỪNG XANH GIẢ, và cách nó hỏng đáng ghi lại. Bản viết đầu lặp
     * qua danh sách với một guard `if (r.estop === null) { … }`. Tiêm đột biến
     * `estop: t?.estop ?? false` ⇒ **6/6 VẪN XANH**: đột biến làm `estop` thành
     * `false`, guard `=== null` không còn khớp ai, nên vòng lặp không chạy
     * assertion nào. Test tự BỎ QUA đúng ca hỏng mà nó sinh ra để canh.
     *
     * ⇒ Phép đo phải neo vào SỰ THẬT ĐỘC LẬP của DB, không vào giá trị mà chính
     *   hàm-đang-bị-đo trả về. Đo được 2026-09-07: `robot_telemetry` có
     *   1.075.179 hàng nhưng **chỉ của DUY NHẤT `robotId = 1`** — robot 2 và 3
     *   CHƯA TỪNG báo cáo. Nên với chúng, `estop` bắt buộc là `null`.
     */
    const coTele = await sql`SELECT DISTINCT "robotId" AS id FROM robot_telemetry`;
    const idCoTele = new Set(coTele.map((r) => Number(r.id)));

    const ds = await traAnToanRobot(FACTORY_ID);
    const khongTele = ds.filter((r) => !idCoTele.has(r.id));

    // Cầu chì: nếu MỌI robot đều có telemetry thì ca này không đo được gì.
    expect(
      khongTele.length,
      "phải có ít nhất 1 robot CHƯA TỪNG có telemetry để ca này có nghĩa",
    ).toBeGreaterThan(0);

    for (const r of khongTele) {
      // KHÔNG guard — assertion chạy VÔ ĐIỀU KIỆN, nên `?? false` làm nó ĐỎ.
      expect(r.estop, `robot ${r.ma} chưa từng báo cáo ⇒ estop phải là null`).toBeNull();
      expect(trangThaiAnToan(r)).toBe("khong_ro");
    }

    // …và tóm tắt phải ĐẾM chúng vào ô riêng, không im lặng gộp vào `soNha`.
    const tt = tomTatAnToan(ds);
    expect(tt.soKhongRo).toBeGreaterThanOrEqual(khongTele.length);
    expect(tt.soKhongRo + tt.soNha + tt.dangNhan.length).toBe(ds.length);
  });

  it("★★★ robot ĐÃ VÔ HIỆU HOÁ (`isEnabled=false`) KHÔNG được vào dải an toàn", async () => {
    /*
     * ⚠⚠ VÙNG MÙ CÓ THẬT, VÀ NÓ ĐƯỢC VÁ BẰNG DỰNG DỮ LIỆU chứ không bằng lời.
     * Tiêm đột biến "bỏ lọc `isEnabled = true`" ⇒ **6/6 VẪN XANH**. Không phải
     * lỗi của lưới: đo được `SELECT "isEnabled", COUNT(*) FROM robots` cho
     * `t → 3` — **3/3 robot dev đều đang bật**, nên KHÔNG có hàng nào để hai
     * nhánh cho ra hai kết quả khác nhau. Đo trên tập ấy không thể phân biệt
     * (đúng G5), nên ca này **tự dựng hàng phân biệt** rồi dọn.
     *
     * Vì sao luật này đáng canh: một robot đã vô hiệu hoá không có ai đứng cạnh,
     * nên mạch an toàn của nó không phải câu hỏi của ca trực. Để nó vào dải
     * E-STOP là dạy người trực ca bỏ qua dải ấy — hỏng đúng thứ nó bảo vệ.
     */
    const MA = "ZZTEST-ESTOP-OFF-" + Date.now();
    // Neo vào CÙNG line mà robot thật đang dùng, để chỉ khác nhau ở `isEnabled`.
    const [mau] = await sql`SELECT "lineId" FROM robots WHERE "lineId" IS NOT NULL LIMIT 1`;
    const [them] = await sql`
      INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled", status, "lineId")
      VALUES (${MA}, 'Robot lưới đo (vô hiệu hoá)', 'sim', 'arm', 'sim://test',
              false, 'estop', ${mau.lineId})
      RETURNING id`;
    try {
      const ds = await traAnToanRobot(FACTORY_ID);
      // Hàng vừa thêm mang `status='estop'` — nếu lọc `isEnabled` bị bỏ thì nó
      // LỌT VÀO và làm badge nổi lên vì một robot không ai vận hành.
      expect(ds.map((r) => r.ma)).not.toContain(MA);
      expect(tomTatAnToan(ds).coCanhBao, "robot vô hiệu hoá KHÔNG được làm badge nổi").toBe(false);

      // ★ ĐỐI CHỨNG: cùng hàng đó, bật lên thì nó PHẢI vào — chứng minh ca trên
      //   xanh vì lọc `isEnabled`, KHÔNG phải vì hàng bị bỏ sót bởi lý do khác
      //   (sai line, sai phạm vi…). Không có nửa này thì ca trên xanh vô nghĩa.
      await sql`UPDATE robots SET "isEnabled" = true WHERE id = ${them.id}`;
      const ds2 = await traAnToanRobot(FACTORY_ID);
      expect(ds2.map((r) => r.ma), "bật lên thì CHÍNH hàng đó phải vào").toContain(MA);
      expect(tomTatAnToan(ds2).coCanhBao).toBe(true);
    } finally {
      // Xoá CỨNG — `robots` không phải WORM, và lưới không để lại hàng rác.
      await sql`DELETE FROM robots WHERE id = ${them.id}`;
    }

    // Dọn xong, dải phải trở lại SẠCH — chứng minh việc dọn là thật.
    expect(tomTatAnToan(await traAnToanRobot(FACTORY_ID)).coCanhBao).toBe(false);
  });

  it("phạm vi: nhà máy KHÔNG tồn tại trả mảng rỗng, không ném", async () => {
    await expect(traAnToanRobot(999_999)).resolves.toEqual([]);
  });
});
