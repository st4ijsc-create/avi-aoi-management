/**
 * ★★★ Đợt 3c — vá lỗ CÒN LẠI của cookie-tossing: ứng dụng xem trước nghe thẳng `127.0.0.1:<cổng dải>` ⇒ mã AI trong
 * khung xem trước `window.open("http://127.0.0.1:51xx")` là chạy CÙNG SITE với ứng dụng chính (mở bằng localhost /
 * 127.0.0.1). Bản vá:
 *   §1 địa chỉ bind của ứng dụng = AI_PREVIEW_APP_HOST || AI_PREVIEW_PROXY_HOST, PHẢI là loopback 127.x KHÁC 127.0.0.1
 *      (không 0.0.0.0/localhost/::1, không IP LAN — ứng dụng không xác thực, không được lộ ra mạng);
 *   §2 mỗi khuôn ép host bằng cách của nó (vite `--host`, next `-H`, dotnet `--no-launch-profile` + ASPNETCORE_URLS,
 *      còn lại HOST/PORT); khuôn vite/next mà không ép được (cờ --host/--port sẵn, lệnh ghép) ⇒ TỪ CHỐI có mã;
 *   §3 cửa sinh đặt HOST/ASPNETCORE_URLS theo địa chỉ ấy, không bao giờ 127.0.0.1;
 *   §4 trình quản lý: dò sẵn sàng ĐÚNG địa chỉ; thấy cổng nghe trên 127.0.0.1/::1 ⇒ DỪNG (`nghe-sai-dia-chi`);
 *      proxy chỉ chuyển tới khi ĐÃ kiểm (`dang-chay`);
 *   §5 phép dò THẬT phân biệt 127.0.0.2 với 127.0.0.1;
 *   §6 tầng dịch vụ trả mã lý do.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { coNgheCong, docDiaChiUngDung, laDiaChiUngDungHopLe } from "./capCong";
import { argvVoiDiaChi, dungLenhUngDung, sinhUngDungThat } from "./cuaSinhUngDung";
import { QuanLyUngDung, type LenhUngDung, type PhuThuocQuanLy, type TienTrinhUngDung } from "./quanLyUngDung";
import { chayUngDungChoNguoi, trangThaiChoNguoi, type PhuThuocDichVu } from "./dichVu";

const tam: string[] = [];
function gocVoiScript(dev: string): string {
  const g = fs.mkdtempSync(path.join(os.tmpdir(), "ai7-dc-"));
  tam.push(g);
  fs.writeFileSync(path.join(g, "package.json"), JSON.stringify({ scripts: { dev } }));
  return g;
}
afterEach(() => {
  for (const g of tam.splice(0)) fs.rmSync(g, { recursive: true, force: true });
});

describe("§1 — docDiaChiUngDung: loopback 127.x KHÁC 127.0.0.1, fail-closed", () => {
  it("★★★ vắng cấu hình (proxy mặc định 0.0.0.0) ⇒ KHÔNG hợp lệ", () => {
    expect(docDiaChiUngDung({})).toMatchObject({ ok: false, ma: "DIA_CHI_UNG_DUNG_KHONG_HOP_LE" });
  });
  it("★★★ AI_PREVIEW_PROXY_HOST=127.0.0.2 ⇒ ứng dụng bind 127.0.0.2; AI_PREVIEW_APP_HOST thắng", () => {
    expect(docDiaChiUngDung({ AI_PREVIEW_PROXY_HOST: "127.0.0.2" })).toEqual({ ok: true, diaChi: "127.0.0.2" });
    expect(docDiaChiUngDung({ AI_PREVIEW_PROXY_HOST: "10.0.0.9", AI_PREVIEW_APP_HOST: "127.0.0.3" })).toEqual({ ok: true, diaChi: "127.0.0.3" });
  });
  it("★★★ 127.0.0.1 / localhost / 0.0.0.0 / ::1 / :: / IP LAN / rác ⇒ KHÔNG hợp lệ", () => {
    for (const v of ["127.0.0.1", "localhost", "0.0.0.0", "::1", "::", "10.0.0.9", "127.0.0.0", "127.255.255.255", "127.1", "abc", " "]) {
      expect(laDiaChiUngDungHopLe(v), v).toBe(false);
      expect(docDiaChiUngDung({ AI_PREVIEW_APP_HOST: v }).ok, v).toBe(false);
    }
  });
});

describe("§2 — mỗi khuôn ép host; không ép được ⇒ TỪ CHỐI có mã", () => {
  const lenhCua = (dev: string) => dungLenhUngDung({ loai: "npm", script: "dev" }, gocVoiScript(dev));
  it("★★★ vite ⇒ `-- --host <địa chỉ> --port <cổng> --strictPort`", () => {
    const l = lenhCua("vite") as LenhUngDung;
    expect("tuChoi" in l || "thieu" in l).toBe(false);
    expect(argvVoiDiaChi(l, "127.0.0.2", 5155).slice(-6)).toEqual(["--", "--host", "127.0.0.2", "--port", "5155", "--strictPort"]);
  });
  it("★★★ next dev ⇒ `-- -H <địa chỉ> -p <cổng>`", () => {
    const l = lenhCua("next dev") as LenhUngDung;
    expect(argvVoiDiaChi(l, "127.0.0.2", 5155).slice(-5)).toEqual(["--", "-H", "127.0.0.2", "-p", "5155"]);
  });
  it("★★★ vite/next có sẵn --host/--port hoặc nằm trong lệnh ghép ⇒ KHUON_KHONG_EP_DUOC_HOST", () => {
    for (const s of ["vite --port 3000", "vite --host", "vite --host=0.0.0.0", "next dev -p 4000", "next dev --hostname 0.0.0.0", 'concurrently "vite" "node api.js"', "vite && node x.js"]) {
      expect(lenhCua(s), s).toMatchObject({ tuChoi: { ma: "KHUON_KHONG_EP_DUOC_HOST" } });
    }
  });
  it("★★ node server.js ⇒ chỉ HOST/PORT (không thêm argv) — trình quản lý kiểm lúc chạy", () => {
    const l = lenhCua("node server.js") as LenhUngDung;
    expect(argvVoiDiaChi(l, "127.0.0.2", 5155)).toEqual(l.args);
  });
  it("★★★ dotnet ⇒ `--no-launch-profile` (launchSettings.json không đè ASPNETCORE_URLS)", () => {
    const g = gocVoiScript("x");
    const l = dungLenhUngDung({ loai: "dotnet", duAn: "App.csproj" }, g) as LenhUngDung;
    expect(l.args).toContain("--no-launch-profile");
  });
});

describe("§3 — cửa sinh: HOST/ASPNETCORE_URLS = địa chỉ ứng dụng, KHÔNG BAO GIỜ 127.0.0.1", () => {
  it("★★★ env của tiến trình thật mang 127.0.0.2", async () => {
    const con = sinhUngDungThat(
      { file: process.execPath, args: ["-e", "console.log(process.env.HOST + ' ' + process.env.ASPNETCORE_URLS)"], envThem: { HOST: "0.0.0.0" }, moTa: "t" },
      os.tmpdir(),
      5157,
      "127.0.0.2",
    );
    let out = "";
    con.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    await new Promise<void>((g) => con.on("exit", () => g()));
    expect(out.trim()).toBe("127.0.0.2 http://127.0.0.2:5157");
  });
  it("★★★ địa chỉ không hợp lệ ⇒ cửa sinh NÉM, không sinh", () => {
    expect(() => sinhUngDungThat({ file: process.execPath, args: ["-e", ""], envThem: {}, moTa: "t" }, os.tmpdir(), 5157, "127.0.0.1")).toThrow(/DIA_CHI_UNG_DUNG_KHONG_HOP_LE/);
  });
});

class TienTrinhGia extends EventEmitter implements TienTrinhUngDung {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  constructor(public pid: number) {
    super();
  }
}

function quanLy() {
  const goi: { sinh: string[]; congTrong: string[]; thuKetNoi: string[]; giet: number } = { sinh: [], congTrong: [], thuKetNoi: [], giet: 0 };
  const ngheDung = new Set<number>();
  const ngheSai = new Set<number>();
  const tt: TienTrinhGia[] = [];
  const deps: PhuThuocQuanLy = {
    sinh: (_l, _g, cong, diaChi) => {
      goi.sinh.push(`${diaChi}:${cong}`);
      const p = new TienTrinhGia(100 + tt.length);
      tt.push(p);
      return p;
    },
    giet: (pid) => {
      goi.giet++;
      tt.find((p) => p.pid === pid)?.emit("exit", null, "SIGKILL");
      return "da-ra-lenh";
    },
    bayGio: () => 1,
    congTrong: async (c, d) => (goi.congTrong.push(`${d}:${c}`), true),
    thuKetNoi: async (c, d) => (goi.thuKetNoi.push(`${d}:${c}`), ngheDung.has(c)),
    ngheSaiDiaChi: async (c) => ngheSai.has(c),
    ghiAudit: () => {},
    anHanGietMs: 20,
  };
  return { ql: new QuanLyUngDung({ tu: 5100, den: 5101 }, deps), goi, ngheDung, ngheSai };
}
const LENH: LenhUngDung = { file: "node", args: ["s.js"], envThem: {}, moTa: "npm run dev" };

describe("§4 — trình quản lý: bind/dò ĐÚNG địa chỉ; nghe trên 127.0.0.1 ⇒ DỪNG", () => {
  it("★★★ địa chỉ 127.0.0.1 ⇒ từ chối, KHÔNG sinh", async () => {
    const { ql, goi } = quanLy();
    expect(await ql.chay({ projectId: "p", goc: "/g", userId: 1, lenh: LENH, diaChi: "127.0.0.1" })).toMatchObject({ ok: false, ma: "DIA_CHI_UNG_DUNG_KHONG_HOP_LE" });
    expect(goi.sinh).toEqual([]);
  });
  it("★★★ sinh/dò cổng trống/dò sẵn sàng đều trên địa chỉ ứng dụng", async () => {
    const { ql, goi, ngheDung } = quanLy();
    await ql.chay({ projectId: "p", goc: "/g", userId: 1, lenh: LENH, diaChi: "127.0.0.2" });
    ngheDung.add(5100);
    await ql.lamMoiSanSang("p");
    expect(goi.sinh).toEqual(["127.0.0.2:5100"]);
    expect(goi.congTrong[0]).toBe("127.0.0.2:5100");
    expect(goi.thuKetNoi).toContain("127.0.0.2:5100");
    expect(ql.trangThai("p")?.trangThai).toBe("dang-chay");
    expect(ql.diaChiCuaDuAn("p")).toBe("127.0.0.2");
  });
  it("★★★ proxy KHÔNG chuyển tới khi CHƯA kiểm (dang-khoi-dong ⇒ congCuaDuAn null)", async () => {
    const { ql, ngheDung } = quanLy();
    await ql.chay({ projectId: "p", goc: "/g", userId: 1, lenh: LENH, diaChi: "127.0.0.2" });
    expect(ql.congCuaDuAn("p")).toBeNull();
    ngheDung.add(5100);
    await ql.lamMoiSanSang("p");
    expect(ql.congCuaDuAn("p")).toBe(5100);
  });
  it("★★★ cổng nghe trên 127.0.0.1/::1 (app lờ HOST, bind 0.0.0.0) ⇒ DỪNG, lyDoDung nghe-sai-dia-chi, không bao giờ dang-chay", async () => {
    const { ql, goi, ngheDung, ngheSai } = quanLy();
    await ql.chay({ projectId: "p", goc: "/g", userId: 1, lenh: LENH, diaChi: "127.0.0.2" });
    ngheDung.add(5100);
    ngheSai.add(5100);
    await ql.lamMoiSanSang("p");
    expect(goi.giet).toBe(1);
    expect(ql.trangThai("p")).toMatchObject({ trangThai: "da-dung", lyDoDung: "nghe-sai-dia-chi" });
    expect(ql.congCuaDuAn("p")).toBeNull();
  });
  it("★★ đang chạy rồi mới mở thêm trên 127.0.0.1 ⇒ lượt kiểm sau DỪNG", async () => {
    const { ql, ngheDung, ngheSai } = quanLy();
    await ql.chay({ projectId: "p", goc: "/g", userId: 1, lenh: LENH, diaChi: "127.0.0.2" });
    ngheDung.add(5100);
    await ql.lamMoiSanSang("p");
    expect(ql.trangThai("p")?.trangThai).toBe("dang-chay");
    ngheSai.add(5100);
    await ql.lamMoiSanSang("p");
    expect(ql.trangThai("p")?.lyDoDung).toBe("nghe-sai-dia-chi");
  });
});

describe("§5 — phép dò THẬT phân biệt 127.0.0.2 với 127.0.0.1", () => {
  it("★★★ máy chủ nghe 127.0.0.2 ⇒ dò 127.0.0.2 thấy, dò 127.0.0.1 KHÔNG thấy", async () => {
    const s = net.createServer();
    const ok = await new Promise<boolean>((g) => {
      s.once("error", () => g(false));
      s.listen(0, "127.0.0.2", () => g(true));
    });
    if (!ok) return; // nền tảng không có 127.0.0.2 (macOS mặc định) — phép đo không áp dụng
    const cong = (s.address() as net.AddressInfo).port;
    try {
      expect(await coNgheCong(cong, "127.0.0.2")).toBe(true);
      expect(await coNgheCong(cong, "127.0.0.1")).toBe(false);
    } finally {
      await new Promise<void>((g) => s.close(() => g()));
    }
  });
});

describe("§6 — tầng dịch vụ trả MÃ LÝ DO", () => {
  function deps(goc: string, ql: QuanLyUngDung, diaChi: ReturnType<typeof docDiaChiUngDung>): PhuThuocDichVu {
    return {
      coQuyen: async () => true,
      phanGiaiGoc: (id) => (id === "demo" ? { ok: true, id: "demo", goc } : { ok: false, ma: "PROJECT_NOT_FOUND" }),
      gocRepoChinh: () => path.join(os.tmpdir(), "khong-phai-goc-nay"),
      ql: () => ql,
      cauHinhXemTruoc: () => ({ bat: true, lyDoTat: null }),
      diaChiUngDung: () => diaChi,
    };
  }
  it("★★★ địa chỉ ứng dụng chưa cấu hình ⇒ chạy bị từ chối + trạng thái nói rõ, KHÔNG sinh", async () => {
    const { ql, goi } = quanLy();
    const g = gocVoiScript("vite");
    const khong = docDiaChiUngDung({});
    expect(await chayUngDungChoNguoi({ user: { id: 7, role: "engineer" }, projectId: "demo" }, deps(g, ql, khong))).toMatchObject({ ok: false, ma: "DIA_CHI_UNG_DUNG_KHONG_HOP_LE" });
    const tt = await trangThaiChoNguoi({ user: { id: 7, role: "engineer" }, projectId: "demo" }, deps(g, ql, khong));
    expect(tt.ok && tt.lenhChay).toMatchObject({ ok: false, ma: "DIA_CHI_UNG_DUNG_KHONG_HOP_LE" });
    expect(goi.sinh).toEqual([]);
  });
  it("★★★ khuôn không ép được host ⇒ KHUON_KHONG_EP_DUOC_HOST (chạy + trạng thái), KHÔNG sinh", async () => {
    const { ql, goi } = quanLy();
    const g = gocVoiScript("vite --port 3000");
    const co = docDiaChiUngDung({ AI_PREVIEW_PROXY_HOST: "127.0.0.2" });
    expect(await chayUngDungChoNguoi({ user: { id: 7, role: "engineer" }, projectId: "demo" }, deps(g, ql, co))).toMatchObject({ ok: false, ma: "KHUON_KHONG_EP_DUOC_HOST" });
    const tt = await trangThaiChoNguoi({ user: { id: 7, role: "engineer" }, projectId: "demo" }, deps(g, ql, co));
    expect(tt.ok && tt.lenhChay).toMatchObject({ ok: false, ma: "KHUON_KHONG_EP_DUOC_HOST" });
    expect(goi.sinh).toEqual([]);
  });
  it("★★ hợp lệ ⇒ sinh trên 127.0.0.2", async () => {
    const { ql, goi } = quanLy();
    const r = await chayUngDungChoNguoi({ user: { id: 7, role: "engineer" }, projectId: "demo" }, deps(gocVoiScript("vite"), ql, docDiaChiUngDung({ AI_PREVIEW_PROXY_HOST: "127.0.0.2" })));
    expect(r.ok).toBe(true);
    expect(goi.sinh).toEqual(["127.0.0.2:5100"]);
  });
});
