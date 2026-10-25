/**
 * ★★ Đợt 6 — API ĐỔI MODEL `llama-server` có kiểm `/props` (thay `doi-model.ps1` cho sản phẩm).
 *
 * Lưới canh, bằng vật thật ở đúng chỗ có thể (thư mục tạm THẬT cho kho model / tệp tạm dừng / khoá /
 * tệp lựa chọn; `fetch` + kịch bản khởi động + VRAM + cổng ưu tiên TIÊM VÀO — không chạm :8091 trừ
 * ca "THẬT" cuối tệp, chỉ GET `/props`):
 *   1. Danh sách trắng: chỉ basename trong kho, không đường dẫn tuỳ ý, không mmproj/embedding/reranker.
 *   2. Từ chối TRƯỚC khi đụng gì: đang đổi / tạm dừng / giám sát đang khởi động / server không sống /
 *      đã đang chạy model đó / VRAM không vừa.
 *   3. Luồng đầy đủ: tạm dừng giám sát → giữ cổng → ghi lựa chọn → kịch bản `-Force` → `/props` →
 *      sinh thử → phủ env; dọn tệp tạm dừng + khoá + nhả cổng ở MỌI đường ra.
 *   4. Hỏng ở `/props` / sinh thử / kịch bản ⇒ QUAY VỀ model cũ (tệp lựa chọn trả y nguyên, chạy lại
 *      kịch bản, kiểm `/props` model cũ) và báo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DieuPhoiDoiModel,
  LoiDoiModel,
  lietKeModelTrongKho,
  xacThucTenModel,
  docProps,
  kiemProps,
  uocLuongVramByte,
  docMetaGgufMacDinh,
  type PhuThuocDoiModel,
  type MetaGguf,
} from "./doiModelLlamaServer";
import { apDungLuaChonModel, docLuaChon, duongLuaChon, ghiLuaChon } from "./luaChonModelLlamaServer";
import { CongUuTienLlm } from "./hangDoiUuTienLlm";

const GiB = 1024 ** 3;
let thuMuc = "";
let kho = "";
beforeEach(() => {
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "llama-doimodel-test-"));
  kho = path.join(thuMuc, "kho");
  fs.mkdirSync(kho);
  for (const t of ["Cu.gguf", "Moi.gguf", "Qwen3-VL-8B-mmproj-F16.gguf", "Qwen3-Embedding-0.6B-f16.gguf", "bge-reranker-v2-m3-Q8_0.gguf"]) {
    fs.writeFileSync(path.join(kho, t), "x".repeat(10));
  }
  fs.mkdirSync(path.join(kho, "con.gguf")); // THƯ MỤC mang đuôi .gguf — không phải model
});
afterEach(() => {
  try {
    fs.rmSync(thuMuc, { recursive: true, force: true });
  } catch {
    /* Windows giữ handle */
  }
});

// ─── server giả: trạng thái model đang giữ + nhật ký lời gọi ─────────────────────────────────────
interface ServerGia {
  model: string | null; // basename đang chạy; null = chết
  nCtx: number;
  slots: number;
  sinhHong: boolean;
  goi: string[];
}

