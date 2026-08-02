/**
 * C-2 (review TOÀN NHÁNH) — HAI tiến trình con **torch CUDA** do server spawn, ngoài sổ hoàn toàn.
 *
 *   1. `localSidecarTrainer.ts:286` → `LOCAL_TRAINER_CMD` → `tools/trainer/train.py`
 *      (`:260-261` `torch.device("cuda")`, `:629-630`/`:693` YOLOv8-seg `device=0`; docstring
 *      `:616` nói **~6 GB VRAM**).
 *   2. `aiLlmFinetuneSidecar.ts:415` → `LLM_FINETUNE_CMD` → `tools/trainer/finetune_lora.py`
 *      (`:174-196` `bfloat16` + `device_map="auto"` khi có CUDA — QLoRA, nhiều GB).
 *
 * ⚠ Hôm nay cả hai đo 0 MiB **CHỈ VÌ** hai biến env chưa đặt. Đó CHÍNH XÁC là lập luận dự án
 * đã dùng để tuyên bố hộ thứ SÁU (`aiReranker`, 0 MiB chỉ vì `RAG_RERANKER_GPU=false`) và hộ
 * thứ BẢY (`aiImageEmbedding`, 0 MiB chỉ vì `ENABLE_CUDA` vắng) là thiếu sót THẬT. Cùng tiêu
 * chuẩn ⇒ đây là hộ thứ MƯỜI và MƯỜI MỘT.
 *
 * ⚠ QUY ƯỚC MODULE-IDENTITY (xem wiring.inprocess.test.ts / wiring.outofprocess.test.ts): mã
 * sản xuất `import()` ĐỘNG "./vram/vramWiring", nên MỌI lượt import — cả mã sản xuất lẫn sổ cái
 * — phải nằm TRONG thân test, SAU cùng một `vi.resetModules()` của `beforeEach`.
 *
 * ⚠ KHÔNG có seam test riêng: cả hai ca gọi ĐÚNG hàm CÔNG KHAI thật (`runSidecarTraining`,
 * `startLoraFinetune`) — cùng đường mà pipeline huấn luyện đi. Chỉ các BIÊN (fs, child_process,
 * DB, dataset, corpus, eval harness) bị giả lập, đúng khuôn hai bộ test sẵn có
 * (`localSidecarTrainer.test.ts`, `aiLlmFinetuneSidecar.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ─── fs: kho trong bộ nhớ do test lái (mirror localSidecarTrainer.test.ts) ────────────────────
// ⚠ `statSync` BẮT BUỘC phải có: `vramWiring.beginVramAllocation()` gọi nó để lấy nấc ước lượng
// "file-size". Thiếu nó thì nhánh `catch` nuốt lỗi và ước lượng tụt xuống nấc thấp hơn — test
// vẫn xanh nhưng canh SAI nấc.
const fsStore = vi.hoisted(() => new Map<string, string>());
const fsExist = vi.hoisted(() => new Set<string>());
const FINETUNE_BASE_BYTES = vi.hoisted(() => 2048 * 1024 * 1024);

vi.mock("fs", () => {
  const api = {
    mkdirSync: (p: string) => { fsExist.add(p); },
    writeFileSync: (p: string, data: string) => { fsStore.set(p, String(data)); fsExist.add(p); },
    readFileSync: (p: string) => {
      if (!fsStore.has(p)) throw new Error(`ENOENT ${p}`);
      return fsStore.get(p)!;
    },
    existsSync: (p: string) => fsExist.has(p),
    statSync: () => ({ size: FINETUNE_BASE_BYTES, isFile: () => true, mtime: new Date() }),
    copyFileSync: (s: string, d: string) => { fsExist.add(d); fsStore.set(d, fsStore.get(s) ?? "<bytes>"); },
    unlinkSync: (p: string) => { fsExist.delete(p); fsStore.delete(p); },
    rmSync: (p: string) => {
      for (const k of Array.from(fsExist)) if (k.startsWith(p)) fsExist.delete(k);
      for (const k of Array.from(fsStore.keys())) if (k.startsWith(p)) fsStore.delete(k);
    },
  };
  return { default: api, ...api };
});

// ─── child_process ────────────────────────────────────────────────────────────────────────────
// ⚠ "child_process" và "node:child_process" GỘP CÙNG một khoá registry của Vitest (gotcha đã đo
// ở Task 6) — mock cả hai bằng CÙNG một hàm để không cái nào thầm lặng đè cái kia.
class FakeChild extends EventEmitter {
  killed = false;
  pid = 909;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() { this.killed = true; return true; }
}
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ spawn: (...a: unknown[]) => (spawnMock as unknown as (...a: unknown[]) => unknown)(...a) }));
vi.mock("node:child_process", () => ({ spawn: (...a: unknown[]) => (spawnMock as unknown as (...a: unknown[]) => unknown)(...a) }));

// ─── biên của localSidecarTrainer ─────────────────────────────────────────────────────────────
vi.mock("../aiDatasetBuilder", () => ({
  buildDataset: async () => ({
    datasetId: 12,
    totalSamples: 40,
    labelDistribution: { OK: 20, NG: 20 },
    split: { train: 30, val: 6, test: 4 },
    storageKey: "datasets/12",
    manifestPaths: { train: "/abs/train.jsonl", val: "/abs/val.jsonl", test: "/abs/test.jsonl" },
    labels: ["NG", "OK"],
  }),
}));
vi.mock("../../db/aiAdvanced", () => ({ updateTrainingJob: async () => undefined }));
vi.mock("../../db/ai", () => ({
  getAiModelById: async () => ({ id: 7, code: "SEG", filePath: "/uploads/models/base/seg.onnx", currentVersion: "1.0.0" }),
  getModelVersions: async () => [],
  createModelVersion: async () => ({ id: 501, modelId: 7, version: "1.0.0-lora.1", status: "VALIDATING" }),
  updateModelVersion: async () => undefined,
}));

// ─── biên của aiLlmFinetuneSidecar ────────────────────────────────────────────────────────────
const COMPLETION_TAIL = "charlie delta echo foxtrot golf hotel india juliet";
vi.mock("../kbStudioService", () => ({
  listCorpusChunksForTraining: async () => ({
    tableAvailable: true,
    chunks: Array.from({ length: 20 }, (_, i) => ({
      id: i, sourceRef: `doc-${i}.pdf`, chunkIndex: 0, text: `chunk ${i} alpha bravo ${COMPLETION_TAIL}`,
    })),
  }),
}));
vi.mock("../aiEvalHarness", () => ({
  evaluateQualityGate: () => ({ pass: true, reason: "mock", accuracyDelta: 0, epsilon: 0 }),
  persistEvalReport: async () => undefined,
}));

const ORIGINAL_ENV = { ...process.env };
let lastChild: FakeChild | undefined;

/** Ảnh chụp sổ cái CÙNG THẾ HỆ module với mã sản xuất vừa chạy — import ĐỘNG, trong thân test. */
async function currentLeases() {
  const { snapshot } = await import("./vramBroker");
  return snapshot().leases;
}

