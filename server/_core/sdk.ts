import { randomBytes } from "node:crypto";
import { AXIOS_TIMEOUT_MS, COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
// ★★★★ Pha 8 Task 1 — chủ DUY NHẤT của vị từ "lượt gọi này có bị cổng BUỘC-ĐỔI-MẬT-KHẨU chặn không".
import { biChanBoiCongDoiMatKhau } from "@shared/buocDoiMatKhau";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import {
  getCachedAuthUser,
  setCachedAuthUser,
} from "../services/authSessionCache";
// ★★★ Review TOÀN NHÁNH Pha 8 C-1/C-2 §3 — bộ đếm có bề mặt Prometheus (chủ trung lập, không vòng nhập).
import { nhichChanPhienDaThuHoi, nhichChanPhienKhongCoHang } from "./demSoPhien";
// ★★★ Pha 7 Task 7 — chủ DUY NHẤT của "cột nào của `users` được rời máy chủ".
import { redactServerOnlyUserFields } from "./publicUser";
import { ENV } from "./env";
// ★★★★ Pha 9 — CHỦ DUY NHẤT của "một phiên sống bao lâu" (mặc định 30 ngày, `SESSION_TTL_DAYS`).
import { hanPhienMs } from "./hanPhien";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

/** Tuỳ chọn của {@link SDKServer.authenticateRequest}. */
export type TuyChonXacThuc = {
  /**
   * 🔴 Bỏ qua cổng buộc-đổi-mật-khẩu ở biên xác thực. **Một người gọi duy nhất được phép**:
   * `server/_core/context.ts` — xem khối docstring của `authenticateRequest`, và lưới ghim
   * `server/_core/buocDoiMatKhauMoiBeMat.test.ts` §5.
   */
  boQuaCongDoiMatKhau?: boolean;
};

/**
 * ★★★★ Pha 8 Task 1 — **PHÉP CHẶN, DÙNG CHUNG CHO MỌI BỀ MẶT NGOÀI tRPC.**
 *
 * Ném khi *(và chỉ khi)* hàng `users` này đang bị buộc đổi mật khẩu **và** vai của nó không nằm
 * trong tập miễn trừ **cố ý** (`shared/buocDoiMatKhau.ts` — quyết định chủ dự án 2026-08-09).
 *
 * ⚠⚠ **ĐỌC DB MỚI, KHÔNG suy từ hàng trong tay.** Hàng đi qua đây đã qua
 *    `redactServerOnlyUserFields` hoặc đến từ bộ nhớ đệm phiên (tới 60 s) ⇒ mọi phép suy tại chỗ
 *    sẽ cho `false` **luôn luôn**: một lời nói dối im lặng theo chiều **MỞ**. Đây đúng lớp lỗi đã
 *    được ghi thành cảnh báo ở `shared/buocDoiMatKhau.ts`.
 * ⚠ **KHÔNG `try/catch` quanh lượt đọc DB** — DB nấc thì lượt gọi **hỏng** (fail-closed). Bọc lại
 *   và cho qua là để một `catch` mặc áo của phép đo.
 * ⚠ Ném `ForbiddenError` (không `TRPCError`): 12/13 người gọi là tuyến REST/socket, và **tất cả**
 *   đều đã bọc lượt xác thực trong `try/catch` trả 401/403 ⇒ hành vi mới là **fail-closed** ở cả
 *   13 chỗ mà không phải sửa chỗ nào. Chuỗi `MUST_CHANGE_PASSWORD` nằm trong thông điệp để lượt gỡ
 *   lỗi phân biệt được nó với một phiên hết hạn thường.
 */
export async function chanNeuPhaiDoiMatKhau(user: User): Promise<void> {
  if (biChanBoiCongDoiMatKhau(user.role, await db.phaiDoiMatKhau(user.id))) {
    throw ForbiddenError(
      "MUST_CHANGE_PASSWORD: Bạn phải đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.",
    );
  }
}

/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **C-1** — **PHÉP CHẶN TÀI KHOẢN BỊ TẮT, DÙNG CHUNG MỌI BỀ MẶT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO HÀM NÀY TỒN TẠI — CƠ CHẾ ĐÃ CÓ TRÊN HAI ĐƯỜNG **HẸP**, VẮNG TRÊN ĐƯỜNG **CHÍNH**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước bản vá, `xacThucTho` hỏi ba câu (*vé ký đúng không* · *hàng sổ phiên còn sống không* ·
 * *có bị buộc đổi mật khẩu không*) và **không bao giờ** hỏi *"tài khoản này còn được bật không"*.
 * Cùng lúc đó, phép kiểm ấy **đã tồn tại** ở hai chỗ hẹp hơn nhiều:
 *
 *     server/_core/index.ts   `validateExternalAuth` (nhánh Bearer)  ← 58 tuyến `/api/external/*`
 *     server/_core/authService.ts:211  lượt ĐĂNG NHẬP                ← chỉ lúc đăng nhập
 *
 * ⇒ Một tài khoản đã tắt **không đăng nhập lại được** và **không vào được `/api/external/*`**,
 *   nhưng **cookie đang cầm trên tay thì dùng được toàn bộ ứng dụng web** — tRPC, socket, và mọi
 *   tuyến REST phiên. Đúng lớp lỗi *"an toàn là HỆ QUẢ của thứ khác đang hỏng"*: người ta tin lượt
 *   ban có hiệu lực vì **lượt đăng nhập** chặn, mà lượt đăng nhập không phải cửa mà một phiên đang
 *   sống đi qua.
 *
 * **ĐO ĐƯỢC trước bản vá** (probe hành vi trên DB test thật, đường sản phẩm `db.updateUser`):
 *
 *     ### hàng user_sessions sau lượt tắt: isActive = true
 *     ### KẾT QUẢ SAU KHI TẮT TÀI KHOẢN: ĐI QUA id=2103 role=user isActive=false
 *
 * Với `expiresInMs: ONE_YEAR_MS` ở cả ba cửa đúc vé, đó là **tới một năm toàn quyền của vai cũ**.
 *
 * ⚠⚠ **VÌ SAO ĐỌC CỜ TỪ HÀNG TRONG TAY, KHÔNG PHẢI MỘT `SELECT` MỚI** — *"vá cho khớp bên chặt
 *    hơn, đừng phát minh cơ chế mới"*: cả hai đường hẹp đã có đều kiểm `user.isActive` trên **đúng
 *    hàng chúng vừa lấy**. Một lượt đọc mới là bất biến **thứ tư** trên cùng một cửa và thêm một
 *    `SELECT` cho mỗi request (A2 đã trả −44% thông lượng cho lượt đọc thứ hai). Nửa còn lại của
 *    bản vá — `db.updateUser` **thu hồi** mọi phiên khi tắt tài khoản — là thứ làm lượt đọc A2 đã
 *    trả tiền cho **chạm được** ý định thu hồi phổ biến nhất; xem khối lý lẽ ở `server/db/auth.ts`.
 *
 * ⚠ **`=== false` tường minh, KHÔNG phải `!user.isActive`**: cột cho phép `NULL`, và một hàng
 *   `NULL` là *"chưa ai nói gì"*, không phải *"đã bị tắt"*. `!null` là `true` ⇒ viết `!` là dựng
 *   một **nhà tù** cho mọi hàng chưa đặt cờ. Pha 7 đã ship một nhà tù thật 4/4 tài khoản một lần.
 *
 * ⚠ VÙNG MÙ ĐƯỢC KHAI: hàng đến từ **bộ nhớ đệm phiên** là ảnh chụp tới `AUTH_CACHE_TTL_S` giây.
 *   Lượt tắt đi qua **đường sản phẩm** (`db.updateUser`) không có cửa sổ ấy — nó dọn cache **và**
 *   thu hồi phiên, nên `chanNeuPhienDaThuHoi` (đứng TRƯỚC cache) chặn ngay. Cửa sổ chỉ còn cho một
 *   lượt lật cờ bằng **SQL thẳng**, và nó ≤ TTL, không phải ≤ một năm.
 */
export async function chanNeuTaiKhoanBiTat(user: User): Promise<void> {
  if (user.isActive === false) {
    throw ForbiddenError(
      "ACCOUNT_DISABLED: Tài khoản của bạn đã bị vô hiệu hoá. Vui lòng liên hệ quản trị viên.",
    );
  }
}

/**
 * ★★★★ Review TOÀN NHÁNH Pha 8 · **C-1** — **PHÉP THU HỒI PHIÊN, DÙNG CHUNG CHO MỌI BỀ MẶT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO HÀM NÀY TỒN TẠI — MỘT BẤT BIẾN, HAI ĐƯỜNG ĐI, MỘT ĐƯỜNG BỎ QUÊN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 8 Task 2 làm `auth.logout` thu hồi **thật**, và cơ chế cưỡng chế **DUY NHẤT** là hàng
 * `user_sessions`: `xacThucTho` tra sổ mỗi lượt. Nhưng `validateExternalAuth`
 * (`server/_core/index.ts`, nhánh `Authorization: Bearer`) **tự phân giải danh tính**
 * (`verifySession` + `getUserByOpenId`) và **không bao giờ tra sổ** ⇒ **58 tuyến `/api/external/*`**
 * vẫn nhận một cookie ĐÃ ĐĂNG XUẤT cho tới `exp` (đo được: **2027**).
 *
 * Đo sống trước bản vá (máy chủ PID 37600, `engineer1` #51): `auth.logout` ⇒ 200 · hàng sổ 290
 * `isActive=f` · `auth.me` ⇒ `null` · **cùng token** trên `GET /api/external/health` ⇒ **200**
 * (đối chứng âm không-auth ⇒ 401).
 *
 * ⇒ Vị từ được **RÚT RA MỘT CHỦ** và gọi từ **cả hai** đường. Viết bản sao thứ hai là đúng lớp lỗi
 *   *"nhiều chủ cho một bất biến"* đã đẻ ba Critical trong chuỗi pha này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ 2026-08-11 — **NHÁNH "KHÔNG CÓ HÀNG ⇒ CHO QUA" ĐÃ BỊ SIẾT. CHỦ DỰ ÁN DUYỆT.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước lượt này, một vé **không nằm trong sổ** vẫn dùng được ⇒ **mọi** cơ chế thu hồi của Pha 7/8
 * vô hiệu với đúng loại vé ấy. Đo sống trước lượt siết (máy chủ PID 34072, `engineer1` #51):
 *   · đăng nhập ⇒ 200, có hàng sổ · **XOÁ hàng sổ** ⇒ `auth.me` **VẪN** trả hồ sơ đầy đủ (id 51);
 *   · `POST /api/external/auth/login` đúc một vé **KHÔNG BAO GIỜ ghi sổ** (0 hàng) ⇒ vé ấy vào
 *     `GET /api/external/health` ⇒ **200**, và dán thẳng vào cookie ⇒ `auth.me` ⇒ **id 51**.
 *
 * ⚠⚠⚠ **VÌ SAO KHÔNG DÙNG "MỐC `iat`" NHƯ BÁO CÁO REVIEW ĐỀ XUẤT — PHÉP ĐO BÁC BỎ CHÍNH ĐỀ XUẤT ẤY.**
 *    `signSession` **chưa bao giờ gọi `.setIssuedAt()`**. Payload một vé thật, giải mã trên máy chủ
 *    đang chạy: `{openId, appId, name, jti, exp}` — **KHÔNG có `iat`**. Nghĩa là *"tha vé có `iat`
 *    cũ hơn mốc M"* **không đánh giá được** trên đúng những vé cần được tha: với chúng `iat` là
 *    `undefined`. Suy ngược `iat = exp − TTL` thì TTL do `SESSION_TTL_DAYS` **cấu hình được** ⇒ một
 *    **trần đoán trên dữ liệu ngoài tầm kiểm soát**, đúng lớp lỗi mà `0317`/`0318` sinh ra để giết.
 *    ⇒ Chọn **fail-closed thẳng**, và trả giá bằng một câu nói ra được: *"vé không có hàng thì chết"*.
 *
 * ⚠⚠ **ĐIỀU KIỆN ĐỦ ĐỂ SIẾT MÀ KHÔNG DỰNG NHÀ TÙ: "có vé ⇒ có hàng" phải đúng ở MỌI cửa đúc.**
 *    Phép đếm trước lượt siết: **5** điểm gọi `createSessionToken`, chỉ **1** (`establishSession`)
 *    ghi sổ. Bốn điểm còn lại — hai callback OAuth, ACS của SAML, và `/api/external/auth/login` —
 *    đúc vé rồi **không ghi gì**. Siết mà không vá bốn điểm ấy là ship một lượt **mất hẳn** đường
 *    đăng nhập OAuth/SAML và **đứt toàn bộ** API ngoài (có client thật trong repo:
 *    `FactoryAlertSystem`). Cả bốn đã được vá trong cùng lượt, và lượng từ canh chuyện *"điểm đúc
 *    thứ SÁU cũng phải ghi sổ"* là `server/routers/sessionGrantScan.test.ts` §4 — trên **hình dạng**,
 *    không trên một danh sách bốn tên ("N+1" đã mười tám lần).
 *
 * ⚠ **FAIL-OPEN trên lỗi TRA CỨU** (DB nấc) **giữ nguyên**: một lượt hỏng thoáng qua không được
 *   khoá cả nhà máy ra ngoài. Đây là hai nhánh KHÁC NHAU — "không có hàng" ≠ "không hỏi được", và
 *   chỉ nhánh THỨ NHẤT bị siết.
 * ⚠ Vé **rỗng/thiếu** vẫn trả sớm: ở đó không có gì để tra, và người gọi phía trên
 *   (`xacThucTho` ⇒ `verifySession`) đã từ chối một cookie trống rồi.
 */
export async function chanNeuPhienDaThuHoi(token: string | null | undefined): Promise<void> {
  if (!isNonEmptyString(token)) return;
  let daThuHoi = false;
  let khongCoHang = false;
  try {
    const hang = await db.getSessionByToken(token);
    if (hang) {
      const hetHan =
        hang.expiresAt != null && new Date(hang.expiresAt).getTime() <= Date.now();
      daThuHoi = hang.isActive === false || hetHan;
    } else {
      // ★★★★ 2026-08-11 SIẾT: không có hàng → **TỪ CHỐI** (trước đây: cho qua). Xem khối lý lẽ trên.
      khongCoHang = true;
    }
  } catch (error) {
    // Fail-open trên lỗi TRA CỨU (DB không với tới được), KHÔNG phải trên "không có hàng".
    console.warn("[Auth] Session-active check failed; failing open:", String(error));
    return;
  }
  if (khongCoHang) {
    nhichChanPhienKhongCoHang();
    throw ForbiddenError(
      "SESSION_NOT_IN_LEDGER: Session has been revoked (no ledger row); please sign in again",
    );
  }
  if (daThuHoi) {
    nhichChanPhienDaThuHoi();
    throw ForbiddenError("Session has been revoked");
  }
}

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }

  private decodeState(state: string): string {
    const redirectUri = atob(state);
    return redirectUri;
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
      },
      options
    );
  }

  /**
   * ★★★★ Pha 8 — **CỬA ĐÚC DUY NHẤT của một vé phiên, và nay mỗi vé là MỘT vé.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VÌ SAO CÓ `jti` — HAI LƯỢT ĐĂNG NHẬP TRONG CÙNG MỘT GIÂY TỪNG CHO RA **CÙNG MỘT** JWT
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Trước bản vá, payload chỉ có `{openId, appId, name}` cộng `exp` **tính theo GIÂY**. HS256 là
   * hàm **tất định**: cùng đầu vào ⇒ cùng byte. Nên hai lượt đăng nhập của cùng một người trong
   * cùng một giây sinh ra **JWT giống hệt nhau**, và hệ quả đo được nằm ở tầng dưới:
   *   · `user_sessions.sessionToken` có ràng buộc **UNIQUE** ⇒ lượt ghi sổ thứ hai **vỡ** (`23505`);
   *   · `ghiSoPhien` không ném (cố ý — xem `authService.ts`), nên lượt đăng nhập thứ hai vẫn nhận
   *     cookie hợp lệ **nhưng không có hàng phiên của riêng nó** ⇒ **vô hình** với `session.list`
   *     và **ngoài tầm** `session.revoke`;
   *   · và vì hai phiên dùng **chung một khoá**, thu hồi một cái là thu hồi **cả hai** — hai thiết
   *     bị khác nhau không còn tách rời được.
   *
   * `jti` = 9 byte ngẫu nhiên mã base64url (**12 ký tự**, 72 bit). Đặt ở **`signSession`** chứ
   * không ở `createSessionToken`: đây là cửa **duy nhất** mọi vé đi qua (xem
   * `server/routers/sessionGrantScan.test.ts`), nên không đường đúc nào lọt ra ngoài luật này.
   *
   * ⚠ Điều kiện đủ để ship: trần `varchar(255)` của `user_sessions.sessionToken` đã được **nới
   *   thành `text`** (mig `0317`). Thêm nonce khi trần còn 255 ⇒ `22001` cho mọi người dùng tên
   *   tiếng Việt — đã đo, và đó là lý do lượt trước phải hoàn nguyên.
   * ⚠ `verifySession` **không** đọc `jti`: nó là **entropy**, không phải một điều kiện. Thêm phép
   *   kiểm ở đó sẽ làm mọi cookie đã cấp trước bản vá **chết ngay lập tức**.
   */
  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    /**
     * ★★★★ Pha 9 — **HẠN PHIÊN VỀ MỘT CHỦ (`_core/hanPhien.ts`), MẶC ĐỊNH 365 → 30 NGÀY.**
     *
     * Khối cũ ở đây đọc `SESSION_TTL_DAYS` và mặc định `ONE_YEAR_MS` *"để không vô hiệu hoá phiên
     * đang có khi nâng cấp"*. Cả hai vế đều đã hết đúng:
     *  · **vế cấu hình**: `??` bên dưới nghĩa là mặc định chỉ áp dụng khi người gọi **không** truyền
     *    `expiresInMs` — mà **cả bốn** cửa đúc vé phiên đều truyền `ONE_YEAR_MS` **tường minh** ⇒
     *    `SESSION_TTL_DAYS` là **MÃ CHẾT**. Lượt này gỡ cả bốn lượt truyền ấy.
     *  · **vế "không vô hiệu hoá phiên đang có"**: `exp` nằm **trong vé đã ký**, nên đổi mặc định
     *    ở đây **theo cấu tạo** chỉ chạm vé **MỚI**. Nỗi lo ấy chưa bao giờ đúng — và nó đã mua một
     *    cửa sổ khai thác **365 ngày** cho mọi cookie bị bắt. Đo sống: `Max-Age=31536000`.
     * ⚠ Lượt nhập `ONE_YEAR_MS` đã được GỠ khỏi file này: sau lượt vá không còn điểm dùng nào
     *   (đo bằng AST, không bằng `grep` — hai lượt còn lại nằm trong khối bình luận).
     */
    const expiresInMs = options.expiresInMs ?? hanPhienMs();
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      // ⚠ NONCE — thứ DUY NHẤT làm hai vé của cùng một người trong cùng một giây khác nhau.
      .setJti(randomBytes(9).toString("base64url"))
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) {
      // This is normal for unauthenticated requests - no need to warn
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name } = payload as Record<string, unknown>;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        !isNonEmptyString(name)
      ) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      return {
        openId,
        appId,
        name,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    // Local-login mode (no OAUTH_SERVER_URL): the axios client has no base URL,
    // so POSTing the relative gRPC path throws `TypeError: Invalid URL`. Fail
    // cleanly instead — the caller treats this as an unsynced/unauthenticated
    // user rather than crashing the request / Socket.io handshake.
    if (!ENV.oAuthServerUrl) {
      throw ForbiddenError(
        "OAuth sync unavailable: OAUTH_SERVER_URL is not configured (local-login mode)"
      );
    }
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  /**
   * ★★★★ Pha 8 Task 1 — **BIÊN XÁC THỰC LÀ ĐIỂM CHUNG DUY NHẤT CỦA MỌI BỀ MẶT.**
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠⚠⚠ VÌ SAO PHÉP CHẶN NẰM Ở ĐÂY, KHÔNG PHẢI Ở 11 CHỖ
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Pha 7 đặt cổng buộc-đổi-mật-khẩu ở `thuTucGoc` của tRPC. Lượng từ ấy đúng **cho tRPC**, và
   * chính vì thế nó **theo cấu tạo** không thấy các bề mặt khác. Phép đếm ở Pha 8 Task 1 (bằng AST,
   * trên toàn `server/**` mã sản xuất) cho **13** điểm xác thực: **12** đi qua chính phương thức
   * này, **1** vòng qua nó (`_core/index.ts::validateExternalAuth`, nhánh Bearer). Người bị buộc
   * đổi mật khẩu **vẫn dùng được 12 bề mặt** — SSE của AI, `local-kb`, xuất dữ liệu, đo lường,
   * tải APK, và **handshake socket**.
   *
   * ⇒ Vá ở **ĐÂY**: mọi bề mặt HTTP/socket hỏi *"yêu cầu này là ai"* đều hỏi qua đúng một cửa. Một
   *   tuyến REST **mới ở một file chưa tồn tại** được cưỡng chế **tự động**, không ai phải nhớ khai
   *   gì — đúng thứ mà một danh sách 11 chỗ không bao giờ làm được (**"N+1" đã mười tám lần**).
   *   Lưới của lượng từ ấy: `server/_core/buocDoiMatKhauMoiBeMat.test.ts`.
   *
   * ⚠ **PHÂN GIẢI DANH TÍNH và CƯỠNG CHẾ CHÍNH SÁCH là HAI việc**, nên chúng là hai thân hàm:
   *   `xacThucTho()` trả lời *"ai"*, phương thức này thêm *"và người ấy có được đi tiếp không"*.
   *   Nhờ một **lối ra DUY NHẤT**, không có nhánh nào (kể cả nhánh trúng bộ nhớ đệm phiên) trả về
   *   một người dùng chưa qua cổng — lớp lỗi *"1/6 lượt rò, 5/6 lượt sạch"* đã đo được ở Pha 7 trên
   *   đúng phương thức này.
   *
   * ⚠ CHI PHÍ, ghi đúng: **1 `SELECT` hai cột trên `users` theo khoá chính** cho mỗi lượt xác thực
   *   của một người dùng **không** được miễn trừ. `admin` (miễn trừ) trả **0** đồng chi phí. Không
   *   cache: một bộ nhớ đệm sẽ giữ người **vừa đổi mật khẩu** trong nhà tù thêm một TTL.
   *
   * @param tuyChon.boQuaCongDoiMatKhau ⚠⚠⚠ **CHỈ** `_core/context.ts` được truyền cờ này, và
   *   `buocDoiMatKhauMoiBeMat.test.ts` §5 **ghim** điều đó. Lý do: tRPC **phải** dựng được
   *   `ctx.user` cho người đang bị chặn — nếu không, `auth.me` trả `null`, client mất đúng ô nó
   *   dùng để biết mình phải đi đâu, và cổng thành một **nhà tù** (Pha 7 đã deploy một lần ra nhà
   *   tù thật **4/4 tài khoản**). Ở đó phép chặn được làm lại **mịn hơn** tại `thuTucGoc`, nơi biết
   *   `path` nên tha được đúng bốn đường của vòng đời đổi mật khẩu.
   */
  async authenticateRequest(req: Request, tuyChon?: TuyChonXacThuc): Promise<User> {
    const user = await this.xacThucTho(req);
    if (tuyChon?.boQuaCongDoiMatKhau !== true) await chanNeuPhaiDoiMatKhau(user);
    return user;
  }

  /** Phân giải *"yêu cầu này là ai"* — **KHÔNG** quyết định người ấy có được đi tiếp hay không. */
  private async xacThucTho(req: Request): Promise<User> {
    // Regular authentication flow
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    /**
     * ★★★★ Pha 9 nhóm A · **A2 — PHÉP TRA SỔ ĐỨNG TRƯỚC BỘ NHỚ ĐỆM, MỘT CALL SITE DUY NHẤT.**
     *
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠⚠⚠ ĐO ĐƯỢC (DB test thật, `__a2probe`), KHÔNG PHẢI SUY LUẬN
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Trước bản vá, phép tra sổ nằm **DƯỚI** nhánh trúng cache, nên một phiên bị thu hồi **ngoài
     * đường sản phẩm** vẫn đi qua trọn một cửa sổ TTL. Hai hình dạng, cả hai đo được:
     *   · XOÁ thẳng hàng `user_sessions` bằng SQL ⇒ lượt kế tiếp **ĐI QUA**
     *   · lật `isActive=false` bằng SQL          ⇒ lượt kế tiếp **ĐI QUA**
     * Đối chứng hiệu chuẩn (`AUTH_CACHE_TTL_S=0`) ⇒ **CHẶN** (`SESSION_NOT_IN_LEDGER`) ⇒ cơ chế
     * cưỡng chế CÓ THẬT và còn sống; thứ cho qua đúng là **bộ nhớ đệm**, không phải một thước hỏng.
     *
     * ⚠⚠ VÌ SAO **DỜI LÊN** chứ không **CHÉP THÊM** một lượt gọi vào nhánh trúng cache: chép là
     *    dựng người ghi **thứ hai** dưới cùng một bất biến — đúng lớp lỗi đã đẻ ba Critical trong
     *    chuỗi pha này (và đúng thứ Pha 7 đo được ở chính phương thức này: *"1/6 lượt rò, 5/6 lượt
     *    sạch"* vì hai nhánh làm hai việc khác nhau). Nay **một lối vào, một luật**.
     *
     * ⚠ CHI PHÍ, ghi đúng và ĐÃ ĐO — **KHÔNG ước lượng**: +1 `SELECT` theo `sessionToken` cho mỗi
     *   lượt trúng cache. Đây là **1 → 2**, KHÔNG phải 0 → 1: nhánh trúng cache **đã** trả một
     *   `SELECT` mỗi lượt cho `chanNeuPhaiDoiMatKhau` (cố ý không cache).
     *   2.000 lượt trúng cache, cùng máy, cùng DB, **ba lượt đo mỗi bên**:
     *     · TRƯỚC: 1,3516 · 1,3103 · 1,3758 ms/lượt  ⇒ **~740 lượt/s**
     *     · SAU:   2,3555 · 2,4221 · 2,6302 ms/lượt  ⇒ **~413 lượt/s**  (**−44%**)
     *   ⇒ Cái giá là THẬT và được nói ra. Nó vẫn được trả vì: (a) tải xác thực thật của một nhà máy
     *     cách ngưỡng 413 lượt/s **hai bậc độ lớn**; (b) bộ nhớ đệm vẫn giữ giá trị lớn nhất của nó
     *     — bỏ `getUserByOpenId` **và lượt GHI `upsertUser` mỗi request**; (c) cái được mua là bất
     *     biến *"thu hồi có hiệu lực NGAY"*, thứ mà một cửa sổ 45 s làm sai theo chiều **MỞ**.
     *   ⚠ NỢ MỚI đã ghi: hai `SELECT` này (`user_sessions` theo token · `users` theo id) **gộp được
     *     thành một** câu `JOIN`. Không làm trong lượt này vì gộp là dựng một **chủ thứ ba** cho hai
     *     bất biến đang có chủ riêng — một quyết định phải nói ra, không phải một lượt tối ưu lén.
     */
    await chanNeuPhienDaThuHoi(sessionCookie);

    // W4-B (doc 27 B4): short-TTL session→user cache. The JWT signature was
    // verified above (stateless, no DB); a cache hit means the user lookup and
    // the lastSignedIn touch completed successfully within the last
    // AUTH_CACHE_TTL_S seconds, so we skip those 2 DB round-trips. The
    // revocation check is NO LONGER among them — see the block above.
    //
    // ★★ Review TOÀN NHÁNH Pha 9 · **M-3 — CÂU CẢNH BÁO CŨ ĐƯỢC TRẢ LẠI, THU HẸP ĐÚNG PHẦN ĐÃ VÁ.**
    // A2 viết lại khối này và **bỏ** câu cũ *"Staleness window (role change / ban / revocation …)
    // is bounded by the TTL"*, trong khi A2 chỉ vá nhánh **revocation**. Một bình luận nói **ÍT
    // HƠN** sự thật cũng là tài liệu sai — và nhánh `ban` thì còn tệ hơn thế (xem C-1).
    // ⇒ Cửa sổ cũ (≤ AUTH_CACHE_TTL_S) vẫn còn cho:
    //     · **đổi VAI** — `updateUserRole`/`updateUser` dọn cache nên đường sản phẩm ăn ngay; một
    //       lượt đổi bằng **SQL thẳng** thì chờ hết TTL;
    //     · **tắt TÀI KHOẢN** — như trên. Đường sản phẩm nay còn **thu hồi phiên** (C-1) nên nó ăn
    //       ngay hai lần; cửa sổ chỉ còn cho lượt lật cờ ngoài đường sản phẩm.
    //   **Không** còn cho: thu hồi PHIÊN (A2 dời phép tra sổ lên trên khối này).
    const cachedUser = await getCachedAuthUser(sessionCookie!);

    /**
     * ★★★★ Review TOÀN NHÁNH Pha 9 · **C-1 — MỘT LỐI RA DUY NHẤT CHO CẢ HAI NHÁNH.**
     *
     * ⚠⚠⚠ Nhánh trúng cache trước đây `return` **thẳng** tại đây. Thêm một lượt gọi
     *    `chanNeuTaiKhoanBiTat` vào nhánh ấy **và** một lượt nữa ở cuối là dựng **hai bản sao**
     *    dưới cùng một bất biến — đúng lớp lỗi đã đẻ **bốn** Critical trong chuỗi pha này, và đúng
     *    thứ Pha 7 đo được ở chính phương thức này (*"1/6 lượt rò, 5/6 lượt sạch"* vì hai nhánh làm
     *    hai việc khác nhau). ⇒ Hai nhánh **hội** về một biến, rồi **một** cổng, rồi **một** lối ra.
     *    `taiKhoanBiTatMoiBeMat.test.ts` §6 ghim **ĐÚNG MỘT** call site bằng AST.
     */
    let nguoiDung: User | null = cachedUser;

    if (nguoiDung === null) {
      const sessionUserId = session.openId;
      const signedInAt = new Date();
      let user = await db.getUserByOpenId(sessionUserId);

      // If user not in DB, sync from OAuth server automatically
      if (!user) {
        try {
          const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
          await db.upsertUser({
            openId: userInfo.openId,
            name: userInfo.name || null,
            email: userInfo.email ?? null,
            loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
            lastSignedIn: signedInAt,
          });
          user = await db.getUserByOpenId(userInfo.openId);
        } catch (error) {
          if (!ENV.oAuthServerUrl) {
            // Expected in local-login deployments: the session is valid but the
            // user row is missing and there is no OAuth server to sync from.
            console.warn(
              `[Auth] Session user ${sessionUserId} not found and OAuth sync is disabled (local-login mode).`
            );
          } else {
            console.error("[Auth] Failed to sync user from OAuth:", error);
          }
          throw ForbiddenError("Failed to sync user info");
        }
      }

      if (!user) {
        throw ForbiddenError("User not found");
      }

      // FU-3: Enforce session revocation at the auth layer.
      //
      // The session JWT is stateless, so a revoked session's cookie would still
      // verify (and thus authenticate) until it expired. P0-B persists a
      // `user_sessions` row keyed by this exact cookie (== sessionToken) and
      // session.revoke / revokeAll flip that row's isActive to false. This makes
      // that revocation actually take effect.
      //
      // ★★★★ Review TOÀN NHÁNH Pha 8 · C-1 — **thân của vị từ đã rút ra
      // `chanNeuPhienDaThuHoi` (cùng file, ngay trên `SDKServer`)** vì nó có người dùng THỨ HAI:
      // nhánh `Authorization: Bearer` của `validateExternalAuth` (`_core/index.ts`), điểm xác thực
      // DUY NHẤT vòng qua `authenticateRequest`. Hai bản sao ⇒ bản yếu hơn quyết định lưới nào đỏ.
      // Lượng từ canh chuyện này: `server/_core/thuHoiPhienMoiBeMat.test.ts`.
      // ★ Pha 9 · A2 — lượt gọi ĐÃ DỜI LÊN TRƯỚC bộ nhớ đệm (xem khối lý lẽ ở đó). Ở đây **KHÔNG**
      //   còn lượt gọi thứ hai: một bất biến, một chủ.

      await db.upsertUser({
        openId: user.openId,
        lastSignedIn: signedInAt,
      });

      // Cache only after EVERY check passed (user found + active session).
      // NOTE: this also throttles the lastSignedIn write above to once per
      // TTL window per session instead of once per request.
      await setCachedAuthUser(sessionCookie!, user);

      // ★★★ Pha 7 Task 7 — **BIÊN XÁC THỰC LÀ CHỖ HẸP NHẤT.** Mọi `ctx.user`, mọi
      // `socket.data.user`, mọi `req.externalUser`, và cả `localStorage["manus-runtime-user-info"]`
      // của trình duyệt đều bắt nguồn từ đúng một giá trị này. Làm rỗng bí mật **ở đây** đóng cùng
      // lúc bốn bề mặt, thay vì vá bốn chỗ (và bỏ sót cái thứ năm).
      // ⚠ ĐO TRƯỚC KHI ĐỔI: `git grep` mọi điểm đọc `passwordHash`/`twoFactorSecret` ⇒ **6 điểm,
      //   KHÔNG điểm nào** đọc từ `authenticateRequest`; cả 6 đọc từ một lượt `db.getUserById` /
      //   `getUserByUsername` MỚI ⇒ phép làm rỗng này **không chạm** đăng nhập / đổi mật khẩu / 2FA.
      // ⚠ Nó cũng xoá tính **NGẮT QUÃNG** của lượt rò: nhánh cache-hit ở trên đã trả hàng đã che, còn
      //   nhánh này thì chưa ⇒ đo được **1/6 lượt rò, 5/6 lượt sạch**, tức một lượt nghiệm thu "nhìn
      //   một phát" sẽ báo SẠCH NHẦM. Nay hai nhánh giống hệt nhau.
      nguoiDung = redactServerOnlyUserFields(user);
    }

    // ★★★★ Review TOÀN NHÁNH Pha 9 · **C-1 — CỔNG "TÀI KHOẢN CÒN BẬT KHÔNG", LỐI RA DUY NHẤT.**
    // Đứng ở đây (không ở trong hai nhánh) vì đây là chỗ **duy nhất** cầm được hàng `users` của cả
    // hai đường đi. Xem khối lý lẽ đầy đủ ở `chanNeuTaiKhoanBiTat` (cùng file, ngay trên `SDKServer`).
    await chanNeuTaiKhoanBiTat(nguoiDung);
    return nguoiDung;
  }
}

export const sdk = new SDKServer();