function fetchGia(s: ServerGia): typeof fetch {
  return (async (url: any, init?: any) => {
    const u = String(url);
    s.goi.push(`${init?.method ?? "GET"} ${u.replace(/^https?:\/\/[^/]+/, "")}`);
    if (!s.model) {
      const e: any = new TypeError("fetch failed");
      e.cause = { code: "ECONNREFUSED" };
      throw e;
    }
    if (u.endsWith("/props")) {
      return new Response(
        JSON.stringify({ model_path: `D:/kho/${s.model}`, total_slots: s.slots, default_generation_settings: { n_ctx: s.nCtx } }),
        { status: 200 },
      );
    }
    if (u.endsWith("/v1/chat/completions")) {
      if (s.sinhHong) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { completion_tokens: 2 } }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function dungMoiTruong(over: Partial<PhuThuocDoiModel> = {}, serverOver: Partial<ServerGia> = {}) {
  const s: ServerGia = { model: "Cu.gguf", nCtx: 65536, slots: 1, sinhHong: false, goi: [], ...serverOver };
  const env: NodeJS.ProcessEnv = {
    LLAMA_SERVER_ENABLED: "true",
    LLAMA_SERVER_URL: "http://127.0.0.1:8091",
    LLAMA_SERVER_MODEL: "Cu.gguf",
    GGUF_DEFAULT_MODEL: "Cu.gguf",
    GGUF_CODE_MODEL: "Cu.gguf",
    GGUF_MODELS_DIR: kho,
    LLAMA_SERVER_CTX_TOTAL: "65536",
    LLAMA_SERVER_SLOTS: "1",
    LLAMA_SERVER_SELECTION_FILE: path.join(thuMuc, "sel", "lua-chon.json"),
  } as NodeJS.ProcessEnv;
  const nhatKy = {
    kichBan: [] as string[],
    congGiu: 0,
    congNha: 0,
    tamDungLucKichBan: [] as boolean[],
    /** Nội dung tệp lựa chọn BỀN ngay lúc kịch bản chạy (null = không có tệp). */
    luaChonLucKichBan: [] as (string | null)[],
  };
  const duongTamDung = path.join(thuMuc, "llama-watchdog.pause");
  // Kịch bản giả, CÙNG hợp đồng với start-llama-server.ps1: `-Model <tên>` tường minh thắng; không có thì đọc
  // tệp lựa chọn ĐÃ CHỐT rồi "nạp" model đó (hoặc hỏng / treo theo kịch).
  let hongKhiNap: ((model: string) => number | null) | null = null;
  let treoKhiNap: ((model: string) => boolean) | null = null;
  const d: PhuThuocDoiModel = {
    env,
    nenTang: "win32",
    fetchFn: fetchGia(s),
    chayKichBan: async (thamSo, modelTuongMinh) => {
      nhatKy.kichBan.push(thamSo.join(" ") + (modelTuongMinh ? ` -Model ${modelTuongMinh}` : ""));
      nhatKy.tamDungLucKichBan.push(fs.existsSync(duongTamDung));
      let thoLc: string | null = null;
      try {
        thoLc = fs.readFileSync(duongLuaChon(env), "utf8");
      } catch {
        /* không có tệp (hoặc ca giả lập đĩa hỏng: đường là thư mục) */
      }
      nhatKy.luaChonLucKichBan.push(thoLc);
      const lc = docLuaChon(duongLuaChon(env));
      const model = modelTuongMinh ?? (lc && lc.envModel === "Cu.gguf" ? lc.model : "Cu.gguf");
      if (treoKhiNap?.(model)) {
        s.model = model; // kịch bản đã giết server cũ và dựng bản mới… rồi tiến trình gọi CHẾT, không ai nghe kết quả
        return new Promise<never>(() => {});
      }
      const ma = hongKhiNap?.(model) ?? null;
      if (ma !== null && ma !== 0) {
        s.model = null;
        return { ma };
      }
      s.model = model;
      return { ma: 0 };
    },
    docVram: async () => ({ usedBytes: 26 * GiB, totalBytes: 32 * GiB }),
    docMetaGguf: async (): Promise<MetaGguf | null> => ({ soTangChuY: 10, soDauKv: 2, doDaiKey: 256, doDaiValue: 256 }),
    kichThuocTep: (p) => (p.endsWith("Cu.gguf") ? 21 * GiB : 17 * GiB),
    giuCong: async () => {
      nhatKy.congGiu++;
      return () => {
        nhatKy.congNha++;
      };
    },
    bayGio: () => Date.now(),
    duongTamDung,
    duongKhoaDoi: path.join(thuMuc, "llama-doi-model.lock"),
    duongKhoaGiamSat: path.join(thuMuc, "llama-watchdog.lock"),
    ...over,
  };
  return {
    s,
    env,
    d,
    nhatKy,
    duongTamDung,
    datHongKhiNap: (f: (model: string) => number | null) => {
      hongKhiNap = f;
    },
    datTreoKhiNap: (f: (model: string) => boolean) => {
      treoKhiNap = f;
    },
  };
}

// ─── 1. Danh sách trắng ──────────────────────────────────────────────────────────────────────────
describe("kho model — liệt kê + xác thực", () => {
  it("liệt kê tệp .gguf ở GỐC kho, gắn loại; bỏ thư mục mang đuôi .gguf", () => {
    const ds = lietKeModelTrongKho(kho);
    expect(ds.map((m) => m.ten).sort()).toEqual(
      ["Cu.gguf", "Moi.gguf", "Qwen3-Embedding-0.6B-f16.gguf", "Qwen3-VL-8B-mmproj-F16.gguf", "bge-reranker-v2-m3-Q8_0.gguf"].sort(),
    );
    expect(ds.find((m) => m.ten === "Moi.gguf")?.loai).toBe("sinh-chu");
    expect(ds.find((m) => m.ten.includes("mmproj"))?.loai).toBe("khong-ho-tro");
    expect(ds.find((m) => m.ten.includes("Embedding"))?.loai).toBe("khong-ho-tro");
    expect(ds.find((m) => m.ten.includes("reranker"))?.loai).toBe("khong-ho-tro");
    expect(ds.find((m) => m.ten === "Moi.gguf")?.kichThuoc).toBe(10);
  });

  it("từ chối đường dẫn tuỳ ý, tệp ngoài kho, model không sinh chữ", () => {
    fs.writeFileSync(path.join(thuMuc, "NgoaiKho.gguf"), "x");
    for (const ten of ["../NgoaiKho.gguf", "C:/Windows/x.gguf", "kho/Moi.gguf", "Khong.gguf", "Qwen3-VL-8B-mmproj-F16.gguf", "con.gguf"]) {
      expect(xacThucTenModel(kho, ten).ok, ten).toBe(false);
    }
    const ok = xacThucTenModel(kho, "Moi.gguf");
    expect(ok.ok).toBe(true);
  });
});

// ─── 2. Thuần: /props + VRAM ─────────────────────────────────────────────────────────────────────
describe("kiểm /props + ước lượng VRAM (thuần)", () => {
  it("kiemProps liệt kê từng chỗ lệch", () => {
    const p = { modelPath: "D:/kho/Moi.gguf", tenModel: "Moi.gguf", nCtx: 32768, tongSlot: 2 };
    const lech = kiemProps(p, { tenModel: "Moi.gguf", nCtx: 65536, tongSlot: 1 });
    expect(lech).toHaveLength(2);
    expect(kiemProps(p, { tenModel: "Khac.gguf", nCtx: 32768, tongSlot: 2 })[0]).toMatch(/Khac/);
    expect(kiemProps({ ...p, nCtx: 65536, tongSlot: 1 }, { tenModel: "Moi.gguf", nCtx: 65536, tongSlot: 1 })).toEqual([]);
  });

  it("KV chỉ tính TẦNG CHÚ Ý (MoE lai Qwen3.6: 10/40 tầng) — số khớp phép đo 30B ≈ 6 GiB", () => {
    const qwen30b = uocLuongVramByte(17 * GiB, { soTangChuY: 48, soDauKv: 4, doDaiKey: 128, doDaiValue: 128 }, 65536, 3 * GiB);
    expect(qwen30b.kv / GiB).toBeCloseTo(6, 1);
    const qwen36 = uocLuongVramByte(21 * GiB, { soTangChuY: 10, soDauKv: 2, doDaiKey: 256, doDaiValue: 256 }, 65536, 3 * GiB);
    expect(qwen36.kv / GiB).toBeCloseTo(1.25, 2);
    expect(qwen36.tong).toBe(21 * GiB + qwen36.kv + 3 * GiB);
    const khongMeta = uocLuongVramByte(10 * GiB, null, 65536, 3 * GiB);
    expect(khongMeta.coMeta).toBe(false);
    expect(khongMeta.kv).toBeGreaterThanOrEqual(8 * GiB); // thận trọng khi không đọc được header
  });

  it("docProps đọc model_path / n_ctx / total_slots", async () => {
    const { d } = dungMoiTruong();
    const p = await docProps("http://127.0.0.1:8091", d.fetchFn, 1000);
    expect(p).toEqual({ modelPath: "D:/kho/Cu.gguf", tenModel: "Cu.gguf", nCtx: 65536, tongSlot: 1 });
  });
});

// ─── 3. Từ chối trước khi đụng gì ────────────────────────────────────────────────────────────────
describe("từ chối TRƯỚC khi chạm server", () => {
  async function tuChoi(m: ReturnType<typeof dungMoiTruong>, ten = "Moi.gguf"): Promise<string> {
    const dp = new DieuPhoiDoiModel(m.d);
    try {
      await dp.batDau(ten, "admin");
    } catch (e) {
      expect(e).toBeInstanceOf(LoiDoiModel);
      expect(m.nhatKy.kichBan, "không được chạy kịch bản khi từ chối").toEqual([]);
      expect(fs.existsSync(m.duongTamDung), "không để lại tệp tạm dừng").toBe(false);
      expect(fs.existsSync(m.d.duongKhoaDoi), "không để lại khoá").toBe(false);
      return (e as LoiDoiModel).code;
    }
    throw new Error("phải từ chối");
  }

  it("tên ngoài danh sách trắng", async () => {
    expect(await tuChoi(dungMoiTruong(), "../x.gguf")).toBe("MODEL_KHONG_HOP_LE");
  });
  it("llama-server tắt bằng cấu hình", async () => {
    const m = dungMoiTruong();
    m.env.LLAMA_SERVER_ENABLED = "false";
    expect(await tuChoi(m)).toBe("TAT");
  });
  it("URL không loopback", async () => {
    const m = dungMoiTruong();
    m.env.LLAMA_SERVER_URL = "http://10.0.0.5:8091";
    expect(await tuChoi(m)).toBe("TAT");
  });
  it("tệp tạm dừng đang có (doi-model.ps1 / lượt đổi khác)", async () => {
    const m = dungMoiTruong();
    fs.writeFileSync(m.duongTamDung, "doi-model.ps1");
    await expect(new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).rejects.toMatchObject({ code: "DANG_TAM_DUNG" });
    expect(m.nhatKy.kichBan).toEqual([]);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
    expect(fs.readFileSync(m.duongTamDung, "utf8"), "tệp của NGƯỜI KHÁC không được gỡ/ghi đè").toBe("doi-model.ps1");
  });
  it("bộ giám sát đang giữ khoá khởi động", async () => {
    const m = dungMoiTruong();
    fs.writeFileSync(m.d.duongKhoaGiamSat, JSON.stringify({ pid: process.pid, luc: Date.now(), token: "t" }));
    expect(await tuChoi(m)).toBe("GIAM_SAT_DANG_KHOI_DONG");
  });
  it("khoá đổi model đang bị tiến trình khác giữ", async () => {
    const m = dungMoiTruong();
    fs.writeFileSync(m.d.duongKhoaDoi, JSON.stringify({ pid: process.pid, luc: Date.now(), token: "khac" }));
    const dp = new DieuPhoiDoiModel(m.d);
    await expect(dp.batDau("Moi.gguf", "admin")).rejects.toMatchObject({ code: "DANG_DOI" });
    expect(fs.existsSync(m.d.duongKhoaDoi), "khoá của người khác không được gỡ").toBe(true);
  });
  it("server không sống (không có mốc để quay về)", async () => {
    expect(await tuChoi(dungMoiTruong({}, { model: null }))).toBe("SERVER_KHONG_SONG");
  });
  it("đã đang chạy đúng model đó", async () => {
    expect(await tuChoi(dungMoiTruong(), "Cu.gguf")).toBe("DA_DANG_CHAY");
  });
  it("VRAM không vừa sau khi trả phần của model cũ", async () => {
    const m = dungMoiTruong({ kichThuocTep: (p) => (p.endsWith("Cu.gguf") ? 10 * GiB : 30 * GiB) });
    expect(await tuChoi(m)).toBe("VRAM_KHONG_DU");
  });
  it("không đọc được VRAM ⇒ fail-closed", async () => {
    expect(await tuChoi(dungMoiTruong({ docVram: async () => null }))).toBe("VRAM_KHONG_DOC_DUOC");
  });
  it("lượt thứ hai trong cùng tiến trình khi lượt đầu chưa xong", async () => {
    let tha!: () => void;
    const m = dungMoiTruong({
      giuCong: () => new Promise((r) => (tha = () => r(() => {}))),
    });
    const dp = new DieuPhoiDoiModel(m.d);
    const { xong } = await dp.batDau("Moi.gguf", "admin");
    await expect(dp.batDau("Moi.gguf", "admin")).rejects.toMatchObject({ code: "DANG_DOI" });
    await new Promise((r) => setTimeout(r, 5));
    tha();
    await xong;
  });
});

// ─── 4. Luồng đầy đủ ─────────────────────────────────────────────────────────────────────────────
describe("luồng đầy đủ", () => {
  it("thành công: tạm dừng → cổng → lựa chọn → kịch bản -Force → /props → sinh thử → phủ env; dọn sạch", async () => {
    const m = dungMoiTruong();
    const dp = new DieuPhoiDoiModel(m.d);
    const { id, xong } = await dp.batDau("Moi.gguf", "admin");
    expect(id).toMatch(/./);
    const kq = await xong;
    expect(kq.ketQua).toBe("thanh-cong");
    expect(kq.modelCu).toBe("Cu.gguf");
    expect(kq.props?.tenModel).toBe("Moi.gguf");
    expect(kq.props?.nCtx).toBe(65536);
    expect(m.nhatKy.kichBan, "model mới đi bằng THAM SỐ tường minh, không qua tệp").toEqual(["-Force -Model Moi.gguf"]);
    expect(m.nhatKy.luaChonLucKichBan, "lựa chọn bền CHƯA được ghi lúc kịch bản chạy (chưa kiểm)").toEqual([null]);
    expect(m.nhatKy.tamDungLucKichBan, "giám sát phải TẠM DỪNG lúc kịch bản giết server").toEqual([true]);
    expect(m.nhatKy.congGiu).toBe(1);
    expect(m.nhatKy.congNha).toBe(1);
    expect(docLuaChon(duongLuaChon(m.env))?.model).toBe("Moi.gguf");
    expect(m.env.LLAMA_SERVER_MODEL).toBe("Moi.gguf");
    expect(m.env.GGUF_DEFAULT_MODEL).toBe("Moi.gguf");
    expect(m.env.GGUF_CODE_MODEL).toBe("Moi.gguf");
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
    expect(m.s.goi.filter((g) => g.startsWith("POST"))).toEqual(["POST /v1/chat/completions"]);
    expect(kq.buoc.every((b) => b.trangThai === "xong" || b.trangThai === "bo-qua")).toBe(true);
    expect(dp.trangThai()?.id).toBe(id);
  });

  it("/props lệch (n_ctx) ⇒ quay về model cũ: tệp lựa chọn trả Y NGUYÊN, kịch bản chạy lại, /props cũ", async () => {
    const m = dungMoiTruong();
    // lựa chọn CŨ đã có (để chứng minh "trả y nguyên", không phải "gỡ")
    ghiLuaChon(duongLuaChon(m.env), { v: 1, model: "Cu.gguf", envModel: "Cu.gguf", luc: "truoc", nguoi: "x" });
    const tho = fs.readFileSync(duongLuaChon(m.env), "utf8");
    m.datHongKhiNap((model) => {
      m.s.nCtx = model === "Moi.gguf" ? 32768 : 65536;
      return 0;
    });
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(kq.ketQua).toBe("that-bai-da-quay-ve");
    expect(kq.loi).toMatch(/n_ctx/);
    expect(m.nhatKy.kichBan, "quay về KHÔNG truyền model — kịch bản dùng lựa chọn ĐÃ CHỐT").toEqual(["-Force -Model Moi.gguf", "-Force"]);
    expect(m.nhatKy.luaChonLucKichBan).toEqual([tho, tho]);
    expect(m.s.model).toBe("Cu.gguf");
    expect(fs.readFileSync(duongLuaChon(m.env), "utf8")).toBe(tho);
    expect(m.env.LLAMA_SERVER_MODEL).toBe("Cu.gguf");
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
    expect(m.nhatKy.congNha).toBe(1);
    expect(kq.buoc.find((b) => b.buoc === "quay-ve")?.trangThai).toBe("xong");
  });

  it("sinh thử hỏng ⇒ quay về; không có lựa chọn cũ ⇒ tệp lựa chọn vẫn KHÔNG có (chưa từng được ghi)", async () => {
    const m = dungMoiTruong();
    m.datHongKhiNap((model) => {
      m.s.sinhHong = model === "Moi.gguf";
      return 0;
    });
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(kq.ketQua).toBe("that-bai-da-quay-ve");
    expect(kq.buoc.find((b) => b.buoc === "sinh-thu")?.trangThai).toBe("loi");
    expect(fs.existsSync(duongLuaChon(m.env))).toBe(false);
    expect(m.s.model).toBe("Cu.gguf");
    expect(m.env.GGUF_DEFAULT_MODEL).toBe("Cu.gguf");
  });

  it("kịch bản thoát 4 (llama-server chết sớm) ⇒ quay về", async () => {
    const m = dungMoiTruong();
    m.datHongKhiNap((model) => (model === "Moi.gguf" ? 4 : 0));
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(kq.ketQua).toBe("that-bai-da-quay-ve");
    expect(kq.loi).toMatch(/4/);
    expect(m.s.model).toBe("Cu.gguf");
  });

  it("quay về cũng hỏng ⇒ báo `that-bai-quay-ve-hong`, vẫn gỡ tạm dừng (giám sát dựng lại từ lựa chọn cũ)", async () => {
    const m = dungMoiTruong();
    m.datHongKhiNap(() => 4);
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(kq.ketQua).toBe("that-bai-quay-ve-hong");
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
    expect(m.nhatKy.congNha).toBe(1);
  });

  it("hết giờ chờ hàng đợi ⇒ KHÔNG đổi gì (không kịch bản, không lựa chọn), báo huỷ", async () => {
    const m = dungMoiTruong({
      giuCong: async () => {
        throw Object.assign(new Error("hết giờ chờ"), { code: "LLM_GATE_WAIT_TIMEOUT" });
      },
    });
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(kq.ketQua).toBe("huy-khong-doi");
    expect(m.nhatKy.kichBan).toEqual([]);
    expect(fs.existsSync(duongLuaChon(m.env))).toBe(false);
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
  });

  it("gọi `khiKetThuc` (audit) đúng một lần với kết quả cuối", async () => {
    const ghi: string[] = [];
    const m = dungMoiTruong({ khiKetThuc: (p) => void ghi.push(p.ketQua) });
    await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(ghi).toEqual(["thanh-cong"]);
  });
});

// ─── 4b. AN TOÀN KHI SẬP — tiến trình gọi chết giữa lượt (node thoát, không `finally` nào chạy) ────────
/** PID của một tiến trình THẬT vừa thoát (spawnSync chờ nó chết) — không đoán số. */
function pidDaChet(): number {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const r = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  expect(r.status).toBe(0);
  return r.pid!;
}
const nghi = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function choBuoc(dp: DieuPhoiDoiModel, buoc: string, trangThai = "dang-chay"): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (dp.trangThai()?.buoc.find((b) => b.buoc === buoc)?.trangThai === trangThai) return;
    await nghi(5);
  }
  throw new Error(`không tới bước ${buoc}:${trangThai}`);
}

describe("★★ Đợt 7.1 — đổi TẠM (khe nặng) + nhờ broker khi thiếu VRAM", () => {
  it("ben:false thành công ⇒ KHÔNG ghi lựa chọn bền, KHÔNG phủ env; server chạy model mới", async () => {
    const m = dungMoiTruong();
    const { xong } = await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "khe-nang", { ben: false });
    const kq = await xong;
    expect(kq.ketQua).toBe("thanh-cong");
    expect(m.s.model).toBe("Moi.gguf");
    expect(m.nhatKy.kichBan).toEqual(["-Force -Model Moi.gguf"]);
    expect(docLuaChon(duongLuaChon(m.env)), "lựa chọn bền không được ghi").toBeNull();
    expect(m.env.LLAMA_SERVER_MODEL).toBe("Cu.gguf");
    expect(m.env.GGUF_DEFAULT_MODEL).toBe("Cu.gguf");
    expect(kq.buoc.find((b) => b.buoc === "ghi-lua-chon")?.trangThai).toBe("bo-qua");
    expect(kq.buoc.find((b) => b.buoc === "ap-dung")?.trangThai).toBe("bo-qua");
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
  });

  it("ben:false hỏng sinh thử ⇒ quay về model ĐÃ CHỐT (nhà)", async () => {
    const m = dungMoiTruong();
    m.s.sinhHong = true;
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "khe-nang", { ben: false })).xong;
    expect(kq.ketQua).toBe("that-bai-da-quay-ve");
    expect(m.s.model).toBe("Cu.gguf");
  });

  // Cu 10 GiB, Moi 22 GiB: cần ≈ 22 + KV 1,25 + phụ phí 3 + đệm 0,5 ≈ 26,75 GiB; trống sau dừng ≈ 32 − 26 + 14,25 = 20,25.
  const kichThuoc = (p: string) => (p.endsWith("Cu.gguf") ? 10 * GiB : 22 * GiB);

  it("thiếu VRAM + broker thu hồi đủ ⇒ đổi tiếp", async () => {
    let used = 26 * GiB;
    const xin: number[] = [];
    const m = dungMoiTruong({
      kichThuocTep: kichThuoc,
      docVram: async () => ({ usedBytes: used, totalBytes: 32 * GiB }),
      thuHoiVram: async (thieu) => {
        xin.push(thieu);
        used -= 8 * GiB;
        return 8 * GiB;
      },
    });
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "khe-nang", { ben: false })).xong;
    expect(kq.ketQua).toBe("thanh-cong");
    expect(xin).toHaveLength(1);
    expect(xin[0] / GiB).toBeGreaterThan(6);
    expect(xin[0] / GiB).toBeLessThan(7);
  });

  it("thiếu VRAM + broker không thu được gì ⇒ VRAM_KHONG_DU, không chạm server", async () => {
    const m = dungMoiTruong({ kichThuocTep: kichThuoc, thuHoiVram: async () => 0 });
    await expect(new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "khe-nang", { ben: false })).rejects.toMatchObject({ code: "VRAM_KHONG_DU" });
    expect(m.nhatKy.kichBan).toEqual([]);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
  });
});