/** Chờ tới khi tiến trình con giả đã được spawn (đường sản xuất có nhiều `await` thật). */
async function waitForSpawn(): Promise<FakeChild> {
  for (let i = 0; i < 200; i++) {
    if (lastChild) return lastChild;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("spawn không bao giờ xảy ra — mock hoặc đường sản xuất đã đổi");
}

beforeEach(() => {
  vi.resetModules();
  fsStore.clear();
  fsExist.clear();
  lastChild = undefined;
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    lastChild = new FakeChild();
    return lastChild;
  });
  process.env = { ...ORIGINAL_ENV };
  process.env.LOCAL_TRAINER_CMD = "python tools/trainer/train.py";
  process.env.LLM_FINETUNE_CMD = "python tools/trainer/finetune_lora.py";
});

describe("C-2 — hộ thứ MƯỜI: localSidecarTrainer (torch CUDA, YOLOv8-seg ~6 GB)", () => {
  it("1. runSidecarTraining xin giấy phép external-process NGAY TRƯỚC khi spawn train.py", async () => {
    const { runSidecarTraining } = await import("../localSidecarTrainer");
    const run = runSidecarTraining({ jobId: 1, modelId: 7, datasetId: 12, targetVersion: "1.0.1" } as never);
    const child = await waitForSpawn();

    const l = (await currentLeases()).find((x) => x.request.owner === "sidecar:local-trainer");
    expect(l).toBeDefined();
    expect(l!.request.kind).toBe("external-process");
    expect(l!.request.priority).toBe("background");
    expect(typeof l!.request.ttlMs).toBe("number");
    expect(l!.request.ttlMs!).toBeGreaterThan(0);
    // Hằng số 6 GB đến từ docstring `tools/trainer/train.py:616` ("sized for ~6GB VRAM") —
    // truyền qua configDefaultBytes để sự kiện ghi `estimateSource: "config-default"`, dấu vết
    // để Task 7 truy "chỗ nào còn dựa hằng số".
    expect(l!.request.estimateSource).toBe("config-default");
    expect(l!.request.estimatedBytes).toBe(6144 * 1024 * 1024);

    child.emit("exit", 0);
    await run;
  });

  it('2. ĐỘT BIẾN — train.py thoát ("exit") ⇒ TRẢ giấy phép', async () => {
    const { runSidecarTraining } = await import("../localSidecarTrainer");
    const run = runSidecarTraining({ jobId: 2, modelId: 7, datasetId: 12, targetVersion: "1.0.1" } as never);
    const child = await waitForSpawn();
    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:local-trainer")).toBe(true);

    child.emit("exit", 0);
    await run;

    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:local-trainer")).toBe(false);
  });

  it('3. ĐỘT BIẾN — train.py báo lỗi ("error") ⇒ TRẢ giấy phép, không treo', async () => {
    const { runSidecarTraining } = await import("../localSidecarTrainer");
    const run = runSidecarTraining({ jobId: 3, modelId: 7, datasetId: 12, targetVersion: "1.0.1" } as never);
    const child = await waitForSpawn();
    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:local-trainer")).toBe(true);

    child.emit("error", new Error("ENOENT — python không tìm thấy (ca thử nghiệm)"));
    await run;

    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:local-trainer")).toBe(false);
  });

  it("4. ĐỘT BIẾN — spawn() NÉM ĐỒNG BỘ ⇒ vẫn TRẢ giấy phép (bài học Task 6 vòng 1)", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("EACCES — không thực thi được python (ca thử nghiệm)");
    });
    const { runSidecarTraining } = await import("../localSidecarTrainer");
    const res = await runSidecarTraining({ jobId: 4, modelId: 7, datasetId: 12, targetVersion: "1.0.1" } as never);

    expect(res.success).toBe(false);
    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:local-trainer")).toBe(false);
  });
});

