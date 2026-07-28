/**
 * Wave 2 đường B, Task 6 — biến ẢNH thành văn bản cho kho kiến thức.
 *
 * VÌ SAO VLM CHỨ KHÔNG PHẢI OCR: đo trên máy này cho thấy Qwen3-VL + mmproj CÓ SẴN
 * (.env:142-143 — GGUF_VISION_MODEL/GGUF_VISION_MMPROJ trỏ tới file thật trên đĩa; boot log
 * "gguf-vision: present"), còn OCR CHƯA cấu hình (OCR_MODEL_DIR và PDFTOPPM_BIN trống,
 * models/ocr không tồn tại). Nên ảnh được MÔ TẢ bằng VLM. Chữ trong ảnh chỉ đọc được ở mức
 * VLM mô tả — KHÔNG hứa OCR khi chưa có.
 *
 * VÌ SAO KHÔNG DÙNG describeDefect(): hàm đó (aiVisionLanguage.ts:55) mang prompt riêng cho
 * lỗi AOI ("You are an expert AOI quality engineer… describe any defects") và ép model trả
 * JSON {description, severity, location, possibleCauses, suggestedActions} rồi parse — hợp lý
 * cho MỘT ảnh chụp linh kiện đi tìm lỗi hàn, nhưng SAI mục đích và SAI cấu trúc cho ảnh tài
 * liệu (sơ đồ đấu nối, ảnh chụp màn HMI, trang sổ tay): không có "defect" để tìm, và ép JSON
 * severity/causes vô nghĩa sẽ khiến model bịa cho đủ schema. Ở đây dùng thẳng
 * `aiProviderRouter.describeImage()` với một prompt tự do, đúng mục đích tra-cứu-kiến-thức.
 *
 * CHỮ KÝ THẬT (đã kiểm `aiProviderRouter.ts:100-121,391-474`) — `req: DescribeImageRequest` và
 * `res: DescribeImageResult` bên dưới dùng ĐÚNG type import từ `aiProviderRouter.ts`, KHÔNG có
 * `as any` ở đâu trên request/kết quả — để TypeScript tự bắt đúng loại lỗi sai-tên-trường mà
 * bản minh họa gốc của brief đã mắc (`imageBuffer` thay vì field thật `image`; đọc `.description`
 * thay vì field thật `.text`) — cả hai đã sửa và giờ được TypeScript canh gác, không phải chỉ
 * canh bằng test/tài liệu.
 *
 * KHÔNG GHIM `modelId` (đã sửa ở vòng review 1 — bản trước gắn một field `modelId` giả kèm
 * `as any`, che mất đúng loại lỗi sai-tên-trường nói trên): `DescribeImageRequest` (thật) không
 * khai báo field `modelId`/`model` nào cả. Đây KHÔNG phải thiếu sót — đường vision đi qua một
 * SIDECAR llama-server RIÊNG, chuyên dụng (`llamaVisionSidecar.ts`), sidecar này chỉ từng phục
 * vụ ĐÚNG MỘT model cố định, lấy từ `GGUF_VISION_MODEL`/`GGUF_VISION_MMPROJ`
 * (`llamaVisionSidecar.ts:104-116`, `getVisionSidecarConfig()`). Nó KHÔNG đi qua
 * `aiGgufEngine.getOrLoadModel()` dùng chung (nơi Wave 1 đo được `getOrLoadModel(undefined)` có
 * thể rơi vào model NHÚNG đang resident khi nhiều model cùng resident) — không có nhiều model
 * resident để nhầm lẫn trên sidecar 1-model này, nên rủi ro "sinh chữ bằng model nhúng" của
 * Wave 1 KHÔNG áp dụng ở đây theo đúng kiến trúc hiện tại
 * (`aiGgufEngine.describeImage`'s `_modelId` param có tiền tố `_` — cố tình khai báo nhưng
 * không dùng, xác nhận đường này chưa từng có cơ chế chọn-model theo id). Ghi rõ điều này để
 * người đọc sau không tưởng nhầm có một cơ chế chọn-model đang chạy ở đây.
 *
 * TRUNG THỰC: không mô tả được ⇒ ok:false kèm lý do thật. TUYỆT ĐỐI không lưu chunk rỗng rồi
 * báo thành công. Cũng coi nhánh "fallbackUsed:true" của router (nó tự trả một câu giải thích
 * "Vision unavailable: …" trong `text` khi sidecar không sẵn sàng — aiProviderRouter.ts:396-419)
 * là THẤT BẠI, không phải mô tả thật — nếu không, một race giữa lần kiểm
 * `isVisionSidecarAvailable()` ở đây và lúc `describeImage()` thực sự chạy (sidecar vừa crash)
 * sẽ khiến câu giải thích lỗi bị lưu vào kho như thể là mô tả ảnh thật.
 */
import type { DescribeImageRequest, DescribeImageResult } from "./aiProviderRouter";

export type DescribeForKnowledgeResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

const KNOWLEDGE_IMAGE_PROMPT =
  "Mô tả nội dung kỹ thuật của hình ảnh này bằng tiếng Việt, đầy đủ và trung thực, " +
  "để dùng làm tài liệu tra cứu: các khối/thành phần nhìn thấy, nhãn và chữ đọc được, " +
  "quan hệ giữa các phần, và mọi thông số hiển thị. Nếu không đọc được phần nào, nói rõ " +
  "là không đọc được thay vì đoán.";

export async function describeImageForKnowledge(
  imageBuffer: Buffer,
  hint?: string,
): Promise<DescribeForKnowledgeResult> {
  try {
    const { isVisionSidecarAvailable } = await import("./llamaVisionSidecar");
    if (!isVisionSidecarAvailable()) {
      return {
        ok: false,
        reason: "Model thị giác chưa sẵn sàng — chưa thể nạp ảnh (vision model unavailable).",
      };
    }

    const { describeImage } = await import("./aiProviderRouter");
    // Đúng type DescribeImageRequest thật (không `as any`) — TypeScript bắt sai tên trường
    // ngay tại đây thay vì để lỗi lọt ra runtime (bài học vòng review 1).
    const req: DescribeImageRequest = {
      image: imageBuffer,
      prompt: hint ? `${KNOWLEDGE_IMAGE_PROMPT}\n\nTên tệp: ${hint}` : KNOWLEDGE_IMAGE_PROMPT,
      language: "vi",
      maxTokens: 700,
      temperature: 0.2,
    };
    const res: DescribeImageResult = await describeImage(req);

    // Router's own honest-degrade branch — never store its "vision unavailable" explanation
    // as if it were a real description (see module doc comment).
    if (res.fallbackUsed) {
      const reason = res.text.trim();
      return { ok: false, reason: reason || "Model thị giác không sẵn sàng." };
    }

    const text = res.text.trim();
    if (!text) {
      return { ok: false, reason: "Model thị giác trả về mô tả rỗng." };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: `Mô tả ảnh thất bại: ${(err as Error)?.message ?? String(err)}` };
  }
}
