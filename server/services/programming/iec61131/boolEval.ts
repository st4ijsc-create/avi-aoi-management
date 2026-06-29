/**
 * Doc 09 / Phase D5 — A safe boolean-expression evaluator for IEC 61131-3 LADDER
 * one-scan simulation. NO eval/Function — a tiny recursive-descent parser over the
 * grammar:  expr := term (OR term)* ; term := factor (AND factor)* ;
 *           factor := NOT factor | '(' expr ')' | IDENT | TRUE | FALSE
 * (XOR is supported at term level too.) Unknown identifiers resolve to `false` and are
 * reported so the caller can warn. Pure + fail-safe.
 */
export interface BoolEvalResult {
  value: boolean;
  unknownSymbols: string[];
}

type Tok = { t: "id" | "op" | "lp" | "rp"; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s*(\(|\)|[A-Za-z_]\w*)/y;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    m = re.exec(src);
    if (!m) {
      // skip an unexpected char
      i++;
      continue;
    }
    const raw = m[1];
    i = re.lastIndex;
    if (raw === "(") toks.push({ t: "lp", v: raw });
    else if (raw === ")") toks.push({ t: "rp", v: raw });
    else {
      const up = raw.toUpperCase();
      if (up === "AND" || up === "OR" || up === "NOT" || up === "XOR") toks.push({ t: "op", v: up });
      else toks.push({ t: "id", v: raw });
    }
  }
  return toks;
}

export function evalBool(src: string, env: Record<string, boolean>): BoolEvalResult {
  const toks = tokenize(src);
  const unknown = new Set<string>();
  let pos = 0;

  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function factor(): boolean {
    const tk = peek();
    if (!tk) throw new Error("Unexpected end of expression");
    if (tk.t === "op" && tk.v === "NOT") {
      next();
      return !factor();
    }
    if (tk.t === "lp") {
      next();
      const v = expr();
      if (!peek() || peek().t !== "rp") throw new Error("Missing ')'");
      next();
      return v;
    }
    if (tk.t === "id") {
      next();
      const up = tk.v.toUpperCase();
      if (up === "TRUE") return true;
      if (up === "FALSE") return false;
      if (tk.v in env) return env[tk.v];
      if (up in env) return env[up];
      unknown.add(tk.v);
      return false;
    }
    throw new Error(`Unexpected token "${tk.v}"`);
  }

  function term(): boolean {
    let v = factor();
    while (peek() && peek().t === "op" && (peek().v === "AND" || peek().v === "XOR")) {
      const op = next().v;
      const rhs = factor();
      v = op === "AND" ? v && rhs : v !== rhs;
    }
    return v;
  }

  function expr(): boolean {
    let v = term();
    while (peek() && peek().t === "op" && peek().v === "OR") {
      next();
      const rhs = term();
      v = v || rhs;
    }
    return v;
  }

  const value = expr();
  if (pos !== toks.length) throw new Error("Trailing tokens in expression");
  return { value, unknownSymbols: [...unknown] };
}
