// @vitest-environment jsdom
//
// doc 81 Đợt 7 task J1 — the "Built-in broker TLS" card shows the MQTTS state and the certificate fingerprint the
// technician types into each tablet. Real render; only the network contract (`@/lib/trpc`) and `sonner` are mocked.
// The fingerprint must be shown exactly (every byte — a tablet pins it character by character), errors must be
// shown as errors (never as a fingerprint the technician could copy), and the card is hidden without permission.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type Status = {
  running: boolean; enabled: boolean; listening: boolean; port: number | null; fingerprintSha256: string | null;
  source: "generated" | "configured" | null; notAfter: string | null; error: string | null; plainEnabled: boolean;
};
let data: Status | undefined;
const useQuery = vi.fn((_input: unknown, opts: { enabled: boolean }) => ({ data: opts.enabled ? data : undefined, isError: false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { mqttClient: { brokerTls: { useQuery: (i: unknown, o: { enabled: boolean }) => useQuery(i, o) } } } }));

import { MqttBrokerTlsCard } from "./MqttBrokerTlsCard";

const FP = "3A:9F:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:01:23:45:67:89:AB:CD:EF:10:32:54:76:98:BA";
const OK: Status = {
  running: true, enabled: true, listening: true, port: 8884, fingerprintSha256: FP, source: "generated",
  notAfter: "2046-10-06T00:00:00.000Z", error: null, plainEnabled: true,
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

  it("listening ⇒ port + the EXACT fingerprint + copy copies it verbatim; plaintext still open is said", async () => {
    data = OK;
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusListening");
    expect(screen.getByTestId("mqtt-broker-tls-fingerprint").textContent).toBe(FP);
    expect(screen.getByTestId("mqtt-broker-tls-plain")).toHaveTextContent("mqtt.clientMgmt.brokerTls.plainOpen");
    fireEvent.click(screen.getByRole("button", { name: "common.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FP));
  });

  it("a certificate fault ⇒ an error badge with the reason, and NO fingerprint to copy", () => {
    data = { ...OK, listening: false, port: null, fingerprintSha256: null, source: null, notAfter: null, error: "TLS_FILE_CORRUPT" };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusError");
    expect(screen.queryByTestId("mqtt-broker-tls-fingerprint")).toBeNull();
    expect(screen.queryByRole("button", { name: "common.copy" })).toBeNull();
  });

  it("port taken ⇒ error badge (the fingerprint is still shown: the certificate itself is fine)", () => {
    data = { ...OK, listening: false, port: null, error: "EADDRINUSE" };
    render(<MqttBrokerTlsCard enabled />);
    expect(screen.getByTestId("mqtt-broker-tls-status")).toHaveTextContent("mqtt.clientMgmt.brokerTls.statusError");
    expect(screen.getByTestId("mqtt-broker-tls-fingerprint").textContent).toBe(FP);
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
