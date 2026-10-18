import http from "node:http";

const KIEU_JSON = "application/json; charset=utf-8";

function guiJson(res, status, giaTri, them = {}) {
  const than = Buffer.from(JSON.stringify(giaTri), "utf8");
  res.writeHead(status, { "Content-Type": KIEU_JSON, "Content-Length": than.length, ...them });
  res.end(than);
}

class LoiThan extends Error {
  constructor(status, ma) {
    super(ma);
    this.status = status;
    this.ma = ma;
  }
}

/** Đọc thân theo luồng; vượt giới hạn ⇒ LoiThan 413 ngay khi biết (không đợi hết luồng). */
function docThan(req, gioiHan) {
  return new Promise((resolve, reject) => {
    const cl = req.headers["content-length"];
    if (cl !== undefined && Number(cl) > gioiHan) {
      reject(new LoiThan(413, "than-qua-lon"));
      return;
    }
    const manh = [];
    let daNhan = 0;
    let xong = false;
    req.on("data", (c) => {
      if (xong) return;
      daNhan += c.length;
      if (daNhan > gioiHan) {
        xong = true;
        reject(new LoiThan(413, "than-qua-lon"));
        return;
      }
      manh.push(c);
    });
    req.on("end", () => {
      if (xong) return;
      xong = true;
      resolve(Buffer.concat(manh).toString("utf8"));
    });
    req.on("error", (e) => {
      if (xong) return;
      xong = true;
      reject(e);
    });
  });
}

const laJson = (req) => (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() === "application/json";

export function taoMayChu(tuyChon = {}) {
  const gioiHan = tuyChon.gioiHanThan ?? 65536;
  const ghiChu = new Map();
  let idKe = 1;

  async function xuLy(req, res) {
    const { pathname } = new URL(req.url, "http://may-chu");
    const m = req.method;

    if (pathname === "/suc-khoe") {
      if (m !== "GET") return guiJson(res, 405, { loi: "phuong-thuc-khong-ho-tro" }, { Allow: "GET" });
      return guiJson(res, 200, { ok: true });
    }

    if (pathname === "/ghi-chu") {
      if (m === "GET") return guiJson(res, 200, [...ghiChu.values()]);
      if (m !== "POST") return guiJson(res, 405, { loi: "phuong-thuc-khong-ho-tro" }, { Allow: "GET, POST" });
      if (!laJson(req)) {
        req.resume();
        return guiJson(res, 415, { loi: "can-json" });
      }
      let chu;
      try {
        chu = await docThan(req, gioiHan);
      } catch (e) {
        if (e instanceof LoiThan) {
          req.resume();
          return guiJson(res, e.status, { loi: e.ma }, { Connection: "close" });
        }
        throw e;
      }
      let du;
      try {
        du = JSON.parse(chu);
      } catch {
        return guiJson(res, 400, { loi: "json-hong" });
      }
      if (du === null || typeof du !== "object" || Array.isArray(du) || typeof du.noiDung !== "string" || du.noiDung.trim() === "") {
        return guiJson(res, 422, { loi: "du-lieu-khong-hop-le" });
      }
      const gc = { id: idKe++, noiDung: du.noiDung.trim() };
      ghiChu.set(gc.id, gc);
      return guiJson(res, 201, gc, { Location: `/ghi-chu/${gc.id}` });
    }

    const k = /^\/ghi-chu\/([1-9][0-9]*)$/.exec(pathname);
    if (k) {
      if (m !== "GET" && m !== "DELETE") return guiJson(res, 405, { loi: "phuong-thuc-khong-ho-tro" }, { Allow: "GET, DELETE" });
      const id = Number(k[1]);
      const gc = ghiChu.get(id);
      if (!gc) return guiJson(res, 404, { loi: "khong-tim-thay" });
      if (m === "GET") return guiJson(res, 200, gc);
      ghiChu.delete(id);
      res.writeHead(204);
      return res.end();
    }

    return guiJson(res, 404, { loi: "khong-tim-thay" });
  }

  return http.createServer((req, res) => {
    xuLy(req, res).catch(() => {
      if (!res.headersSent) guiJson(res, 500, { loi: "loi-may-chu" });
      else res.destroy();
    });
  });
}
