/**
 * ★★★ LƯỚI CHO MẶT RÒ DỮ LIỆU CỦA ĐỢT D — BA TOOL ĐỌC CỤC BỘ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY LÀ TỆP QUAN TRỌNG NHẤT CỦA ĐỢT D
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kết quả của ba tool `doc_tep`/`liet_ke`/`grep` **RỜI MÁY LẬP TRÌNH VIÊN**: chúng được nhét vào
 * câu hỏi gửi lên máy chủ để model đọc. Mọi byte lọt qua đây là byte **đã rời máy** — không có
 * bước "hoàn tác" nào.
 *
 * ★★★ R-D2 — HAI TẦNG, VÀ TẦNG THỨ HAI MỚI LÀ TẦNG THẬT:
 *   (a) Tệp bị cấm bị loại khỏi **TẬP QUÉT** TRƯỚC khi tìm ⇒ `grep` không mở chúng ra;
 *   (b) `cheBiMat` **mọi dòng trả về**, kể cả dòng đến từ tệp HỢP LỆ — một khoá hardcode trong
 *       `src/config.ts` cũng là khoá.
 * Hàng rào mức-TỆP (`duocPhepGuiNoiDung`) một mình KHÔNG đủ: `grep` quét NỘI DUNG và trả về TỪNG
 * DÒNG, nên nó trích được đúng dòng `DATABASE_URL=postgres://user:pass@…` từ `.env` mà không hề
 * "đọc" tệp đó theo nghĩa của hàng rào tệp.
 *
 * ⚠⚠ MỌI CA Ở ĐÂY ĐO **KẾT CỤC**, KHÔNG ĐO Ý ĐỊNH. Ca "grep bỏ qua tệp `.env`" chỉ chứng minh ta
 *    đã viết một lệnh lọc; ca "chuỗi bí mật KHÔNG có trong kết quả" mới chứng minh nó không rò.
 *    Hai câu đó khác nhau, và chỉ câu sau mới bắt được lỗi. Ca #1 dưới đây khẳng định CẢ HAI, với
 *    khẳng định-kết-cục là khẳng định chính.
 * ⚠⚠ Và ca #1 phải khẳng định thêm rằng kết quả HỢP LỆ VẪN CÓ MẶT — một cài đặt hỏng trả về chuỗi
 *    rỗng sẽ thoả mọi khẳng định "không chứa bí mật" một cách vô nghĩa.
 */
import { describe, it, expect } from "vitest";
import {
  TRAN_BYTE_DOC_TEP,
  dinhDangDocTep,
  dinhDangLietKe,
  duocPhepDoc,
  grepThuan,
  locTapQuet,
} from "./docCucBo";

const WS = process.platform === "win32" ? "C:\\ws" : "/ws";
const trongWs = (p: string): string => (process.platform === "win32" ? `${WS}\\${p.replace(/\//g, "\\")}` : `${WS}/${p}`);

/** Chuỗi bí mật dựng riêng cho lưới — KHÔNG khớp khuôn khoá thật của bất kỳ nhà cung cấp nào. */
const MAT_KHAU_TRONG_ENV = "sieu-mat-khau-cua-toi";
const KHOA_TRONG_TEP_HOP_LE = "sk-KHONG-PHAI-KHOA-THAT-0000000000";

/** Một workspace thử: hai tệp mã bình thường + `.env` + một khoá riêng. */
function dungUngVien(): Array<{ duong: string; nhan: string }> {
  return [
    { duong: trongWs("src/Calculator.cs"), nhan: "src/Calculator.cs" },
    { duong: trongWs(".env"), nhan: ".env" },
    { duong: trongWs("src/config.ts"), nhan: "src/config.ts" },
    { duong: trongWs("keys/id_rsa"), nhan: "keys/id_rsa" },
  ];
}

