// Đợt 12 / H2 — môi trường cho tiến trình con của extension: bí mật theo TÊN / TIỀN TỐ / GIÁ TRỊ bị loại; cấu hình công cụ được giữ.
import { describe, expect, it } from "vitest";
import { lyDoLoaiBien, moiTruongDaLocChoTienTrinhCon } from "./moiTruongAnToan";

const GITHUB_TOKEN_GIA = "ghp_" + "a".repeat(36);

describe("lyDoLoaiBien — bị loại", () => {
  const BI_LOAI: Array<[string, string]> = [
    ["GITHUB_TOKEN", "x"],
    ["NPM_TOKEN", "x"],
    ["AWS_SECRET_ACCESS_KEY", "x"],
    ["AWS_ACCESS_KEY_ID", "x"],
    ["AWS_REGION", "us-east-1"], // tiền tố nhóm đám mây: loại thừa có chủ đích
    ["AZURE_CLIENT_SECRET", "x"],
    ["GOOGLE_APPLICATION_CREDENTIALS", "C:\\k.json"],
    ["OPENAI_API_KEY", "x"],
    ["ANTHROPIC_API_KEY", "x"],
    ["HF_HOME", "x"],
    ["DB_PASSWORD", "x"],
    ["MYSQL_PWD_PASSWD", "x"],
    ["SSH_AUTH_SOCK", "/tmp/s"],
    ["JWT_SECRET", "x"],
    ["SESSION_COOKIE", "x"],
    ["GPG_PASSPHRASE", "x"],
    ["SERVICEBUS_CONNECTION_STRING", "x"],
    ["SENTRY_DSN", "x"],
    ["npm_config__authToken", "x"],
    ["github_token", "x"], // chữ thường (Windows không phân biệt)
  ];
  for (const [ten, gt] of BI_LOAI) {
    it(`loại ${ten}`, () => {
      expect(lyDoLoaiBien(ten, gt)).not.toBeNull();
    });
  }
  it("★ tên VÔ HẠI nhưng GIÁ TRỊ là token có tiền tố nhà cung cấp ⇒ loại theo giá trị", () => {
    expect(lyDoLoaiBien("MY_DEPLOY_THING", GITHUB_TOKEN_GIA)).toBe("gia-tri-token");
    expect(lyDoLoaiBien("X", "AKIA" + "A".repeat(16))).toBe("gia-tri-token");
  });
  it("★ tên VÔ HẠI nhưng giá trị là URL mang `user:mật-khẩu@` ⇒ loại (DATABASE_URL, REDIS_URL…)", () => {
    expect(lyDoLoaiBien("REDIS_URL", "redis://admin:hunter2@10.0.0.5:6379/0")).toBe("gia-tri-url");
    expect(lyDoLoaiBien("DATABASE_URL", "postgres://u:p@h/db")).toBe("gia-tri-url");
  });
});

describe("lyDoLoaiBien — được giữ", () => {
  const GIU: Array<[string, string]> = [
    ["PATH", "C:\\Windows;C:\\bin"],
    ["Path", "C:\\x"],
    ["SYSTEMROOT", "C:\\Windows"],
    ["TEMP", "C:\\t"],
    ["JAVA_HOME", "C:\\jdk"],
    ["GOPATH", "C:\\go"],
    ["GOROOT", "C:\\go\\root"],
    ["CARGO_HOME", "C:\\c"],
    ["DOTNET_ROOT", "C:\\dotnet"],
    ["NUGET_PACKAGES", "C:\\n"],
    ["LANG", "vi_VN.UTF-8"],
    ["npm_config_cache", "C:\\npm"],
    ["WT_SESSION", "abc-123"],
    ["COMPUTERNAME", "DEV-01"],
    ["ProgramFiles(x86)", "C:\\Program Files (x86)"],
  ];
  for (const [ten, gt] of GIU) {
    it(`giữ ${ten}`, () => {
      expect(lyDoLoaiBien(ten, gt)).toBeNull();
    });
  }
  it("★ NGOẠI LỆ: proxy (kể cả viết thường, kể cả có user:pass@), chứng chỉ CA, GOPRIVATE được giữ", () => {
    for (const [ten, gt] of [
      ["HTTP_PROXY", "http://u:p@proxy:8080"],
      ["https_proxy", "http://u:p@proxy:8080"],
      ["NO_PROXY", "localhost"],
      ["ALL_PROXY", "socks5://p:1080"],
      ["NODE_EXTRA_CA_CERTS", "C:\\ca.pem"],
      ["SSL_CERT_FILE", "C:\\ca.pem"],
      ["REQUESTS_CA_BUNDLE", "C:\\ca.pem"],
      ["GOPRIVATE", "git.corp/*"],
    ] as const) {
      expect(lyDoLoaiBien(ten, gt), ten).toBeNull();
    }
  });
});

describe("moiTruongDaLocChoTienTrinhCon", () => {
  const nguon: NodeJS.ProcessEnv = {
    PATH: "C:\\bin",
    JAVA_HOME: "C:\\jdk",
    HTTPS_PROXY: "http://proxy:8080",
    GITHUB_TOKEN: GITHUB_TOKEN_GIA,
    AWS_SECRET_ACCESS_KEY: "x",
    DATABASE_URL: "postgres://u:p@h/db",
    LO_DANG_UNDEFINED: undefined,
  };
  it("giữ biến vô hại + ngoại lệ, loại bí mật, bỏ undefined; không đổi nguồn", () => {
    const copy = { ...nguon };
    const ra = moiTruongDaLocChoTienTrinhCon(nguon);
    expect(ra).toEqual({ PATH: "C:\\bin", JAVA_HOME: "C:\\jdk", HTTPS_PROXY: "http://proxy:8080" });
    expect(nguon).toEqual(copy);
  });
  it("★ biến RIÊNG của MCP server đặt SAU khi lọc thì giữ (chủ định của người dùng)", () => {
    const ra: NodeJS.ProcessEnv = { ...moiTruongDaLocChoTienTrinhCon(nguon), ...{ MY_MCP_TOKEN: "t-rieng" } };
    expect(ra.MY_MCP_TOKEN).toBe("t-rieng");
    expect(ra.GITHUB_TOKEN).toBeUndefined();
  });
  it("không bao giờ in GIÁ TRỊ bí mật vào kết quả của lyDoLoaiBien (chỉ nhãn)", () => {
    expect(String(lyDoLoaiBien("GITHUB_TOKEN", GITHUB_TOKEN_GIA))).not.toContain("ghp_");
  });
});
