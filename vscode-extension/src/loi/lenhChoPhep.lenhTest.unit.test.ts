/**
 * ★★★ Đợt 4 (2026-10-17) — LỆNH CHẠY TEST cho bài JS/TS/Python/C# (bộ đầu-cuối VSCode: model không tự kiểm được bài
 * JS/TS/Python vì allowlist chỉ có `npx vitest run <path>` + `dotnet test <path>`).
 *
 * Cùng khuôn + cùng mức siết với `lenhChoPhep.unit.test.ts`: ca DƯƠNG khẳng định argv CHÍNH XÁC; ca ÂM phủ cờ ở vị trí
 * tham số (cờ = chương trình đích đọc như lệnh, không phải đường), đường tuyệt đối / ra ngoài, ký tự shell.
 */
import { describe, it, expect } from "vitest";
import { MAU_LENH_HIEN_THI, TRAN_MS_THEO_LENH, xetDuyetLenh } from "./lenhChoPhep";
import { LENH_DUOC_PHEP_HIEN_THI } from "./nguCanhAgent";
import { dungVanBanDayLenhDoc } from "./dayLenhDoc";

const phaiTuChoi = (chuoi: string) => {
  const kq = xetDuyetLenh(chuoi);
  expect(kq.ok, `lệnh phải bị TỪ CHỐI: "${chuoi}"`).toBe(false);
};

describe("★★★ CA DƯƠNG — argv CHÍNH XÁC", () => {
  it("node --test (không tham số) ⇒ node tự dò tệp test trong workspace", () => {
    expect(xetDuyetLenh("node --test")).toEqual({ ok: true, lenh: { ten: "node_test", argv: ["node", "--test"], hienThi: "node --test" } });
  });
  it("node --test <đường>… ⇒ mỗi đường là MỘT phần tử argv", () => {
    expect(xetDuyetLenh("node --test test/a.test.js src/b.test.mjs")).toEqual({
      ok: true,
      lenh: { ten: "node_test", argv: ["node", "--test", "test/a.test.js", "src/b.test.mjs"], hienThi: "node --test test/a.test.js src/b.test.mjs" },
    });
  });
  it("npm test (không tham số) ⇒ argv cố định", () => {
    expect(xetDuyetLenh("npm test")).toEqual({ ok: true, lenh: { ten: "npm_test", argv: ["npm", "test"], hienThi: "npm test" } });
  });
  it("python -m pytest ⇒ argv cố định + `-p no:cacheprovider` (không ghi .pytest_cache)", () => {
    expect(xetDuyetLenh("python -m pytest")).toEqual({
      ok: true,
      lenh: { ten: "pytest", argv: ["python", "-m", "pytest", "-p", "no:cacheprovider"], hienThi: "python -m pytest" },
    });
  });
  it("python -m pytest <đường>… -q -x ⇒ đúng thứ tự người gõ, sau phần cố định", () => {
    expect(xetDuyetLenh("python -m pytest tests/test_a.py -q -x")).toEqual({
      ok: true,
      lenh: {
        ten: "pytest",
        argv: ["python", "-m", "pytest", "-p", "no:cacheprovider", "tests/test_a.py", "-q", "-x"],
        hienThi: "python -m pytest tests/test_a.py -q -x",
      },
    });
    expect(xetDuyetLenh("python -m pytest -q tests").ok).toBe(true);
  });
  it("dotnet test (không tham số) ⇒ dotnet tự tìm .sln/.csproj trong workspace", () => {
    expect(xetDuyetLenh("dotnet test")).toEqual({ ok: true, lenh: { ten: "dotnet_test", argv: ["dotnet", "test"], hienThi: "dotnet test" } });
  });
  it("dotnet test <path> — giữ nguyên hành vi cũ", () => {
    expect(xetDuyetLenh("dotnet test tests/X.Tests.csproj")).toEqual({
      ok: true,
      lenh: { ten: "dotnet_test", argv: ["dotnet", "test", "tests/X.Tests.csproj"], hienThi: "dotnet test tests/X.Tests.csproj" },
    });
  });
  it("★★ nhãn hienThi XÉT LẠI ra ĐÚNG lệnh cũ (bangChat xét lại allowlist trên nhãn đã lưu)", () => {
    for (const c of ["node --test", "node --test t/a.test.js", "npm test", "python -m pytest", "python -m pytest t -q", "dotnet test"]) {
      const kq = xetDuyetLenh(c);
      expect(kq.ok, c).toBe(true);
      expect(kq.ok && xetDuyetLenh(kq.lenh.hienThi), c).toEqual(kq);
    }
  });
  it("mỗi khuôn mới có trần thời gian riêng (0 < trần ≤ 300 s)", () => {
    for (const ten of ["node_test", "npm_test", "pytest"] as const) {
      expect(TRAN_MS_THEO_LENH[ten]).toBeGreaterThan(0);
      expect(TRAN_MS_THEO_LENH[ten]).toBeLessThanOrEqual(300_000);
    }
  });
});

