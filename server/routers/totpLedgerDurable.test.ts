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
/**
 * ⚠⚠⚠ **MỐC PHẢI BÁM THEO ĐỒNG HỒ THẬT — MỘT HẰNG 2023 LÀ MỘT FLAKE, ĐO ĐƯỢC Ở BƯỚC 7.**
 * Sổ nay là một **BẢNG DÙNG CHUNG** và vitest chạy các file test **SONG SONG**. Phép tự dọn của
 * `verifyTotpOnce` xoá **mọi** hàng `expiresAt <= now`, và các file khác gọi nó với `Date.now()`
 * THẬT (2026) ⇒ chúng **quét sạch** hàng mang mốc 2023 của file này **giữa hai lời khẳng định**,
 * và ca A2/A3 đỏ với một lý do **không liên quan gì** tới cái nó đang canh.
 * ⇒ Lấy mốc **tương lai gần** so với đồng hồ thật: hàng của ta có `expiresAt` ở tương lai nên
 *   không lượt dọn nào của ai chạm tới, còn mọi phép so trong file vẫn thuần tất định.
 */
const NOW = Date.now() + 3_600_000;
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

/**
 * ★★★★ Pha 9 (nửa còn lại của **I-3**) — **LÀM GIÀ HÀNG TRONG DB, KHÔNG NÓI DỐI VỀ GIỜ.**
 *
 * Trước lượt vá, một ca *"mục quá hạn"* được dựng bằng cách **truyền `nowMs` nhảy về tương lai** —
 * tức chính cái quyền mà lỗ I-3 cho người gọi: quyết định hạn của sổ bằng đồng hồ của mình. Nay
 * `expiresAt` và cả hai phép so đọc `now()` của **Postgres**, nên một lưới muốn thử nghiệm *"mục đã
 * quá hạn"* phải **thật sự làm hàng ấy quá hạn**.
 *
 * ⚠ Đây là một ca **MẠNH HƠN**, không phải một lượt chiều bản vá: nó thôi phụ thuộc vào việc người
 *   gọi có nói thật về giờ hay không, và nó đo đúng thứ phép dọn thật sự đọc.
 */
