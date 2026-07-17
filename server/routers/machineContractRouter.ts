/**
 * Giai đoạn 4 — Machine Data Contract router (read-only).
 * Phơi bày phiên bản hợp đồng + JSON-Schema cho đối tác tích hợp ngoài.
 *
 * doc 56 nhóm C — mở rộng cho HAI họ hợp đồng: `inspection` (mặc định, back-compat)
 * và `process-result` (ST4I Standard Process Feed v1). Firmware tự kiểm tra payload
 * qua `validate({ contract?, version?, payload })` TRƯỚC khi gửi thật.
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
} from "../contracts/machineDataContract";

/** Họ hợp đồng: kiểm tra dữ liệu kiểm tra (inspection) hay kết quả quy trình (process-result). */
const contractKind = z.enum(["inspection", "process-result"]);

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
      const version = input.version ?? LATEST_MACHINE_CONTRACT_VERSION;
      return { contract, ...validateMachinePayload(version, input.payload) };
    }),
});