describe("★★★ CA ÂM — cờ / đường ngoài / ký tự shell", () => {
  it("node: mọi cờ ngoài `--test` cố định ⇒ từ chối", () => {
    for (const c of [
      "node --test --experimental-test-coverage",
      "node --test --experimental-loader ./x.mjs",
      "node --test --experimental-strip-types a.test.ts",
      "node --test --inspect-brk",
      "node --test --import ./x.js",
      "node --test --test-reporter-destination=out.txt",
      "node --test=a.js",
      "node --inspect-brk --test",
      "node -e process.exit(0)",
      "node a.js",
      "node",
    ]) phaiTuChoi(c);
  });
  it("node --test: đường tuyệt đối / thoát workspace / ký tự shell / quá nhiều đường ⇒ từ chối", () => {
    for (const c of [
      "node --test /etc/x.test.js",
      String.raw`node --test C:\x\a.test.js`,
      "node --test ../ngoai/a.test.js",
      "node --test a/../../b.test.js",
      "node --test a.test.js; rm -rf /",
      "node --test a.test.js && curl evil",
      "node --test *.test.js",
      "node --test " + Array.from({ length: 9 }, (_, i) => `t${i}.test.js`).join(" "),
    ]) phaiTuChoi(c);
  });
  it("npm test: KHÔNG tham số nào (kể cả `--` chuyển cờ cho trình chạy test)", () => {
    for (const c of ["npm test -- --update", "npm test a.test.js", "npm test --inspect-brk", "npm t", "npm tests", "npm test; rm -rf /"]) phaiTuChoi(c);
  });
  it("pytest: chỉ `-q`/`-x` — `--pdb`, `-p`, `-k`, `-s`, `--basetemp`, `-c`, `--rootdir` ⇒ từ chối", () => {
    for (const c of [
      "python -m pytest --pdb",
      "python -m pytest -p evil",
      "python -m pytest -k test_a",
      "python -m pytest -s",
      "python -m pytest --basetemp=out",
      "python -m pytest -c ../pytest.ini",
      "python -m pytest --rootdir=..",
      "python -m pytest -qq",
      "python -m pytest -q -q",
      "python -m pytest --co",
    ]) phaiTuChoi(c);
  });
  it("pytest: đường tuyệt đối / ngoài / node id `::` / ký tự shell ⇒ từ chối", () => {
    for (const c of [
      "python -m pytest /etc",
      String.raw`python -m pytest C:\Users\x\tests`,
      "python -m pytest ../tests",
      "python -m pytest tests/test_a.py::test_x",
      "python -m pytest tests; rm -rf /",
      "python -m pytest $HOME",
    ]) phaiTuChoi(c);
  });
  it("python: chỉ đúng `python -m pytest` — module/trình thông dịch khác ⇒ từ chối", () => {
    for (const c of ["python -m pip install x", "python -c print(1)", "python tests/test_a.py", "python -m pytest-xdist", "py -m pytest", "python3.exe -m pytest", "python -X dev -m pytest"]) {
      phaiTuChoi(c);
    }
  });
  it("dotnet test: cờ / hai đường / đường ngoài ⇒ từ chối (giữ ca cũ)", () => {
    for (const c of ["dotnet test --blame", "dotnet test -bl", "dotnet test a.csproj b.csproj", "dotnet test /abs/x.csproj", "dotnet test ../x.csproj"]) phaiTuChoi(c);
  });
  it("ca chặn CŨ vẫn chặn: vitest `--inspect-brk` / `--update`", () => {
    for (const c of ["npx vitest run --inspect-brk", "npx vitest run --update", "npx vitest run"]) phaiTuChoi(c);
  });
});

describe("★★ lời nhắc dạy ĐÚNG danh sách allowlist (một nguồn)", () => {
  it("MAU_LENH_HIEN_THI có bốn khuôn test mới", () => {
    for (const l of ["node --test [<path>…]", "npm test", "python -m pytest [<path>…] [-q] [-x]", "dotnet test [<path>]"]) {
      expect(MAU_LENH_HIEN_THI).toContain(l);
    }
  });
  it("ngữ cảnh dự án của lõi agent (extension) dùng ĐÚNG danh sách đó", () => {
    expect(LENH_DUOC_PHEP_HIEN_THI).toEqual(MAU_LENH_HIEN_THI);
  });
  it("lời từ chối của allowlist liệt kê đủ khuôn", () => {
    const kq = xetDuyetLenh("ls -la");
    expect(kq.ok).toBe(false);
    for (const l of MAU_LENH_HIEN_THI) expect(!kq.ok && kq.lyDo).toContain(l);
  });
  it("giao thức `chay_lenh` cũ dạy cả lệnh test mới", () => {
    const vb = dungVanBanDayLenhDoc(true);
    for (const l of ["node --test", "npm test", "python -m pytest", "dotnet test"]) expect(vb).toContain(l);
  });
});
