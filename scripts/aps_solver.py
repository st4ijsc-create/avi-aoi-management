#!/usr/bin/env python
"""
APS CP-SAT solver sidecar (G2.5a, Phương án A).

Reads ONE JSON model on stdin, solves a job-shop / flow-shop style schedule with
OR-Tools CP-SAT, and writes ONE JSON result on stdout. It NEVER raises to the OS
(no non-zero exit on a modelling/solver problem) and NEVER touches the network or
the filesystem — the Node side treats any non-OPTIMAL/FEASIBLE result, a crash,
or a timeout as a signal to fall back to the heuristic scheduler.

Input model (all times in integer MINUTES from a common epoch):
{
  "horizonMin": int,
  "weights": { "lateness": int, "makespan": int, "setup": int },
  "maxTimeSec": float,
  "orders": [
    { "id": int, "lineId": int, "productModelId": int|null,
      "releaseMin": int, "dueMin": int|null,
      "dependencies": [orderId, ...],
      "ops": [ { "stationId": int, "orderIndex": int, "durationMin": int } ] }
  ],
  "changeoverMin": int   # gap inserted on a station between ops of different products
}

Output:
{
  "status": "OPTIMAL"|"FEASIBLE"|"INFEASIBLE"|"ERROR",
  "solverMode": "cpsat",
  "items": [ { "productionOrderId", "lineId", "stationId",
               "suggestedStartMin", "suggestedEndMin",
               "productModelId", "setupMinutes", "sequenceIndex" } ],
  "objective": { "makespanMin", "totalTardinessMin", "totalSetupMin" },
  "wallMs": int,
  "message": str (only when status == ERROR)
}
"""
import sys
import json
import time


def _emit(obj):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()


def _error(message):
    _emit({"status": "ERROR", "solverMode": "cpsat", "message": str(message),
           "items": [], "objective": {}, "wallMs": 0})


def main():
    start = time.time()
    try:
        raw = sys.stdin.read()
    except Exception as e:  # pragma: no cover - stdin failure
        _error(f"stdin read failed: {e}")
        return

    try:
        model_in = json.loads(raw) if raw and raw.strip() else {}
    except Exception as e:
        _error(f"invalid JSON model: {e}")
        return

    # Import ortools lazily so a missing dependency degrades gracefully.
    try:
        from ortools.sat.python import cp_model
    except Exception as e:  # ortools not installed
        _error(f"ortools unavailable: {e}")
        return

    try:
        result = _solve(model_in, cp_model)
        result["wallMs"] = int((time.time() - start) * 1000)
        _emit(result)
    except Exception as e:  # any modelling/solver error -> ERROR (Node falls back)
        _error(f"solver error: {e}")


