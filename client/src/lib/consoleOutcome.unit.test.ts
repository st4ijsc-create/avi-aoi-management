/**
 * doc 81 Đợt 10 final fix wave — I-3 (ruling R-10-br), the console's reading of a STOP answer: a STOP queued for an edge node is
 * NOT a green "accepted" — `queued_on_edge` is PENDING (the edge confirms later), `queued_edge_unreachable` is a WARNING (the
 * node cannot be reached; central's fallback was attempted, an alert was raised). Everything else is unchanged.
 */
import { describe, expect, it } from "vitest";
import { consoleOutcomeTone } from "./consoleOutcome";

describe("consoleOutcomeTone", () => {
  it("★ queued for an edge ⇒ pending; edge unreachable ⇒ warning — never success", () => {
    expect(consoleOutcomeTone({ ok: true, status: "queued_on_edge" })).toBe("pending");
    expect(consoleOutcomeTone({ ok: true, status: "queued_edge_unreachable" })).toBe("warning");
  });
  it("unchanged: simulated / ok / refused", () => {
    expect(consoleOutcomeTone({ ok: true, status: "simulated" })).toBe("simulated");
    expect(consoleOutcomeTone({ ok: false, status: "simulated" })).toBe("simulated");
    expect(consoleOutcomeTone({ ok: true, status: "done" })).toBe("success");
    expect(consoleOutcomeTone({ ok: true, status: "stop_in_progress" })).toBe("success");
    expect(consoleOutcomeTone({ ok: false, status: "rejected" })).toBe("error");
  });
});
