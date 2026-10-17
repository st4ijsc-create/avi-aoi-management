/**
 * ★★★ ĐỢT M / TASK M1 — LƯỚI CHO ALLOWLIST LỆNH. CA ÂM TÍNH QUAN TRỌNG HƠN CA DƯƠNG.
 *
 * Khuôn lưới: mỗi ca DƯƠNG khẳng định argv CHÍNH XÁC (không chỉ "ok:true") — một allowlist trả
 * `ok:true` với argv sai vẫn là một lỗ. Ca ÂM chiếm phần lớn tệp này CÓ CHỦ Ý — đây là mặt tấn công
 * lớn nhất của cả dự án (xem docblock `lenhChoPhep.ts`).
 */
import { describe, it, expect } from "vitest";
import { xetDuyetLenh, thamSoAnToan, TRAN_KY_TU_LENH, TRAN_MS_THEO_LENH } from "./lenhChoPhep";

describe("xetDuyetLenh — CA DƯƠNG, argv CHÍNH XÁC", () => {
  it("git status ⇒ argv cố định, không tham số người dùng", () => {
    const kq = xetDuyetLenh("git status");
    expect(kq).toEqual({
      ok: true,
      lenh: { ten: "git_status", argv: ["git", "--no-pager", "-c", "core.fsmonitor=false", "status", "--", "."], hienThi: "git status" },
    });
  });

  it("git diff ⇒ argv cố định, không tham số người dùng", () => {
    const kq = xetDuyetLenh("git diff");
    expect(kq).toEqual({
      ok: true,
      lenh: { ten: "git_diff", argv: ["git", "--no-pager", "-c", "core.fsmonitor=false", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--", "."], hienThi: "git diff" },
    });
  });

  it("npm run check ⇒ argv cố định", () => {
    const kq = xetDuyetLenh("npm run check");
    expect(kq).toEqual({
      ok: true,
      lenh: { ten: "npm_run_check", argv: ["npm", "run", "check"], hienThi: "npm run check" },
    });
  });

  it("npx vitest run <path> ⇒ nhận đúng MỘT tham số cuối", () => {
    const kq = xetDuyetLenh("npx vitest run src/loi/foo.unit.test.ts");
    expect(kq).toEqual({
      ok: true,
      lenh: {
        ten: "vitest_run",
        argv: ["npx", "--no-install", "vitest", "run", "src/loi/foo.unit.test.ts"],
        hienThi: "npx vitest run src/loi/foo.unit.test.ts",
      },
    });
  });

  it("dotnet build <path>", () => {
    const kq = xetDuyetLenh("dotnet build src/Calculator.csproj");
    expect(kq).toEqual({
      ok: true,
      lenh: {
        ten: "dotnet_build",
        argv: ["dotnet", "build", "src/Calculator.csproj"],
        hienThi: "dotnet build src/Calculator.csproj",
      },
    });
  });

  it("dotnet test <path>", () => {
    const kq = xetDuyetLenh("dotnet test tests/Calculator.Tests.csproj");
    expect(kq).toEqual({
      ok: true,
      lenh: {
        ten: "dotnet_test",
        argv: ["dotnet", "test", "tests/Calculator.Tests.csproj"],
        hienThi: "dotnet test tests/Calculator.Tests.csproj",
      },
    });
  });
});

describe("xetDuyetLenh — ★★★ CA ÂM, TỪNG CÁCH TIÊM LỆNH SHELL PHẢI BỊ TỪ CHỐI", () => {
  const phaiTuChoi = (chuoi: string) => {
    const kq = xetDuyetLenh(chuoi);
    expect(kq.ok, `lệnh phải bị TỪ CHỐI: "${chuoi}"`).toBe(false);
  };

  it("git status; rm -rf / — dấu chấm phẩy nối lệnh phụ", () => phaiTuChoi("git status; rm -rf /"));
  it("npm run check && curl evil — nối bằng &&", () => phaiTuChoi("npm run check && curl evil"));
  it("git diff $(whoami) — command substitution", () => phaiTuChoi("git diff $(whoami)"));
  it("git diff `whoami` — backtick substitution", () => phaiTuChoi("git diff `whoami`"));
  it("git status | curl evil — pipe", () => phaiTuChoi("git status | curl evil"));
  it("git status > /tmp/x — redirect ghi đè", () => phaiTuChoi("git status > /tmp/x"));
  it("git status >> /tmp/x — redirect nối", () => phaiTuChoi("git status >> /tmp/x"));
  it("newline nối hai lệnh", () => phaiTuChoi("git status\nrm -rf /"));
  it("CRLF nối hai lệnh", () => phaiTuChoi("git status\r\nrm -rf /"));
  it("git status & — chạy nền", () => phaiTuChoi("git status &"));
  it("git status || curl evil — OR shell", () => phaiTuChoi("git status || curl evil"));
  it("vitest run với path chứa &&", () => phaiTuChoi("npx vitest run a.ts && curl evil"));
  it("dotnet build với path chứa ; ", () => phaiTuChoi("dotnet build a.csproj; rm -rf /"));
  it("git status với hậu tố dính liền (status;)", () => phaiTuChoi("git status;"));
  it("chuỗi rỗng", () => phaiTuChoi(""));
  it("chỉ khoảng trắng", () => phaiTuChoi("   "));
  it("lệnh không nằm trong allowlist (ls)", () => phaiTuChoi("ls -la"));
  it("git khác (git push)", () => phaiTuChoi("git push origin main"));
  it("git status thêm cờ lạ", () => phaiTuChoi("git status --porcelain"));
  it("npm run KHÁC (build thay vì check)", () => phaiTuChoi("npm run build"));
  it("npm run check thêm hậu tố", () => phaiTuChoi("npm run check:tests"));
  it("thêm tiền tố trước lệnh hợp lệ", () => phaiTuChoi("echo x && git status"));
  it("lồng lệnh hợp lệ vào giữa chuỗi dài hơn", () => phaiTuChoi("cd /tmp && git status"));
  it("path tuyệt đối Windows cho vitest", () => phaiTuChoi("npx vitest run C:\\Windows\\System32\\evil.ts"));
  it("path tuyệt đối POSIX cho dotnet build", () => phaiTuChoi("dotnet build /etc/passwd"));
  it("path thoát workspace bằng ..", () => phaiTuChoi("npx vitest run ../../../etc/passwd"));
  it("path chứa dấu cách (không thể tách token an toàn)", () => phaiTuChoi("dotnet build my project.csproj"));
  it("lệnh dài hơn trần ký tự", () => phaiTuChoi("git status " + "a".repeat(TRAN_KY_TU_LENH)));
  it("null byte trong lệnh", () => phaiTuChoi("git status\u0000; rm -rf /"));
  it("git status kèm biến môi trường giả ($HOME)", () => phaiTuChoi("git diff $HOME"));
  it("thiếu tham số cho vitest run", () => phaiTuChoi("npx vitest run"));
  it("thiếu tham số cho dotnet build", () => phaiTuChoi("dotnet build"));
});

describe("thamSoAnToan — vị từ tham số riêng, đo TRỰC TIẾP (không chỉ qua xetDuyetLenh)", () => {
  it("đường tương đối bình thường ⇒ true", () => {
    expect(thamSoAnToan("src/foo/bar.ts")).toBe(true);
  });
  it("rỗng ⇒ false", () => expect(thamSoAnToan("")).toBe(false));
  it("tuyệt đối Windows ⇒ false", () => expect(thamSoAnToan("C:\\x\\y.ts")).toBe(false));
  it("tuyệt đối POSIX ⇒ false", () => expect(thamSoAnToan("/etc/passwd")).toBe(false));
  it("chứa .. ⇒ false", () => expect(thamSoAnToan("../../etc/passwd")).toBe(false));
  it("chứa ký tự shell ; ⇒ false", () => expect(thamSoAnToan("a.ts;rm")).toBe(false));
  it("chứa dấu cách ⇒ false", () => expect(thamSoAnToan("a b.ts")).toBe(false));
  it("chứa $ ⇒ false", () => expect(thamSoAnToan("$HOME/a.ts")).toBe(false));
  it("chứa backtick ⇒ false", () => expect(thamSoAnToan("`whoami`.ts")).toBe(false));
  it("chứa | ⇒ false", () => expect(thamSoAnToan("a.ts|b")).toBe(false));
});

describe("TRAN_MS_THEO_LENH — mỗi khuôn có một trần thời gian dương, hữu hạn", () => {
  it("cả sáu khuôn đều có trần > 0 và ≤ 300s (cùng bậc với TRAN_MS_GOI_MCP)", () => {
    for (const [ten, ms] of Object.entries(TRAN_MS_THEO_LENH)) {
      expect(ms, `trần của ${ten} phải dương`).toBeGreaterThan(0);
      expect(ms, `trần của ${ten} không được vượt 300s`).toBeLessThanOrEqual(300_000);
    }
  });
});

describe("ĐỢT 4B — git diff --staged (cho /commit)", () => {
  it("★★★ đúng 3 token ⇒ argv cố định có --staged và giới hạn '-- .'", () => {
    const kq = xetDuyetLenh("git diff --staged");
    expect(kq.ok && kq.lenh.argv).toEqual(["git", "--no-pager", "-c", "core.fsmonitor=false", "diff", "--staged", "--no-ext-diff", "--no-textconv", "--no-color", "--", "."]);
  });
  it("★★ thêm tham số ⇒ từ chối (không thương lượng)", () => {
    expect(xetDuyetLenh("git diff --staged HEAD").ok).toBe(false);
    expect(xetDuyetLenh("git diff --cached").ok).toBe(false);
  });
});

/**
 * ★★★ RÀ BẢO MẬT 9d26ad568 — allowlist-semantic-escape. Khuôn argv ĐÚNG số token nhưng token tham số CÓ THỂ là một
 * CỜ: `npx vitest run --update` khớp khuôn 4 token ⇒ vitest GHI ĐÈ snapshot (ghi đĩa KHÔNG qua cửa ghi), `--inspect-brk`
 * mở cổng debugger Node (ai kết nối được là chạy mã), `--api`/`--ui` mở máy chủ cục bộ; `dotnet build -bl` ghi
 * msbuild.binlog chứa CẢ biến môi trường. Và `npx vitest` khi dự án CHƯA cài vitest sẽ TẢI + CHẠY gói từ registry
 * (stdin không phải TTY ⇒ npx tự coi là --yes) — chương trình chạy không còn là "vitest của dự án".
 */
describe("★★★ RÀ BẢO MẬT — tham số tự do KHÔNG được là cờ; npx không được tải gói; git không gọi chương trình ngoài", () => {
  const phaiTuChoi = (chuoi: string) => expect(xetDuyetLenh(chuoi), chuoi).toMatchObject({ ok: false });
  it("cờ vitest ở vị trí <path> ⇒ từ chối", () => {
    for (const c of ["--update", "-u", "--inspect-brk", "--inspect", "--api", "--ui", "--watch", "--standalone", "-w"]) {
      phaiTuChoi(`npx vitest run ${c}`);
    }
  });
  it("cờ dotnet ở vị trí <path> ⇒ từ chối", () => {
    for (const c of ["-bl", "--interactive", "--blame", "-restore", "--no-restore", "-v"]) {
      phaiTuChoi(`dotnet build ${c}`);
      phaiTuChoi(`dotnet test ${c}`);
    }
  });
  it("thamSoAnToan: bắt đầu bằng '-' ⇒ false; tuyệt đối kiểu Windows/UNC ⇒ false trên MỌI nền tảng", () => {
    expect(thamSoAnToan("-bl")).toBe(false);
    expect(thamSoAnToan("--update")).toBe(false);
    expect(thamSoAnToan(String.raw`\\server\share\x.ts`)).toBe(false);
    expect(thamSoAnToan(String.raw`\Windows\x.ts`)).toBe(false);
    expect(thamSoAnToan("src/-a.test.ts")).toBe(true);
  });
  it("npx LUÔN mang --no-install ngay sau tên chương trình (không tải gói từ registry)", () => {
    const kq = xetDuyetLenh("npx vitest run src/a.test.ts");
    expect(kq.ok && kq.lenh.argv.slice(0, 3)).toEqual(["npx", "--no-install", "vitest"]);
  });
  it("git diff/--staged: --no-ext-diff + --no-textconv (không chạy diff ngoài / textconv do cấu hình chỉ định)", () => {
    for (const c of ["git diff", "git diff --staged"]) {
      const kq = xetDuyetLenh(c);
      expect(kq.ok && kq.lenh.argv).toEqual(expect.arrayContaining(["--no-ext-diff", "--no-textconv", "core.fsmonitor=false"]));
    }
  });
  it("★★ nhãn hienThi XÉT LẠI ra ĐÚNG lệnh cũ (bangChat xét lại allowlist trên nhãn đã lưu)", () => {
    for (const c of ["git status", "git diff", "git diff --staged", "npm run check", "npx vitest run src/a.test.ts", "dotnet build a.csproj", "dotnet test t.csproj"]) {
      const kq = xetDuyetLenh(c);
      expect(kq.ok && xetDuyetLenh(kq.lenh.hienThi), c).toEqual(kq);
    }
  });
  it("cờ git dạng --output=<tệp> / --ext-diff / -c ⇒ từ chối", () => {
    for (const c of ["git diff --output=x.txt", "git diff --ext-diff", "git -c diff.external=x diff", "git diff --staged --output=a", "git status --porcelain"]) {
      phaiTuChoi(c);
    }
  });
});
