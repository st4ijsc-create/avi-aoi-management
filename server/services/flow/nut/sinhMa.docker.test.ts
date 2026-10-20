/**
 * ★★ Luồng AI Đợt 8.4 — node `ai.sinh-ma` + `lib/bienDichST.ts`. Phần thuần (trích khối mã, chẩn đoán, cờ docker, khai báo,
 * bất biến "không đường tải xuống thiết bị") luôn chạy; phần biên dịch THẬT cần ảnh `st-rusty:1.0.7` — vắng ⇒ BỎ QUA có
 * thông báo. Model luôn GIẢ (`datHamGoiAi`) — không chạm llama-server.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { layNut, type NguCanhChay } from "../dangKyNut";
import { ANH_ST, bienDichST, coAnhST, coDockerST, phanTichChanDoanST } from "../lib/bienDichST";
import { datHamGoiAi, type HamGoiAi } from "./ai";
import { chanDoanChoModel, trichKhoiMa } from "./sinhMa";
import "./index";

const THU_MUC = dirname(fileURLToPath(import.meta.url));
const CO_ANH = await coAnhST().catch(() => false);
if (!CO_ANH) console.warn(`[sinhMa.docker.test] BỎ QUA phần Docker: ảnh ${ANH_ST} chưa có (dựng theo scripts/ai-eval/ngau-nhien/lib/st/Dockerfile).`);

const ST_DUNG = `FUNCTION_BLOCK DenBao
VAR_INPUT
  Start : BOOL;
  Stop : BOOL;
END_VAR
VAR_OUTPUT
  Q : BOOL;
END_VAR
VAR
  t : TON;
END_VAR
Q := (Start OR Q) AND NOT Stop;
t(IN := Q, PT := T#5s);
END_FUNCTION_BLOCK`;
/** Thiếu dấu chấm phẩy (lỗi cú pháp) ở dòng 12. */
const ST_LOI_CU_PHAP = ST_DUNG.replace("AND NOT Stop;", "AND NOT Stop");
const ST_LOI_THAM_CHIEU = ST_DUNG.replace("AND NOT Stop;", "AND NOT Stopp;");

const ngu = (main: { json: Record<string, unknown> }[]): NguCanhChay => ({
  runId: "r", flowId: "f", nodeId: "n", lan: 1, idempotencyKey: "r:n:1", inputs: { main }, nodes: {}, env: {}, run: { id: "r", flowId: "f", batDau: "x" },
});

let cu: HamGoiAi | null = null;
afterEach(() => {
  if (cu) datHamGoiAi(cu);
  cu = null;
});

