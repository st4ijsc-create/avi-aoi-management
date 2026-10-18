export type O = [number, number];
export type KetQua = { doDai: number; duong: O[] };

const HUONG: O[] = [[-1, 0], [0, -1], [0, 1], [1, 0]];

export function duongNganNhat(luoi: string[]): KetQua | null {
  const h = luoi.length;
  const w = h ? luoi[0].length : 0;
  let batDau = -1;
  let dich = -1;
  const congTheoChu = new Map<string, number[]>();
  for (let r = 0; r < h; r++) {
    if (luoi[r].length !== w) throw new RangeError(`hàng ${r} lệch độ dài`);
    for (let c = 0; c < w; c++) {
      const ch = luoi[r][c];
      const id = r * w + c;
      if (ch === "S") {
        if (batDau >= 0) throw new RangeError("nhiều S");
        batDau = id;
      } else if (ch === "E") {
        if (dich >= 0) throw new RangeError("nhiều E");
        dich = id;
      } else if (ch >= "a" && ch <= "z") {
        const ds = congTheoChu.get(ch) ?? [];
        ds.push(id);
        congTheoChu.set(ch, ds);
      } else if (ch !== "." && ch !== "#") {
        throw new RangeError(`ký tự lạ ${JSON.stringify(ch)}`);
      }
    }
  }
  if (batDau < 0 || dich < 0) throw new RangeError("thiếu S hoặc E");
  const cap = new Map<number, number>();
  for (const [ch, ds] of congTheoChu) {
    if (ds.length !== 2) throw new RangeError(`cổng ${ch} xuất hiện ${ds.length} lần`);
    cap.set(ds[0], ds[1]);
    cap.set(ds[1], ds[0]);
  }

  const cha = new Int32Array(h * w).fill(-2);
  cha[batDau] = -1;
  const hang: number[] = [batDau];
  for (let dau = 0; dau < hang.length; dau++) {
    const u = hang[dau];
    if (u === dich) break;
    const r = Math.floor(u / w);
    const c = u % w;
    const ke: number[] = [];
    for (const [dr, dc] of HUONG) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= h || nc < 0 || nc >= w || luoi[nr][nc] === "#") continue;
      ke.push(nr * w + nc);
    }
    const q = cap.get(u);
    if (q !== undefined) ke.push(q);
    for (const v of ke) {
      if (cha[v] !== -2) continue;
      cha[v] = u;
      hang.push(v);
    }
  }
  if (cha[dich] === -2) return null;
  const duong: O[] = [];
  for (let v = dich; v !== -1; v = cha[v]) duong.push([Math.floor(v / w), v % w]);
  duong.reverse();
  return { doDai: duong.length - 1, duong };
}
