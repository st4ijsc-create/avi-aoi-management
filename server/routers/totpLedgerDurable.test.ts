/**
 * ★★★ Pha 7 Task 5 (A) — **SỔ MÃ OTP SỐNG QUA RESTART VÀ DÙNG CHUNG GIỮA TIẾN TRÌNH.**
 *
 * (Lưới này đóng nợ **Pha 5** · Pha 6 · Pha 7 nên nó **tự khai `Pha 5`** để `vramPha5Gate.test.ts` kéo
 * nó vào lượng từ *"mọi lưới Pha 5 phải được §Cổng kiểm chung phủ"* — cùng khuôn `totpReplay.test.ts`.
 * ⚠ Không có dòng khai này, file nằm ở `server/routers/` và **không đường nào của cổng phủ nó** ⇒
 * lưới quyết định nhất của mục (A) sẽ **không bao giờ chạy ở cổng**. Đúng lớp *"hàng rào không ai
 * canh"* — và chính `vramPha5Gate` đã bắt được nó ở lượt này, bằng phép ghim SỐ.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ FILE NÀY CHẠY TRÊN **DB THẬT** (`aoi_management_test`) — CÓ LÝ DO, KHÔNG PHẢI LƯỜI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Câu cần chứng minh là ***"trạng thái sống LÂU HƠN tiến trình và ĐƯỢC CHIA SẺ giữa tiến trình"***.
 * Một cuốn sổ giả trong bộ nhớ **không thể** chứng minh câu đó — nó lại chính là thứ vừa bị bác bỏ.
 * ⇒ Lưới ở đây đi theo **ĐƯỜNG THOÁT THẬT** (ràng buộc 10): `verifyTotpOnce()` → drizzle → Postgres
 *   → bảng `totp_consumed` (migration 0313). `vitest.setup.ts` ép `DATABASE_URL` sang DB test.
 *
 * ⚠⚠ **"RESTART" ĐƯỢC MÔ PHỎNG BẰNG `vi.resetModules()`, VÀ ĐÓ LÀ MÔ HÌNH ĐÚNG:** lượt ấy vứt sạch
 * **mọi trạng thái trong bộ nhớ của module** rồi nạp lại từ đầu — đúng bằng thứ một lượt `node`
 * chết-rồi-lên-lại làm với sổ cũ. Ca **A2** ở Bước 1 đã dùng chính khuôn này để **chứng minh lỗ**
 * (`__soTotpSize()` về 0, mã đi qua); nay cùng khuôn ấy phải cho câu trả lời **ngược lại**.
 *
 * ⚠ FILE **TÁCH RIÊNG** khỏi lưới mục (B) — đã đo ở Bước 1: `vi.resetModules()` của mục A làm lượt
 *   `await import("./vramBroker")` **muộn** trong `dungLaiTuSoCucBo()` nhận một **bản sao module mới
 *   có sổ RỖNG**, và mục B sẽ đo nhầm thứ. Hai mục, hai file — không phải khẩu vị.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import speakeasy from "speakeasy";
import { sql } from "drizzle-orm";

/** Secret 2FA THẬT — đường verify chạy `speakeasy.totp.verify` nguyên bản trên nó. */
const SECRET = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
const SECRET_KHAC = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOW = 1_700_000_000_000;
const USER = 90_001;
const USER_KHAC = 90_002;

function maLuc(secret: string, ms: number): string {
  return speakeasy.totp({ secret, encoding: "base32", time: Math.floor(ms / 1000) });
}

/** Nạp một **bản sao MỚI** của module — mô hình của một lượt khởi động tiến trình. */
async function tienTrinhMoi() {
  vi.resetModules();
  return await import("../_core/totpOnce");
}

async function db() {
  const { getDb } = await import("../db/connection");
  return await getDb();
}

/** Dọn đúng hai người dùng của file này — KHÔNG `DELETE` cả bảng (file khác có thể chạy song song). */
async function donRieng(): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.execute(sql`DELETE FROM "totp_consumed" WHERE "userId" IN (${USER}, ${USER_KHAC})`);
}

