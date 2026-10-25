/**
 * ★★★ SCADA R1b-1 Task 13 — CENSUS "AI DỰA VÀO VIỆC DRIVER LÀM TRÒN?" + lưới thô cho MỌI tag int ở cổng kênh sớm của `dispatch()`.
 *
 * Bối cảnh (kiem-dinh P1-3, R1a): driver ghi `raw = Math.round((v − offset) / scale)` cho tag int (`drivers/otScale.inverseScale`) ⇒ tag int
 * scale 10, ghi 25 ⇒ thiết bị nhận raw 3 = 30, IM LẶNG. R1a đã từ chối cho tag ĐÃ khai; T13 từ chối cho tag CHƯA khai (cột 0431 NULL) sau khi
 * census (báo cáo task-13-report.md) đo: KHÔNG bên gọi nào / dữ liệu nào dựa vào việc làm tròn.
 *
 *   (A) CENSUS NGƯỜI GỌI — ∀ tệp sản xuất dưới `server/**` (AST, không tính chú thích/chuỗi): tệp nào LẤY được `dispatch` của
 *       `ot/commandDispatcher` — import specifier `dispatch`, destructuring `{ dispatch }` (vd. `await import(...)`), hoặc truy cập thuộc tính
 *       `.dispatch` (vd. `deps.dispatch(...)`) trong một tệp import commandDispatcher (kể cả `import type`). Tập phải BẰNG `NGUOI_GOI` — mỗi mục
 *       ghi nguồn giá trị và vì sao nó KHÔNG dựa vào làm tròn. Người gọi thứ N+1 ⇒ ĐỎ ⇒ người thêm phải xếp nó vào bảng (và nếu nó cần làm
 *       tròn thì đó là việc của điều phối, không phải của driver). Bộ quét tự kiểm bằng đột biến trên mã tổng hợp.
 *   (B) `congKenhSom` THUẦN — tag int CHƯA khai scale 10: 25 ⇒ OFF_STEP (buoc 10, goiY 30, appError SCADA_VALUE_OFF_STEP); 30 ⇒ ok, ĐÚNG
 *       đối tượng write của người gọi (không ép kiểu); STOP khớp ghim lệch lưới ⇒ miễn (STOP không bao giờ bị chặn); scale 1 ⇒ hành vi cũ.
 *   (C) Cấu hình ↔ chạy: giá trị lệnh interlock nhắm tag int CHƯA khai có scale ⇒ cùng lưới thô (`kiemLenhInterlockTrenKenh`), để hành động
 *       bảo vệ không bị OFF_STEP đúng lúc cần; R1b-2a T2 (m4): ghim DỪNG trên tag chưa khai cũng kiểm lưới thô LÚC ĐẶT (miễn lúc chạy giữ nguyên).
 * Không DB, không dữ liệu đo (số đo ở báo cáo — tất định).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { appErrorLechBuoc, congKenhSom, type TagCongKenh } from "./commandDispatcher";
import { kiemLenhInterlockTrenKenh, kiemNhatQuanKenh, thamSoNgoaiDaiInterlock, viPhamInterlock } from "../scada/nhatQuanKenh";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = (p: string) => relative(GOC, p).split(sep).join("/");
const DISPATCHER = "server/services/ot/commandDispatcher";

function moiTep(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiTep(p, ra);
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.endsWith(".d.ts") && !/\.testkit\.ts$/.test(ten)) ra.push(p);
  }
  return ra;
}

/** (A) Tệp `tepRel` (mã `src`) có import commandDispatcher VÀ lấy được `dispatch` của nó không. Thuần trên AST. */
export function layDispatch(tepRel: string, src: string): boolean {
  const sf = ts.createSourceFile(tepRel, src, ts.ScriptTarget.Latest, true);
  let nhap = false;
  let lay = false;
  const laDispatcher = (spec: ts.Expression | undefined) => {
    if (!spec || !ts.isStringLiteralLike(spec)) return false;
    const s = spec.text;
    const dich = s.startsWith(".") ? rel(resolve(GOC, dirname(tepRel), s)).replace(/\.(ts|js)$/, "") : s;
    return dich === DISPATCHER;
  };
  const di = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && laDispatcher(n.moduleSpecifier)) nhap = true;
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) && laDispatcher(n.arguments[0])) {
      nhap = true;
    }
    if ((ts.isImportSpecifier(n) || ts.isExportSpecifier(n)) && (n.propertyName ?? n.name).text === "dispatch") lay = true;
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const ten = n.propertyName ?? n.name;
      if (ts.isIdentifier(ten) && ten.text === "dispatch") lay = true;
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === "dispatch") lay = true;
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === "dispatch") lay = true;
    ts.forEachChild(n, di);
  };
  di(sf);
  return nhap && lay;
}