def _solve(model_in, cp_model):
    orders = model_in.get("orders") or []
    horizon = int(model_in.get("horizonMin") or 0)
    weights = model_in.get("weights") or {}
    w_late = int(weights.get("lateness", 1))
    w_make = int(weights.get("makespan", 1))
    w_setup = int(weights.get("setup", 1))
    changeover = int(model_in.get("changeoverMin") or 0)
    max_time = float(model_in.get("maxTimeSec") or 20.0)

    if not orders or horizon <= 0:
        return {"status": "INFEASIBLE", "solverMode": "cpsat", "items": [],
                "objective": {}, "wallMs": 0}

    model = cp_model.CpModel()

    # Per-op CP variables, indexed by (order_id, op_index).
    op_records = []          # flat list of dicts
    intervals_by_station = {}  # stationId -> [interval vars]
    op_end_by_order = {}     # order_id -> end var of its LAST op (precedence chain end)
    op_start_by_order = {}   # order_id -> start var of its FIRST op

    for order in orders:
        oid = int(order["id"])
        line_id = order.get("lineId")
        pmid = order.get("productModelId")
        release = int(order.get("releaseMin") or 0)
        ops = order.get("ops") or []
        # Sort ops by their process orderIndex so precedence is well-defined.
        ops = sorted(ops, key=lambda o: int(o.get("orderIndex") or 0))

        prev_end = None
        first_start = None
        last_end = None
        for op_i, op in enumerate(ops):
            dur = max(0, int(op.get("durationMin") or 0))
            station = op.get("stationId")
            start = model.NewIntVar(release, horizon, f"s_{oid}_{op_i}")
            end = model.NewIntVar(release, horizon, f"e_{oid}_{op_i}")
            interval = model.NewIntervalVar(start, dur, end, f"i_{oid}_{op_i}")

            # Precedence within an order: op k starts after op k-1 ends.
            if prev_end is not None:
                model.Add(start >= prev_end)
            prev_end = end
            if first_start is None:
                first_start = start
            last_end = end

            rec = {
                "orderId": oid, "lineId": line_id, "stationId": station,
                "productModelId": pmid, "start": start, "end": end,
                "interval": interval, "durationMin": dur, "opIndex": op_i,
            }
            op_records.append(rec)
            if station is not None:
                intervals_by_station.setdefault(station, []).append(rec)

        if first_start is not None:
            op_start_by_order[oid] = first_start
        if last_end is not None:
            op_end_by_order[oid] = last_end

    # No-overlap per station (each station processes one op at a time).
    for station, recs in intervals_by_station.items():
        model.AddNoOverlap([r["interval"] for r in recs])

    # Cross-order dependency edges: dependent order starts after dep order ends.
    for order in orders:
        oid = int(order["id"])
        deps = order.get("dependencies") or []
        if oid not in op_start_by_order:
            continue
        for dep in deps:
            dep = int(dep)
            if dep in op_end_by_order:
                model.Add(op_start_by_order[oid] >= op_end_by_order[dep])

    # Changeover: when two ops on the SAME station have DIFFERENT productModelId,
    # enforce a setup gap between them (in either order, via a boolean).
    setup_terms = []
    for station, recs in intervals_by_station.items():
        if changeover <= 0:
            continue
        for a in range(len(recs)):
            for b in range(a + 1, len(recs)):
                ra, rb = recs[a], recs[b]
                if ra["productModelId"] == rb["productModelId"]:
                    continue
                # a before b OR b before a; whichever, insert changeover gap.
                a_before = model.NewBoolVar(f"ab_{station}_{a}_{b}")
                model.Add(rb["start"] >= ra["end"] + changeover).OnlyEnforceIf(a_before)
                model.Add(ra["start"] >= rb["end"] + changeover).OnlyEnforceIf(a_before.Not())
                setup_terms.append(changeover)

    # Makespan = max end over all ops.
    all_ends = [r["end"] for r in op_records]
    makespan = model.NewIntVar(0, horizon, "makespan")
    if all_ends:
        model.AddMaxEquality(makespan, all_ends)

    # Tardiness per order: max(0, lastEnd - due).
    tardiness_terms = []
    for order in orders:
        oid = int(order["id"])
        due = order.get("dueMin")
        if due is None or oid not in op_end_by_order:
            continue
        due = int(due)
        tard = model.NewIntVar(0, horizon, f"tard_{oid}")
        model.Add(tard >= op_end_by_order[oid] - due)
        model.Add(tard >= 0)
        tardiness_terms.append(tard)

    total_tardiness = model.NewIntVar(0, horizon * max(1, len(orders)), "total_tardiness")
    if tardiness_terms:
        model.Add(total_tardiness == sum(tardiness_terms))
    else:
        model.Add(total_tardiness == 0)

    # Objective: weighted sum (setup is a static constant lower-bound contribution).
    model.Minimize(w_late * total_tardiness + w_make * makespan)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max_time
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)

    status_name = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "ERROR",
        cp_model.UNKNOWN: "INFEASIBLE",
    }.get(status, "INFEASIBLE")

    items = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Stable per-station sequence index from solved start times.
        for station, recs in intervals_by_station.items():
            recs_sorted = sorted(recs, key=lambda r: solver.Value(r["start"]))
            for seq, r in enumerate(recs_sorted):
                r["_seq"] = seq
        for r in op_records:
            items.append({
                "productionOrderId": r["orderId"],
                "lineId": r["lineId"],
                "stationId": r["stationId"],
                "productModelId": r["productModelId"],
                "suggestedStartMin": int(solver.Value(r["start"])),
                "suggestedEndMin": int(solver.Value(r["end"])),
                "setupMinutes": changeover if r["opIndex"] > 0 else 0,
                "sequenceIndex": r.get("_seq", r["opIndex"]),
            })

    objective = {}
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        objective = {
            "makespanMin": int(solver.Value(makespan)) if all_ends else 0,
            "totalTardinessMin": int(solver.Value(total_tardiness)),
            "totalSetupMin": int(sum(setup_terms)),
        }

    return {"status": status_name, "solverMode": "cpsat", "items": items,
            "objective": objective, "wallMs": 0}


if __name__ == "__main__":
    main()
