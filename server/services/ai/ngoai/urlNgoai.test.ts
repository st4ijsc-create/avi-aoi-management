/**
 * ★ Đợt 10.3 (rà kiem-dinh Task 7 b + Task 8 E) — kiểm TĨNH endpoint (`kiemEndpointLuu`) và nhận diện link-local / metadata
 * (`laLinkLocalHoacMetadata`, dùng cả cho ĐỊA CHỈ ĐÃ PHÂN GIẢI lúc gọi).
 */
import { describe, expect, it } from "vitest";
import { kiemEndpointLuu, laLinkLocalHoacMetadata } from "./urlNgoai";

const ma = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { ma?: string }).ma ?? String(e);
  }
};

describe("kiemEndpointLuu", () => {
  it("scheme lạ (ftp / file / gopher / data / javascript) ⇒ NGOAI_URL_KHONG_HOP_LE kể cả khi host:cổng ĐÃ KHAI nội bộ", () => {
    const khai = new Set(["llm.local:2121", "llm.local:80", "llm.local:443"]);
    for (const u of ["ftp://llm.local:2121/v1", "file:///etc/passwd", "file://llm.local/x", "gopher://llm.local:80/", "data:text/plain,hi", "javascript:alert(1)"]) {
      expect(ma(() => kiemEndpointLuu(u, khai)), u).toBe("NGOAI_URL_KHONG_HOP_LE");
    }
  });

  it("userinfo / query / http công cộng / metadata ⇒ từ chối; nội bộ đã khai qua http ⇒ cho; công cộng https ⇒ chuẩn hoá", () => {
    for (const u of ["https://u:p@api.x.com/v1", "https://api.x.com/v1?k=1", "http://api.x.com/v1", "https://169.254.169.254/", "https://metadata.google.internal/"]) {
      expect(ma(() => kiemEndpointLuu(u, new Set(["169.254.169.254:443", "metadata.google.internal:443"]))), u).toBe("NGOAI_URL_KHONG_HOP_LE");
    }
    expect(ma(() => kiemEndpointLuu("http://llm.local:8000/v1", new Set()))).toBe("NGOAI_URL_KHONG_HOP_LE");
    expect(kiemEndpointLuu("http://llm.local:8000/v1", new Set(["llm.local:8000"]))).toBe("http://llm.local:8000/v1");
    expect(kiemEndpointLuu("https://API.Example.COM./v1/", new Set())).toBe("https://api.example.com/v1");
  });
});

describe("laLinkLocalHoacMetadata (host hoặc IP đã phân giải)", () => {
  it.each([
    ["169.254.169.254", true],
    ["169.254.0.1", true],
    ["::ffff:169.254.169.254", true],
    ["[fe80::1]", true],
    ["fe80::abcd", true],
    ["febf::1", true],
    ["metadata.google.internal", true],
    ["10.0.0.5", false],
    ["8.8.4.4", false],
    ["fec0::1", false],
    ["::1", false],
  ])("%s ⇒ %s", (h, mong) => expect(laLinkLocalHoacMetadata(h)).toBe(mong));
});
