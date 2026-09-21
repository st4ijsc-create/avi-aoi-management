import { appError } from "./appError";
import { ENV } from "./env";

export type NotificationPayload = {
  title: string;
  content: string;
};

const TITLE_MAX_LENGTH = 1200;
const CONTENT_MAX_LENGTH = 20000;

const trimValue = (value: string): string => value.trim();
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const buildEndpointUrl = (baseUrl: string): string => {
  const normalizedBase = baseUrl.endsWith("/")
    ? baseUrl
    : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};

// Task 10 (F3, doc71) — di trú 4 chỗ sang appError(). Đã kiểm caller: chỉ
// server/_core/systemRouter.ts `notifyOwner` mutation (adminProcedure) KHÔNG
// giới hạn max-length ở Zod (chỉ `.min(1)`) nên 2 nhánh "quá dài" bên dưới THẬT
// SỰ tới được người dùng (admin) qua errorFormatter; caller
// mqttClientManagementRouter.ts:sendTestNotification giới hạn Zod chặt hơn
// (max 255/1000, dưới TITLE_MAX_LENGTH/CONTENT_MAX_LENGTH) nên KHÔNG BAO GIỜ
// chạm 2 nhánh đó; 2 nhánh "bắt buộc" (rỗng) cũng không chạm được từ caller
// nào có Zod `.min(1)` sẵn — chỉ còn sống với caller nội bộ (mqttAlertScheduler,
// andonService, alertEvaluationService, offlineMonitor) tự dựng title/content
// không qua Zod, và các caller đó ĐỀU bọc try/catch quanh notifyOwner() (chỉ
// console.error, không rethrow) nên không tới người dùng — chỉ hữu ích cho
// log máy chủ. Field key MỚI (notificationTitle/notificationContent) vì
// "title"/"content" chưa từng có khoá field riêng.
const validatePayload = (input: NotificationPayload): NotificationPayload => {
  if (!isNonEmptyString(input.title)) {
    throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "notificationTitle" }, "Notification title is required.");
  }
  if (!isNonEmptyString(input.content)) {
    throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "notificationContent" }, "Notification content is required.");
  }

  const title = trimValue(input.title);
  const content = trimValue(input.content);

  if (title.length > TITLE_MAX_LENGTH) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "notificationTitle" },
      `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`,
    );
  }

  if (content.length > CONTENT_MAX_LENGTH) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "notificationContent" },
      `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`,
    );
  }

  return { title, content };
};

/**
 * Whether the notification service is configured at all.
 *
 * Exported so long-running loops can decide **once per cycle** instead of discovering it
 * per item — see `offlineMonitor.ts`.
 */
export function notificationConfigured(): boolean {
  return Boolean(ENV.forgeApiUrl) && Boolean(ENV.forgeApiKey);
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ "CHƯA CẤU HÌNH" LÀ MỘT SỰ THẬT TĨNH — IN MỘT LẦN, KHÔNG IN MỖI LƯỢT GỌI
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được 2026-09-21: `dist/e2e-3000.err.log` phình tới **827 MB**, và trong 2.000 dòng cuối
 * có **1.000 dòng** đúng một câu *"Notification service URL is not configured"*. Nguồn:
 * `offlineMonitor` chạy **mỗi 60 giây**, gọi `notifyOwner` cho **từng** máy offline (~1.700
 * máy vì nhịp tim đã cũ), và mỗi lượt in một dòng.
 *
 * Cấu hình thiếu hay đủ **không đổi giữa hai lượt gọi**, nên in lại là nhân bản một sự thật
 * đã biết. Hậu quả không chỉ là đĩa: một log 100 % nhiễu là một log **không ai đọc** — đúng
 * bài học dự án đã học hai lần ở `BUILD-INFO` (*"một cảnh báo LUÔN kêu thì không ai nghe"*).
 *
 * ⚠ Vẫn in **một lần** chứ không im hẳn: im hẳn là giấu một khoảng trống cấu hình thật.
 */
const daCanhBao = new Set<string>();
function canhBaoChuaCauHinh(thieu: string): void {
  if (daCanhBao.has(thieu)) return;
  daCanhBao.add(thieu);
  console.warn(
    `[Notification] ${thieu} is not configured; notifyOwner calls are skipped. ` +
      "(Cảnh báo này chỉ in MỘT LẦN cho mỗi tiến trình — xem docblock.)",
  );
}

/**
 * Dispatches a project-owner notification through the Manus Notification Service.
 * Returns `true` if the request was accepted, `false` when the upstream service
 * cannot be reached (callers can fall back to email/slack). Validation errors
 * bubble up as TRPC errors so callers can fix the payload.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  const { title, content } = validatePayload(payload);

  if (!ENV.forgeApiUrl) {
    canhBaoChuaCauHinh("URL");
    return false;
  }

  if (!ENV.forgeApiKey) {
    canhBaoChuaCauHinh("API key");
    return false;
  }

  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: JSON.stringify({ title, content }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${
          detail ? `: ${detail}` : ""
        }`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}