const NOI_DUNG: Record<string, string> = {
  "src/Calculator.cs": [
    "public class Calculator {",
    "  // DATABASE_URL duoc doc tu cau hinh, khong hardcode",
    "  public int Cong(int a, int b) => a + b;",
    "}",
  ].join("\n"),
  ".env": [
    `DATABASE_URL=postgres://nguoidung:${MAT_KHAU_TRONG_ENV}@10.0.0.7:5432/db`,
    "GHI_CHU_NOI_BO=DATABASE_URL dung cho ca hai moi truong",
  ].join("\n"),
  "src/config.ts": [
    `export const khoa = "${KHOA_TRONG_TEP_HOP_LE}";`,
    `export const chuoiKetNoi = "postgres://nguoidung:${MAT_KHAU_TRONG_ENV}@10.0.0.7:5432/db";`,
    "export const ten = \"DATABASE_URL\";",
  ].join("\n"),
  "keys/id_rsa": "-----BEGIN OPENSSH PRIVATE KEY-----\nDATABASE_URL-nhung-that-ra-la-khoa\n-----END OPENSSH PRIVATE KEY-----",
};

/** Bản đọc GIẢ có GHI SỔ: nó cho ta đo được tệp nào đã bị **MỞ RA**, không chỉ tệp nào lọt kết quả. */
function docGia(so: string[]): (duong: string) => string {
  return (duong: string) => {
    so.push(duong);
    for (const [nhan, noiDung] of Object.entries(NOI_DUNG)) {
      if (duong.endsWith(nhan.replace(/\//g, process.platform === "win32" ? "\\" : "/"))) return noiDung;
    }
    throw new Error(`không đọc được: ${duong}`);
  };
}

describe("docCucBo — grep KHÔNG rò nội dung tệp cấm (R-D2, tầng a + tầng b)", () => {
  it("★★★ KẾT CỤC: không dòng nào của `.env` xuất hiện trong kết quả grep — mà kết quả HỢP LỆ vẫn còn", () => {
    const so: string[] = [];
    const kq = grepThuan("DATABASE_URL", dungUngVien(), docGia(so));

    // (1) KẾT CỤC — khẳng định CHÍNH: không byte nào của `.env` rời máy.
    expect(kq).not.toContain(MAT_KHAU_TRONG_ENV);
    expect(kq).not.toContain("GHI_CHU_NOI_BO");
    expect(kq).not.toContain(".env");

    // (2) Ý ĐỊNH — khẳng định phụ: `.env` và khoá riêng không hề được MỞ RA (tầng a).
    expect(so.some((p) => p.endsWith(".env"))).toBe(false);
    expect(so.some((p) => p.includes("id_rsa"))).toBe(false);

    // (3) ⚠ CHỐNG TỰ THOẢ: một cài đặt trả chuỗi rỗng thoả cả (1) lẫn (2) mà vô dụng.
    expect(kq).toContain("src/Calculator.cs");
    expect(kq).toContain("2:");
  });

  it("★★★ dòng từ tệp HỢP LỆ vẫn phải qua `cheBiMat` — khoá hardcode trong `src/config.ts` là khoá", () => {
    const so: string[] = [];
    const kq = grepThuan("postgres://", dungUngVien(), docGia(so));

    expect(kq).toContain("src/config.ts");
    expect(kq).not.toContain(MAT_KHAU_TRONG_ENV);
    expect(kq).toContain("«đã che»");
  });

  it("★★ `mau` không khớp gì ⇒ nói RÀNH MẠCH là không có kết quả (không phải chuỗi trống mơ hồ)", () => {
    const so: string[] = [];
    const kq = grepThuan("khong-he-ton-tai-trong-workspace-nay", dungUngVien(), docGia(so));

    expect(kq).toContain("KHÔNG có kết quả");
    expect(kq.trim().length).toBeGreaterThan(20);
  });

  it("★★ vượt trần số kết quả ⇒ KHAI RÕ là đã cắt", () => {
    const ungVien = [{ duong: trongWs("src/nhieu.ts"), nhan: "src/nhieu.ts" }];
    const noiDung = Array.from({ length: 50 }, (_, i) => `dong ${i} co MOC`).join("\n");
    const kq = grepThuan("MOC", ungVien, () => noiDung, 5);

    expect(kq).toContain("ĐÃ CẮT");
    expect(kq.split("\n").filter((d) => d.includes("src/nhieu.ts")).length).toBe(5);
  });

  it("★★ tệp đọc lỗi ⇒ bỏ qua tệp đó, KHÔNG làm hỏng cả lượt tìm", () => {
    const ungVien = [
      { duong: trongWs("src/hong.ts"), nhan: "src/hong.ts" },
      { duong: trongWs("src/Calculator.cs"), nhan: "src/Calculator.cs" },
    ];
    const so: string[] = [];
    const doc = docGia(so);
    const kq = grepThuan("DATABASE_URL", ungVien, doc);
    expect(kq).toContain("src/Calculator.cs");
  });

  it("★★★ H2: thân khoá PEM dán trong tệp HỢP LỆ KHÔNG rời máy qua grep (luật PEM ĐA DÒNG)", () => {
    /**
     * `keys/id_rsa` KHÔNG đo được lỗ này — nó bị chặn ở tầng (a) TRƯỚC khi thân của nó tới đây, nên
     * nhánh đa dòng của `cheBiMat` (luật 1, cần BEGIN+END trong CÙNG một chuỗi) chưa từng bị đo.
     * Đặt khối PEM ngay trong `src/config.ts` (tệp KHÔNG nằm trong danh sách cấm nào) để buộc dữ
     * liệu đi qua đúng nhánh grep-từng-dòng — đây là nhánh trước bản vá để lọt thân base64 nguyên văn.
     */
    const than1 = "MIIEowIBAAKCAQEAsecretbodyline1";
    const than2 = "MIIEowIBAAKCAQEAsecretbodyline2";
    const ungVien = [
      { duong: trongWs("src/config.ts"), nhan: "src/config.ts" },
      { duong: trongWs("src/Calculator.cs"), nhan: "src/Calculator.cs" },
    ];
    const noiDungPem: Record<string, string> = {
      "src/config.ts": ["-----BEGIN RSA PRIVATE KEY-----", than1, than2, "-----END RSA PRIVATE KEY-----"].join("\n"),
      "src/Calculator.cs": NOI_DUNG["src/Calculator.cs"],
    };
    const doc = (duong: string): string => {
      for (const [nhan, nd] of Object.entries(noiDungPem)) {
        if (duong.endsWith(nhan.replace(/\//g, process.platform === "win32" ? "\\" : "/"))) return nd;
      }
      throw new Error(`không đọc được: ${duong}`);
    };

    const kq = grepThuan("MII", ungVien, doc);

    // KẾT CỤC (khẳng định chính) — thân base64 KHÔNG có mặt trong thứ được gửi đi.
    expect(kq).not.toContain(than1);
    expect(kq).not.toContain(than2);
    // ⚠ CHỐNG TỰ THOẢ: vẫn CÓ kết quả — chỉ là đã bị che, không phải "không tìm thấy gì".
    expect(kq).toContain("«đã che»");
    expect(kq).toContain("src/config.ts");
  });
});

describe("docCucBo — `.git/**` KHÔNG rời máy qua grep/liet_ke (vòng sửa 1)", () => {
  const NOI_DUNG_GIT: Record<string, string> = {
    ".git/config": [
      '[remote "origin"]',
      `  url = https://nguoidung:${MAT_KHAU_TRONG_ENV}@github.com/x/y.git`,
      "  MOC_TU_GIT = DATABASE_URL",
    ].join("\n"),
    ".gitignore": "# DATABASE_URL khong bao gio commit\nnode_modules/",
    "src/Calculator.cs": "// DATABASE_URL doc tu cau hinh",
  };

  function docGiaGit(so: string[]): (duong: string) => string {
    return (duong: string) => {
      so.push(duong);
      for (const [nhan, noiDung] of Object.entries(NOI_DUNG_GIT)) {
        if (duong.endsWith(nhan.replace(/\//g, process.platform === "win32" ? "\\" : "/"))) return noiDung;
      }
      throw new Error(`không đọc được: ${duong}`);
    };
  }

  const ungVienGit = [
    { duong: trongWs(".git/config"), nhan: ".git/config" },
    { duong: trongWs(".gitignore"), nhan: ".gitignore" },
    { duong: trongWs("src/Calculator.cs"), nhan: "src/Calculator.cs" },
  ];

  it("★★★ KẾT CỤC: grep KHÔNG trả dòng nào từ `.git/` — mà `.gitignore` thì VẪN trả", () => {
    const so: string[] = [];
    const kq = grepThuan("DATABASE_URL", ungVienGit, docGiaGit(so));

    // KẾT CỤC (khẳng định chính)
    expect(kq).not.toContain("MOC_TU_GIT");
    expect(kq).not.toContain(MAT_KHAU_TRONG_ENV);
    expect(kq).not.toContain(".git/config");
    // Ý ĐỊNH (khẳng định phụ): tệp ấy không hề được MỞ RA.
    expect(so.some((p) => p.includes(".git") && !p.includes(".gitignore"))).toBe(false);
    // ⚠ CHỐNG CHẶN NHẦM + CHỐNG TỰ THOẢ: `.gitignore` KHÔNG phải `.git`, phải còn nguyên.
    expect(kq).toContain(".gitignore");
    expect(kq).toContain("src/Calculator.cs");
  });

  it("★★★ liet_ke KHÔNG liệt kê gì trong `.git/`, nhưng VẪN liệt kê `.gitignore`", () => {
    const kq = dinhDangLietKe("ws", [".git/config", ".git/hooks/pre-commit", ".gitignore", "src/a.ts"]);
    expect(kq).not.toContain(".git/config");
    expect(kq).not.toContain("pre-commit");
    expect(kq).toContain(".gitignore");
    expect(kq).toContain("src/a.ts");
    expect(kq).toContain("đã loại 2");
  });
});

describe("docCucBo — liet_ke loại tệp cấm khỏi DANH SÁCH", () => {
  it("★★★ `.env` và khoá riêng KHÔNG có trong danh sách; tệp mã thường thì CÓ", () => {
    const kq = dinhDangLietKe("src", [".env", ".env.local", "src/Calculator.cs", "keys/id_rsa", "certs/tls.pem", "src/config.ts"]);

    expect(kq).not.toContain(".env");
    expect(kq).not.toContain("id_rsa");
    expect(kq).not.toContain("tls.pem");
    expect(kq).toContain("src/Calculator.cs");
    expect(kq).toContain("src/config.ts");
  });

  it("★★★ số tệp bị loại phải được KHAI RA — bỏ im lặng là đưa model một sự thật một nửa", () => {
    const kq = dinhDangLietKe("src", [".env", "src/a.ts"]);
    expect(kq).toContain("đã loại 1");
  });

  it("★★ vượt trần số mục ⇒ KHAI RÕ là đã cắt", () => {
    const ds = Array.from({ length: 40 }, (_, i) => `src/tep${i}.ts`);
    const kq = dinhDangLietKe("src", ds, 10);
    expect(kq).toContain("ĐÃ CẮT");
    expect(kq).toContain("src/tep0.ts");
    expect(kq).not.toContain("src/tep39.ts");
  });

  it("★★ tập nguồn bị cắt ở tầng tìm kiếm cũng phải KHAI — cắt ở đâu cũng là cắt", () => {
    const kq = dinhDangLietKe("src", ["src/a.ts"], 10, true);
    expect(kq).toContain("ĐÃ CẮT");
  });

  it("★★★ tệp nhạy cảm bị loại ở LỚP TRÊN vẫn phải được KHAI (lỗ ở KHE GIỮA hai lớp)", () => {
    /**
     * `mang/toolCucBo.ts` lọc tệp nhạy cảm khỏi tập ứng viên TRƯỚC khi gọi hàm này (tầng (a) của
     * R-D2). Nếu nó không ĐẾM và truyền con số ấy vào, `soBiChan` ở đây bằng 0 và lời khai biến
     * mất — mỗi lớp nhìn riêng đều đúng, còn kết cục là model tưởng danh sách đã đầy đủ.
     */
    const kq = dinhDangLietKe("src", ["src/a.ts"], 10, false, 2);
    expect(kq).toContain("đã loại 2");
  });

  it("★ thư mục rỗng ⇒ nói rành mạch, không trả chuỗi trống", () => {
    const kq = dinhDangLietKe("src", []);
    expect(kq).toContain("KHÔNG có tệp");
  });
});

describe("docCucBo — doc_tep: che TRƯỚC, cắt SAU, và KHAI khi đã cắt", () => {
  it("★★★ khoá trong một tệp HỢP LỆ vẫn bị che", () => {
    const kq = dinhDangDocTep("src/config.ts", NOI_DUNG["src/config.ts"]);
    expect(kq).not.toContain(KHOA_TRONG_TEP_HOP_LE);
    expect(kq).not.toContain(MAT_KHAU_TRONG_ENV);
    expect(kq).toContain("«đã che»");
    // ⚠ CHỐNG TỰ THOẢ: phần mã KHÔNG bí mật phải còn nguyên.
    expect(kq).toContain("export const ten");
  });

  it("★★★ vượt trần byte ⇒ kết quả CHỨA LỜI KHAI đã cắt (kiểm CHUỖI, không chỉ kiểm độ dài)", () => {
    const dai = "a".repeat(500);
    const kq = dinhDangDocTep("src/dai.ts", dai, 64);
    expect(kq).toContain("ĐÃ CẮT");
    expect(kq).toContain("500");
    expect(kq).not.toContain("a".repeat(200));
  });

  it("★★★ CHE TRƯỚC rồi mới CẮT — nếu cắt trước, một bí mật bị xẻ đôi sẽ lọt nguyên nửa đầu", () => {
    /**
     * `postgres://nguoidung:<mật khẩu>@host` chỉ khớp luật che khi CÓ dấu `@`. Cắt trước dấu `@`
     * rồi mới che ⇒ luật không khớp nữa và nửa đầu mật khẩu rời máy nguyên văn. Ca này đặt bí mật
     * ngay trước ranh giới cắt để bắt đúng thứ tự ấy.
     */
    const than = `x = "postgres://nguoidung:${MAT_KHAU_TRONG_ENV}@10.0.0.7:5432/db";\n${"z".repeat(300)}`;
    const kq = dinhDangDocTep("src/a.ts", than, 40);
    expect(kq).not.toContain(MAT_KHAU_TRONG_ENV);
    expect(kq).not.toContain("sieu-mat-khau");
  });

  it("★ dưới trần ⇒ KHÔNG khai bừa là đã cắt", () => {
    const kq = dinhDangDocTep("src/a.ts", "int a = 1;");
    expect(kq).not.toContain("ĐÃ CẮT");
    expect(kq).toContain("int a = 1;");
  });

  it("★ trần mặc định là 64 KB", () => {
    expect(TRAN_BYTE_DOC_TEP).toBe(64 * 1024);
  });
});

describe("docCucBo — hàng rào ĐƯỜNG DẪN cho lượt ĐỌC", () => {
  it("★★ tệp NGOÀI mọi thư mục workspace ⇒ từ chối, có `lyDo`", () => {
    const ngoai = process.platform === "win32" ? "C:\\Users\\Admin\\.ssh\\id_ed25519" : "/home/admin/.ssh/id_ed25519";
    const kq = duocPhepDoc(ngoai, [WS]);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.lyDo.length).toBeGreaterThan(10);
  });

  it("★★ bẫy TIỀN TỐ CHUỖI: `C:\\ws-khac\\x.cs` KHÔNG nằm trong `C:\\ws`", () => {
    const canh = process.platform === "win32" ? "C:\\ws-khac\\x.cs" : "/ws-khac/x.cs";
    expect(duocPhepDoc(canh, [WS]).ok).toBe(false);
  });

  it("★★ đường TƯƠNG ĐỐI ⇒ từ chối (không đoán gốc)", () => {
    expect(duocPhepDoc("src/a.ts", [WS]).ok).toBe(false);
  });

  it("★★ KHÔNG có workspace nào đang mở ⇒ từ chối mọi lượt đọc", () => {
    expect(duocPhepDoc(trongWs("src/a.ts"), []).ok).toBe(false);
  });

  it("★★★ `.env` trong workspace ⇒ vẫn TỪ CHỐI (hàng rào mức TỆP)", () => {
    expect(duocPhepDoc(trongWs(".env"), [WS]).ok).toBe(false);
    expect(duocPhepDoc(trongWs(".env.production"), [WS]).ok).toBe(false);
    expect(duocPhepDoc(trongWs("keys/id_rsa_work"), [WS]).ok).toBe(false);
    expect(duocPhepDoc(trongWs("certs/tls.key"), [WS]).ok).toBe(false);
  });

  it("★ tệp mã BÌNH THƯỜNG KHÔNG bị chặn nhầm — chặn nhầm là mất chức năng ÂM THẦM", () => {
    expect(duocPhepDoc(trongWs("src/Calculator.cs"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs("src/gitUtils.ts"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs(".gitignore"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs("src/keyboard.ts"), [WS]).ok).toBe(true);
  });

  it("★★★ NHÁNH KIA: danh sách CHỈ-CẤM-GHI KHÔNG được áp cho lượt ĐỌC", () => {
    /**
     * `.vscode/tasks.json` và `*.code-workspace` nguy hiểm khi **GHI** (mã sẽ chạy trên máy lập
     * trình viên) nhưng **vô hại khi ĐỌC** — chúng là văn bản, và model đọc chúng để hiểu dự án.
     * Dùng nhầm `duocPhepGhi` ở đường đọc sẽ chặn chúng và làm AI mù đúng những tệp cấu hình mà nó
     * cần nhất, một cách IM LẶNG.
     *
     * ⚠⚠ 2026-08-30 (vòng sửa 1) — `.git/hooks/pre-commit` ĐÃ RỜI KHỎI DANH SÁCH NÀY. Nó từng ở
     * đây vì "vô hại khi ĐỌC"; phán quyết mới là `.git/**` KHÔNG được rời máy (xem `camRoiMay`).
     * Nói thẳng: đây là một ca lưới BỊ ĐỔI, không phải một ca bị nới — luật chặn nó là luật MỚI
     * (`camRoiMay`), KHÔNG phải `camGhiRieng` rò sang; và bất biến gốc của ca này (danh sách
     * chỉ-cấm-GHI không được áp cho đường đọc) vẫn được hai đường còn lại canh nguyên vẹn.
     */
    expect(duocPhepDoc(trongWs(".vscode/tasks.json"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs("duan.code-workspace"), [WS]).ok).toBe(true);
  });

  it("★★★ `.git/**` bị TỪ CHỐI ĐỌC (vòng sửa 1) — token remote + lịch sử tệp đã xoá", () => {
    for (const duong of [".git/config", ".git/hooks/pre-commit", ".git/COMMIT_EDITMSG", "sub/.git/config"]) {
      const kq = duocPhepDoc(trongWs(duong), [WS]);
      expect(kq.ok, `${duong} phải bị chặn đọc`).toBe(false);
    }
  });

  it("★★★ ĐỐI CHỨNG `.git`: `.gitignore` · `.github/workflows` · `src/gitUtils.ts` VẪN đọc được", () => {
    // `.git` phải là NGUYÊN một đoạn đường dẫn. Chặn nhầm là mất chức năng ÂM THẦM.
    expect(duocPhepDoc(trongWs(".gitignore"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs(".gitattributes"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs(".github/workflows/ci.yml"), [WS]).ok).toBe(true);
    expect(duocPhepDoc(trongWs("src/gitUtils.ts"), [WS]).ok).toBe(true);
  });

  it("★★ CHÍNH thư mục gốc workspace: cấm với `doc_tep`, cho với `liet_ke`", () => {
    expect(duocPhepDoc(WS, [WS]).ok).toBe(false);
    expect(duocPhepDoc(WS, [WS], true).ok).toBe(true);
  });

  it("★★ `lyDo` cũng RỜI MÁY ⇒ chính nó cũng phải qua `cheBiMat`", () => {
    /**
     * `lyDo` được hiện lên bảng chat VÀ nhét ngược vào lượt hỏi sau để model biết vì sao lượt đọc
     * hỏng. Nó nhắc lại NGUYÊN VĂN đường dẫn model khai — mà đường dẫn ấy do model sinh, nên nó có
     * thể mang bất cứ thứ gì. Một câu từ chối cũng là một câu RỜI MÁY.
     */
    const doc = process.platform === "win32" ? "D:\\ngoai" : "/ngoai";
    const duong = `${doc}${process.platform === "win32" ? "\\" : "/"}postgres://nguoidung:${MAT_KHAU_TRONG_ENV}@h`;
    const kq = duocPhepDoc(duong, [WS]);
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect(kq.lyDo).not.toContain(MAT_KHAU_TRONG_ENV);
  });
});

describe("docCucBo — locTapQuet (tầng a dùng chung cho cả `mang/`)", () => {
  it("★★★ loại tệp cấm, GIỮ tệp mã thường", () => {
    const ra = locTapQuet([trongWs(".env"), trongWs("src/a.ts"), trongWs("keys/id_rsa"), trongWs("b.pem")]);
    expect(ra).toEqual([trongWs("src/a.ts")]);
  });
});
