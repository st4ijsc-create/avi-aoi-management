import http from "node:http"; import fs from "node:fs";
http.createServer((q, r) => { const f = q.url === "/cay.json" ? "mau.cay.json" : "harness.html"; r.setHeader("Content-Type", f.endsWith("json") ? "application/json" : "text/html; charset=utf-8"); r.end(fs.readFileSync(f)); }).listen(3017, "127.0.0.1");
