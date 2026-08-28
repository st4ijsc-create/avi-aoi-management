/**
 * Giai đoạn 4 — Machine Data Contract router (read-only).
 * Phơi bày phiên bản hợp đồng + JSON-Schema cho đối tác tích hợp ngoài.
 *
 * doc 56 nhóm C — mở rộng cho HAI họ hợp đồng: `inspection` (mặc định, back-compat)
 * và `process-result` (ST4I Standard Process Feed v1). Firmware tự kiểm tra payload
 * qua `validate({ contract?, version?, payload })` TRƯỚC khi gửi thật.
 *
 * Pha 1B Task 7 phần 2 (quyết định chủ dự án 2026-08-28) — đóng GOTCHA đo được ở Task 7 phần 1:
 * trước bản vá này, `validate()` KHÔNG khai `version` LUÔN mặc định về `LATEST_MACHINE_
 * CONTRACT_VERSION` ("2.0", cây), bất kể hình dạng `payload`. Một máy v1.x hợp lệ (mảng
 * `measurements`) tự kiểm mà không khai version bị đo NHẦM bằng cây v2.0 ⇒ `validate` báo ĐỎ
 * dù ingest thật (`submitInspection`, machineApiRouters.ts) vẫn NHẬN — `validate` "nói dối"
 * firmware, đúng lớp lỗi BG-3 sinh ra để đóng. Nay khi KHÔNG khai `version`, phiên bản
 * `inspection` mặc định được suy THEO HÌNH DẠNG payload (`laHinhDangCayV2`, DÙNG CHUNG với
 * ingest thật — xem `phienBanInspectionMacDinh` bên dưới), không còn theo LATEST của registry.
 * Khai `version` tường minh VẪN LUÔN THẮNG (đường thoát cho ai cần kiểm chéo một payload theo
 * một phiên bản cụ thể, kể cả khi hình dạng không khớp).
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  LATEST_MACHINE_CONTRACT_VERSION,
  LATEST_PROCESS_CONTRACT_VERSION,
  listMachineContractVersions,
  listProcessContractVersions,
  machineContractJsonSchema,
  machineProcessContractJsonSchema,
  validateMachinePayload,
  validateProcessPayload,
  laHinhDangCayV2,
  type MachineContractVersion,
} from "../contracts/machineDataContract";

/** Họ hợp đồng: kiểm tra dữ liệu kiểm tra (inspection) hay kết quả quy trình (process-result). */
const contractKind = z.enum(["inspection", "process-result"]);

/**
 * Phiên bản `inspection` MẶC ĐỊNH khi `validate()` KHÔNG được khai `version` tường minh — suy
 * THEO HÌNH DẠNG `payload`, CÙNG vị từ `laHinhDangCayV2` mà ingest thật dùng để chọn nhánh
 * (KHÔNG viết bản thứ hai — hai bản nhận diện phiên bản trôi khỏi nhau là chính lớp lỗi BG-19).
 * `jsonSchema()` KHÔNG dùng hàm này: thủ tục đó không nhận `payload` (chỉ `{version?, contract?}`),
 * nên không có hình dạng nào để suy — mặc định của nó giữ nguyên `LATEST_MACHINE_CONTRACT_VERSION`.
 */
function phienBanInspectionMacDinh(payload: unknown): MachineContractVersion {
  return laHinhDangCayV2(payload) ? LATEST_MACHINE_CONTRACT_VERSION : "1.1";
}

export const machineContractRouter = router({
  versions: protectedProcedure.query(() => ({
    // Back-compat: `latest`/`versions` vẫn là họ inspection (caller cũ không đổi).
    latest: LATEST_MACHINE_CONTRACT_VERSION,
    versions: listMachineContractVersions(),
    contracts: {
      inspection: {
        latest: LATEST_MACHINE_CONTRACT_VERSION,
        versions: listMachineContractVersions(),
      },
      "process-result": {
        latest: LATEST_PROCESS_CONTRACT_VERSION,
        versions: listProcessContractVersions(),
      },
    },
  })),

  jsonSchema: protectedProcedure
    .input(z.object({ version: z.string().optional(), contract: contractKind.optional() }).optional())
    .query(({ input }) => {
      const contract = input?.contract ?? "inspection";
      if (contract === "process-result") {
        const version = input?.version ?? LATEST_PROCESS_CONTRACT_VERSION;
        const schema = machineProcessContractJsonSchema(version);
        if (!schema) return { contract, version, found: false, schema: null };
        return { contract, version, found: true, schema };
      }
      const version = input?.version ?? LATEST_MACHINE_CONTRACT_VERSION;
      const schema = machineContractJsonSchema(version);
      if (!schema) return { contract, version, found: false, schema: null };
      return { contract, version, found: true, schema };
    }),

  validate: protectedProcedure
    .input(z.object({ version: z.string().optional(), contract: contractKind.optional(), payload: z.unknown() }))
    .mutation(({ input }) => {
      const contract = input.contract ?? "inspection";
      if (contract === "process-result") {
        const version = input.version ?? LATEST_PROCESS_CONTRACT_VERSION;
        return { contract, ...validateProcessPayload(version, input.payload) };
      }
      // Khai `version` tường minh LUÔN thắng; vắng mặt ⇒ suy THEO HÌNH DẠNG payload (không còn
      // mặc định thẳng về LATEST của registry) — xem chú thích tại `phienBanInspectionMacDinh`.
      const version = input.version ?? phienBanInspectionMacDinh(input.payload);
      return { contract, ...validateMachinePayload(version, input.payload) };
    }),
});