async function lamGiaHang(...uids: number[]): Promise<void> {
  const d = await db();
  if (!d) return;
  for (const uid of uids) {
    await d.execute(
      sql`UPDATE "totp_consumed" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "userId" = ${uid}`,
    );
  }
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

    // ★ Pha 9 — làm GIÀ hàng bằng đồng hồ của DB (xem `lamGiaHang`), rồi ghi MỘT lượt ⇒ quét sạch.
    //   ⚠ Trước Pha 9 ca này "nhảy qua hạn" bằng chính `nowMs` — tức bằng đúng cái quyền mà lỗ I-3
    //     trao cho người gọi. Nay `nowMs` chỉ còn lái `speakeasy`.
    await lamGiaHang(USER, USER_KHAC);
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 7 / review TOÀN NHÁNH **I-3** — LƯỚI CANH **CHÍNH BẤT BIẾN**, không canh "dọn có chạy".
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba ca ở §"SỔ TỰ DỌN" bên trên canh *"lượt dọn CÓ chạy và kéo sổ về đúng tập còn sống"*. Không ca
 * nào hỏi ***"nó dọn của AI"*** — và đó đúng là chỗ lỗ nằm: `donSo` chạy `DELETE` **TOÀN BẢNG** lái
 * bằng `nowMs` của **người gọi**, nên một lượt xác minh của B với đồng hồ đi trước **xoá sạch mục
 * của A**, rồi A **phát lại được** chính mã đã tiêu (đo được — xem docstring `donSo`).
 *
 * ⚠⚠ Bất biến được phát biểu ở dạng **∀ CẶP NGƯỜI DÙNG**, không phải "hai userId cụ thể":
 *   ***∀ lượt xác minh của người dùng P: nó KHÔNG được làm đổi sổ của bất kỳ người dùng Q ≠ P nào,
 *   với MỌI đồng hồ mà P mang tới.***
 * ⚠ Đây là lưới **HÀNH VI trên DB THẬT**, đi đúng đường thoát (`verifyTotpOnce` → drizzle →
 *   Postgres): một lưới giả trong bộ nhớ chính là thứ lỗ này đã lọt qua.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Người dùng thứ BA — của riêng khối này, để không tranh với các ca ở trên. */
const USER_BA = 90_003;
const SECRET_BA = "MFRGGZDFMZTWQ2LKNNWG23TPOBYGC4TT";

async function demCua(uid: number): Promise<number> {
  const d = await db();
  if (!d) return -1;
  const r = await d.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM "totp_consumed" WHERE "userId" = ${uid}`,
  );
  return Number((r as unknown as { n: number }[])[0]?.n ?? 0);
}

async function donBa(): Promise<void> {
  const d = await db();
  if (!d) return;
  await d.execute(sql`DELETE FROM "totp_consumed" WHERE "userId" = ${USER_BA}`);
}

describe("★★★ I-3 — lượt dọn của MỘT người dùng KHÔNG được chạm sổ của người dùng KHÁC", () => {
  beforeEach(donBa);
  afterAll(donBa);

  it("★★★★ B xác minh với đồng hồ ĐI TRƯỚC ⇒ mục của A còn nguyên, và A vẫn KHÔNG phát lại được", async () => {
    const t = await tienTrinhMoi();

    // ── A tiêu một mã ở đồng hồ THẬT ──
    const gioA = Date.now();
    const maA = maLuc(SECRET, gioA);
    expect(
      (await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maA, nowMs: gioA })).hopLe,
      "cầu chì: lượt tiêu mã đầu tiên của A phải QUA",
    ).toBe(true);
    expect(await demCua(USER), "cầu chì: sổ của A phải có ĐÚNG mục vừa ghi").toBe(1);

    // ── B xác minh ở +1h (đúng khuôn `NOW` của chính file này, và của mọi lưới lái đồng hồ) ──
    const gioB = gioA + 3_600_000;
    expect(
      (await t.verifyTotpOnce({ userId: USER_BA, secret: SECRET_BA, token: maLuc(SECRET_BA, gioB), nowMs: gioB }))
        .hopLe,
      "cầu chì: lượt của B phải QUA (nếu không, ca dưới xanh vì B chẳng làm gì)",
    ).toBe(true);

    // ── Bất biến 1: sổ của A KHÔNG suy suyển ──
    expect(
      await demCua(USER),
      "một lượt xác minh của NGƯỜI KHÁC xoá mục của A ⇒ `donSo` đang DELETE toàn bảng bằng đồng hồ người gọi",
    ).toBe(1);

    // ── Bất biến 2 (cái thật sự quan trọng): A phát lại KHÔNG ĐƯỢC ──
    const phatLai = await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maA, nowMs: gioA });
    expect(
      phatLai.hopLe,
      "A PHÁT LẠI được chính mã đã tiêu ⇒ lỗ A2/A3 mà mig 0313 sinh ra để đóng đã MỞ LẠI",
    ).toBe(false);
    expect(phatLai.phatLai, "và phải nói ĐÚNG LÝ DO: chặn vì SỔ").toBe(true);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — lượt dọn VẪN dọn: mục quá hạn của CHÍNH người ấy bị quét", async () => {
    /**
     * ⚠ Không có ô này thì một bản vá *"thôi dọn hẳn"* cũng làm ca trên XANH — và sổ phình vô hạn.
     * Đây là nửa còn lại của cặp: **thu hẹp**, không phải **tắt**.
     */
    const t = await tienTrinhMoi();
    const t0 = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 4; i++) {
      const giay = t0 + i * 30;
      await t.verifyTotpOnce({
        userId: USER_BA, secret: SECRET_BA, token: maLuc(SECRET_BA, giay * 1000), nowMs: giay * 1000,
      });
    }
    const dinh = await demCua(USER_BA);
    expect(dinh, "phải có một ĐỈNH thật thì phép dọn mới đo được").toBeGreaterThan(1);

    await lamGiaHang(USER_BA); // ★ Pha 9 — quá hạn THẬT theo đồng hồ DB, không phải theo lời khai.
    const sau = t0 + Math.ceil(t.TOTP_HAN_SO_MS / 1000) + 300;
    expect(
      (await t.verifyTotpOnce({
        userId: USER_BA, secret: SECRET_BA, token: maLuc(SECRET_BA, sau * 1000), nowMs: sau * 1000,
      })).hopLe,
    ).toBe(true);
    expect(
      await demCua(USER_BA),
      `lượt dọn của CHÍNH người ấy phải kéo sổ về ĐÚNG 1 mục (đỉnh trước đó ${dinh})`,
    ).toBe(1);
  });

  it("★★★ …và lượt dọn ấy vẫn KHÔNG chạm người khác (đối chứng bắc cầu của hai ca trên)", async () => {
    const t = await tienTrinhMoi();
    const gioA = Date.now();
    await t.verifyTotpOnce({ userId: USER, secret: SECRET, token: maLuc(SECRET, gioA), nowMs: gioA });
    const cuaA = await demCua(USER);
    expect(cuaA, "cầu chì: A phải có mục").toBeGreaterThan(0);

    // B chạy đúng kịch bản DỌN THẬT ở ca trên — lượt dọn CÓ chạy, và nó vẫn phải bỏ qua A.
    const t0 = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 3; i++) {
      const giay = t0 + i * 30;
      await t.verifyTotpOnce({
        userId: USER_BA, secret: SECRET_BA, token: maLuc(SECRET_BA, giay * 1000), nowMs: giay * 1000,
      });
    }
    // ★ Pha 9 — làm già hàng của **B mà thôi**, để lượt dọn của B THẬT SỰ có việc để làm. Không có
    //   dòng này, ca dưới xanh vì "chẳng ai dọn gì" — một chân lý rỗng.
    await lamGiaHang(USER_BA);
    const sau = t0 + Math.ceil(t.TOTP_HAN_SO_MS / 1000) + 300;
    await t.verifyTotpOnce({
      userId: USER_BA, secret: SECRET_BA, token: maLuc(SECRET_BA, sau * 1000), nowMs: sau * 1000,
    });
    expect(await demCua(USER_BA), "cầu chì: lượt dọn của B PHẢI thật sự quét (nếu không ca này rỗng)").toBe(1);

    expect(await demCua(USER), "lượt dọn CÓ CHẠY của B vẫn không được chạm hàng của A").toBe(cuaA);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ Pha 9 · **I-3b — NỬA CÒN LẠI: ĐỒNG HỒ CỦA NGƯỜI GỌI KHÔNG CHẠM ĐƯỢC SỔ.**
 *
 * Nợ khai ở Pha 7 (`donSo` docstring): *"lượt dọn vẫn lái bằng `nowMs` của người gọi … lời giải
 * trọn vẹn là đưa đồng hồ của sổ xuống DB … `tieuMaTrongSo` cũng lái bằng `nowMs` — cùng một nợ,
 * cùng một lời giải."* Khối này là chỗ bất biến ấy được **NEO**:
 *
 *   ***Một lượt gọi với đồng hồ lệch KHÔNG đổi được kết quả của người khác, và KHÔNG kéo dài / rút
 *   ngắn hiệu lực của chính mã mình.***
 *
 * ⚠ Vế *"người khác"* đã có ba ca ở §I-3 ngay trên. Khối này canh vế *"chính mình"* — vế mà **không
 *   ca nào** trước đây hỏi, vì mọi ca đều **dùng** quyền lái đồng hồ ấy thay vì nghi ngờ nó.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
describe("★★★★ I-3b — `nowMs` KHÔNG kéo dài/rút ngắn hiệu lực của chính mục mình ghi", () => {
  const USER_TU = 90_004;
  const SECRET_TU = "NBSWY3DPEB3W64TMMQXC6ZLOMNXW2LTD";

  async function hanCua(uid: number): Promise<number[]> {
    const d = await db();
    if (!d) return [];
    const r = await d.execute<{ ms: number }>(
      sql`SELECT (extract(epoch from "expiresAt") * 1000)::bigint AS ms FROM "totp_consumed" WHERE "userId" = ${uid}`,
    );
    return (r as unknown as { ms: string | number }[]).map((x) => Number(x.ms));
  }

  async function dbNowMs(): Promise<number> {
    const d = await db();
    if (!d) return Date.now();
    const r = await d.execute<{ ms: number }>(
      sql`SELECT (extract(epoch from (now() AT TIME ZONE 'UTC')) * 1000)::bigint AS ms`,
    );
    return Number((r as unknown as { ms: string | number }[])[0]?.ms ?? Date.now());
  }

  const don = async (): Promise<void> => {
    const d = await db();
    if (d) await d.execute(sql`DELETE FROM "totp_consumed" WHERE "userId" = ${USER_TU}`);
  };
  beforeEach(don);
  afterAll(don);

  it("★★★★ đồng hồ +1h ⇒ `expiresAt` vẫn bám ĐỒNG HỒ DB, không bám đồng hồ người gọi", async () => {
    /**
     * ⚠⚠⚠ ĐO ĐƯỢC TRƯỚC BẢN VÁ: `expiresAt = new Date(nowMs + TOTP_HAN_SO_MS)` ⇒ với `nowMs` đi
     *    trước **một giờ**, mục sống thêm **một giờ + 120 s** — tức người gọi tự quyết định hiệu
     *    lực của chính hàng mình ghi. Ca này khoá cửa ấy bằng một phép so **SỐ**, không bằng lời.
     * ⚠ Biên: `[dbNow, dbNow + HAN + 5 s]`. Cận dưới bắt bản vá *"ghi một mốc quá khứ"* (rút ngắn ⇒
     *   mở lại cửa phát lại); cận trên bắt bản vá *"vẫn cộng đồng hồ người gọi"* (lệch một giờ ⇒
     *   vượt xa 5 s trượt của một lượt đo).
     */
    const t = await tienTrinhMoi();
    const lech = Date.now() + 3_600_000; // ĐỒNG HỒ LỆCH +1h — đúng khuôn `NOW` của file này.
    const truoc = await dbNowMs();
    expect(
      (await t.verifyTotpOnce({ userId: USER_TU, secret: SECRET_TU, token: maLuc(SECRET_TU, lech), nowMs: lech }))
        .hopLe,
      "cầu chì: lượt tiêu mã phải QUA (nếu không, ca này không đo gì)",
    ).toBe(true);

    const han = await hanCua(USER_TU);
    expect(han.length, "cầu chì: phải có ĐÚNG một mục vừa ghi").toBe(1);
    const tran = truoc + t.TOTP_HAN_SO_MS + 5_000;
    expect(
      han[0]! <= tran,
      `expiresAt (${han[0]}) vượt trần đồng hồ DB (${tran}) ⇒ người gọi đang KÉO DÀI hiệu lực mục ` +
        "của chính mình bằng `nowMs` — nửa còn lại của lỗ I-3 vẫn mở",
    ).toBe(true);
    expect(
      han[0]! >= truoc,
      "`expiresAt` nằm ở QUÁ KHỨ ⇒ mục chết ngay khi sinh ⇒ cửa PHÁT LẠI mở lại",
    ).toBe(true);
  });

  it("★★★★ đồng hồ +1h KHÔNG thu lại được mục CÒN SỐNG của chính mình (phát lại vẫn bị chặn)", async () => {
    /**
     * ⚠⚠ Nhánh `CASE WHEN expiresAt <= <đồng hồ> THEN excluded."luot"` là cửa **thu lại**. Trước bản
     *    vá, `<đồng hồ>` là của **người gọi**, nên một lượt gọi lệch đủ xa thu lại được **mục còn
     *    sống của chính mình** ⇒ `luot` mới thắng ⇒ **PHÁT LẠI ĐƯỢC**. Nay cả hai vế đọc `now()` của
     *    Postgres, nên một đồng hồ lệch không mở được cửa ấy.
     * ⚠ Cùng `nowMs` cho cả hai lượt (để `speakeasy` chấp nhận cùng mã), **khác `luot`** ⇒ đúng hình
     *   dạng một lượt gọi THỨ HAI.
     */
    const t = await tienTrinhMoi();
    const lech = Date.now() + 3_600_000;
    const ma = maLuc(SECRET_TU, lech);
    expect(
      (await t.verifyTotpOnce({ userId: USER_TU, secret: SECRET_TU, token: ma, nowMs: lech, luot: "L1" })).hopLe,
    ).toBe(true);
    const kq = await t.verifyTotpOnce({ userId: USER_TU, secret: SECRET_TU, token: ma, nowMs: lech, luot: "L2" });
    expect(kq.hopLe, "một lượt gọi KHÁC thu lại được mục CÒN SỐNG ⇒ chống phát lại đã hỏng").toBe(false);
    expect(kq.phatLai, "và phải nói ĐÚNG LÝ DO: chặn vì SỔ").toBe(true);
    expect(await hanCua(USER_TU), "lượt bị chặn KHÔNG được thêm hàng nào").toHaveLength(1);
  });

  it("★★★★ THEO CẤU TRÚC — `nowMs` không còn ĐƯỜNG NÀO tới sổ (AST, không đọc bình luận)", async () => {
    /**
     * ⚠⚠⚠ Hai ca trên là HÀNH VI; ca này là **CẤU TRÚC**, và nó bắt đúng thứ hành vi không thấy:
     *    một lượt vá sau chỉ cần thêm lại một tham số `nowMs` vào `tieuMaTrongSo`/`donSo` là lỗ mở
     *    lại — hai ca trên vẫn xanh chừng nào **giá trị** truyền vào tình cờ đúng.
     * ⚠ Đọc bằng **AST**, vì chuỗi `nowMs` đang nằm đầy trong khối bình luận của chính file ấy (đã
     *   trả giá: `git grep` đọc bình luận thành lượt nhập; một ô `indexOf` xanh dưới chính đột biến
     *   của nó).
     */
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const tsMod = (await import("typescript")).default;
    const duong = path.join(process.cwd(), "server", "_core", "totpOnce.ts");
    const sf = tsMod.createSourceFile(
      duong,
      await fs.readFile(duong, "utf8"),
      tsMod.ScriptTarget.Latest,
      true,
    );

    /** Tham số của một khai báo hàm, tra theo TÊN. */
    const thamSo = (nguon: import("typescript").SourceFile, ten: string): string[] | null => {
      let ra: string[] | null = null;
      const di = (n: import("typescript").Node): void => {
        if (tsMod.isFunctionDeclaration(n) && n.name !== undefined && n.name.text === ten) {
          ra = n.parameters.map((p) => (tsMod.isIdentifier(p.name) ? p.name.text : "?"));
        }
        n.forEachChild(di);
      };
      di(nguon);
      return ra;
    };

    expect(thamSo(sf, "tieuMaTrongSo"), "không thấy `tieuMaTrongSo` ⇒ bộ dò mất điểm neo").not.toBeNull();
    expect(
      thamSo(sf, "tieuMaTrongSo"),
      "`tieuMaTrongSo` nhận lại một tham số thời gian của NGƯỜI GỌI ⇒ nửa còn lại của I-3 mở lại",
    ).toEqual(["userId", "tokenHash", "luot"]);
    expect(
      thamSo(sf, "donSo"),
      "`donSo` nhận lại một tham số thời gian của NGƯỜI GỌI ⇒ lỗ I-3 mở lại",
    ).toEqual(["userId"]);

    // ĐỐI CHỨNG DƯƠNG cho chính bộ dò: nó THẤY một chữ ký còn tham số thời gian.
    const gia = tsMod.createSourceFile(
      "gia.ts",
      "async function tieuMaTrongSo(userId, tokenHash, luot, nowMs) { return null; }",
      tsMod.ScriptTarget.Latest,
      true,
    );
    expect(
      thamSo(gia, "tieuMaTrongSo"),
      "bộ dò MÙ với một chữ ký còn `nowMs` ⇒ hai ô trên là chân lý rỗng",
    ).toEqual(["userId", "tokenHash", "luot", "nowMs"]);
  });

  it("★★★ ∀ điểm gọi SẢN XUẤT của `verifyTotpOnce`: KHÔNG truyền `nowMs`", async () => {
    /**
     * ⚠ `nowMs` còn lại ở chữ ký công khai của `verifyTotpOnce` (để lưới đúc mã ở nhịp bất kỳ).
     *   Nó **không** còn chạm sổ, nhưng nó vẫn lái đồng hồ của `speakeasy` — một điểm gọi sản xuất
     *   truyền nó vào là dựng một cửa sổ TOTP do người gọi định nghĩa. Đo được hôm nay: **0** điểm.
     */
    const { readFileSync } = await import("node:fs");
    const tsMod = (await import("typescript")).default;
    const { moiFileDuoi, laFileTest } = await import("./deployProcedureScan");
    const pham: string[] = [];
    let soDiem = 0;
    for (const f of moiFileDuoi(process.cwd(), "server", [".ts"]).filter((x) => !laFileTest(x.duong))) {
      const ma = readFileSync(f.that, "utf8");
      if (!ma.includes("verifyTotpOnce")) continue;
      const sf = tsMod.createSourceFile(f.duong, ma, tsMod.ScriptTarget.Latest, true);
      const di = (n: import("typescript").Node): void => {
        if (
          tsMod.isCallExpression(n) &&
          tsMod.isIdentifier(n.expression) &&
          n.expression.text === "verifyTotpOnce"
        ) {
          soDiem++;
          const a0 = n.arguments[0];
          if (a0 !== undefined && tsMod.isObjectLiteralExpression(a0)) {
            for (const p of a0.properties) {
              const ten = p.name !== undefined && tsMod.isIdentifier(p.name) ? p.name.text : "";
              if (ten === "nowMs") {
                pham.push(`${f.duong}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
              }
            }
          }
        }
        n.forEachChild(di);
      };
      di(sf);
    }
    expect(soDiem, "0 điểm gọi sản xuất ⇒ ô này là chân lý rỗng").toBeGreaterThanOrEqual(8);
    expect(
      pham.join(" · "),
      "một điểm gọi SẢN XUẤT truyền `nowMs` ⇒ cửa sổ TOTP do người gọi định nghĩa. `nowMs` là tham số CỦA LƯỚI.",
    ).toBe("");
  });
});
