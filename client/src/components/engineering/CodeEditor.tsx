/**
 * Doc 09 / Phase D1 — Device Programming & Control: a CODE EDITOR.
 * Doc 40 / ENG-F5 — nâng cấp từ textarea thô sang CodeMirror 6 (@uiw/react-codemirror).
 *
 * BIÊN GIỚI COMPONENT KHÔNG ĐỔI: các trang tiêu thụ vẫn dùng
 *   <CodeEditor value onChange language readOnly height placeholder aria-label />
 * (EngineeringWorkspace / IrEditor / ProgrammingCopilotPanel), nên bản nâng cấp
 * này KHÔNG chạm caller. CodeMirror cung cấp: số dòng, khớp ngoặc, tô dòng hiện
 * hành, thụt lề, tô cú pháp theo `language`, chủ đề sáng/tối theo app, và (tuỳ chọn)
 * chẩn đoán inline khi caller truyền `diagnostics`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactCodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { trpc } from "@/lib/trpc";
import { inlineCopilotExtension } from "./inlineCopilotExtension";

/** Chẩn đoán tĩnh (tuỳ chọn) — map lỗi validate → gạch dòng trong editor. */
export interface CodeDiagnostic {
  /** Số dòng 1-based (khớp thông báo lỗi của validator/adapter). */
  line: number;
  /** Cột 1-based (tuỳ chọn); mặc định gạch cả dòng. */
  column?: number;
  message: string;
  severity?: "error" | "warning" | "info";
}

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language?: string;
  readOnly?: boolean;
  /** Visual height in CSS units (default 360px). */
  height?: string;
  /** Giới hạn chiều cao tối đa (cuộn bên trong) — tuỳ chọn. */
  maxHeight?: string;
  placeholder?: string;
  /** Hook chẩn đoán inline; nếu caller chưa truyền thì bỏ qua (không bắt buộc). */
  diagnostics?: CodeDiagnostic[];
  /** Mất focus (tuỳ chọn) — giữ tương thích nếu caller cần lưu on-blur. */
  onBlur?: () => void;
  "aria-label"?: string;
  /**
   * Doc 69 · Wave 4 / C1 — bật gợi ý inline kiểu ghost-text (debounce → programming.copilotComplete
   * → Tab để chèn, Esc để bỏ). OPT-IN, mặc định false: KHÔNG bật tự động cho mọi consumer của
   * CodeEditor — chỉ mặt soạn thảo chính của Programming Copilot mới truyền cờ này. Khi cờ server
   * `AI_PROGRAMMING_COPILOT_ENABLED` tắt hoặc model FIM vắng mặt, endpoint trả `completion:""` nên
   * editor xử sự y hệt hôm nay (không có ghost text).
   */
  inlineCopilot?: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * StreamLanguage tối giản cho các ngôn ngữ tự động hoá không có mode chuẩn.
 * Trả về TÊN token cổ điển ("keyword"/"comment"/"number"/…) mà StreamLanguage
 * ánh xạ sang tag tô sáng của CodeMirror.
 * ──────────────────────────────────────────────────────────────────────────── */

type St = { inComment: boolean };

function words(list: string): Set<string> {
  return new Set(list.trim().split(/\s+/).map((w) => w.toUpperCase()));
}

/** IEC 61131-3 Structured Text (ST) + biến thể device (Mitsubishi engineering). */
const ST_KEYWORDS = words(`
  IF THEN ELSIF ELSE END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE
  REPEAT UNTIL END_REPEAT RETURN EXIT CONTINUE
  FUNCTION END_FUNCTION FUNCTION_BLOCK END_FUNCTION_BLOCK PROGRAM END_PROGRAM
  VAR VAR_INPUT VAR_OUTPUT VAR_IN_OUT VAR_GLOBAL VAR_TEMP VAR_EXTERNAL CONSTANT
  RETAIN NON_RETAIN END_VAR TYPE END_TYPE STRUCT END_STRUCT ARRAY AT WITH
  AND OR XOR NOT MOD
`);
const ST_TYPES = words(`
  BOOL BYTE WORD DWORD LWORD SINT INT DINT LINT USINT UINT UDINT ULINT
  REAL LREAL TIME DATE STRING WSTRING TOD DT POINTER REF_TO ANY
`);
const ST_ATOMS = words(`TRUE FALSE NULL T# D# TOD# DT#`);

