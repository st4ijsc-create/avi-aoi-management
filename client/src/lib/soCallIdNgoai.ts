/**
 * Đợt 10.4b (L2) — SỔ callId của các lượt Hỏi bằng model NGOÀI, chờ chuyển vào `luuPhien.ngoaiCallIds` (máy chủ XÁC MINH từng id: đúng người + ok + băm khớp một lượt assistant).
 * Thuần (tách khỏi trang 3,8 k dòng để test được HÀNH VI chứ không chỉ văn bản):
 *   • cộng dồn theo thứ tự, khử trùng, giữ tối đa `TRAN_CALL_ID` id MỚI NHẤT (khớp trần ≤ 50 của máy chủ);
 *   • sau lần lưu thành công chỉ loại ĐÚNG các id đã gửi (id thêm vào giữa lúc lưu vẫn còn);
 *   • id của một lượt = `done.ngoaiCallIds`, thiếu thì rơi về `[vet.callId]`, không có gì thì rỗng.
 */
export const TRAN_CALL_ID = 50;

export function congDonCallId(hienCo: readonly number[], moi: readonly number[], tran: number = TRAN_CALL_ID): number[] {
  const kq: number[] = [];
  for (const x of [...hienCo, ...moi]) if (Number.isInteger(x) && x > 0 && !kq.includes(x)) kq.push(x);
  return kq.slice(-tran);
}

export function loaiCallIdDaLuu(hienCo: readonly number[], daLuu: readonly number[]): number[] {
  return hienCo.filter((x) => !daLuu.includes(x));
}

export function callIdCuaLuot(r: { ngoaiCallIds?: readonly number[] | null; vet?: { callId: number } | null }): number[] {
  if (r.ngoaiCallIds && r.ngoaiCallIds.length > 0) return [...r.ngoaiCallIds];
  return r.vet ? [r.vet.callId] : [];
}