describe("C-2 — hộ thứ MƯỜI MỘT: aiLlmFinetuneSidecar (QLoRA, bfloat16 + device_map=auto)", () => {
  it("5. startLoraFinetune xin giấy phép external-process NGAY TRƯỚC khi spawn finetune_lora.py", async () => {
    const { startLoraFinetune } = await import("../aiLlmFinetuneSidecar");
    const run = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }).catch(() => undefined);
    const child = await waitForSpawn();

    const l = (await currentLeases()).find((x) => x.request.owner === "sidecar:llm-finetune");
    expect(l).toBeDefined();
    expect(l!.request.kind).toBe("external-process");
    expect(l!.request.priority).toBe("background");
    expect(typeof l!.request.ttlMs).toBe("number");
    expect(l!.request.ttlMs!).toBeGreaterThan(0);
    // ⚠ KHÔNG hằng số bịa: neo vào KÍCH THƯỚC FILE trọng số nền thật (nấc "file-size"), cùng
    // kỷ luật `loadGgufModel`. QLoRA 4-bit nạp ÍT hơn file fp16, nên đây là trần trên có nguồn —
    // không phải một con số phát minh, thứ đã làm hỏng bốn tài liệu quyết định trước.
    expect(l!.request.estimateSource).toBe("file-size");
    expect(l!.request.estimatedBytes).toBe(FINETUNE_BASE_BYTES);

    child.emit("exit", 1);
    await run;
  });

  it('6. ĐỘT BIẾN — finetune_lora.py thoát ("exit") ⇒ TRẢ giấy phép', async () => {
    const { startLoraFinetune } = await import("../aiLlmFinetuneSidecar");
    const run = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }).catch(() => undefined);
    const child = await waitForSpawn();
    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:llm-finetune")).toBe(true);

    child.emit("exit", 1);
    await run;

    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:llm-finetune")).toBe(false);
  });

  it('7. ĐỘT BIẾN — finetune_lora.py báo lỗi ("error") ⇒ TRẢ giấy phép, không treo', async () => {
    const { startLoraFinetune } = await import("../aiLlmFinetuneSidecar");
    const run = startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }).catch(() => undefined);
    const child = await waitForSpawn();
    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:llm-finetune")).toBe(true);

    child.emit("error", new Error("ENOENT — python không tìm thấy (ca thử nghiệm)"));
    await run;

    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:llm-finetune")).toBe(false);
  });

  it("8. ĐỘT BIẾN — spawn() NÉM ĐỒNG BỘ ⇒ vẫn TRẢ giấy phép", async () => {
    spawnMock.mockImplementationOnce(() => {
      throw new Error("EACCES — không thực thi được python (ca thử nghiệm)");
    });
    const { startLoraFinetune } = await import("../aiLlmFinetuneSidecar");
    await startLoraFinetune({ baseModelId: 7, corpus: "vendor-x", targetVersion: "1.0.0-lora.1" }).catch(() => undefined);

    expect((await currentLeases()).some((x) => x.request.owner === "sidecar:llm-finetune")).toBe(false);
  });
});
