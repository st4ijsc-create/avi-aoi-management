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
  const NGOAI_PHAM_VI: Readonly<Record<string, string>> = {
    "server/routes/externalInspectionApi.ts":
      "Tuyến `/api/external/*` — xác thực bằng KHOÁ MÁY (Bearer/API key) qua `validateExternalAuth`, không phải phiên trình duyệt. Chủ thể không phải một hàng `users`.",
    "server/routes/openaiGateway.ts":
      "Cổng tương thích OpenAI — xác thực bằng API key của máy/tích hợp, cùng trục với `/api/external/*`.",
    "server/routes/edgeDownload.ts":
      "Tải gói Edge — cưỡng chế bằng token tải một lần + `x-master-key`, trục khoá máy.",
    "server/routes/reportArtifactRoutes.ts":
      "Tải hiện vật báo cáo — cưỡng chế bằng token ký của chính hiện vật (không phải phiên).",
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

  /** Mọi hàm `register…` khai báo trong `server/routes/` + `server/api/` — SUY TỪ ĐĨA. */
  function moiRegistrar(): string[] {
    const ra: string[] = [];
    const duyet = (thuMuc: string): void => {
      for (const m of readdirSync(join(GOC, thuMuc), { withFileTypes: true })) {
        const duong = `${thuMuc}/${m.name}`;
        if (m.isDirectory()) duyet(duong);
        else if (m.name.endsWith(".ts") && !m.name.endsWith(".test.ts")) {
          if (/export function register\w*\s*\(/.test(readFileSync(join(GOC, duong), "utf8"))) ra.push(duong);
        }
      }
    };
    duyet("server/routes");
    duyet("server/api");
    return ra.sort();
  }

  const REGISTRAR = moiRegistrar();

  it("★★★ CẦU CHÌ — bộ suy thấy đủ registrar trên đĩa (0 ⇒ §6 là chân lý rỗng)", () => {
    expect(
      REGISTRAR.length,
      "quét ra quá ít registrar — bộ suy phạm vi đã hỏng? (đo được ở Pha 9 A1: 22)",
    ).toBeGreaterThanOrEqual(20);
    for (const d of DA_GOI) {
      expect(REGISTRAR, `registrar được GỌI mà bộ suy không thấy: ${d}`).toContain(d);
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

  it("★★★ tập KHAI không có mục MA, và mỗi mục có lý do", () => {
    const ma = Object.keys(NGOAI_PHAM_VI).filter((d) => !REGISTRAR.includes(d));
    expect(
      ma,
      "mục ma: file đã đổi tên/biến mất ⇒ lời khai vẫn tiếp tục THA cho một registrar mới trùng đường dẫn",
    ).toEqual([]);
    for (const [k, v] of Object.entries(NGOAI_PHAM_VI)) {
      expect(v.length, `mục ngoài-phạm-vi "${k}" không nêu lý do`).toBeGreaterThan(30);
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
