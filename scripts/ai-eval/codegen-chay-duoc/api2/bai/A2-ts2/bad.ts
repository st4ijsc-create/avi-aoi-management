import { z } from "zod";

// SAI (thói quen zod 3): biến đổi MỘT CHIỀU bằng .transform rồi tự mã hoá ngược bằng tay —
// z.encode trên NgayIso/SoThapPhan ném $ZodEncodeError.
export const NgayIso = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
export const SoThapPhan = z.string().regex(/^-?\d+(\.\d+)?$/).transform((s) => Number(s));
export const BanGhi = z.object({ ma: z.string(), luc: NgayIso, giaTri: SoThapPhan });

export function giaiMa(x: unknown): z.output<typeof BanGhi> {
  return BanGhi.parse(x);
}

export function maHoa(v: z.output<typeof BanGhi>): z.input<typeof BanGhi> {
  const o = z.object({ ma: z.string(), luc: z.date(), giaTri: z.number() }).parse(v);
  return { ma: o.ma, luc: o.luc.toISOString(), giaTri: String(o.giaTri) };
}
