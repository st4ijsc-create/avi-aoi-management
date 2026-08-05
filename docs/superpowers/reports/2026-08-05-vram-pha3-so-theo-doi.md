# SDD ledger — plan: docs/superpowers/plans/2026-08-05-vram-pha3-so-chung.md

## Task 1 — 🔴 C-2 nghiệm thu SỐNG người thi hành thu hồi

- [x] Bước 1 — đo `stopSidecar()` trên sidecar THẬT, 5 lượt: **485,3 · 485,6 · 488,3 · 500,4 · 495,6 ms**
      (min 485,3 · trung vị 488,3 · max 500,4). **Không lượt nào vượt 8.000 ms** ⇒ hạn mặc định ĐỦ.
- [x] Bước 1b (ngoài kế hoạch, phát hiện lớn nhất) — tách mốc: OS đặt mã thoát **10,9 ms**,
      `nvidia-smi` về nền **< ~150 ms**, Node phát `"exit"` **514,8 ms** ⇒ **chênh 503,8 ms là ĐỘ TRỄ
      QUAN SÁT của libuv**, không phải cái chết. Cửa sổ ~0,5 s "thiết bị đã nhả, sổ khai còn giữ".
- [x] Bước 2 — nghiệm thu SỐNG (a) `failed`/sổ y nguyên/`freedBytes=0` **ĐẠT** · (b) `reclaimed`/sổ
      nhả `8.210.137.088` byte/`nvidia-smi` 9.338→1.295 MiB **ĐẠT**. Cả hai qua đường refCount THẬT.
- [x] Bước 3 — ca ngữ nghĩa thật C-2a/C-2b đã có (`f6e33567`); **thêm 2 ca** cho dây `?? 8000` của
      `stopWaitMs()` (nửa còn lại của C-2, trước đó không ai canh). 557 → **559 xanh**, `tsc` sạch.
- [x] Bước 4 — đột biến: 2 lượt vòng 1 + 4 lượt vòng 2, CẢ SÁU bị GIẾT — xem §4 và §8b.
- [x] Review vòng 1 (4 🟠 + 3 🔵) — I-1 · I-2 · I-3 · I-4 · M-1 · M-2 · M-3 đã xử lý, xem §8.
- [x] Bước 5 — commit.

Báo cáo: `task-1-report.md` (cùng thư mục).
Task 1: complete — 48df3b4c + 6c92686e, 565/565 (31 file). NO C-2 cua Pha 2B DA TRA DU.
  Do stopSidecar(): 485,3 / 485,6 / 488,3 / 500,4 / 495,6 ms — han 8.000 ms co bien ~16x, KHONG noi.
  Nghiem thu song CA HAI: (a) chua chet => failed, so y nguyen 8.210.137.088 B, freedBytes=0;
  (b) da chet => reclaimed dung byte, nvidia-smi 9.338 -> 1.295 MiB.
★★★ PHAT HIEN DOI CACH VIET 4 TASK CON LAI — `kill(pid,0)` KHONG PHAI MOT QUAN SAT CAI CHET.
  Cua so ~0,5 s CO THAT nhung KHONG phai "do tre libuv" (ban chung: tien trinh con KHONG GPU chi
  lech 3,4-4,1 ms, 5/5; ESRCH 0,2-0,4 ms). Su that la ngu nghia TerminateProcess: ma thoat dong dau
  NGAY (=> kill(pid,0) SOM GIA), handle chi bao hieu KHI THAO DO XONG (~0,5 s voi tien trinh CUDA).
  ⇒ "after - before thay 0" chi dung khi doc SO; doc THIET BI thi NGUOC LAI (7,8 GB da nha tu ~33 ms).
  ⇒ T2 phai phat lenh ghi nha TU CHINH nhanh exit/error, cam dung "hang bien khoi ban sao doc 60 s"
     lam bang chung. T3 cam chup nen khi co lease dang trong luot dung. T4 NGUY HIEM NHAT: no de ra
     nguoi doc THU HAI cua vi tu "con song" lech nhau 543 ms tren chinh ho 7,8 GB => phai dung CUNG
     `daChet` cho ho co `proc`, chi do PID cho ho mo coi. T5: bang chung thu hoi phai la mot luot GHI
     tuong minh, khong phai hieu so so/thiet bi.
Task 1: ★ I-1 — nhanh SIGKILL truoc day KHONG CHAY DUOC (hen gio canh bang `!proc.killed`, ma Node
  dat co do DONG BO khi kill() gui thanh cong). Va bang `MocCaiChet`: MOT bien, MOT nguoi ghi, HAI
  kieu doc — khong de ban sao vi tu (rang buoc 12). Chu thich :511-513 mo ta trang thai ma KHONG tao
  ra duoc — va Task 4 dinh dung ttlMs len tren cau do.
Task 1: ★ I-2 — dot bien SONG SOT lan thu SAU (vo hieu setLeaseRefCount => 559/559 XANH). Hai nua
  luoi dung HAI DAU soi day, khong nua nao di qua day (mot ben ticket GIA, ben kia so do ca test TU
  DAT). Da va bang ca di qua DUONG THAT describeImageViaSidecar -> ... -> setLeaseRefCount.
Task 1: GOTCHA moi — mock `vramWiring` KHONG song chung duoc voi vi.resetModules(): dat seam trong
  wiring.outofprocess.test.ts lam 18/18 ca do va giay phep tich luy qua cac ca. Seam phai o FILE RIENG.
Task 1: KHONG sua (4 muc, co dia chi): ca `failed` duoi cau hinh SAN XUAT 8.000 ms tren tien trinh
  that (can Linux/WSL + `trap '' TERM`, khong can GPU) · SIGKILL toi llama-server that (cung fixture)
  · gop VRAM_SIDECAR_TTL_MS voi LLAMA_VISION_IDLE_TIMEOUT_MS (Task 4) · refCount=1 cua sidecar chua
  phuc vu luot nao (doi la doi CHINH SACH, can quyet dinh o Pha 3).
  ⚠ No hep nhat: nhanh `failed` duoi han san xuat CHUA TUNG CHAY o dau, va Task 2/Task 4 se DUNG
  TREN dung nhanh do.

## Task 2 — 🔴 Sổ chung: bản sao đọc ĐỒNG BỘ, ghi BẤT ĐỒNG BỘ

- [x] Bước 1 — đọc mã. **★★★ PHÁT HIỆN 0: bảng `vram_leases` KHÔNG TỒN TẠI.** Kế hoạch Pha 3 và
      brief đều khẳng định "đã có từ Pha 1" — SAI. Pha 1 (mig 0310) chỉ dựng `vram_events`, một
      nhật ký CHỈ-GHI-THÊM. ⇒ mig `0312` là lượt TẠO BẢNG đầu tiên. **CHƯA CHẠY DDL.**
- [x] Bước 2–5 — đỏ → cài đặt → xanh + shuffle. Hai nửa: `vramSharedLedger.ts` (LÁ, đồng bộ) +
      `vramSharedLedgerStore.ts` (I/O). `reserve()` VẪN ĐỒNG BỘ; sổ = CỤC BỘ + CHUNG.
