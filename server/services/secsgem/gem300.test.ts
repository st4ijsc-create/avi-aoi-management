/**
 * GEM300 message-stream layer (S2 equipment control + S7 process program/recipe)
 * — unit tests.
 *
 * Covers:
 *   (a) S2F41 host command round-trips (encode→decode→ack) + maps to the gated
 *       HITL path (NO ungated actuation; flag-gated dispatch-input construction),
 *   (b) S7F3 PP-Send stores a recipe + S7F5 PP-Request returns it (round-trip),
 *       plus PP↔recipe binding, S7F1/F2 grant, S7F17/F18 delete, S7F19/F20 dir,
 *   (c) event report define/link/enable (S2F33/F35/F37) round-trip + registry,
 *   (d) equipment-constant request (S2F13/F14) — typed values preserved,
 *   (e) codec round-trip stability (encode∘decode == identity) for EVERY new
 *       message, and the GEM300_ENABLED flag default.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { I, type Secs2Item } from "./secs2Codec";
import type { Secs2Message } from "./s1Messages";
import {
  isGem300Enabled,
  GEM300_CAVEAT,
  encodeBody,
  decodeBody,
  // S2
  s2f41,
  parseS2F41,
  s2f42,
  parseS2F42,
  s2f33,
  parseS2F33,
  s2f34,
  parseS2F34,
  s2f35,
  parseS2F35,
  s2f36,
  s2f37,
  parseS2F37,
  s2f38,
  s2f13,
  parseS2F13,
  s2f14,
  parseS2F14,
  cpText,
  cpU4,
  // S7
  s7f1,
  parseS7F1,
  s7f2,
  parseS7F2,
  s7f3,
  parseS7F3,
  s7f4,
  parseS7F4,
  s7f5,
  s7f6,
  parseS7F6,
  s7f17,
  s7f18,
  s7f19,
  s7f20,
  parseS7F20,
  // codes
  HCACK,
  DRACK,
  LRACK,
  ERACK,
  PPGNT,
  ACKC7,
  // PP ↔ recipe
  ppidForRecipe,
  parsePpid,
  recipeToPpBody,
  ppBodyToRecipe,
  InMemoryPpStore,
  // host command gating
  mapHostCommandToProposal,
  buildHitlDispatchInput,
  Gem300Equipment,
  type RecipeLike,
} from "./gem300";

/** encode∘decode identity for a message body. */
function bodyRoundtrip(msg: Secs2Message): Secs2Item {
  return decodeBody(encodeBody(msg));
}

// ─── (e) codec round-trip stability for EVERY new message ─────────────────────

describe("GEM300 — codec round-trip stability for every S2/S7 message", () => {
  const messages: Array<[string, Secs2Message]> = [
    ["S2F41", s2f41("PP-SELECT", [cpText("PPID", "RCP-7@v3"), cpU4("SLOT", 2)])],
    ["S2F42", s2f42(HCACK.ACK_FINISH_LATER, [{ name: "PPID", cpack: 0 }])],
    ["S2F33", s2f33(1, [{ rptId: 100, vids: [1, 2, 3] }, { rptId: 101, vids: [] }])],
    ["S2F34", s2f34(DRACK.OK)],
    ["S2F35", s2f35(1, [{ ceid: 5000, rptIds: [100, 101] }])],
    ["S2F36", s2f36(LRACK.OK)],
    ["S2F37", s2f37(true, [5000, 5001])],
    ["S2F38", s2f38(ERACK.OK)],
    ["S2F13", s2f13([1, 2, 3])],
    ["S2F14", s2f14([I.U4(42), I.A("SEMI"), I.F8(3.14)])],
    ["S7F1", s7f1("RCP-7@v3", 128)],
    ["S7F2", s7f2(PPGNT.OK)],
    ["S7F3", s7f3("RCP-7@v3", '{"a":1}')],
    ["S7F4", s7f4(ACKC7.ACCEPTED)],
    ["S7F5", s7f5("RCP-7@v3")],
    ["S7F6", s7f6("RCP-7@v3", '{"a":1}')],
    ["S7F17", s7f17(["RCP-7@v3", "RCP-8@v1"])],
    ["S7F18", s7f18(ACKC7.ACCEPTED)],
    ["S7F19", s7f19()],
    ["S7F20", s7f20(["RCP-7@v3", "RCP-8@v1"])],
  ];

  for (const [name, msg] of messages) {
    it(`${name} body encode∘decode == identity`, () => {
      expect(bodyRoundtrip(msg)).toEqual(msg.body);
    });
  }

  it("stream/function/W-bit are correct for a representative request+reply pair", () => {
    const req = s2f41("START");
    expect([req.stream, req.streamFunction, req.wbit]).toEqual([2, 41, true]);
    const rep = s2f42(HCACK.ACK_FINISH_LATER);
    expect([rep.stream, rep.streamFunction, rep.wbit]).toEqual([2, 42, false]);
    const pp = s7f3("X", "y");
    expect([pp.stream, pp.streamFunction, pp.wbit]).toEqual([7, 3, true]);
  });
});

