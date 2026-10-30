/**
 * ★ Đợt 10.4b L0a — danh sách cấm DÙNG CHUNG cho AI ngoài (máy chủ + host extension). Bảng đột biến bắt buộc của kế hoạch v2.1 §6:
 * (4) kết quả TÌM không lòi `.env`/`uploads/`; (5) TỪNG mục deny-list + biến thể hoa-thường / ADS / symlink / junction / `..` / `\\?\` / 8.3;
 * 6b-1 deny theo TÊN gợi bí mật. Thuần — symlink/junction đo qua `realpath` GIẢ tiêm vào.
 */
import { describe, expect, it } from "vitest";
import {
  chuanHoaDuongDanNgoai,
  DOAN_THU_MUC_CAM,
  DUOI_CHO_PHEP,
  DUOI_CHO_PHEP_NGOAI,
  KHUON_TEP_CAM,
  laNoiDungNhiPhan,
  locKetQuaTimNgoai,
  phanQuyetTepNgoai,
  phanQuyetTepNgoaiThuc,
  phanQuyetThuMucNgoai,
} from "./aiNgoaiDenyList";
import * as hopCat from "../server/services/aiLocalTools/repoSandbox";

describe("cơ sở: MỘT nguồn với hộp cát máy chủ", () => {
  it("repoSandbox xuất lại CHÍNH các tập của shared (cùng đối tượng, không bản sao)", () => {
    expect(hopCat.DOAN_THU_MUC_CAM).toBe(DOAN_THU_MUC_CAM);
    expect(hopCat.KHUON_TEP_CAM).toBe(KHUON_TEP_CAM);
    expect(hopCat.DUOI_CHO_PHEP).toBe(DUOI_CHO_PHEP);
  });
  it("AI ngoài: .sql có trong cơ sở nhưng bị gỡ khỏi danh sách trắng ngoài; mã nguồn thường vẫn được", () => {
    expect(DUOI_CHO_PHEP.has(".sql")).toBe(true);
    expect(DUOI_CHO_PHEP_NGOAI.has(".sql")).toBe(false);
    for (const d of [".ts", ".py", ".cs", ".md", ".json"]) expect(DUOI_CHO_PHEP_NGOAI.has(d)).toBe(true);
  });
});

describe("phanQuyetTepNgoai — được phép", () => {
  it.each(["src/a.ts", "server/routers/aiChatRouter.ts", "README.md", "shared/x/y.json", ".gitignore", "Dockerfile", "./src/b.tsx", "src\\c.py"])("%s", (p) => {
    expect(phanQuyetTepNgoai(p)).toBeNull();
  });
});

