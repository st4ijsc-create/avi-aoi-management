/**
 * doc 81 Đợt 10 task D fix review 6 (NF5-8, R-10-bb) — `robot.consoleStop` is sent ALONE (httpLink), never batched with another
 * call: the server's bounded STOP-only auth applies only to a request made of the STOP route alone (isStopOnlyCall); in a mixed
 * batch the STOP would wait behind the normal, unbounded authentication. Real client + the app's real links, a recording fetch.
 */
import { describe, it, expect } from "vitest";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { createAppTrpcLinks, isStopOnlyOp } from "./trpcLinks";

function client() {
  const urls: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const batched = new URL(url, "http://x").searchParams.get("batch") === "1";
    const pathPart = new URL(url, "http://x").pathname.replace(/^\/api\/trpc\//, "");
    const one = { result: { data: superjson.serialize({ ok: true }) } };
    const body = batched ? Array.from({ length: decodeURIComponent(pathPart).split(",").length }, () => one) : one;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = createTRPCClient<any>({ links: createAppTrpcLinks({ url: "http://x/api/trpc", fetch: fakeFetch as typeof fetch }) as any }) as any;
  return { c, urls };
}

describe("NF5-8 — the console STOP is never batched", () => {
  it("isStopOnlyOp names exactly robot.consoleStop", () => {
    expect(isStopOnlyOp({ path: "robot.consoleStop" })).toBe(true);
    expect(isStopOnlyOp({ path: "robot.actuate" })).toBe(false);
  });

  it("★ consoleStop + another mutation in the SAME tick ⇒ two requests; the STOP's carries only robot.consoleStop, unbatched", async () => {
    const { c, urls } = client();
    await Promise.all([c.robot.consoleStop.mutate({ robotId: 1, command: "stop" }), c.user.updateProfile.mutate({ name: "x" }), c.robot.actuate.mutate({ robotId: 1, command: "home" })]);
    const stop = urls.filter((u) => u.includes("robot.consoleStop"));
    expect(stop).toHaveLength(1);
    const path = decodeURIComponent(new URL(stop[0], "http://x").pathname);
    expect(path).toBe("/api/trpc/robot.consoleStop");
    expect(new URL(stop[0], "http://x").searchParams.get("batch")).toBeNull();
    expect(urls.length).toBe(2); // the two other mutations still batch together
  });
});