// ─── (a) S2F41 host command round-trip + gated-path mapping (no actuation) ─────

describe("GEM300 — S2F41 host command → gated HITL proposal (no ungated actuation)", () => {
  beforeEach(() => {
    delete process.env.GEM300_ENABLED;
  });
  afterEach(() => {
    delete process.env.GEM300_ENABLED;
  });

  it("S2F41 START round-trips and parses RCMD + params", () => {
    const msg = s2f41("START", [cpU4("SLOT", 1)]);
    const decoded = bodyRoundtrip(msg);
    const parsed = parseS2F41(decoded);
    expect(parsed?.rcmd).toBe("START");
    expect(parsed?.params.map((p) => p.name)).toEqual(["SLOT"]);
  });

  it("maps START to a gated proposal (high-risk, machine_control/canCreate) and acks HCACK=4 (deferred to HITL), never HCACK=0", () => {
    const equip = new Gem300Equipment();
    const { proposal, reply } = equip.handleHostCommand(bodyRoundtrip(s2f41("START")));

    expect(proposal.canonicalCommand).toBe("start");
    expect(proposal.gated).toBe(true);
    expect(proposal.requiresApproval).toBe(true);
    expect(proposal.willActuate).toBe(false);
    expect(proposal.riskLevel).toBe("high");
    expect(proposal.requiredPermission).toBe("machine_control/canCreate");

    const ack = parseS2F42(bodyRoundtrip(reply));
    expect(ack?.hcack).toBe(HCACK.ACK_FINISH_LATER); // 4 = will-perform-later (HITL)
    expect(ack?.hcack).not.toBe(HCACK.PERFORMED); // NEVER "already performed"
  });

  it("with the flag OFF, no actuation-intent dispatch input can even be constructed", () => {
    const proposal = mapHostCommandToProposal("START");
    expect(() =>
      buildHitlDispatchInput(proposal, { adapterId: 1, confirmedBy: 7, requestedBy: 7 }),
    ).toThrowError(/GEM300 is disabled/);
  });

  it("with the flag ON, the built dispatch input uses the HITL trigger (never interlock) and the canonical command/tag", () => {
    process.env.GEM300_ENABLED = "true";
    const proposal = mapHostCommandToProposal("START");
    const input = buildHitlDispatchInput(proposal, {
      adapterId: 5,
      machineId: 42,
      confirmedBy: 7,
      requestedBy: 9,
      actionId: "act-1",
    });
    expect(input.commandType).toBe("start");
    expect(input.triggeredBy.kind).toBe("hitl");
    expect(input.triggeredBy.kind).not.toBe("interlock");
    expect(input.writes).toEqual([{ tagKey: "cmd_start", value: true }]);
    if (input.triggeredBy.kind === "hitl") {
      expect(input.triggeredBy.confirmedBy).toBe(7);
      expect(input.triggeredBy.requestedBy).toBe(9);
      expect(input.triggeredBy.actionId).toBe("act-1");
    }
  });

  it("PP-SELECT extracts the recipe code from the PPID param and dispatches select_recipe", () => {
    process.env.GEM300_ENABLED = "true";
    const equip = new Gem300Equipment();
    const { proposal, reply } = equip.handleHostCommand(
      bodyRoundtrip(s2f41("PP-SELECT", [cpText("PPID", "RCP-7@v3")])),
    );
    expect(proposal.canonicalCommand).toBe("select_recipe");
    expect(proposal.recipeCode).toBe("RCP-7");
    expect(parseS2F42(reply.body)?.hcack).toBe(HCACK.ACK_FINISH_LATER);

    const input = buildHitlDispatchInput(proposal, { adapterId: 1, confirmedBy: 1, requestedBy: 1 });
    expect(input.commandType).toBe("select_recipe");
    expect(input.writes).toEqual([{ tagKey: "recipe_select", value: "RCP-7" }]);
  });

  it("PP-SELECT with a missing PPID param is acked HCACK=3 (parameter invalid)", () => {
    const proposal = mapHostCommandToProposal("PP-SELECT", []);
    expect(proposal.hcack).toBe(HCACK.PARAMETER_INVALID);
    expect(proposal.canonicalCommand).toBe("select_recipe");
  });

  it("an unknown RCMD is acked HCACK=1 and can NEVER be dispatched (even with the flag ON)", () => {
    process.env.GEM300_ENABLED = "true";
    const proposal = mapHostCommandToProposal("SELF_DESTRUCT");
    expect(proposal.canonicalCommand).toBeNull();
    expect(proposal.hcack).toBe(HCACK.NO_SUCH_COMMAND);
    expect(() => buildHitlDispatchInput(proposal, { adapterId: 1, confirmedBy: 1, requestedBy: 1 })).toThrowError(
      /unmapped host command/,
    );
  });

  it("RCMD spelling variants (PP-SELECT / PPSELECT / pp_select) all normalise to select_recipe", () => {
    for (const rcmd of ["PP-SELECT", "PPSELECT", "pp_select"]) {
      expect(mapHostCommandToProposal(rcmd, [cpText("PPID", "R1")]).canonicalCommand).toBe("select_recipe");
    }
  });
});

