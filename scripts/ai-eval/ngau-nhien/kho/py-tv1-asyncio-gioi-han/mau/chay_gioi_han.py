"""Chạy các tác vụ async với giới hạn đồng thời, trần thời gian từng tác vụ, kết quả theo thứ tự chỉ số."""
import asyncio

from ket_qua import KetQua


async def chay_gioi_han(tac_vu, gioi_han, tran_giay=None):
    if isinstance(gioi_han, bool) or not isinstance(gioi_han, int) or gioi_han < 1:
        raise ValueError("gioi_han phải là số nguyên >= 1")
    if tran_giay is not None and not tran_giay > 0:
        raise ValueError("tran_giay phải > 0 hoặc None")
    tac_vu = list(tac_vu)
    cho = asyncio.Semaphore(gioi_han)

    async def mot(i, ham):
        # Semaphore của asyncio đánh thức theo thứ tự FIFO ⇒ hàm tác vụ được gọi theo thứ tự chỉ số.
        async with cho:
            han = asyncio.timeout(tran_giay)
            try:
                async with han:
                    gia_tri = await ham()
            except TimeoutError as e:
                if han.expired():
                    return KetQua(i, "het_gio")
                return KetQua(i, "loi", loi=e)
            except Exception as e:  # noqa: BLE001 — đóng gói mọi lỗi của tác vụ
                return KetQua(i, "loi", loi=e)
            return KetQua(i, "ok", gia_tri=gia_tri)

    # gather bị huỷ ⇒ huỷ mọi tác vụ con và chỉ kết thúc khi chúng đã dừng hẳn.
    return list(await asyncio.gather(*(mot(i, ham) for i, ham in enumerate(tac_vu))))