/**
 * BẢNG CENSUS (đo 2026-10-24, báo cáo T13 §1). Nguồn giá trị ⇒ vì sao KHÔNG dựa vào làm tròn. Đổi bảng = đọc lại báo cáo T13.
 */
const NGUOI_GOI: Record<string, string> = {
  "server/services/aiLocalTools/writeHandlers/machineControl.ts":
    "AI set_machine_param (giá trị model đề xuất, NGƯỜI xác nhận đúng số đó — làm tròn = ghi khác số đã xác nhận) + start/stop/reset/alarm_ack (true), select_recipe (version nguyên / mã chuỗi), download_job (jobId), STOP ghim (stop_value).",
  "server/services/aiLocalTools/writeHandlers/visionControl.ts":
    "AI thị giác: reject_divert (lane nguyên | true), spi_printer_offset (µm; R1b-2a T1: qualityControlProposer làm tròn theo LƯỚI GHI của tag printer_offset_x/y thật — lamTronTheoLuoiTag; chưa đọc được lưới ⇒ 0,1 + cổng kênh dispatch là trọng tài).",
  "server/services/equipment/equipmentAdapter.ts":
    "FOE bước command (args.writes do kỹ sư soạn trong workflow; TEST: 87 write, giá trị 7/0/1/true, không tag scale ≠ 1) + REST v1 (lệnh OT ⇒ 501 từ R1b-1 T5; chỉ robot).",
  "server/services/interlock/interlockEngine.ts":
    "luật interlock: rule.commandValue ?? true (cấu hình; T13 kiểm cùng lưới thô LÚC CẤU HÌNH — kiemLenhInterlockTrenKenh; TEST: 0 luật nhắm tag scale ≠ 1).",
  "server/services/ot/adapterFacade.ts":
    "UNS lệnh canonical tag.write (args.value); KHÔNG có người gọi sản xuất của executeCommand (chỉ getSafetyStatus được dùng).",
  "server/services/programming/mitsubishi/mitsubishiEngineeringAdapter.ts":
    "MELSEC recipe_param_push: bảng tham số kỹ sư soạn (chuỗi), sau cổng DPC_DEPLOY_ENABLED + ký HITL; không thiết kế nào gửi giá trị lệch lưới.",
  "server/services/scada/lenhHmi.ts":
    "HMI write_tag (đã kiểm lưới thô cho MỌI tag ở request/confirm từ P1-3) + HMI STOP (giá trị ghim).",
  "server/services/uns/sparkplugCommand.ts":
    "Sparkplug DCMD: metric.value, requireBoundAction (giá trị phải băm khớp một hành động người đã xác nhận); DBIRTH khai tag int là Int64 ⇒ client gửi số nguyên kỹ thuật.",
  "server/services/unsPublisher.ts": "nối Sparkplug DCMD: truyền `dispatch` vào sparkplugCommand (cùng nguồn giá trị ở trên).",
};

describe("T13 (A) — census người gọi dispatch(): ∀ tệp sản xuất lấy `dispatch` của commandDispatcher ∈ bảng (nguồn giá trị đã xếp loại)", () => {
  it("tập ĐO bằng đúng bảng — người gọi mới ⇒ đỏ cho tới khi được xếp loại; mục bảng không còn gọi ⇒ đỏ (bảng phải nói thật)", () => {
    const thay: string[] = [];
    for (const p of moiTep(join(GOC, "server"))) {
      const r = rel(p);
      if (r === `${DISPATCHER}.ts`) continue;
      const src = readFileSync(p, "utf8");
      if (!src.includes("commandDispatcher")) continue;
      if (layDispatch(r, src)) thay.push(r);
    }
    expect(thay.sort()).toEqual(Object.keys(NGUOI_GOI).sort());
  });

  it("đột biến bộ quét: mỗi dạng lấy `dispatch` đều bị bắt; import không lấy dispatch / biến cục bộ tên dispatch thì không", () => {
    const T = "server/services/x/y.ts";
    expect(layDispatch(T, `import { dispatch } from "../ot/commandDispatcher";`)).toBe(true);
    expect(layDispatch(T, `import { dispatch as d } from "../ot/commandDispatcher"; d();`)).toBe(true);
    expect(layDispatch(T, `async function f(){ const { dispatch } = await import("../ot/commandDispatcher"); }`)).toBe(true);
    expect(layDispatch(T, `async function f(){ const m = await import("../ot/commandDispatcher"); m.dispatch(); }`)).toBe(true);
    expect(layDispatch(T, `async function f(){ const m = await import("../ot/commandDispatcher"); m["dispatch"](); }`)).toBe(true);
    expect(layDispatch(T, `import type { DispatchInput } from "../ot/commandDispatcher"; class C { deps: any; f(){ this.deps.dispatch(1); } }`)).toBe(true);
    expect(layDispatch(T, `import { isOtControlEnabled } from "../ot/commandDispatcher";`)).toBe(false);
    expect(layDispatch(T, `import { isStopCommandType } from "../ot/commandDispatcher"; const dispatch = 1; const o = { ...{ dispatch } };`)).toBe(false);
    expect(layDispatch(T, `import { dispatch } from "../ot/khac";`)).toBe(false);
    expect(layDispatch(T, `// import { dispatch } from "../ot/commandDispatcher"\nconst s = "dispatch";`)).toBe(false);
  });
});

