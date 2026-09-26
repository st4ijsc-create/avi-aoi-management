/**
 * ★★★★ Pha 9 nhóm A · **A6 — LƯỚI HÀNH VI CHO BỀ MẶT REST: GỌI THẬT, ĐỌC MÃ TRẠNG THÁI THẬT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 *   ***∀ tuyến REST được đăng ký bởi các registrar dưới đây: một yêu cầu KHÔNG mang cookie phải
 *   bị từ chối bằng **401/403**, KHÔNG bao giờ bằng 5xx — trừ các tuyến được KHAI TÊN là auth-free.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO LƯỚI **HÀNH VI**, KHÔNG PHẢI LƯỚI HÌNH DẠNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước lượt này, thứ duy nhất canh các bề mặt ngoài tRPC là **suy luận cấu tạo**: *"cả 11 tuyến
 * đều bọc lượt xác thực trong `try/catch` trả 401/403 ⇒ SUY RA chúng từ chối"*. Suy luận ấy **ĐÚNG
 * về chiều** (không ai vào được) và **SAI về sự thật đo được**:
 *
 *     gọi THẬT từng tuyến, không cookie ⇒ **6** tuyến trả **500**, không phải 401.
 *
 * Nhánh `if (!user) res.status(401)` viết sẵn ở sáu chỗ ấy là **MÃ CHẾT**:
 * `sdk.authenticateRequest` **NÉM** chứ không trả `null`, nên lượt ném rơi thẳng vào `catch` ⇒ 500.
 * Một lưới đọc mã sẽ thấy đủ `try`, đủ `catch`, đủ `401` và khai **XANH**.
 *
 * ⇒ *"Lưới HÌNH DẠNG ≠ lưới HÀNH VI"* — `if (true) return <>{children}</>` từng **ship được** qua
 *   một lượt quét mã đầy đủ trong chính repo này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LƯỢNG TỪ SUY TỪ **REGISTRAR**, KHÔNG TỪ MỘT DANH SÁCH ĐƯỜNG DẪN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới không viết tên 12 tuyến. Nó đưa cho registrar một `app` **giả có ghi sổ**, rồi ∀ trên đúng
 * những gì registrar đăng ký. Một tuyến **thứ 13** thêm vào bất kỳ file nào trong ba registrar ấy
 * **tự vào lượng từ** — không ai phải nhớ khai gì ("N+1" đã hai mươi lần).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ Pha 9 · **A1 — VÀ AI CANH CHÍNH DANH SÁCH REGISTRAR?**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu của file này nhập **ba** registrar bằng tay và ∀ trên chúng. Lượng từ ấy đúng **cho ba
 * file ấy**, và **theo cấu tạo** mù với registrar **thứ tư** — đúng lớp *"N+1"* đã hai mươi lần.
 * Phép đếm thật trên đĩa: **22** hàm `register…` trong `server/routes/` + `server/api/`.
 *
 * ⇒ §6 dưới đây đảo lượng từ: ***∀ registrar TRÊN ĐĨA: hoặc nó được lưới này GỌI THẬT, hoặc nó
 *   được KHAI TÊN là ngoài phạm vi kèm lý do.*** Một registrar mới ở một file chưa tồn tại làm §6
 *   **ĐỎ** cho tới khi có người quyết — không ai phải nhớ khai gì.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * ⚠⚠ **PHẢI ĐẶT TRƯỚC MỌI `import`** — `server/_core/env.ts` đọc `process.env` đúng một lần lúc
 * nạp module. Thiếu hai biến này thì `signSession` ném ⇒ đối chứng DƯƠNG đỏ vì hạ tầng, một màu đỏ
 * **nói dối** về bất biến đang canh.
 */
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "pha9-a6-rest-secret";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tsMod from "typescript";
import { eq } from "drizzle-orm";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { clearAuthSessionCache } from "../services/authSessionCache";

const GOC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DAU = "pha9-a6-rest";
const MOT_GIO_MS = 60 * 60 * 1000;

/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * BỘ ĐỒ GIẢ — `app` ghi sổ tuyến, `req`/`res` đủ để chạy THÂN THẬT của handler.
 * ⚠ Không phải một mock của handler: handler chạy **nguyên văn**, kể cả lượt gọi xác thực thật.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
interface Tuyen {
  readonly pp: string;
  readonly duong: string;
  readonly xuLy: (...a: any[]) => unknown;
}

function appGhiSo(): { tuyen: Tuyen[]; app: any } {
  const tuyen: Tuyen[] = [];
  const ghi = (pp: string) => (duong: string, ...rest: any[]) => {
    const xuLy = rest[rest.length - 1];
    if (typeof xuLy === "function") tuyen.push({ pp, duong, xuLy });
  };
  const app: any = {
    get: ghi("GET"),
    post: ghi("POST"),
    put: ghi("PUT"),
    patch: ghi("PATCH"),
    delete: ghi("DELETE"),
    use: () => undefined,
  };
  return { tuyen, app };
}

/** `res` giả ghi lại mã trạng thái đầu tiên được đặt. */
function resGhiSo() {
  const ra = { ma: null as number | null, than: null as unknown, daGui: false };
  const res: any = {
    status(m: number) {
      ra.ma ??= m;
      return res;
    },
    json(b: unknown) {
      ra.than = b;
      ra.daGui = true;
      return res;
    },
    send(b: unknown) {
      ra.than = b;
      ra.daGui = true;
      return res;
    },
    writeHead(m: number) {
      ra.ma ??= m;
      ra.daGui = true;
      return res;
    },
    write: () => true,
    end: () => res,
    setHeader: () => res,
    /**
     * ⚠⚠⚠ **THIẾT BỊ ĐO ĐÃ NÓI DỐI MỘT LẦN Ở ĐÚNG DÒNG NÀY.** Bản đầu của `res` giả thiếu `.type()`,
     * nên `GET /api/observability/metrics` — tuyến DUY NHẤT dùng
     * `res.status(...).type("text/plain").send(...)` — ném `TypeError` **bên trong** handler và bị
     * lưới xếp là *"để lọt ngoại lệ ⇒ 500"*. Một phát hiện an ninh **HOÀN TOÀN SAI**, có đúng hình
     * dạng của một phát hiện thật (tuyến ấy quả thật là bề mặt quan sát, quả thật có nhánh 401).
     * ⇒ Mọi phương thức `res` mà bất kỳ handler nào trong lượng từ dùng **phải** có mặt ở đây, nếu
     *   không lưới đo `res` giả của chính nó chứ không đo sản phẩm.
     */
    type: () => res,
    destroyed: false,
  };
  Object.defineProperty(res, "headersSent", { get: () => ra.daGui });
  return { ra, res };
}

/** `req` giả. `cookie === null` ⇒ **chưa xác thực**. IP cố ý KHÔNG loopback (tránh lối tha nội bộ). */
function reqGhiSo(cookie: string | null, than?: Record<string, unknown>): any {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = `${COOKIE_NAME}=${cookie}`;
  return {
    headers,
    body: than ?? {},
    query: {},
    params: {},
    ip: "203.0.113.9",
    socket: { remoteAddress: "203.0.113.9" },
    header: () => undefined,
    get: () => undefined,
    on: () => undefined,
  };
}

/** Chạy một tuyến, trả mã trạng thái (hoặc `"NÉM"` nếu handler để lọt ngoại lệ ra ngoài). */
async function chay(t: Tuyen, cookie: string | null, than?: Record<string, unknown>) {
  const { ra, res } = resGhiSo();
  try {
    await t.xuLy(reqGhiSo(cookie, than), res, () => undefined);
  } catch {
    return "NÉM" as const;
  }
  return ra.ma;
}

