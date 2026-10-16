THONG_DIEP = {
    "vi": {
        "email_trung": "Email đã được đăng ký",
        "thanh_cong": "Đăng ký thành công, mã của bạn là {ma}",
        "bat_buoc": "{ten_truong} là bắt buộc",
        "do_dai": "{ten_truong} phải dài từ 2 đến 80 ký tự",
        "email_sai": "Email không hợp lệ",
        "khong_phai_so": "{ten_truong} phải là số nguyên",
        "ngoai_khoang": "{ten_truong} phải từ 16 đến 100",
        "sdt_sai": "Số điện thoại không hợp lệ",
        "truong.ho_ten": "Họ tên",
        "truong.email": "Email",
        "truong.tuoi": "Tuổi",
        "truong.so_dien_thoai": "Số điện thoại",
    },
    "en": {
        "email_trung": "Email is already registered",
        "bat_buoc": "{ten_truong} is required",
        "do_dai": "{ten_truong} must be 2 to 80 characters long",
        "email_sai": "Invalid email address",
        "khong_phai_so": "{ten_truong} must be a whole number",
        "ngoai_khoang": "{ten_truong} must be between 16 and 100",
        "sdt_sai": "Invalid phone number",
        "truong.ho_ten": "Full name",
        "truong.email": "Email",
        "truong.tuoi": "Age",
        "truong.so_dien_thoai": "Phone number",
    },
}


def t(khoa: str, ngon_ngu: str = "vi", **tham_so) -> str:
    """Lấy thông điệp theo khoá/ngôn ngữ; thiếu khoá hoặc ngôn ngữ lạ ⇒ tiếng Việt."""
    bang = THONG_DIEP.get(ngon_ngu, THONG_DIEP["vi"])
    mau = bang.get(khoa, THONG_DIEP["vi"][khoa])
    return mau.format(**tham_so)