describe("phanQuyetTepNgoai — từ chối (từng mục + biến thể)", () => {
  const CA: Array<[string, string]> = [
    // bí mật CƠ SỞ + biến thể hoa-thường / chấm-khoảng-trắng cuối (Windows bỏ chúng)
    [".env", "DENIED_SECRET"],
    [".ENV", "DENIED_SECRET"],
    [".env.local", "DENIED_SECRET"],
    [".env.bak-2026", "DENIED_SECRET"],
    ["sub/.Env.", "DENIED_SECRET"],
    [".env ", "DENIED_SECRET"],
    [".env. . ", "DENIED_SECRET"],
    ["certs/server.pem", "DENIED_SECRET"],
    ["k/x.KEY", "DENIED_SECRET"],
    ["a.pfx", "DENIED_SECRET"],
    ["a.p12", "DENIED_SECRET"],
    ["home/id_rsa", "DENIED_SECRET"],
    ["id_ed25519.pub", "DENIED_SECRET"],
    [".npmrc", "DENIED_SECRET"],
    [".netrc", "DENIED_SECRET"],
    ["_netrc", "DENIED_SECRET"],
    [".pypirc", "DENIED_SECRET"],
    [".git-credentials", "DENIED_SECRET"],
    // 6b-1 — tên gợi bí mật dù đuôi được phép
    ["config/secrets.json", "DENIED_SECRET"],
    ["db-credentials.yaml", "DENIED_SECRET"],
    ["Password.md", "DENIED_SECRET"],
    ["api_TOKEN.toml", "DENIED_SECRET"],
    ["appsettings.Production.json", "DENIED_SECRET"],
    ["appsettings.json", "DENIED_SECRET"],
    ["docker-compose.override.yml", "DENIED_SECRET"],
    ["docker-compose.yaml", "DENIED_SECRET"],
    ["settings.local.json", "DENIED_SECRET"],
    ["app.prod.yaml", "DENIED_SECRET"],
    ["config/dev-localhost.ts", "DENIED_SECRET"],
    ["kubeconfig.yaml", "DENIED_SECRET"],
    // thư mục cấm (cơ sở + ngoài), so TỪNG ĐOẠN ở mọi nấc
    ["uploads/a.ts", "DENIED_DIR"],
    ["x/UPLOADS/b.md", "DENIED_DIR"],
    ["backups/db.ts", "DENIED_DIR"],
    [".git/config", "DENIED_DIR"],
    ["node_modules/x/index.js", "DENIED_DIR"],
    ["knowledge/a.md", "DENIED_DIR"],
    ["models/ocr/x.json", "DENIED_DIR"],
    ["logs/app.txt", "DENIED_DIR"],
    ["test-results/r.json", "DENIED_DIR"],
    [".claude/settings.json", "DENIED_DIR"],
    [".superpowers/x.md", "DENIED_DIR"],
    [".ssh/known_hosts.txt", "DENIED_DIR"],
    [".aws/config.ini", "DENIED_DIR"],
    [".kube/c.yaml", "DENIED_DIR"],
    ["secrets/a.ts", "DENIED_DIR"],
    // đuôi cấm / ngoài danh sách trắng
    ["drizzle/0417.sql", "DENIED_EXT"],
    ["a.dump", "DENIED_EXT"],
    ["src/a.ts.bak", "DENIED_EXT"],
    ["data/x.csv", "DENIED_EXT"],
    ["server.log", "DENIED_EXT"],
    ["x.db", "DENIED_EXT"],
    ["bin/tool.exe", "DENIED_EXT"],
    ["x.gguf", "DENIED_EXT"],
    ["noext", "DENIED_EXT"],
    ["x.gitignore", "DENIED_EXT"],
    // hình dạng: `..`, tuyệt đối, ổ đĩa, UNC, ADS, 8.3, điều khiển, rỗng
    ["../.env", "PATH_REJECTED"],
    ["src/../../x.ts", "PATH_REJECTED"],
    ["/etc/passwd", "PATH_REJECTED"],
    ["C:\\Users\\a\\x.ts", "PATH_REJECTED"],
    ["\\\\server\\share\\a.ts", "PATH_REJECTED"],
    ["\\\\?\\C:\\repo\\.env", "PATH_REJECTED"],
    [".env::$DATA", "PATH_REJECTED"],
    ["src/a.ts:secret", "PATH_REJECTED"],
    ["ENV~1", "PATH_REJECTED"],
    ["SRC~2/a.ts", "PATH_REJECTED"],
    ["a\u0000.ts", "PATH_REJECTED"],
    ["", "PATH_REJECTED"],
    ["...", "PATH_REJECTED"],
    [".", "PATH_REJECTED"],
  ];
  it.each(CA)("%s ⇒ %s", (p, ma) => {
    expect(phanQuyetTepNgoai(p)).toBe(ma);
  });
  it("không phải chuỗi ⇒ PATH_REJECTED", () => {
    expect(phanQuyetTepNgoai(undefined)).toBe("PATH_REJECTED");
    expect(phanQuyetTepNgoai(123)).toBe("PATH_REJECTED");
  });
});

describe("đường dẫn tuyệt đối trong gốc (extension host gửi đường tuyệt đối)", () => {
  const GOC = "D:\\Repo\\Du An";
  it("trong gốc ⇒ phán theo phần tương đối (hoa-thường, `\\\\?\\`, `/` hay `\\` đều cùng tệp)", () => {
    expect(phanQuyetTepNgoai("D:\\Repo\\Du An\\src\\a.ts", GOC)).toBeNull();
    expect(phanQuyetTepNgoai("d:/repo/du an/src/a.ts", GOC)).toBeNull();
    expect(phanQuyetTepNgoai("\\\\?\\D:\\Repo\\Du An\\.env", GOC)).toBe("DENIED_SECRET");
    expect(phanQuyetTepNgoai("D:\\REPO\\DU AN\\.Env.", GOC)).toBe("DENIED_SECRET");
  });
  it("quyết định: gốc trên chia sẻ mạng UNC KHÔNG hỗ trợ cho AI ngoài ⇒ mọi đường dẫn UNC bị từ chối (hỏng theo chiều an toàn)", () => {
    expect(phanQuyetTepNgoai("\\\\may\\chia\\repo\\src\\a.ts", "\\\\may\\chia\\repo")).toBe("PATH_REJECTED");
  });
  it("ngoài gốc / tiền tố giả (`Du An2`) ⇒ PATH_REJECTED", () => {
    expect(phanQuyetTepNgoai("D:\\Repo\\Khac\\a.ts", GOC)).toBe("PATH_REJECTED");
    expect(phanQuyetTepNgoai("D:\\Repo\\Du An2\\a.ts", GOC)).toBe("PATH_REJECTED");
  });
});

