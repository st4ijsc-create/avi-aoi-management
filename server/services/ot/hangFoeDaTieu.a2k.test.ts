/**
 * SCADA R1b-2b-2a A2(k) (AN TOÀN, phòng thủ chiều sâu) — trong GIỮ CHỖ (reserveRealWrite), hàng uỷ quyền FOE đúc cho CHÍNH khoá này đã tiêu ('executed')
 * mà khoá không có hàng nào ⇒ `FOE_ROW_SPENT_FOR_KEY` (lớp "có thể đã bay": FOE không gửi lại dưới attempt key mới), KHÔNG phải NOT_CONFIRMED ("chưa bay"
 * ⇒ thử lại). CHỈ khi đủ k1..k5; thiếu một ⇒ NOT_CONFIRMED như trước.
 *
 * Không DB: (1) hàm thuần `lyDoHangFoeDaTieuChoKhoa` — mỗi điều kiện k1..k5 âm tính ⇒ null; dương tính ⇒ câu chi tiết; không đổi hàng (thuần);
 * (2) quét NGUỒN chỗ gọi trong giữ chỗ (chỉ sau khi verifyActionBinding từ chối hàng 'executed', trước hàng sổ; CAS vẫn chỉ confirmed→executed; cờ
 * `laStopKhoa` tới CẢ HAI lần giữ chỗ); (3) danh sách mã (MA_LOI_DA_BIET, nhóm an toàn). Đường DB thật: hangFoeDaTieu.a2k.db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lyDoHangFoeDaTieuChoKhoa, MA_HANG_FOE_DA_TIEU, type DispatchInput, type HitlTrigger } from "./commandDispatcher";
import { FOE_ENGINE_TOOL, otPayloadHash, withFoeGateApproval, withHangMoiStopGhim, withOtPayloadHash } from "./otActionBinding";
import { orchestrationActionId } from "../orchestration/foe/foeStepClass";
import { MA_LOI_DA_BIET, maDaBietDauTien, maLoiBuocFoe, maLoiCua } from "../../routers/_chiTietKyThuat";
import type { AiPendingAction } from "../../../drizzle/schema";

const NGUON = readFileSync(fileURLToPath(new URL("./commandDispatcher.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
/** bỏ chú thích (dòng `//` và khối) — chỉ đọc MÃ. */
const ma = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function doan(tu: string, den: string): string {
  const a = NGUON.indexOf(tu);
  if (a < 0) throw new Error(`không thấy dấu: ${tu}`);
  const b = NGUON.indexOf(den, a + tu.length);
  if (b < 0) throw new Error(`không thấy dấu: ${den}`);
  return NGUON.slice(a, b);
}

const OWNER = 11;
const APPROVER = 12;
const KHOA = "run77-main-a1";
const W = [{ tagKey: "t", value: 5 }];
const lenh = (o: Partial<DispatchInput> = {}): DispatchInput =>
  ({ adapterId: 7, machineId: 3, commandType: "set_param", writes: W, idempotencyKey: KHOA, triggeredBy: trig(), ...o }) as DispatchInput;
const trig = (o: Partial<HitlTrigger> = {}): HitlTrigger => ({ kind: "hitl", actionId: orchestrationActionId(KHOA), tool: FOE_ENGINE_TOOL, confirmedBy: APPROVER, requestedBy: OWNER, ...o });
const bam = (tool = FOE_ENGINE_TOOL, writes = W, commandType = "set_param") => otPayloadHash({ tool, adapterId: 7, machineId: 3, commandType, writes });
const duyet = { runId: 77, runOwner: OWNER, approvedBy: APPROVER, gateStepId: "g0" };
function hang(o: Partial<AiPendingAction> & { preview?: Record<string, unknown> } = {}): AiPendingAction {
  const { preview, ...rest } = o;
  return {
    id: orchestrationActionId(KHOA),
    tool: FOE_ENGINE_TOOL,
    argsJson: {},
    userId: APPROVER,
    userRole: "foe_gate_approver",
    summary: "x",
    previewJson: preview ?? withFoeGateApproval(withOtPayloadHash(null, bam()), duyet),
    status: "executed",
    executedAt: new Date(Date.now() - 5_000),
    idempotencyKey: orchestrationActionId(KHOA),
    // quá hạn: hàng đã tiêu thì hạn không còn là câu hỏi (cùng luật daTieuChoBuoc2 của cổng (1))
    expiresAt: new Date(Date.now() - 1_000),
    createdAt: new Date(Date.now() - 60_000),
    ...rest,
  } as AiPendingAction;
}
const hoi = (p: AiPendingAction | undefined, o: { laStopKhoa?: boolean; input?: DispatchInput; khoa?: string; t?: HitlTrigger } = {}) =>
  lyDoHangFoeDaTieuChoKhoa(p, o.input ?? lenh(), o.khoa ?? KHOA, o.t ?? trig(), { laStopKhoa: "laStopKhoa" in o ? o.laStopKhoa : false });

