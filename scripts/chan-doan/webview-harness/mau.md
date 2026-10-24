## Phân tích lỗi `OutOfMemory` trong `otManager.ts`

Tôi đã đọc **3 tệp** liên quan và thấy nguyên nhân gồm hai phần:

1. Vòng poll không giới hạn hàng đợi — mỗi tick tạo một `Promise` mới mà không chờ tick trước.
2. `onSample` bị treo khi DB chậm, nên bộ nhớ tăng dần.

### Đề xuất sửa

- Thêm chốt chống chồng (`dangChay`) trước khi gọi `doc()`.
- Đặt hạn cho mỗi lần đọc: `max(2 × poll, timeout + 1000)`.
- Ghi lại số lần bỏ qua tick để theo dõi.

| Tệp | Thay đổi | Rủi ro |
|---|---|---|
| `vongPoll.ts` | thêm chốt | thấp |
| `otManager.ts` | truyền hạn đọc | trung bình |

> Lưu ý: cần chạy lại test `otManager.boDem.test.ts` sau khi sửa.

```ts
export function taoVongPoll(o: TuyChon) {
  let dangChay = false;
  const tick = async () => {
    if (dangChay) return;
    dangChay = true;
    try { await o.doc(o.tags); } finally { dangChay = false; }
  };
  return setInterval(() => void tick(), o.intervalMs);
}
```

Chạy `npx vitest run server/services/ot` để kiểm tra. Nếu cần, tôi có thể sửa luôn.
