/**
 * ★★★ 2026-08-24 — **TẠO KHUNG DỰ ÁN, VÒNG THẬT Ở TERMINAL: gõ → thẻ duyệt lô → 'y' → BYTE TRÊN ĐĨA,
 * trong một thư mục KHÔNG CÓ GIT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI KHI `aiCodingTaoKhung.stream.test.ts` ĐÃ XANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Lưới stream chặn tool ghi ở cửa `executeDecision` ⇒ nó chứng minh ĐỊNH TUYẾN + HẬU KIỂM, nhưng
 * **không một byte nào rơi xuống đĩa** trong các ca của nó. Bài học đã cắn ba lượt liên tiếp
 * (doc 83, đầu `cliVongThat.test.ts`): lưới chỉ phát biểu *"tool làm đúng KHI ĐƯỢC GỌI"* thì không
 * bao giờ chứng minh *"cái người gõ ở terminal SẼ TỚI ĐƯỢC đĩa"*. File này đi HẾT vòng:
 * `chayCli()` thật · CSDL thật (`proposeAction`/`confirmAction` + hàng `ai_pending_actions` thật) ·
 * hộp cát/RBAC/HITL không mock một dòng · rồi **đọc lại BYTE TRÊN ĐĨA** — trong một thư mục
 * `mkdtempSync` **KHÔNG chạy `git init`**, tức đúng hình dạng "thư mục trống mới thêm qua Quản lý
 * dự án" mà rào 2 (miễn trừ TẠO-vào-gốc-không-git) sinh ra để phục vụ.
 *
 * ⚠ Thứ DUY NHẤT bị chặn là **tầng model** (`aiGgufEngine`): chủ dự án giữ việc nghiệm thu live,
 *   và một lượt gọi model 30B trong lưới sẽ đụng vào card đang giữ VRAM.
 * ⚠ `sandbox-projects/**` là ĐỀ THI — file này KHÔNG chạm tới nó một byte nào.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  /** Mảnh chữ model sẽ "sinh ra" cho lượt kế. */
  manh: [] as string[],
}));

/** ⚠ Chặn ở tầng THẤP NHẤT — không lượt nào chạm llama-server hay card. */
vi.mock("../aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  describeImage: vi.fn(),
  generateJSON: vi.fn(async () => ({
    data: { tool: "none", args: {} },
    raw: "{}",
    modelId: "stub",
    totalTimeMs: 1,
    tokensPrompt: 1,
    tokensGenerated: 1,
  })),
  generateTextStream: async function* () {
    for (const m of h.manh) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: h.manh.length };
  },
}));

import { chayCli, MA_THOAT, type CongTerminal } from "./cli";
import { MOC_DONG, MOC_MO, MOC_NGAN, MOC_TEP_KHUNG } from "../aiCodingAgent";
import { createLocalUser } from "../../db/auth";
import { getDb } from "../../db/connection";
import { aiPendingActions } from "../../../drizzle/schema";
import { users, userSecrets } from "../../../drizzle/schema/auth";
import { eq } from "drizzle-orm";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CỔNG TERMINAL GIẢ — cùng khuôn `cliVongThat.test.ts` (bàn phím xếp sẵn + EOF thật khi cạn)
// ════════════════════════════════════════════════════════════════════════════════════════════════
interface CongGia extends CongTerminal {
  manHinh(): string;
  soLanHoi(): number;
}