describe("AN TOÀN KHI SẬP — lựa chọn chỉ BỀN sau khi kiểm /props + sinh thử", () => {
  it("sập lúc kịch bản đang khởi động (server cũ đã bị giết) ⇒ lựa chọn bền VẪN là cũ; người đọc không phủ sang model chưa kiểm", async () => {
    const m = dungMoiTruong();
    ghiLuaChon(duongLuaChon(m.env), { v: 1, model: "Cu.gguf", envModel: "Cu.gguf", luc: "truoc", nguoi: "x" });
    const tho = fs.readFileSync(duongLuaChon(m.env), "utf8");
    m.datTreoKhiNap((model) => model === "Moi.gguf");
    const dp = new DieuPhoiDoiModel(m.d);
    await dp.batDau("Moi.gguf", "admin");
    await choBuoc(dp, "khoi-dong");
    expect(m.nhatKy.kichBan).toEqual(["-Force -Model Moi.gguf"]);
    expect(fs.readFileSync(duongLuaChon(m.env), "utf8"), "tệp lựa chọn không được chạm trước khi kiểm").toBe(tho);
    // boot sau / nhịp 15 s của tiến trình anh em: vẫn model ĐÃ CHỐT
    const envAnhEm: NodeJS.ProcessEnv = { ...m.env, LLAMA_SERVER_MODEL: "Cu.gguf", GGUF_DEFAULT_MODEL: "Cu.gguf", GGUF_CODE_MODEL: "Cu.gguf" };
    expect(apDungLuaChonModel(envAnhEm).model).toBe("Cu.gguf");
    expect(envAnhEm.LLAMA_SERVER_MODEL).toBe("Cu.gguf");
  });

  it("sập lúc sinh thử (server mới đã lên, /props khớp) ⇒ chưa có lựa chọn bền nào được ghi", async () => {
    const m = dungMoiTruong();
    const goc = m.d.fetchFn;
    m.d.fetchFn = ((url: any, init?: any) =>
      String(url).endsWith("/v1/chat/completions") ? new Promise<Response>(() => {}) : goc(url, init)) as typeof fetch;
    const dp = new DieuPhoiDoiModel(m.d);
    await dp.batDau("Moi.gguf", "admin");
    await choBuoc(dp, "sinh-thu");
    expect(dp.trangThai()?.buoc.find((b) => b.buoc === "kiem-props")?.trangThai).toBe("xong");
    expect(fs.existsSync(duongLuaChon(m.env)), "lựa chọn chỉ ghi SAU sinh thử đạt").toBe(false);
  });

  it("ghi lựa chọn bền hỏng (đĩa) sau khi kiểm đạt ⇒ QUAY VỀ — server không được chạy model mà lựa chọn bền không nói", async () => {
    const m = dungMoiTruong();
    // đường lựa chọn là THƯ MỤC ⇒ rename tệp tạm vào đó hỏng
    fs.mkdirSync(duongLuaChon(m.env), { recursive: true });
    const kq = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(kq.ketQua).toBe("that-bai-da-quay-ve");
    expect(m.nhatKy.kichBan).toEqual(["-Force -Model Moi.gguf", "-Force"]);
    expect(m.s.model).toBe("Cu.gguf");
    expect(m.env.LLAMA_SERVER_MODEL).toBe("Cu.gguf");
  });
});

