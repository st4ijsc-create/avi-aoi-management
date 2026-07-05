# Server PDF fonts

Vietnamese-capable fonts embedded into server-rendered PDFs (jsPDF via
`universalExportService`, PDFKit via `pdfTemplateService`). Without an embedded
font that covers the **Latin Extended Additional** block, the PDF cores
(Helvetica/WinAnsi) drop Vietnamese diacritics (ế ấ ộ ữ đ …) → mojibake. This
was the #1 P0 trust issue in doc 32.

## Font

**Be Vietnam Pro** — SIL Open Font License 1.1 (see `OFL.txt`). Drawn by a
Vietnamese type foundry with complete VN coverage. Regular + Bold weights.

| File | Weight | Used by |
|---|---|---|
| `BeVietnamPro-Regular.ttf` | 400 | jsPDF body + PDFKit default |
| `BeVietnamPro-Bold.ttf` | 700 | table headers / bold runs |

Loaded by `server/services/fontAssets.ts` (`registerVietnameseFontJsPDF`,
`registerVietnameseFontPdfKit`). That loader **fails loudly** if the .ttf files
are absent — it will not silently fall back to a font that mojibakes.

## If the fonts are missing

```
node scripts/fetch-fonts.mjs
```

Downloads Regular + Bold + license from
`github.com/google/fonts/ofl/bevietnampro` (OFL 1.1) and validates the TrueType
signature. Idempotent.

## Production builds

The esbuild bundle (`npm run build`) does not copy `server/assets/**`. Deployments
must ship this directory alongside the bundle, or point `FONT_ASSETS_DIR` at it.