// ─── (B) congKenhSom thuần ───────────────────────────────────────────────────────────────────────────────────────────────────────

const tag = (o: Partial<TagCongKenh> & { tagKey: string }): TagCongKenh => ({
  address: `A-${o.tagKey}`,
  dataType: "int",
  writable: true,
  isEnabled: true,
  stopValue: null,
  channelKind: null,
  writeMin: null,
  writeMax: null,
  writeStep: null,
  scale: "10.000000",
  offset: "0.000000",
  ...o,
});

describe("T13 (B) — congKenhSom: tag int CHƯA khai có scale/offset ⇒ lưới thô, giá trị không bị ép kiểu, STOP ghim miễn", () => {
  const sc10 = tag({ tagKey: "sc10cu" });

  it("25 ⇒ OFF_STEP, buoc 10, goiY 30, chi tiết mang (goiY=30); appErrorLechBuoc ⇒ SCADA_VALUE_OFF_STEP {ma, tagKey, step, goiY}", () => {
    const kq = congKenhSom("set_param", [{ tagKey: "sc10cu", value: 25 }], [sc10]);
    expect(kq).toMatchObject({ ok: false, ma: "OFF_STEP", tagKey: "sc10cu", address: "A-sc10cu", buoc: 10, goiY: 30 });
    expect(kq.ok ? "" : kq.chiTiet).toMatch(/^Tag "sc10cu": .*\(goiY=30\)$/);
    expect(appErrorLechBuoc(kq)).toEqual({ appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "sc10cu", step: 10, goiY: 30 } });
  });

  it("30 ⇒ ok và write là ĐÚNG đối tượng người gọi (tag chưa khai không ép kiểu — `\"30\"` vẫn là chuỗi)", () => {
    const w30 = { tagKey: "sc10cu", value: 30 };
    const kq = congKenhSom("set_param", [w30], [sc10]);
    expect(kq.ok && kq.writes[0]).toBe(w30);
    const ws = { tagKey: "sc10cu", value: "30" };
    const kq2 = congKenhSom("set_param", [ws], [sc10]);
    expect(kq2.ok && kq2.writes[0]).toBe(ws);
  });

  it("nhiều write: tag đầu hợp lệ, tag CHƯA khai sau lệch lưới ⇒ từ chối trên tag vi phạm (thứ tự write)", () => {
    const kq = congKenhSom("set_param", [{ tagKey: "a", value: 7 }, { tagKey: "sc10cu", value: 25 }], [tag({ tagKey: "a", scale: "1", offset: "0" }), sc10]);
    expect(kq).toMatchObject({ ok: false, ma: "OFF_STEP", tagKey: "sc10cu" });
  });

  it("STOP khớp ghim LỆCH LƯỚI (stop_value 25) ⇒ miễn (STOP không bao giờ bị chặn); STOP giá trị khác ghim ⇒ OFF_STEP như mọi lệnh", () => {
    const ghim = tag({ tagKey: "sc10cu", stopValue: 25 });
    expect(congKenhSom("stop", [{ tagKey: "sc10cu", value: 25 }], [ghim]).ok).toBe(true);
    expect(congKenhSom("stop", [{ tagKey: "sc10cu", value: 24 }], [ghim])).toMatchObject({ ok: false, ma: "OFF_STEP" });
    expect(congKenhSom("set_param", [{ tagKey: "sc10cu", value: 25 }], [ghim])).toMatchObject({ ok: false, ma: "OFF_STEP" }); // không phải lệnh dừng
  });

  it("scale 1 / offset 0 (kể cả NULL), float, bool ⇒ hành vi cũ: không kiểm (đi nguyên)", () => {
    for (const t of [tag({ tagKey: "k", scale: "1", offset: "0" }), tag({ tagKey: "k", scale: null, offset: null }), tag({ tagKey: "k", dataType: "float" }), tag({ tagKey: "k", dataType: "bool" })]) {
      const w = { tagKey: "k", value: 25 };
      const kq = congKenhSom("set_param", [w], [t]);
      expect(kq.ok && kq.writes[0]).toBe(w);
    }
  });

  it("tag ĐÃ khai (P1-3) không đổi: 25 ⇒ OFF_STEP goiY 30; 30 ⇒ ok", () => {
    const k = tag({ tagKey: "sc10", writeMin: 0, writeMax: 300 });
    expect(congKenhSom("set_param", [{ tagKey: "sc10", value: 25 }], [k])).toMatchObject({ ok: false, ma: "OFF_STEP", goiY: 30, buoc: 10 });
    expect(congKenhSom("set_param", [{ tagKey: "sc10", value: 30 }], [k]).ok).toBe(true);
  });

  it("appErrorLechBuoc: không goiY ⇒ _NO_HINT; mã khác / ok ⇒ undefined", () => {
    expect(appErrorLechBuoc({ ok: false, ma: "OFF_STEP", chiTiet: "x", tagKey: "t", address: "a", buoc: 0.5 })).toEqual({
      appCode: "SCADA_VALUE_OFF_STEP_NO_HINT",
      appParams: { ma: "OFF_STEP", tagKey: "t", step: 0.5 },
    });
    expect(appErrorLechBuoc({ ok: false, ma: "OUT_OF_RANGE", chiTiet: "x", tagKey: "t", address: "a" })).toBeUndefined();
    expect(appErrorLechBuoc({ ok: true, writes: [] })).toBeUndefined();
  });
});

