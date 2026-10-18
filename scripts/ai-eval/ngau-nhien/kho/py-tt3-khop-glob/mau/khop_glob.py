"""Khớp mẫu kiểu glob tự cài: * ? [lớp] [!lớp] khoảng a-z, thoát bằng gạch chéo ngược. Quy hoạch động O(len(mau) * len(chuoi))."""


def _phan_tich(mau):
    """Mẫu ⇒ danh sách phần tử: ("*",) · ("?",) · ("ky", c) · ("lop", phu_dinh, [(dau, cuoi), ...])."""
    ra = []
    i, n = 0, len(mau)
    while i < n:
        c = mau[i]
        if c == "*":
            if not ra or ra[-1] != ("*",):
                ra.append(("*",))
            i += 1
        elif c == "?":
            ra.append(("?",))
            i += 1
        elif c == "\\":
            if i + 1 >= n:
                raise ValueError("dấu gạch chéo ngược ở cuối mẫu")
            ra.append(("ky", mau[i + 1]))
            i += 2
        elif c == "[":
            i += 1
            phu_dinh = False
            if i < n and mau[i] == "!":
                phu_dinh = True
                i += 1
            khoang = []
            dau_lop = True
            while True:
                if i >= n:
                    raise ValueError("lớp ký tự không đóng")
                if mau[i] == "]" and not dau_lop:
                    i += 1
                    break
                dau_lop = False
                c1, i = _doc_ky_lop(mau, i)
                if i + 1 < n and mau[i] == "-" and mau[i + 1] != "]":
                    c2, i = _doc_ky_lop(mau, i + 1)
                    if c1 > c2:
                        raise ValueError(f"khoảng ngược {c1}-{c2}")
                    khoang.append((c1, c2))
                else:
                    khoang.append((c1, c1))
            ra.append(("lop", phu_dinh, khoang))
        else:
            ra.append(("ky", c))
            i += 1
    return ra


def _doc_ky_lop(mau, i):
    if mau[i] == "\\":
        if i + 1 >= len(mau):
            raise ValueError("lớp ký tự không đóng")
        return mau[i + 1], i + 2
    return mau[i], i + 1


def _khop_mot(pt, c):
    if pt[0] == "?":
        return True
    if pt[0] == "ky":
        return pt[1] == c
    _, phu_dinh, khoang = pt
    trong = any(lo <= c <= hi for lo, hi in khoang)
    return trong != phu_dinh


def khop(mau, chuoi):
    pts = _phan_tich(mau)
    m = len(chuoi)
    # dp[j] = phần mẫu đã xét khớp được đúng chuoi[:j]
    dp = [True] + [False] * m
    for pt in pts:
        if pt[0] == "*":
            moi = dp[:]
            for j in range(1, m + 1):
                moi[j] = moi[j] or moi[j - 1]
        else:
            moi = [False] * (m + 1)
            for j in range(1, m + 1):
                moi[j] = dp[j - 1] and _khop_mot(pt, chuoi[j - 1])
        dp = moi
        if not any(dp):
            return False
    return dp[m]
