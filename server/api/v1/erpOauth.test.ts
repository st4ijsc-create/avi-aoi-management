/**
 * K0+-a (doc 16 §4 Khối 0 / doc 18 §6) — OAuth2 client-credentials tests.
 *
 * Covers the pure token issue/verify surface AND the /oauth/token endpoint:
 *   • valid client → token carrying its scopes; the token verifies + is accepted
 *     as an alternative inbound Bearer (resolvePrincipal);
 *   • bad secret → invalid_client;
 *   • expired token → verifyToken rejects;
 *   • flag OFF → /oauth/token returns 503 oauth_disabled AND resolvePrincipal does
 *     NOT treat a JWT as an OAuth principal (falls back to existing auth).
 *
 * The DB (erp_oauth_clients lookup) is mocked; token signing uses the real `jose`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// A single registered client: clientId "erpc_test", secret "s3cr3t", scope erp:write.
const CLIENT = {
  id: 1,
  clientId: "erpc_test",
  clientSecretHash: sha256("s3cr3t"),
  name: "Test ERP",
  scopes: ["erp:write"],
  enabled: true,
};

function makeFakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [CLIENT],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ catch: () => undefined }) }) }),
  };
}

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null), // resolvePrincipal api_keys path → none
  getMachineByApiKey: vi.fn(async () => undefined),
}));
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../../../drizzle/schema", () => ({
  erpOauthClients: { clientId: "clientId", id: "id" },
  apiKeys: { keyHash: "keyHash", isActive: "isActive", id: "id" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: any[]) => a, eq: (...a: any[]) => a }));

import { issueToken, verifyToken, tokenToPrincipal, registerErpOauthRoutes } from "./erpOauth";
import { resolvePrincipal } from "./auth";
import { SignJWT } from "jose";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.ERP_OAUTH_SIGNING_SECRET = "test-signing-secret";
  const app = express();
  app.use(express.json());
  const r = express.Router();
  registerErpOauthRoutes(r);
  app.use("/api/v1", r);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env.ERP_OAUTH_ENABLED = "true";
});

async function tokenRequest(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("K0+-a OAuth2 token issue + verify (pure)", () => {
  it("issues a token carrying the granted scopes that verifies back", async () => {
    const issued = await issueToken("erpc_test", ["erp:write"]);
    expect(issued.tokenType).toBe("Bearer");
    expect(issued.expiresIn).toBeGreaterThan(0);
    const verified = await verifyToken(issued.accessToken);
    expect(verified).not.toBeNull();
    expect(verified!.clientId).toBe("erpc_test");
    expect(verified!.scopes).toEqual(["erp:write"]);
    // Adapts to an ApiPrincipal the existing requireScope pipeline understands.
    const principal = tokenToPrincipal(verified!);
    expect(principal.kind).toBe("oauth");
    expect(principal.scopes).toContain("erp:write");
  });

  it("rejects an expired token", async () => {
    const secret = new TextEncoder().encode("test-signing-secret");
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = await new SignJWT({ scope: ["erp:write"], clientId: "erpc_test" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("erp-gateway")
      .setAudience("erp-inbound")
      .setSubject("erpc_test")
      .setIssuedAt(past - 60)
      .setExpirationTime(past)
      .sign(secret);
    expect(await verifyToken(expired)).toBeNull();
  });

  it("returns null for a non-JWT bearer (falls back to API-key auth)", async () => {
    expect(await verifyToken("ak_plain_api_key")).toBeNull();
  });
});

describe("K0+-a /oauth/token endpoint", () => {
  it("issues a token for a valid client (client_credentials)", async () => {
    const resp = await tokenRequest({ grant_type: "client_credentials", client_id: "erpc_test", client_secret: "s3cr3t" });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.data.token_type).toBe("Bearer");
    expect(typeof body.data.access_token).toBe("string");
    expect(body.data.scope).toBe("erp:write");
  });

  it("rejects a bad secret with invalid_client (401)", async () => {
    const resp = await tokenRequest({ grant_type: "client_credentials", client_id: "erpc_test", client_secret: "WRONG" });
    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.error.code).toBe("invalid_client");
  });

  it("rejects an unsupported grant type", async () => {
    const resp = await tokenRequest({ grant_type: "password", client_id: "erpc_test", client_secret: "s3cr3t" });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe("unsupported_grant_type");
  });

  it("returns 503 oauth_disabled when ERP_OAUTH_ENABLED is off", async () => {
    process.env.ERP_OAUTH_ENABLED = "false";
    const resp = await tokenRequest({ grant_type: "client_credentials", client_id: "erpc_test", client_secret: "s3cr3t" });
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error.code).toBe("oauth_disabled");
  });
});

describe("K0+-a OAuth token accepted as inbound Bearer (additive, non-breaking)", () => {
  it("resolves a valid OAuth token to an oauth principal when the flag is on", async () => {
    const issued = await issueToken("erpc_test", ["erp:write"]);
    const principal = await resolvePrincipal(issued.accessToken);
    expect(principal).not.toBeNull();
    expect(principal!.kind).toBe("oauth");
    expect(principal!.scopes).toContain("erp:write");
  });

  it("does NOT treat a JWT as an OAuth principal when the flag is off (falls back)", async () => {
    process.env.ERP_OAUTH_ENABLED = "false";
    const issued = await issueToken("erpc_test", ["erp:write"]);
    // Flag off → OAuth path skipped; token is not a master/api/machine key → null.
    const principal = await resolvePrincipal(issued.accessToken);
    expect(principal).toBeNull();
  });

  it("still resolves the MASTER key (existing auth untouched)", async () => {
    const principal = await resolvePrincipal("MASTER");
    expect(principal?.kind).toBe("master");
  });
});
