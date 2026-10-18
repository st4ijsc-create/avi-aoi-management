import fs from "node:fs/promises";
import path from "node:path";

const soSanhMa = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export async function quetThuMuc(goc, tuyChon = {}) {
  const boQua = new Set(tuyChon.boQua ?? []);
  const duoi = (tuyChon.duoi ?? []).map((d) => d.toLowerCase());
  const locDuoi = duoi.length > 0 ? new Set(duoi) : null;
  const ra = [];

  async function duyet(thuMuc, rel) {
    const muc = await fs.readdir(thuMuc, { withFileTypes: true });
    await Promise.all(
      muc.map(async (e) => {
        if (boQua.has(e.name)) return;
        const tuyet = path.join(thuMuc, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) return;
        if (e.isDirectory()) return duyet(tuyet, r);
        if (!e.isFile()) return;
        if (locDuoi && !locDuoi.has(path.extname(e.name).toLowerCase())) return;
        const st = await fs.lstat(tuyet);
        ra.push({ duong: r, kichThuoc: st.size });
      }),
    );
  }

  await duyet(goc, "");
  return ra.sort((a, b) => soSanhMa(a.duong, b.duong));
}

export function tongHopTheoDuoi(ds) {
  const nhom = new Map();
  for (const { duong, kichThuoc } of ds) {
    const d = path.posix.extname(duong).toLowerCase();
    const g = nhom.get(d) ?? { duoi: d, soTep: 0, tongKichThuoc: 0 };
    g.soTep++;
    g.tongKichThuoc += kichThuoc;
    nhom.set(d, g);
  }
  return [...nhom.values()].sort((a, b) => b.tongKichThuoc - a.tongKichThuoc || soSanhMa(a.duoi, b.duoi));
}
