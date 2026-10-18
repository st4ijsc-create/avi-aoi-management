def tong_hop(ban_ghi, sap_theo="ten"):
    """list[(tên nhóm, Decimal)] ⇒ list[dict] mỗi nhóm một dict, đã sắp xếp."""
    if sap_theo not in ("ten", "tong"):
        raise ValueError(f"sap_theo lạ: {sap_theo!r}")
    nhom = {}
    for ten, gia_tri in ban_ghi:
        so_dong, tong = nhom.get(ten, (0, 0))
        nhom[ten] = (so_dong + 1, tong + gia_tri)
    ra = [{"nhom": ten, "so_dong": n, "tong": t, "trung_binh": t / n} for ten, (n, t) in nhom.items()]
    if sap_theo == "ten":
        ra.sort(key=lambda d: d["nhom"])
    else:
        ra.sort(key=lambda d: (-d["tong"], d["nhom"]))
    return ra
