/** Color properties that may contain oklch() values unsupported by html2canvas */
const COLOR_PROPS = [
  "color", "background-color", "border-color",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "outline-color", "text-decoration-color", "fill", "stroke",
  "caret-color", "column-rule-color",
] as const;

const OKLCH_RE = /oklch\([^)]+\)/g;

/** Match raw oklch values in CSS variable definitions (e.g., --primary: .55 .14 185 or with alpha: .55 .14 185 / 0.5) */
const RAW_OKLCH_VAR_RE = /--([\w-]+)\s*:\s*([\d.]+\s+[\d.]+\s+[\d.]+(?:\s*\/\s*[\d.]+)?)\s*([;}])/g;

/** Use a hidden probe element to let the browser convert oklch → rgb */
function makeResolver() {
  // Always use the main window's document for color computation
  const probe = window.document.createElement("span");
  probe.style.cssText = "position:fixed;left:-9999px;visibility:hidden;";
  window.document.body.appendChild(probe);
  const resolve = (oklchValue: string): string => {
    probe.style.setProperty("color", oklchValue);
    return window.getComputedStyle(probe).color; // browser returns rgb()/rgba()
  };
  const dispose = () => {
    if (probe.parentNode) {
      probe.parentNode.removeChild(probe);
    }
  };
  return { resolve, dispose };
}

/**
 * Walk all elements AND `<style>` blocks in a (cloned) document and replace
 * every oklch() colour value with its browser-computed rgb() equivalent so
 * html2canvas can parse them.
 *
 * html2canvas has its own CSS parser that reads raw CSS text from `<style>`
 * elements — simply overriding element inline styles is not enough.
 */
export function resolveOklchColors(doc: Document) {
  console.log('[resolveOklchColors] Starting color conversion...');
  const { resolve, dispose } = makeResolver();
  let convertedCount = 0;
  let variableConvertedCount = 0;
  
  try {
    // 1. Replace oklch() AND raw oklch values in CSS variables inside every <style> element
    doc.querySelectorAll("style").forEach((styleEl) => {
      let css = styleEl.textContent || "";
      if (css.includes("oklch") || css.includes(":root") || css.includes(".dark")) {
        const originalCss = css;
        // First replace full oklch() function calls
        css = css.replace(OKLCH_RE, (m) => {
          convertedCount++;
          return resolve(m);
        });
        // Then replace raw oklch values in CSS variable definitions
        css = css.replace(RAW_OKLCH_VAR_RE, (match, varName, oklchValue, terminator) => {
          variableConvertedCount++;
          const rgbValue = resolve(`oklch(${oklchValue})`);
          console.log(`[resolveOklchColors] Variable: --${varName}: oklch(${oklchValue}) → ${rgbValue}`);
          return `--${varName}: ${rgbValue}${terminator}`;
        });
        if (css !== originalCss) {
          styleEl.textContent = css;
        }
      }
    });

    // 2. Replace oklch() and raw oklch values in CSSStyleSheet rules (covers <link> sheets when accessible)
    try {
      for (const sheet of Array.from(doc.styleSheets)) {
        try {
          const rules = sheet.cssRules;
          for (let i = 0; i < rules.length; i++) {
            let ruleText = rules[i].cssText;
            const hasOklch = ruleText.includes("oklch") || /:root|\.dark/.test(ruleText);
            if (hasOklch) {
              // Replace full oklch() function calls
              ruleText = ruleText.replace(OKLCH_RE, (m) => resolve(m));
              // Replace raw oklch values in CSS variable definitions
              ruleText = ruleText.replace(RAW_OKLCH_VAR_RE, (match, varName, oklchValue, terminator) => {
                const rgbValue = resolve(`oklch(${oklchValue})`);
                return `--${varName}: ${rgbValue}${terminator}`;
              });
              sheet.deleteRule(i);
              sheet.insertRule(ruleText, i);
            }
          }
        } catch {
          // CORS-blocked external stylesheet — skip
        }
      }
    } catch {
      // styleSheets not accessible in this context — skip
    }

    // 3. Replace oklch() in inline style attributes only
    // (Do NOT use getComputedStyle on cloned elements as it won't work correctly)
    doc.querySelectorAll("*").forEach((el) => {
      const htmlEl = el as HTMLElement;
      const inlineStyle = htmlEl.getAttribute("style") || "";
      if (inlineStyle.includes("oklch")) {
        const converted = inlineStyle.replace(OKLCH_RE, (m) => {
          convertedCount++;
          return resolve(m);
        });
        htmlEl.setAttribute("style", converted);
      }
    });
    
    console.log(`[resolveOklchColors] Completed: ${convertedCount} oklch() calls + ${variableConvertedCount} CSS variables converted to rgb()`);
  } finally {
    dispose();
  }
}
