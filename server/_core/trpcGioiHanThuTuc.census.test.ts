/**
 * ★★★ CENSUS — nhóm "2fa" của bộ giới hạn theo số thủ tục PHẢI phủ MỌI thủ tục tRPC thật sự xác minh TOTP (rà bảo mật 2026-10-24).
 * Chạy trên appRouter THẬT (nặng — một lượt import ~10–20 s) + AST nguồn. Thủ tục nào gọi `verifyTotpOnce` hoặc đứng trên bước nâng cấp 2FA mà KHÔNG thuộc nhóm `2fa` ⇒ ĐỎ.
 * Thêm một bề mặt gọi `verifyTotpOnce` mới ⇒ ĐỎ cho tới khi được xếp vào bảng `BE_MAT_GOI_VERIFY_TOTP` dưới đây (kèm cách nó được che).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { appRouter } from "../routers";
import { requireFreshTotp, requirePerCallFreshTotp } from "./trpc";
import { trpcProcedureType } from "./trpcAdapter";
import { quetThuTucDeploy } from "../routers/deployProcedureScan";
import { NHOM_THU_TUC_NHAY_CAM, layTapThuTucStepUp, phanNhomThuTuc } from "./trpcGioiHanThuTuc";

const GOC = path.resolve(__dirname, "..", "..");

/**
 * MỌI file sản xuất dưới `server/` có GỌI `verifyTotpOnce` (ngoài định nghĩa ở `_core/totpOnce.ts`) và CÁCH bề mặt ấy được che:
 *   "trpc-thu-tuc" ⇒ có thủ tục tRPC ở file này, từng thủ tục PHẢI rơi vào nhóm 2fa (kiểm bằng AST bên dưới);
 *   "trpc-step-up" ⇒ lõi step-up (`verifyFreshTotp`), che bằng tập thủ tục đứng trên requireFreshTotp/requirePerCallFreshTotp (suy từ appRouter);
 *   "rest-authLimiter" ⇒ cửa REST `/api/auth/*`, che bằng `authLimiter` (per yêu cầu, không batch được);
 *   "cli" ⇒ không phải bề mặt request (script vận hành).
 */
const BE_MAT_GOI_VERIFY_TOTP: Record<string, "trpc-thu-tuc" | "trpc-step-up" | "rest-authLimiter" | "cli"> = {
  "server/routers/twoFactorRouter.ts": "trpc-thu-tuc",
  "server/routers/userRouters.ts": "trpc-thu-tuc",
  "server/_core/trpc.ts": "trpc-step-up",
  "server/_core/oauth.ts": "rest-authLimiter",
  "server/services/edge/edgeNodeCredentials.ts": "cli",
};
/** Tên biến router (trong file) → tiền tố path ở appRouter. */
const TIEN_TO_ROUTER: Record<string, string> = { twoFactorRouter: "twoFactor", userRouter: "user" };

function moiFileTs(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten.startsWith(".")) continue;
    const p = path.join(thuMuc, ten);
    if (statSync(p).isDirectory()) moiFileTs(p, ra);
    else if (ten.endsWith(".ts") && !ten.endsWith(".d.ts") && !ten.endsWith(".test.ts") && !ten.endsWith(".test.tsx")) ra.push(p);
  }
  return ra;
}

/** Các thủ tục (tên) trong một file có chứa lời gọi `verifyTotpOnce`, kèm tên biến router bao ngoài. */
function thuTucGoiVerify(duong: string): Array<{ router: string; ten: string }> {
  const src = ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
  const ra: Array<{ router: string; ten: string }> = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "verifyTotpOnce") {
      let ten: string | null = null;
      let router: string | null = null;
      for (let cur: ts.Node | undefined = n.parent; cur; cur = cur.parent) {
        if (!ten && ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)) ten = cur.name.text;
        if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) router = cur.name.text;
      }
      ra.push({ router: router ?? "?", ten: ten ?? "?" });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return ra;
}