async function demRieng(): Promise<number> {
  const d = await db();
  if (!d) return 0;
  const r = await d.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM "totp_consumed" WHERE "userId" IN (${USER}, ${USER_KHAC})`,
  );
  return Number((r as unknown as { n: number }[])[0]?.n ?? 0);
}

beforeAll(async () => {
  const d = await db();
  expect(d, "file này ĐÒI một DB thật — chạy `node scripts/setup-test-db.mjs` nếu chưa có").not.toBeNull();
  // ⚠ Bảng phải TỒN TẠI. Không có phép kiểm này thì một DB chưa migrate cho ra một loạt ca "đỏ vì
  //   thiếu bảng" mà người đọc sẽ tưởng là "cơ chế hỏng" — hai chẩn đoán rất khác nhau.
  const t = await d!.execute<{ t: string | null }>(sql`SELECT to_regclass('public.totp_consumed')::text AS t`);
  expect(
    (t as unknown as { t: string | null }[])[0]?.t,
    "bảng `totp_consumed` CHƯA có ⇒ migration 0313 chưa áp lên DB test",
  ).toBe("totp_consumed");
});

beforeEach(async () => {
  delete process.env.ROLE;
  await donRieng();
});

afterAll(donRieng);

describe("★★★ (A) Bước 7 / ĐỘT BIẾN — mã đã tiêu bị chặn QUA RESTART", () => {
  it("★★★ A2 — mã tiêu ở tiến trình #1 ⇒ tiến trình #2 (sau restart) TỪ CHỐI nó", async () => {
    const ma = maLuc(SECRET, NOW);

    const t1 = await tienTrinhMoi();
    expect((await t1.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW })).hopLe).toBe(true);

    // ── RESTART: mọi trạng thái trong bộ nhớ biến mất. Sổ thì KHÔNG. ──
    const t2 = await tienTrinhMoi();
    const kq = await t2.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW + 30_000 });

    expect(kq.hopLe, "RFC 6238 §5.2: mã đã tiêu KHÔNG được nhận lần hai — kể cả qua một lượt restart").toBe(false);
    expect(kq.phatLai, "và phải nói ĐÚNG LÝ DO: chặn vì SỔ, không phải vì mã hỏng").toBe(true);
  });

  it("★★★ A3 — hai bản sao `ROLE=api`: mã tiêu ở A ⇒ B TỪ CHỐI (một sổ, không hai)", async () => {
    const ma = maLuc(SECRET, NOW);

    process.env.ROLE = "api";
    const A = await tienTrinhMoi();
    expect((await A.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW })).hopLe).toBe(true);

    const B = await tienTrinhMoi(); // bản sao THỨ HAI của cùng vai
    const kq = await B.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW + 1_000 });
    delete process.env.ROLE;

    expect(kq.hopLe, "hai bản sao `api` phải dùng CHUNG một cuốn sổ").toBe(false);
    expect(kq.phatLai).toBe(true);
  });

  it("★★ trong CÙNG tiến trình, phát lại vẫn bị chặn (hành vi cũ KHÔNG được mất)", async () => {
    const ma = maLuc(SECRET, NOW);
    const t = await tienTrinhMoi();
    expect((await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW })).hopLe).toBe(true);
    expect(await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW + 1_000 })).toEqual({
      hopLe: false,
      phatLai: true,
    });
  });
});

describe("★★★ (A) Bước 6 / ĐỐI CHỨNG DƯƠNG — cái ĐÚNG vẫn phải đi qua", () => {
  it("★★★ mã MỚI (nhịp sau) vẫn qua — bản vá KHÔNG chặn mọi thứ", async () => {
    const t = await tienTrinhMoi();
    const ma1 = maLuc(SECRET, NOW);
    expect((await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma1, nowMs: NOW })).hopLe).toBe(true);

    // Một nhịp KHÁC ⇒ mã khác ⇒ phải qua, kể cả qua restart.
    const sau = NOW + 90_000;
    const ma2 = maLuc(SECRET, sau);
    expect(ma2, "fixture phải là một mã KHÁC, nếu không ca này không đo gì").not.toBe(ma1);
    const t2 = await tienTrinhMoi();
    expect(
      (await t2.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma2, nowMs: sau })).hopLe,
      "mã MỚI phải qua — nếu không, bản vá đã giết đường xác minh",
    ).toBe(true);
  });

  it("★★★ CÙNG một lượt gọi verify 3 LẦN với cùng `luot` ⇒ CẢ BA qua (chuỗi thật của `vram.preempt`)", async () => {
    /**
     * ⚠ Đây là ca chống đúng lỗi mà `luot` sinh ra để tránh: chuỗi thật chạy
     * `requireFreshTotp` → `requirePerCallFreshTotp` → `requirePermission` → `requirePerCallFreshTotp`
     * ⇒ **2-3 lượt verify cho MỘT lượt bấm nút**. Một cuốn sổ ngây thơ sẽ tự chặn mình ở lượt thứ
     * hai và giết **100 %** lệnh VRAM/deploy.
     */
    const t = await tienTrinhMoi();
    const ma = maLuc(SECRET, NOW);
    const chung = { userId: USER, secret: SECRET, token: ma, nowMs: NOW, luot: "L1" };
    expect((await t.verifyTotpOnce(chung)).hopLe, "lượt verify #1 của lượt gọi L1").toBe(true);
    expect((await t.verifyTotpOnce(chung)).hopLe, "lượt verify #2 của CÙNG lượt gọi L1").toBe(true);
    expect((await t.verifyTotpOnce(chung)).hopLe, "lượt verify #3 của CÙNG lượt gọi L1").toBe(true);

    // …và một lượt gọi KHÁC với cùng mã thì KHÔNG — kể cả sau restart.
    const t2 = await tienTrinhMoi();
    expect(await t2.verifyTotpOnce({ ...chung, luot: "L2" }), "lượt gọi KHÁC ⇒ PHÁT LẠI").toEqual({
      hopLe: false,
      phatLai: true,
    });
  });

  it("★★ KHÔNG BẮT NHẦM NGƯỜI — hai người dùng, CÙNG một mã 6 số, người thứ hai vẫn qua", async () => {
    /**
     * ⚠⚠ **BẢN ĐẦU QUÉT TÌM MỘT VA CHẠM THẬT giữa hai secret — và nó tốn 10,9 s mỗi lượt chạy cổng
     * cho một tính chất mà một fixture dựng thẳng chứng minh **mạnh hơn**.** Dùng **CÙNG một
     * secret** cho hai `userId` khác nhau cho ra **đúng** tình huống cần đo — *"hai người dùng, một
     * chuỗi 6 số"* — mà **tất định** và **tức thì**, thay vì phụ thuộc vào việc dò được va chạm
     * trong một khoảng quét (nếu không dò được, bản cũ **lặng lẽ `return`** ⇒ một ca XANH mà **không
     * đo gì**, đúng lớp "lưới giả").
     * ⚠ Tính chất bị khoá vẫn nguyên: khoá sổ là `(userId, sha256(userId:token))` ⇒ **`userId` ở cả
     *   hai lớp**, nên người thứ hai không thể bị chặn nhầm.
     */
    const t = await tienTrinhMoi();
    const ma = maLuc(SECRET, NOW);
    expect((await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW })).hopLe).toBe(true);
    expect(
      (await t.verifyTotpOnce({ userId: USER_KHAC, secret: SECRET, token: ma, nowMs: NOW })).hopLe,
      "khoá sổ có `userId` ⇒ người thứ hai KHÔNG bị chặn nhầm",
    ).toBe(true);
    // …và người thứ hai giờ cũng bị chặn nếu CHÍNH ANH TA phát lại (không phải một cửa nới).
    expect(
      (await t.verifyTotpOnce({ userId: USER_KHAC, secret: SECRET, token: ma, nowMs: NOW + 1_000 })).phatLai,
      "phân tách theo người dùng KHÔNG được biến thành một cửa thoát cho chính người ấy",
    ).toBe(true);
  });

  it("★★ mã SAI không được ghi sổ (nếu không, sổ thành một bề mặt DoS)", async () => {
    const t = await tienTrinhMoi();
    const truoc = await demRieng();
    expect(await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: "000000", nowMs: NOW })).toEqual({
      hopLe: false,
      phatLai: false,
    });
    expect(await demRieng(), "mã KHÔNG verify được thì KHÔNG được chạm vào sổ").toBe(truoc);
  });
});

describe("★★★ (A) Bước 8 — SỔ TỰ DỌN, ĐO ĐƯỢC (không chỉ khai)", () => {
  it("★★★ đỉnh nhiều mục ⇒ sau khi quá hạn, một lượt ghi kéo về ĐÚNG 1", async () => {
    const t = await tienTrinhMoi();
    const t0 = Math.floor(NOW / 1000);

    // Bơm nhiều mã ở nhiều nhịp khác nhau ⇒ sổ phình lên.
    for (let i = 0; i < 6; i++) {
      const giay = t0 + i * 30;
      await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maLuc(SECRET, giay * 1000), nowMs: giay * 1000 });
    }
    const dinh = await demRieng();
    expect(dinh, "phải có một ĐỈNH thật thì phép dọn mới đo được").toBeGreaterThan(1);

    // Nhảy qua hạn rồi ghi MỘT lượt ⇒ mọi mục chết bị quét.
    const sau = t0 + Math.ceil(t.TOTP_HAN_SO_MS / 1000) + 300;
    const kq = await t.verifyTotpOnce({
      userId: USER, secret: SECRET, token: maLuc(SECRET, sau * 1000), nowMs: sau * 1000,
    });
    expect(kq.hopLe, "mã của nhịp mới phải qua").toBe(true);
    expect(await demRieng(), `sổ phải tự dọn: còn ĐÚNG 1 mục (đỉnh trước đó ${dinh})`).toBe(1);
  });

  it("★★★ TÍNH CHẤT ĐƯỢC GIỮ: bảng KHÔNG lớn lên nếu KHÔNG có lượt ghi", async () => {
    /**
     * ⚠ Đây là câu mà bản trong bộ nhớ **chứng minh được**, và lượt chuyển xuống DB **không được
     * làm mất**. Một lượt bị chặn (phát lại) hoặc một mã sai đều KHÔNG thêm hàng nào.
     */
    const t = await tienTrinhMoi();
    const ma = maLuc(SECRET, NOW);
    await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW });
    const sauLuotGhi = await demRieng();

    for (let i = 0; i < 5; i++) {
      await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: ma, nowMs: NOW + 1_000 }); // phát lại
      await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: "000000", nowMs: NOW }); // mã sai
    }
    expect(await demRieng(), "10 lượt KHÔNG-ghi ⇒ bảng KHÔNG được lớn thêm một hàng nào").toBe(sauLuotGhi);
  });

  it("★★ phép dọn KHÔNG đứng trên một nhịp hẹn giờ / cron nào — canh THEO CẤU TRÚC", async () => {
    /**
     * ⚠⚠ **CA NÀY TỪNG ĐƯỢC VIẾT SAI, GHI LẠI ĐỂ KHÔNG AI VIẾT LẠI KIỂU ẤY:** bản đầu `spyOn`
     * `setTimeout`/`setInterval` rồi đòi *"không lần gọi nào"*. Nó **ĐỎ vì một lý do sai** — chính
     * **driver `postgres`** dựng hẹn giờ cho lượt kết nối và cho `idle_timeout` (đo được: **3** lượt
     * gọi, gồm `connect` và hai `done`). Tức phép canh ấy đo **thư viện**, không đo **luật của ta**.
     *
     * ⇒ Luật cần canh là một tính chất của **MÃ NÀY**: *"`totpOnce.ts` không tự dựng một nhịp nào"*.
     *   Canh nó ở đúng chỗ nó sống — **văn bản nguồn** — thì không có cửa nào cho một lượt gọi của
     *   thư viện đi nhầm vào phép đo.
     */
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const nguon = await fs.readFile(
      path.join(process.cwd(), "server", "_core", "totpOnce.ts"),
      "utf8",
    );
    for (const cam of ["setInterval(", "setTimeout(", "node-cron", "cron.schedule"]) {
      expect(
        nguon.includes(cam),
        `\`totpOnce.ts\` dựng \`${cam}\` ⇒ phép dọn đã rời khỏi lượt xác minh và thành HỆ QUẢ của ` +
          `một nhịp khác còn sống (lăng kính đã bắt lỗi sáu lần)`,
      ).toBe(false);
    }
  });
});