describe("ai.sinh-ma — phần thuần", () => {
  it("trích khối mã: rào dài nhất, bỏ nhãn ngôn ngữ, bỏ <think>; không rào ⇒ cả chữ", () => {
    expect(trichKhoiMa("<think>```st\nSAI\n```</think>Đây:\n```st\nA := 1;\nB := 2;\n```\n```\nX\n```")).toBe("A := 1;\nB := 2;");
    expect(trichKhoiMa("  PROGRAM P END_PROGRAM ")).toBe("PROGRAM P END_PROGRAM");
  });

  it("chẩn đoán clang ⇒ cấu trúc; bỏ thư viện chuẩn; tên tệp hiển thị `ma.st`; chữ cho model chỉ lỗi", () => {
    const log = [
      "/w/10-ma.st:12:27:{12:27-12:32}: error[E048]: Could not resolve reference to Stopp",
      "/usr/share/plc/include/x.st:1:1: warning[E001]: noise",
      "/w/10-ma.st:3:1: warning[E090]: unused",
      "error: Compilation aborted due to critical errors",
    ].join("\n");
    const d = phanTichChanDoanST(log);
    expect(d).toEqual([
      { tep: "ma.st", dong: 12, cot: 27, mucDo: "error", ma: "E048", thongDiep: "Could not resolve reference to Stopp" },
      { tep: "ma.st", dong: 3, cot: 1, mucDo: "warning", ma: "E090", thongDiep: "unused" },
    ]);
    expect(chanDoanChoModel(d)).toBe("ma.st:12:27 error[E048]: Could not resolve reference to Stopp");
  });

  it("cờ docker: không mạng, rootfs chỉ đọc, bỏ capability, CHỈ gắn thư mục việc; kịch bản chỉ biên dịch (-c, không chạy)", () => {
    const a = coDockerST("ten", "C:\\tmp\\viec");
    const s = a.join(" ");
    for (const c of ["--rm", "--pull never", "--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--memory 512m", "--pids-limit 128"]) expect(s).toContain(c);
    expect(a.filter((x) => x === "-v")).toHaveLength(1);
    expect(a[a.indexOf("-v") + 1]).toBe("C:\\tmp\\viec:/w");
    expect(a).not.toContain("--privileged");
    expect(a).not.toContain("--gpus");
    const kb = readFileSync(join(THU_MUC, "../lib/bien-dich-job.sh"), "utf8");
    expect(kb).toMatch(/plc \/w\/\*\.st "\$\{INC\[@\]\}" -c /);
    expect(kb).not.toMatch(/\/tmp\/prog\b|run\.out|\.\/|\$\(cat/); // không bước chạy
  });

  it("khai báo thuan/idempotent; tệp node KHÔNG nhập đường OT/kỹ thuật/tải xuống thiết bị", () => {
    expect(layNut("ai.sinh-ma")).toMatchObject({ tacDungPhu: "thuan", lapLai: "idempotent", congVao: ["main"], congRa: ["main"] });
    for (const f of ["./sinhMa.ts", "../lib/bienDichST.ts"]) {
      const src = readFileSync(join(THU_MUC, f), "utf8");
      const imports = [...src.matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
      expect(imports.filter((i) => /plc|machine|engineering|ot|deploy|download|taiXuong|controlGate|proposeAction|modbus|opcua|mqtt/i.test(i)), f).toEqual([]);
    }
  });
});

describe.skipIf(!CO_ANH)("ai.sinh-ma — RuSTy THẬT (Docker)", () => {
  it("bienDichST: mã đúng ⇒ ok; thiếu ';' ⇒ lỗi cú pháp có dòng; tham chiếu sai ⇒ E048 dòng 12", async () => {
    expect(await bienDichST(ST_DUNG)).toMatchObject({ ok: true });
    const a = await bienDichST(ST_LOI_CU_PHAP);
    expect(a.ok).toBe(false);
    expect(a.chanDoan.some((d) => d.mucDo === "error" && d.tep === "ma.st" && typeof d.dong === "number")).toBe(true);
    const b = await bienDichST(ST_LOI_THAM_CHIEU);
    expect(b.ok).toBe(false);
    expect(b.chanDoan).toContainEqual(expect.objectContaining({ tep: "ma.st", dong: 12, ma: "E048" }));
  }, 60_000);

  it("ảnh thiếu ⇒ LoiBienDichST 'thieu-anh' (không lùi đường khác)", async () => {
    await expect(bienDichST(ST_DUNG, { anh: "st-rusty:0.0.0-khong-co" })).rejects.toMatchObject({ loai: "thieu-anh" });
  }, 30_000);

  it("vòng sửa: lần 1 lỗi cú pháp ⇒ lỗi có cấu trúc gửi lại model ⇒ lần 2 đúng ⇒ bienDich ok, soVong 2", async () => {
    const goi: { vaiTro: string; nguoiDung: string }[] = [];
    cu = datHamGoiAi(async ({ vaiTro, nguoiDung }) => {
      goi.push({ vaiTro, nguoiDung });
      return "```st\n" + (goi.length === 1 ? ST_LOI_CU_PHAP : ST_DUNG) + "\n```";
    });
    const r = (await layNut("ai.sinh-ma")!.chay({ ngonNgu: "st", moTa: "{{ $json.moTa }}", soVongSua: 2 }, ngu([{ json: { moTa: "Đèn báo tự giữ" } }]))) as { main: { json: Record<string, unknown> }[] };
    const j = r.main[0].json as { ma: string; ngonNgu: string; bienDich: { ok: boolean; soVong: number; chanDoan: unknown[] } };
    expect(j).toMatchObject({ moTa: "Đèn báo tự giữ", ngonNgu: "st", ma: ST_DUNG, bienDich: { ok: true, soVong: 2 } });
    expect(goi.map((g) => g.vaiTro)).toEqual(["code.plc", "code.plc"]);
    expect(goi[1].nguoiDung).toMatch(/ma\.st:\d+:\d+ error/);
    expect(goi[1].nguoiDung).toContain(" 12| ");
  }, 90_000);

  it("hết vòng sửa vẫn lỗi ⇒ ok:false + chẩn đoán (không ném); soVongSua 0 ⇒ đúng 1 lần gọi; tràn trần 3", async () => {
    let n = 0;
    cu = datHamGoiAi(async () => {
      n++;
      return "```st\n" + ST_LOI_THAM_CHIEU + "\n```";
    });
    const nut = layNut("ai.sinh-ma")!;
    const r = (await nut.chay({ moTa: "x", soVongSua: 0 }, ngu([{ json: {} }]))) as { main: { json: { bienDich: { ok: boolean; soVong: number; chanDoan: unknown[] } } }[] };
    expect(r.main[0].json.bienDich).toMatchObject({ ok: false, soVong: 1 });
    expect(r.main[0].json.bienDich.chanDoan.length).toBeGreaterThan(0);
    expect(n).toBe(1);
    n = 0;
    await nut.chay({ moTa: "x", soVongSua: 99 }, ngu([{ json: {} }]));
    expect(n).toBe(4); // 1 + trần 3
  }, 120_000);
});

describe("ai.sinh-ma — không kiểm biên dịch", () => {
  it("ngonNgu khac ⇒ vai trò code.software, một lần gọi, bienDich null (không chạm Docker)", async () => {
    const goi: string[] = [];
    cu = datHamGoiAi(async ({ vaiTro }) => {
      goi.push(vaiTro);
      return "```python\nprint(1)\n```";
    });
    const r = (await layNut("ai.sinh-ma")!.chay({ ngonNgu: "khac", moTa: "in số 1" }, ngu([{ json: {} }]))) as { main: { json: Record<string, unknown> }[] };
    expect(r.main[0].json).toMatchObject({ ma: "print(1)", ngonNgu: "khac", bienDich: null });
    expect(goi).toEqual(["code.software"]);
  });
});