// ─── (b) S7 PP-Send → PP-Request round-trip + PP↔recipe binding ───────────────

describe("GEM300 — S7 process program transfer bound to a versioned recipe", () => {
  const recipe: RecipeLike = {
    code: "RCP-7",
    name: "Solder profile 7",
    version: 3,
    payload: { temp: 245, dwellMs: 1200, zones: [1, 2, 3] },
    checksum: "abc123",
  };

  it("PPID ↔ recipe code+version binding round-trips", () => {
    const ppid = ppidForRecipe(recipe.code, recipe.version);
    expect(ppid).toBe("RCP-7@v3");
    expect(parsePpid(ppid)).toEqual({ code: "RCP-7", version: 3 });
    expect(parsePpid("RCP-BARE")).toEqual({ code: "RCP-BARE", version: null });
  });

  it("recipe → PP body → recipe preserves the payload", () => {
    const body = recipeToPpBody(recipe);
    const back = ppBodyToRecipe(ppidForRecipe(recipe.code, recipe.version), body);
    expect(back?.code).toBe("RCP-7");
    expect(back?.version).toBe(3);
    expect(back?.payload).toEqual(recipe.payload);
  });

  it("S7F3 PP-Send stores the recipe and S7F5 PP-Request returns the identical body", async () => {
    const equip = new Gem300Equipment({ ppStore: new InMemoryPpStore() });
    const ppid = ppidForRecipe(recipe.code, recipe.version);
    const body = recipeToPpBody(recipe);

    // Host → Equipment: S7F1 inquire, then S7F3 send.
    const grant = parseS7F2((await equip.ppLoadInquire(s7f1(ppid, body.length).body)).body);
    expect(grant).toBe(PPGNT.OK);

    const sendAck = parseS7F4((await equip.ppSend(bodyRoundtrip(s7f3(ppid, body)))).body);
    expect(sendAck).toBe(ACKC7.ACCEPTED);

    // Host → Equipment: S7F5 request → S7F6 data.
    const reply = await equip.ppRequest(bodyRoundtrip(s7f5(ppid)));
    const data = parseS7F6(bodyRoundtrip(reply));
    expect(data?.ppid).toBe(ppid);
    expect(data?.body).toBe(body);

    // And the returned PP parses back into the SAME recipe payload.
    const roundTripped = ppBodyToRecipe(data!.ppid, data!.body);
    expect(roundTripped?.payload).toEqual(recipe.payload);
  });

  it("PP-Request for an absent PP returns an EMPTY body (no throw)", async () => {
    const equip = new Gem300Equipment();
    const data = parseS7F6((await equip.ppRequest(s7f5("MISSING").body)).body);
    expect(data?.ppid).toBe("MISSING");
    expect(data?.body).toBe("");
  });

  it("loadRecipeAsPp / readPpAsRecipe convenience round-trip", async () => {
    const equip = new Gem300Equipment();
    const ppid = await equip.loadRecipeAsPp(recipe);
    expect(ppid).toBe("RCP-7@v3");
    const back = await equip.readPpAsRecipe(ppid);
    expect(back?.payload).toEqual(recipe.payload);
  });

  it("S7F19/F20 directory lists stored PPs; S7F17/F18 deletes them", async () => {
    const equip = new Gem300Equipment();
    await equip.loadRecipeAsPp(recipe);
    await equip.loadRecipeAsPp({ ...recipe, code: "RCP-8", version: 1, payload: { x: 1 } });

    const dir = parseS7F20((await equip.processProgramDirectory()).body);
    expect(dir.sort()).toEqual(["RCP-7@v3", "RCP-8@v1"]);

    const delAck = parseS7F4((await equip.deleteProcessPrograms(s7f17(["RCP-7@v3"]).body)).body);
    expect(delAck).toBe(ACKC7.ACCEPTED);

    const dir2 = parseS7F20((await equip.processProgramDirectory()).body);
    expect(dir2).toEqual(["RCP-8@v1"]);

    // Deleting an absent PP → PPID_NOT_FOUND.
    const delMiss = parseS7F4((await equip.deleteProcessPrograms(s7f17(["NOPE"]).body)).body);
    expect(delMiss).toBe(ACKC7.PPID_NOT_FOUND);
  });

  it("S7F1 with an empty PPID is refused (PPGNT invalid)", async () => {
    const equip = new Gem300Equipment();
    const grant = parseS7F2((await equip.ppLoadInquire(s7f1("", 0).body)).body);
    expect(grant).toBe(PPGNT.INVALID_PPID);
  });
});

