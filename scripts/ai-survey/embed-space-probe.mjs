#!/usr/bin/env node
/**
 * scripts/ai-survey/embed-space-probe.mjs — Đợt 0 Task 6 (Đ6): chứng minh phép canh
 * KÍCH THƯỚC embedding (aiGgufEngine.ts assertEmbeddingDim, mặc định 1024) không đủ để
 * phát hiện việc TRỘN NHẦM hai không gian nhúng khác nhau.
 *
 * CÂU HỎI: kho tri thức RAG nhúng bằng Qwen3-Embedding-0.6B-f16 (knowledge/embeddings-meta.json),
 * còn đường tìm-ảnh-theo-ảnh (server/services/aiImageEmbedding.ts, dùng chung env
 * GGUF_EMBED_MODEL) CÓ THỂ nhúng bằng mxbai-embed-large. Cả hai model đều khai 1024 chiều.
 * Nếu một đường nào đó lỡ trộn vector từ hai model này (VD: dữ liệu ai_image_embeddings cũ
 * nhúng bằng mxbai khi .env còn trỏ mxbai, dữ liệu mới nhúng bằng Qwen3 sau khi .env đổi),
 * `assertEmbeddingDim` sẽ CHO QUA (1024 == 1024) — không báo lỗi gì. Script này nhúng CÙNG
 * MỘT câu bằng CẢ HAI model (modelId truyền tường minh, KHÔNG qua resolveEmbedModelBasename())
 * rồi in ra: số chiều mỗi bên + cosine similarity giữa hai vector. Nếu cosine THẤP dù cùng
 * 1024 chiều → bằng chứng bẫy có thật (hai không gian nhúng khác nhau, phép canh kích thước
 * mù trước sự khác biệt này).
 *
 * PHƯƠNG PHÁP (bắt buộc theo brief Đợt 0 — KHÔNG khởi động app, tránh race điều kiện
 * double-warm mà Task 2 phát hiện ở backgroundJobs.ts/aiLocalKnowledgeApi.ts):
 *   - Import THẲNG generateEmbedding/unloadGgufModel từ aiGgufEngine.ts qua dynamic import
 *     (pattern giống scripts/ai-survey/vi-quality-ab.mjs) — không boot Express, không
 *     trigger warm-up job nào.
 *   - modelId truyền TƯỜNG MINH cho generateEmbedding() ở cả hai lượt gọi — bỏ qua hoàn
 *     toàn resolveEmbedModelBasename()/.env GGUF_EMBED_MODEL, để phép đo không phụ thuộc
 *     giá trị .env hiện tại (đo được bất kể .env đang trỏ model nào).
 *   - Hai model embedding nhỏ (0.6-1.2 GB) — không cần dispose tuần tự như model 30B, nhưng
 *     vẫn unload cả hai + process.exit(0) ở cuối để không để lại node.exe treo / giữ VRAM.
 *
 * CHỈ ĐO — KHÔNG SỬA. Script này không đổi hành vi production nào, không nhúng lại kho
 * tri thức, không đụng knowledge/embeddings.jsonl.
 *
 * CHẠY:
 *   npx tsx scripts/ai-survey/embed-space-probe.mjs
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Windows: dynamic import() needs a file:// URL, not a bare "D:\..." path
// (ERR_UNSUPPORTED_ESM_URL_SCHEME otherwise).
const svc = (rel) => pathToFileURL(path.join(REPO_ROOT, "server", "services", rel)).href;

// Câu thử — tiếng Việt, miền vận hành nhà máy (giống loại câu cả RAG KB lẫn mô tả ảnh lỗi
// AOI sẽ nhúng thật trong sản xuất), CÙNG MỘT câu cho cả hai model để phép so sánh có nghĩa.
const TEST_SENTENCE =
  "Máy AOI phát hiện lỗi hàn thiếu tại vị trí chân linh kiện R12 trên bo mạch, cần kiểm tra lại trạm hàn sóng.";

// Hai model — basename KHÔNG ".gguf" (aiGgufEngine tự thêm suffix). Cả hai file phải có
// mặt dưới GGUF_MODELS_DIR (đã xác nhận bằng `ls` trước khi chạy — xem báo cáo).
const MODEL_A = { label: "Qwen3-Embedding-0.6B-f16 (kho tri thức RAG)", id: "Qwen3-Embedding-0.6B-f16" };
const MODEL_B = { label: "mxbai-embed-large-v1-f16 (tìm-ảnh-theo-ảnh, default cũ)", id: "mxbai-embed-large-v1-f16" };

/** Cosine similarity — thuần, không phụ thuộc chuẩn hoá trước (tự chia norm). */
function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length) return null; // khác chiều — không so được
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? null : dot / denom;
}