describe("census nhóm 2fa của giới hạn theo thủ tục", () => {
  it("★★★ MỌI file sản xuất gọi verifyTotpOnce đều có trong bảng bề mặt đã biết (file mới ⇒ ĐỎ cho tới khi được xếp loại)", () => {
    const file = moiFileTs(path.join(GOC, "server"))
      .map((p) => path.relative(GOC, p).split(path.sep).join("/"))
      .filter((r) => r !== "server/_core/totpOnce.ts")
      .filter((r) => /\bverifyTotpOnce\s*\(/.test(readFileSync(path.join(GOC, r), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
      .sort();
    expect(file).toEqual(Object.keys(BE_MAT_GOI_VERIFY_TOTP).sort());
  }, 60_000);

  it("★★★ MỖI thủ tục tRPC gọi verifyTotpOnce (AST) rơi vào nhóm 2fa với đường dẫn THẬT của appRouter", () => {
    const tap = layTapThuTucStepUp(appRouter, [requireFreshTotp, requirePerCallFreshTotp]);
    let dem = 0;
    for (const [file, loai] of Object.entries(BE_MAT_GOI_VERIFY_TOTP)) {
      if (loai !== "trpc-thu-tuc") continue;
      const ds = thuTucGoiVerify(path.join(GOC, file));
      expect(ds.length, `${file}: AST không thấy lời gọi verifyTotpOnce`).toBeGreaterThan(0);
      for (const { router, ten } of ds) {
        const tienTo = TIEN_TO_ROUTER[router];
        expect(tienTo, `${file}: router "${router}" chưa có trong TIEN_TO_ROUTER`).toBeDefined();
        const p = `${tienTo}.${ten}`;
        const loaiTT = trpcProcedureType(appRouter, p);
        expect(loaiTT, `${p} không tồn tại ở appRouter (sai tiền tố/tên)`).toBeDefined();
        expect(phanNhomThuTuc(p, loaiTT, tap), `${p} gọi verifyTotpOnce nhưng KHÔNG thuộc nhóm 2fa`).toBe("2fa");
        dem++;
      }
    }
    expect(dem).toBeGreaterThanOrEqual(6); // twoFactor ×4 + user.verify2FA + user.disable2FA
  }, 120_000);

  it("★★★ tập step-up suy từ appRouter KHÔNG rỗng và khớp bộ quét AST deployProcedure (mọi thủ tục deploy đều được đếm)", () => {
    const tap = layTapThuTucStepUp(appRouter, [requireFreshTotp, requirePerCallFreshTotp]);
    expect(tap.size).toBeGreaterThan(0);
    for (const p of tap) expect(phanNhomThuTuc(p, "mutation", tap)).toBe("2fa");
    const quet = quetThuTucDeploy(GOC);
    expect(quet.mu).toEqual([]);
    const tenTrongTap = new Set([...tap].map((p) => p.split(".").pop()!));
    const thieu = quet.thuTuc.filter((t) => !tenTrongTap.has(t.ten)).map((t) => `${t.file}#${t.ten}`);
    expect(thieu, "thủ tục đứng trên deployProcedure (AST) mà appRouter không có trong tập step-up").toEqual([]);
  }, 120_000);

  it("★★ danh sách trong hằng KHÔNG gõ sai: mọi path chính xác đều là thủ tục THẬT; mọi tiền tố có ít nhất một thủ tục", () => {
    for (const [ten, cfg] of Object.entries(NHOM_THU_TUC_NHAY_CAM)) {
      for (const p of cfg.chinhXac) expect(trpcProcedureType(appRouter, p), `${ten}: ${p} không tồn tại`).toBeDefined();
      const procs = Object.keys(appRouter._def.procedures as Record<string, unknown>);
      for (const t of cfg.tienTo) expect(procs.some((p) => p.startsWith(t)), `${ten}: tiền tố ${t} không khớp thủ tục nào`).toBe(true);
    }
  }, 120_000);

  it("★★ twoFactor.getStatus (query) không bị đếm; mọi MUTATION twoFactor.* đều bị đếm", () => {
    const tap = layTapThuTucStepUp(appRouter, [requireFreshTotp, requirePerCallFreshTotp]);
    const procs = Object.keys(appRouter._def.procedures as Record<string, unknown>).filter((p) => p.startsWith("twoFactor."));
    expect(procs.length).toBeGreaterThan(0);
    for (const p of procs) {
      const loai = trpcProcedureType(appRouter, p);
      expect(phanNhomThuTuc(p, loai, tap) === "2fa").toBe(loai !== "query");
    }
  }, 120_000);
});

/**
 * ★★★ Bề mặt thứ HAI xác minh TOTP: `kiemXacThucTheoMuc` (→ `verifyFreshTotp` → `verifyTotpOnce`) KHÔNG đi qua middleware step-up nên tập suy từ appRouter không thấy.
 * Mỗi file sản xuất GỌI nó phải có mặt ở bảng dưới: hàm bao ngoài (AST) → thủ tục tRPC của router gọi hàm ấy. File mới / hàm mới gọi nó mà bảng chưa cập nhật ⇒ ĐỎ.
 * Thủ tục phải thuộc nhóm "2fa", TRỪ khi có `mienTru` (lý do bằng văn bản).
 */
/**
 * `mienTru`: chuỗi = miễn trừ cho MỌI thủ tục của mục; đối tượng = miễn trừ THEO THỦ TỤC (R1b-1 T9 fix round 1 — một hàm dùng chung, có thủ tục
 * trong nhóm, có thủ tục miễn trừ).
 */
const BE_MAT_GOI_KIEM_XAC_THUC_THEO_MUC: Record<
  string,
  Record<string, { routerFile: string | string[]; thuTuc: string | string[]; mienTru?: string | Record<string, string> }>
> = {
  "server/services/scada/lenhHmi.ts": {
    xacNhanGhiTag: {
      routerFile: "server/routers/scadaCommandsRouter.ts",
      thuTuc: "scadaCommands.confirm",
      // R1a final I-1 (2026-10-24) — ĐẢO "Ruling (merge follow-up)".
      mienTru:
        "Dò TOTP đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 lần / 5 phút, tính lượt TRƯỚC khi xác minh nên batch không lách được). Nhóm 20 / 15 phút dùng chung theo IP và theo người với deploy và twoFactor sẽ bóp các lệnh đổi giá trị đặt HMI mức 1/3 thường ngày.",
    },
  },
  // kiem-dinh P1-2 (2026-10-24) — đổi cấu hình kênh / chế độ M12 đòi TOTP TƯƠI (mức 5) ⇒ THUỘC nhóm 2fa (việc cấu hình hiếm; bóp tần suất chấp nhận được).
  // 2026-10-24 · R1b-1 T9 — `kiemTotpCauHinh` chuyển từ scadaKenhRouter.ts sang services/scada/totpCauHinh.ts; thêm các bên gọi đụng tag được
  // bảo vệ: mappingAsCode.applyImport (qua `xacThucKenhDaKhai`) THUỘC nhóm 2fa; deviceAdapter.tags.create / update / delete (fix round 1) và
  // deviceAdapter.update (đổi đích / tắt adapter, I5; fix round 2) MIỄN TRỪ theo thủ tục (phán quyết T9 a).
  "server/services/scada/totpCauHinh.ts": {
    kiemTotpCauHinh: {
      routerFile: [
        "server/routers/scadaKenhRouter.ts",
        "server/routers/deviceAdapterRouter.ts",
        "server/routers/mappingAsCodeRouter.ts",
        "server/routers/scadaDiagRouter.ts",
        // 2026-10-25 · kiem-dinh R1b-1 I1 (b) — sửa / xoá luật interlock bảo vệ
        "server/routers/interlockRouter.ts",
      ],
      thuTuc: [
        "scadaKenh.capNhat",
        "scadaKenh.cheDo.dat",
        "scadaKenh.cheDo.go",
        "mappingAsCode.applyImport",
        "deviceAdapter.update",
        "deviceAdapter.tags.create",
        "deviceAdapter.tags.update",
        "deviceAdapter.tags.delete",
        "deviceAdapter.delete",
        "scadaDiag.tamTat",
        // 2026-10-25 · kiem-dinh R1b-1 H1 (a) — ghim DỪNG (STOP HMI gửi ghim một bước, mức 1) ⇒ sàn vai ACTUATION + TOTP tươi mức 5 MỖI lượt.
        "deviceAdapter.tags.setStopPin",
        // 2026-10-25 · kiem-dinh R1b-1 I1 (b) — sửa / xoá luật interlock ĐANG BẬT hoặc ĐÃ DUYỆT có đích / nguồn tag ⇒ TOTP tươi mức 5.
        "interlock.update",
        "interlock.delete",
      ],
      mienTru: {
        // 2026-10-25 · kiem-dinh R1b-1 I1 (b) — miễn nhóm 2fa (khuôn tags.*: chỉ đòi mã có điều kiện; T16 theo tài khoản).
        "interlock.update": "kiem-dinh R1b-1 I1 b (điều phối 2026-10-25): chỉ xác minh TOTP khi sửa một luật ghi lệnh ĐANG BẬT hoặc ĐÃ DUYỆT có đích / nguồn tag (luật nháp, luật alert ⇒ không mã); dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt soạn luật thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa (khuôn tags.update).",
        "interlock.delete": "kiem-dinh R1b-1 I1 b (điều phối 2026-10-25): chỉ xác minh TOTP khi xoá một luật ghi lệnh ĐANG BẬT hoặc ĐÃ DUYỆT có đích / nguồn tag (luật nháp, luật alert ⇒ không mã); dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ dọn luật nháp thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa (khuôn tags.delete).",
        // 2026-10-25 · kiem-dinh R1b-1 H1 (a) — miễn nhóm 2fa (cùng khuôn lý do với tags.*: khoá T16 theo tài khoản).
        "deviceAdapter.tags.setStopPin": "kiem-dinh R1b-1 H1 a (điều phối 2026-10-25): ghim DỪNG đặt / gỡ THEO TỪNG TAG, thành loạt lúc commissioning (mỗi tag một lượt, mỗi lượt một mã tươi mức 5); dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ một đợt ghim 20+ tag ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa (khuôn tags.update).",
        "deviceAdapter.tags.create": "Phán quyết T9 a (2026-10-24, fix round 1): chỉ xác minh TOTP khi đụng tag được bảo vệ / khoá mồ côi; dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt sửa tag thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa (khuôn scadaCommands.confirm).",
        "deviceAdapter.tags.update": "Phán quyết T9 a (2026-10-24, fix round 1): chỉ xác minh TOTP khi đụng tag được bảo vệ / khoá mồ côi; dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt sửa tag thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa (khuôn scadaCommands.confirm).",
        "deviceAdapter.tags.delete": "Phán quyết T9 a (2026-10-24, fix round 1): chỉ xác minh TOTP khi đụng tag được bảo vệ / khoá mồ côi; dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt sửa tag thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa (khuôn scadaCommands.confirm).",
        // 2026-10-24 · R1b-1 T9 fix round 2 — deviceAdapter.update RA khỏi nhóm (phán quyết a mở rộng).
        "deviceAdapter.update": "Phán quyết T9 a (2026-10-24, fix round 2): chỉ xác minh TOTP khi đổi đích / tắt adapter có tag được bảo vệ; dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt lưu adapter / công tắc Bật thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa.",
        // 2026-10-24 · R1b-1 T9 fix round 3 (N1/N3) — xoá adapter + tạm tắt adapter (scadaDiag) đi qua cùng cổng adapter ⇒ cùng miễn trừ.
        // 2026-10-24 · R1b-1 T10b (n4) — lý do ghi đúng vòng (fix round 3, không phải 2) và đúng việc (xoá / tạm tắt, không phải đổi đích).
        "deviceAdapter.delete": "Phán quyết T9 a (2026-10-24, áp ở fix round 3 — N3): chỉ xác minh TOTP khi XOÁ một adapter còn tag được bảo vệ (cổng adapter dùng chung congAdapterTx); dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt xoá adapter thường ngày ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa.",
        "scadaDiag.tamTat": "Phán quyết T9 a (2026-10-24, áp ở fix round 3 — N1): chỉ xác minh TOTP khi TẠM TẮT một adapter đang bật còn tag được bảo vệ (cổng adapter dùng chung congAdapterTx); dò mã đã bị chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce (5 sai / 5 phút, tính TRƯỚC khi xác minh). Nhóm 2fa đếm theo PATH ở rìa ⇒ mọi lượt tạm tắt adapter khi chẩn đoán ăn chung xô 20 / 15 phút theo IP với 2FA / deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa.",
      },
    },
  },
  "server/services/aiCopilotActions.ts": {
    confirmAction: {
      routerFile: "server/routers/aiCopilotRouter.ts",
      thuTuc: "aiCopilot.confirmAction",
      mienTru:
        "Sau T10 confirmAction KHÔNG BAO GIỜ xác minh TOTP thật: mức >= 4 bị từ chối TRƯỚC mọi kiểm TOTP, mức 1/3 trả khong_can. Xếp vào nhóm 2fa (20/15 phút) sẽ bóp MỌI xác nhận AI, kể cả tác nhân lập trình.",
    },
  },
};

/** Mọi lời gọi `kiemXacThucTheoMuc(...)` trong file → tên hàm khai báo bao ngoài gần nhất ("?" nếu không phải hàm có tên). */
function hamGoiKiemXacThucTheoMuc(duong: string): string[] {
  const src = ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
  const ra: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "kiemXacThucTheoMuc") {
      let ten = "?";
      for (let cur: ts.Node | undefined = n.parent; cur; cur = cur.parent) {
        if (ts.isFunctionDeclaration(cur) && cur.name) {
          ten = cur.name.text;
          break;
        }
      }
      ra.push(ten);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return ra;
}

/** File có MỘT lời gọi tên `ham(` (đã bỏ chú thích) — để chứng minh router thật gọi hàm dịch vụ. */
function fileGoiHam(duong: string, ham: string): boolean {
  const nguon = readFileSync(duong, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return new RegExp(`\\b${ham}\\s*\\(`).test(nguon);
}

describe("census kiemXacThucTheoMuc — thủ tục tRPC xác minh TOTP qua mức rủi ro cũng thuộc nhóm 2fa", () => {
  it("★★★ MỌI file sản xuất gọi kiemXacThucTheoMuc (ngoài định nghĩa) có trong bảng; mỗi hàm bao ngoài có mục riêng (file/hàm mới ⇒ ĐỎ)", () => {
    const file = moiFileTs(path.join(GOC, "server"))
      .map((p) => path.relative(GOC, p).split(path.sep).join("/"))
      .filter((r) => r !== "server/_core/xacThucTheoMuc.ts")
      .filter((r) => /\bkiemXacThucTheoMuc\s*\(/.test(readFileSync(path.join(GOC, r), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")))
      .sort();
    expect(file).toEqual(Object.keys(BE_MAT_GOI_KIEM_XAC_THUC_THEO_MUC).sort());
    for (const f of file) {
      const ham = [...new Set(hamGoiKiemXacThucTheoMuc(path.join(GOC, f)))].sort();
      expect(ham, `${f}: hàm gọi kiemXacThucTheoMuc không khớp bảng`).toEqual(Object.keys(BE_MAT_GOI_KIEM_XAC_THUC_THEO_MUC[f]!).sort());
    }
  }, 60_000);

  it("★★★ MỖI thủ tục tRPC trong bảng là thủ tục THẬT của appRouter, router thật gọi hàm dịch vụ, và thuộc nhóm 2fa (trừ mục miễn trừ có lý do)", () => {
    const tap = layTapThuTucStepUp(appRouter, [requireFreshTotp, requirePerCallFreshTotp]);
    let dem = 0;
    let mien = 0;
    for (const [file, hams] of Object.entries(BE_MAT_GOI_KIEM_XAC_THUC_THEO_MUC)) {
      for (const [ham, m] of Object.entries(hams)) {
        for (const rf of Array.isArray(m.routerFile) ? m.routerFile : [m.routerFile]) {
          expect(fileGoiHam(path.join(GOC, rf), ham), `${rf} không gọi ${ham} (${file})`).toBe(true);
        }
        for (const thuTuc of Array.isArray(m.thuTuc) ? m.thuTuc : [m.thuTuc]) {
          const loaiTT = trpcProcedureType(appRouter, thuTuc);
          expect(loaiTT, `${thuTuc} không tồn tại ở appRouter`).toBeDefined();
          const nhom = phanNhomThuTuc(thuTuc, loaiTT, tap);
          const lyDoMien = typeof m.mienTru === "string" ? m.mienTru : m.mienTru?.[thuTuc];
          if (lyDoMien) {
            expect(lyDoMien.length, `${thuTuc}: lý do miễn trừ quá ngắn`).toBeGreaterThan(40);
            // Miễn trừ là RÀNG BUỘC: thủ tục miễn trừ KHÔNG được nằm trong nhóm 2fa (thêm lại vào nhóm ⇒ phải xoá miễn trừ, kèm phán quyết mới).
            expect(nhom, `${thuTuc} có miễn trừ nhưng vẫn thuộc nhóm 2fa`).not.toBe("2fa");
            mien++;
          } else {
            expect(nhom, `${thuTuc} xác minh TOTP qua kiemXacThucTheoMuc (${ham}) nhưng KHÔNG thuộc nhóm 2fa`).toBe("2fa");
            dem++;
          }
        }
      }
    }
    // 2026-10-24 · kiem-dinh P1-2: 2 → 5 (+ scadaKenh.capNhat / cheDo.dat / cheDo.go, THUỘC nhóm 2fa).
    // 2026-10-24 · R1b-1 T9: 5 → 7 (+ deviceAdapter.tags.update / mappingAsCode.applyImport, THUỘC nhóm 2fa).
    // 2026-10-24 · R1b-1 T9 fix round 1: 7 → 10 — tags.update RA khỏi nhóm (miễn trừ, phán quyết T9 a); + deviceAdapter.update (nhóm, I5);
    //   + deviceAdapter.tags.create / tags.delete (miễn trừ, cùng lý do với tags.update).
    // 2026-10-24 · R1b-1 T9 fix round 2: deviceAdapter.update RA khỏi nhóm (miễn trừ, phán quyết a) — dem 5 → 4, mien 5 → 6, tổng giữ 10.
    // 2026-10-24 · R1b-1 T9 fix round 3 (N1/N3): + deviceAdapter.delete / scadaDiag.tamTat (miễn trừ, cùng lý do) — mien 6 → 8, tổng 10 → 12.
    // 2026-10-25 · kiem-dinh R1b-1 H1 (a): + deviceAdapter.tags.setStopPin (miễn trừ, khuôn tags.*) — mien 8 → 9, tổng 12 → 13.
    // 2026-10-25 · kiem-dinh R1b-1 I1 (b): + interlock.update / interlock.delete (miễn trừ, khuôn tags.*) — mien 9 → 11, tổng 13 → 15.
    expect(dem + mien).toBe(15);
    expect(dem).toBe(4); // scadaKenh ×3 + mappingAsCode.applyImport
    expect(mien).toBe(11); // aiCopilot.confirmAction + scadaCommands.confirm (R1a final I-1) + deviceAdapter.tags.create/update/delete + deviceAdapter.update/delete + scadaDiag.tamTat (T9 a) + deviceAdapter.tags.setStopPin (H1 a) + interlock.update/delete (I1 b)
  }, 120_000);
});

/**
 * ★★★ R1b-1 Task 2 (điều phối 2026-10-24) — thủ tục tRPC CỐ Ý KHÔNG thuộc nhóm giới hạn nào dù nằm cạnh các thủ tục xác minh TOTP: STOP HMI.
 * Khuôn miễn trừ của `aiCopilot.confirmAction` / `scadaCommands.confirm` ở trên — nhưng `dungMay` KHÔNG gọi `kiemXacThucTheoMuc` /
 * `verifyTotpOnce` nên không vào bảng trên được; bảng riêng này giữ cùng ràng buộc: thủ tục THẬT, `phanNhomThuTuc` trả null (không nhóm
 * nào — kể cả "2fa"), hàm dịch vụ không xác minh TOTP (AST), và lý do bằng văn bản. Thêm nó vào nhóm ⇒ ĐỎ (phải xoá miễn trừ + phán quyết mới).
 */
const MIEN_TRU_KHONG_GIOI_HAN: Record<string, { thuTuc: string; routerFile: string; ham: string; hamFile: string; mienTru: string }> = {
  "scadaCommands.dungMay": {
    thuTuc: "scadaCommands.dungMay",
    routerFile: "server/routers/scadaCommandsRouter.ts",
    ham: "dungMayHmi",
    hamFile: "server/services/scada/lenhHmi.ts",
    mienTru: "STOP không bao giờ bị phần mềm chặn; không xác minh TOTP",
  },
};

/** Thân của một hàm khai báo tên `ham` trong file (AST); null nếu không có. */
function thanHam(duong: string, ham: string): ts.FunctionDeclaration | null {
  const src = ts.createSourceFile(duong, readFileSync(duong, "utf8"), ts.ScriptTarget.Latest, true);
  let ra: ts.FunctionDeclaration | null = null;
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === ham) ra = n;
    ts.forEachChild(n, visit);
  };
  visit(src);
  return ra;
}

/** Tên mọi hàm được GỌI trong một nút (AST), kể cả lồng. */
function tenHamDuocGoi(n: ts.Node, ra = new Set<string>()): Set<string> {
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) ra.add(n.expression.text);
  ts.forEachChild(n, (c) => void tenHamDuocGoi(c, ra));
  return ra;
}

describe("census miễn trừ giới hạn — STOP HMI không bao giờ bị bộ giới hạn theo thủ tục chặn", () => {
  it("★★★ mỗi mục là thủ tục THẬT, router gọi hàm dịch vụ, KHÔNG thuộc nhóm nào (phanNhomThuTuc = null), hàm không xác minh TOTP", () => {
    const tap = layTapThuTucStepUp(appRouter, [requireFreshTotp, requirePerCallFreshTotp]);
    let dem = 0;
    for (const [p, m] of Object.entries(MIEN_TRU_KHONG_GIOI_HAN)) {
      expect(m.thuTuc).toBe(p);
      expect(m.mienTru.length, `${p}: phải có lý do bằng văn bản`).toBeGreaterThan(20);
      const loaiTT = trpcProcedureType(appRouter, p);
      expect(loaiTT, `${p} không tồn tại ở appRouter`).toBe("mutation");
      expect(fileGoiHam(path.join(GOC, m.routerFile), m.ham), `${m.routerFile} không gọi ${m.ham}`).toBe(true);
      expect(phanNhomThuTuc(p, loaiTT, tap), `${p} có miễn trừ nhưng bị xếp vào một nhóm giới hạn`).toBeNull();
      expect(tap.has(p), `${p} đứng trên bước nâng cấp 2FA (requireFreshTotp)`).toBe(false);
      const fn = thanHam(path.join(GOC, m.hamFile), m.ham);
      expect(fn, `${m.hamFile}: không thấy hàm ${m.ham}`).not.toBeNull();
      const goi = tenHamDuocGoi(fn!);
      for (const cam of ["verifyTotpOnce", "kiemXacThucTheoMuc", "verifyFreshTotp"]) expect(goi.has(cam), `${m.ham} gọi ${cam}`).toBe(false);
      dem++;
    }
    expect(dem).toBe(1);
  }, 120_000);
});

describe("gắn middleware trong index.ts", () => {
  it("★★★ thứ tự: trần batch → giới hạn theo thủ tục → giấy phép → tRPC; có truyền bước nâng cấp 2FA", () => {
    const nguon = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    const iTran = nguon.indexOf('app.use("/api/trpc", trpcBatchLimitMiddleware())');
    const iGioiHan = nguon.indexOf('app.use("/api/trpc", trpcGioiHanThuTucMiddleware({ router: appRouter, buocNangCap: [requireFreshTotp, requirePerCallFreshTotp] }))');
    const iGiayPhep = nguon.indexOf('app.use("/api/trpc", licenseEnforcementMiddleware(');
    expect(iTran).toBeGreaterThan(-1);
    expect(iGioiHan).toBeGreaterThan(iTran);
    expect(iGiayPhep).toBeGreaterThan(iGioiHan);
  });
});