describe("A2(k) — lyDoHangFoeDaTieuChoKhoa: đủ k1..k5 ⇒ FOE_ROW_SPENT_FOR_KEY, thiếu một ⇒ null (NOT_CONFIRMED như trước)", () => {
  it("★ dương tính: hàng FOE đúc cho CHÍNH khoá, đã tiêu, gắn ĐÚNG lệnh không phải STOP ⇒ câu chi tiết; hàng không đổi (thuần, không tiêu gì)", () => {
    const p = hang();
    const truoc = structuredClone(p);
    const r = hoi(p);
    expect(r).toMatch(/^orchestration action foe-run77-main-a1 was minted for this very idempotency key and is already spent, yet the key has no write-ahead intent — the write may already have reached the device/);
    expect(p).toEqual(truoc);
    expect(MA_HANG_FOE_DA_TIEU).toBe("FOE_ROW_SPENT_FOR_KEY");
    // câu chi tiết không mang mã ĐÃ BIẾT nào (maLoiCua đọc tiền tố `FOE_ROW_SPENT_FOR_KEY:` của hàng sổ; không có mã thứ hai để tranh)
    expect(maDaBietDauTien(r)).toBeNull();
  });

  it("hàng không phải 'executed' / không có ⇒ null (giữ chỗ chỉ hỏi sau khi từ chối hàng đã tiêu)", () => {
    expect(hoi(undefined)).toBeNull();
    for (const status of ["confirmed", "proposed", "expired", "cancelled", "denied", "bi_tu_choi_ghi"] as const) expect(hoi(hang({ status: status as never }))).toBeNull();
  });

  it("★ (k1) STOP theo khoá (laStopKhoa true) — hoặc cờ VẮNG (fail về hành vi cũ) ⇒ null", () => {
    expect(hoi(hang(), { laStopKhoa: true })).toBeNull();
    expect(hoi(hang(), { laStopKhoa: undefined })).toBeNull();
    expect(lyDoHangFoeDaTieuChoKhoa(hang(), lenh(), KHOA, trig())).toBeNull(); // không opts
  });

  it("★ (k2) tool KHÁC FOE_ENGINE_TOOL (cùng id foe-<khoá>, gắn đúng tool của nó) ⇒ null", () => {
    const tool = "set_machine_param";
    const p = hang({ tool, previewJson: withOtPayloadHash(null, bam(tool)) });
    expect(hoi(p, { t: trig({ tool }) })).toBeNull();
  });

  it("★ (k3) id của KHOÁ KHÁC (dạng Sparkplug / HMI dùng lại uỷ quyền đã tiêu dưới khoá khác) ⇒ null; id cắt ngắn kiểu cũ của khoá dài ⇒ null", () => {
    expect(hoi(hang(), { khoa: "run77-main-a2", input: lenh({ idempotencyKey: "run77-main-a2" }) })).toBeNull();
    expect(hoi(hang(), { khoa: "hmi:other-key", input: lenh({ idempotencyKey: "hmi:other-key" }) })).toBeNull();
    const dai = `run77-${"x".repeat(80)}-a1`;
    const cu = `foe-${dai}`.slice(0, 64);
    expect(cu).not.toBe(orchestrationActionId(dai));
    expect(hoi(hang({ id: cu }), { khoa: dai, input: lenh({ idempotencyKey: dai }), t: trig({ actionId: cu }) })).toBeNull();
    // đối chứng: khoá dài, id ĐÚNG (băm) ⇒ dương tính
    expect(hoi(hang({ id: orchestrationActionId(dai) }), { khoa: dai, input: lenh({ idempotencyKey: dai }), t: trig({ actionId: orchestrationActionId(dai) }) })).not.toBeNull();
  });

  it("★ (k4) phần còn lại của ràng buộc: băm payload lệch / chủ lệch / không duyệt cổng (tự duyệt) / do chủ run duyệt / tool lệnh khác ⇒ null", () => {
    expect(hoi(hang({ previewJson: withFoeGateApproval(withOtPayloadHash(null, bam(FOE_ENGINE_TOOL, [{ tagKey: "t", value: 6 }])), duyet) }))).toBeNull();
    expect(hoi(hang(), { input: lenh({ writes: [{ tagKey: "t", value: 6 }] }) })).toBeNull();
    expect(hoi(hang(), { input: lenh({ adapterId: 8 }) })).toBeNull();
    expect(hoi(hang({ previewJson: withOtPayloadHash(null, bam()) }))).toBeNull(); // không duyệt cổng
    expect(hoi(hang(), { t: trig({ confirmedBy: 99 }) })).toBeNull(); // chủ hàng ≠ người xác nhận
    expect(hoi(hang({ userId: OWNER, previewJson: withFoeGateApproval(withOtPayloadHash(null, bam()), { ...duyet, approvedBy: OWNER }) }), { t: trig({ confirmedBy: OWNER }) })).toBeNull(); // chủ run tự duyệt
    expect(hoi(hang(), { t: trig({ tool: "set_machine_param" }) })).toBeNull();
    expect(hoi(hang({ previewJson: withFoeGateApproval({}, duyet) }))).toBeNull(); // không băm
  });

  it("★ (k5) hàng MỚI của STOP ghim (dấu hangMoiStopGhim, A2(m)) ⇒ null — kể cả khi mọi thứ khác khớp", () => {
    expect(hoi(hang({ previewJson: withHangMoiStopGhim(withFoeGateApproval(withOtPayloadHash(null, bam()), duyet)) }))).toBeNull();
  });
});

