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
 * ⚠ VÙNG MÙ ĐƯỢC KHAI: lượng từ chỉ phủ **ba registrar** được nhập dưới đây. Bề mặt REST của một
 *   registrar **thứ tư** nằm ngoài — đó là phạm vi của A1, không phải của ô này.
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

import { eq } from "drizzle-orm";
import * as db from "../db";
import { userSessions } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "../../shared/const";
import { clearAuthSessionCache } from "../services/authSessionCache";

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
 */
const AUTH_FREE: Readonly<Record<string, string>> = {
  "GET /api/ai/local-kb/health":
    "Thăm dò sức khoẻ KB — không đọc dữ liệu người dùng, không nhận tham số; dùng cho probe hạ tầng.",
  "POST /api/ai/local-kb/feedback":
    "Lượt gọi máy-sang-máy trong localhost từ `aiLocalKbRouter.feedback` (KHÔNG chuyển tiếp cookie); tầng tRPC đã cưỡng chế phiên. ⚠ NỢ ĐÃ GHI: tuyến này ghi tệp mà không xác thực — nên buộc loopback.",
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
      expect(v.length, `mục auth-free "${k}" không nêu lý do`).toBeGreaterThan(30);
    }
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