function congGia(traLoi: string[]): CongGia {
  const ra: string[] = [];
  let i = 0;
  let hoiDem = 0;
  const lay = (): string => traLoi[i++] ?? "";
  return {
    in: (s) => void ra.push(s),
    hoi: async (nhac) => {
      ra.push(nhac);
      hoiDem++;
      return lay();
    },
    hoiKin: async (nhac) => {
      ra.push(nhac);
      hoiDem++;
      return lay();
    },
    hoiTuoi: async (nhac) => {
      ra.push(nhac);
      hoiDem++;
      return lay();
    },
    hetDauVao: () => i >= traLoi.length,
    dong: () => {},
    manHinh: () => ra.join(""),
    soLanHoi: () => hoiDem,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THƯ MỤC DỰ ÁN **KHÔNG GIT** + TÀI KHOẢN THẬT
// ════════════════════════════════════════════════════════════════════════════════════════════════
let GOC = "";
let uid = 0;
let TEN_DN = "";
const MAT_KHAU = "Mk-khung-84!x";
const ID_DA = "khungtam";
/** Tệp CÓ SẴN trong gốc không-git — nguyên liệu cho ca "đã tồn tại" + ca "SỬA vẫn bị chặn". */
const TEP_CU = "src/CoSan.cs";
const ND_CU = "namespace X;\npublic class CoSan { }\n";

function docDia(rel: string): string {
  return fs.readFileSync(path.join(GOC, rel), "utf8");
}
function coTren(rel: string): boolean {
  return fs.existsSync(path.join(GOC, rel));
}
/** Một mục manifest đúng khuôn persona dặn. */
function tepKhung(duong: string, nhan: string, noiDung: string): string {
  return [`${MOC_TEP_KHUNG} ${duong}`, "```" + nhan, noiDung, "```"].join("\n");
}
/** Một khối SEARCH/REPLACE cho ca SỬA. */
function khoi(truoc: string, sau: string): string {
  return [MOC_MO, truoc, MOC_NGAN, sau, MOC_DONG].join("\n");
}

const ND_CSPROJ = ['<Project Sdk="Microsoft.NET.Sdk">', "  <PropertyGroup>", "    <OutputType>Exe</OutputType>", "    <TargetFramework>net8.0</TargetFramework>", "  </PropertyGroup>", "</Project>"].join("\n");
const ND_PROGRAM = ["namespace PdfDemo;", "", "public static class Program {", "    public static void Main() { }", "}"].join("\n");
const ND_README = ["# PdfDemo", "", "Build: `dotnet build --no-restore`"].join("\n");

const MANIFEST_3_TEP = [
  "Khung console tối thiểu:",
  "",
  tepKhung("PdfDemo.csproj", "xml", ND_CSPROJ),
  tepKhung("src/Program.cs", "csharp", ND_PROGRAM),
  tepKhung("README.md", "markdown", ND_README),
].join("\n");

const ENV = [
  "AI_CODING_GEN",
  "AI_CODING_EDIT",
  "AI_CODING_REPO_CONTEXT",
  "AI_REPO_SANDBOX_ROOTS",
  "AI_REPO_SANDBOX_ROOT",
  "AVI_CLI_USER",
  "AVI_CLI_PASSWORD",
  "LLAMA_SERVER_STRICT",
] as const;

beforeAll(async () => {
  GOC = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cli-khung-")));
  // ⚠ CỐ Ý KHÔNG `git init` — toàn bộ điểm của file này là đo rào 2 trên một gốc KHÔNG git.
  fs.mkdirSync(path.join(GOC, "src"), { recursive: true });
  fs.writeFileSync(path.join(GOC, TEP_CU), ND_CU);

  const bcrypt = await import("bcryptjs");
  TEN_DN = `khung84-cli-${Date.now()}`;
  const kq = await createLocalUser({
    username: TEN_DN,
    passwordHash: await bcrypt.hash(MAT_KHAU, 10),
    name: "Ky su tao khung",
    // `admin` để checkPermission đi nhánh short-circuit — RBAC vẫn CHẠY THẬT (xem cliVongThat §mở đầu).
    role: "admin",
  });
  uid = kq.id;
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (db && uid > 0) {
    // ⚠ XOÁ CÓ GIỚI HẠN — đúng hàng của chính file này.
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, uid));
    await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  try {
    if (GOC) fs.rmSync(GOC, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}, 60_000);

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.AI_CODING_REPO_CONTEXT = "0";
  process.env.AI_REPO_SANDBOX_ROOTS = `${ID_DA}=Khung khong git|${GOC}`;
  process.env.AVI_CLI_USER = TEN_DN;
  process.env.AVI_CLI_PASSWORD = MAT_KHAU;
  h.manh = [];
  // Trả gốc về trạng thái nền: chỉ còn tệp có sẵn.
  for (const rel of ["PdfDemo.csproj", "src/Program.cs", "README.md"]) {
    try {
      fs.rmSync(path.join(GOC, rel), { force: true });
    } catch {
      /* best-effort */
    }
  }
  fs.writeFileSync(path.join(GOC, TEP_CU), ND_CU);
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — VÒNG KHÉP KÍN: 'tạo dự án …' → MỘT thẻ lô → 'y' → BA TỆP trên đĩa, gốc KHÔNG git", () => {
  it("★ ĐỐI CHỨNG HIỆU CHUẨN — gốc dự án thật sự KHÔNG có git (mọi mệnh đề dưới đứng trên nó)", () => {
    expect(fs.existsSync(path.join(GOC, ".git")), "lỡ ai git init thì mọi ca dưới đo một thứ khác").toBe(false);
  });

  it("★★★ gõ 'y' ⇒ CLI hiện thẻ lô + cảnh báo không-git, rồi GHI THẬT đúng từng byte", async () => {
    h.manh = [MANIFEST_3_TEP];
    const c = congGia(["y"]);
    const ma = await chayCli(["--du-an", ID_DA, "--lenh", "tạo dự án C# console đọc file pdf"], c);

    expect(ma).toBe(MA_THOAT.XONG);
    const mh = c.manHinh();
    expect(mh, "phải hiện thẻ duyệt").toContain("ĐỀ XUẤT CẦN BẠN DUYỆT");
    expect(mh, "khung N tệp đi MỘT thẻ lô").toContain("apply_diff_batch");
    expect(mh, "người duyệt phải thấy cảnh báo không có lưới hoàn tác").toContain("CHƯA có git");
    expect(mh).toContain("git init");
    expect(c.soLanHoi(), "phải CÓ hỏi trước khi ghi").toBeGreaterThan(0);

    // ★★★ Phép đo cuối cùng: BYTE TRÊN ĐĨA — nội dung fence sau `chuanHoaTepMoi` (LF + một dòng trống cuối).
    expect(docDia("PdfDemo.csproj")).toBe(ND_CSPROJ + "\n");
    expect(docDia("src/Program.cs")).toBe(ND_PROGRAM + "\n");
    expect(docDia("README.md")).toBe(ND_README + "\n");
    expect(docDia(TEP_CU), "tệp có sẵn KHÔNG liên quan không được chạm").toBe(ND_CU);
  }, 60_000);

  it("★★★ gõ 'n' ⇒ KHÔNG một tệp nào được tạo (đường ra MẶC ĐỊNH là KHÔNG ghi)", async () => {
    h.manh = [MANIFEST_3_TEP];
    const c = congGia(["n"]);
    await chayCli(["--du-an", ID_DA, "--lenh", "tạo dự án C# console demo"], c);
    expect(c.manHinh()).toContain("ĐỀ XUẤT CẦN BẠN DUYỆT");
    for (const rel of ["PdfDemo.csproj", "src/Program.cs", "README.md"]) {
      expect(coTren(rel), `"${rel}" không được rơi xuống đĩa khi người dùng từ chối`).toBe(false);
    }
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — HẬU KIỂM fail-closed đi hết tới terminal: đã-tồn-tại · đường thoát", () => {
  it("★★★ manifest chứa tệp ĐÃ TỒN TẠI ⇒ TỪ CHỐI CẢ LÔ [TEP_DA_TON_TAI], KHÔNG hỏi duyệt, đĩa 0 đổi", async () => {
    h.manh = [[tepKhung("moi-a.cs", "csharp", "class MoiA { }"), tepKhung(TEP_CU, "csharp", "class DeLen { }")].join("\n")];
    const c = congGia(["y"]); // 'y' xếp sẵn — nếu có thẻ duyệt lọt ra thì ca này PHẢI đỏ vì đĩa đổi
    const ma = await chayCli(["--du-an", ID_DA, "--lenh", "tạo dự án C# demo"], c);

    expect(ma).toBe(MA_THOAT.XONG);
    expect(c.manHinh()).toContain("TEP_DA_TON_TAI");
    expect(c.manHinh(), "phải nêu ĐÍCH DANH tệp phạm").toContain(TEP_CU);
    expect(c.manHinh(), "không được dựng thẻ duyệt nào").not.toContain("ĐỀ XUẤT CẦN BẠN DUYỆT");
    expect(coTren("moi-a.cs"), "tệp hợp lệ trong lô cũng KHÔNG được tạo lẻ").toBe(false);
    expect(docDia(TEP_CU), "tệp có sẵn nguyên vẹn từng byte").toBe(ND_CU);
  }, 60_000);

  it("★★★ manifest có đường THOÁT `..` và đường TUYỆT ĐỐI ⇒ TỪ CHỐI [DUONG_KHONG_HOP_LE], 0 tệp mới", async () => {
    const tenThoat = `thoat-${path.basename(GOC)}.cs`;
    h.manh = [
      [
        tepKhung("hop-le.cs", "csharp", "class HopLe { }"),
        tepKhung(`../${tenThoat}`, "csharp", "class Thoat { }"),
        tepKhung("C:/temp/tuyet-doi.cs", "csharp", "class TuyetDoi { }"),
      ].join("\n"),
    ];
    const c = congGia(["y"]);
    await chayCli(["--du-an", ID_DA, "--lenh", "tạo dự án C# demo"], c);

    expect(c.manHinh()).toContain("DUONG_KHONG_HOP_LE");
    expect(c.manHinh()).not.toContain("ĐỀ XUẤT CẦN BẠN DUYỆT");
    expect(coTren("hop-le.cs")).toBe(false);
    // ★ Mệnh đề THẬT của hộp cát: byte không rời gốc — tệp thoát KHÔNG xuất hiện ở thư mục CHA.
    expect(fs.existsSync(path.join(path.dirname(GOC), tenThoat)), "một tệp ngoài gốc là một lượt thoát THẬT").toBe(false);
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — CA THEN CHỐT CHỐNG NỚI: SỬA tệp có sẵn trong gốc không-git VẪN bị GIT_STATUS_FAILED", () => {
  it("★★★ 'sửa <tệp>: …' + 'y' ⇒ ✖ TỪ CHỐI [GIT_STATUS_FAILED], đĩa nguyên vẹn từng byte", async () => {
    h.manh = [`Thêm chú thích.\n\n${khoi("public class CoSan { }", "public class CoSan { } // đã xem")}\n`];
    const c = congGia(["y"]);
    const ma = await chayCli(["--du-an", ID_DA, "--lenh", `sửa ${TEP_CU}: thêm chú thích cuối class`], c);

    expect(ma).toBe(MA_THOAT.XONG);
    const mh = c.manHinh();
    // Đề xuất VẪN được dựng (preview khai lời từ chối trong cảnh báo) — nhưng cửa GHI phải đóng:
    expect(mh, "kết cục phải là TỪ CHỐI có mã, không phải một lượt ghi").toContain("TỪ CHỐI [GIT_STATUS_FAILED]");
    expect(mh).not.toContain("✔ Đã thực thi");
    expect(docDia(TEP_CU), "tệp CÓ THẬT trong gốc không-git KHÔNG được đổi một byte").toBe(ND_CU);
  }, 60_000);
});
