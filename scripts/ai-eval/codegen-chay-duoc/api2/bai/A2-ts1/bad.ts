import { z } from "zod";

// SAI (thói quen zod 3): tự định dạng lỗi "đường dẫn: thông điệp" thay vì z.prettifyError.
export const LenhMay = z
  .strictObject({
    may: z.string().regex(/^M\d{2}$/, { error: "ma may sai" }),
    lenh: z.enum(["chay", "dung", "dat_toc_do"]),
    tocDo: z.number().int().min(0).max(3000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.lenh === "dat_toc_do" && v.tocDo === undefined) {
      ctx.addIssue({ code: "custom", path: ["tocDo"], message: "can tocDo" });
    }
  });

export function kiemLenh(x: unknown): { ok: true; lenh: z.infer<typeof LenhMay> } | { ok: false; loi: string } {
  const r = LenhMay.safeParse(x);
  if (r.success) return { ok: true, lenh: r.data };
  return { ok: false, loi: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n") };
}
