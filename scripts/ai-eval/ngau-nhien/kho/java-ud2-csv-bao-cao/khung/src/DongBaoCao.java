import java.math.BigDecimal;

/** Một nhóm trong báo cáo. Tệp cho sẵn — KHÔNG sửa. */
public record DongBaoCao(String nhom, long soDong, BigDecimal tong, BigDecimal trungBinh) {}
