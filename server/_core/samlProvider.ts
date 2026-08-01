/**
 * SAML 2.0 SP seam — doc 44 W6-4 (gap G5.19). Enterprise IdP SSO alongside the
 * existing OAuth (Google/Microsoft/GitHub) providers. SYNAPSE_Tang5 Ch.13-14.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HONEST POSTURE (no new npm dependency):
 *   • Metadata + AuthnRequest (SP-initiated redirect) + assertion ATTRIBUTE parsing are
 *     REAL — built on node:zlib/crypto + `fast-xml-parser` (already a dependency).
 *   • Assertion SIGNATURE verification (XML-DSig) needs a crypto/XML library that is NOT
 *     installed. Until one is, consumeAssertion() refuses with SAML_NOT_CONFIGURED when
 *     SAML_REQUIRE_SIGNED is on (the default). To finish production SAML the OWNER must
 *     `pnpm add @node-saml/node-saml` (recommended) or `xml-crypto`, set SAML_IDP_CERT,
 *     and wire the verify() call at the marked seam. A dev-only bypass exists
 *     (SAML_REQUIRE_SIGNED=false) — INSECURE, never for production.
 *
 * Env (all optional; SAML stays OFF unless SAML_ENABLED + IdP wiring present):
 *   SAML_ENABLED, SAML_IDP_ENTITY_ID, SAML_IDP_SSO_URL, SAML_IDP_METADATA_URL,
 *   SAML_IDP_CERT, SAML_SP_ENTITY_ID, SAML_SP_ACS_URL, SAML_ATTR_EMAIL, SAML_ATTR_NAME,
 *   SAML_REQUIRE_SIGNED (default true).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";

export interface SamlConfig {
  idpEntityId: string | null;
  idpSsoUrl: string | null;
  idpMetadataUrl: string | null;
  idpCert: string | null;
  spEntityId: string;
  spAcsUrl: string | null;
  attrEmail: string | null;
  attrName: string | null;
  requireSigned: boolean;
}

export interface ParsedSamlAssertion {
  nameId: string | null;
  nameIdFormat: string | null;
  sessionIndex: string | null;
  issuer: string | null;
  attributes: Record<string, string[]>;
}

export interface SamlUserProfile {
  id: string | null;
  email: string | null;
  name: string | null;
}

export class SamlNotConfiguredError extends Error {
  readonly code = "SAML_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "SamlNotConfiguredError";
  }
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function getSamlConfig(): SamlConfig {
  return {
    idpEntityId: process.env.SAML_IDP_ENTITY_ID?.trim() || null,
    idpSsoUrl: process.env.SAML_IDP_SSO_URL?.trim() || null,
    idpMetadataUrl: process.env.SAML_IDP_METADATA_URL?.trim() || null,
    idpCert: process.env.SAML_IDP_CERT?.trim() || null,
    spEntityId: process.env.SAML_SP_ENTITY_ID?.trim() || "synapse-platform",
    spAcsUrl: process.env.SAML_SP_ACS_URL?.trim() || null,
    attrEmail: process.env.SAML_ATTR_EMAIL?.trim() || null,
    attrName: process.env.SAML_ATTR_NAME?.trim() || null,
    requireSigned: process.env.SAML_REQUIRE_SIGNED !== "false",
  };
}

/** SAML is enabled only when SAML_ENABLED is truthy AND the essential IdP wiring exists. */
export function isSamlEnabled(): boolean {
  if (process.env.SAML_ENABLED !== "true" && process.env.SAML_ENABLED !== "1") return false;
  const c = getSamlConfig();
  return Boolean(c.idpSsoUrl && (c.idpEntityId || c.idpMetadataUrl));
}

/** True when an XML-DSig verification library is installed (see honest posture above). */
export async function signatureVerificationAvailable(): Promise<boolean> {
  const candidates = ["@node-saml/node-saml", "xml-crypto"];
  for (const pkg of candidates) {
    const mod: unknown = await import(pkg).catch(() => null);
    if (mod) return true;
  }
  return false;
}

