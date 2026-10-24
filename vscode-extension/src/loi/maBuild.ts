/**
 * ★ 2026-10-24 — MÃ BUILD hiện trong khung chat để người dùng (và kiểm định) biết CHÍNH XÁC bản nào đang chạy — bài học "đã cài ≠ nhìn thấy": bản cài trên máy từng cũ
 * hơn repo nhiều lần mà không ai thấy. `build.mjs` nhúng `phiênbản+commit[-dirty]` lúc đóng gói qua `define`; chạy test/ts-node (không qua build) ⇒ "dev".
 * "-dirty" = cây làm việc của vscode-extension/ còn thay đổi chưa commit lúc build ⇒ bản đó KHÔNG tái lập được từ commit.
 */
declare const __MA_BUILD__: string | undefined;

export const MA_BUILD: string = typeof __MA_BUILD__ === "string" && __MA_BUILD__.length > 0 ? __MA_BUILD__ : "dev";