// ─── (c) event report define/link/enable (S2F33/F35/F37) round-trip ───────────

describe("GEM300 — dynamic event report define/link/enable (S2F33/F35/F37)", () => {
  it("S2F33 define, S2F35 link, S2F37 enable/disable update the registries", () => {
    const equip = new Gem300Equipment();

    // Define two reports.
    const drack = parseS2F34(equip.defineReports(s2f33(1, [{ rptId: 100, vids: [11, 12] }, { rptId: 101, vids: [13] }]).body).body);
    expect(drack).toBe(DRACK.OK);
    expect(equip.reports.get(100)).toEqual([11, 12]);
    expect(equip.reports.get(101)).toEqual([13]);

    // Link a CEID to both reports.
    const lrack = equip.linkEventReports(s2f35(1, [{ ceid: 5000, rptIds: [100, 101] }]).body).body;
    expect(parseS2F34(lrack)).toBe(LRACK.OK); // (same single-B parser shape)
    expect(equip.links.get(5000)).toEqual([100, 101]);

    // Enable the event, then disable it.
    equip.enableEventReports(s2f37(true, [5000]).body);
    expect(equip.isEventEnabled(5000)).toBe(true);
    equip.enableEventReports(s2f37(false, [5000]).body);
    expect(equip.isEventEnabled(5000)).toBe(false);
  });

  it("linking a CEID to an undefined report is rejected (LRACK 5)", () => {
    const equip = new Gem300Equipment();
    equip.defineReports(s2f33(1, [{ rptId: 100, vids: [1] }]).body);
    const lrack = parseS2F34(equip.linkEventReports(s2f35(1, [{ ceid: 9, rptIds: [999] }]).body).body);
    expect(lrack).toBe(LRACK.DENIED_RPTID_DOES_NOT_EXIST);
  });

  it("deleting a report (empty VID list) removes it and unlinks it", () => {
    const equip = new Gem300Equipment();
    equip.defineReports(s2f33(1, [{ rptId: 100, vids: [1] }]).body);
    equip.linkEventReports(s2f35(1, [{ ceid: 5000, rptIds: [100] }]).body);
    expect(equip.links.get(5000)).toEqual([100]);

    equip.defineReports(s2f33(1, [{ rptId: 100, vids: [] }]).body); // delete report 100
    expect(equip.reports.has(100)).toBe(false);
    expect(equip.links.has(5000)).toBe(false); // link removed (was its only report)
  });

  it("enable with an empty CEID list enables ALL linked events", () => {
    const equip = new Gem300Equipment();
    equip.defineReports(s2f33(1, [{ rptId: 1, vids: [1] }]).body);
    equip.linkEventReports(s2f35(1, [{ ceid: 10, rptIds: [1] }, { ceid: 20, rptIds: [1] }]).body);
    equip.enableEventReports(s2f37(true, []).body);
    expect(equip.isEventEnabled(10)).toBe(true);
    expect(equip.isEventEnabled(20)).toBe(true);
  });

  it("S2F33/F35/F37 bodies parse back to their inputs", () => {
    expect(parseS2F33(s2f33(7, [{ rptId: 1, vids: [2, 3] }]).body)).toEqual({
      dataId: 7,
      reports: [{ rptId: 1, vids: [2, 3] }],
    });
    expect(parseS2F35(s2f35(7, [{ ceid: 8, rptIds: [1, 2] }]).body)).toEqual({
      dataId: 7,
      links: [{ ceid: 8, rptIds: [1, 2] }],
    });
    expect(parseS2F37(s2f37(true, [8, 9]).body)).toEqual({ enable: true, ceids: [8, 9] });
  });
});

