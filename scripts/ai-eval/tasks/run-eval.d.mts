// Khai kiểu cho `run-eval.mjs`, CHỈ phần tệp .ts đang dùng (PHATLAI-ENV-KHONG-LOC 20/11: phat-lai/locMoiTruong.ts, fixtureKhongBiMat.test.ts); thiếu tệp này tsc báo TS7016
// (tiền lệ `scripts/_lib/nguonBiMat.d.mts`). Chữ ký theo run-eval.mjs:317 — đổi chữ ký locCo ở đó thì sửa CÙNG ở đây. `co` = cờ qua hai lớp; `boQua` = CHỈ TÊN.
export declare function locCo(env?: Readonly<Record<string, string | undefined>>, tuyChon?: { tepCongCu?: string }): { co: Record<string, string>; boQua: string[] };
