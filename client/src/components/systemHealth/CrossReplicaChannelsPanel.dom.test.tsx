// @vitest-environment jsdom
/**
 * doc 81 Đợt 12 final fix wave (ruling R-12-e M-3) — the System Health panel for `systemHealth.crossReplicaChannels`: the OT STOP
 * epoch sync of this central replica (state — "disabled: no HMAC key" named as such, key source as an env NAME, rejections, peer
 * STOPs, the start hello: verified peers / key mismatches, latency) and the `device_owner_changed` listener (state, reconnects, lost
 * episodes, heartbeat RTT). Admin only (admin_system:canView). Before: the status existed only as an API; no page read it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

const srv = vi.hoisted(() => ({ data: null as unknown, canView: true, queried: 0 }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => undefined },
  Trans: ({ children }: { children?: unknown }) => children,
  useTranslation: () => ({
    t: (k: string, d?: string | Record<string, unknown>, o?: Record<string, unknown>) => {
      const fill = (s: string, p?: Record<string, unknown>) => s.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(p?.[n] ?? ""));
      if (typeof d === "string") return fill(d, o);
      return k;
    },
  }),
}));
vi.mock("@/lib/trpcErrors", () => ({ mapTrpcError: () => "error" }));
vi.mock("@/_core/hooks/usePermissions", () => ({ usePermissions: () => ({ hasPermission: (m: string, a: string) => srv.canView && m === "admin_system" && a === "canView" }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    systemHealth: {
      crossReplicaChannels: {
        useQuery: (_i: unknown, o: { enabled?: boolean }) => {
          if (o?.enabled !== false) srv.queried += 1;
          return { data: srv.data, isLoading: false, isError: false };
        },
      },
    },
  },
}));

import { CrossReplicaChannelsPanel } from "./CrossReplicaChannelsPanel";

const epoch = (o: Record<string, unknown>) => ({
  running: true, state: "ok", origin: "0f6c1d2e-aaaa-bbbb-cccc-111122223333", keySource: "SECRET_ENCRYPTION_KEY", keyProblem: null, disabled: null, keyEpisode: "nothing",
  listen: null, reconnects: 0, peerStops: 4, ignoredOwn: 2, rejected: 3, rejectedBy: { malformed: 1, no_key: 0, bad_mac: 2, stale: 0, replay: 0 },
  peerEvictions: 0, peerMap: { size: 1, max: 100_000, floor: 0 }, replicaEvictions: 0, notifySent: 5, notifyFailed: 0, unsignedNotSent: 0,
  peerLatencyMs: { count: 4, p50: 2, p95: 3, p99: 5, max: 6 },
  hello: { sent: 2, verifiedPeers: 1, mismatches: 0, lastMismatchAt: null, peers: [{ replica: "9a8b7c6d…", lastSeenAt: 1 }] },
  ...o,
});
const owner = { channel: "device_owner_changed", state: "ok", since: 1, reason: null, reconnects: 1, lostEpisodes: 2, lastPingRttMs: 7, pingSendFailures: 0 };

beforeEach(() => {
  srv.canView = true;
  srv.queried = 0;
  srv.data = { otStopEpoch: epoch({}), deviceOwner: owner };
});
afterEach(cleanup);

describe("CrossReplicaChannelsPanel (R-12-e M-3)", () => {
  it("shows both channels: sync state, key source (env name), peer STOPs, rejections by reason, hello peers, latency; the owner listener's reconnects / lost episodes / RTT", () => {
    render(<CrossReplicaChannelsPanel />);
    expect(screen.getByText("Đồng bộ DỪNG OT giữa các bản sao")).toBeInTheDocument();
    expect(screen.getByTestId("xr-epoch-state")).toHaveTextContent("Đang đồng bộ");
    expect(screen.getByText("SECRET_ENCRYPTION_KEY")).toBeInTheDocument();
    expect(screen.getByTestId("xr-peer-stops")).toHaveTextContent("4");
    expect(screen.getByTestId("xr-rejected")).toHaveTextContent("3");
    expect(screen.getByTestId("xr-rejected")).toHaveTextContent("bad_mac 2");
    expect(screen.getByTestId("xr-hello")).toHaveTextContent("1");
    expect(screen.getByTestId("xr-latency")).toHaveTextContent("5 ms");
    expect(screen.getByTestId("xr-owner-state")).toHaveTextContent("Đang nghe");
    expect(screen.getByTestId("xr-owner-reconnects")).toHaveTextContent("1");
    expect(screen.getByTestId("xr-owner-lost")).toHaveTextContent("2");
    expect(screen.getByTestId("xr-owner-rtt")).toHaveTextContent("7 ms");
  });

  it("★ no HMAC key: says 'disabled: no HMAC key' and names the env variable to set (never a value)", () => {
    srv.data = { otStopEpoch: epoch({ state: "disabled", disabled: "no_hmac_key", keySource: null, keyProblem: "neither OT_STOP_EPOCH_HMAC_KEY nor SECRET_ENCRYPTION_KEY is set" }), deviceOwner: owner };
    render(<CrossReplicaChannelsPanel />);
    expect(screen.getByTestId("xr-epoch-state")).toHaveTextContent("Tắt: chưa có khoá HMAC");
    expect(screen.getByTestId("xr-disabled-hint")).toHaveTextContent("OT_STOP_EPOCH_HMAC_KEY");
  });

  it("a key mismatch seen in the start hello is shown as an error; a degraded listener as a warning; a listener not started says so", () => {
    srv.data = { otStopEpoch: epoch({ state: "degraded", hello: { sent: 1, verifiedPeers: 0, mismatches: 3, lastMismatchAt: 5, peers: [] } }), deviceOwner: null };
    render(<CrossReplicaChannelsPanel />);
    expect(screen.getByTestId("xr-epoch-state")).toHaveTextContent("Suy giảm");
    expect(screen.getByTestId("xr-key-mismatch")).toHaveTextContent("3");
    expect(screen.getByTestId("xr-owner-state")).toHaveTextContent("Chưa chạy");
  });

  it("hidden (and not queried) without admin_system:canView", () => {
    srv.canView = false;
    const { container } = render(<CrossReplicaChannelsPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(srv.queried).toBe(0);
  });
});