describe("A2(k) — chỗ gọi trong giữ chỗ (quét nguồn)", () => {
  const GIU_CHO = ma(doan("async function reserveRealWrite(", "\n}\n"));
  const HAM = ma(doan("export function lyDoHangFoeDaTieuChoKhoa(", "\n}\n"));

  it("CHỈ sau khi verifyActionBinding từ chối hàng 'executed'; mã mới thay verdict; trước nhánh dấu A2(m), trước CAS và trước hàng sổ (writeRejected)", () => {
    const xac = GIU_CHO.indexOf("verdict = verifyActionBinding(pending, opts.bindingInput ?? input, t, { pinnedStop: opts.pinnedStop === true, altWrites: opts.rawBindingWrites });");
    const nhanh = GIU_CHO.indexOf('if (!verdict.ok && pending?.status === "executed") {');
    const goi = GIU_CHO.indexOf("lyDoHangFoeDaTieuChoKhoa(pending, opts.bindingInput ?? input, input.idempotencyKey, t, { laStopKhoa: opts.laStopKhoa, altWrites: opts.rawBindingWrites })");
    expect(xac).toBeGreaterThan(0);
    expect(nhanh).toBeGreaterThan(xac);
    expect(goi).toBeGreaterThan(nhanh);
    expect(GIU_CHO.slice(goi, goi + 300)).toContain("if (daTieu) verdict = { ok: false, reason: MA_HANG_FOE_DA_TIEU, detail: daTieu };");
    expect(goi).toBeLessThan(GIU_CHO.indexOf("if (verdict.ok && laHangMoiStopGhim(pending?.previewJson) && opts.pinnedStop !== true) {"));
    expect(goi).toBeLessThan(GIU_CHO.indexOf('.set({ status: "executed", executedAt: new Date() })'));
    expect(goi).toBeLessThan(GIU_CHO.indexOf("const ids = await writeRejected(tx, input, verdict.reason, verdict.detail);"));
    expect((GIU_CHO.match(/lyDoHangFoeDaTieuChoKhoa\(/g) ?? []).length).toBe(1);
    // CAS vẫn CHỈ confirmed→executed; giữ chỗ tự nó không bao giờ nhận hàng đã tiêu (A2(h) AMENDMENT 2)
    expect(GIU_CHO).toMatch(/\.where\(and\(eq\(aiPendingActions\.id, t\.actionId\), eq\(aiPendingActions\.status, "confirmed"\)\)\)/);
    expect(GIU_CHO).not.toMatch(/daTieuChoBuoc2/);
  });

  it("hàm kiểm là THUẦN: không await / tx / update / insert; xét đủ năm điều kiện; ràng buộc kiểm với daTieuChoBuoc2 (không bao giờ tiêu)", () => {
    expect(HAM).not.toMatch(/\bawait\b|\btx\b|\.update\(|\.insert\(|\.delete\(|getDb/);
    expect(HAM).toMatch(/if \(opts\.laStopKhoa !== false\) return null;/);
    expect(HAM).toMatch(/if \(pending\.tool !== FOE_ENGINE_TOOL\) return null;/);
    expect(HAM).toMatch(/if \(pending\.id !== orchestrationActionId\(khoa\)\) return null;/);
    expect(HAM).toMatch(/if \(laHangMoiStopGhim\(pending\.previewJson\)\) return null;/);
    expect(HAM).toMatch(/if \(!verifyActionBinding\(pending, bindingInput, t, \{ daTieuChoBuoc2: true, altWrites: opts\.altWrites \}\)\.ok\) return null;/);
  });

  it("cờ laStopKhoa tới CẢ HAI lần giữ chỗ (lần khoá mới của STOP không có laStop): optsGiuCho mang nó", () => {
    const code = ma(NGUON);
    expect(code).toMatch(/const optsGiuCho = \{ bindingInput: callerInput, rawBindingWrites: rawCallerWrites, ledgerExtra, laStopKhoa, pinnedStop: stopCls\.pinnedStop \};/);
    expect(code).toMatch(/let reservation = await reserveRealWrite\(db, input, resolved, \{ \.\.\.optsGiuCho, laStop: laStopKhoa \}\);/);
    expect(code).toMatch(/reservation = await reserveRealWrite\(db, input, resolved, optsGiuCho\);/);
    expect((code.match(/reserveRealWrite\(db, /g) ?? []).length).toBe(2);
  });
});

describe("A2(k) — danh sách mã", () => {
  it("MA_LOI_DA_BIET có FOE_ROW_SPENT_FOR_KEY ⇒ maLoiCua đọc tiền tố của hàng sổ", () => {
    expect(MA_LOI_DA_BIET).toContain(MA_HANG_FOE_DA_TIEU);
    expect(maLoiCua(`${MA_HANG_FOE_DA_TIEU}: orchestration action foe-run1-main-a1 was minted …`, "rejected")).toBe(MA_HANG_FOE_DA_TIEU);
  });
  it("nhóm an toàn: người bị che vẫn thấy tín hiệu kiểm thiết bị — FOE_ROW_SPENT_FOR_KEY thắng mã thường đứng trước; FOE_OUTCOME_UNKNOWN đứng trước vẫn thắng", () => {
    expect(maDaBietDauTien(`Step failed: NOT_CONFIRMED earlier; then ${MA_HANG_FOE_DA_TIEU}: x`)).toBe(MA_HANG_FOE_DA_TIEU);
    expect(maLoiBuocFoe(`FOE_OUTCOME_UNKNOWN: ${MA_HANG_FOE_DA_TIEU}: command "start" — x; outcome unknown — not sent again; check the device.`, "failed", "command")).toBe("FOE_OUTCOME_UNKNOWN");
  });
});