- [x] Bước 6 — đột biến: **7 lượt, cả 7 bị GIẾT**; **2 lượt SỐNG SÓT ở vòng 1 đẻ ra 2 ca MỚI**
      (`C-4` lệnh XOÁ không dựng lại được ⇒ HÀNG MA khoá 7,8 GB của cả cụm; `E-4` cơ chế E-3 CHE
      MẤT đột biến "suy luận từ hiệu số"). Lưới-theo-FILE lần thứ BẢY và THỨ TÁM.
- [x] Bước 7 — commit `9e67e3f9` + `ae321cda`.

Báo cáo: `task-2-report.md` (cùng thư mục).
Task 2: complete — 9e67e3f9 + ae321cda, 590/590 (33 file), shuffle 12/12, tsc sach.
★★★ vram_leases CHUA TON TAI truoc task nay. Mig 0312 da VIET, **CHUA CHAY DDL** (ca DB chinh lan
  aoi_management_test). Chua ap => moi luot ghi so chung nem => co `shared-ledger-unsynced` bat =>
  he CHAT HON va CO TIENG, khong am tham lui ve Pha 2B. Lenh ap nam o §7 bao cao.
★★★ LIEN DOI THAT nhip cuong che <-> DB, shuffle bat, BA buoc moi go xong:
  (1) sync o DAU tick => 2/3 shuffle DO (await getDb() chan truoc luot chup nen);
  (2) `finally` + van `await` => **4/8 DO** — loi hua cua nhip con treo theo mot vong di DB;
  (3) ban-roi-di => con 2/10 DO — nhanh gateway THAT keo db/connection+drizzle+pg vao do thi bien
      doi Vite cua MOI file test goi startVramReconciler(). Bang chung: waitFor het 1.423 ms +
      dong `[Database] Connecting to PostgreSQL` trong nhat ky luot do. Dung GOTCHA aiGateway.
  => hang rao `process.env.VITEST` o layGateway() => 12/12 shuffle xanh. Thoi luong tick nay DOC
     LAP TUYET DOI voi DB.
Task 2: KHONG bao dam (8 muc, co dia chi): ban cai dat Drizzle CHUA CHAY LAN NAO (khong ca test
  nao cham, bang chua migrate) · nghiem thu SONG hai tien trinh THAT chua chay (cua ra so 2 cua
  Pha 3: nua TEST dat, nua SONG **CHUA DAT**) · cau TU CHOI chua GOI TEN ho cua anh em (holders
  van chi so CUC BO, trong khi CON SO da tru phan anh em — de danh Task 5, foreignLeases da mang
  san du du lieu) · phu phi toi da 2.048 MiB khong che noi mot anh em 17 GB · reconcileOnce() van
  tinh lech tren so CUC BO (co y — nen dung chung la Task 3, sua ve so truoc ve nen la TRU HAI LAN)
  · chua co co che don hang cua tien trinh DA CHET (kill -9 => hang MA vinh vien — Task 4 nay co
  them mot dan so phai xu).
Task 2: implemented 9e67e3f9 + ae321cda — 590/590 (33 file), shuffle 12/12 luot, tsc sach.
  7 dot bien, ca 7 bi giet.
★★★ LOI CUA CONTROLLER: ke hoach Pha 3 khang dinh "vram_leases da ton tai tu Pha 1" — SAI. Pha 1
  (mig 0310) chi dung `vram_events` (nhat ky CHI-GHI-THEM). So chung o DB CHUA TUNG TON TAI.
  Task 2 viet mig 0312 va BAO TRUOC thay vi chay DDL len. CONTROLLER DA AP 0312 len CA HAI DB
  (aoi_management + aoi_management_test, owner aoi): vram_leases, 14 cot, 3 index, xac minh bang
  to_regclass + information_schema. Ke hoach da duoc dinh chinh tai cho.
  ⚠ Truoc khi ap: moi luot ghi so chung NEM => co `shared-ledger-unsynced` bat => he CHAT HON va
  CO TIENG (chieu dung, khong am tham lui ve Pha 2B). Che do hong dung.
Task 2: ★★ LIEN DOI THAT giua nhip cuong che va DB — SHUFFLE bat, khong phai review. `finally` +
  `await` VAN do 4/8; phai ban-roi-di, roi van con 2/10 vi nhanh gateway that keo db/connection +
  drizzle + pg vao do thi bien doi Vite cua MOI file test goi startVramReconciler(). Neu de nguyen
  ban dau: DB CHAM => o tick gia => CUONG CHE TU CHAT vi ly do chang lien quan toi VRAM.
Task 2: ★ HAI dot bien SONG SOT o vong 1 — luoi-theo-FILE lan thu BAY va THU TAM. C-3 xanh nho mot
  co che KHAC co che no tuong dang canh (upsert tu dung lai tu so cuc bo; delete thi KHONG — mat no
  => hang MA khoa 7,8 GB cua ca cum VINH VIEN). Da de ra C-4 va E-4.
Task 2: BAN GIAO CUNG Task 3 — reconcileOnce() CO Y khong cong foreignBytes: nen hom nay DA nuot
  byte anh em, nen sua ve SO truoc ve NEN la TRU HAI LAN (lech am gia ~17 GB).
Task 2: BAN GIAO Task 4 — chua co co che don hang cua tien trinh DA CHET; `kill -9` de lai hang MA
  vinh vien. Vat lieu san: processKey co bootMs, updatedAt co index.
Task 2: CUA RA SO 2 moi dat MOT NUA — nua "test" dat; nua "nghiem thu SONG hai tien trinh that"
  CHUA dat. Ban cai dat Drizzle cua cong (onConflictDoUpdate + inArray) la MA CHUA TUNG THUC THI
  (vi bang chua ton tai luc do). Nay bang da co => chay duoc.

### Task 2 — vòng review 1 (commit `8b6e00ee`)

Review: **tuân thủ ĐẠT · chất lượng DUYỆT**, 5 Important + 7 Minor. Reviewer tự chạy nghiệm thu
SỐNG hai tiến trình THẬT (api 39072 ⟷ worker 30836, DB thật, nhánh Drizzle thật) ⇒ **CỬA RA SỐ 2
CỦA PHA 3 ĐẠT CẢ HAI NỬA**; hai nợ nặng nhất (§8.1 Drizzle chưa chạy, §8.2 nghiệm thu sống) ĐÃ TRẢ.

