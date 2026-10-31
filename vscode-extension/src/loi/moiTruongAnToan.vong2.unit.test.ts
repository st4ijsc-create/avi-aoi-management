// Đợt 12 / H2 vòng 2 (theo kiem-dinh, đo bằng probe hai chiều): bớt cấm QUÁ RỘNG (GIT_AUTHOR_*), bịt cấm QUÁ HẸP (_PWD/_PASS/WEBHOOK/SALT, URL user rỗng, JWT, PEM).
import { describe, expect, it } from "vitest";
import { lyDoLoaiBien, moiTruongDaLocChoTienTrinhCon } from "./moiTruongAnToan";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";

describe("cấm QUÁ RỘNG đã bớt", () => {
  for (const ten of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "PWD", "OLDPWD"]) {
    it(`giữ ${ten} (git commit của lệnh test cần; PWD là thư mục hiện tại)`, () => {
      expect(lyDoLoaiBien(ten, "Nguyen Van A")).toBeNull();
    });
  }
  it("★ vẫn loại AUTH thật: SSH_AUTH_SOCK, AUTH_HEADER, npm_config__auth; AUTHOR không che mất mảnh khác (AUTHOR_TOKEN)", () => {
    expect(lyDoLoaiBien("SSH_AUTH_SOCK", "/tmp/s")).not.toBeNull();
    expect(lyDoLoaiBien("AUTH_HEADER", "x")).not.toBeNull();
    expect(lyDoLoaiBien("GIT_AUTHOR_TOKEN", "x")).not.toBeNull();
  });
  it("★ AUTHORIZATION / HTTP_AUTHORIZATION (giá trị Bearer/Basic) bị LOẠI — bỏ AUTHOR không được biến chúng thành 'IZATION'; GIT_AUTHOR_* vẫn giữ", () => {
    for (const ten of ["AUTHORIZATION", "HTTP_AUTHORIZATION", "authorization", "PROXY_AUTHORIZATION"]) {
      expect(lyDoLoaiBien(ten, "Bearer abc"), ten).not.toBeNull();
      expect(lyDoLoaiBien(ten, "Basic dTpw"), ten).not.toBeNull();
    }
    expect(lyDoLoaiBien("GIT_AUTHOR_NAME", "Nguyen Van A")).toBeNull();
  });
});

describe("cấm QUÁ HẸP đã bịt", () => {
  for (const [ten, gt] of [
    ["MYSQL_PWD", "x"],
    ["SMTP_PASS", "x"],
    ["DB_PASS", "x"],
    ["SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T0/B0/xxx"],
    ["ENCRYPTION_SALT", "x"],
  ] as const) {
    it(`loại ${ten} theo tên`, () => {
      expect(lyDoLoaiBien(ten, gt)).toBe("ten");
    });
  }
  it("★ URL có user RỖNG (`redis://:matkhau@host`) bị loại theo giá trị", () => {
    expect(lyDoLoaiBien("CACHE", "redis://:hunter2@10.0.0.5:6379")).toBe("gia-tri-url");
  });
  it("★ URL KHÔNG mật khẩu (cổng + đường dẫn có @) KHÔNG bị loại oan: `http://reg:4873/@scope/pkg`, `http://host:8080/x`", () => {
    expect(lyDoLoaiBien("NPM_REGISTRY_URL", "http://reg:4873/@scope/pkg")).toBeNull();
    expect(lyDoLoaiBien("BASE", "http://localhost:3000/api")).toBeNull();
  });
  it("★ JWT ba đoạn và khối khoá riêng PEM đặt trong biến tên vô hại bị loại theo giá trị", () => {
    expect(lyDoLoaiBien("VO_HAI_1", JWT)).toBe("gia-tri-khoa");
    expect(lyDoLoaiBien("VO_HAI_2", PEM)).toBe("gia-tri-khoa");
    expect(lyDoLoaiBien("VO_HAI_3", "-----BEGIN PRIVATE KEY-----\nabc")).toBe("gia-tri-khoa");
  });
  it("chuỗi vô hại giống đầu JWT nhưng không đủ ba đoạn thì giữ", () => {
    expect(lyDoLoaiBien("X", "eyJhbGciOi")).toBeNull();
  });
});

describe("tổng hợp", () => {
  it("môi trường dev điển hình: giữ git/chuỗi công cụ, loại bí mật", () => {
    const ra = moiTruongDaLocChoTienTrinhCon({
      PATH: "C:\\bin",
      GIT_AUTHOR_NAME: "A",
      GIT_AUTHOR_EMAIL: "a@x.vn",
      PWD: "/work",
      MYSQL_PWD: "x",
      SMTP_PASS: "x",
      REDIS_URL: "redis://:p@h",
      HTTPS_PROXY: "http://u:p@proxy:8080",
    });
    expect(Object.keys(ra).sort()).toEqual(["GIT_AUTHOR_EMAIL", "GIT_AUTHOR_NAME", "HTTPS_PROXY", "PATH", "PWD"]);
  });
});
