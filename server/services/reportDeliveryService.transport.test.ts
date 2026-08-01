/**
 * doc 54 §11 P2.4 #4 — credential-gated transport selection + graceful skip.
 *
 * Proves the delivery service correctly reports which optional transports are
 * configured (SendGrid / SES-over-SMTP for email fallback; FCM / APNs for mobile
 * push) and that deliverReportPush degrades gracefully — it SKIPS (never throws,
 * never fabricates success) when no push transport or no device tokens exist.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sendGridConfigured,
  sesSmtpConfigured,
  fcmPushConfigured,
  apnsPushConfigured,
  pushTransportConfigured,
  pushTransportStatus,
  deliverReportPush,
} from "./reportDeliveryService";

const TRANSPORT_ENV = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_PROJECT_ID",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "APNS_AUTH_KEY_BASE64",
  "SENDGRID_API_KEY",
  "SES_SMTP_HOST",
  "SES_SMTP_USER",
  "SES_SMTP_PASS",
] as const;

describe("reportDeliveryService — transport selection (credential-gated)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of TRANSPORT_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of TRANSPORT_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reports every optional transport as unconfigured when env is unset", () => {
    expect(sendGridConfigured()).toBe(false);
    expect(sesSmtpConfigured()).toBe(false);
    expect(fcmPushConfigured()).toBe(false);
    expect(apnsPushConfigured()).toBe(false);
    expect(pushTransportConfigured()).toBe(false);
    expect(pushTransportStatus()).toEqual({ fcm: false, apns: false, configured: false });
  });

  it("detects SendGrid / SES / FCM once their env is present", () => {
    process.env.SENDGRID_API_KEY = "SG.test";
    process.env.SES_SMTP_HOST = "email-smtp.us-east-1.amazonaws.com";
    process.env.SES_SMTP_USER = "user";
    process.env.SES_SMTP_PASS = "pass";
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{}";
    process.env.FIREBASE_PROJECT_ID = "proj-123";

    expect(sendGridConfigured()).toBe(true);
    expect(sesSmtpConfigured()).toBe(true);
    expect(fcmPushConfigured()).toBe(true);
    expect(pushTransportConfigured()).toBe(true);
    expect(pushTransportStatus().configured).toBe(true);
  });

  it("requires ALL four APNs vars before apnsPushConfigured() is true", () => {
    process.env.APNS_KEY_ID = "k";
    process.env.APNS_TEAM_ID = "t";
    expect(apnsPushConfigured()).toBe(false); // still missing bundle + auth key
    process.env.APNS_BUNDLE_ID = "com.app";
    process.env.APNS_AUTH_KEY_BASE64 = "base64key";
    expect(apnsPushConfigured()).toBe(true);
  });

  it("deliverReportPush SKIPS gracefully (no throw / no fabricated success) when unconfigured", async () => {
    const out = await deliverReportPush(["device-token-1"], { title: "t", body: "b" });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });

  it("deliverReportPush skips when a transport is configured but no tokens are supplied", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{}";
    process.env.FIREBASE_PROJECT_ID = "proj-123";
    const out = await deliverReportPush([], { title: "t", body: "b" });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });
});