const stParser: StreamParser<St> = {
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo("*)")) { stream.match("*)"); state.inComment = false; }
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.match("(*")) { state.inComment = true; return "comment"; }
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/^\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^:=|^<=|^>=|^<>|^[-+*/<>=&]/)) return "operator";
    const w = stream.match(/^[A-Za-z_][\w#]*/) as RegExpMatchArray | null;
    if (w) {
      const up = w[0].toUpperCase();
      if (ST_KEYWORDS.has(up)) return "keyword";
      if (ST_TYPES.has(up)) return "type";
      if (ST_ATOMS.has(up)) return "atom";
      return "variable";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "//", block: { open: "(*", close: "*)" } } },
};

/** Zmotion / generic BASIC. */
const BASIC_KEYWORDS = words(`
  IF THEN ELSE ELSEIF ENDIF END WHILE WEND FOR TO STEP NEXT DO LOOP UNTIL
  GOTO GOSUB RETURN CALL SUB FUNCTION DIM GLOBAL LOCAL AS LET PRINT INPUT
  AND OR NOT XOR MOD REM STOP RUN WAIT DELAY ON OFF
`);
const BASIC_BUILTINS = words(`
  BASE AXIS MOVE MOVEABS MOVECIRC RAPIDSTOP CANCEL DPOS MPOS SPEED ACCEL DECEL
  UNITS VR TABLE IN OP AIN DAC PWM WA CONNECT DATUM DEFPOS
`);

const basicParser: StreamParser<St> = {
  startState: () => ({ inComment: false }),
  token(stream) {
    if (stream.match("'")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^rem\b/i)) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d[\d_]*(?:\.[\d_]+)?/)) return "number";
    if (stream.match(/^<=|^>=|^<>|^[-+*/<>=]/)) return "operator";
    const w = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;
    if (w) {
      const up = w[0].toUpperCase();
      if (BASIC_KEYWORDS.has(up)) return "keyword";
      if (BASIC_BUILTINS.has(up)) return "builtin";
      return "variable";
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "'" } },
};

/** G-code (CNC / dispense / mounter path). */
const gcodeParser: StreamParser<St> = {
  startState: () => ({ inComment: false }),
  token(stream) {
    if (stream.match(/^\((?:[^)]*)\)?/)) return "comment"; // ( comment )
    if (stream.match(/^;.*/)) return "comment";
    if (stream.match(/^[GM]\d+(?:\.\d+)?/i)) return "keyword"; // G0/G1/M3…
    if (stream.match(/^[NXYZABCUVWIJKRFSPTHLQE][-+]?\d*(?:\.\d+)?/i)) return "variable"; // toạ độ/tham số
    if (stream.match(/^[-+]?\d*(?:\.\d+)?/) && stream.current().length) return "number";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: ";" } },
};

/** Ánh xạ token `language` (mirror KIND_LANGUAGE của caller) → extension CM. */
function languageExtension(language?: string): Extension | null {
  switch ((language ?? "").toLowerCase()) {
    case "st":
    case "iec":
    case "iec61131-st":
    case "device": // Mitsubishi engineering device-list ≈ ST tokens
      return StreamLanguage.define(stParser);
    case "basic":
    case "zmotion-basic":
    case "tmscript": // robot TM script cú pháp BASIC-ish → gần đúng
      return StreamLanguage.define(basicParser);
    case "gcode":
    case "g-code":
      return StreamLanguage.define(gcodeParser);
    default:
      return null; // plain text + số dòng vẫn là nâng cấp lớn so với textarea
  }
}

