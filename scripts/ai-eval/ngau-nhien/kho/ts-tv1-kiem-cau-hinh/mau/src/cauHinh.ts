export type MayAoi = { loai: "aoi"; ten: string; cong: number; doPhanGiai: number };
export type MayPlc = { loai: "plc"; ten: string; cong: number; diaChi: string; chuKyMs: number };
export type MayCamera = { loai: "camera"; ten: string; url: string };
export type May = MayAoi | MayPlc | MayCamera;
export type CauHinh = { phienBan: 1; tenNhaMay: string; ghiNhat: boolean; may: May[] };

export type LoiKiem = { duong: string; thongDiep: string };
export type KetQua<T> = { ok: true; giaTri: T } | { ok: false; loi: LoiKiem[] };

type DoiTuong = Record<string, unknown>;

const laDoiTuong = (x: unknown): x is DoiTuong => typeof x === "object" && x !== null && !Array.isArray(x);
const coMat = (o: DoiTuong, k: string): boolean => Object.hasOwn(o, k) && o[k] !== undefined;
const laChuoiKhacRong = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const laCong = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535;
const OCTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const RE_IPV4 = new RegExp(String.raw`^${OCTET}\.${OCTET}\.${OCTET}\.${OCTET}$`);

function laUrlHopLe(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    return ["rtsp:", "http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

export function kiemCauHinh(x: unknown): KetQua<CauHinh> {
  if (!laDoiTuong(x)) return { ok: false, loi: [{ duong: "", thongDiep: "phải là đối tượng" }] };
  const loi: LoiKiem[] = [];
  const bao = (duong: string, thongDiep: string) => loi.push({ duong, thongDiep });

  if (!coMat(x, "phienBan")) bao("phienBan", "thiếu");
  else if (x.phienBan !== 1) bao("phienBan", "phải bằng 1");

  let tenNhaMay = "";
  if (!coMat(x, "tenNhaMay")) bao("tenNhaMay", "thiếu");
  else if (!laChuoiKhacRong(x.tenNhaMay)) bao("tenNhaMay", "phải là chuỗi khác rỗng");
  else tenNhaMay = x.tenNhaMay.trim();

  let ghiNhat = false;
  if (coMat(x, "ghiNhat")) {
    if (typeof x.ghiNhat !== "boolean") bao("ghiNhat", "phải là boolean");
    else ghiNhat = x.ghiNhat;
  }

  const may: May[] = [];
  if (coMat(x, "may")) {
    if (!Array.isArray(x.may)) bao("may", "phải là mảng");
    else {
      const tenDaGap = new Map<string, number>();
      x.may.forEach((m: unknown, i: number) => {
        const p = `may[${i}]`;
        if (!laDoiTuong(m)) return void bao(p, "phải là đối tượng");
        if (!coMat(m, "loai")) return void bao(`${p}.loai`, "thiếu");
        const loai = m.loai;
        if (loai !== "aoi" && loai !== "plc" && loai !== "camera") return void bao(`${p}.loai`, "loại không hợp lệ");

        let ten = "";
        if (!coMat(m, "ten")) bao(`${p}.ten`, "thiếu");
        else if (!laChuoiKhacRong(m.ten)) bao(`${p}.ten`, "phải là chuỗi khác rỗng");
        else {
          ten = m.ten.trim();
          const j = tenDaGap.get(ten);
          if (j !== undefined) bao(`${p}.ten`, `trùng tên với may[${j}]`);
          else tenDaGap.set(ten, i);
        }

        if (loai === "aoi") {
          let cong = 0;
          if (!coMat(m, "cong")) bao(`${p}.cong`, "thiếu");
          else if (!laCong(m.cong)) bao(`${p}.cong`, "phải là số nguyên 1..65535");
          else cong = m.cong;
          let doPhanGiai = 10;
          if (coMat(m, "doPhanGiai")) {
            const v = m.doPhanGiai;
            if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) bao(`${p}.doPhanGiai`, "phải là số dương");
            else doPhanGiai = v;
          }
          may.push({ loai, ten, cong, doPhanGiai });
        } else if (loai === "plc") {
          let cong = 502;
          if (coMat(m, "cong")) {
            if (!laCong(m.cong)) bao(`${p}.cong`, "phải là số nguyên 1..65535");
            else cong = m.cong;
          }
          let diaChi = "";
          if (!coMat(m, "diaChi")) bao(`${p}.diaChi`, "thiếu");
          else if (typeof m.diaChi !== "string" || !RE_IPV4.test(m.diaChi)) bao(`${p}.diaChi`, "phải là IPv4");
          else diaChi = m.diaChi;
          let chuKyMs = 100;
          if (coMat(m, "chuKyMs")) {
            const v = m.chuKyMs;
            if (typeof v !== "number" || !Number.isInteger(v) || v < 10 || v > 60000) bao(`${p}.chuKyMs`, "phải là số nguyên 10..60000");
            else chuKyMs = v;
          }
          may.push({ loai, ten, cong, diaChi, chuKyMs });
        } else {
          let url = "";
          if (!coMat(m, "url")) bao(`${p}.url`, "thiếu");
          else if (!laUrlHopLe(m.url)) bao(`${p}.url`, "phải là URL rtsp/http/https");
          else url = m.url;
          may.push({ loai, ten, url });
        }
      });
    }
  }

  if (loi.length) return { ok: false, loi };
  return { ok: true, giaTri: { phienBan: 1, tenNhaMay, ghiNhat, may } };
}

export function laMayPlc(m: May): m is MayPlc {
  return m.loai === "plc";
}

export function moTaMay(m: May): string {
  switch (m.loai) {
    case "aoi":
      return `aoi:${m.ten}:${m.cong}`;
    case "plc":
      return `plc:${m.ten}@${m.diaChi}:${m.cong}/${m.chuKyMs}ms`;
    case "camera":
      return `camera:${m.ten}@${m.url}`;
  }
}
