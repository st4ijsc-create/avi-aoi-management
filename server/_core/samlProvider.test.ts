/**
 * doc 44 W6-4 (G5.19) — SAML 2.0 SP seam.
 *
 * Covers the REAL (no-dep) surface: SP metadata, assertion attribute parsing, attribute→
 * profile mapping — plus the HONEST refusal (SAML_NOT_CONFIGURED) when signature
 * verification is required but no XML-DSig library is installed.
 */
import { describe, it, expect } from "vitest";
import {
  buildSpMetadataXml,
  parseSamlAssertion,
  mapAssertionToProfile,
  consumeAssertion,
  isSamlEnabled,
  getSamlConfig,
  SamlNotConfiguredError,
  type SamlConfig,
} from "./samlProvider";

const SAMPLE_RESPONSE = `
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
  <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>
  <saml:Assertion>
    <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alice@example.com</saml:NameID>
    </saml:Subject>
    <saml:AuthnStatement SessionIndex="_session-123"></saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email"><saml:AttributeValue>alice@example.com</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="displayName"><saml:AttributeValue>Alice Example</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="groups">
        <saml:AttributeValue>engineers</saml:AttributeValue>
        <saml:AttributeValue>admins</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`;

describe("G5.19 — SAML SP metadata", () => {
  it("emits SP metadata with entityID + ACS location", () => {
    const cfg: SamlConfig = { ...getSamlConfig(), spEntityId: "synapse-sp" };
    const xml = buildSpMetadataXml(cfg, "https://app.example.com/api/saml/acs");
    expect(xml).toContain('entityID="synapse-sp"');
    expect(xml).toContain("SPSSODescriptor");
    expect(xml).toContain("https://app.example.com/api/saml/acs");
    expect(xml).toContain("HTTP-POST");
  });
});

describe("G5.19 — SAML assertion parsing + mapping", () => {
  it("parses NameID, issuer, sessionIndex and attributes", () => {
    const parsed = parseSamlAssertion(SAMPLE_RESPONSE);
    expect(parsed.nameId).toBe("alice@example.com");
    expect(parsed.nameIdFormat).toContain("emailAddress");
    expect(parsed.issuer).toBe("https://idp.example.com/metadata");
    expect(parsed.sessionIndex).toBe("_session-123");
    expect(parsed.attributes.email).toEqual(["alice@example.com"]);
    expect(parsed.attributes.displayName).toEqual(["Alice Example"]);
    expect(parsed.attributes.groups).toEqual(["engineers", "admins"]);
  });

  it("maps attributes → profile (email + name + id)", () => {
    const parsed = parseSamlAssertion(SAMPLE_RESPONSE);
    const profile = mapAssertionToProfile(parsed);
    expect(profile.email).toBe("alice@example.com");
    expect(profile.name).toBe("Alice Example");
    expect(profile.id).toBe("alice@example.com");
  });

  it("falls back to an email-shaped NameID when no email attribute exists", () => {
    const xml = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
      <saml:Subject><saml:NameID>bob@example.com</saml:NameID></saml:Subject>
    </saml:Assertion>`;
    const profile = mapAssertionToProfile(parseSamlAssertion(xml));
    expect(profile.email).toBe("bob@example.com");
    expect(profile.id).toBe("bob@example.com");
  });
});

describe("G5.19 — consumeAssertion signature gate (honest scaffold)", () => {
  it("refuses with SAML_NOT_CONFIGURED when signing is required but no DSig lib is installed", async () => {
    const cfg: SamlConfig = { ...getSamlConfig(), requireSigned: true };
    await expect(consumeAssertion(SAMPLE_RESPONSE, cfg)).rejects.toBeInstanceOf(SamlNotConfiguredError);
  });

  it("parses when signing is explicitly bypassed (dev-only SAML_REQUIRE_SIGNED=false)", async () => {
    const cfg: SamlConfig = { ...getSamlConfig(), requireSigned: false };
    const result = await consumeAssertion(SAMPLE_RESPONSE, cfg);
    expect(result.id).toBe("alice@example.com");
    expect(result.email).toBe("alice@example.com");
    expect(result.name).toBe("Alice Example");
  });
});

describe("G5.19 — isSamlEnabled default", () => {
  it("is off unless SAML_ENABLED + IdP wiring are present", () => {
    // Test env has no SAML_* configured → disabled.
    expect(isSamlEnabled()).toBe(false);
  });
});