describe("phanQuyetTepNgoaiThuc — symlink / junction qua realpath TIÊM", () => {
  const GOC = "/w/repo";
  const fsGia = (bang: Record<string, string>) => async (p: string) => {
    if (p in bang) return bang[p]!;
    if (p === GOC) return GOC;
    throw new Error("ENOENT");
  };
  it("symlink trong gốc trỏ tới `.env` ⇒ DENIED_SECRET (lần phán thứ hai trên đường THẬT)", async () => {
    const realpath = fsGia({ "/w/repo/src/cauHinh.ts": "/w/repo/.env" });
    expect(await phanQuyetTepNgoaiThuc("src/cauHinh.ts", { goc: GOC, realpath })).toBe("DENIED_SECRET");
  });
  it("junction thoát gốc ⇒ PATH_REJECTED; tệp thường ⇒ null; không tồn tại ⇒ PATH_REJECTED", async () => {
    const realpath = fsGia({ "/w/repo/lib/x.ts": "/w/khac/x.ts", "/w/repo/src/a.ts": "/w/repo/src/a.ts" });
    expect(await phanQuyetTepNgoaiThuc("lib/x.ts", { goc: GOC, realpath })).toBe("PATH_REJECTED");
    expect(await phanQuyetTepNgoaiThuc("src/a.ts", { goc: GOC, realpath })).toBeNull();
    expect(await phanQuyetTepNgoaiThuc("src/khongco.ts", { goc: GOC, realpath })).toBe("PATH_REJECTED");
  });
  it("phép thuần chặn TRƯỚC (không chạm đĩa với `.env`)", async () => {
    let goi = 0;
    const realpath = async (p: string) => {
      goi++;
      return p;
    };
    expect(await phanQuyetTepNgoaiThuc(".env", { goc: GOC, realpath })).toBe("DENIED_SECRET");
    expect(goi).toBe(0);
  });
});

describe("thư mục + kết quả tìm", () => {
  it("phanQuyetThuMucNgoai: gốc / thư mục thường được; thư mục cấm ⇒ DENIED_DIR; `..` ⇒ PATH_REJECTED", () => {
    expect(phanQuyetThuMucNgoai("")).toBeNull();
    expect(phanQuyetThuMucNgoai("src/routers")).toBeNull();
    expect(phanQuyetThuMucNgoai("uploads")).toBe("DENIED_DIR");
    expect(phanQuyetThuMucNgoai("a/.ssh")).toBe("DENIED_DIR");
    expect(phanQuyetThuMucNgoai("..")).toBe("PATH_REJECTED");
  });
  it("locKetQuaTimNgoai: `grep -r pass` không lòi dòng từ .env / uploads / *.sql; khai số mục bỏ", () => {
    const dong = [
      { tep: "src/a.ts", dong: "const passLen = 8" },
      { tep: ".env", dong: "DB_PASSWORD=Hunter2" },
      { tep: ".env.bak", dong: "DB_PASSWORD=Old" },
      { tep: "uploads/u.ts", dong: "pass" },
      { tep: "drizzle/0001.sql", dong: "password text" },
      { tep: "README.md", dong: "pass" },
    ];
    const { giu, soBoDi } = locKetQuaTimNgoai(dong, (d) => d.tep);
    expect(giu.map((d) => d.tep)).toEqual(["src/a.ts", "README.md"]);
    expect(soBoDi).toBe(4);
    expect(JSON.stringify(giu)).not.toMatch(/Hunter2|Old/);
  });
  it("chuanHoaDuongDanNgoai: các biến thể của CÙNG tệp gộp về một dạng", () => {
    const rel = (p: string) => {
      const c = chuanHoaDuongDanNgoai(p);
      return c.ok ? c.rel : null;
    };
    expect(rel("Src\\A.ts")).toBe("src/a.ts");
    expect(rel("./src//a.ts. ")).toBe("src/a.ts");
    expect(rel("src/./a.ts")).toBe("src/a.ts");
  });
  it("laNoiDungNhiPhan: NUL trong 8000 ký tự đầu", () => {
    expect(laNoiDungNhiPhan("abc\u0000def")).toBe(true);
    expect(laNoiDungNhiPhan("văn bản thường")).toBe(false);
  });
});