describe("★★★ (A) FAIL-CLOSED — sổ không hỏi được thì TỪ CHỐI, không cho qua", () => {
  it("★★★ DB ném ⇒ `hopLe:false` (cho qua lúc này là mở lại cửa PHÁT LẠI)", async () => {
    vi.resetModules();
    vi.doMock("../db/connection", () => ({
      getDb: vi.fn(async () => ({
        execute: () => { throw new Error("ECONNREFUSED (giả lập)"); },
      })),
    }));
    const t = await import("../_core/totpOnce");
    const kq = await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maLuc(SECRET, NOW), nowMs: NOW });
    expect(kq.hopLe, "sổ chống phát lại KHÔNG đọc được ⇒ TỪ CHỐI").toBe(false);
    expect(kq.phatLai, "và KHÔNG được khai là 'phát lại' — ta không biết điều đó").toBe(false);
    vi.doUnmock("../db/connection");
    vi.resetModules();
  });

  it("★★★ KHÔNG có DB ⇒ TỪ CHỐI (`null` là KHÔNG BIẾT, không phải 'chưa ai tiêu')", async () => {
    vi.resetModules();
    vi.doMock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
    const t = await import("../_core/totpOnce");
    expect(
      (await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maLuc(SECRET, NOW), nowMs: NOW })).hopLe,
    ).toBe(false);
    vi.doUnmock("../db/connection");
    vi.resetModules();
  });

  it("★★ `ROLE=worker` ⇒ TỪ CHỐI + kêu (hàng rào lúc chạy vẫn sống)", async () => {
    process.env.ROLE = "worker";
    const t = await tienTrinhMoi();
    const keu = vi.spyOn(console, "error").mockImplementation(() => {});
    const kq = await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maLuc(SECRET, NOW), nowMs: NOW });
    delete process.env.ROLE;
    expect(kq.hopLe).toBe(false);
    expect(keu, "một lượt xác minh ở tiến trình không phục vụ HTTP phải KÊU TO").toHaveBeenCalled();
    keu.mockRestore();
  });
});