async function embedWith(engine, model) {
  const startedAt = Date.now();
  try {
    const { embedding, dimensions, modelId } = await engine.generateEmbedding(TEST_SENTENCE, model.id);
    return {
      ok: true,
      label: model.label,
      requestedId: model.id,
      resolvedId: modelId,
      dim: dimensions,
      vector: embedding,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      label: model.label,
      requestedId: model.id,
      error: err?.message ?? String(err),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function main() {
  console.log(`[embed-space-probe] Câu thử: "${TEST_SENTENCE}"`);
  console.log(`[embed-space-probe] GGUF_MODELS_DIR=${process.env.GGUF_MODELS_DIR ?? "(mặc định uploads/gguf-models)"}`);
  console.log(`[embed-space-probe] .env GGUF_EMBED_MODEL hiện tại (KHÔNG dùng trong phép đo này, chỉ ghi để đối chiếu) = ${process.env.GGUF_EMBED_MODEL ?? "(chưa set)"}`);
  console.log("");

  const engine = await import(svc("aiGgufEngine.ts"));

  const resultA = await embedWith(engine, MODEL_A);
  console.log(
    resultA.ok
      ? `[A] ${resultA.label} → dim=${resultA.dim}, ${resultA.elapsedMs}ms, resolvedId="${resultA.resolvedId}"`
      : `[A] ${resultA.label} → LỖI: ${resultA.error} (${resultA.elapsedMs}ms)`,
  );

  const resultB = await embedWith(engine, MODEL_B);
  console.log(
    resultB.ok
      ? `[B] ${resultB.label} → dim=${resultB.dim}, ${resultB.elapsedMs}ms, resolvedId="${resultB.resolvedId}"`
      : `[B] ${resultB.label} → LỖI: ${resultB.error} (${resultB.elapsedMs}ms)`,
  );
  console.log("");

  if (resultA.ok && resultB.ok) {
    const sameDim = resultA.dim === resultB.dim;
    const cos = cosineSimilarity(resultA.vector, resultB.vector);
    console.log(`Số chiều: A=${resultA.dim}  B=${resultB.dim}  → ${sameDim ? "GIỐNG NHAU (canh kích thước sẽ CHO QUA)" : "KHÁC NHAU (canh kích thước sẽ CHẶN — không phải bẫy im lặng)"}`);
    console.log(`Cosine similarity(A, B) trên CÙNG một câu = ${cos === null ? "(không tính được — khác chiều)" : cos.toFixed(6)}`);
    console.log("");
    if (sameDim && cos !== null) {
      if (cos < 0.5) {
        console.log(
          "KẾT LUẬN: cùng chiều nhưng cosine THẤP → hai không gian nhúng KHÁC NHAU thật sự. " +
            "Phép canh kích thước ở aiGgufEngine.ts:assertEmbeddingDim (mặc định 1024) sẽ CHO QUA " +
            "việc trộn vector giữa hai model này — bẫy im lặng CÓ THẬT, đúng như giả thuyết brief.",
        );
      } else {
        console.log(
          "KẾT QUẢ BẤT NGỜ: cosine KHÔNG thấp dù hai model khác nhau — báo trung thực, KHÔNG ép khớp " +
            "giả thuyết ban đầu. Xem báo cáo §6 để biết diễn giải.",
        );
      }
    }
  } else {
    console.log("Không đủ hai vector hợp lệ để so cosine — xem lỗi ở trên. Không suy diễn kết quả.");
  }

  // Dọn dẹp: unload cả hai model (nếu đã nạp) để không giữ VRAM sau khi script thoát.
  for (const id of [resultA.resolvedId, resultB.resolvedId].filter(Boolean)) {
    try {
      await engine.unloadGgufModel(id);
    } catch {
      /* best-effort cleanup */
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[embed-space-probe] Lỗi không bắt được:", err);
    process.exit(1);
  });
