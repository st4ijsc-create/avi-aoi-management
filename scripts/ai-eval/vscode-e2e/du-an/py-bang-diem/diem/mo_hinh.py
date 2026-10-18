from dataclasses import dataclass, field


@dataclass
class BaiKiemTra:
    ten: str
    diem: float
    he_so: int = 1


@dataclass
class HocSinh:
    ma: str
    ho_ten: str
    bai: list = field(default_factory=list)
