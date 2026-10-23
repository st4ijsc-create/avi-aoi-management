import fs from "node:fs";
let h = fs.readFileSync("webview.raw.html", "utf8");
h = h.replace(/<meta[^>]*Content-Security-Policy[^>]*>/i, "");
const theme = `<style>:root{
--vscode-font-family:"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Consolas,monospace;
--vscode-foreground:#cccccc;--vscode-editor-background:#1e1e1e;--vscode-sideBar-background:#252526;--vscode-editor-foreground:#d4d4d4;
--vscode-input-background:#3c3c3c;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;
--vscode-button-background:#0e639c;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#1177bb;
--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;
--vscode-textCodeBlock-background:#0a0a0a;--vscode-textBlockQuote-background:#7f7f7f1a;--vscode-textBlockQuote-border:#007acc80;
--vscode-panel-border:#80808059;--vscode-descriptionForeground:#9d9d9d;--vscode-errorForeground:#f48771;
--vscode-focusBorder:#007fd4;--vscode-textLink-foreground:#3794ff;--vscode-list-hoverBackground:#2a2d2e;
--vscode-dropdown-background:#3c3c3c;--vscode-dropdown-foreground:#f0f0f0;--vscode-dropdown-border:#3c3c3c;
--vscode-badge-background:#4d4d4d;--vscode-badge-foreground:#fff;--vscode-widget-border:#454545;
}body{background:#1e1e1e;color:#ccc;font-family:var(--vscode-font-family);font-size:13px;margin:0;padding:0;width:420px}
</style>`;
const mock = `<script>
window.__tin = [];
window.acquireVsCodeApi = () => ({ postMessage: (m) => { window.__tin.push(m); }, getState: () => undefined, setState: () => {} });
window.__gui = (m) => window.postMessage(m, "*");
</script>`;
h = h.replace("<head>", "<head>" + theme + mock);
fs.writeFileSync("harness.html", h);
console.log(h.length);
