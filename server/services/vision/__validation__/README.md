# Vision validation corpus (doc 27 · V17 · Đợt 7.6)

`server/services/vision/validationHarness.ts` runs a labeled corpus through the
REAL estimators (`imageRegistration.registerToReference`, `aiSpi3d.computeBoardSpi`)
and reports **accuracy** (bias / RMS / max error vs ground truth) and
**Gage R&R** (repeatability & reproducibility) per the AIAG **average-and-range**
method (`computeGageRR` — K1/K2/K3 constants documented in the module header).

## Run it

```bash
npm run vision:validate                 # bundled SYNTHETIC study (zero setup)
npm run vision:validate -- path/to/corpus.json   # your REAL corpus manifest
```

Reports (JSON + Markdown) are written to `validation-reports/` (gitignored).

## What ships today — and its honest limits

The bundled study is **synthetic**: deterministic generated scenes with
per-trial capture-noise emulation (the algorithms are deterministic, so
trial-to-trial variation must come from repeated CAPTURES — synthetic noise
stands in for sensor noise / lighting flicker / re-fixturing until you record
real repeats). Every synthetic report is labelled `synthetic: true`. It proves
the math and the harness; it does **not** certify metrology on your boards.

## Dropping in a REAL PCB corpus

Create a folder (anywhere) with a `corpus.json` manifest + the referenced files:

```jsonc
{
  "name": "line3-spi-corpus-2026-07",
  "registration": [
    {
      "id": "board-A-fiducial-1",
      "reference": "img/boardA_ref.png",          // golden capture
      // captures[appraiser][trial] — repeated captures of the SAME part.
      // "appraiser" = capture session/fixture/operator; trials = repeats within it.
      "captures": [
        ["img/boardA_s1_t1.png", "img/boardA_s1_t2.png", "img/boardA_s1_t3.png"],
        ["img/boardA_s2_t1.png", "img/boardA_s2_t2.png", "img/boardA_s2_t3.png"]
      ],
      "truth": { "dx": 3.40, "dy": -2.60 }        // ground-truth offset in px
    }
  ],
  "spi": [
    {
      "id": "pad-R12-1",
      // CSV grids of Z in µm (comma/semicolon/whitespace separated, # comments ok)
      "heightMapsCsv": [
        ["hm/r12_s1_t1.csv", "hm/r12_s1_t2.csv"],
        ["hm/r12_s2_t1.csv", "hm/r12_s2_t2.csv"]
      ],
      "pads": [
        { "padId": "R12.1", "bbox": { "x": 20, "y": 20, "w": 20, "h": 20 }, "nominalHeight": 100 }
      ],
      "calibration": { "umPerPxX": 10, "umPerPxY": 10 },
      "truth": { "volume": 4000000, "meanHeight": 100 }  // µm³ / µm (calibrated)
    }
  ]
}
```

Constraints (from the average-and-range method): **2–10 parts (cases),
1–3 appraisers, 2–5 trials**, rectangular matrix. Ground truth for
registration usually comes from a calibrated stage displacement or fiducial
CAD offsets; for SPI, from a certified reference target or a calibrated
lab SPI measurement of the same deposits.

Then: `npm run vision:validate -- D:/corpus/line3/corpus.json`

## Where the numbers come from

- Registration cases: every capture is registered onto the reference; `dx` is
  the studied measurement (matrix parts×appraisers×trials → Gage R&R), `dx`/`dy`
  errors vs truth → accuracy.
- SPI cases: every height-map runs through `computeBoardSpi`; the FIRST pad's
  `volume` is the studied measurement; truth volume/meanHeight → accuracy.
- `%GRR < 10` good, `10–30` marginal, `> 30` unacceptable; `ndc ≥ 5` = adequate
  resolution (AIAG interpretation).
