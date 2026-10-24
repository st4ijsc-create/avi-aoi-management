import { dungHtmlBang } from "D:/SOURCES/_ai9_qa/vscode-extension/src/ui/htmlBang";
import { phanTichMarkdown } from "D:/SOURCES/_ai9_qa/vscode-extension/src/loi/markdownAnToan";
import fs from "node:fs";
const out = process.argv[2];
fs.writeFileSync(out + "/webview.raw.html", dungHtmlBang({ nonce: "NONCE", daDangNhap: true }));
const md = fs.readFileSync(out + "/mau.md", "utf8");
fs.writeFileSync(out + "/mau.cay.json", JSON.stringify(phanTichMarkdown(md)));
