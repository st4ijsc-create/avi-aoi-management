import { StringDecoder } from "node:string_decoder";

/** Duyệt các dòng của nguồn theo mảnh: phát { so, noiDung } cho MỌI dòng (kể cả rỗng). */
async function* cacDong(nguon) {
  const giaiMa = new StringDecoder("utf8");
  let dem = 0;
  let du = "";
  for await (const manh of nguon) {
    du += typeof manh === "string" ? manh : giaiMa.write(Buffer.from(manh));
    let i;
    while ((i = du.indexOf("\n")) >= 0) {
      const dong = du.slice(0, i);
      du = du.slice(i + 1);
      yield { so: ++dem, noiDung: dong.endsWith("\r") ? dong.slice(0, -1) : dong };
    }
  }
  du += giaiMa.end();
  if (du.length > 0) yield { so: ++dem, noiDung: du.endsWith("\r") ? du.slice(0, -1) : du };
}

function phanLoai(noiDung) {
  let v;
  try {
    v = JSON.parse(noiDung);
  } catch {
    return { lyDo: "json" };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { lyDo: "khong-phai-doi-tuong" };
  return { giaTri: v };
}

export async function demNdjson(nguon) {
  const kq = { tong: 0, hopLe: 0, loi: [] };
  for await (const { so, noiDung } of cacDong(nguon)) {
    if (noiDung.trim() === "") continue;
    kq.tong++;
    const p = phanLoai(noiDung);
    if (p.lyDo) kq.loi.push({ dong: so, lyDo: p.lyDo });
    else kq.hopLe++;
  }
  return kq;
}

export async function* docNdjson(nguon) {
  for await (const { so, noiDung } of cacDong(nguon)) {
    if (noiDung.trim() === "") continue;
    const p = phanLoai(noiDung);
    if (!p.lyDo) yield { dong: so, giaTri: p.giaTri };
  }
}
