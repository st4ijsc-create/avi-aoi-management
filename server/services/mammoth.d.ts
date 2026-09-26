/**
 * doc69 Giai đoạn 5 / Wave E3 (E3-1) — ambient types for `mammoth` (docx → text/html).
 *
 * The published package ships NO .d.ts and there is no `@types/mammoth` on the registry
 * (checked: `npm view @types/mammoth versions` → 404). Without this declaration
 * `tsc --noEmit` fails with TS7016 on `import("mammoth")` in kbDocParser.ts. We type ONLY
 * the surface we use — `extractRawText({buffer})` → `{value, messages}` — verified against
 * the installed package's runtime behaviour (kbDocParser.test.ts mocks this same shape).
 */
declare module "mammoth" {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface MammothRawTextResult {
    value: string;
    messages: MammothMessage[];
  }
  export interface MammothInput {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }
  export function extractRawText(input: MammothInput): Promise<MammothRawTextResult>;
}
