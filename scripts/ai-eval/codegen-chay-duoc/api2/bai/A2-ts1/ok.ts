import { z } from "zod";

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
  return r.success ? { ok: true, lenh: r.data } : { ok: false, loi: z.prettifyError(r.error) };
}