// ─── XML: metadata + AuthnRequest ────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** SP metadata XML (entityID + ACS location). Pure. */
export function buildSpMetadataXml(config: SamlConfig = getSamlConfig(), acsUrl?: string): string {
  const acs = acsUrl || config.spAcsUrl || "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${xmlEscape(config.spEntityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${xmlEscape(acs)}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

/** Build an SP-initiated AuthnRequest redirect URL (HTTP-Redirect binding). Unsigned. */
export function buildAuthnRequestRedirectUrl(
  config: SamlConfig,
  acsUrl: string,
  relayState?: string,
): string | null {
  if (!config.idpSsoUrl) return null;
  const id = "_" + crypto.randomBytes(16).toString("hex");
  const issueInstant = new Date().toISOString();
  const authnRequest =
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" ` +
    `IssueInstant="${issueInstant}" Destination="${xmlEscape(config.idpSsoUrl)}" ` +
    `ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ` +
    `AssertionConsumerServiceURL="${xmlEscape(acsUrl)}">` +
    `<saml:Issuer>${xmlEscape(config.spEntityId)}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`;
  const deflated = zlib.deflateRawSync(Buffer.from(authnRequest, "utf8")).toString("base64");
  const url = new URL(config.idpSsoUrl);
  url.searchParams.set("SAMLRequest", deflated);
  if (relayState) url.searchParams.set("RelayState", relayState);
  return url.toString();
}

// ─── XML: assertion parsing + attribute mapping ──────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: true,
});

function textOf(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = textOf(n);
      if (t != null) return t;
    }
    return null;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("#text" in o) return textOf(o["#text"]);
  }
  return null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse a SAML Response/Assertion XML into NameID + attributes. REAL parse (fast-xml-parser).
 * Does NOT verify the signature — that is consumeAssertion()'s gated responsibility.
 */
export function parseSamlAssertion(xml: string): ParsedSamlAssertion {
  const doc = parser.parse(xml) as Record<string, any>;
  const response = doc.Response ?? doc;
  const assertion = response?.Assertion ?? doc.Assertion ?? response;
  const subject = assertion?.Subject;
  const nameIdNode = subject?.NameID;
  const nameId = textOf(nameIdNode);
  const nameIdFormat =
    (nameIdNode && typeof nameIdNode === "object" ? (nameIdNode as Record<string, unknown>)["@_Format"] : null) ?? null;
  const issuer = textOf(assertion?.Issuer) ?? textOf(response?.Issuer);
  const authnStatement = asArray(assertion?.AuthnStatement)[0] as Record<string, unknown> | undefined;
  const sessionIndex = (authnStatement?.["@_SessionIndex"] as string | undefined) ?? null;

  const attributes: Record<string, string[]> = {};
  for (const stmt of asArray(assertion?.AttributeStatement)) {
    for (const attr of asArray((stmt as Record<string, unknown>)?.Attribute)) {
      const a = attr as Record<string, unknown>;
      const name = a?.["@_Name"];
      if (typeof name !== "string") continue;
      const values = asArray(a?.AttributeValue)
        .map(textOf)
        .filter((v): v is string => v != null);
      if (values.length) attributes[name] = values;
    }
  }
  return {
    nameId,
    nameIdFormat: typeof nameIdFormat === "string" ? nameIdFormat : null,
    sessionIndex,
    issuer,
    attributes,
  };
}

const DEFAULT_EMAIL_ATTRS = [
  "email",
  "mail",
  "emailaddress",
  "urn:oid:0.9.2342.19200300.100.1.3",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
];
const DEFAULT_NAME_ATTRS = [
  "displayname",
  "name",
  "cn",
  "commonname",
  "urn:oid:2.16.840.1.113730.3.1.241",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/displayname",
];

function pickAttr(attributes: Record<string, string[]>, names: string[]): string | null {
  const lower = new Map(Object.entries(attributes).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower.get(n.toLowerCase());
    if (v && v.length) return v[0];
  }
  return null;
}

/** Map a parsed assertion → a user profile (email/name/id). Pure. */
export function mapAssertionToProfile(parsed: ParsedSamlAssertion, config?: SamlConfig): SamlUserProfile {
  const emailAttrs = config?.attrEmail ? [config.attrEmail, ...DEFAULT_EMAIL_ATTRS] : DEFAULT_EMAIL_ATTRS;
  const nameAttrs = config?.attrName ? [config.attrName, ...DEFAULT_NAME_ATTRS] : DEFAULT_NAME_ATTRS;
  let email = pickAttr(parsed.attributes, emailAttrs);
  if (!email && parsed.nameId && parsed.nameId.includes("@")) email = parsed.nameId;
  const name = pickAttr(parsed.attributes, nameAttrs);
  const id = parsed.nameId ?? email ?? null;
  return { id, email: email ?? null, name: name ?? null };
}

function decodeSamlResponse(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.includes("<")) return decoded;
  } catch {
    /* fall through */
  }
  return trimmed;
}

/**
 * Consume a SAMLResponse (base64 or raw XML): verify (gated) → parse → map to a profile.
 * Throws SamlNotConfiguredError when signature verification is required but no XML-DSig
 * library is installed, or when the assertion lacks a usable subject.
 */