// ─── (d) equipment-constant request (S2F13/F14) ───────────────────────────────

describe("GEM300 — equipment constant request (S2F13/F14)", () => {
  function equip(): Gem300Equipment {
    return new Gem300Equipment({
      equipmentConstants: [
        { ecid: 1, value: I.U4(42) },
        { ecid: 2, value: I.A("SEMI") },
        { ecid: 3, value: I.F8(3.14) },
      ],
    });
  }

  it("S2F13 request returns S2F14 with the typed values in request order", () => {
    const reply = equip().requestEquipmentConstants(s2f13([2, 1]).body);
    const values = parseS2F14(decodeBody(encodeBody(reply)));
    expect(values[0]).toEqual({ format: "A", value: "SEMI" });
    expect(values[1]).toEqual({ format: "U4", value: [42] });
  });

  it("an empty S2F13 request returns ALL constants (ascending ECID order)", () => {
    const values = parseS2F14(equip().requestEquipmentConstants(s2f13([]).body).body);
    expect(values).toEqual([
      { format: "U4", value: [42] },
      { format: "A", value: "SEMI" },
      { format: "F8", value: [3.14] },
    ]);
  });

  it("an unknown ECID yields a zero-length list item (SEMI convention)", () => {
    const values = parseS2F14(equip().requestEquipmentConstants(s2f13([99]).body).body);
    expect(values[0]).toEqual({ format: "L", value: [] });
  });

  it("S2F13 request body parses back to the requested ECIDs", () => {
    expect(parseS2F13(s2f13([1, 2, 3]).body)).toEqual([1, 2, 3]);
  });
});

// ─── flag ─────────────────────────────────────────────────────────────────────

describe("GEM300 — flag", () => {
  beforeEach(() => {
    delete process.env.GEM300_ENABLED;
  });
  afterEach(() => {
    delete process.env.GEM300_ENABLED;
  });

  it("GEM300_ENABLED defaults OFF and reads the env var", () => {
    expect(isGem300Enabled()).toBe(false);
    process.env.GEM300_ENABLED = "true";
    expect(isGem300Enabled()).toBe(true);
  });

  it("carries an honest scope caveat", () => {
    expect(GEM300_CAVEAT).toMatch(/NOT a certified/);
  });
});
