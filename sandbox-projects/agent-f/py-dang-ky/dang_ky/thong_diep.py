THONG_DIEP = {
    "vi": {
        "email_trung": "Email đã được đăng ký",
        "thanh_cong": "Đăng ký thành công, mã của bạn là {ma}",
    },
}


def t(khoa: str, **tham_so) -> str:
    """Lấy thông điệp theo khoá và điền tham số."""
    return THONG_DIEP["vi"][khoa].format(**tham_so)