/** Đọc chủ đề app (ThemeProvider gắn class `dark`/`light` lên <html>), phản ứng
 *  theo toggle; fallback prefers-color-scheme khi chưa có class. */
function useAppTheme(): "light" | "dark" {
  const read = (): "light" | "dark" => {
    if (typeof document !== "undefined") {
      const cl = document.documentElement.classList;
      if (cl.contains("dark")) return "dark";
      if (cl.contains("light")) return "light";
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  };
  const [theme, setTheme] = useState<"light" | "dark">(read);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMq = () => setTheme(read());
    mq?.addEventListener?.("change", onMq);
    return () => {
      obs.disconnect();
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);
  return theme;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  height = "360px",
  maxHeight,
  placeholder,
  diagnostics,
  onBlur,
  "aria-label": ariaLabel,
  inlineCopilot = false,
  ...rest
}: CodeEditorProps) {
  const theme = useAppTheme();

  // doc69 C1 — the trpc mutation object's identity/state churns on every request (isPending
  // flips true/false etc.); routing calls through a ref (instead of depending on it directly)
  // keeps `extensions` below stable across keystrokes so the CodeMirror extension array — and
  // the InlineCopilotController instance living inside it — is NOT torn down/recreated mid-type.
  const copilotComplete = trpc.programming.copilotComplete.useMutation();
  const copilotCompleteRef = useRef(copilotComplete.mutateAsync);
  useEffect(() => {
    copilotCompleteRef.current = copilotComplete.mutateAsync;
  }, [copilotComplete.mutateAsync]);

  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [EditorView.lineWrapping];
    const lang = languageExtension(language);
    if (lang) ext.push(lang);
    // QA W5b (a11y): aria-label phải nằm trên BỀ MẶT soạn thảo (contenteditable của
    // CodeMirror), không phải div bọc — giữ tên khả truy cập như bản textarea cũ.
    if (ariaLabel) ext.push(EditorView.contentAttributes.of({ "aria-label": ariaLabel }));
    if (onBlur) ext.push(EditorView.domEventHandlers({ blur: () => { onBlur(); return false; } }));
    if (inlineCopilot) {
      ext.push(
        inlineCopilotExtension({
          fetchCompletion: (win) =>
            copilotCompleteRef
              .current({ prefix: win.prefix, suffix: win.suffix, language })
              .then((r) => r?.completion ?? "")
              .catch(() => ""),
        }),
      );
    }
    if (diagnostics && diagnostics.length > 0) {
      ext.push(
        linter((view): CmDiagnostic[] => {
          const doc = view.state.doc;
          const out: CmDiagnostic[] = [];
          for (const d of diagnostics) {
            const ln = Math.min(Math.max(1, Math.floor(d.line || 1)), doc.lines);
            const line = doc.line(ln);
            const from = d.column && d.column > 0
              ? Math.min(line.from + d.column - 1, line.to)
              : line.from;
            out.push({
              from,
              to: line.to,
              severity: d.severity ?? "error",
              message: d.message,
            });
          }
          return out;
        }, { delay: 150 }),
      );
    }
    return ext;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- copilotCompleteRef is a stable ref
    // (see comment above); intentionally excluded so `extensions` isn't rebuilt on every request.
  }, [language, diagnostics, onBlur, ariaLabel, inlineCopilot]);

  return (
    <div
      className="overflow-hidden rounded-md border bg-muted/30 text-sm"
      data-language={language}
      {...rest}
    >
      <ReactCodeMirror
        value={value}
        onChange={(next) => onChange(next)}
        readOnly={readOnly}
        editable={!readOnly}
        height={height}
        maxHeight={maxHeight}
        placeholder={placeholder}
        theme={theme}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          closeBrackets: !readOnly,
          foldGutter: false,
          indentOnInput: true,
        }}
      />
    </div>
  );
}

export default CodeEditor;