★★★ I-2 — HAI ĐỘT BIẾN CỦA REVIEWER SỐNG SÓT 590/590 (lần thứ CHÍN của "lưới theo hình dạng
  fixture"): lọc bằng `role` thay `processKey`, và lọc bằng `pid` bỏ `bootMs`. Cả 5 cặp fixture đều
  `api:…` ⟷ `worker:…` nên role vô tình phân biệt được. `bootMs` có docstring + cột DB + lý lẽ dẫn
  nợ N2-2 Pha 2A và **0 ca test**. Nay 2 ca bịt: hai tiến trình CÙNG VAI; cùng vai CÙNG PID khác
  bootMs. ⇒ đột biến role ĐỎ 2 ca, đột biến pid ĐỎ 1 ca.
★★★ I-1 — "DB TREO" ≠ "DB NÉM". Cả họ C-* mô phỏng bằng NÉM; TREO thì `consecutiveFailures` đứng 0,
  `keuMotLan` im, `dangDongBo` KẸT ⇒ mọi sync sau là no-op ⇒ HÀNG MA vĩnh viễn qua một cửa C-4
  không đi qua. Nay có hạn giờ 120 s (2 chu kỳ) + quá hạn ĐẾM NHƯ MỘT LƯỢT HỎNG.
★★★ I-3 — cờ `shared-ledger-unsynced` bắn cho cả bump `refCount` (không đổi byte) ⇒ worker BẬN
  mang trusted:false + −1.024 MiB THƯỜNG TRỰC. Nay chỉ đếm ý định ĐỔI BYTE; `noteRefCount()` được
  thêm một lượt hẹn sync (trước đó là điểm ghi DUY NHẤT không có sync).
★★★ I-4 — `sharedLedgerMarginBytes` bão hoà sau ~674 ms ⇒ ở nhịp 60 s nó là THUẾ PHẲNG 1.024 MiB;
  cộng khoản cố định của ô tick ⇒ **~2 GiB THƯỜNG TRỰC** trên card 32,6 GiB, §8.4 không khai.
  KHÔNG đổi số (mọi cách cân lại đều NỚI — ràng buộc 8 cấm; nâng `rate` cần phép đo chưa ai làm),
  làm đúng tiền lệ M-2 ô tick: giữ số, gọi đúng tên, khai con số, khoá bằng ca I-4.
★ I-5 — `kheGgufConThieu()` vẫn đếm sổ CỤC BỘ ⇒ hai tiến trình = trần thực tế **8 model** thay vì 4,
  và Đ4 khiến cửa BYTE không cứu được cửa ĐẾM. CỐ Ý chưa sửa (đổi CHÍNH SÁCH) — đã khai tại chỗ mã
  + bàn giao. Vật liệu sẵn: `foreignLeases` mang `leaseKind`, phép đếm xuyên tiến trình là 1 dòng.
Minor: M-1 cắt varchar (owner là chuỗi ĐỘNG từ đường dẫn tuyệt đối; ở bảng này `requeue` ném lại
  đúng hàng độc ⇒ lỗi TẠM thành lỗi CHẾT) · M-2 O(1)→O(n) · M-3 `lease.released` là HỢP ĐỒNG ·
  M-4 tái vũ trang nhịp hẹn (cửa sổ hàng-ma 60 s → 250 ms) · M-5 hint nói rõ lệch vẫn tính trên sổ
  cục bộ · M-6 câu từ chối in con số byte của anh em · M-7 khai ràng buộc "công bố bị khoá sau
  startVramReconciler()".
★ Bàn giao Task 3 (reviewer bổ sung): lệch DƯƠNG hôm nay bị chính mã gọi là "kẻ cấp phát chui" ⇒
  QUY TRÁCH NHIỆM SAI, không chỉ "sai hướng". Task 3 phải sửa HAI vế trong MỘT lượt
  (`drift = (thiết bị − nềnNGOÀIHỆ) − (sổCụcBộ + sổAnhEm)`), chọn MỘT nguồn cho vị từ "byte của
  anh em" (`peers` vs `foreignLeases`), thêm dung sai cho bản sao cũ tới 60 s, và nhớ
  `baselineVerified` là VỊ TỪ DÙNG CHUNG với `applyEnforcement`.
Task 2 (sau review): 599/599 (33 file), shuffle 3/3, tsc sạch. Commit 8b6e00ee.
Task 2: complete — 9e67e3f9 + ae321cda + 8b6e00ee, 599/599 (33 file), shuffle 3/3.
★★ NGHIEM THU SONG HAI TIEN TRINH DAT (reviewer chay, DB that, nhanh Drizzle that):
  api 39072 cap 17.000 MiB -> 1 hang; worker 30836 thay foreignBytes=17.825.792.000 + du chi tiet ho
  => TU CHOI; api release -> 0 hang. Vong 2 (ca hai ROLE=worker) y het. CUA RA SO 2 DAT.
  `reserve()` VAN DONG BO — 3 lop bang chung (vramBroker.ts 0 khop await/async/import trong ma;
  vramSharedLedger.ts co DUNG MOT dong import va no la `import type`; 3 diem I/O deu void-ed va SAU
  khi da quyet).
Task 2: ★ Dot bien THU BA cua reviewer SONG SOT (loc "cua ta" bang ROLE thay processKey) va bien the
  3b (loc bang pid, bo bootMs) cung song sot => lan thu CHIN/MUOI cua lop "luoi theo FILE".
  Nguyen nhan: bootMs co docstring + co cot DB + 0 CA TEST; ca 5 cap fixture DEU KHAC VAI TRO nen
  role VO TINH phan biet duoc thay cho processKey. Da bit bang 2 ca.
Task 2: I-4 — bien "theo tuoi" BAO HOA sau ~674 ms => o nhip 60 s la THUE PHANG 1.024 MiB. Do duoc
  NGAY trong nghiem thu song: headroom - effective = 1.073.741.824 voi reasons=[]. Implementer TU CHOI
  doi con so (moi cach "can lai" deu la NOI LONG, nguoc rang buoc 8; nang rate can mot phep do CHUA AI
  LAM = bia hang so = dung loi I-3 Pha 1). Da goi dung ten "thue phang", khai ~2 GiB thuong truc
  (1.024 tick + 1.024 so chung), khoa diem bao hoa HAI MEP (673/675/60.000 ms).
★★★ I-5 LA LO CHINH SACH DANG SONG, CAN CHU DU AN QUYET TRUOC KHI PHA 3 DONG:
  `kheGgufConThieu()` van dem SO CUC BO => hai tien trinh = 8 model GGUF THUONG TRU tren mot card
  (thay vi 4). Va Đ4 khien cua BYTE KHONG CUU duoc cua DEM. Implementer TU CHOI tu doi vi day la
  doi CHINH SACH: co the bat dau TU CHOI nhung luot nap hom nay dang chay tot, va can mot quyet dinh
  (tran cum bang bao nhieu?). Vat lieu da san: foreignLeases mang leaseKind => mot dong filter.
Task 2: BAN GIAO Task 3 NAY NANG HON — lech DUONG hom nay bi CHINH MA goi la "ke cap phat chui"
  => QUY TRACH NHIEM SAI cho mot ho hop le. Task 3 phai sua HAI VE TRONG MOT LUOT, chon MOT nguon
  cho vi tu "byte cua anh em" (census.peers vs foreignLeases), them dung sai cho ban sao cu toi 60 s,
  va nho `baselineVerified` la VI TU DUNG CHUNG voi applyEnforcement.
Task 2: NO — refCount xuyen tien trinh VAN RACY (chieu 0->1 con cua so; Task 5 phai XAC MINH LAI,
  khong duoc tin o do) · nhanh Drizzle VAN KHONG CO CA TEST nao (reviewer chay song, nhung la ma
  khong luoi; layGateway() tra null duoi VITEST).

## Task 3 — 🔴 N-WB-1: NỀN DÙNG CHUNG (nợ nặng nhất của Pha 2B)

- [x] Bước 1 — chọn người chụp: hàng dành riêng `vram:baseline` trong `vram_leases` (KHÔNG DDL).
      Đương nhiệm giữ vai bằng NHỊP SỐNG mỗi lượt sync; quá 3× dung sai (180 s) thì mất vai; lúc
      chưa có hàng thì `processKey` NHỎ NHẤT trong tập ứng viên thắng (tất định ⇒ không khoá phân tán).
- [x] Bước 2-5 — đỏ → cài đặt → xanh. **HAI VẾ TRONG MỘT LƯỢT**, ghép bằng MỘT vị từ
      `nenDaTruAnhEm()` (`baselineOrigin`): một biến, một người ghi, hai người đọc.
- [x] Bước 6 — đột biến: **9 lượt, 3 SỐNG SÓT ở vòng đầu** ⇒ 3 ca mới, sau đó cả 9 bị GIẾT.
- [x] Bước 7 — nghiệm thu SỐNG hai tiến trình THẬT + sidecar 7,8 GB THẬT: **ĐẠT**.
- [x] Bước 8 — commit `068217ac` + `b625f89d`.

Báo cáo: `task-3-report.md` (cùng thư mục).
Task 3: complete — 068217ac + b625f89d, 615/615 (34 file), shuffle 3/3, tsc sạch.
★★ NGHIEM THU SONG DAT (2 luot, DB that, nhanh Drizzle that, sidecar llama-server 7,8 GB THAT):
  A worker:10776 nap sidecar => thiet bi 1.191 -> 9.008 MiB, giay phep 8.210.137.088 B.
  B api:29484 so CUC BO 0, thiet bi 9.444.524.032 => **nen = 1.234.386.944 B (1.177 MiB)**.
  Truoc Task 3 nen se la 9.444.524.032 (9.008 MiB) — NUOT tron 7.830 MiB cua anh em.
  attributableBytes = 8.210.137.088 = DUNG khoi byte that cua anh em. drift = 0, alarm = false.
  Roi A DOC nen cua B: nenA = 1.234.386.944 (y het), baselineOrigin = "adopted", thoi cong bo.
  Bang co DUNG MOT hang `vram:baseline`. Hai tien trinh thoat ma 0.
★★★ M-5 SONG SOT 612/612 — bo `baselineOrigin !== "adopted"` khoi nhanh RESAMPLE thi khong ca nao do.
  Lan thu MUOI MOT cua "luoi theo FILE". Hau qua: nguoi DOC khong co gi de chup lai => mismatch thuoc
  lap MOI nhip => ngat mach EXP-1 trip => attributableBytes null VINH VIEN = nhanh RONG NHAT.
★★★ M-8 SONG SOT 614/614 — `?? 0` thay nhanh `null` tuong minh (rang buoc 4). Trang thai do HOM NAY
  khong voi toi duoc tu san xuat; da khai TAI CHO de nguoi sau khong xoa nhanh phong ve nhu ma chet.
★★★ MOT LUOI GIA DO CHINH TOI VIET, chi lo o vong dot bien: ca D-2 goi computeHeadroom bang SAU ten o
  SAI => "invalid-input" => headroomBytes = -Infinity => `-Infinity === -Infinity - 1 GiB` la TRUE =>
  ca XANH duoi MOI dot bien.
⚠⚠ GOTCHA REPO (chua ai ghi): `tsconfig.json` co `"exclude": [... "**/*.test.ts" ...]` => **tsc KHONG
  he canh ten o trong BAT KY file test nao**. No toan repo, khong rieng module VRAM.
Task 3: NO (co dia chi, xem §7 bao cao): tsconfig loai tru file test · nhanh Drizzle van 0 ca test
  (5 cot moi trong onConflictDoUpdate chi duoc kiem bang nghiem thu SONG; dot bien M-7 SE song sot) ·
  `census.peers` van ha baselineVerified VINH VIEN trong topo api+worker => co la hang so false,
  -1.024 MiB thuong truc, KHONG con mang thong tin (khop khong sua duoc bang pid: sidecar la CON cua
  vai tro anh em, giay phep nam o tien trinh CHA) · cua so 60 s hai nguoi cung cong bo khi mot ben
  chua giu giay phep nao (vo hai ve SO: cong thuc doi xung) · nen "adopted" chiu lech hai thuoc
  165-178 MiB (khai bang co, khong bang phep tru) · hang `vram:baseline` cua tien trinh da chet nam
  lai toi 180 s (Task 4 cham dung dan so nay) · baselineOrigin chua ghi vao baseline_deferred/blocked.
Task 3: getLlama() KHONG nap duoc trong mot tien trinh `tsx` tran tren may nay (thoat ma 0 ngay sau
  reserve("cuda-backend"), khong log, khong loi) — khop bi an "CUDA context phai tao TRUOC khi app
  boot" cua Dot 1. Nghiem thu song vi the dung sidecar 7,8 GB THAT thay vi 17 GB.
Task 3: complete — 068217ac + b625f89d, 615/615 (34 file), shuffle 3/3. N-WB-1 DA DONG.
★★ NGHIEM THU SONG api+worker (DB that, sidecar llama-server 7,8 GB THAT):
  truoc: nvidia-smi 1.191 MiB · A(worker:10776) nap sidecar => thiet bi 9.008 MiB, giay phep
  8.210.137.088 B · B(api:29484) so cuc bo 0, thiet bi 9.444.524.032 => NEN = 1.234.386.944 B
  (TRUOC Task 3 nen se la 9.444.524.032 — NUOT TRON 7.830 MiB cua anh em).
  B reconcileOnce(): attributable = 8.210.137.088 (dung khoi byte that cua anh em), drift = 0,
  alarm = false. A doc nen cua B: y het, baselineOrigin="adopted". Bang: DUNG MOT hang vram:baseline.
  Vong 3: hang MA 17.000 MiB => HOAN, khong chup nen am.
★★★ PHAT HIEN TOAN REPO (moi lo 1): `tsconfig.json` LOAI TRU `**/*.test.ts` => tsc KHONG canh MOT
  DONG NAO trong file test. Chinh co che nay de ra mot LUOI GIA do implementer tu viet: ca D-2 goi
  computeHeadroom bang SAU ten o SAI => headroomBytes = -Infinity => `-Infinity === -Infinity - 1GiB`
  la TRUE => ca XANH duoi MOI dot bien. => Day la co che khien "luoi gia" viet duoc ma khong ai thay.
  NO TOAN REPO, khong rieng VRAM.
Task 3: 3 dot bien SONG SOT vong dau (nen "adopted" van resample; `?? 0` thay nhanh null) — da bit,
  roi ca 9 bi giet.
Task 3: NO — nhanh Drizzle VAN 0 ca test (Task 3 them 5 cot danh tinh vao onConflictDoUpdate, cho
  quyet dinh CHUYEN VAI nguoi chup; dot bien bo 5 cot do SE SONG SOT bo 615) · census.peers van ha
  baselineVerified VINH VIEN trong topo api+worker => co la hang so false, -1.024 MiB thuong truc,
  KHONG CON MANG THONG TIN; khong sua duoc bang khop pid (sidecar la CON cua vai tro anh em, giay
  phep nam o tien trinh CHA) => CAN QUYET DINH CHINH SACH truoc khi Pha 3 dong · hang vram:baseline
  cua tien trinh da chet nam lai toi 180 s (Task 4 cham dung dan so nay).
Task 3: GOTCHA — getLlama() KHONG nap duoc trong tien trinh `tsx` tran tren may nay (thoat ma 0 ngay
  sau reserve("cuda-backend"), khong log, khong loi) — khop bi an "CUDA context phai tao TRUOC khi
  app boot" cua Dot 1. Nghiem thu song dung sidecar 7,8 GB that thay cho 17 GB.

### Task 3 — hai QUYẾT ĐỊNH CHÍNH SÁCH của chủ dự án (commit dfa11683)

Task 3 (sau quyet dinh): 622/622 (34 file), shuffle 3/3, tsc sach. Commit dfa11683.
QD1 — TRAN SO MODEL GGUF: **GIU MOI-TIEN-TRINH**, chi tai lieu, KHONG doi hanh vi, KHONG them tran
  cum. Khai dung con so o BA cho (kheGgufConThieu / .env / .env.example): so model thuong tru toi da
  = so_tien_trinh x GGUF_MAX_LOADED_MODELS => **8 model tren MOT card** voi topo api+worker. Va noi
  ro VI SAO cua BYTE khong cuu duoc cua DEM: D4 cam tron hai thuoc => tran dem la cua DOC LAP,
  vramEnforcement da co y xoa "gguf-slot-cap" khoi bang phu phi byte => 8 model NHO van qua cua byte.
QD2 — `baselineVerified`: **THAY ve `peers`, KHONG bo co.** Ve cu ha co vi "nen da NUOT byte anh em"
  — tinh trang ma CHINH Task 3 vua xoa bo (nghiem thu song: nen 1.234.386.944 thay vi 9.444.524.032,
  drift 0). Vi tu moi (MOT ban cai dat, hai nguoi ghi goi chung): ha co khi khong quet duoc ho giu
  GPU · co TAN DU that · **anh em tren card ma byte cua ho CHUA duoc tinh** (khong co so chung =
  khong ai thang bau, HOAC so chung IM = 0 hang cua ai khac) · nen nhan nuoi QUA CU · nguoi chup tu
  khai chua xac minh. Dem HANG khong dem BYTE (gguf-backend uoc luong 0 byte van la mot hang).
  Co nay la HE QUA DAN XUAT cua danh sach ly do (MOT bien, mot nguoi ghi) => khoan tru 1.024 MiB
  THOI MO COI: `baselineUnverifiedReasons` di ra o ket qua + vram_events + cau warn.
  ⇒ api+worker voi so chung KHOE nay dat verified:true (ca F-1). 7 ca moi F-1..F-7.
★ DAN SO SUYT BI PHAT OAN (ban dau cua chinh ban va nay): neu "khong-co-so-chung" la mot ly do DOC
  LAP thi MOI cai dat MOT TIEN TRINH mat 1.024 MiB ma khong co khoi byte nao chua duoc tinh. Cau hoi
  "byte anh em da duoc tinh chua" CHI duoc hoi khi CO anh em. Ca F-5 + dot bien N-4 khoa.
Dot bien vong 2: 5 luot, CA 5 BI GIET. N-1 (khong ai thang bau ma co van true) => C-2/F-2/F-3 + 2 ca
  co san · N-2 (nen nhan nuoi qua cu) => D-1/D-2 · N-3 (tan du that) => F-4 + 4 ca co san ·
  N-4 (phat ca cai dat MOT tien trinh) => F-5/D-1/D-2 + 5 ca co san · N-5 (co thanh o SONG SONG thay
  vi DAN XUAT) => 6 ca.
★★★ QUET LUOI GIA (tsc tren mot config TAM phu server/services/vram/**, KHONG dung tsconfig.json):
  **6 cho sai kieu, DUNG MOT la luoi GIA that su**:
  (1) D-2 — 6 o sai ten => "invalid-input" => headroomBytes = -Infinity => `-Infinity === -Infinity
      - 1 GiB` la TRUE => XANH duoi MOI dot bien. ⇒ LUOI GIA.
  (2) 7 diem goi `commit(lease.id, ...)` trong khi commit() nhan VramLease => no-op IM LANG, giay
      phep fixture CHUA BAO GIO duoc chot so (khong vacuous nhung fixture khong phai thu ca tuyen bo).
  (3) refusal.test.ts CHUA BAO GIO khai foreignLedgerBytes => cau "... do TIEN TRINH KHAC giu" (M-6
      cua Task 2) khong bao gio render => cau do KHONG CO MOT LUOI NAO.
  (4) enforcement.test.ts:533 thieu 2 o bat buoc · (5) sharedLedger.test.ts:512 thieu tickPresent
      (ca I-4 von chay duoi cau hinh "no-tick" no khong dinh dung) · (6) threeOutcomes.test.ts:1274
      artefact KIEU cua mock (khong sua).
★★★ PHAT HIEN NANG HON CA LUOI GIA: ban va D-2 cua vong truoc **KHONG LOT VAO COMMIT b625f89d** —
  file bi hoan nguyen giua luc sua va luc commit, nen commit do chua DUNG ban luoi gia trong khi bao
  cao lai khai la da sua. Luot quet kieu la thu DUY NHAT bat duoc. ⇒ "da sua" chi dung khi
  `git show <commit>:<file>` xac nhan, khong phai khi trinh soan thao xac nhan.
⚠⚠ NO TOAN REPO CHUA TRA: tsconfig.json loai tru moi *.test.ts => tsc khong canh mot dong nao trong
  file test. Do la CO CHE dang sau lop loi "luoi xanh vi ly do sai" da tai dien MUOI lan. Ngoai pham
  vi Task 3 (dung vao la doi build ca du an). De xuat: mot buoc CI chay tsc tren config phu file test.
Task 3: NO BO SUNG — refusal.test.ts van khong co luoi cho cau M-6 (chua ca nao truyen so DUONG) ·
  co van co the false thuong truc trong topo CO SIDECAR (vramGpuHolders xep llama-server cua ben kia
  vao `orphans` chu khong phai `peers` — hanh vi CO SAN, vramGpuHolders.ts:428) · tran DEM
  8-model-tren-mot-card da duoc KHAI nhung CHUA CO AI CANH (khong ca test nao khang dinh).
Task 3: complete — 068217ac + b625f89d + dfa11683, 622/622 (34 file), shuffle 3/3.
QUYET DINH 1 (chu du an): GIU tran GGUF MOI-TIEN-TRINH. Chi tai lieu, khong doi hanh vi. Khai o BA
  cho (kheGgufConThieu, .env, .env.example): so_tien_trinh × GGUF_MAX_LOADED_MODELS => 8 model
  thuong tru tren MOT card voi topo api+worker. Ly do cua BYTE khong cuu duoc cua DEM: Đ4 cam tron
  hai thuoc => tran dem la cua DOC LAP; vramEnforcement CO Y xoa "gguf-slot-cap" khoi bang phu phi byte.
QUYET DINH 2 (chu du an): baselineVerified — THAY, khong bo. Ve `peers.length === 0` la DI SAN:
  no ha co vi "nen da nuot byte anh em", ma CHINH TASK 3 vua xoa bo tinh trang do.
  Vi tu moi (MOT ban cai dat, hai nguoi ghi goi chung): ha co khi khong quet duoc ho giu GPU · co
  tan du that · ANH EM tren card ma BYTE CHUA DUOC TINH (khong ai thang bau, hoac so chung IM) ·
  nen nhan nuoi qua cu · nguoi chup khai chua xac minh. Co la HE QUA DAN XUAT cua danh sach ly do
  => khoan tru 1.024 MiB THOI MO COI (baselineUnverifiedReasons ra o ket qua + vram_events + warn).
  ⚠ Ban dau cua chinh ban va nay SUYT phat oan MOI cai dat MOT-TIEN-TRINH — cau hoi "byte anh em da
  duoc tinh chua" chi duoc hoi khi CO anh em (ca F-5).
★★★ BAI HOC QUY TRINH NANG NHAT: ban va D-2 cua vong truoc KHONG LOT VAO COMMIT b625f89d — file bi
  hoan nguyen giua luc sua va luc commit, nen commit do CHUA DUNG BAN LUOI GIA trong khi bao cao
  khai da sua. Luot QUET KIEU la thu DUY NHAT bat duoc.
  ⇒ "DA SUA" CHI DUNG KHI `git show <commit>:<file>` XAC NHAN.
Task 3: quet "luoi gia" — 6 cho sai kieu, DUNG 1 la luoi gia that su (D-2: 6 o sai ten =>
  -Infinity === -Infinity - 1GiB la TRUE => xanh duoi MOI dot bien). Con lai: 7 diem goi
  commit(lease.id,...) khi ham nhan VramLease => no-op im lang; refusal.test.ts CHUA BAO GIO khai
  foreignLedgerBytes => cau M-6 cua Task 2 KHONG CO LUOI NAO.
Task 3: NO — ⚠⚠ tsconfig loai tru moi *.test.ts, no TOAN REPO, chua tra (de xuat: mot buoc CI chay
  tsc tren config phu file test) · co VAN co the `false` thuong truc trong topo CO SIDECAR:
  vramGpuHolders xep llama-server.exe cua tien trinh anh em vao `orphans` chu khong phai `peers`
  (vramGpuHolders.ts:428) => Quyet dinh 2 go duoc hang so cho api+worker KHONG sidecar, CHUA go cho
  topo CO sidecar — Task 4 cham dung dan so nay · tran 8-model nay DA KHAI nhung CHUA AI CANH.

## Task 4 — Nhận nuôi giấy phép mồ côi + dọn hàng của tiến trình đã chết (§6)

- [x] Bước 1 — đọc mã. **BA DÂN SỐ GOM VỀ MỘT VỊ TỪ** `trangThaiTienTrinh()`:
      `ctime(pid) > bootMs` ⇒ PID đã được HĐH CẤP LẠI ⇒ người viết hàng đã chết.
- [x] Bước 2-5 — đỏ → cài đặt → xanh. `vramAdoption.ts` MỚI (module LÁ, thuần) +
      `readProcTable()` tách cửa riêng + `adoptLease()` (KẾ TOÁN, không đi qua `reserve()`).
- [x] Bước 6 — đột biến: **9 lượt, CẢ 9 BỊ GIẾT** (4 lượt brief bắt buộc đều đỏ).
- [x] Bước 7 — nghiệm thu SỐNG (sidecar llama-server 7,8 GB THẬT, DB thật): **ĐẠT**.
- [x] Bước 8 — commit `7ae4ac3b` + `67fecfbd`.

Báo cáo: `task-4-report.md` (cùng thư mục).
Task 4: complete — 7ae4ac3b + 67fecfbd, 655/655 (36 file), shuffle 3/3, tsc sach.
★★ NGHIEM THU SONG DAT (sidecar llama-server THAT, pid 35420, DB that, nhanh Drizzle that):
  A sinh sidecar roi CHET => nvidia-smi 1.295 -> 9.120 MiB (7.825 MiB).
  B (all:28124:1785896434986, pid+bootMs MOI) mot nhip: don 2 HANG MA cua "worker:999999:1"
  (lease 17.000 MiB + vram:baseline 1.000 MiB), NHAN NUOI pid 35420 =>
  **GIAY PHEP DUNG LAI = 8.205.107.200 BYTE (7.825 MiB)**, len bang vram_leases.
  nen = 1.360.003.072 B (1.297 MiB, "captured"), baselineVerified=TRUE, reasons=[],
  drift=0, alarm=false. Giet DUNG pid => 9.122 -> 1.289 MiB => nhip sau NHA giay phep + XOA hang.
  ⇒ CUA RA SO 4 CUA PHA 3 DAT.
★★★ NGHIEM THU SONG BAT DUOC MOT KHUYET TAT KHONG SUY LUAN NAO THAY (luot dau, pid 38600):
  lenh `delete` chi duoc XEP HANG (bat buoc — reserve() dong bo), nen **chinh nhip vua CHUNG MINH
  may hang kia la MA** van dem 17.000 MiB ma di tinh lech: LECH -16.671 MiB + alarm=true + mot dong
  `drift` vao DB, VA `captureVramBaseline()` van NHAN NUOI nen cua dung tien trinh da chet
  (baselineOrigin="adopted"). => `loaiHangDaChungMinhLaMa()` vut hang ma khoi BAN SAO NGAY trong
  nhip (khong cham bo dem hong, khong lam ban sao tre lai). Ca D-9 khoa.
  BAI HOC: **mot nhip khong duoc vut di bang chung cua chinh no.**
★ Khuyet tat thu HAI cung do nghiem thu song: cau canh bao in "1 TAN DU ... tat chung THEO DUNG PID"
  NGAY CANH "Nen van XAC MINH DUOC" — hai ve mau thuan. Nay tach hai cau theo hai HANH DONG. Ca D-10.
★★ DAN SO 3 DA DONG: ve `orphans` cua `baselineVerified` nay hoi CAU THU HAI ("byte cua ho da duoc
  tinh chua") — dung khuon Quyet dinh 2 da lam cho `peers`. Do duoc LIVE: co san sidecar mo coi tren
  card van `verified:true reasons:[]`. Phan loai xac nhan bang do: sidecar mo coi nam o `orphans`
  (ours=0 peers=0 orphans=1 thirdParty=21), KHONG sua duoc bang classifyHolders — phai sua o cau hoi
  thu hai. ⚠ DINH CHINH BRIEF: `classifyHolders` xep sidecar cua ANH EM CON SONG vao `peers` dung
  (ca reconciler.baselinePids.test.ts:585 khang dinh); dan so that la sidecar cua tien trinh DA CHET
  (hoac cua anh em nhung cha da chet) — cung hau qua, khac cua vao.
Task 4: 9 dot bien, CA 9 BI GIET. M1 bo nhan nuoi => 7 ca do · M2 bo thu hoi-khi-chet => 2 ca ·
  M3 loc bang pid BO bootMs => 2 ca (A-3/A-4: CUNG VAI + CUNG PID, chi bootMs phan biet) ·
  M4 ho da co chu van bi xep tan du vo chu => 2 ca · M5 bo so ctime cua lease nhan nuoi => 1 ·
  M6 bo hang nen khoi ke hoach => 1 · M7 procs=null van ket luan chet => 3 · M8 bo ve CONG => 2 ·
  M9 xoa ca hang cua CHINH TA => 1.
Task 4: RANH GIOI voi `MocCaiChet` giu bang CAU TRUC (khong phai ky luat): giay phep sidecar cua
  chinh ta mang owner="sidecar:vision" => pidTuOwnerNhanNuoi() tra null => KHONG nam trong
  leaseNhanNuoi => duong do PID khong co cach nao cham toi no. Chi ho MO COI THAT di qua do PID.
Task 4: NO (co dia chi, xem §8 bao cao): ho nhan nuoi CHUA CO NGUOI THI HANH THU HOI (reclaimer co y
  de trong — khai "vision-sidecar" la HUA NGUOC vi stopSidecar() chi giet duoc proc cua chinh ta;
  Task 5 tra) · CHI MOT ho nhan nuoi duoc (sidecar thi giac, co CONG co dinh; trainer/finetune/plugin
  chay lenh TUY Y, khong cong, uoc luong khong nguon => khong nhan nuoi, van hi co) · byte nhan nuoi
  la UOC LUONG CAU HINH khong phai so do (WDDM tra [N/A]) · tat VRAM_GPU_HOLDER_SCAN la tat LUON viec
  don hang MA + nhan nuoi · **readProcTable() HONG THOANG QUA duoi tai: 4 luot lien tiep tra null
  trong ~500 ms (KHONG phai qua han) ngay sau 3 luot chay bo test + tsc; may ranh thi 370 hang trong
  478 ms** => mot nhip bi lo, chua co co che thu lai trong cung nhip · nhanh Drizzle VAN 0 ca test
  (lenh delete hang MA cua tien trinh KHAC chi kiem bang nghiem thu SONG) · **chua co cuoc bau cho
  luot nhan nuoi**: hai tien trinh cung thay mot ho VO CHU se cung nhan nuoi trong cua so <=60 s
  (dem HAI lan = chieu CHAT, roi hoi tu) — chua co ca test · VRAM_SIDECAR_TTL_MS van CHUA ai tieu thu.
Task 4: CHI PHI — `readProcTable()` do duoc **400-1.500 ms** tren may nay hom nay (docstring cu ghi
  316-341 ms; may nay dang co **370-371 tien trinh**). Cong chi phi o __runReconcileTick: cai dat MOT
  tien trinh + nen da xac minh + so chung im => **KHONG quet** (chi phi y het truoc Task 4).
Task 4: GOTCHA — `vi.resetModules()` GIUA MOT FILE TEST lam `await import("./vramBroker")` BEN TRONG
  ma san xuat tra ve mot BAN SAO KHAC cua so so voi ban ca test dang doc => 4 ca nhom D do mot luot.
  Luoi doi chieu cong (can resetModules) phai o FILE RIENG (`adoption.port.test.ts`) — cung bai hoc
  "seam phai o FILE RIENG" cua Task 1.
Task 4: complete — 7ae4ac3b + 67fecfbd, 655/655 (36 file), shuffle 3/3. CUA RA SO 4 DAT.
★★ NGHIEM THU SONG (sidecar llama-server THAT, DB that; A sinh sidecar roi CHET, B co pid+bootMs MOI):
  nvidia-smi 1.295 -> 9.120 MiB (7.825 MiB) · phan loai do duoc ours=0 peers=0 orphans=1 thirdParty=21
  · MOT NHIP cua B: don 2 HANG MA cua worker:999999:1 (lease 17.000 MiB + vram:baseline 1.000 MiB)
  => GIAY PHEP DUNG LAI = 8.205.107.200 BYTE (7.825 MiB), owner "sidecar:vision#nhan-nuoi-pid=35420"
  · nen 1.360.003.072 B ("captured"), baselineVerified=TRUE, reasons=[], drift=0, alarm=false
  · giet DUNG pid => 9.122 -> 1.289 MiB => nhip sau NHA giay phep + XOA hang.
  9 dot bien, CA 9 BI GIET (gom M3 loc bang pid bo bootMs — dot bien tung song sot o Task 2; cap
  fixture nay CUNG VAI + CUNG PID, chi bootMs phan biet).
★★ BAI HOC: nghiem thu song bat duoc mot khuyet tat KHONG suy luan nao thay — lenh `delete` chi duoc
  XEP HANG, nen chinh nhip vua chung minh hang la MA van dem 17.000 MiB ma di tinh lech (-16.671 MiB
  + alarm + mot dong drift vao DB) VA van nhan nuoi NEN cua dung xac chet.
  ⇒ MOT NHIP KHONG DUOC VUT DI BANG CHUNG CUA CHINH NO.
Task 4: DINH CHINH BRIEF CUA CONTROLLER — classifyHolders xep sidecar cua anh em CON SONG vao `peers`
  la DUNG (ca reconciler.baselinePids.test.ts:585 khang dinh). Dan so that la sidecar cua tien trinh
  DA CHET; cung hau qua, khac cua vao => cho sua la CAU HOI THU HAI, khong phai vramGpuHolders.ts:428.
Task 4: NO -> Task 5: ho nhan nuoi CHUA CO nguoi thi hanh thu hoi (`reclaimer` co y de trong; khai
  "vision-sidecar" la HUA NGUOC) · chua co cuoc bau cho luot nhan nuoi (hai tien trinh cung nhan nuoi
  trong <=60 s: dem hai lan = chieu CHAT roi hoi tu, chua co ca test).
Task 4: GOTCHA — readProcTable() hong thoang qua duoi tai: 4 luot lien tiep tra null trong ~500 ms
  (KHONG phai qua han) ngay sau 3 luot chay bo test + tsc; may ranh thi 370 hang/478 ms. He xu dung
  (khong bang chung => khong hanh dong) nhung MAT MOT NHIP; chua co thu lai trong cung nhip.
  Va: vi.resetModules() giua mot file test lam `await import("./vramBroker")` BEN TRONG ma san xuat
  tra ve BAN SAO KHAC cua so => seam can resetModules phai o FILE RIENG.

## Task 5 — `preempt()` xuyên tiến trình + trả nốt nợ Pha 2B (§ cuối Pha 3)

- [x] Bước 1 — đọc mã + brief + sổ theo dõi; liệt kê 6 hộ `background` và 6 nơi tiêu thụ vị từ.
- [x] Bước 2-5 — đỏ → cài đặt → xanh. `vramDefer.ts` MỚI (module LÁ) + `"orphan-pid"` +
      `thuHoiHoNhanNuoi()` + `holderFactFromSharedRow()`.
- [x] Bước 6 — đột biến: **9 lượt, CẢ 9 BỊ GIẾT** (3 lượt brief bắt buộc đều đỏ).
- [x] Bước 7 — nghiệm thu SỐNG hai tiến trình THẬT (sidecar llama-server 7,8 GB, DB thật): **ĐẠT**.
- [x] Bước 8 — commit `49af5c00`.

Báo cáo: `task-5-report.md` (cùng thư mục).
Task 5: complete — 49af5c00, 692/692 (37 file), shuffle 3/3, tsc sach, i18n:check 0 lech.
★★ NGHIEM THU SONG DAT (hai tien trinh THAT, sidecar llama-server 7,8 GB THAT, DB that):
  A sinh sidecar pid 35232 roi CHET => nvidia-smi 1.121 -> 8.947 MiB.
  B (all:29948:1785900192273, pid+bootMs MOI) mot nhip: NHAN NUOI => giay phep 8.205.107.200 B,
  **reclaimer=orphan-pid** (Task 4 de trong o nay), refCount=0, ttlMs=900000.
  preemptCandidates reclaimable=true · preemptPlan -> orphan-pid.
  preempt(): planned=1 reclaimed=1 failed=0 **freedBytes=8.205.107.200 (94 ms)**.
  nvidia-smi 8.947 -> 1.118 MiB = **7.829 MiB THAT SU thu hoi duoc** (so voi 7.825 MiB theo SO —
  lech 4 MiB = nhieu desktop giua hai luot doc). vram_leases sau nghiem thu: 0 hang.
★★★ PHAT HIEN CUA BO TEST (lop loi "co che phong ve MOI vo hieu hoa co che CU", lan thu TU):
  cong eval kb-sync chay BEN TRONG runKbSyncNow() => DANG GIU chot don-luong `running`. Xep no vao
  "duong JOB NEN" (ngan sach 6 gio) => mot ca het gio va **CHIN ca sau do do theo**; moi luot thu
  lai cua chuoi hoan Task 6 roi vao `already_running`. => cong eval dung ngan sach cua "duong CO
  NGUOI DOI" (mac dinh 0): hanh vi y het truoc, cong them VET.
★★★ XAC MINH LAI `refCount` xuyen tien trinh (brief doi): **race 0->1 KHONG TON TAI tren dan so ma
  nguoi thi hanh moi cham toi**. Ly do la CAU TRUC: preemptPlan() duyet `ledger` CUC BO va KHONG
  duyet foreignLeases (Task 5 co y khong dua hang anh em vao preemptable); rieng ho NHAN NUOI thi
  refCount=0 vinh vien (tien trinh tung dinh tuyen toi no DA CHET; setLeaseRefCount chi duoc goi
  cho `proc` cua CHINH ta, ma ho do mang owner="sidecar:vision" khong co dau #nhan-nuoi-pid=).
  ⚠ No con lai co dia chi: ai dua foreignLeases vao preemptPlan() thi race quay lai NGAY va khong
  ca nao do — cho phai sua luc do la `xepThuTuNhuong`.
Task 5: ★ DIEU KIEN RA SO 5 DAT KHONG DEU, khai thang: 3/6 ho CHO THAT (kb-sync, hai trainer),
  3/6 ho KHONG CHO (cong eval, reranker, embed-ctx) vi chung nam tren duong CO NGUOI DOI — chung
  khong chan (suy giam tai cho) va nay CO VET, nhung chung khong hoan. Ve thu hai cua dieu kien
  ("trainer khong con bi danh that bai") **DAT**, co ca di qua duong san xuat that.
Task 5: 9 dot bien, CA 9 BI GIET. M1 nguoi thi hanh noi doi => 3 ca (E-3/E-4/E-7) · M2 trainer NEM
  thay vi HOAN => 2 ca · M3 cau tu choi bo sot ho anh em => 2 ca (W-3b/W-3c) · M4 reclaimable quen
  ve NHAN ROI => 6 ca · M5 giay phep nhan nuoi khong khai reclaimer => 3 ca · M6 bo ve `docDuoc`
  => 3 ca · M7 nuot loi tu choi khi qua day => 6 ca (co MOT ca CO TRUOC: enforcement.callsites
  "reranker: tu choi KHONG dong cua vinh vien") · M8 ho anh em mat processKey => 2 ca · M9 doc
  `null` thanh danh sach rong => 1 ca.
Task 5: QUET LUOI GIA (tsconfig phu) — 1 LUOI GIA THAT: `sharedLedger.test.ts:525` dung
  `SharedLedgerFact` bang TAY thieu `foreignHolders` (dung loi canh bao co san o
  __freshSharedLedgerFactForTests: "nam ban sao viet tay se troi khoi nhau ngay khi kieu them mot o").
  Con lai: 2 artefact kieu cua ca MOI (da sua) + threeOutcomes.test.ts:1274 (artefact CU, khong sua).
Task 5: NO (co dia chi, xem §10 bao cao): nua "that bai trung thuc" cua nghiem thu song CHUA CHAY
  (can Linux/WSL + `trap '' TERM`; da khoa bang E-3/E-4 di qua ham san xuat) · preempt() KHONG
  nhuong duoc cho cua mot tien trinh anh em CON SONG (chi ho MO COI DA NHAN NUOI) · refCount cua
  hang so chung van co the cu toi 60 s, chay vao NHAN reclaimable cua cau tu choi · nhanh Drizzle
  VAN 0 ca test · readProcTable() hong thoang qua duoi tai (no Task 4, khong dung) · tsconfig loai
  tru moi *.test.ts (no TOAN REPO, chua tra) · ngan sach hoan VAN khong song qua khoi dong lai o
  cai dat khong DB — chi khac la nay no KEU · VRAM_DEFER_BUDGET_HOURS / VRAM_DEFER_REQUEST_BUDGET_MS
  chua co trong .env.example · o trang thai hoan co tran 64 muc.

## Lượt vá sau review TOÀN NHÁNH — 1 Critical · 2 Important · 5 Minor

- [x] **C-1** (Critical) — `thuHoiHoNhanNuoi()` giết nhầm PID cấp lại rồi khai thành công. Commit
      `f6f80158`. Ba ca ĐỎ trước khi vá: `E-10` PID cấp lại (khác `ctime`) · `E-11` pid vắng hẳn ·
      `E-12` không đọc được bảng tiến trình. **E-11/E-12 đỏ đúng ở LỜI KHAI** (`expected true to be
      false`), tức bộ ca chạm đúng nửa nguy hiểm nhất. Kèm m-3 + m-5.
- [x] **(4)** — khoá đột biến `foreignLeases` vào `preemptPlan()` đã sống sót 692/692. Commit
      `2b2034f1`, ca `G-1`. **Đã tự chạy lại đúng đột biến của người review: 695 xanh / 1 ĐỎ, và ca
      đỏ đúng là G-1**; khôi phục `git checkout -- server/services/vram/vramBroker.ts`.
- [x] **I-1** (Important) — hộ của ANH EM nuốt câu M-4 của `kb:sync`. Commit `34ae2318`.
      `KbSyncDeferHolder.processKey` (BẮT BUỘC) · `holderLine()` in `@role:pid:boot` + nhãn "TIẾN
      TRÌNH KHÁC giữ" · `trienVongText()` chỉ xét hộ cục bộ. 2 ca đỏ + 1 lưới chống đảo chiều.
- [x] **I-2** (Important) — ghi ràng buộc **"một DB = một thiết bị GPU"** vào migration 0312 +
      `drizzle/schema/vram.ts` + `vramSharedLedgerStore.ts`; sửa kế hoạch §5 (`edge` là dịch vụ C#,
      sidecar là tiến trình con không có broker). Commit `df65f885`. **KHÔNG sửa mã** (đúng brief).
- [x] **Năm Minor** — m-1 `daCongBo` mã chết (xoá) · m-2 `.env.example` thiếu 5 núm Pha 3 (thêm,
      kèm ràng buộc topo) · m-3 câu hứa *"tắt ĐÚNG pid"* · m-4 TS2493 cuối cùng · m-5 chú thích
      *"MỘT NGƯỜI GHI"*. Commit `df65f885` (m-3/m-5 ở `f6f80158`).

Kết quả: **699/699 (37 file)** · `tsc --noEmit` exit 0 · `i18n:check` 0 lệch ·
`git status --porcelain -- server/ client/ drizzle/ shared/` = **0 dòng**.
★ Sau m-4, `tsc` trên **config phụ CÓ file test** (`server/services/vram/**` + `kbSyncScheduler.ts`)
  nay **exit 0** — lưới đã kiểm là THẬT (khôi phục dòng cũ ⇒ TS2493 quay lại ngay). Đây là dòng
  cuối cùng từng chặn một bước CI `tsc` cho file test **của module này**; nợ TOÀN REPO vẫn còn.
★★ Ô 100,7 % của Đợt 2: ghi **"cơ chế đã dựng, ô CHƯA ĐO LẠI"**, KHÔNG ghi "đã giải" — không báo
  cáo nào chạy lại bảng roster Đợt 2 dưới Pha 3. Đã ghi thẳng vào kế hoạch (Điều kiện ra).
