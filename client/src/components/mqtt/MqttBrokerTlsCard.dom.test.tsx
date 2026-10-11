// @vitest-environment jsdom
//
// doc 81 Đợt 7 task J1 / J redesign (round 4) — the "Built-in broker TLS" card shows one of three states of the
// ADMIN-provisioned material: not provisioned (with the expected path), OK (the exact fingerprint the technician types
// into each tablet), or refused (the server's read-only verification found doubt — reason shown, NO fingerprint offered).
// Real render; only the network contract (`@/lib/trpc`) and `sonner` are mocked. The card is hidden without permission.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type Status = {
  running: boolean; enabled: boolean; listening: boolean; port: number | null; fingerprintSha256: string | null;
  source: "default" | "configured" | null; notAfter: string | null; certPath: string | null; error: string | null; plainEnabled: boolean;
};
let data: Status | undefined;
const useQuery = vi.fn((_input: unknown, opts: { enabled: boolean }) => ({ data: opts.enabled ? data : undefined, isError: false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// J fix 1 — no i18next instance in this test: translate to the key (same as the fallback) without the stderr warning.
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}${JSON.stringify(o)}` : k) }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { mqttClient: { brokerTls: { useQuery: (i: unknown, o: { enabled: boolean }) => useQuery(i, o) } } } }));

import { MqttBrokerTlsCard } from "./MqttBrokerTlsCard";

const FP = "3A:9F:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:01:23:45:67:89:AB:CD:EF:10:32:54:76:98:BA";
const CERT = "C:\\ProgramData\\avi-aoi\\mqtt-tls\\broker.crt";
const OK: Status = {
  running: true, enabled: true, listening: true, port: 8884, fingerprintSha256: FP, source: "default",
  notAfter: "2046-10-06T00:00:00.000Z", certPath: CERT, error: null, plainEnabled: true,
};
const writeText = vi.fn(async () => {});
beforeEach(() => {
  useQuery.mockClear();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => cleanup());

describe("MqttBrokerTlsCard", () => {
  it("no permission ⇒ renders nothing and the query is disabled", () => {
    data = OK;
    const { container } = render(<MqttBrokerTlsCard enabled={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(useQuery.mock.calls[0][1]).toMatchObject({ enabled: false });
  });

  it("listening ⇒ port + the EXACT fingerprint + copy copies it verbatim; default location said; plaintext still open is said", async () => {
    data = OK;
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusListening");
    expect(screen.getByTestId("mqtt-broker-tls-fingerprint").textContent).toBe(FP);
    expect(screen.getByTestId("mqtt-broker-tls-plain")).toHaveTextContent("mqtt.clientMgmt.brokerTls.plainOpen");
    expect(screen.getByTestId("mqtt-broker-tls")).toHaveTextContent("mqtt.clientMgmt.brokerTls.sourceDefault");
    expect(screen.queryByTestId("mqtt-broker-tls-provision")).toBeNull();
    expect(screen.queryByTestId("mqtt-broker-tls-refused")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FP));
    cleanup();
    data = { ...OK, source: "configured" };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls")).toHaveTextContent("mqtt.clientMgmt.brokerTls.sourceConfigured");
  });

  it("NOT provisioned ⇒ a warning (not an error) with the provisioning hint and the expected certificate path; no fingerprint", () => {
    data = { ...OK, listening: false, port: null, fingerprintSha256: null, source: null, notAfter: null, error: "TLS_NOT_PROVISIONED" };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.notProvisioned");
    expect(screen.getByTestId("mqtt-broker-tls-status")).not.toHaveTextContent("statusError");
    expect(screen.getByTestId("mqtt-broker-tls-provision")).toHaveTextContent("mqtt.clientMgmt.brokerTls.provisionHint");
    expect(screen.getByTestId("mqtt-broker-tls-path").textContent).toBe(CERT);
    expect(screen.queryByTestId("mqtt-broker-tls-fingerprint")).toBeNull();
    expect(screen.queryByTestId("mqtt-broker-tls-refused")).toBeNull();
  });

  it("a verification refusal ⇒ error badge with ITS reason, a 'refused' alert with the path, and NO fingerprint to copy (even if the server knew one)", () => {
    for (const code of ["TLS_KEY_OWNER_FOREIGN", "TLS_KEY_ACL_OPEN", "TLS_KEY_ACL_UNPROTECTED", "TLS_KEY_ACL_UNVERIFIED", "TLS_KEY_LINKED", "TLS_FILE_UNREADABLE", "TLS_FILE_CORRUPT", "TLS_KEY_MISMATCH", "TLS_CONFIG_INCOMPLETE"]) {
      cleanup();
      data = { ...OK, listening: false, port: null, error: code };
      render(<MqttBrokerTlsCard enabled />);
      expect(screen.getByTestId("mqtt-broker-tls-status"), code).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusError");
      expect(screen.getByTestId("mqtt-broker-tls-status"), code).toHaveTextContent(`mqtt.clientMgmt.brokerTls.error_${code}`);
      expect(screen.getByTestId("mqtt-broker-tls-status"), code).not.toHaveTextContent("error_other");
      expect(screen.getByTestId("mqtt-broker-tls-refused"), code).toHaveTextContent("mqtt.clientMgmt.brokerTls.refusedHint");
      expect(screen.getByTestId("mqtt-broker-tls-path").textContent, code).toBe(CERT);
      expect(screen.queryByTestId("mqtt-broker-tls-fingerprint"), code).toBeNull();
      expect(screen.queryByRole("button", { name: "common.copy" }), code).toBeNull();
    }
    cleanup();
    data = { ...OK, listening: false, port: null, fingerprintSha256: null, error: "SOMETHING_NEW" };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.error_other");
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("SOMETHING_NEW");
    expect(screen.queryByTestId("mqtt-broker-tls-fingerprint")).toBeNull();
  });

  it("port taken ⇒ error badge (the fingerprint is still shown: the certificate itself is fine, no 'refused' alert)", () => {
    data = { ...OK, listening: false, port: null, error: "EADDRINUSE" };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusError");
    expect(screen.getByTestId("mqtt-broker-tls-fingerprint").textContent).toBe(FP);
    expect(screen.queryByTestId("mqtt-broker-tls-refused")).toBeNull();
  });

  it("TLS turned off / broker off / plaintext closed are each said", () => {
    data = { ...OK, enabled: false, listening: false, fingerprintSha256: null };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusOff");
    cleanup();
    data = { ...OK, running: false };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.brokerOff");
    cleanup();
    data = { ...OK, plainEnabled: false };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-plain")).toHaveTextContent("mqtt.clientMgmt.brokerTls.plainClosed");
  });
});