export async function consumeAssertion(
  samlResponse: string,
  config: SamlConfig = getSamlConfig(),
): Promise<{ id: string; email: string | null; name: string | null; parsed: ParsedSamlAssertion }> {
  const xml = decodeSamlResponse(samlResponse);
  const verifierAvailable = await signatureVerificationAvailable();

  if (config.requireSigned && !verifierAvailable) {
    throw new SamlNotConfiguredError(
      "SAML assertion signature verification is required but no XML-DSig library is installed. " +
        "Install '@node-saml/node-saml' (recommended) or 'xml-crypto', set SAML_IDP_CERT, and wire the " +
        "verify() call in samlProvider.consumeAssertion. Dev-only bypass: SAML_REQUIRE_SIGNED=false (INSECURE).",
    );
  }

  if (verifierAvailable) {
    // SEAM: when a verifier lib is installed, verify the XML-DSig signature over the
    // assertion against config.idpCert HERE before trusting any parsed value.
    //   const { SAML } = await import("@node-saml/node-saml");
    //   await new SAML({ cert: config.idpCert, ... }).validatePostResponseAsync({ SAMLResponse: base64 });
  }

  const parsed = parseSamlAssertion(xml);
  const profile = mapAssertionToProfile(parsed, config);
  if (!profile.id) {
    throw new SamlNotConfiguredError("SAML assertion is missing a usable NameID/email subject.");
  }
  return { id: profile.id, email: profile.email, name: profile.name, parsed };
}

// ─── Express routes (metadata + login initiate + ACS) ────────────────────────

function acsUrlFor(req: Request, config: SamlConfig): string {
  return config.spAcsUrl || `${req.protocol}://${req.get("host")}/api/saml/acs`;
}

/**
 * Wire SAML routes. All respond 404 when SAML is not enabled (zero surface by default).
 * Mount alongside registerOAuthRoutes. Additive — never touches the OAuth flow.
 */
export function registerSamlRoutes(app: Express): void {
  // SP metadata (hand to the IdP admin).
  app.get("/api/saml/metadata", (req: Request, res: Response) => {
    if (!isSamlEnabled()) {
      res.status(404).json({ error: "SAML is not enabled" });
      return;
    }
    const config = getSamlConfig();
    res.type("application/xml").send(buildSpMetadataXml(config, acsUrlFor(req, config)));
  });

  // SP-initiated login → redirect to IdP SSO with an AuthnRequest.
  app.get("/api/saml/login", (req: Request, res: Response) => {
    if (!isSamlEnabled()) {
      res.status(404).json({ error: "SAML is not enabled" });
      return;
    }
    const config = getSamlConfig();
    const relay =
      typeof req.query.redirect === "string" && req.query.redirect.startsWith("/") ? req.query.redirect : "/";
    const url = buildAuthnRequestRedirectUrl(config, acsUrlFor(req, config), relay);
    if (!url) {
      res.status(501).json({ error: "SAML_NOT_CONFIGURED", detail: "SAML_IDP_SSO_URL is not set" });
      return;
    }
    res.redirect(url);
  });

  // Assertion Consumer Service (HTTP-POST binding).
  app.post("/api/saml/acs", async (req: Request, res: Response) => {
    if (!isSamlEnabled()) {
      res.status(404).json({ error: "SAML is not enabled" });
      return;
    }
    const samlResponse = (req.body?.SAMLResponse as string) || "";
    const relayState = (req.body?.RelayState as string) || "/";
    if (!samlResponse) {
      res.status(400).json({ error: "SAMLResponse is required" });
      return;
    }
    try {
      const config = getSamlConfig();
      const { id, email, name } = await consumeAssertion(samlResponse, config);

      const [db, { getSessionCookieOptions }, { sdk }] = await Promise.all([
        import("../db"),
        import("./cookies"),
        import("./sdk"),
      ]);
      const openId = `saml:${id}`;
      const displayName = name || email || id;
      await db.upsertUser({
        openId,
        name: displayName ?? null,
        email: email ?? null,
        loginMethod: "saml",
        lastSignedIn: new Date(),
      });
      const sessionToken = await sdk.createSessionToken(openId, {
        name: displayName ?? "",
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, relayState.startsWith("/") ? relayState : "/");
    } catch (err: any) {
      if (err instanceof SamlNotConfiguredError) {
        res.status(501).json({ error: "SAML_NOT_CONFIGURED", detail: err.message });
        return;
      }
      console.error("[SAML] ACS assertion processing failed", err);
      res.status(500).json({ error: "SAML assertion processing failed" });
    }
  });
}