/**
 * ★★★ **TẬP AUTH-FREE ĐƯỢC KHAI TÊN.** Mỗi mục là một quyết định an ninh phải viết ra.
 * ⚠ Neo hai chiều: §4 bắt mọi mục **ma** (khai một tuyến không còn tồn tại) — mục ma sẽ lặng lẽ
 *   tiếp tục **THA** cho một tuyến mới trùng đường dẫn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-6 — MỘT LỜI KHAI KHÔNG THAY ĐƯỢC MỘT CƠ CHẾ.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước là `Record<string, string>`, và §4 chỉ kiểm *"mục khai có tồn tại như một tuyến thật"*
 * + *"lý do dài > 30 ký tự"*. Nó **không** kiểm **cơ chế thay thế có tồn tại không**. Hậu quả đo
 * được: mục `feedback` khai *"lượt gọi máy-sang-máy **trong localhost**"* trong khi **không có cơ
 * chế nào cưỡng chế mệnh đề ấy** — tuyến ghi tệp, không xác thực, và một `curl` không cookie từ
 * ngoài trả **400**, không phải 401. Lời khai biến một lỗ thành **một dòng xanh mỗi lượt chạy cổng**.
 *
 * ⇒ Mỗi mục nay khai **hai** thứ: `lyDo` (cho người) và `coCheThayThe` — **tên một hàm phải có mặt
 *   THẬT trong mã của tuyến** (§4c kiểm bằng AST trên chính file registrar). Đây là khuôn `MIEN_TRU`
 *   của `hoTuyenSongSong` với phần mạnh nhất được trả lại: mỗi miễn trừ ghim một **chữ ký chính xác**,
 *   không phải một câu văn.
 */
const AUTH_FREE: Readonly<Record<string, { lyDo: string; coCheThayThe: string; file: string }>> = {
  "GET /api/ai/local-kb/health": {
    lyDo: "Thăm dò sức khoẻ KB — không đọc dữ liệu người dùng, không nhận tham số, KHÔNG GHI gì; dùng cho probe hạ tầng.",
    // ⚠ Cơ chế ở đây là **hình dạng của chính tuyến**: nó chỉ đọc và trả một bản tóm tắt tĩnh.
    //   `getKbHealth` là hàm duy nhất nó gọi; nếu tuyến bắt đầu gọi thứ khác, ô §4c đỏ.
    coCheThayThe: "getKbHealth",
    file: "server/routes/aiLocalKnowledgeApi.ts",
  },
  /*
   * ⚠⚠⚠ `POST /api/ai/local-kb/feedback` **ĐÃ RỜI KHỎI TẬP NÀY** (review Pha 9 · I-6). Nó từng
   *    được tha bằng một câu văn — *"lượt gọi máy-sang-máy **trong localhost**"* — trong khi không
   *    có cơ chế nào cưỡng chế mệnh đề ấy (đo sống, không cookie: **400**, không phải 401). Nay
   *    tuyến tự cưỡng chế **loopback HOẶC vai đặc quyền** (`_congLoopback.ts`), nên nó **vào thẳng
   *    lượng từ §2** như mọi bề mặt khác. Một miễn trừ được **xoá** là kết cục tốt hơn một miễn trừ
   *    được viết hay.
   */
};

let uid = 0;
let openId = "";
let cookieThat = "";
let TUYEN: Tuyen[] = [];

beforeAll(async () => {
  process.env.AUTH_CACHE_TTL_S = "60";
  await clearAuthSessionCache();

  const { tuyen, app } = appGhiSo();
  const { registerAiStreamingRoutes } = await import("./aiStreamingApi");
  const { registerAiLocalKnowledgeRoutes } = await import("./aiLocalKnowledgeApi");
  const { registerObservabilityRoutes } = await import("./observabilityRoutes");
  registerAiStreamingRoutes(app);
  registerAiLocalKnowledgeRoutes(app);
  registerObservabilityRoutes(app);
  TUYEN = tuyen;

  const r = await db.createLocalUser({
    username: `${DAU}-${Date.now()}`,
    passwordHash: "$2b$10$khongdungdedangnhap0000000000000000000000000000000000000000",
    name: "Pha 9 A6 — bề mặt REST",
    role: "user",
  });
  uid = r.id;
  openId = (await db.getUserById(uid))!.openId;
  cookieThat = await sdk.createSessionToken(openId, { name: DAU, expiresInMs: MOT_GIO_MS });
  await db.createUserSession({
    userId: uid,
    sessionToken: cookieThat,
    deviceName: DAU,
    expiresAt: new Date(Date.now() + MOT_GIO_MS),
  });
});

afterAll(async () => {
  const d = await db.getDb();
  if (d && uid) await d.delete(userSessions).where(eq(userSessions.userId, uid));
  if (uid) await db.deleteUser(uid);
});

const khoa = (t: Tuyen) => `${t.pp} ${t.duong}`;
const canhBoi = (t: Tuyen) => AUTH_FREE[khoa(t)] === undefined;

describe("★★★ Pha 9 A6 §1 — CẦU CHÌ: lượng từ KHÔNG rỗng", () => {
  it("★★★ ba registrar đăng ký đủ tuyến (0 ⇒ mọi ô dưới là chân lý rỗng)", () => {
    expect(
      TUYEN.length,
      "registrar không đăng ký tuyến nào — `app` giả đã sai hình dạng?",
    ).toBeGreaterThanOrEqual(12);
    expect(
      TUYEN.filter(canhBoi).length,
      "MỌI tuyến đều được khai auth-free ⇒ lượng từ chính đang chạy trên tập rỗng",
    ).toBeGreaterThanOrEqual(10);
  });
});

