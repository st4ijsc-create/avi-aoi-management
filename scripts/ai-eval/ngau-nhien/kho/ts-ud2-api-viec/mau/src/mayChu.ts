import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { KhoViec } from "./kho.ts";
import { kiemBoLoc, kiemCapNhat, kiemViecMoi } from "./xacThuc.ts";
import type { LoiTruong } from "./kieu.ts";

function guiJson(res: ServerResponse, ma: number, duLieu: unknown, them: Record<string, string> = {}): void {
  const than = JSON.stringify(duLieu);
  res.writeHead(ma, { "Content-Type": "application/json; charset=utf-8", ...them });
  res.end(than);
}

const guiLoi = (res: ServerResponse, ma: number, loi: LoiTruong[], them: Record<string, string> = {}) =>
  guiJson(res, ma, { loi }, them);

async function docThan(req: IncomingMessage): Promise<{ ok: true; giaTri: unknown } | { ok: false }> {
  const manh: Buffer[] = [];
  for await (const m of req) manh.push(m as Buffer);
  try {
    return { ok: true, giaTri: JSON.parse(Buffer.concat(manh).toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

const KHONG_THAY: LoiTruong[] = [{ truong: "", thongDiep: "không tìm thấy" }];
const SAI_PHUONG_THUC: LoiTruong[] = [{ truong: "", thongDiep: "phương thức không được hỗ trợ" }];
const JSON_HONG: LoiTruong[] = [{ truong: "", thongDiep: "JSON không hợp lệ" }];

export function taoMayChu(kho: KhoViec = new KhoViec()): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const p = url.pathname;
    const pt = req.method ?? "GET";

    if (p === "/viec") {
      if (pt === "GET") {
        const loc = kiemBoLoc(url.searchParams);
        if (!loc.ok) return guiLoi(res, 400, loc.loi);
        return guiJson(res, 200, kho.ds(loc.giaTri));
      }
      if (pt === "POST") {
        const than = await docThan(req);
        if (!than.ok) return guiLoi(res, 400, JSON_HONG);
        const kq = kiemViecMoi(than.giaTri);
        if (!kq.ok) return guiLoi(res, 400, kq.loi);
        const v = kho.them(kq.giaTri);
        return guiJson(res, 201, v, { Location: `/viec/${v.id}` });
      }
      return guiLoi(res, 405, SAI_PHUONG_THUC, { Allow: "GET, POST" });
    }

    const m = /^\/viec\/([1-9]\d*)$/.exec(p);
    if (!m) return guiLoi(res, 404, KHONG_THAY);
    const id = Number(m[1]);
    if (pt !== "GET" && pt !== "PATCH" && pt !== "DELETE") {
      return guiLoi(res, 405, SAI_PHUONG_THUC, { Allow: "GET, PATCH, DELETE" });
    }
    if (!kho.lay(id)) return guiLoi(res, 404, KHONG_THAY);
    if (pt === "GET") return guiJson(res, 200, kho.lay(id));
    if (pt === "DELETE") {
      kho.xoa(id);
      res.writeHead(204);
      return void res.end();
    }
    const than = await docThan(req);
    if (!than.ok) return guiLoi(res, 400, JSON_HONG);
    const kq = kiemCapNhat(than.giaTri);
    if (!kq.ok) return guiLoi(res, 400, kq.loi);
    return guiJson(res, 200, kho.capNhat(id, kq.giaTri));
  });
}
