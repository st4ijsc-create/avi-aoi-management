/**
 * ★ CENSUS (doc 80 Đợt 1 Task 8) — `POST /api/ai/programming-copilot/stream`: **mọi kiểu sự kiện service
 * phát PHẢI có `case` ở dây SSE của tuyến VÀ ở bộ gộp phía client.**
 *
 * Bẫy đã biết của repo (`aiLocalKnowledgeApi.sseCensus.test.ts`, F1/F2 2026-09-22): tuyến SSE là DANH
 * SÁCH TRẮNG `switch (evt.type)` ⇒ kiểu mới thêm ở service rơi IM LẶNG ở tầng HTTP, lưới tầng service
 * vẫn xanh. Ở tuyến copilot có HAI danh sách trắng nối tiếp (tuyến `programmingCopilotStream.ts` và
 * client `copilotStreamClient.ts#apDungSuKien`), nên lưới này đối chiếu CẢ BA bên, đọc MÃ NGUỒN (kiểu
 * TypeScript bị xoá lúc chạy, không đếm được).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function bocChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const doc = (p: string) => bocChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));

/** Literal `type: "x"` trong khối `export type CopilotStreamEvent = … ;` (kết thúc ở dòng trống đầu tiên). */
function kieuServicePhat(): string[] {
  const src = doc("server/services/programming/copilotStream.ts");
  const dau = src.indexOf("export type CopilotStreamEvent =");
  expect(dau, "không tìm thấy `export type CopilotStreamEvent =`").toBeGreaterThan(0);
  const het = src.indexOf("\n\n", dau);
  const khoi = src.slice(dau, het > dau ? het : dau + 4000);
  return [...new Set([...khoi.matchAll(/type:\s*"([a-z_]+)"/g)].map((m) => m[1]))].sort();
}

/** `case "x":` bên trong vòng chuyển tiếp `for await (const evt of svc.streamCopilot(` của tuyến. */
function kieuTuyenChuyenTiep(): string[] {
  const src = doc("server/routes/programmingCopilotStream.ts");
  const moc = src.indexOf("for await (const evt of svc.streamCopilot(");
  expect(moc, "không tìm thấy vòng chuyển tiếp SSE — lưới đang đo sai file").toBeGreaterThan(0);
  const het = src.indexOf("} catch (e)", moc);
  expect(het).toBeGreaterThan(moc);
  return [...new Set([...src.slice(moc, het).matchAll(/case\s+"([a-z_]+)"\s*:/g)].map((m) => m[1]))].sort();
}

/** `case "x":` trong `apDungSuKien` của client. */
function kieuClientXuLy(): string[] {
  const src = doc("client/src/components/programming/copilotStreamClient.ts");
  const moc = src.indexOf("export function apDungSuKien(");
  expect(moc, "không tìm thấy `apDungSuKien` ở client").toBeGreaterThan(0);
  const het = src.indexOf("\nexport ", moc + 10);
  return [...new Set([...src.slice(moc, het > moc ? het : undefined).matchAll(/case\s+"([a-z_]+)"\s*:/g)].map((m) => m[1]))].sort();
}

