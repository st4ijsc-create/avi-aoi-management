"""
Chỉ mục ký hiệu API cục bộ (2026-10-18) — nguồn PYTHON STDLIB.

Gọi bởi `dung-chi-muc-api.mjs` lúc DỰNG (ngoại tuyến, chạy với `-I`): nhập từng module thư viện chuẩn (`sys.stdlib_module_names`
+ module con của các gói), in mỗi ký hiệu công khai MỘT dòng JSON ra stdout, cùng khuôn `Muc` của `phanTich.mjs`:
  {"nn":"python","loai":..., "ns": module, "ten": "Lop.phuong_thuc", "cha"?, "chuKy", "tomTat", "_nhom"?, "_thuoc"?}
Dòng CUỐI ở STDERR là {"_meta": {...}} (phiên bản, số module nhập được, lỗi nhập). Không ghi đĩa, không mạng, không GPU.

Bỏ qua: module riêng tư (`_x`), module có tác dụng phụ khi nhập (`antigravity` mở trình duyệt, `this` in ra màn hình),
bộ test/IDLE/demo. Tên công khai = `__all__` nếu có, nếu không thì tên không bắt đầu bằng `_` mà ĐỊNH NGHĨA trong chính
module (hàm/lớp có `__module__` trùng) — không kể tên nhập lại từ module khác.
"""
import importlib
import inspect
import json
import pkgutil
import sys
import warnings

warnings.simplefilter("ignore")

BO_QUA = {
    "antigravity", "this", "idlelib", "turtledemo", "test", "lib2to3", "ensurepip", "pydoc_data",
    "__hello__", "__phello__", "__main__", "tkinter.test", "unittest.test", "ctypes.test", "distutils.tests",
}
TRAN = 240


def tom_tat(obj):
    try:
        d = inspect.getdoc(obj) or ""
    except Exception:
        d = ""
    d = d.strip().split("\n\n")[0].replace("\n", " ").strip()
    return d if len(d) <= TRAN else d[: TRAN - 1].rstrip() + "…"


def chu_ky(ten, obj):
    try:
        return f"{ten}{inspect.signature(obj)}"
    except Exception:
        return f"{ten}(...)"


def in_muc(m):
    sys.stdout.write(json.dumps(m, ensure_ascii=False) + "\n")


def ten_cong_khai(mod):
    ds = getattr(mod, "__all__", None)
    if isinstance(ds, (list, tuple)):
        return [x for x in ds if isinstance(x, str)]
    ra = []
    for ten, obj in vars(mod).items():
        if ten.startswith("_"):
            continue
        if inspect.ismodule(obj):
            continue
        if inspect.isclass(obj) or inspect.isfunction(obj) or inspect.isbuiltin(obj):
            if getattr(obj, "__module__", None) != mod.__name__:
                continue
        ra.append(ten)
    return ra


def ghi_module(ten_mod, mod):
    in_muc({"nn": "python", "loai": "module", "ns": ten_mod, "ten": ten_mod.split(".")[-1], "chuKy": f"import {ten_mod}", "tomTat": tom_tat(mod)})
    for ten in ten_cong_khai(mod):
        try:
            obj = getattr(mod, ten)
        except Exception:
            continue
        if inspect.ismodule(obj):
            continue
        if inspect.isclass(obj):
            nhom = f"py|{ten_mod}|{ten}"
            in_muc({"nn": "python", "loai": "class", "ns": ten_mod, "ten": ten, "chuKy": "class " + chu_ky(ten, obj), "tomTat": tom_tat(obj), "_nhom": nhom})
            for tv, gt in list(vars(obj).items()):
                if tv.startswith("_"):
                    continue
                if isinstance(gt, (staticmethod, classmethod)):
                    ham = gt.__func__
                    loai = "method"
                elif isinstance(gt, property):
                    ham = gt
                    loai = "property"
                elif inspect.isfunction(gt) or inspect.ismethoddescriptor(gt) or inspect.isbuiltin(gt):
                    ham = gt
                    loai = "method"
                else:
                    ham = None
                    loai = "attribute"
                ky = tv if loai in ("property", "attribute") else chu_ky(tv, ham)
                in_muc({"nn": "python", "loai": loai, "ns": ten_mod, "ten": f"{ten}.{tv}", "cha": ten, "chuKy": ky,
                        "tomTat": tom_tat(ham) if ham is not None else "", "_thuoc": nhom})
        elif callable(obj):
            in_muc({"nn": "python", "loai": "function", "ns": ten_mod, "ten": ten, "chuKy": chu_ky(ten, obj), "tomTat": tom_tat(obj)})
        else:
            loai_gt = type(obj).__name__
            in_muc({"nn": "python", "loai": "constant", "ns": ten_mod, "ten": ten, "chuKy": f"{ten}: {loai_gt}", "tomTat": ""})


def bi_bo_qua(ten):
    doan = ten.split(".")
    if any(d.startswith("_") for d in doan):
        return True
    if any(".".join(doan[: i + 1]) in BO_QUA for i in range(len(doan))):
        return True
    return any(d in ("test", "tests", "idle_test") for d in doan)


def main():
    da_lam, loi = 0, []
    ten_ds = sorted(n for n in sys.stdlib_module_names if not bi_bo_qua(n))
    hang = list(ten_ds)
    # module con của gói (os.path là bí danh, không phải tệp con ⇒ thêm tay)
    them = {"os.path"}
    da_thay = set()
    i = 0
    while i < len(hang):
        ten = hang[i]
        i += 1
        if ten in da_thay:
            continue
        da_thay.add(ten)
        try:
            mod = importlib.import_module(ten)
        except BaseException as e:  # noqa: BLE001 — module nền tảng khác / phụ thuộc thiếu
            loi.append(f"{ten}: {type(e).__name__}")
            continue
        try:
            ghi_module(ten, mod)
            da_lam += 1
        except BaseException as e:  # noqa: BLE001
            loi.append(f"{ten}: ghi {type(e).__name__}")
        duong = getattr(mod, "__path__", None)
        if duong:
            try:
                for con in pkgutil.iter_modules(duong, ten + "."):
                    if not bi_bo_qua(con.name):
                        hang.append(con.name)
            except BaseException:  # noqa: BLE001
                pass
        if ten == "os":
            hang.extend(sorted(them))
    sys.stderr.write(json.dumps({"_meta": {"phienBan": sys.version.split()[0], "soModule": da_lam, "loi": loi}}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
