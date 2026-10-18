import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.Set;

public class NgayLamViec {
    private final Set<LocalDate> ngayLe;

    public NgayLamViec(Set<LocalDate> ngayLe) {
        this.ngayLe = Set.copyOf(ngayLe);
    }

    public boolean laNgayLamViec(LocalDate d) {
        DayOfWeek t = d.getDayOfWeek();
        return t != DayOfWeek.SATURDAY && t != DayOfWeek.SUNDAY && !ngayLe.contains(d);
    }

    public LocalDate congNgayLamViec(LocalDate tu, int n) {
        if (n == 0) {
            LocalDate d = tu;
            while (!laNgayLamViec(d)) d = d.plusDays(1);
            return d;
        }
        int buoc = n > 0 ? 1 : -1;
        int con = Math.abs(n);
        LocalDate d = tu;
        while (con > 0) {
            d = d.plusDays(buoc);
            if (laNgayLamViec(d)) con--;
        }
        return d;
    }

    public long demNgayLamViec(LocalDate tu, LocalDate den) {
        if (den.isBefore(tu)) return -demNgayLamViec(den, tu);
        long dem = 0;
        for (LocalDate d = tu; d.isBefore(den); d = d.plusDays(1)) {
            if (laNgayLamViec(d)) dem++;
        }
        return dem;
    }

    public static ZonedDateTime hopTiepTheo(ZonedDateTime luc, DayOfWeek thu, LocalTime gio, ZoneId vung) {
        ZonedDateTime tai = luc.withZoneSameInstant(vung);
        LocalDate ngay = tai.toLocalDate().with(TemporalAdjusters.nextOrSame(thu));
        while (true) {
            ZonedDateTime ung = ZonedDateTime.of(ngay, gio, vung);
            if (ung.toInstant().isAfter(luc.toInstant())) return ung;
            ngay = ngay.plusWeeks(1);
        }
    }
}