describe("SSE census — CopilotStreamEvent (service) == case (tuyến) == case (client)", () => {
  it("★★★ mọi kiểu service phát đều có `case` ở TUYẾN — kiểu mới quên dây ⇒ ĐỎ ở đây, không im lặng ở màn hình", () => {
    const phat = kieuServicePhat();
    expect(phat.length, "phải bóc được ≥ 4 kiểu từ union (cầu chì chống tập rỗng)").toBeGreaterThanOrEqual(4);
    const tuyen = new Set(kieuTuyenChuyenTiep());
    expect(phat.filter((k) => !tuyen.has(k)), "tuyến /api/ai/programming-copilot/stream thiếu case").toEqual([]);
  });

  it("★★★ mọi kiểu service phát đều có `case` ở CLIENT (`apDungSuKien`)", () => {
    const client = new Set(kieuClientXuLy());
    expect(kieuServicePhat().filter((k) => !client.has(k)), "client copilotStreamClient thiếu case").toEqual([]);
  });

  it("không có `case` MA ở tuyến (khai chuyển tiếp một kiểu service không hề phát)", () => {
    const phat = new Set(kieuServicePhat());
    expect(kieuTuyenChuyenTiep().filter((k) => !phat.has(k))).toEqual([]);
  });

  it("ca dương đã biết — bốn kiểu của hợp đồng brief có mặt ở cả ba bên (chỉ báo phải biết KÊU)", () => {
    for (const ds of [kieuServicePhat(), kieuTuyenChuyenTiep(), kieuClientXuLy()]) {
      expect(ds).toEqual(expect.arrayContaining(["stage", "token", "result", "error"]));
    }
  });
});

/** Literal của `export type CopilotStage = "a" | "b" …;` ở service. */
function stageService(): string[] {
  const src = doc("server/services/programming/aiProgrammingCopilot.ts");
  const m = src.match(/export type CopilotStage\s*=([^;]+);/);
  expect(m, "không tìm thấy `export type CopilotStage =`").toBeTruthy();
  return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]).sort();
}

/** Phần tử của `const STAGES … = new Set([...])` và của `type CopilotStreamStage` ở client. */
function stageClient(): { set: string[]; kieu: string[] } {
  const src = doc("client/src/components/programming/copilotStreamClient.ts");
  const set = src.match(/const STAGES[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
  const kieu = src.match(/export type CopilotStreamStage\s*=([^;]+);/);
  expect(set, "không tìm thấy `STAGES` ở client").toBeTruthy();
  expect(kieu, "không tìm thấy `CopilotStreamStage` ở client").toBeTruthy();
  const lay = (x: string) => [...x.matchAll(/"([a-z_]+)"/g)].map((y) => y[1]).sort();
  return { set: lay(set![1]), kieu: lay(kieu![1]) };
}

describe("Fix round 1 #5 — CopilotStage (service) == STAGES (client)", () => {
  it("★★ tập stage giống hệt hai bên — stage mới ở service mà client không biết ⇒ client BỎ QUA im lặng (apDungSuKien `return s`)", () => {
    const sv = stageService();
    expect(sv.length, "cầu chì chống tập rỗng").toBeGreaterThanOrEqual(5);
    const cl = stageClient();
    expect(cl.set).toEqual(sv);
    expect(cl.kieu).toEqual(sv);
  });
});

describe("Fix round 1 #1 — giấy phép tuyến SSE == giấy phép thủ tục copilotGenerate", () => {
  it("★★★ `MODULE_COPILOT` của tuyến trùng `moduleProcedure(...)` của programmingRouter, và được kiểm TRƯỚC `streamCopilot(`", () => {
    const router = doc("server/routers/programmingRouter.ts");
    const mr = router.match(/const protectedProcedure\s*=\s*moduleProcedure\("([A-Z_]+)"\)/);
    expect(mr, "programmingRouter không còn `protectedProcedure = moduleProcedure(...)` — đọc lại cổng giấy phép").toBeTruthy();
    const tuyen = doc("server/routes/programmingCopilotStream.ts");
    const mt = tuyen.match(/export const MODULE_COPILOT\s*=\s*"([A-Z_]+)"/);
    expect(mt, "tuyến không khai `MODULE_COPILOT`").toBeTruthy();
    expect(mt![1]).toBe(mr![1]);
    const kiem = tuyen.indexOf("isModuleLicensed(MODULE_COPILOT)");
    const chay = tuyen.indexOf("svc.streamCopilot(");
    expect(kiem, "tuyến không gọi `isModuleLicensed(MODULE_COPILOT)`").toBeGreaterThan(0);
    expect(kiem, "kiểm giấy phép phải đứng TRƯỚC lượt chạy pipeline").toBeLessThan(chay);
  });
});