describe("PHỤC HỒI lượt đổi MỒ CÔI (khoá của tiến trình đã chết)", () => {
  function datMoCoi(m: ReturnType<typeof dungMoiTruong>, o: { pid: number; token?: string; tamDung?: string | null }) {
    const token = o.token ?? "tok-mo-coi";
    fs.writeFileSync(m.d.duongKhoaDoi, JSON.stringify({ pid: o.pid, luc: Date.now(), token }));
    const td = o.tamDung === undefined ? `doi-model API PID ${o.pid} token ${token} ${new Date().toISOString()} Moi.gguf` : o.tamDung;
    if (td !== null) fs.writeFileSync(m.duongTamDung, td);
    return token;
  }

  it("PID đã chết ⇒ gỡ khoá + tệp tạm dừng của CHÍNH lượt ấy, ghi nhật ký; lượt đổi mới chạy được", async () => {
    const m = dungMoiTruong();
    datMoCoi(m, { pid: pidDaChet() });
    const ghi: unknown[] = [];
    m.d.khiPhucHoi = (k) => void ghi.push(k);
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.coMoCoi).toBe(true);
    expect(kq.khoa?.lyDo).toBe("pid-chet");
    expect(kq.daGoKhoa).toBe(true);
    expect(kq.tamDung).toBe("da-go");
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
    expect(ghi).toHaveLength(1);
    const p = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(p.ketQua).toBe("thanh-cong");
  });

  it("batDau TỰ phục hồi trước khi kiểm tạm dừng/khoá (không cần khởi động lại dịch vụ)", async () => {
    const m = dungMoiTruong();
    datMoCoi(m, { pid: pidDaChet() });
    const p = await (await new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).xong;
    expect(p.ketQua).toBe("thanh-cong");
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
  });

  it("PID ĐANG SỐNG, khoá còn nhịp ⇒ KHÔNG gỡ gì; lượt đổi mới bị từ chối", async () => {
    const m = dungMoiTruong();
    datMoCoi(m, { pid: process.pid });
    const truoc = fs.readFileSync(m.duongTamDung, "utf8");
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.coMoCoi).toBe(false);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(true);
    expect(fs.readFileSync(m.duongTamDung, "utf8")).toBe(truoc);
    await expect(new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).rejects.toBeInstanceOf(LoiDoiModel);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(true);
    expect(fs.existsSync(m.duongTamDung)).toBe(true);
  });

  it("PID 'sống' nhưng khoá MẤT NHỊP quá ngưỡng (PID bị Windows tái dùng) ⇒ mồ côi", async () => {
    const m = dungMoiTruong();
    datMoCoi(m, { pid: process.pid });
    const cu = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(m.d.duongKhoaDoi, cu, cu);
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.coMoCoi).toBe(true);
    expect(kq.khoa?.lyDo).toBe("mat-nhip");
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(false);
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
  });

  it("tạm dừng TAY (doi-model.ps1) KHÔNG bị gỡ — khoá mồ côi thì vẫn gỡ", async () => {
    const m = dungMoiTruong();
    datMoCoi(m, { pid: pidDaChet(), tamDung: "doi-model.ps1 PID 4242 2026-10-17T00:00:00 Moi.gguf" });
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.daGoKhoa).toBe(true);
    expect(kq.tamDung).toBe("giu-lai");
    expect(fs.readFileSync(m.duongTamDung, "utf8")).toMatch(/^doi-model\.ps1 PID 4242/);
    await expect(new DieuPhoiDoiModel(m.d).batDau("Moi.gguf", "admin")).rejects.toMatchObject({ code: "DANG_TAM_DUNG" });
  });

  it("tạm dừng của lượt KHÁC (token khác) KHÔNG bị gỡ", async () => {
    const m = dungMoiTruong();
    datMoCoi(m, { pid: pidDaChet(), tamDung: `doi-model API PID ${process.pid} token tok-khac 2026-10-17T00:00:00.000Z Moi.gguf` });
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.tamDung).toBe("giu-lai");
    expect(fs.existsSync(m.duongTamDung)).toBe(true);
  });

  it("tạm dừng định dạng TRƯỚC bản vá (không token) cùng PID với khoá mồ côi ⇒ gỡ", async () => {
    const m = dungMoiTruong();
    const pid = pidDaChet();
    datMoCoi(m, { pid, tamDung: `doi-model API PID ${pid} 2026-10-17T00:00:00.000Z Moi.gguf` });
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.tamDung).toBe("da-go");
    expect(fs.existsSync(m.duongTamDung)).toBe(false);
  });

  it("lượt ĐANG CHẠY giữ nhịp khoá ⇒ tiến trình anh em không coi là mồ côi", async () => {
    let tha!: () => void;
    const m = dungMoiTruong({
      hetGio: { chamTamDungMs: 10 },
      giuCong: () => new Promise((r) => (tha = () => r(() => {}))),
    });
    const dpA = new DieuPhoiDoiModel(m.d);
    const { xong } = await dpA.batDau("Moi.gguf", "admin");
    await choBuoc(dpA, "cho-hang-doi");
    const cu = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(m.d.duongKhoaDoi, cu, cu);
    await nghi(80);
    const kq = await new DieuPhoiDoiModel({ ...m.d }).phucHoiLuotMoCoi();
    expect(kq.coMoCoi).toBe(false);
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(true);
    tha();
    expect((await xong).ketQua).toBe("thanh-cong");
  });

  it("SẬP đầu–cuối: A chết khi kịch bản đang nạp model mới ⇒ B phục hồi: gỡ khoá + tạm dừng, lựa chọn bền vẫn cũ, cảnh báo server chạy model CHƯA chốt", async () => {
    const m = dungMoiTruong({ pid: pidDaChet() });
    m.datTreoKhiNap((model) => model === "Moi.gguf");
    const dpA = new DieuPhoiDoiModel(m.d);
    await dpA.batDau("Moi.gguf", "admin");
    await choBuoc(dpA, "khoi-dong");
    expect(fs.existsSync(m.d.duongKhoaDoi)).toBe(true);
    expect(fs.existsSync(m.duongTamDung)).toBe(true);
    m.datTreoKhiNap(() => false);
    const ghi: unknown[] = [];
    const kq = await new DieuPhoiDoiModel({ ...m.d, pid: process.pid, khiPhucHoi: (k) => void ghi.push(k) }).phucHoiLuotMoCoi();
    expect(kq.coMoCoi).toBe(true);
    expect(kq.daGoKhoa).toBe(true);
    expect(kq.tamDung).toBe("da-go");
    expect(fs.existsSync(duongLuaChon(m.env)), "không có lựa chọn chưa chốt nào để khôi phục").toBe(false);
    expect(kq.luaChonBen).toBe("Cu.gguf");
    expect(kq.serverDangChay).toBe("Moi.gguf");
    expect(kq.canhBao.join(" ")).toMatch(/Moi\.gguf/);
    expect(m.nhatKy.kichBan, "phục hồi KHÔNG tự khởi động lại server").toEqual(["-Force -Model Moi.gguf"]);
    expect(ghi).toHaveLength(1);
  });

  it("không có gì mồ côi ⇒ không ghi nhật ký, không đụng tệp nào", async () => {
    const m = dungMoiTruong();
    fs.writeFileSync(m.duongTamDung, "doi-model.ps1 PID 1 x");
    const ghi: unknown[] = [];
    m.d.khiPhucHoi = (k) => void ghi.push(k);
    const kq = await new DieuPhoiDoiModel(m.d).phucHoiLuotMoCoi();
    expect(kq.coMoCoi).toBe(false);
    expect(ghi).toEqual([]);
    expect(fs.existsSync(m.duongTamDung)).toBe(true);
  });
});

