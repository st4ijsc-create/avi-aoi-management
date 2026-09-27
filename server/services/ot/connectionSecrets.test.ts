/**
 * doc 81 Đợt 1B final wave (item 5) — connectionSecrets: (a) restore đối xứng với redact trên MẢNG
 * (Task 12 minor: restore bỏ qua mảng ⇒ phần tử mang "[redacted]" bị lưu nguyên chuỗi placeholder
 * hoặc mất bí mật đã lưu); (b) `secretReentryRequired` — luật "đổi nơi gửi / cách bảo vệ bí mật thì
 * phải nhập lại bí mật": placeholder KHÔNG được khôi phục khi endpoint, securityMode, securityPolicy
 * hoặc trustOnFirstUse đổi so với dòng đã lưu (cả ha.secondaryOptions / ha.secondaryEndpoint).
 */
import { describe, it, expect } from "vitest";
import {
  REDACTED_SECRET,
  redactConnectionOptionSecrets,
  restoreRedactedSecrets,
  secretReentryRequired,
} from "./connectionSecrets";

describe("restoreRedactedSecrets ↔ redactConnectionOptionSecrets — đối xứng trên mảng", () => {
  it("mảng object: che theo từng phần tử ⇒ khôi phục theo ĐÚNG chỉ số ấy", () => {
    const stored = { endpoints: [{ host: "a", password: "pw-a" }, { host: "b", password: "pw-b" }] };
    const form = redactConnectionOptionSecrets(stored) as any;
    expect(form.endpoints[0].password).toBe(REDACTED_SECRET);
    expect(form.endpoints[1].password).toBe(REDACTED_SECRET);
    // Form đổi host của phần tử 2, giữ placeholder ⇒ bí mật của đúng phần tử ấy quay lại.
    form.endpoints[1].host = "b2";
    const back = restoreRedactedSecrets(form, stored) as any;
    expect(back).toEqual({ endpoints: [{ host: "a", password: "pw-a" }, { host: "b2", password: "pw-b" }] });
  });

  it("placeholder trong phần tử mảng mà kho không có gì ở chỉ số đó ⇒ bỏ khoá (không lưu chuỗi '[redacted]' làm mật khẩu)", () => {
    const back = restoreRedactedSecrets({ endpoints: [{ host: "a", password: REDACTED_SECRET }] }, { endpoints: [] }) as any;
    expect(back.endpoints[0]).toEqual({ host: "a" });
    expect(JSON.stringify(back)).not.toContain(REDACTED_SECRET);
  });

  it("mảng lồng trong object lồng: đối xứng ở mọi độ sâu; giá trị KHÔNG phải placeholder đi qua nguyên vẹn", () => {
    const stored = { ha: { pool: [{ token: "t-1" }, { token: "t-2" }] } };
    const form = redactConnectionOptionSecrets(stored) as any;
    form.ha.pool[0].token = "t-new"; // người dùng gõ token mới cho phần tử 1
    const back = restoreRedactedSecrets(form, stored) as any;
    expect(back.ha.pool).toEqual([{ token: "t-new" }, { token: "t-2" }]);
  });
});

