/**
 * Giai đoạn 4 — Machine Data Contract router (read-only).
 * Phơi bày phiên bản hợp đồng + JSON-Schema cho đối tác tích hợp ngoài.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  LATEST_MACHINE_CONTRACT_VERSION,
  listMachineContractVersions,
  machineContractJsonSchema,
  validateMachinePayload,
} from "../contracts/machineDataContract";

export const machineContractRouter = router({
  versions: protectedProcedure.query(() => ({
    latest: LATEST_MACHINE_CONTRACT_VERSION,
    versions: listMachineContractVersions(),
  })),

  jsonSchema: protectedProcedure
    .input(z.object({ version: z.string().optional() }).optional())
    .query(({ input }) => {
      const version = input?.version ?? LATEST_MACHINE_CONTRACT_VERSION;
      const schema = machineContractJsonSchema(version);
      if (!schema) return { version, found: false, schema: null };
      return { version, found: true, schema };
    }),

  validate: protectedProcedure
    .input(z.object({ version: z.string().optional(), payload: z.unknown() }))
    .mutation(({ input }) => {
      const version = input.version ?? LATEST_MACHINE_CONTRACT_VERSION;
      return validateMachinePayload(version, input.payload);
    }),
});
