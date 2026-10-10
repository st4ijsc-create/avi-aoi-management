// @vitest-environment jsdom
/**
 * doc 81 Đợt 5 task G2 (item 8) — the IoT Telemetry API-docs page teaches what the server ACCEPTS.
 *
 * Oracle = the REAL server ingest rules, not a copy of them:
 *   · `docTsThietBi` (server/utils/factoryTime.ts) — `ts` must carry a timezone;
 *   · `kiemMauTelemetryThuocMay` — a machine key writes only for its own machine (else 403 machine_mismatch);
 *   · `kiemMauTelemetryGateway` — an IOT_GATEWAY key writes only for devices on its allowlist
 *     (else / empty list ⇒ 403 gateway_device_not_allowed);
 *   · `extractCredential`'s accepted transports (server/api/v1/auth.ts): `Authorization: Bearer` or `X-API-Key`.
 * Every sample printed on the page is parsed back out of the example text and run through those functions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { docTsThietBi } from "../../../../server/utils/factoryTime";
import { kiemMauTelemetryGateway, kiemMauTelemetryThuocMay } from "../../../../server/api/v1/ingestRangBuoc";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { IoTTelemetrySection, buildTelemetryDocExamples } from "./IoTTelemetrySection";

type Sample = { deviceId?: string; machineId?: number; metric: string; ts?: string };

/** Pull the `samples` array out of a curl `-d '…'` body or a Python dict literal. */
function samplesOf(example: string): Sample[] {
  const curl = example.match(/-d '(\{[\s\S]*\})'/);
  if (curl) return JSON.parse(curl[1]).samples;
  const py = example.match(/batch = (\{[\s\S]*?\]\})/);
  if (py) {
    // Python → JSON: `TS` is the timezone-aware datetime the example computes; trailing commas dropped.
    const tsExpr = example.match(/^TS = (.*?)\s*(#.*)?$/m)?.[1] ?? "";
    expect(tsExpr).toMatch(/datetime\.now\(timezone\.utc\)\.isoformat\(\)/); // aware ⇒ ISO with +00:00
    const json = py[1].replace(/: TS\b/g, ': "2026-07-17T07:03:00.123456+00:00"').replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(json).samples;
  }
  throw new Error(`no samples found in example:\n${example}`);
}

const ex = buildTelemetryDocExamples("https://factory.example");
const requestExamples = [ex.deviceCurl, ex.gatewayCurl, ex.screwTelemetryCurl, ex.python];

afterEach(cleanup);

describe("IoT Telemetry docs — examples obey the real server rules", () => {
  it("every example authenticates with a transport /api/v1 actually reads (Bearer or X-API-Key, never `ApiKey`)", () => {
    for (const e of requestExamples) {
      expect(e).not.toMatch(/Authorization:\s*ApiKey/i);
      expect(e).not.toMatch(/"Authorization":\s*"ApiKey/i);
      expect(e).toMatch(/Authorization["']?:\s*["']?Bearer |X-API-Key/);
    }
  });

  it("every sample carries `ts` WITH a timezone (docTsThietBi accepts it)", () => {
    for (const e of requestExamples) {
      for (const s of samplesOf(e)) {
        expect(s.ts, `${s.metric} has no ts`).toBeTruthy();
        const r = docTsThietBi(s.ts);
        expect(r.ok, `${s.ts}: ${JSON.stringify(r)}`).toBe(true);
      }
    }
  });

  it("machine-key examples write only for the key's own machine (no 403 machine_mismatch)", () => {
    const own = { id: 7, code: ex.deviceKeyMachine };
    for (const e of [ex.deviceCurl, ex.python]) {
      expect(() => kiemMauTelemetryThuocMay(samplesOf(e), own)).not.toThrow();
    }
    expect(() => kiemMauTelemetryThuocMay(samplesOf(ex.screwTelemetryCurl), { id: 8, code: ex.screwMachine })).not.toThrow();
    // the documented 202 response names that same machine
    const resp = JSON.parse(ex.telemetryResponse);
    expect(resp).toEqual({ ok: true, data: { accepted: 2, received: 2, machine: ex.deviceKeyMachine } });
  });

  it("gateway example targets ONLY devices on the documented allowlist; an empty allowlist is a 403", () => {
    const gw = { id: 100, code: ex.gatewayMachine, machineType: "IOT_GATEWAY" };
    const allow = ex.gatewayAllowlist.map((code, i) => ({ id: 200 + i, code }));
    const samples = samplesOf(ex.gatewayCurl);
    expect(new Set(samples.map((s) => s.deviceId)).size).toBeGreaterThan(1); // really forwards several devices
    expect(() => kiemMauTelemetryGateway(samples, gw, allow)).not.toThrow();
    expect(() => kiemMauTelemetryGateway(samples, gw, [])).toThrow(/EMPTY device allowlist/);
  });
});

describe("IoT Telemetry docs — page text", () => {
  it("documents the HTTP codes integrators actually get (202/207/400/401/403/503) and the 403/400 reasons", () => {
    const { container } = render(<IoTTelemetrySection endpointBase="" baseUrl="https://factory.example" />);
    const text = container.textContent ?? "";
    for (const code of ["202", "207", "400", "401", "403", "503"]) {
      expect(text, `HTTP ${code}`).toContain(code);
    }
    for (const reason of ["machine_mismatch", "gateway_device_not_allowed", "all_rejected", "db_unavailable"]) {
      expect(text, reason).toContain(reason);
    }
    // field-table rows for ts / deviceId go through i18n (rules live in the dictionaries)
    expect(text).toContain("apiFeeds.fieldTsDesc");
    expect(text).toContain("apiFeeds.fieldDeviceIdDesc");
    expect(text).toContain("apiFeeds.gatewayNote");
    expect(text).not.toMatch(/Offset khuyến nghị/);
    expect(text).not.toMatch(/Authorization:\s*ApiKey/i); // the auth badge too
  });
});

describe("IoT Telemetry docs — dictionaries (vi/en/zh) state the rules", () => {
  const locales = {
    vi: require("../../i18n/locales/vi.json"),
    en: require("../../i18n/locales/en.json"),
    zh: require("../../i18n/locales/zh.json"),
  } as Record<string, any>;
  it.each(Object.keys(locales))("%s: ts needs a timezone; deviceId rules name both 403 codes; gateway note names the allowlist", (l) => {
    const a = locales[l].apiFeeds;
    expect(a.fieldTsDesc).toMatch(/ts_no_timezone/);
    expect(a.fieldTsDesc).toMatch(/ts_too_far_future/);
    expect(a.fieldTsDesc).toMatch(/Z.*±hh:mm|±hh:mm.*Z/);
    expect(a.fieldDeviceIdDesc).toMatch(/machine_mismatch/);
    expect(a.fieldDeviceIdDesc).toMatch(/gateway_device_not_allowed/);
    expect(a.fieldDeviceIdDesc).toMatch(/IOT_GATEWAY/);
    expect(a.gatewayNote).toMatch(/IOT_GATEWAY/);
    expect(a.telemetryAuthDesc).toMatch(/Bearer/);
    expect(a.telemetryAuthDesc).not.toMatch(/ApiKey/);
    for (const k of ["telemetryStatusTitle", "exampleGateway", "status202", "status207", "status400BadRequest",
      "status400AllRejected", "status401", "status403Machine", "status403Gateway", "status503"]) {
      expect(typeof a[k], `${l}.apiFeeds.${k}`).toBe("string");
      expect(a[k].length).toBeGreaterThan(0);
    }
  });
});
