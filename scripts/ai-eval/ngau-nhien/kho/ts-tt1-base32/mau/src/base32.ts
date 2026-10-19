const BANG = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function maHoa(du: Uint8Array): string {
  let ra = "";
  let dem = 0; // bộ đệm bit
  let soBit = 0;
  for (const byte of du) {
    dem = (dem << 8) | byte;
    soBit += 8;
    while (soBit >= 5) {
      soBit -= 5;
      ra += BANG[(dem >> soBit) & 31];
    }
    dem &= (1 << soBit) - 1;
  }
  if (soBit > 0) ra += BANG[(dem << (5 - soBit)) & 31];
  return ra;
}

function giaTri(kyTu: string): number {
  let c = kyTu.toUpperCase();
  if (c === "O") c = "0";
  if (c === "I" || c === "L") c = "1";
  const v = BANG.indexOf(c);
  if (v < 0) throw new RangeError(`ký tự không hợp lệ: ${JSON.stringify(kyTu)}`);
  return v;
}

export function giaiMa(s: string): Uint8Array {
  const kyTu = [...s].filter((c) => c !== "-");
  const n = kyTu.length;
  const thua = (5 * n) % 8;
  if (thua >= 5) throw new RangeError(`độ dài không hợp lệ: ${n}`);
  const ra = new Uint8Array(Math.floor((5 * n) / 8));
  let dem = 0;
  let soBit = 0;
  let i = 0;
  for (const c of kyTu) {
    dem = (dem << 5) | giaTri(c);
    soBit += 5;
    if (soBit >= 8) {
      soBit -= 8;
      ra[i++] = (dem >> soBit) & 0xff;
      dem &= (1 << soBit) - 1;
    }
  }
  if (dem !== 0) throw new RangeError("bit thừa khác 0");
  return ra;
}

export function maHoaSo(n: bigint): string {
  if (n < 0n) throw new RangeError("số âm");
  if (n === 0n) return "0";
  let ra = "";
  while (n > 0n) {
    ra = BANG[Number(n % 32n)] + ra;
    n /= 32n;
  }
  return ra;
}
