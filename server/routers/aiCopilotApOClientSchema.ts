/**
 * ★ Đợt C · Task 5 / Đợt 4B-server — lược đồ đầu vào của SỔ KIỂM TOÁN lượt áp tệp ở client (chế độ LOCAL), MỘT chủ cho
 * HAI cửa: tRPC `aiCopilot.batDauApDungOClient|chotApDungOClient` (cookie phiên) và REST
 * `POST /api/ai/client-apply/bat-dau|chot` (Bearer `avgw_…` phạm vi `apply`, `routes/aiGatewayTokenBearerApi.ts`). Hai
 * bản sao lược đồ là cách hai cửa trôi khỏi nhau — đúng ô mà ràng buộc băm 64 hex canh (không cho nội dung tệp lọt vào).
 * Module LÁ: chỉ zod.
 */
import { z } from "zod";

// 64 hex ⇔ sha256. `batDauApDungOClient`/`chotApDungOClient` chỉ nhận BĂM, không bao giờ nhận nội dung tệp; ràng buộc
// hình dạng ở tầng zod chặn một client gửi nhầm/cố ý gửi một chuỗi dài (vd. nội dung tệp) vào đúng ô lẽ ra chỉ chứa một
// băm 32-byte.
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/i, "Phải là sha256 (64 ký tự hex).");

export const batDauApDungOClientSchema = z.object({
  path: z.string().min(1).max(1000),
  nhanWorkspace: z.string().min(1).max(200),
  sha256Truoc: sha256Schema,
  sha256Sau: sha256Schema,
  tomTat: z.string().min(1).max(2000),
  soDongThem: z.number().int().min(0),
  soDongBot: z.number().int().min(0),
});

export const chotApDungOClientSchema = z.object({
  actionId: z.string().min(1),
  token: z.string().min(1),
  thanhCong: z.boolean(),
  sha256SauThat: sha256Schema.optional(),
  loi: z.string().max(2000).optional(),
});