describe("★★★ Pha 9 A6 §2 — LƯỢNG TỪ CHÍNH: không cookie ⇒ 401/403, KHÔNG BAO GIỜ 5xx", () => {
  it("★★★ ∀ tuyến không-auth-free: mã trạng thái là 401 hoặc 403", async () => {
    const xau: string[] = [];
    for (const t of TUYEN.filter(canhBoi)) {
      const ma = await chay(t, null);
      if (ma !== 401 && ma !== 403) xau.push(`${khoa(t)} ⇒ ${ma}`);
    }
    expect(
      xau,
      [
        "Bề mặt REST từ chối SAI MÃ khi chưa xác thực.",
        "500 ⇒ nhánh `if (!user) res.status(401)` là MÃ CHẾT: `sdk.authenticateRequest` NÉM,",
        "  lượt ném rơi vào `catch` và thành 'Internal Server Error' + rò `err.message` ra ngoài.",
        "⇒ Cách đúng: phân giải danh tính qua `thuXacThucRest(req)` (`server/routes/_xacThucRest.ts`),",
        "  hàm ấy trả `null` thay vì ném, nên nhánh 401 viết sẵn thành mã SỐNG.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("★★★ ∀ tuyến không-auth-free: KHÔNG tuyến nào để lọt ngoại lệ ra ngoài handler", async () => {
    const nem: string[] = [];
    for (const t of TUYEN.filter(canhBoi)) {
      if ((await chay(t, null)) === "NÉM") nem.push(khoa(t));
    }
    expect(nem, "handler để ngoại lệ thoát ra ⇒ express trả 500 mặc định").toEqual([]);
  });
});

describe("★★★ Pha 9 A6 §3 — ĐỐI CHỨNG DƯƠNG: cookie THẬT thì KHÔNG bị 401", () => {
  /**
   * ⚠⚠ Không có ô này, §2 xanh được bằng một bản vá *"401 tất"* — tức khoá mọi người ra ngoài, đúng
   *    lớp lỗi đã ship một lần ra **nhà tù thật 4/4 tài khoản** ở Pha 7. Đây là nửa còn lại.
   * ⚠ Chọn `retrieve` với thân THIẾU `question`: lượt xác thực **đi qua**, rồi tuyến tự từ chối
   *   bằng **400** vì thiếu tham số ⇒ 400 là **bằng chứng đã qua cửa xác thực**, và không kéo theo
   *   một lượt truy hồi RAG nặng.
   */
  it("★★★ `POST /api/ai/local-kb/retrieve` + cookie thật + thân thiếu tham số ⇒ 400 (KHÔNG 401)", async () => {
    const t = TUYEN.find((x) => khoa(x) === "POST /api/ai/local-kb/retrieve");
    expect(t, "không tìm thấy tuyến đối chứng — hình dạng đã đổi, hãy đọc lại lưới này").toBeTruthy();

    expect(await chay(t!, null), "cầu chì: KHÔNG cookie phải là 401").toBe(401);
    expect(
      await chay(t!, cookieThat, {}),
      "cookie THẬT vẫn bị 401 ⇒ bản vá đã dựng một nhà tù, không phải một cánh cửa",
    ).toBe(400);
  });

  it("★★★★ I-6 — `POST /api/ai/local-kb/feedback` nay **401**, trước bản vá là **400**", async () => {
    /**
     * ⚠⚠⚠ Ô này ghim một **lượt đổi hành vi đo được trên hệ sống**:
     *
     *     curl -X POST -d '{}' http://127.0.0.1:3000/api/ai/local-kb/feedback
     *     TRƯỚC: {"success":false,"error":"messageId and question are required"}  HTTP=**400**
     *
     *   400 nghĩa là **thân handler đã chạy** — nó đọc thân, kiểm tham số, và (với thân hợp lệ)
     *   **append một dòng tới ~10 KB vào một tệp trong repo**, cho bất kỳ ai với tới cổng 3000.
     * ⚠ Ô này cũng là **đối chứng dương của chính bản vá**: nhánh loopback KHÔNG được thoả bởi một
     *   `req` giả không có `.ip` — nếu ai nới `laLoopback` thành *"mặc định cho qua"*, ô này ĐỎ.
     */
    const t = TUYEN.find((x) => khoa(x) === "POST /api/ai/local-kb/feedback");
    expect(t, "không tìm thấy tuyến feedback — registrar đã đổi hình dạng").toBeTruthy();
    expect(
      canhBoi(t!),
      "tuyến feedback lại được khai auth-free ⇒ miễn trừ vừa mọc lại; đọc lý lẽ I-6 trước khi thêm",
    ).toBe(true);
    expect(
      await chay(t!, null, { messageId: "x", question: "y", rating: 1 }),
      "thân HỢP LỆ, không cookie, không loopback mà KHÔNG bị 401 ⇒ tuyến vẫn ghi tệp cho người lạ",
    ).toBe(401);
  });

  it("★★ tuyến ĐÒI VAI: cookie thật vai `user` ⇒ 403 (phân biệt được với 401)", async () => {
    const t = TUYEN.find((x) => khoa(x) === "GET /api/observability/health");
    expect(t).toBeTruthy();
    expect(await chay(t!, null), "cầu chì: KHÔNG cookie ⇒ 401").toBe(401);
    expect(
      await chay(t!, cookieThat),
      "vai `user` phải bị chặn bằng 403 — nếu ra 401 thì thước không phân biệt 'là ai' với 'được gì'",
    ).toBe(403);
  });
});

describe("★★★ Pha 9 A6 §4 — TẬP AUTH-FREE: neo hai chiều, không mục ma", () => {
  it("★★★ mỗi mục khai auth-free TỒN TẠI như một tuyến thật", () => {
    const that = new Set(TUYEN.map(khoa));
    const ma = Object.keys(AUTH_FREE).filter((k) => !that.has(k));
    expect(
      ma,
      "mục ma: tuyến đã đổi tên/biến mất ⇒ lời khai vẫn tiếp tục THA cho một tuyến mới trùng đường dẫn",
    ).toEqual([]);
  });

  it("★★ mỗi mục auth-free có lý do viết ra", () => {
    for (const [k, v] of Object.entries(AUTH_FREE)) {
      expect(v.lyDo.length, `mục auth-free "${k}" không nêu lý do`).toBeGreaterThan(30);
    }
  });

  it("★★★★ §4c I-6 — mỗi miễn trừ ghim một CƠ CHẾ có thật trong mã của tuyến (AST, không đọc chữ)", () => {
    /**
     * ⚠⚠⚠ Đây là ô biến một **lời khai** thành một **chữ ký kiểm được**. Không có nó, `AUTH_FREE`
     *    cấp một tấm vé **vĩnh viễn** bằng một câu văn: mục `feedback` đã khai *"trong localhost"*
     *    suốt một pha trong khi không có cơ chế nào cưỡng chế mệnh đề ấy (đo sống: 400, không 401).
     * ⚠ Đếm bằng **AST**: một cái tên nằm trong **bình luận** không phải một lượt gọi — chính lỗi
     *   đã làm §5 của A2 xanh giả một lần.
     */
    const tenGoiThat = (ma: string): Set<string> => {
      const sf = tsMod.createSourceFile("x.ts", ma, tsMod.ScriptTarget.Latest, true);
      const ra = new Set<string>();
      const di = (n: tsMod.Node): void => {
        if (tsMod.isCallExpression(n)) {
          const e = n.expression;
          if (tsMod.isIdentifier(e)) ra.add(e.text);
          else if (tsMod.isPropertyAccessExpression(e)) ra.add(e.name.text);
        }
        tsMod.forEachChild(n, di);
      };
      di(sf);
      return ra;
    };
    for (const [k, v] of Object.entries(AUTH_FREE)) {
      const ma = readFileSync(join(GOC, v.file), "utf8");
      expect(v.coCheThayThe.length, `mục auth-free "${k}" không nêu tên cơ chế`).toBeGreaterThan(0);
      expect(
        tenGoiThat(ma).has(v.coCheThayThe),
        `Miễn trừ "${k}" khai cơ chế \`${v.coCheThayThe}\` nhưng ${v.file} KHÔNG GỌI hàm ấy.\n` +
          "⚠ Một lời khai vừa mất cơ chế đứng sau nó — đó là trạng thái mà tuyến `feedback` đã ở\n" +
          "  suốt một pha: khai 'chỉ trong localhost' mà không có gì cưỡng chế mệnh đề ấy.\n" +
          "⇒ Hoặc trả lại cơ chế, hoặc gỡ mục khỏi `AUTH_FREE` và để tuyến vào lượng từ §2.",
      ).toBe(true);
    }
  });
});

describe("★★★ Pha 9 A1 §6 — ĐẢO LƯỢNG TỪ: ∀ registrar TRÊN ĐĨA phải được GỌI hoặc được KHAI", () => {
  /** Ba registrar lưới này **gọi thật** ở `beforeAll` (nguồn sự thật: cùng danh sách ấy). */
  const DA_GOI = [
    "server/routes/aiStreamingApi.ts",
    "server/routes/aiLocalKnowledgeApi.ts",
    "server/routes/observabilityRoutes.ts",
  ] as const;

  /**
   * ★★★ **NGOÀI PHẠM VI — KHAI TÊN kèm lý do.** Mỗi mục là một quyết định an ninh phải viết ra.
   * ⚠ Chúng **không** phải "an toàn"; chúng là *"không thuộc trục mà lưới này đo"* (phiên trình
   *   duyệt qua `sdk.authenticateRequest`). Trục khoá-máy/API-key do lưới khác canh.
   */
  /**
   * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-6** — **MỖI LỜI KHAI GHIM MỘT CHỮ KÝ, KHÔNG CHỈ MỘT CÂU VĂN.**
   *
   * ⚠⚠ Bản trước là `Record<string, string>`: một câu văn dài > 30 ký tự là đủ để một file rời khỏi
   *    lượng từ **vĩnh viễn**, kể cả khi người ta thêm mười tuyến mới vào nó. Đó đúng lớp lỗi mà
   *    review chỉ ra ở tập `AUTH_FREE` (*"một lời khai không thay được một cơ chế"*).
   * ⇒ Mỗi mục nay ghim **số điểm gắn tuyến** của file ấy (`app|router . <verb> (`). Thêm một tuyến
   *   vào một file đã được tha ⇒ **ĐỎ**, và người thêm phải nói ra rằng tuyến ấy cũng ngoài phạm vi.
   *   Đây là khuôn *"chữ ký chênh lệch chính xác"* của `hoTuyenSongSong`, áp cho lời khai này.
   */
  const NGOAI_PHAM_VI: Readonly<Record<string, { viSao: string; soTuyen: number }>> = {
    "server/routes/externalInspectionApi.ts": {
      viSao:
        "Tuyến `/api/external/*` — xác thực bằng KHOÁ MÁY (Bearer/API key) qua `validateExternalAuth`, không phải phiên trình duyệt. Chủ thể không phải một hàng `users`.",
      soTuyen: 26,
    },
    "server/routes/openaiGateway.ts": {
      viSao:
        "Cổng tương thích OpenAI — xác thực bằng API key của máy/tích hợp, cùng trục với `/api/external/*`.",
      soTuyen: 4,
    },
    "server/routes/edgeDownload.ts": {
      viSao: "Tải gói Edge — cưỡng chế bằng token tải một lần + `x-master-key`, trục khoá máy.",
      soTuyen: 1,
    },
    "server/routes/reportArtifactRoutes.ts": {
      viSao:
        "Tải hiện vật báo cáo — cưỡng chế bằng token ký của chính hiện vật (không phải phiên).",
      soTuyen: 1,
    },
    /* ── ★★★★ Review TOÀN NHÁNH Pha 9 · I-1 — BA REGISTRAR `_core/` VỪA LỘ RA ─────────────────
     * Ba file dưới đây thoả **đúng vị từ** mà §6 đi tìm; thứ duy nhất loại chúng ra là **THƯ MỤC**
     * (bản trước chỉ duyệt `server/routes` + `server/api`). Một trong số đó khai
     * `POST /api/auth/verify-2fa` — **chính tuyến mà A5 vừa đổi người tiêu mã dự phòng**, tức Pha 9
     * sửa hành vi của một tuyến rồi dựng một lưới hành vi mà tuyến ấy **theo cấu tạo** không nằm trong.
     *
     * ⚠ Chúng **không** được gọi trong `beforeAll` vì chúng nằm trên một trục KHÁC: đây là **cửa
     *   ĐÚC vé** (đăng nhập · callback OAuth · ACS của SAML) và một bề mặt **công khai có chủ ý**
     *   (điểm nhận báo cáo CSP của trình duyệt). Bất biến *"không cookie ⇒ 401"* **sai** với chúng
     *   theo định nghĩa — bắt chúng vào §2 là dựng một lưới đo sai thứ.
     * ⚠ Trục của chúng có người canh riêng, và người ấy có tên: `sessionGrantScan.test.ts` §4
     *   (*"∀ điểm đúc vé phải ghi sổ `user_sessions`"*) · `verify2faPasswordStep.test.ts` ·
     *   `hoTuyenSongSong.test.ts`. Số tuyến được ghim ở đây để một tuyến **thứ 7** của `oauth.ts`
     *   không lặng lẽ thừa hưởng lời khai này.
     */
    "server/_core/oauth.ts": {
      viSao:
        "Cửa ĐÚC vé phiên (đăng nhập cục bộ · `verify-2fa` · callback OAuth) — bất biến 'không cookie ⇒ 401' sai theo định nghĩa với một cửa đăng nhập. Trục này do `sessionGrantScan.test.ts` §4 + `verify2faPasswordStep.test.ts` canh.",
      soTuyen: 6,
    },
    "server/_core/samlProvider.ts": {
      viSao:
        "ACS/metadata của SAML — cửa đúc vé thứ hai, chủ thể đến từ IdP chứ không từ một cookie phiên. Cùng người canh với `oauth.ts` (`sessionGrantScan.test.ts` §4).",
      soTuyen: 3,
    },
    "server/_core/securityHeaders.ts": {
      viSao:
        "Điểm nhận báo cáo CSP — trình duyệt POST tới đây KHÔNG kèm cookie theo đúng đặc tả; đòi 401 là tự tắt kênh báo cáo. Nội dung bị bỏ qua, không chạm dữ liệu người dùng.",
      soTuyen: 1,
    },
  };

  /**
   * ★★★ **NGOÀI PHẠM VI THEO THƯ MỤC** — một lý do dùng chung, và **SỐ FILE ĐƯỢC GHIM**.
   *
   * ⚠⚠ Vì sao một luật thư mục chứ không 15 dòng khai giống hệt nhau: 15 bản sao của cùng một lý do
   *    là 15 chỗ lý do có thể trôi khỏi nhau. Nhưng một luật thư mục **không ghim số** là một tấm vé
   *    trắng cho mọi file tương lai đặt vào đó ⇒ số được ghim, và một file thứ 16 phải là một quyết
   *    định NÓI RA.
   */
  const THU_MUC_NGOAI = {
    tienTo: "server/api/v1/",
    viSao:
      "Trục `/api/external/*` — mọi tuyến ở đây nằm sau `validateExternalAuth` (Bearer/API key của máy/ERP). " +
      "Chủ thể KHÔNG phải một hàng `users` nên nó không có phiên trình duyệt để lưới này đo. " +
      "Trục ấy được canh bởi `server/_core/thuHoiPhienMoiBeMat.test.ts` (thu hồi phiên trên nhánh Bearer).",
    soFile: 15,
  } as const;

  /**
   * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-1 — THIẾT BỊ CHỐNG-"N+1" TỰ NÓ LÀ MỘT DANH SÁCH N+1.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ ĐO ĐƯỢC — CÙNG MỘT VỊ TỪ, HAI PHẠM VI
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bản trước duyệt **hai thư mục viết tay** (`server/routes` + `server/api`) ⇒ **22** registrar.
   * Chạy **cùng vị từ** trên toàn `server/` ⇒ **55**. Ba trong số 33 file ngoài tầm là registrar
   * Express **THẬT** — và một trong ba khai `POST /api/auth/verify-2fa`, chính tuyến A5 vừa đổi.
   * ⇒ Thiết bị tồn tại để trả lời *"và ai canh chính danh sách registrar?"* lại **chính là** một
   *   danh sách hai phần tử. Nay nó duyệt **một** thư mục: `server`.
   *
   * ⚠⚠ **NHƯNG PHẠM VI RỘNG ĐÒI VỊ TỪ ĐÚNG.** `export function register\w*(` trên toàn `server/`
   *    tóm thêm **30** file **không phải Express**: `registerHandlers` của kho công cụ AI,
   *    `registerDriver` của kho driver OT/robot, `registerProvider`… Khai 30 mục *"ngoài phạm vi"*
   *    cho chúng là dựng đúng cái danh sách vô nghĩa mà lượng từ này ra đời để giết.
   * ⇒ Vị từ được siết theo **HÌNH DẠNG**, không theo thư mục: một registrar TUYẾN là hàm
   *   `register…` nhận **một tham số kiểu Express** (`Express` · `Application` · `Router`).
   *   Đo được: 55 → **25** = 22 cũ + **đúng ba** file `_core/` mà bản trước bỏ sót. §6a ghim cả
   *   **hai** con số, nên một lượt nới vị từ trở lại (hoặc thu phạm vi lại) đều ĐỎ.
   */
  const VI_TU_REGISTRAR = /export function register\w*\s*\(/;
  const THAM_SO_EXPRESS = /:\s*(?:express\s*\.\s*)?(?:Express|Application|Router)\b/;
  /** Điểm gắn tuyến Express: `app.get("/…")`, `router.use(HANG_SO, …)`, … */
  const GAN_TUYEN = /\b(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|all|use)\s*\(\s*(?:["'`]|[A-Z_]{3,})/g;

  /** Mọi file `.ts` mã sản xuất dưới `server/` — SUY TỪ ĐĨA, một thư mục gốc. */
  function moiFileSanXuat(): string[] {
    const ra: string[] = [];
    const duyet = (thuMuc: string): void => {
      for (const m of readdirSync(join(GOC, thuMuc), { withFileTypes: true })) {
        const duong = `${thuMuc}/${m.name}`;
        if (m.isDirectory()) {
          if (m.name !== "node_modules") duyet(duong);
        } else if (m.name.endsWith(".ts") && !m.name.endsWith(".test.ts")) ra.push(duong);
      }
    };
    duyet("server");
    return ra.sort();
  }

  const MOI_FILE_SX = moiFileSanXuat();
  const doc = (d: string) => readFileSync(join(GOC, d), "utf8");
  const soGanTuyen = (d: string): number => {
    GAN_TUYEN.lastIndex = 0;
    return (doc(d).match(GAN_TUYEN) ?? []).length;
  };

  /** Mọi hàm `register…` trên toàn `server/` — **vị từ THÔ**, giữ lại để ghim khoảng cách. */
  const REGISTRAR_THO = MOI_FILE_SX.filter((d) => VI_TU_REGISTRAR.test(doc(d)));
  /** Registrar **TUYẾN EXPRESS** — thô ∧ nhận một tham số kiểu Express. */
  const REGISTRAR = REGISTRAR_THO.filter((d) => THAM_SO_EXPRESS.test(doc(d)));

  it("★★★ CẦU CHÌ — bộ suy thấy đủ registrar trên đĩa (0 ⇒ §6 là chân lý rỗng)", () => {
    expect(
      MOI_FILE_SX.length,
      "quét `server/**` ra quá ít file — phạm vi đã hỏng? (glob rỗng ⇒ vitest im lặng khai XANH)",
    ).toBeGreaterThanOrEqual(500);
    expect(
      REGISTRAR.length,
      "quét ra quá ít registrar — bộ suy phạm vi đã hỏng? (đo được 2026-08-12 trên toàn `server/`: 25)",
    ).toBeGreaterThanOrEqual(20);
    for (const d of DA_GOI) {
      expect(REGISTRAR, `registrar được GỌI mà bộ suy không thấy: ${d}`).toContain(d);
    }
  });

  it("★★★★ §6a I-1 — HAI con số được ghim: phạm vi ĐÃ rộng ra, và vị từ ĐÃ được siết", () => {
    /**
     * ⚠⚠⚠ Không có ô này, hai lượt sửa **ngược nhau** đều đi lọt: (a) thu phạm vi về hai thư mục ⇒
     *    `REGISTRAR` rơi về 22 và ba registrar `_core/` biến mất **im lặng**; (b) nới vị từ về bản
     *    thô ⇒ `REGISTRAR` vọt lên 55 và 30 mục vô nghĩa đòi được khai. Ghim **cả hai** con số làm
     *    khoảng cách giữa chúng thành một sự thật quan sát được.
     */
    expect(
      REGISTRAR_THO.length,
      "số hàm `register…` trên toàn `server/` đã đổi — đây là con số bản trước ĐÃ ĐO SAI (22 vì chỉ đi hai thư mục)",
    ).toBe(55);
    expect(
      REGISTRAR.length,
      "số registrar TUYẾN EXPRESS đã đổi — một registrar tuyến mới vừa xuất hiện, hoặc vị từ đã bị nới",
    ).toBe(25);
    expect(
      REGISTRAR.filter((d) => d.startsWith("server/_core/")).sort(),
      "ba registrar `_core/` mà bản trước KHÔNG BAO GIỜ thấy — chúng là lý do §6 được viết lại",
    ).toEqual([
      "server/_core/oauth.ts",
      "server/_core/samlProvider.ts",
      "server/_core/securityHeaders.ts",
    ]);
  });

  it("★★★★ §6b I-1 — ∀ theo HÌNH DẠNG GẮN TUYẾN: file gắn tuyến THẲNG cũng phải được khai", () => {
    /**
     * ⚠⚠⚠ §6 hỏi *"ai canh danh sách registrar"*. Ô này hỏi câu **đứng sau** nó: *"và tuyến nào
     *    KHÔNG đi qua một registrar nào cả?"*. Đo được: `server/_core/index.ts` gắn **98** điểm
     *    tuyến **thẳng vào `app`** — chúng **chưa từng được lưới hành vi nào gọi thật**, và câu
     *    *"0/12 tuyến trả 5xx"* của báo cáo nhóm A đúng **cho 12 tuyến của ba registrar**, không
     *    cho chúng.
     * ⚠ Đây là **NỢ ĐƯỢC KHAI kèm SỐ**, không phải một lượt vá: gọi thật 98 tuyến của `index.ts`
     *   đòi dựng gần trọn ứng dụng. Con số bị ghim, nên tuyến thứ 99 là một quyết định phải nói ra.
     */
    const GAN_THANG: Readonly<Record<string, { viSao: string; soTuyen: number }>> = {
      "server/_core/index.ts": {
        viSao:
          "NỢ ĐÃ KHAI (review Pha 9 I-1): điểm gắn tuyến THẲNG vào `app`, gồm 58 tuyến `/api/external/*` (trục khoá máy, do `thuHoiPhienMoiBeMat.test.ts` canh). Gọi thật đòi dựng gần trọn ứng dụng ⇒ chưa vào lưới hành vi này. Con số bị ghim để tuyến kế tiếp là một quyết định nói ra. " +
          "★ 2026-08-16 (G1-E) 98 → 100. Thành phần của +2, ĐẾM TAY: (1) MỘT tuyến THẬT — `app.get('/api/health/ai', createAiReadinessHandler())`, cổng sẵn sàng hệ con AI, khai riêng ở mục `server/_core/aiReadiness.ts` bên dưới. " +
          "(2) MỘT DƯƠNG TÍNH GIẢ — `soGanTuyen()` đếm theo VĂN BẢN nên khớp cả trong CHÚ THÍCH: dòng giải thích `/api/health` rơi vào SPA catch-all có chứa nguyên văn `app.use(\"*\")`. " +
          "⚠ Ghi lại thay vì sửa chú thích cho vừa lưới — nắn văn bản cho khớp phép đo chính là cách một lưới thật biến thành lưới giả. Nợ đúng ở đây là bộ đếm nên bỏ qua comment; chưa vá vì nó đụng vị từ dùng chung của §6. " +
          "★ 2026-08-18 (cổng ảnh) 100 → 104. Thành phần của +4, ĐẾM BẰNG DIFF VỚI `HEAD` (không đếm tay, không đoán): " +
          "(1) MỘT tuyến THẬT — `app.use(\"/uploads\", …)`, middleware cổng ảnh đứng TRƯỚC cả handler resize lẫn " +
          "`express.static`; chủ của phán quyết nằm ở `server/routes/_congAnh.ts`, khai riêng ở mục bên dưới. " +
          "(2) BA DƯƠNG TÍNH GIẢ — ba dòng CHÚ THÍCH ngay trên middleware ấy trích nguyên văn `app.get(\"/uploads/*\")`, " +
          "`app.use(\"/uploads\", express.static(...))` và `app.use(\"/uploads\", …)` để ghi lại VÌ SAO thứ tự gắn có ý " +
          "nghĩa (đặt sau dòng resize thì mọi yêu cầu kèm `?w=` đi vòng qua cổng — một bản vá xanh mà cửa vẫn mở). " +
          "⚠ Vẫn ghi lại thay vì sửa chú thích cho vừa bộ đếm, đúng lý do đã nêu ở lượt +2 phía trên.",
        soTuyen: 104,
      },
      "server/api/v1/guard.ts": {
        viSao:
          "Middleware của trục `/api/v1/*` (khoá máy/ERP) — không đăng ký tuyến nghiệp vụ nào, chỉ `app.use` hai lớp chặn.",
        soTuyen: 2,
      },
      "server/license/license-middleware.ts": {
        viSao:
          "Middleware giấy phép — `app.use` hai lớp, không phải một bề mặt phiên; nó chạy TRƯỚC mọi phép xác thực.",
        soTuyen: 2,
      },
      "server/_core/vite.ts": {
        viSao:
          "Phục vụ tài nguyên tĩnh của trình dựng (dev middleware + `app.use('*')` bắt-tất cho SPA) — không đọc dữ liệu người dùng.",
        soTuyen: 2,
      },
      "server/_core/aiReadiness.ts": {
        viSao:
          "★ THÊM 2026-08-16 (G1-E) — `GET /api/health/ai`: cổng SẴN SÀNG của hệ con AI, KHÔNG phải bề mặt phiên. " +
          "AUTH-FREE CÓ CHỦ Ý để giám sát ngoài gọi được; đầu ra đã lọc (không API key, không đường dẫn tuyệt đối — " +
          "`/props` trả `model_path` tuyệt đối, chỉ lấy basename; hostname rút còn `loopback|remote`+cổng). " +
          "Ai coi roster model là nhạy cảm thì đặt `HEALTH_AI_REQUIRE_LOOPBACK=true` ⇒ 403 cho caller ngoài loopback. " +
          "Nằm dưới `/api/` nên vẫn được `apiLimiter` 300/phút che. " +
          "Handler tách khỏi `_core/index.ts` CỐ Ý để test mount được ĐÚNG CÁI ĐANG CHẠY (kèm SPA catch-all phía sau) — " +
          "xem `aiReadinessRoute.test.ts`, nơi chứng minh `/api/health` trả HTML 200 còn `/api/health/ai` trả JSON. " +
          "★ SỐ 2 Ở ĐÂY KHÔNG PHẢI 2 TUYẾN. File này gắn **0** tuyến — nó chỉ XUẤT một handler, `_core/index.ts` mới `app.get(...)`. " +
          "`soGanTuyen()` đếm theo VĂN BẢN nên khớp hai lần nhắc `app.use(\"*\")` trong CHÚ THÍCH (dòng ~12 và ~511, " +
          "chỗ giải thích vì sao `/api/health` trả HTML thay vì JSON). Ghi lại thay vì viết lại chú thích cho vừa bộ đếm — " +
          "cùng lý do đã nêu ở mục `server/_core/index.ts`: nắn văn bản cho khớp phép đo là cách biến lưới thật thành lưới giả.",
        soTuyen: 2,
      },
      "server/routers/phamViDocScan.ts": {
        viSao:
          "★ THÊM 2026-08-18 (điều tra dân số phạm vi đọc · §D) — **GẮN 0 TUYẾN.** File này là một BỘ SUY TĨNH: " +
          "nó đọc `server/**` bằng TypeScript AST và PHÂN LOẠI mọi tuyến Express, nên văn bản của nó nhắc lại các " +
          "hình dạng `app.get(\"/…\")`/`app.use(\"/…\")` trong chú thích và trong thông điệp lỗi. Nó không nhập `express`, " +
          "không nhận tham số `Express`, và không được gọi từ đường khởi động nào. " +
          "⚠ 7 lượt khớp là DƯƠNG TÍNH GIẢ của `soGanTuyen()` — đúng lớp đã ghi ở hai mục trên. " +
          "Khai ra kèm SỐ thay vì viết lại chú thích cho vừa bộ đếm: nắn văn bản cho khớp phép đo là cách " +
          "biến lưới thật thành lưới giả (và ở đây còn tệ hơn — nó sẽ làm hỏng chính lời giải thích của bộ suy).",
        soTuyen: 7,
      },
      "server/routers/phamViTuyenBaseline.ts": {
        viSao:
          "★ THÊM 2026-08-18 — **GẮN 0 TUYẾN.** Đây là SỔ NỢ (một mảng chuỗi) của bản điều tra dân số tuyến Express. " +
          "Một lượt khớp duy nhất nằm trong docblock, chỗ khai bề mặt `app.use(\"/uploads\", express.static(…))` là " +
          "món nợ mà bộ suy KHÔNG đo được. Cùng lớp dương tính giả với mục trên.",
        soTuyen: 1,
      },
      "server/routes/_congAnh.ts": {
        viSao:
          "★ THÊM 2026-08-18 (cổng ảnh) — **GẮN 0 TUYẾN.** File này là CHỦ của phán quyết " +
          "\"lượt gọi này có được đọc BYTE ẢNH không?\": nó XUẤT `thuMoCongAnh`/`mayTrongPhamViAnh`/" +
          "`sanPhamTrongPhamViAnh` và không nhập `express` như một giá trị, không nhận tham số " +
          "`Express`, không được gọi từ đường khởi động nào. Chính `_core/index.ts` mới `app.use(...)`. " +
          "⚠ 2 lượt khớp đều là DƯƠNG TÍNH GIẢ của `soGanTuyen()`: cả hai nằm trong CHÚ THÍCH, chỗ " +
          "trích lại nguyên văn bề mặt `app.use(\"/uploads\", express.static(uploadsRoot))` để nói rõ " +
          "lỗ nào đang được đóng và vì sao middleware phải đứng TRƯỚC nó. " +
          "Khai ra kèm SỐ thay vì nắn chú thích cho vừa bộ đếm — cùng lý do đã nêu ở ba mục trên: " +
          "sửa văn bản cho khớp phép đo là cách biến lưới thật thành lưới giả, và ở đây nó sẽ xoá mất " +
          "đúng câu giải thích vị trí gắn middleware (thứ mà một lượt sửa sau rất dễ làm hỏng).",
        soTuyen: 2,
      },
      "server/routes/_uyQuyenAnh.ts": {
        viSao:
          "★ THÊM 2026-08-18 (uỷ quyền `/uploads/**` theo ĐƯỜNG DẪN) — **GẮN 0 TUYẾN.** Em ruột của " +
          "`_congAnh.ts` ngay trên: file này là CHỦ của câu hỏi \"đường dẫn này thuộc nhà máy NÀO?\". " +
          "Nó XUẤT `uyQuyenDuongDanAnh`/`chuanHoaDuongDanTai`/`hinhDangCuaDuongDan`, không nhập " +
          "`express` như một giá trị, không nhận tham số `Express`. Chính `_core/index.ts` mới " +
          "`app.use(...)` — và điểm gắn ấy đã nằm trong con số 104 của mục `_core/index.ts` " +
          "(middleware uỷ quyền chạy TRONG cùng một `app.use(\"/uploads\", …)` với cổng xác thực, " +
          "nên nó KHÔNG thêm một điểm gắn nào). " +
          "⚠ 1 lượt khớp DUY NHẤT là DƯƠNG TÍNH GIẢ của `soGanTuyen()`: nó nằm trong CHÚ THÍCH giải " +
          "thích rằng bên trong `app.use(\"/uploads\", …)` express đã cắt tiền tố khỏi `req.path`, nên " +
          "bộ chuẩn hoá phải nhận CẢ hai dạng đường dẫn. Khai kèm SỐ thay vì nắn chú thích cho vừa " +
          "bộ đếm — cùng lý do đã nêu ở bốn mục trên.",
        soTuyen: 1,
      },
    };

    const ganThang = MOI_FILE_SX.filter(
      (d) => soGanTuyen(d) > 0 && !(VI_TU_REGISTRAR.test(doc(d)) && THAM_SO_EXPRESS.test(doc(d))),
    );
    expect(
      ganThang.filter((d) => GAN_THANG[d] === undefined),
      [
        "MỘT FILE GẮN TUYẾN EXPRESS THẲNG (không qua registrar nào) MÀ KHÔNG AI KHAI.",
        "⚠ `moiRegistrar()` theo cấu tạo mù với nó: nó không có hàm `register…` nào để quét.",
        "⇒ Hoặc gói tuyến ấy vào một registrar (nó tự vào §6), hoặc KHAI vào `GAN_THANG` kèm lý do",
        "  VÀ số điểm gắn tuyến — một lời khai không kèm số là một tấm vé trắng cho mọi tuyến sau.",
      ].join("\n"),
    ).toEqual([]);
    for (const [d, k] of Object.entries(GAN_THANG)) {
      expect(soGanTuyen(d), `số điểm gắn tuyến của \`${d}\` đã đổi — lời khai không còn mô tả file ấy`).toBe(k.soTuyen);
      expect(k.viSao.length, `mục gắn-thẳng "${d}" không nêu lý do`).toBeGreaterThan(30);
    }
  });

  it("★★★ SỐ file của luật thư mục được GHIM (file thứ 16 phải là một quyết định nói ra)", () => {
    const trongThuMuc = REGISTRAR.filter((d) => d.startsWith(THU_MUC_NGOAI.tienTo));
    expect(
      trongThuMuc.length,
      `số registrar dưới \`${THU_MUC_NGOAI.tienTo}\` đã đổi — một tuyến ngoài mới vừa xuất hiện,\n` +
        "hãy xác nhận nó thật sự thuộc trục khoá-máy chứ không phải một bề mặt phiên.",
    ).toBe(THU_MUC_NGOAI.soFile);
    expect(THU_MUC_NGOAI.viSao.length, "luật thư mục phải nêu lý do").toBeGreaterThan(30);
  });

  it("★★★★ ∀ registrar: được GỌI THẬT, hoặc được KHAI TÊN là ngoài phạm vi", () => {
    const chuaXuLy = REGISTRAR.filter(
      (d) =>
        !DA_GOI.includes(d as (typeof DA_GOI)[number]) &&
        NGOAI_PHAM_VI[d] === undefined &&
        !d.startsWith(THU_MUC_NGOAI.tienTo),
    );
    expect(
      chuaXuLy.map((d) => `  · ${d}`).join("\n"),
      [
        "MỘT REGISTRAR TUYẾN REST KHÔNG ĐƯỢC LƯỚI HÀNH VI NÀO CHẠM TỚI.",
        "⚠ Trước Pha 9, các bề mặt ngoài tRPC chỉ có SUY LUẬN CẤU TẠO (`try/catch` ⇒ 'suy ra' là từ",
        "  chối). Phép đo bác bỏ suy luận ấy: 6 tuyến trả 500 chứ không 401.",
        "⇒ Hoặc thêm registrar vào lượt gọi thật của lưới này (nó sẽ tự vào ∀ của §2),",
        "  hoặc KHAI vào `NGOAI_PHAM_VI` kèm lý do — một quyết định an ninh phải viết ra.",
      ].join("\n"),
    ).toBe("");
  });

  it("★★★ tập KHAI không có mục MA, mỗi mục có lý do VÀ một chữ ký số khớp file thật", () => {
    const ma = Object.keys(NGOAI_PHAM_VI).filter((d) => !REGISTRAR.includes(d));
    expect(
      ma,
      "mục ma: file đã đổi tên/biến mất ⇒ lời khai vẫn tiếp tục THA cho một registrar mới trùng đường dẫn",
    ).toEqual([]);
    for (const [k, v] of Object.entries(NGOAI_PHAM_VI)) {
      expect(v.viSao.length, `mục ngoài-phạm-vi "${k}" không nêu lý do`).toBeGreaterThan(30);
      expect(
        soGanTuyen(k),
        `số điểm gắn tuyến của \`${k}\` đã đổi (${v.soTuyen} → ${soGanTuyen(k)}).\n` +
          "⚠ Một tuyến MỚI vừa được thêm vào một file ĐÃ ĐƯỢC THA. Lời khai cũ không mô tả nó.\n" +
          "⇒ Xác nhận tuyến mới cũng thuộc trục ngoài phạm vi, rồi cập nhật `soTuyen` — đây là\n" +
          "  một quyết định an ninh, không phải một lượt cập nhật con số.",
      ).toBe(v.soTuyen);
    }
  });
});

describe("★★★ Pha 9 A1 §7 — HÀNH VI: nhánh PHIÊN của bề mặt xuất dữ liệu", () => {
  /**
   * ⚠ `authenticateExportRequest` không đăng ký qua registrar nên §2 không chạm tới nó, nhưng nó
   *   **có** một nhánh phiên trình duyệt đi qua `sdk.authenticateRequest` — đúng trục lưới này đo.
   *   Gọi THẲNG hàm ấy là cách đo hành vi rẻ nhất mà vẫn thật.
   */
  it("★★★ không cookie, không API key ⇒ 401 (KHÔNG 5xx, KHÔNG ném)", async () => {
    const { authenticateExportRequest } = await import("../api/export/exportRouter");
    const ra = await authenticateExportRequest(reqGhiSo(null) as never, "inspections:read");
    expect(ra.status, "bề mặt xuất dữ liệu từ chối SAI MÃ khi chưa xác thực").toBe(401);
    expect(ra.principal, "từ chối mà vẫn trả về một chủ thể ⇒ fail-open").toBeNull();
  });

  it("★★★ cookie THẬT ⇒ 200 và chủ thể là PHIÊN (đối chứng dương, chống nhà tù)", async () => {
    const { authenticateExportRequest } = await import("../api/export/exportRouter");
    const ra = await authenticateExportRequest(reqGhiSo(cookieThat) as never, "inspections:read");
    expect(ra.status, "cookie thật vẫn bị từ chối ⇒ bề mặt xuất dữ liệu thành nhà tù").toBe(200);
    expect(ra.principal?.kind).toBe("session");
    expect((ra.principal as { userId?: number })?.userId).toBe(uid);
  });
});

describe("★★★ Pha 9 A6 §5 — HIỆU CHUẨN: thước phân biệt được, trên đáp số BIẾT TRƯỚC", () => {
  /**
   * ⚠⚠⚠ Không có §5, toàn bộ file có thể đang xanh vì `chay()` trả `null` cho mọi thứ và `null`
   *    tình cờ không lọt vào danh sách xấu. Ba handler dựng sẵn, ba đáp số biết trước.
   *    (Thiết bị đo đã nói dối 20 lần/4 ngày — trong đó một ô in *"hai cookie giống nhau = true"*
   *    cho `undefined === undefined`.)
   */
  const gia = (ma: number): Tuyen => ({
    pp: "POST",
    duong: "/gia",
    xuLy: async (_req: any, res: any) => {
      res.status(ma).json({});
    },
  });

  it("★★★ handler trả 500 PHẢI bị xếp là xấu; 401/403 PHẢI được tha", async () => {
    expect(await chay(gia(500), null), "thước không đọc được mã 500").toBe(500);
    expect(await chay(gia(401), null)).toBe(401);
    expect(await chay(gia(403), null)).toBe(403);
    const xau = (ma: number | "NÉM" | null) => ma !== 401 && ma !== 403;
    expect(xau(500), "vị từ THA cho 500 ⇒ lượng từ chính không bao giờ đỏ được").toBe(true);
    expect(xau(401)).toBe(false);
    expect(xau(403)).toBe(false);
  });

  it("★★★ handler NÉM bị bắt (không im lặng thành `null`)", async () => {
    const nem: Tuyen = {
      pp: "POST",
      duong: "/nem",
      xuLy: async () => {
        throw new Error("vỡ");
      },
    };
    expect(await chay(nem, null), "một handler ném mà thước khai `null` ⇒ §2b không bao giờ đỏ").toBe("NÉM");
  });
});

describe("★★★★ Review TOÀN NHÁNH Pha 9 · M-4 §8 — BA LỚP MÃ TRẠNG THÁI, KHÔNG MỘT LỚP", () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VÌ SAO §2 (*"401 hoặc 403"*) KHÔNG ĐỦ ĐỂ CANH CHUYỆN NÀY
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * §2 đo **một** tình huống: *không cookie*. Ở đó cả bốn nguyên nhân đều **không xảy ra được**
   * trừ một (`"Invalid session cookie"`), nên §2 xanh **bất kể** ba nguyên nhân kia được ánh xạ
   * thành mã gì. Trước lượt vá M-4, `catch { return null }` gộp **cả bốn** về **401** — và §2
   * **không thể** thấy: nó xanh vì 401 nằm trong tập cho phép của nó.
   *
   * ⇒ Ô dưới đây gọi **CHÍNH hai phép chặn thật** (`chanNeuPhaiDoiMatKhau` · `chanNeuTaiKhoanBiTat`,
   *   `server/_core/sdk.ts`) để **lấy đúng lượt ném thật**, rồi đọc lại phân loại. Đổi chuỗi dấu ở
   *   `sdk.ts` mà quên `_xacThucRest.ts` ⇒ **ĐỎ**. Đây là chỗ hai file được nối lại với nhau.
   */
  const bat = <T,>(f: () => Promise<T>) =>
    f().then(
      () => null as unknown,
      (e: unknown) => e,
    );

  it("★★★★ §8a lượt ném THẬT của hai phép chặn ⇒ 403, và HAI mã PHÂN BIỆT ĐƯỢC", async () => {
    const { thuXacThucRest } = await import("./_xacThucRest");
    const { chanNeuPhaiDoiMatKhau, chanNeuTaiKhoanBiTat } = await import("../_core/sdk");

    // Lượt ném THẬT của cổng tài khoản bị tắt.
    const loiTat = await bat(() => chanNeuTaiKhoanBiTat({ isActive: false } as never));
    expect(loiTat, "cầu chì: `chanNeuTaiKhoanBiTat` không còn ném ⇒ ô này rỗng nghĩa").not.toBeNull();

    /**
     * Lượt ném THẬT của cổng buộc-đổi-mật-khẩu — **trên hàng `users` THẬT của file này**, đặt cờ
     * bằng đúng hai mốc mà `suyRaPhaiDoiMatKhau` đọc.
     * ⚠ KHÔNG ghi đè `db.phaiDoiMatKhau`: một namespace ESM **chỉ có getter**
     *   (`Cannot set property … of [object Module]`), và một phép giả ở đó sẽ đo một hàm KHÁC hàm
     *   sản phẩm. Đo được ở chính lượt viết ô này.
     */
    const d = await db.getDb();
    const { users } = await import("../../drizzle/schema");
    await d!
      .update(users)
      .set({ passwordChangedAt: new Date(Date.now() - 60_000), passwordInvalidBefore: new Date() })
      .where(eq(users.id, uid));
    expect(await db.phaiDoiMatKhau(uid), "cầu chì: cờ buộc-đổi-mật-khẩu phải BẬT thật").toBe(true);
    const hang = (await db.getUserById(uid)) as never;
    const loiDoi = await bat(() => chanNeuPhaiDoiMatKhau(hang));
    await d!
      .update(users)
      .set({ passwordChangedAt: new Date(), passwordInvalidBefore: null })
      .where(eq(users.id, uid));
    expect(loiDoi, "cầu chì: `chanNeuPhaiDoiMatKhau` không còn ném ⇒ ô này rỗng nghĩa").not.toBeNull();

    // Cho `thuXacThucRest` gặp ĐÚNG hai lượt ném ấy.
    const voi = async (loi: unknown) => {
      // ⚠ Ghi đè một **thuộc tính của thực thể** (`sdk` là `new SDKServer()`), rồi `delete` để trả
      //   về phương thức trên prototype — KHÔNG chạm module namespace.
      (sdk as unknown as Record<string, unknown>).authenticateRequest = async () => {
        throw loi;
      };
      const kq = await thuXacThucRest({} as never);
      delete (sdk as unknown as Record<string, unknown>).authenticateRequest;
      return kq;
    };

    const kqTat = await voi(loiTat);
    expect(kqTat.ok).toBe(false);
    expect(
      kqTat.ok ? null : [kqTat.ma, kqTat.lyDo],
      "tài khoản bị TẮT trả 401 ⇒ client đá người dùng về màn đăng nhập, nơi họ bị từ chối LẦN NỮA",
    ).toEqual([403, "ACCOUNT_DISABLED"]);

    const kqDoi = await voi(loiDoi);
    expect(
      kqDoi.ok ? null : [kqDoi.ma, kqDoi.lyDo],
      "buộc-đổi-mật-khẩu trả 401 ⇒ 'đăng nhập lại' là lời khuyên KHÔNG cứu được họ",
    ).toEqual([403, "MUST_CHANGE_PASSWORD"]);

    // ⚠ HAI mã phải KHÁC NHAU: gộp là để một trục núp sau trục kia (bài học "ba trục là ba trục").
    expect(kqTat.ok || kqDoi.ok ? "?" : kqTat.lyDo === kqDoi.lyDo).toBe(false);
  });

  it("★★★★ §8b phiên hỏng ⇒ 401 · lỗi KHÔNG phải `HttpError` ⇒ 500 (fail-closed cả hai)", async () => {
    const { thuXacThucRest } = await import("./_xacThucRest");
    const { ForbiddenError } = await import("@shared/_core/errors");
    const voi = async (loi: unknown) => {
      (sdk as unknown as Record<string, unknown>).authenticateRequest = async () => {
        throw loi;
      };
      const kq = await thuXacThucRest({} as never);
      delete (sdk as unknown as Record<string, unknown>).authenticateRequest;
      return kq;
    };

    for (const msg of [
      "Invalid session cookie",
      "SESSION_NOT_IN_LEDGER: Session has been revoked (no ledger row); please sign in again",
      "Session has been revoked",
      "User not found",
    ]) {
      const kq = await voi(ForbiddenError(msg));
      expect(kq.ok ? null : [kq.ma, kq.lyDo], `"${msg}" phải là 401/AUTH_REQUIRED`).toEqual([
        401,
        "AUTH_REQUIRED",
      ]);
    }

    // ⚠ KHÔNG phải một phán quyết của tầng xác thực ⇒ máy chủ hỏng, và nói THẬT.
    const kq500 = await voi(new TypeError("Cannot read properties of undefined (reading 'query')"));
    expect(
      kq500.ok ? null : [kq500.ma, kq500.lyDo],
      "một sự cố DB bị dán nhãn 401 là nói dối 'lỗi của bạn', và nó BIẾN MẤT khỏi mọi bảng theo dõi 5xx",
    ).toEqual([500, "DB_UNAVAILABLE"]);

    // FAIL-CLOSED: KHÔNG lượt nào trong cả hai lớp trả `ok: true`.
    expect(kq500.ok).toBe(false);
  });

  it("★★★ §8c thân phản hồi mang MÃ MÁY-ĐỌC-ĐƯỢC, và mã ấy có khoá i18n ở CẢ BA locale", async () => {
    /**
     * ⚠ Không có ô này, `code` là một chuỗi client không dịch được ⇒ người dùng thấy đúng câu
     *   tiếng Anh cứng mà lượt vá này sinh ra để xoá. Đọc **file locale thật**, không một danh sách.
     */
    const { thanTuChoiRest } = await import("./_xacThucRest");
    const codes = (["AUTH_REQUIRED", "MUST_CHANGE_PASSWORD", "ACCOUNT_DISABLED", "DB_UNAVAILABLE"] as const).map(
      (lyDo) => thanTuChoiRest({ ok: false, ma: 401, lyDo }),
    );
    expect(codes.map((c) => c.code)).toEqual([
      "AUTH_REQUIRED",
      "MUST_CHANGE_PASSWORD",
      "ACCOUNT_DISABLED",
      "DB_UNAVAILABLE",
    ]);
    expect(codes.every((c) => c.error.length > 0), "`error` rỗng ⇒ client cũ mất hẳn câu dự phòng").toBe(true);

    for (const l of ["en", "vi", "zh"]) {
      const bundle = JSON.parse(
        readFileSync(join(GOC, "client", "src", "i18n", "locales", `${l}.json`), "utf8"),
      ) as { errors?: Record<string, string> };
      for (const c of codes) {
        expect(
          typeof bundle.errors?.[c.code],
          `thiếu khoá \`errors.${c.code}\` ở locale \`${l}\` ⇒ người dùng thấy chuỗi tiếng Anh cứng`,
        ).toBe("string");
      }
    }
  });
});