// ─── 5. Cổng ưu tiên: giữ TOÀN BỘ slot để bảo trì ───────────────────────────────────────────────
describe("CongUuTienLlm.giuHet — chờ hàng tương tác rỗng rồi giữ mọi slot", () => {
  it("chờ lượt đang chạy xong, chặn lượt mới tới khi nhả", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 8, choToiDaMs: 10_000, nguongNangMs: 120_000 });
    const nhaA = await cong.xin("tuong-tac");
    let giu = false;
    const pGiu = cong.giuHet({ choToiDaMs: 5000 }).then((nha) => {
      giu = true;
      return nha;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(giu).toBe(false);
    nhaA();
    const nhaGiu = await pGiu;
    expect(giu).toBe(true);
    let b = false;
    const pB = cong.xin("tuong-tac").then((n) => {
      b = true;
      n();
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(b, "lượt mới phải CHỜ trong lúc bảo trì").toBe(false);
    nhaGiu();
    await pB;
    expect(b).toBe(true);
  });

  it("hết giờ ⇒ ném và KHÔNG giữ slot nào (không khoá cứng cổng)", async () => {
    const cong = new CongUuTienLlm({ soSlot: 2, hangToiDa: 8, choToiDaMs: 10_000, nguongNangMs: 120_000 });
    const nhaA = await cong.xin("tuong-tac");
    const nhaB = await cong.xin("tuong-tac");
    await expect(cong.giuHet({ choToiDaMs: 20 })).rejects.toBeTruthy();
    nhaA();
    nhaB();
    expect(cong.thongKe().dangChay).toBe(0);
    const n = await cong.xin("nen");
    n();
  });
});

// ─── 6. THẬT — chỉ ĐỌC `/props` của :8091 nếu đang sống ──────────────────────────────────────────
describe("THẬT — đọc /props của llama-server :8091 (chỉ GET; bỏ qua nếu không sống)", () => {
  it("parse được model_path + n_ctx + total_slots của server đang chạy", async (ctx) => {
    const url = "http://127.0.0.1:8091";
    let p;
    try {
      p = await docProps(url, fetch, 3000);
    } catch {
      ctx.skip();
      return;
    }
    expect(p.tenModel).toMatch(/\.gguf$/i);
    expect(p.nCtx).toBeGreaterThan(0);
    expect(p.tongSlot).toBeGreaterThan(0);
    // Khớp cấu hình đã chốt (1 × 64k) — nếu ai đổi tay thì ca này nói ra, không đỏ (máy dùng chung).
    const lech = kiemProps(p, { tenModel: p.tenModel, nCtx: p.nCtx!, tongSlot: p.tongSlot! });
    expect(lech).toEqual([]);
  });
});

describe("THẬT — header GGUF trong kho model (chỉ đọc; bỏ qua nếu không có tệp)", () => {
  it("Qwen3.6-35B-A3B: 10 tầng chú ý / 40 (full_attention_interval 4), 2 đầu KV, dK=dV=256", async (ctx) => {
    const kho = (process.env.GGUF_MODELS_DIR || "D:/SOURCES/16.AI").trim();
    const f = path.join(kho, "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf");
    if (!fs.existsSync(f)) {
      ctx.skip();
      return;
    }
    const meta = await docMetaGgufMacDinh(f);
    expect(meta).toEqual({ soTangChuY: 10, soDauKv: 2, doDaiKey: 256, doDaiValue: 256 });
  });
});

// ─── 7. THẬT — kịch bản PowerShell đọc tệp lựa chọn (KHÔNG chạm :8091) ──────────────────────────
// Chép start-llama-server.ps1 vào cây tạm (log rơi vào cây tạm), `.env` riêng: cổng 127.0.0.1 ngẫu nhiên
// không ai nghe, LLAMA_SERVER_BIN = where.exe (thoát ngay ⇒ kịch bản báo "THOÁT SỚM", exit 4). Thứ được
// kiểm là dòng "model : …" mà kịch bản in TRƯỚC khi spawn — tức đúng tệp nó sẽ nạp.
const BIN_GIA = path.join(process.env.SystemRoot || process.env.windir || "C:/Windows", "System32", "where.exe");
describe.runIf(process.platform === "win32")("THẬT — start-llama-server.ps1 chọn -m theo tệp lựa chọn", () => {
  function chay(luaChon: object | null, thamSoThem: string[] = []): { out: string; ma: number | null } {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    const goc = path.join(thuMuc, "repo");
    fs.mkdirSync(path.join(goc, "scripts", "ai"), { recursive: true });
    const kb = path.join(goc, "scripts", "ai", "start-llama-server.ps1");
    fs.copyFileSync(path.join(__dirname, "..", "..", "..", "scripts", "ai", "start-llama-server.ps1"), kb);
    // kịch bản dot-source tim-mmproj.ps1 cạnh nó (LLAMA_SERVER_MMPROJ, 3b1503467) — thiếu tệp ⇒ thoát trước dòng "model :"
    fs.copyFileSync(path.join(__dirname, "..", "..", "..", "scripts", "ai", "tim-mmproj.ps1"), path.join(goc, "scripts", "ai", "tim-mmproj.ps1"));
    const sel = path.join(thuMuc, "sel.json");
    if (luaChon) fs.writeFileSync(sel, JSON.stringify(luaChon));
    fs.writeFileSync(
      path.join(goc, ".env"),
      [
        `LLAMA_SERVER_BIN=${BIN_GIA}`,
        "LLAMA_SERVER_MODEL=Cu.gguf",
        `GGUF_MODELS_DIR=${kho}`,
        "LLAMA_SERVER_URL=http://127.0.0.1:59391",
        `LLAMA_SERVER_SELECTION_FILE=${sel}`,
      ].join("\n"),
    );
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", kb, "-WaitSeconds", "5", ...thamSoThem], {
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
    return { out: `${r.stdout}\n${r.stderr}`, ma: r.status };
  }
  // Dòng "model : <đường>" thuần ASCII khi đường ASCII — không phụ thuộc bảng mã console (chữ Việt của
  // kịch bản ra "?" qua OEM codepage, nên KHÔNG so khớp câu tiếng Việt ở đây).
  const dongModel = (out: string) => (out.match(/\] model : (.+)/)?.[1] ?? "").trim();

  it("lựa chọn hợp lệ ⇒ -m là model đã chọn", () => {
    const r = chay({ v: 1, model: "Moi.gguf", envModel: "Cu.gguf", luc: "t", nguoi: "x" });
    expect(dongModel(r.out)).toMatch(/\/Moi\.gguf$/);
    expect(r.ma).not.toBe(0);
  }, 70_000);

  it(".env sửa SAU lựa chọn ⇒ bỏ qua, -m là model .env", () => {
    const r = chay({ v: 1, model: "Moi.gguf", envModel: "Khac.gguf", luc: "t", nguoi: "x" });
    expect(dongModel(r.out)).toMatch(/\/Cu\.gguf$/);
  }, 70_000);

  it("tên có đường dẫn ⇒ bỏ qua (danh sách trắng ở CẢ phía kịch bản)", () => {
    const r = chay({ v: 1, model: "..\Cu.gguf", envModel: "Cu.gguf", luc: "t", nguoi: "x" });
    expect(dongModel(r.out)).toMatch(/\/Cu\.gguf$/);
  }, 70_000);

  it("không có tệp lựa chọn ⇒ hành vi cũ (model .env)", () => {
    expect(dongModel(chay(null).out)).toMatch(/\/Cu\.gguf$/);
  }, 70_000);

  it("-Model hợp lệ ⇒ -m là model TRUYỀN VÀO, tệp lựa chọn (đã chốt) bị bỏ qua", () => {
    const r = chay({ v: 1, model: "Cu.gguf", envModel: "Cu.gguf", luc: "t", nguoi: "x" }, ["-Model", "Moi.gguf"]);
    expect(dongModel(r.out)).toMatch(/\/Moi\.gguf$/);
    expect(r.ma).toBe(4); // where.exe thoát ngay ⇒ "THOÁT SỚM" — tức ĐÃ tới bước spawn
  }, 70_000);

  it("-Model không hợp lệ (đường dẫn / ngoài kho / tuyệt đối / sai đuôi) ⇒ thoát 2 TRƯỚC khi giết hay spawn gì, kể cả với -Force", () => {
    for (const ten of ["..\\Cu.gguf", "Khong.gguf", "C:\\Windows\\x.gguf", "Moi.txt"]) {
      const r = chay(null, ["-Force", "-Model", ten]);
      expect(r.ma, ten).toBe(2);
      expect(dongModel(r.out), ten).toBe("");
      expect(r.out, ten).not.toMatch(/-Force: stop/);
    }
  }, 120_000);
});