describe("secretReentryRequired — đổi nơi gửi/cách bảo vệ ⇒ phải nhập lại bí mật", () => {
  const stored = {
    endpoint: "opc.tcp://10.0.0.5:4840",
    options: {
      userName: "op",
      password: "enc:v1:xxx",
      securityMode: "SignAndEncrypt",
      securityPolicy: "Basic256Sha256",
      ha: { secondaryEndpoint: "opc.tcp://10.0.0.6:4840", secondaryOptions: { userName: "op", password: "enc:v1:yyy", securityMode: "SignAndEncrypt" } },
    },
  };
  const form = () => redactConnectionOptionSecrets(stored.options) as Record<string, unknown>;

  it("không đổi gì + placeholder ⇒ null (giữ bí mật)", () => {
    expect(secretReentryRequired({ endpoint: stored.endpoint, options: form() }, stored)).toBeNull();
    expect(secretReentryRequired({ options: form() }, stored)).toBeNull();
    // Đổi trường KHÔNG ràng buộc (tên đăng nhập) vẫn được giữ bí mật.
    expect(secretReentryRequired({ options: { ...form(), userName: "op2" } }, stored)).toBeNull();
  });

  it.each([
    ["endpoint", { endpoint: "opc.tcp://attacker:4840" }, {}],
    ["securityMode", {}, { securityMode: "None", securityPolicy: "None" }],
    ["securityPolicy", {}, { securityPolicy: "Aes128_Sha256_RsaOaep" }],
    ["trustOnFirstUse", {}, { trustOnFirstUse: true }],
  ] as const)("đổi %s + placeholder ⇒ đòi nhập lại (field trả về đúng tên ấy)", (field, top, opt) => {
    const r = secretReentryRequired({ ...top, options: { ...form(), ...opt } }, stored);
    expect(r?.field).toBe(field);
  });

  it("cùng thay đổi nhưng gửi KÈM bí mật mới (không placeholder) ⇒ null", () => {
    const o = { ...form(), password: "New-Pw", securityMode: "None", securityPolicy: "None" } as any;
    o.ha = { ...o.ha, secondaryOptions: { ...o.ha.secondaryOptions, password: "New-2" } };
    expect(secretReentryRequired({ endpoint: "opc.tcp://other:4840", options: o }, stored)).toBeNull();
  });

  it("đổi endpoint mà KHÔNG gửi connectionOptions (kho đang giữ bí mật) ⇒ đòi nhập lại; dòng không có bí mật ⇒ null", () => {
    expect(secretReentryRequired({ endpoint: "opc.tcp://other:4840" }, stored)?.field).toBe("endpoint");
    expect(secretReentryRequired({ endpoint: "opc.tcp://other:4840" }, { endpoint: stored.endpoint, options: { userName: "op" } })).toBeNull();
    expect(secretReentryRequired({ endpoint: "opc.tcp://other:4840", options: { userName: "op" } }, { endpoint: stored.endpoint, options: { userName: "op" } })).toBeNull();
  });

  it("ha.secondaryOptions: đổi secondaryEndpoint / securityMode dự phòng + placeholder dự phòng ⇒ đòi nhập lại; chỉ đổi primary không đụng dự phòng", () => {
    const f1 = form() as any;
    f1.ha = { ...f1.ha, secondaryEndpoint: "opc.tcp://evil:4840" };
    expect(secretReentryRequired({ options: f1 }, stored)?.field).toBe("ha.secondaryEndpoint");
    const f2 = form() as any;
    f2.ha = { ...f2.ha, secondaryOptions: { ...f2.ha.secondaryOptions, securityMode: "None", securityPolicy: "None" } };
    expect(secretReentryRequired({ options: f2 }, stored)?.field).toBe("ha.secondaryOptions.securityMode");
    // Dự phòng gửi kèm mật khẩu mới ⇒ được.
    const f3 = form() as any;
    f3.ha = { ...f3.ha, secondaryEndpoint: "opc.tcp://new:4840", secondaryOptions: { ...f3.ha.secondaryOptions, password: "Sec-New" } };
    expect(secretReentryRequired({ options: f3 }, stored)).toBeNull();
  });

  it("dự phòng KHÔNG có secondaryOptions riêng dùng lại options chính (deviceAdapter.ts) ⇒ đổi secondaryEndpoint + placeholder chính cũng đòi nhập lại", () => {
    const st = { endpoint: "opc.tcp://p:4840", options: { password: "enc:v1:p", ha: { secondaryEndpoint: "opc.tcp://s:4840" } } };
    const f = redactConnectionOptionSecrets(st.options) as any;
    f.ha = { secondaryEndpoint: "opc.tcp://evil:4840" };
    expect(secretReentryRequired({ options: f }, st)?.field).toBe("ha.secondaryEndpoint");
  });

  it("so sánh THEO HIỆU LỰC (parse), không theo chữ: thiếu securityMode ≡ None/None; đổi hoa-thường không phải đổi", () => {
    const st = { endpoint: "e", options: { password: "enc:v1:p" } };
    expect(secretReentryRequired({ options: { password: REDACTED_SECRET, securityMode: "None" } }, st)).toBeNull();
    const st2 = { endpoint: "e", options: { password: "enc:v1:p", securityMode: "SignAndEncrypt" } };
    expect(secretReentryRequired({ options: { password: REDACTED_SECRET, securityMode: "signandencrypt", securityPolicy: "Basic256Sha256" } }, st2)).toBeNull();
    expect(secretReentryRequired({ options: { password: REDACTED_SECRET, securityMode: "Sign" } }, st2)?.field).toBe("securityMode");
  });
});
