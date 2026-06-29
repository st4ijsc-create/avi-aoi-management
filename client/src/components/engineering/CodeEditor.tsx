/**
 * Doc 09 / Phase D1 — Device Programming & Control: a lightweight CODE EDITOR.
 *
 * A self-contained, dependency-free editor (monospace textarea + synced line-number
 * gutter + Tab-to-indent) for authoring device programs (Zmotion BASIC / G-code / ST /
 * robot script). It is intentionally a CLEAN COMPONENT BOUNDARY: the Unified Engineering
 * Workspace consumes <CodeEditor value onChange language /> only, so a richer editor
 * (Monaco / CodeMirror) can be dropped in later WITHOUT touching the page. Keeping D1
 * dependency-free avoids a bundler/offline risk while the workspace is built out.
 */
import { useMemo, useRef } from "react";

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language?: string;
  readOnly?: boolean;
  /** Visual height in CSS units (default 360px). */
  height?: string;
  placeholder?: string;
  "aria-label"?: string;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  height = "360px",
  placeholder,
  ...rest
}: CodeEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  // Keep the gutter scrolled in lock-step with the textarea.
  function syncScroll() {
    if (gutterRef.current && taRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  }

  // Tab inserts two spaces (indent) instead of moving focus.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && !readOnly) {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      // Restore caret after the inserted spaces on the next tick.
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }

  return (
    <div
      className="relative flex overflow-hidden rounded-md border bg-muted/30 font-mono text-sm"
      style={{ height }}
    >
      <div
        ref={gutterRef}
        aria-hidden
        className="select-none overflow-hidden whitespace-pre px-2 py-2 text-right text-muted-foreground/60"
        style={{ minWidth: "3rem", lineHeight: "1.5rem" }}
      >
        {lineNumbers}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        data-language={language}
        className="flex-1 resize-none bg-transparent px-3 py-2 leading-6 outline-none"
        style={{ lineHeight: "1.5rem" }}
        {...rest}
      />
    </div>
  );
}

export default CodeEditor;
