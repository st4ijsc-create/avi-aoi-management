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
 * ★ DỮ LIỆU RIÊNG (2026-10-23): ca TỰ TẠO nhà máy/xưởng/chuyền/trạm + 3 robot mang tiền tố `ZZTAR-<RUN>` và chỉ đo trong nhà máy RIÊNG đó. Trước đây ca "mượn" robot dùng chung
 *   (đổi `status` của hàng thật) và đếm phân bố `status` toàn bảng — hai tệp/phiên chạy song song mượn CÙNG một robot, tiến trình chết giữa chừng để robot kẹt estop, và rác estop của
 *   test khác làm ca đỏ 10/10. Nay: không đụng hàng của ai; chết giữa chừng ⇒ rác mang tiền tố `ZZTAR-` để truy được; afterAll xoá, FK chặn ⇒ `status=offline` + `isEnabled=false`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { traAnToanRobot } from "./twinCanh";
// ★★★ G20 — import CHÍNH module giao hàng mà `/twin` gọi. Nếu xoá sạch
//   `tomTatAnToan` thì lưới này ĐỎ, không phải xanh nhờ một bản chép.
import { tomTatAnToan, trangThaiAnToan } from "../../client/src/components/twin3d/van-hanh/canhBaoAnToan";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `ZZTAR-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, robotA: 0, robotB: 0, robotC: 0 };
const ma = { A: `${RUN}-A`, B: `${RUN}-B`, C: `${RUN}-C` };
/** robot dựng thêm trong từng ca (vô hiệu hoá…) — afterAll dọn nốt nếu ca chết giữa chừng */
const robotPhu: number[] = [];

async function themRobot(code: string, over: { isEnabled?: boolean; status?: string } = {}): Promise<number> {
  const [r] = await sql`
    INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled", status, "lineId", "stationId")
    VALUES (${code}, ${"Robot lưới đo " + code}, 'sim', 'arm', 'sim://test', ${over.isEnabled ?? true}, ${over.status ?? "idle"}, ${ids.line}, ${ids.station})
    RETURNING id`;
  return Number(r.id);
}

describe.skipIf(!DB_URL)("§11 #26 — E-STOP: đường dữ liệu robot ra tới tóm tắt an toàn", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${`F-${RUN}`}, 'ZZTAR factory') RETURNING id`;
    ids.factory = Number(f.id);
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${`W-${RUN}`}, 'ZZTAR ws') RETURNING id`;
    ids.workshop = Number(w.id);
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${`L-${RUN}`}, 'ZZTAR line') RETURNING id`;
    ids.line = Number(l.id);
    const [st] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${`S-${RUN}`}, 'ZZTAR st') RETURNING id`;
    ids.station = Number(st.id);
    ids.robotA = await themRobot(ma.A); // idle, CHƯA TỪNG có telemetry
    ids.robotB = await themRobot(ma.B); // idle, CHƯA TỪNG có telemetry
    ids.robotC = await themRobot(ma.C, { status: "online" }); // CÓ telemetry (estop=false)
    await sql`INSERT INTO robot_telemetry ("robotId", estop, "timestamp") VALUES (${ids.robotC}, false, now())`;
  }, 60_000);

  afterAll(async () => {
    try {
      const rid = [ids.robotA, ids.robotB, ids.robotC, ...robotPhu].filter(Boolean);
      if (rid.length) {
        await sql`DELETE FROM robot_telemetry WHERE "robotId" IN ${sql(rid)}`.catch(() => undefined);
        for (const id of rid) {
          // xoá cứng; FK/WORM chặn ⇒ vô hiệu hoá + offline để không còn vào dải an toàn của ai
          await sql`DELETE FROM robots WHERE id = ${id}`.catch(() => sql`UPDATE robots SET status = 'offline', "isEnabled" = false WHERE id = ${id}`.catch(() => undefined));
        }
      }
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`.catch(() => undefined);
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`.catch(() => undefined);
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`.catch(() => undefined);
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`.catch(() => undefined);
    } finally {
      await sql.end();
    }
  }, 60_000);

  it("cầu chì: nhà máy đo (RIÊNG) phải có đủ 3 robot đang bật, nếu không mọi ca dưới xanh giả", async () => {
    // Không có cầu chì này, `traAnToanRobot` trả `[]` và mọi assertion bên dưới
    // đúng một cách vô nghĩa — đúng lớp lỗi G5 "đo trên tập rỗng".
    const ds = await traAnToanRobot(ids.factory);
    expect(ds.map((r) => r.ma).sort()).toEqual([ma.A, ma.B, ma.C].sort());
  });

  it("★★★ CA ÂM — khi KHÔNG robot nào của nhà máy `estop`, `coCanhBao` phải là `false`", async () => {
    const ds = await traAnToanRobot(ids.factory);
    // Nhà máy này là CỦA CA ⇒ khẳng định "không estop nào" là đúng và không phụ thuộc rác của test khác.
    // Ca này chỉ có nghĩa vì ca DƯƠNG bên dưới chứng minh cùng đường mã BIẾT KÊU.
    const tt = tomTatAnToan(ds);
    expect(tt.dangNhan).toHaveLength(0);
    expect(tt.coCanhBao).toBe(false);
  });

  it("★★★ CA DƯƠNG — một robot `estop` PHẢI nổi lên `coCanhBao=true`, khôi phục thì tắt", async () => {
    const truoc = await traAnToanRobot(ids.factory);
    expect(tomTatAnToan(truoc).coCanhBao, "nền phải SẠCH trước khi dựng ca dương").toBe(false);

    await sql`UPDATE robots SET status = 'estop' WHERE id = ${ids.robotA}`;
    const sau = await traAnToanRobot(ids.factory);
    const tt = tomTatAnToan(sau);

    // ★ Ba assertion, không một: badge nổi lên · ĐÚNG robot · nêu được MÃ nó.
    expect(tt.coCanhBao, "đặt một robot sang `estop` PHẢI làm badge nổi lên").toBe(true);
    expect(tt.dangNhan.map((r) => r.id)).toContain(ids.robotA);
    expect(tt.dangNhan.map((r) => r.ma)).toContain(ma.A);
    // Và hàm quy trạng thái phải nói `nhan` cho đúng hàng đó.
    const hang = sau.find((r) => r.id === ids.robotA)!;
    expect(trangThaiAnToan(hang)).toBe("nhan");

    // ── Khôi phục NGAY trong ca ────────────────────────────────────────────
    await sql`UPDATE robots SET status = 'idle' WHERE id = ${ids.robotA}`;
    const lai = await traAnToanRobot(ids.factory);
    expect(tomTatAnToan(lai).coCanhBao, "khôi phục xong badge PHẢI tắt").toBe(false);
  });

  it("★★★ ĐỐI CHIẾU — robot của ca về đúng trạng thái gốc THẬT (SQL thô độc lập), không phải lời khai", async () => {
    // Đo bằng đường ĐỘC LẬP (SQL thô), không qua `traAnToanRobot`: nếu hàm đọc sai thì cả hai nửa cùng sai một kiểu (BG-127).
    // ⇒ CHỈ robot của chính ca; KHÔNG đếm `status` toàn bảng (rác estop của test khác từng làm ca này đỏ 10/10).
    const hang = await sql`SELECT id, status FROM robots WHERE id IN ${sql([ids.robotA, ids.robotB, ids.robotC])} ORDER BY id`;
    const theoId = Object.fromEntries(hang.map((r) => [Number(r.id), String(r.status)]));
    expect(theoId[ids.robotA]).toBe("idle");
    expect(theoId[ids.robotB]).toBe("idle");
    expect(theoId[ids.robotC]).toBe("online");
    expect(Object.values(theoId)).not.toContain("estop");
  });

  it("★★★ robot KHÔNG có telemetry ⇒ `estop = null` ⇒ `khong_ro`, KHÔNG suy thành `nha`", async () => {
    /*
     * ⚠⚠ CA NÀY TỪNG XANH GIẢ: bản đầu lặp qua danh sách với guard `if (r.estop === null)`; tiêm đột biến
     * `estop: t?.estop ?? false` ⇒ 6/6 VẪN XANH vì guard không còn khớp ai. ⇒ Phép đo neo vào SỰ THẬT ĐỘC LẬP của DB
     * (robot nào có telemetry), assertion chạy VÔ ĐIỀU KIỆN. Nay robot A, B được TẠO không có telemetry và C có — nên cả hai nhánh luôn tồn tại.
     */
    const coTele = await sql`SELECT DISTINCT "robotId" AS id FROM robot_telemetry WHERE "robotId" IN ${sql([ids.robotA, ids.robotB, ids.robotC])}`;
    const idCoTele = new Set(coTele.map((r) => Number(r.id)));
    expect([...idCoTele]).toEqual([ids.robotC]); // cầu chì: đúng một robot có telemetry

    const ds = await traAnToanRobot(ids.factory);
    const khongTele = ds.filter((r) => !idCoTele.has(r.id));
    expect(khongTele.map((r) => r.ma).sort()).toEqual([ma.A, ma.B].sort());
    for (const r of khongTele) {
      // KHÔNG guard — assertion chạy VÔ ĐIỀU KIỆN, nên `?? false` làm nó ĐỎ.
      expect(r.estop, `robot ${r.ma} chưa từng báo cáo ⇒ estop phải là null`).toBeNull();
      expect(trangThaiAnToan(r)).toBe("khong_ro");
    }
    const c = ds.find((r) => r.id === ids.robotC)!;
    expect(c.estop).toBe(false);
    expect(trangThaiAnToan(c)).toBe("nha");

    // …và tóm tắt phải ĐẾM chúng vào ô riêng, không im lặng gộp vào `soNha`.
    const tt = tomTatAnToan(ds);
    expect(tt.soKhongRo).toBe(2);
    expect(tt.soNha).toBe(1);
    expect(tt.soKhongRo + tt.soNha + tt.dangNhan.length).toBe(ds.length);
  });

  it("★★★ robot ĐÃ VÔ HIỆU HOÁ (`isEnabled=false`) KHÔNG được vào dải an toàn", async () => {
    /*
     * ⚠⚠ VÙNG MÙ CÓ THẬT: đột biến "bỏ lọc `isEnabled = true`" từng 6/6 VẪN XANH vì mọi robot dev đều đang bật, nên KHÔNG có hàng nào để hai nhánh cho
     * hai kết quả khác nhau (đúng G5) ⇒ ca này TỰ DỰNG hàng phân biệt (cùng line/trạm với robot của ca, chỉ khác `isEnabled`) rồi dọn.
     * Vì sao luật đáng canh: robot đã vô hiệu hoá không có ai đứng cạnh; để nó vào dải E-STOP là dạy người trực ca bỏ qua dải ấy.
     */
    const MA = `${RUN}-OFF`;
    const id = await themRobot(MA, { isEnabled: false, status: "estop" });
    robotPhu.push(id);
    const ds = await traAnToanRobot(ids.factory);
    // Hàng vừa thêm mang `status='estop'` — nếu lọc `isEnabled` bị bỏ thì nó LỌT VÀO và làm badge nổi lên vì một robot không ai vận hành.
    expect(ds.map((r) => r.ma)).not.toContain(MA);
    expect(tomTatAnToan(ds).coCanhBao, "robot vô hiệu hoá KHÔNG được làm badge nổi").toBe(false);

    // ★ ĐỐI CHỨNG: cùng hàng đó, bật lên thì nó PHẢI vào — chứng minh ca trên xanh vì lọc `isEnabled`, KHÔNG phải vì hàng bị bỏ sót bởi lý do khác.
    await sql`UPDATE robots SET "isEnabled" = true WHERE id = ${id}`;
    const ds2 = await traAnToanRobot(ids.factory);
    expect(ds2.map((r) => r.ma), "bật lên thì CHÍNH hàng đó phải vào").toContain(MA);
    expect(tomTatAnToan(ds2).coCanhBao).toBe(true);

    // Dọn ngay trong ca (afterAll còn dọn nốt nếu ca chết giữa chừng) ⇒ dải trở lại SẠCH.
    await sql`DELETE FROM robots WHERE id = ${id}`;
    robotPhu.splice(robotPhu.indexOf(id), 1);
    expect(tomTatAnToan(await traAnToanRobot(ids.factory)).coCanhBao).toBe(false);
  });

  it("phạm vi: nhà máy KHÔNG tồn tại trả mảng rỗng, không ném", async () => {
    await expect(traAnToanRobot(999_999)).resolves.toEqual([]);
  });
});