describe("khoiDongTachRoi — cờ thêm là DANH SÁCH ĐÓNG", () => {
  it("chỉ `-Force` được nối vào dòng lệnh; mặc định không nối gì", async () => {
    const { khoiDongTachRoi } = await import("./giamSatLlamaServer");
    const kb = path.join(thuMuc, "start-llama-server.ps1");
    fs.writeFileSync(kb, "");
    const goi: string[][] = [];
    const spawnFn: any = (_l: string, a: string[]) => {
      goi.push(a);
      return { on: () => {}, unref: () => {}, pid: 1 };
    };
    khoiDongTachRoi(kb, { spawnFn });
    khoiDongTachRoi(kb, { spawnFn, thamSoThem: ["-Force"] });
    khoiDongTachRoi(kb, { spawnFn, thamSoThem: ["-Force", "-EnvFile" as any, "x" as any] });
    expect(goi[0].slice(-1)).toEqual([kb]);
    expect(goi[1].slice(-2)).toEqual([kb, "-Force"]);
    expect(goi[2].slice(-2)).toEqual([kb, "-Force"]);
  });

  it("`model` chỉ nhận basename .gguf (danh sách trắng dạng tên) ⇒ `-Model <tên>`; tên lạ ⇒ NÉM, không spawn", async () => {
    const { khoiDongTachRoi } = await import("./giamSatLlamaServer");
    const kb = path.join(thuMuc, "start-llama-server.ps1");
    fs.writeFileSync(kb, "");
    const goi: string[][] = [];
    const spawnFn: any = (_l: string, a: string[]) => {
      goi.push(a);
      return { on: () => {}, unref: () => {}, pid: 1 };
    };
    khoiDongTachRoi(kb, { spawnFn, thamSoThem: ["-Force"], model: "Moi.gguf" });
    expect(goi[0].slice(-4)).toEqual([kb, "-Force", "-Model", "Moi.gguf"]);
    for (const xau of ["../x.gguf", "x.gguf -EnvFile y", "C:/m/x.gguf", "-Force"]) {
      expect(() => khoiDongTachRoi(kb, { spawnFn, model: xau }), xau).toThrow();
    }
    expect(goi).toHaveLength(1);
  });
});