// ─── (C) cấu hình ↔ chạy ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("T13 (C) — lúc cấu hình: lệnh interlock nhắm tag int CHƯA khai có scale ⇒ cùng lưới thô với dispatch; R1b-2a T2: ghim DỪNG cũng vậy", () => {
  const chuaKhai = { dataType: "int" as const, channelKind: null, writable: true, writeMin: null, writeMax: null, writeStep: null, scale: "10", offset: "0" };

  it("kiemLenhInterlockTrenKenh: 25 ⇒ OFF_STEP; 30 ⇒ ok; true (luật không khai giá trị) ⇒ OFF_STEP (driver ghi raw 0)", () => {
    expect(kiemLenhInterlockTrenKenh(chuaKhai, 25)).toMatchObject({ ok: false, ma: "OFF_STEP" });
    expect(kiemLenhInterlockTrenKenh(chuaKhai, 30)).toEqual({ ok: true });
    expect(kiemLenhInterlockTrenKenh(chuaKhai, true)).toMatchObject({ ok: false, ma: "OFF_STEP" });
    expect(kiemLenhInterlockTrenKenh({ ...chuaKhai, scale: "1" }, 25)).toEqual({ ok: true });
  });

  it("viPhamInterlock: luật BẬT có ghi lệnh, giá trị lệch lưới ⇒ vi phạm; luật tắt / alert ⇒ không", () => {
    const luat = (o: Partial<{ enabled: boolean; action: string; commandValue: unknown }>) => ({ id: 1, name: "r", action: "reduce_speed", enabled: true, commandValue: 25, ...o });
    expect(viPhamInterlock([luat({})], chuaKhai)).toMatchObject({ ruleId: 1, ma: "OFF_STEP" });
    expect(viPhamInterlock([luat({ enabled: false })], chuaKhai)).toBeNull();
    expect(viPhamInterlock([luat({ action: "alert" })], chuaKhai)).toBeNull();
    expect(viPhamInterlock([luat({ commandValue: 30 })], chuaKhai)).toBeNull();
  });

  // R1b-2a T2 (m4) — thay ghim cũ "ghim DỪNG trên tag CHƯA khai KHÔNG kiểm": `datStopPin` nay dùng `kiemLenhInterlockTrenKenh` ⇒ ghim lệch lưới
  // thô bị từ chối LÚC ĐẶT (STOP_PIN_NGOAI_DAI + buoc / goiY; test DB stopPin.dai.r1a.db.test.ts). Lúc chạy, STOP khớp ghim vẫn được miễn (B).
  it("ghim DỪNG trên tag CHƯA khai: luật lúc đặt = kiemLenhInterlockTrenKenh (25 ⇒ OFF_STEP buoc 10 goiY 30; 30 ⇒ ok); kiemNhatQuanKenh vẫn chỉ cho tag ĐÃ khai", () => {
    expect(kiemLenhInterlockTrenKenh(chuaKhai, 25)).toMatchObject({ ok: false, ma: "OFF_STEP", luoi: { buoc: 10, goiY: 30 } });
    expect(kiemLenhInterlockTrenKenh(chuaKhai, 30)).toEqual({ ok: true });
    expect(kiemNhatQuanKenh(chuaKhai, 25)).toEqual({ ok: true });
  });
});

