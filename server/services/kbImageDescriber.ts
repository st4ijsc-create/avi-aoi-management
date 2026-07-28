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
 * CHỮ KÝ THẬT vs. MÔ TẢ MINH HỌA TRONG BRIEF (đã kiểm `aiProviderRouter.ts:100-121,391-474`):
 *  - `DescribeImageRequest` nhận field ẢNH tên là `image` (Buffer), KHÔNG PHẢI `imageBuffer`.
 *    Brief minh họa dùng `imageBuffer` — sai tên trường, sẽ gửi `undefined` cho model thật.
 *    Code này dùng đúng `image`.
 *  - `DescribeImageResult` trả `{ text, provider, model, totalTimeMs, fallbackUsed }` — KHÔNG
 *    có field `description`. Test brief (kbImageDescriber.test.ts, mock toàn bộ module) lại
 *    cho mock trả `{ description }`. Đọc `res.text ?? res.description` để đúng với CẢ HAI: ưu
 *    tiên `text` (field thật khi chạy sống), fallback `description` (field mock dùng trong
 *    test) — không có kịch bản nào cả hai cùng thiếu mà lại có nội dung thật.
 *  - `DescribeImageRequest` KHÔNG có field `modelId`/`model` — xem ghi chú "GHIM MODEL" bên
 *    dưới.
 *
 * GHIM MODEL: kiến trúc vision KHÁC kiến trúc chat/text — nó không đi qua
 * `aiGgufEngine.getOrLoadModel()` (nơi Wave 1 phát hiện `getOrLoadModel(undefined)` có thể
 * rơi vào model NHÚNG đang resident). Vision luôn đi qua MỘT sidecar llama-server riêng
 * (`llamaVisionSidecar.ts`), tự nó chỉ phục vụ ĐÚNG MỘT model cố định theo
 * `GGUF_VISION_MODEL`/`GGUF_VISION_MMPROJ` — không có nhiều model resident để nhầm lẫn, nên
 * lỗi Wave 1 KHÔNG THỂ xảy ra trên đường này (`aiGgufEngine.describeImage`'s `_modelId` param
 * thậm chí có tiền tố `_` — cố tình bỏ qua, không dùng). Dù vậy, để giữ kỷ luật "ghim tường
 * minh" nhất quán toàn hệ thống và có breadcrumb kiểm toán, request vẫn gắn một field
 * `modelId` (qua `resolveLogicalModel`) — dù `describeImage()` hiện KHÔNG đọc field này (chưa
 * khai báo trong `DescribeImageRequest`), field vẫn được đính kèm cho tương lai + audit.
 * `resolveLogicalModel("vision")` KHÔNG có nhánh riêng cho "vision" (modelResolver.ts:220-249)
 * nên rơi vào nhánh passthrough-không-rõ và trả về NGUYÊN VĂN chuỗi "vision" — không phải một
 * basename thật trên đĩa. Đây là giá trị breadcrumb có chủ đích, KHÔNG được diễn giải là tên
 * file model thật (tên file thật là basename của `GGUF_VISION_MODEL`, ví dụ hiện tại
 * "Qwen3-VL-8B-Instruct-UD-Q4_K_XL" — không thể đọc ở đây vì việc đó cần gọi
 * `getVisionSidecarConfig()` từ CÙNG module `./llamaVisionSidecar`, mà test khóa mock của
 * module đó CHỈ export `isVisionSidecarAvailable` — gọi thêm hàm khác sẽ throw TypeError
 * trong mọi test "đường vui").
 *
 * TRUNG THỰC: không mô tả được ⇒ ok:false kèm lý do thật. TUYỆT ĐỐI không lưu chunk rỗng rồi
 * báo thành công. Cũng coi nhánh "fallbackUsed:true" của router (nó tự trả một câu giải thích
 * "Vision unavailable: …" trong `text` khi sidecar không sẵn sàng — aiProviderRouter.ts:396-419)
 * là THẤT BẠI, không phải mô tả thật — nếu không, một race giữa lần kiểm
 * `isVisionSidecarAvailable()` ở đây và lúc `describeImage()` thực sự chạy (sidecar vừa crash)
 * sẽ khiến câu giải thích lỗi bị lưu vào kho như thể là mô tả ảnh thật.
 */
import { resolveLogicalModel } from "./ai/modelResolver";

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
    // Ghim model tường minh (kỷ luật Wave 1) trên field `modelId` — xem ghi chú "GHIM MODEL" ở
    // module doc comment cho lý do field này hiện là breadcrumb (describeImage() thật chưa
    // đọc nó) chứ không phải một cơ chế chọn-model đang hoạt động.
    const modelId = resolveLogicalModel("vision");
    const res: any = await describeImage({
      image: imageBuffer,
      prompt: hint ? `${KNOWLEDGE_IMAGE_PROMPT}\n\nTên tệp: ${hint}` : KNOWLEDGE_IMAGE_PROMPT,
      language: "vi",
      maxTokens: 700,
      temperature: 0.2,
      modelId,
    } as any);

    // Router's own honest-degrade branch — never store its "vision unavailable" explanation
    // as if it were a real description (see module doc comment).
    if (res?.fallbackUsed) {
      const reason = String(res?.text ?? "").trim();
      return { ok: false, reason: reason || "Model thị giác không sẵn sàng." };
    }

    const text = String(res?.text ?? res?.description ?? "").trim();
    if (!text) {
      return { ok: false, reason: "Model thị giác trả về mô tả rỗng." };
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: `Mô tả ảnh thất bại: ${(err as any)?.message ?? String(err)}` };
  }
}
