/**
 * ★★★ 2026-08-24 — **`dotnet new` LÀM BƯỚC SINH NỘI DUNG: ánh xạ template · lọc tệp · dọn thư mục tạm.**
 *
 * Lưới này KHÔNG chạy `dotnet new` THẬT (brief cấm — chậm, không tất định, đụng card). Bước gọi dotnet
 * được TIÊM (`chayThat`) bằng một hàm ghi cây tệp GIẢ vào thư mục tạm mà `chayDotnetNewVaoTam` dựng,
 * để đo đúng phần SERVER làm: ánh xạ · đọc+lọc · xoá tmpdir. Phép nghiệm thu `dotnet new` THẬT do
 * điều phối viên live chạy trên máy có SDK (ngoài lưới).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  anhXaTemplateDotnet,
  chayDotnetNewVaoTam,
  coPackageReference,
  docCayTepKhung,
  giuTepKhung,
  slugDuAn,
} from "./dotnetNewScaffold";

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — `anhXaTemplateDotnet`: BẢNG ánh xạ THUẦN (oracle). Đột biến 'luôn null' ⇒ đường dotnet chết ⇒ ĐỎ", () => {
  const co: Array<[string, string]> = [
    // WPF/WinForms/Blazor ĐỘC QUYỀN .NET ⇒ khớp KỂ CẢ không có chữ "C#" rời.
    ["tạo dự án C# WPF đọc file pdf", "wpf"],
    ["tao du an C# WPF", "wpf"], // không dấu
    ["tạo dự án WPF", "wpf"], // WPF một mình vẫn là .NET
    ["scaffold a WinForms app", "winforms"],
    // Generic ⇒ ĐÒI tín hiệu C#/.NET.
    ["console C#", "console"],
    ["tạo dự án C# console", "console"],
    ["tao du an C# console", "console"],
    ["dự án .NET web api", "webapi"],
    ["C# webapi", "webapi"],
    ["thư viện C#", "classlib"],
    ["C# class library", "classlib"],
    ["tạo dự án dotnet console", "console"],
  ];
  for (const [q, t] of co) it(`★★ "${q}" ⇒ ${t}`, () => expect(anhXaTemplateDotnet(q)).toBe(t));

  /**
   * ⚠ Ca ÂM là điểm: một loại GENERIC (console/lib/webapi) KHÔNG có tín hiệu C# ⇒ null ⇒ rơi về model
   * (có thể là Node/Python). Chiều THỪA (dựng nhầm khung C#) đắt hơn chiều SÓT.
   */
  const khong = [
    "dự án React", // brief: React ⇒ null ⇒ fail-safe model
    "dựng dự án blazor", // CỐ Ý loại: dotnet new blazor = 66 tệp > trần 8 ⇒ mục chết ⇒ về model
    "tạo dự án console đọc log", // console nhưng KHÔNG có C# ⇒ null
    "tạo dự án Python đọc pdf",
    "tạo thư viện JavaScript",
    "calibrate the library settings", // "lib" GIỮA từ 'calibrate'/không có 'library' rời + không C#
    "khởi tạo dự án web mới", // web nhưng không "web api" + không C#
    "tạo dự án mới", // không loại nào
  ];
  for (const q of khong) it(`★★★ "${q}" ⇒ null (fail-safe model)`, () => expect(anhXaTemplateDotnet(q)).toBeNull());
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — `giuTepKhung`: bộ lọc THUẦN. Đột biến gỡ lọc nhị phân ⇒ .ico lọt ⇒ ĐỎ", () => {
  const giu = ["Program.cs", "Demo.csproj", "App.xaml", "Properties/launchSettings.json", ".gitignore", "sub/Foo.cs", "AssemblyInfo.cs"];
  for (const p of giu) it(`★★ GIỮ tệp văn bản nguồn: ${p}`, () => expect(giuTepKhung(p)).toBe(true));

  const bo: Array<[string, string]> = [
    ["obj/project.assets.json", "obj/ (dù .json NẰM trong danh sách trắng — bộ lọc THƯ MỤC bắt buộc)"],
    ["bin/Debug/net8.0/Demo.dll", "bin/ + nhị phân"],
    ["appicon.ico", "nhị phân .ico"],
    ["anh/logo.png", "nhị phân .png"],
    ["DemoApp.http", "đuôi .http ngoài danh sách trắng (webapi sinh ra)"],
    [".vs/Demo/x.json", "thư mục IDE .vs"],
    ["obj/DemoApp.csproj.nuget.g.props", "obj/ dù .props hợp lệ đuôi"],
  ];
  for (const [p, ly] of bo) it(`★★★ BỎ: ${p} — ${ly}`, () => expect(giuTepKhung(p)).toBe(false));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2b — `docCayTepKhung`: cây giả có bin/obj/.ico/.cs/.csproj ⇒ manifest CHỈ .cs/.csproj", () => {
  let dir = "";
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dnscaffold-loc-")));
    fs.mkdirSync(path.join(dir, "obj"), { recursive: true });
    fs.mkdirSync(path.join(dir, "bin", "Debug"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Program.cs"), "class P { }\n");
    fs.writeFileSync(path.join(dir, "Demo.csproj"), '<Project Sdk="Microsoft.NET.Sdk" />\n');
    fs.writeFileSync(path.join(dir, "appicon.ico"), "gia-icon-nhi-phan");
    fs.writeFileSync(path.join(dir, "obj", "project.assets.json"), '{"version":3}'); // .json HỢP LỆ đuôi nhưng dưới obj/
    fs.writeFileSync(path.join(dir, "bin", "Debug", "Demo.dll"), "MZ-gia-dll");
  });
  afterAll(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("★★★ chỉ giữ Program.cs + Demo.csproj (đúng thứ tự), KHÔNG có .ico / obj / bin", () => {
    const tep = docCayTepKhung(dir);
    expect(tep.map((t) => t.duong)).toEqual(["Demo.csproj", "Program.cs"]);
    // Đột biến gỡ lọc nhị phân ⇒ .ico lọt; đột biến gỡ lọc obj/ ⇒ project.assets.json lọt.
    expect(tep.some((t) => t.duong.endsWith(".ico"))).toBe(false);
    expect(tep.some((t) => t.duong.includes("obj/"))).toBe(false);
    expect(tep.some((t) => t.duong.includes("bin/"))).toBe(false);
    expect(tep.find((t) => t.duong === "Program.cs")!.noiDung).toContain("class P");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — `slugDuAn`: tên dự án HỢP LỆ cho `dotnet new -n`", () => {
  const cap: Array<[string | undefined, string]> = [
    ["taokhung", "Taokhung"],
    ["Khung tam", "Khungtam"],
    ["my-app!", "Myapp"],
    ["123abc", "App123abc"], // namespace không mở đầu bằng chữ số
    ["", "App"],
    [undefined, "App"],
    ["___", "App"],
  ];
  for (const [vao, ra] of cap) it(`★★ slugDuAn(${JSON.stringify(vao)}) = "${ra}"`, () => expect(slugDuAn(vao)).toBe(ra));
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — `chayDotnetNewVaoTam`: TIÊM bước dotnet, đọc+lọc, và XOÁ thư mục tạm ở MỌI đường ra", () => {
  /** Hàm 'chạy dotnet' GIẢ: ghi cây tệp vào tmpdir + ghi lại đường tmpdir để kiểm nó bị xoá sau. */
  function tiemGhiCay(noiDungCsproj: string) {
    const daThay: { tmp: string } = { tmp: "" };
    const chayThat = async (tmp: string) => {
      daThay.tmp = tmp;
      fs.mkdirSync(path.join(tmp, "obj"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "Demo.csproj"), noiDungCsproj);
      fs.writeFileSync(path.join(tmp, "Program.cs"), "class P { }\n");
      fs.writeFileSync(path.join(tmp, "appicon.ico"), "gia-icon");
      fs.writeFileSync(path.join(tmp, "obj", "project.assets.json"), "{}");
      return { ok: true as const };
    };
    return { daThay, chayThat };
  }

  it("★★★ dotnet 'chạy' xong ⇒ tep ĐÃ LỌC (.cs/.csproj), template/slug trả về, và tmpdir ĐƯỢC XOÁ", async () => {
    const { daThay, chayThat } = tiemGhiCay('<Project Sdk="Microsoft.NET.Sdk" />\n');
    const r = await chayDotnetNewVaoTam({ template: "console", slug: "Demo", chayThat });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tep.map((t) => t.duong)).toEqual(["Demo.csproj", "Program.cs"]);
    expect(r.template).toBe("console");
    expect(r.slug).toBe("Demo");
    expect(r.coNuGet, "csproj không có PackageReference").toBe(false);
    // ⚠ Đột biến gỡ `fs.rmSync` trong finally ⇒ ca này ĐỎ (tmpdir còn sót lại).
    expect(daThay.tmp, "chayThat phải nhận tmpdir SERVER dựng").not.toBe("");
    expect(fs.existsSync(daThay.tmp), "thư mục tạm PHẢI bị xoá sau khi đọc xong").toBe(false);
  });

  it("★★★ csproj có <PackageReference> ⇒ coNuGet = true (⇒ câu trả lời khai hai chế độ NuGet)", async () => {
    const { chayThat } = tiemGhiCay(
      '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Serilog" Version="3.0.0" />\n  </ItemGroup>\n</Project>\n',
    );
    const r = await chayDotnetNewVaoTam({ template: "webapi", slug: "Api", chayThat });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.coNuGet).toBe(true);
  });

  it("★★★ FAIL-SAFE: dotnet trả {ok:false} ⇒ kết {ok:false}, và tmpdir vẫn ĐƯỢC XOÁ", async () => {
    let tmpDaThay = "";
    const r = await chayDotnetNewVaoTam({
      template: "wpf",
      slug: "X",
      chayThat: async (tmp) => {
        tmpDaThay = tmp;
        return { ok: false, lyDo: "dotnet new lỗi: ENOENT" };
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.lyDo).toContain("ENOENT");
    expect(fs.existsSync(tmpDaThay), "lỗi cũng phải xoá tmpdir").toBe(false);
  });

  it("★★★ FAIL-SAFE: chayThat NÉM ⇒ kết {ok:false} (không vỡ), tmpdir vẫn ĐƯỢC XOÁ", async () => {
    let tmpDaThay = "";
    const r = await chayDotnetNewVaoTam({
      template: "console",
      slug: "X",
      chayThat: async (tmp) => {
        tmpDaThay = tmp;
        throw new Error("nổ giữa chừng");
      },
    });
    expect(r.ok).toBe(false);
    expect(fs.existsSync(tmpDaThay), "ném cũng phải xoá tmpdir").toBe(false);
  });

  it("★★ dotnet 'chạy' nhưng chỉ sinh sản phẩm dựng (0 tệp văn bản) ⇒ {ok:false}", async () => {
    const r = await chayDotnetNewVaoTam({
      template: "console",
      slug: "X",
      chayThat: async (tmp) => {
        fs.mkdirSync(path.join(tmp, "obj"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "obj", "project.assets.json"), "{}");
        return { ok: true as const };
      },
    });
    expect(r.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — `coPackageReference`: nhận diện trên NỘI DUNG csproj", () => {
  it("★ có <PackageReference ⇒ true; không có ⇒ false", () => {
    expect(coPackageReference([{ duong: "a.csproj", noiDung: '<PackageReference Include="X" />' }])).toBe(true);
    expect(coPackageReference([{ duong: "a.csproj", noiDung: "<Project />" }])).toBe(false);
    expect(coPackageReference([])).toBe(false);
  });
});