// ─── R1b-1 T13 polish (m1 + m3) ──────────────────────────────────────────────────────────────────────────────────────────────────

describe("T13 polish m3 — congKenhSom: tag int CHƯA khai scale −10 / offset −5", () => {
  it("scale −10: 30 ⇒ ok (write nguyên vẹn); 25 ⇒ OFF_STEP goiY 20, appError step 10", () => {
    const t = tag({ tagKey: "am", scale: "-10.000000" });
    const w = { tagKey: "am", value: 30 };
    const ok = congKenhSom("set_param", [w], [t]);
    expect(ok.ok && ok.writes[0]).toBe(w);
    const kq = congKenhSom("set_param", [{ tagKey: "am", value: 25 }], [t]);
    expect(kq).toMatchObject({ ok: false, ma: "OFF_STEP", buoc: 10, goiY: 20 });
    expect(appErrorLechBuoc(kq)?.appParams).toEqual({ ma: "OFF_STEP", tagKey: "am", step: 10, goiY: 20 });
  });
  it("offset −5 scale 10: 25 ⇒ ok; 20 ⇒ OFF_STEP goiY 25", () => {
    const t = tag({ tagKey: "o5", offset: "-5.000000" });
    expect(congKenhSom("set_param", [{ tagKey: "o5", value: 25 }], [t]).ok).toBe(true);
    expect(congKenhSom("set_param", [{ tagKey: "o5", value: 20 }], [t])).toMatchObject({ ok: false, ma: "OFF_STEP", buoc: 10, goiY: 25 });
  });
});

describe("T13 polish m1 — tham số INTERLOCK_NGOAI_DAI nêu ĐÚNG lưới (không 'bước —' khi tag không khai write_step)", () => {
  const chuaKhai = { dataType: "int" as const, channelKind: null, writable: true, writeMin: null, writeMax: null, writeStep: null };
  it("lưới thô chưa khai (scale 10 offset −5): 20 ⇒ step 10, goc −5, goiY 25, min/max '—'", () => {
    const k = { ...chuaKhai, scale: "10", offset: "-5" };
    const kq = kiemLenhInterlockTrenKenh(k, 20);
    expect(kq).toMatchObject({ ok: false, ma: "OFF_STEP", luoi: { buoc: 10, gocLuoi: -5, goiY: 25 } });
    expect(thamSoNgoaiDaiInterlock(k, kq.ok ? { ma: "" } : kq)).toEqual({ min: "—", max: "—", step: 10, goc: -5, goiY: 25 });
  });
  it("viPhamInterlock mang lưới; tag ĐÃ khai lệch bước (bước 5 từ min 10) ⇒ step 5, goc 10, goiY 15", () => {
    const vp = viPhamInterlock([{ id: 7, name: "r", action: "reduce_speed", enabled: true, commandValue: 25 }], { ...chuaKhai, scale: "-10", offset: "0" });
    expect(vp).toMatchObject({ ruleId: 7, ma: "OFF_STEP", luoi: { buoc: 10, gocLuoi: 0, goiY: 20 } });
    const khai = { ...chuaKhai, writeMin: 10, writeMax: 100, writeStep: 5, scale: "1", offset: "0" };
    const kq = kiemLenhInterlockTrenKenh(khai, 17);
    expect(thamSoNgoaiDaiInterlock(khai, kq.ok ? { ma: "" } : kq)).toEqual({ min: 10, max: 100, step: 5, goc: 10, goiY: 15 });
  });
  it("không phải OFF_STEP (ngoài dải) ⇒ step = write_step khai báo, goc / goiY '—'", () => {
    const khai = { ...chuaKhai, writeMin: 10, writeMax: 100, writeStep: 5 };
    const kq = kiemLenhInterlockTrenKenh(khai, 200);
    expect(kq).toMatchObject({ ok: false, ma: "OUT_OF_RANGE" });
    expect(thamSoNgoaiDaiInterlock(khai, kq.ok ? { ma: "" } : kq)).toEqual({ min: 10, max: 100, step: 5, goc: "—", goiY: "—" });
  });
});
