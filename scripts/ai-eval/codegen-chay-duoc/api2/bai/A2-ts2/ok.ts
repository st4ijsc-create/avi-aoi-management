import { z } from "zod";

export const NgayIso = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});

export const SoThapPhan = z.codec(z.string().regex(/^-?\d+(\.\d+)?$/), z.number(), {
  decode: (s) => Number(s),
  encode: (n) => String(n),
});

export const BanGhi = z.object({ ma: z.string(), luc: NgayIso, giaTri: SoThapPhan });

export function giaiMa(x: unknown): z.output<typeof BanGhi> {
  return z.decode(BanGhi, x as z.input<typeof BanGhi>);
}

export function maHoa(v: z.output<typeof BanGhi>): z.input<typeof BanGhi> {
  return z.encode(BanGhi, v);
}
