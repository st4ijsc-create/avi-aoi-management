# SDD ledger — plan: docs/superpowers/plans/2026-08-04-vram-pha2b-cuong-che.md

Task 1: implemented d096060d — 257/257, live PASS (mo coi pid 2940 => baseline null, neu dung ten; tat theo dung PID => chup lai 1.090 MiB trung khit Pha 1; desktop tai day 15 ho, 0 duong tinh gia).
Task 1: complete — d096060d + fcafb0a1 + 5ed71fb0 + e82dedb7, 280/280 (243->257->268->275->280).
  Co che cuoi: XOA HAN collectAncestors/ANCESTOR_DEPTH; diem vao vai tro da khai + quan he cha-con
  MOT TANG co bang chung CreationDate; baselineVerified xoa khi co orphans HOAC peers.
  Tinh chat an toan: bien `ours` DONG THAT (cau truc, khong phai hieu chuan); `thirdParty` chi dung
  chung nao runsOurCode() khong bat sot.
Task 1: HAND-OFF CUNG cho Task 2/5 (N2-4): `baselineVerified` CHUA CO NGUOI TIEU THU nao ngoai
  server/services/vram/**. Task 5 khong doc no => Task 1 dung mot cai dong ho khong kim.
Task 1: NO mang sang (N2-2): duong DO cua Pha 2A van bi PID cap lai lua o chieu PID CHA => `seen`
  bi bat sai => co the commit(0)+recordActual(0) => learned=0. An toan HIEN dua vao max() cua §5.6c,
  KHONG dua vao la chan `seen`. Go max() la bien no thanh duong OOM.
Task 2: implemented — vramHeadroom.ts (computeHeadroom thuan+dong bo, KHONG import gi) +
  headroomInputFromTick + o tick `readLastReconcileTick()` (dong bo, khong goi lai dau do).
  302/302 (280->302), 2 luot shuffle xanh, tsc sach. 6 dot bien / 21 luot do.
Task 2: SAI LECH CO CHU DICH so voi brief — `baselineVerified` la truong BAT BUOC cua HeadroomInput
  (N2-4: tsc chan Task 5 quen no); ket qua them `trusted` + `degradedReasons` + `usedBytes`;
  computeHeadroom NEM khi dau vao khong huu han / dem am (NaN => cuong che tat IM LANG).
Task 2: CHUYEN TIEP CUNG cho Task 5:
  (a) o tick RONG VINH VIEN o tien trinh `api` (backgroundJobs.ts:11) => cuong che o do mu 100%;
  (b) tick CU khong het han — atMs co san, nguong tuoi la chinh sach cua Task 5 (duong sinh blind
      thu 12, chua nam trong danh sach 11);
  (c) `trusted` hien CHUA CO NGUOI DOC => N2-4 moi dong MOT NUA (so da toi cua quyet dinh, cua chua mo);
  (d) Task 5 phai kiem tran/dem MOT LAN luc nap module, dung de NaN toi duong nong.
Task 2: implemented 6cbc930d — 302/302. baselineVerified thanh truong BAT BUOC (tsc chan Task 5 quen). computeHeadroom NEM khi dau vao khong huu han. ★★★ O TICK RONG VINH VIEN o tien trinh api (startVramReconciler chi chay trong startBackgroundSchedulers, ROLE=api khong chay).
Task 2: VONG SUA 1 (review: 1 Critical ban giao + 4 Important + 6 Minor) — DA DONG CA 11 MUC.
  315/315 (302->315) + worker.smoke 318/318, shuffle xanh, tsc sach. 7 dot bien moi, deu co ca do.
  C-1: computeHeadroom KHONG CON NEM (nem tren duong reserve() bi vramWiring catch nuot => cuong che
    tat IM LANG + lease KHONG vao so => L hut => headroom PHONG DAI). Nay fail-closed CO TEN
    (-Infinity + ly do "invalid-input"); cho duy nhat duoc nem = assertHeadroomPolicy() luc BOOT;
    catch cua vramWiring nay CO TIENG.
  I-1: startVramReconciler() ROI khoi startBackgroundSchedulers() => index.ts (TRUOC nhanh re ROLE,
    api chay ring:false) + dau runWorkerProcess(). CHAY MOT NHIP NGAY (truoc do MOI vai tro mu tron
    60 giay dau — dung luc warm 30B 17 GB). Co CHUONG tach khoi co NHIP.
  I-2: them HeadroomInput.tickPresent => "no-tick" (cau truc) vs "probe-blind" (tam thoi).
    Dot bien cua reviewer (song sot 302/302) NAY DO.
  I-3: nhan da sua — tick CU khong phai duong blind; duong blind thu 12 la tickPresent:false.
    "Het han => vut A => null" la phep LAM LONG; chinh sach dung = GIU so + CONG bien theo tuoi.
  I-4 readonly toan bo VramReconcileResult · M-1 tran>0 · M-2 freeze · M-3 comment sai · M-4 neo
    kieu (chung minh bang dot bien tsc) · M-5 consecutiveFailures · M-6 bo 2 ep kieu.
Task 2: GOTCHA cho luot sau — khoi phuc dot bien bang replace(new, old, 1) LA MU: chuoi dot bien
  `ringEnabled = true;` da ton tai san o mot ham khac => khoi phuc SUA NHAM CHO => 22 ca do o 7 file.
  Bat duoc vi luon chay LAI TOAN BO bo test sau moi dot dot bien.
Task 2: VONG SUA 2 (VONG CUOI, re-review: SAN SANG DONG) — 315/315 + worker.smoke 318/318,
  shuffle xanh, tsc sach. Toan muc CHU + dung MOT quyet dinh vi tri.
  N-1: assertHeadroomPolicy() — CA HAI vi tri docstring cu chi dinh deu nam trong try/catch
    ("muc module vramBroker" chinh la cho da tu nhan bi NUOT; hom nay no "co ve chay" chi vi I-1
    keo vramReconciler len boot = TAI NAN THU TU IMPORT). Da ghi THANG: lop "hong SOM" HIEN KHONG
    DAT DUOC O DAU CA; ung vien duy nhat = import TINH o muc module diem vao => QUYET DINH CUA TASK 5.
  HA GIONG: "khong con duong nao cuong che tat VA so hut" => cau dung la "Task 2 khong CON DE RA
    duong do"; catch van return NOOP_TICKET, reserve() van ledger.set o cuoi, 3 lenh await import()
    van nem duoc truoc do => BA CUA AY NAY CO TIENG, KHONG PHAI DA DONG (Task 3 dong).
  N-3 (SUA): lượt bat reconciler cua worker chuyen tu DAU runWorkerProcess() xuong TRUOC
    startBackgroundSchedulers() = SAU khoi bau leader. Truoc do replica DANG CHO leadership se doi
    chieu VA DANH CHUONG suot thoi gian cho. Danh doi: replica cho => "no-tick" (dung: no khong cap
    phat gi). N-3 KHONG CO LUOI MAY — bang chung la doc ma + lap luan thu tu.
  N-2/N-4/N-5: chi GHI. N-2 = hai bay IM LANG cua ong dan su kien (bigint(mode:number) tu choi
    "-Infinity" => MAT CA LO; jsonb => JSON.stringify thanh null) — ban giao Task 3/4.
Task 2: complete — 6cbc930d + 212c2aea + baaf8c53, 315/315 (+318 voi worker.smoke).
  C-1 dong bang FAIL-CLOSED CO TEN (-Infinity + "invalid-input", khong bao gio NaN); cho duy nhat
  duoc nem la assertHeadroomPolicy() luc boot NGOAI try; catch cua wiring nay CO TIENG.
  I-1: startVramReconciler nhac ra khoi startBackgroundSchedulers, tach co TICK khoi co CHUONG,
  chay mot nhip NGAY (dong cua so mu 60 s dau — MOI vai tro deu dinh, ke ca all-in-one).
Task 2: HAND-OFF cho Task 3/4: -Infinity co HAI bay im lang o ong dan su kien —
  cot byte la bigint(mode:"number") => "-Infinity" bi Postgres tu choi => MAT CA LO su kien;
  `detail` la jsonb => JSON.stringify bien thanh `null` IM LANG. (drizzle/schema/vram.ts:43-48)
Task 2: HAND-OFF CUNG cho Task 5 (ba mon, cung mot hinh dang "so da toi cua, cua chua mo"):
  baselineVerified · trusted/degradedReasons · assertHeadroomPolicy() — deu CHUA CO NGUOI DOC.
  Va: lop "hong SOM" hien KHONG dat duoc o dau ca (moi vi tri kha di deu trong try/catch).
Task 2: ba cua `await import(...)` o vramWiring.ts:548-550 nay CO TIENG, KHONG phai DA DONG.
Task 3: implemented 280d3320 — vramLoadOutcome.ts (BON BUOC §5.5: driver_refused · retry · degraded
  · refuse) + warmModel het nuot + sanitize ong dan su kien. 355/355 (315->355), 2 luot shuffle
  xanh, aiGgufEngine* 87/87, ke ben 491/491, tsc sach. 2 dot bien / 2+19 ca do.
Task 3: ★★★ NGUYEN NHAN THAT cua 0/24 — `isOom` duoc viet theo cai NGUOI DOC THAY TRONG LOG, khong
  theo cai CHUONG TRINH NHAN. Dong `ggml_backend_cuda…cudaMalloc failed: out of memory` ma MOI bao
  cao Dot 1/Dot 2 trich dan la STDERR cua llama.cpp; JS nhan dung ba chu `Failed to load model`
  (LlamaModel.js:593, `model._model.init()` tra false). Ba chuoi THAT khac cung truot:
  `Not enough VRAM to fit the model…` · `…too large for the available VRAM` · `Failed to create context`.
Task 3: bay -1 XAC NHAN BANG MA THAT — resolveModelGpuLayersOption.js:23
  `Math.max(0, Math.min(totalLayers, gpuLayers))`. Duong vao CO THAT va mo cho admin:
  aiGgufRouter.ts:51 `gpuLayers: z.number().min(-1)`. Nay chan so am o cua + DOC LAI so lop that
  sau MOI luot nap ⇒ 0 lop la KEU, ke ca tren duong THANH CONG.
Task 3: giay phep chuyen so huu vao vramLoadOutcome — MOI luot thu MOT giay phep, luot hong tra cho
  trong `finally`. Truoc do driver tu choi ⇒ lease con treo ⇒ so cong du 17.000 MiB VINH VIEN.
  ★ Tac dung phu: evictLRU nay chay NGOAI cua so do ⇒ thoi la nguon delta-am ma vramWiring goi ten.
Task 3: ban giao (1) Task 2 DA DONG — hang rao dat o `logVramEvent()` (CUA VAO DUY NHAT cua hang doi,
  `queue.push` chi o do) ⇒ phu 20 diem goi hom nay + moi diem goi cua Task 4/5/6/7. Khong huu han ⇒
  THAY + GHI TEN; varchar qua rong ⇒ CAT + GHI TEN. KHONG vut su kien.
Task 3: ban giao (2) — ba cua `await import()` thanh import TINH + vramBeginFailureState() + su kien.
  ⚠⚠ CHI DONG NUA IM LANG. Nua "cuong che tat + so hut" KHONG thuoc Task 3: dong no = TU CHOI luot
  cap phat = CONG TAC CUONG CHE = TASK 5, va no nguoc chinh sach Pha 1 ma Task 3 khong duoc doi.
Task 3: HAND-OFF cho Task 5: `vramBeginFailureState()` CHUA CO NGUOI DOC (cung hinh dang
  "so da toi cua, cua chua mo" voi baselineVerified/trusted cua Task 2).
Task 3: ★★ SUYT TAI TAO LO ALIAS ma chinh bang lietke sinh ra de diet — `const begin = spec.begin ??
  beginVramAllocation; begin({…})` VO HINH voi may quet (khop TEN HAM), va WIRED_ALLOCATION_SITE_COUNT
  van XANH o 14 trong khi diem cap phat 30B bien mat khoi bang. Bien PHAI ten `beginVram`.
  14->15 diem goi, 159->160 dong.
Task 3: GOTCHA (lap lai lan 2, o file khac): `vi.resetModules()` KHONG go dang ky `vi.doMock`.
  3 ca DO khi chay ca file, XANH khi chay rieng. beforeEach phai doUnmock tung module.
Task 3: SUA TEST CU — `aiGgufEngine.test.ts` khoi "VRAM OOM fallback" khoa CHINH SACH CU va dung loi
  bang CHUOI STDERR ⇒ no XANH SUOT trong khi duong lui that chua bao gio chay. Da viet lai.
  Va: bien cho THAT (2×5.000 ms) lam ca "A. loadGgufModel NEM" het gio ROI RO SANG ca ke tiep
  (dem 2 loi goi thay vi 1) ⇒ dat VRAM_LOAD_RETRY_DELAY_MS=0 o 2 file test.
Task 3: MOI LO LON NHAT — nac lui CHUA BAO GIO chay tren PHAN CUNG THAT. Moi ca dung loi bang
  `new Error(…)`; ca doc node_modules khoa duoc CHUOI, khong khoa duoc DUONG DI (neu llama.cpp nem o
  `createContext()` sau khi model da nap thi loadWithVramOutcomes khong boc cho do).
Task 3: 5 ca do o server/services/programming/** (golden URScript/ROS2) la CUA VIEC KHAC —
  chung minh bang may: stash 6 file toi sua ⇒ van dung 5 ca do, cung ten.
Task 3: VONG SUA 1 (review: 0 Critical / 3 Important / 8 Minor) — DA DONG CA 11 MUC + nua lap luan
  bi bac. f928b342 + eeee81dd. 365/365 (355->365), shuffle xanh, ke ben 501/501, tsc sach.
  3 dot bien moi, deu co ca do.
Task 3: I-2 LA LOI NANG NHAT TOI DE LAI — KHONG luoi nao buoc su kien toi ONG DAN THAT.
  Reviewer doi `emit` mac dinh thanh ham RONG => 355/355 VA 87/87 VAN XANH. Ca bang sao-sao tiem
  `emit` vao de test gon, va toi khong hoi "vay ai canh cai day mac dinh?". => TAI TAO dung lop loi
  0/24 CAO HON MOT TANG, trong chinh task sinh ra de diet no. Nay co ca chay KHONG tiem emit +
  mock db + flush + doi thay driver_refused/retry/refuse trong lo db.insert().
Task 3: I-1 — DAU TU TO quan trong hon ban than loi: bang VRAM_EXHAUSTION_SIGNALS cua toi chua HAI
  chuoi CHI den tu createContext => bang duoc dung bang cach DOC `dist`, KHONG bang cach LAN duong
  di. Toi da co bang chung duong do ton tai NGAY TRONG BANG CUA MINH ma khong boc no.
  => Bai hoc: "doc ma that" la dieu kien CAN, KHONG DU — con phai hoi "throw nao TOI DUOC cho toi
  dang dung?". Bon duong: loadGgufModel.createContext (DINH ap luc VRAM: trong so 16,7 GB da tren
  card, gio moi xin KV cache) · ensureTextContext · getEmbeddingContext (con NOI SAI nguyen nhan:
  "Model does not support embeddings" trong khi that ra het VRAM) · fallbackNoRunner (do CHINH
  Task 3 de ra). noteVramAllocationFailure() KHONG doi mot nhanh dieu khien nao.
Task 3: I-3 — aiReranker gpuLayers -1 GHIM CUNG. Reviewer DO SONG dung file
  bge-reranker-v2-m3-Q8_0.gguf: -1 => model.gpuLayers===0 / totalLayers===25. Nay "auto" (KHONG
  "max": muc background phai chay cham hon chu khong duoc NEM). Kem: noi chu ky kieu tai cho
  (`gpuLayers?: number` chinh la thu lam -1 trong nhu lua chon duy nhat de noi "tat ca cac lop"),
  + ca quet THEO LOP (bat ky gpuLayers AM nao moi xuat hien trong server/** deu do).
Task 3: (C) toi DUNG MOT NUA — nua cuong che la Task 5, nhung nua KE TOAN khong can tu choi ai.
  vramBeginFailureState() nay co unledgeredBytes + unknownCount TACH RIENG (cong 0 gia cho luot
  "khong biet" la de cuon so hut TU KHAI LA DU). ⚠ Day la UOC LUONG, khong phai so do: fileBytes
  cua model 30B THAP HON VRAM that (chua gom context + compute buffer) => Task 5 phai biet no la
  CAN DUOI.
Task 3: (D) lop alias VAN MO, nay DO DUOC: doi ten bien => 3 do (rang buoc co hieu luc), nhung them
  diem cap phat MOI qua mot luot nhap-doi-ten => 12/12 XANH. Da ha giong docstring; KHONG co dong
  lop o day (Pha 2A: quyet dinh thanh vien bang quet van ban la KHONG QUYET DINH DUOC).
  ⚠ Task 5 KHONG duoc dung WIRED_ALLOCATION_SITE_COUNT nhu mot bao dam.
Task 3: M-1 scrubDetail visited-set -> path-set (tham chieu DUNG CHUNG/DAG mat so IM LANG va khong
  duoc ghi ten — bo lam sach chong-im-lang tu de ra mot duong im lang) · M-2 cham tran do sau ghi
  ten · M-3 chuanHoaSoLop(NaN) co reason (ca test cu KHOA hanh vi im lang vao HOP DONG) ·
  M-4 hang doi day: dem + droppedBeforeThis tren su kien ke tiep · M-5 gguf-unavailable ->
  warm_skipped · M-6 ganNhan nem => su kien (khong thi la chan zero-gpu-layers-on-success MU dung
  luc can thay nhat) · M-7 ha giong · M-8 ghi pham vi.
  Them (khong ai yeu cau, cung lop): warm_skipped + 2 detail.reason moi da vao DANH SACH TU VUNG
  su kien o vramEventLog.ts — dung cho ma `baseline`/`measure_failed` tung vang mat.
Task 3: MOI LO KHONG DOI — nac lui VA bon duong I-1 van CHUA chay tren PHAN CUNG THAT. Reviewer ep
  duoc loi VRAM that o resolveModelGpuLayersOption:80 nhung KHONG co lap duoc luot nem o
  createContext. Va: doi aiReranker sang "auto" chua chay voi RAG_RERANKER_GPU=true tren may that.
Task 3: VONG SUA 2 (VONG CUOI, re-review: 1 Important + 5 Minor + 1 dinh chinh SO cua toi).
  72f33315. 369/369 (365->369), shuffle xanh, ke ben 136/136, tsc sach. 2 dot bien / 5 + 1 ca do.
Task 3: N-1 — LAN THU BA CUNG MOT HINH DANG, VA LAN NAY NAM BEN TRONG BAN VA CHO LAN THU HAI.
  Vong truoc toi dong day `loadWithVramOutcomes` (I-2) roi TRONG CUNG LUOT SUA them
  `noteVramAllocationFailure` voi DUNG cung hinh dang `?? logVramEvent` va KHONG dung luoi.
  Reviewer dot bien emit mac dinh cua no => 452/452 XANH. Nang hon: `noteContextFailure` — CAU NOI
  DUY NHAT cua ca bon duong I-1 — KHONG co mot ca nao. => Toi va bon duong im lang, va DUONG DAN VET
  cua chung chua tung duoc chung minh.
  ⇒ QUY TAC MANG SANG (nay nam trong docstring, khong nam trong tri nho): MOI KHI viet
  `?? <mac_dinh>` cho mot DUONG RA, cai mac dinh do LA MOT DAY, va day thi PHAI CO LUOI.
  Ba day / ba luoi, cung mot khuon: KHONG tiem emit, doi thay o db.insert().
  N-1b di DUONG THAT: loadGgufModel voi createContext nem loi het VRAM (dinh ap luc: trong so da
  nap xong, gio moi xin KV cache).
Task 3: N-4 — `"auto"` KHONG BAO GIO NEM (resolveModelGpuLayersOption nhanh chuoi ket bang `?? 0`).
  ⇒ I-3 (doi -1 -> "auto") moi HA TAN SUAT suy bien im lang tu "LUON LUON" xuong "moi khi thiet bi
  day", CHUA DIET. Thu diet duoc = DOC LAI model.gpuLayers. noteGpuLayersResolved() mang la chan
  zero-gpu-layers-on-success ra cho diem goi NGOAI §5.5 (hom nay: aiReranker).
Task 3: N-3 — cau loi noi "OUT OF VRAM" cho ca ca thieu RAM HE THONG => nguoi truc chay nvidia-smi,
  thay 30 GB trong, ket luan "so noi lao". CUNG LOP "chi nguoi truc di sai huong", KHAC TRUC.
  Bang tin hieu nay co cot scope (device-vram | host-ram | unknown). "unknown" la cau TRUNG THUC cho
  `Failed to load model`/`Failed to create context` — native nuot nguyen nhan, doan bua la VRAM
  chinh la cai sai vua noi.
Task 3: N-2 docstring khai "khong doi nhanh dieu khien nao" — dung 3/4, SAI 1/4 (getEmbeddingContext
  dung verdict de chon cau loi). Sua TAI CHO. · N-5 ba tu vao khoi tu vung (resolve-gpu-layers-threw
  KHONG PHAI phep do VRAM hong — ai dem measure_failed phai TRU no ra · non-finite-gpu-layers ·
  droppedBeforeThis) · N-6 tach unscrubbedPaths khoi nonFiniteFields ("cho chua duyet toi" KHONG
  PHAI "so hong"; gop la de Task 7 DEM THUA) · N-7 ca 6d try/finally + them `fs` vao doUnmock
  (LAN THU HAI gap gotcha doMock trong chinh file nay).
Task 3: ★★★ DINH CHINH SO CUA CHINH TOI — moi lo 3 vong truoc NGUOC DAU o ca duy nhat co so.
  GGUF 30B: fileBytes 17.690.497.440 B vs actualBytes DO DUOC 17.511.354.368 B ⇒ file CAO HON
  170,8 MiB (+1,02 %) ⇒ CAN TREN, khong phai can duoi. Nhung reranker NGUOC LAI 2,1 lan (292 do /
  606 file) ⇒ KHONG CO HE SO CHUNG. Toi da suy tu mot truc giac ("file chua gom context") thay vi
  tu so do.
  BAN GIAO Task 5 — hai chieu: AN TOAN = tru unledgeredBytes khoi du dia NHU THU DA TIEU, va de
  unknownCount>0 lam du dia MAT TIN CAY (khong phai lam no nho di — lam no KHONG DUNG DUOC).
  NGUY HIEM = dung lam tin dung/tran, HOAC doc unledgeredBytes ma BO unknownCount (moi ho ONNX/
  sidecar/gguf-context dong gop 0 BYTE vao o do, chung chi hien o unknownCount).
Task 3: (B) reviewer XAC NHAN wrap cua bon duong I-1 nam dung DUOI vong co failedCreationRemedy
  cua thu vien (LlamaContext.js:770 chi nem sau khi vong co CAN) ⇒ dat dung cho, khong giam len.
  (C) "auto" do duoc 25/25 lop, VRAM +742 MiB, va khoan do CO VAO SO.
Task 3: MOI LO CON LAI — bon duong I-1 co luoi MAY nhung chua co nghiem thu LIVE ·
  noteContextFailure van nuot loi nhap dong bang console.warn (GIOI HAN CAU TRUC: khong the ghi su
  kien khi module ghi su kien khong nap duoc) · lop alias van mo · "auto" => 0 lop moi duoc canh o
  aiReranker, diem goi MOI dung "auto" ma khong doc lai so lop se co dung lo do va KHONG luoi nao bat.
Task 3: complete — 280d3320 + f928b342 + eeee81dd + 72f33315, 369/369 (+136 ke ben).
  ★★★ PHAT HIEN GOC RE cua 0/24 (lat gia dinh song qua BA DOT): dong `cudaMalloc failed: out of
  memory` ma moi bao cao trich dan la STDERR cua llama.cpp, KHONG phai err.message — JS chi nhan
  "Failed to load model". isOom cu duoc CHEP TU LOG nen truot 24/24. Reviewer xac nhan qua 4 tang
  (LlamaModel.js:593 · AddonModel.cpp:115-175 · grep cudaMalloc toan dist = 0).
Task 3: QUY TAC mang sang (trong docstring, khong trong tri nho): moi khi viet `?? <mac_dinh>` cho
  mot duong ra, cai mac dinh do la MOT DAY — va day thi phai co LUOI. (I-2 dong 1 day, vong sua de
  ra day thu 2 khong luoi: dot bien 452/452 xanh.)
Task 3: DINH CHINH cho Task 5 — fileBytes NGUOC DAU o ca duy nhat co so: 30B file 17.690.497.440 vs
  do duoc 17.511.354.368 => file CAO HON 170,8 MiB = can TREN o ho chi phoi ngan sach; reranker
  nguoc lai 2,1 lan => KHONG co he so chung. An toan = tru khoi du dia nhu thu DA TIEU + de
  unknownCount>0 lam du dia MAT TIN CAY. Nguy hiem = dung lam tin dung/tran, hoac doc unledgeredBytes
  ma bo unknownCount (moi ho ONNX/sidecar/gguf-context dong gop 0 byte vao o do).
Task 3: NO — 4 duong I-1 co luoi MAY nhung CHUA co nghiem thu LIVE; `"auto"` khong bao gio nem
  (tra `?? 0` => am tham ve CPU khi thiet bi chat), moi duoc canh o aiReranker.
Task 4: implemented — vramRefusal.ts (thuan, dong bo) + ledgerHolders/preemptCandidates/
  refusalFactsFor o vramBroker + VRAM_REFUSED & VRAM_HEADROOM_UNKNOWN + 11 khoa i18n x 3 locale.
  398/398 (369->398), shuffle xanh, ke ben 465/465 + 24/24, tsc sach, i18n:check 0 lech.
  6 dot bien / 17 ca do.
Task 4: HAI ma loi CHU KHONG MOT — `headroomBytes` khong huu han (-Infinity + "invalid-input") thi
  khuon cau co {{availableMb}} buoc ta hoac IN -Infinity hoac BIA mot con so. VRAM_HEADROOM_UNKNOWN
  KHONG co o "con bao nhieu". (Cung khuon ENTITY_EXPIRED tach khoi ENTITY_NOT_FOUND.)
Task 4: MOI loi tu choi mang phan "KHONG quy trach nhiem duoc" — 4 hinh dang, chon theo muc nghiem
  trong giam dan: unknownCount>0 (uoc luong KHONG DANG TIN) > blind|chua-hoi (khong biet lon bao
  nhieu) > do duoc (used-ledger) > so giai thich het. CA BON ket bang MOT duoi duy nhat
  (`coverageTail`): "so moi bao 15/160 diem cap phat DA BIET, va chinh ban liet ke do la CAN DUOI".
  ⇒ Cau tu choi KHONG BAO GIO noi duoc "day la tat ca".
Task 4: `unledgered` la truong BAT BUOC kieu `… | null`, `null` = CHUA HOI (khong phai "khong co
  luot nao"). Ap quy tac `??` = DAY cua Task 3. Broker KHONG tu goi vramBeginFailureState() —
  vramWiring nhap vramBroker, chieu nguoc lai la vong nhap ⇒ Task 5 truyen vao.
Task 4: ★★ MOT LUOI CUA CHINH TOI SONG SOT DOT BIEN (#5, 240/240 xanh) — 3 assert "khong con {{"
  KHONG phan biet duoc hai the gioi, vi `{{` cung bien mat khi i18next DA DIEN GIAI no. Ep ra bang
  chung: ten ho "{{availableMb}}$t(errors.generic)" => cau ra "…Dang giu trong so: 1200Da xay ra
  loi=1 MiB…" ⇒ CUOP gia tri placeholder that VA NOI noi dung mot khoa i18n bat ky.
  ⇒ DINH CHINH cau SAI co san trong errorCodes.ts: "khong phai lo injection, skipOnVariables da
  chan" DUNG cho tham so TU DO (gia tri) nhung SAI cho khoa TU DIEN — o do `raw` di vao
  `defaultValue`, tuc thanh TEMPLATE, ma skipOnVariables khong phu template.
Task 4: GOTCHA — cong ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS=0 dem KY TU, ke ca vi du trong CHU THICH.
  Viet "new TRPCError(" trong docstring cua vramRefusal.ts => 2 ca do o appErrorCoverage.test.ts.
Task 4: `VramRefusedError` CHUYEN NHA types.ts -> vramRefusal.ts. Ban Pha 1 nhan 3 tham so roi va
  THIEU HAN ve "ai co the nhuong" (1 trong 4 thu §5.3 doi). git grep truoc khi doi: chi chinh no.
Task 4: HAND-OFF cho Task 5 — refusalFactsFor({request, headroomInput, headroom, unledgered}) la
  cua DUY NHAT; nhan CA HAI headroomInput+headroom vi `unattributed = usedBytes - ledgerTotalBytes`
  phai lay tu CUNG mot luot doc so. preemptCandidates() CHI LIET KE, KHONG loc refCount===0 —
  cau hoi "co duoc thu hoi lease dang cap phat giua chung khong" (§5.2) la quyet dinh cua Task 5.
Task 4: NO — VramRefusedError CHUA AI NEM, vramRefusalAppError() CHUA AI GOI ngoai test (cung hinh
  dang "so da toi cua, cua chua mo" voi baselineVerified/trusted/vramBeginFailureState).
  Chua co nghiem thu SONG (khong nam trong brief Task 4).
Task 4: VONG SUA 1 (review: 1 Critical / 4 Important / 8 Minor) — dong C-1 + I-1..I-4 + M-1/M-2.
  405/405 (398->405), shuffle xanh, ke ben 495/495, tsc sach, i18n:check 0 lech. 6 dot bien / 12 ca do.
Task 4: ★★★ C-1 — ban va dau dong THE HIEN, khong dong LOP. Mot luot quet THAY-THE MAU khong bao gio
  an toan truoc payload TU HUY (no khong quet lai): `{$t({availableMb}}` -> `{{availableMb}}` (cuop
  placeholder), `$$t(t(errors.generic)` -> `$t(errors.generic)` (noi khoa i18n), va
  `$$t(t(errors.VRAM_REFUSED_WITH_REASON)` -> TU THAM CHIEU => `i18n.t()` KHONG TRA VE, TREO tien
  trinh > 8 phut. Va lop nay con NGUYEN o tham so TU DO ma ban va dau khong dung.
  ⇒ Chua bang HAI LOP CAU TRUC: (1) du lieu KHONG BAO GIO nam trong `defaultValue` (SENTINEL, roi tra
  `raw` thang) — `defaultValue` la chuoi `res` di vao extendTranslation() tuc mot TEMPLATE, do la be
  mat nesting; (2) XOA CA MOT LOP KY TU `[{}$]` — moi cu phap i18next deu BAT BUOC chua mot trong ba
  ky tu do, nen S(x) khong dung noi cu phap nao VA S(S(x))===S(x) (BAT DONG) => payload tu huy mat
  han co che. Gia phai tra: ten ho co {}/$ mat dung may ky tu do.
Task 4: ★★ GOTCHA KIEM THU — mot vong lap/de quy DONG BO trong i18n.t() thi `timeout` cua vitest
  KHONG CAT DUOC (mot luong, khong diem nha); no chi treo runner. Ca "tu tham chieu" phai kiem TIEN
  DIEU KIEN tren HAM THUAN (chuoi da sach {}/$) TRUOC KHI render. Chung minh: dot bien B lam 5 ca do
  trong 0 ms, khong ca nao cham toi i18n.t().
Task 4: I-1 — cau noi SAI o hinh dang BINH THUONG NHAT: {bytes:5000MiB, unknownCount:0} (hinh dang
  thuong gap cua vramBeginFailureState) cho ra "chua phat hien khoan nao" trong khi so nam ngay trong
  facts. Nhanh "phat hien duoc" nay kich hoat theo MOT TRONG HAI duong (hieu used-ledger = SO DO,
  hoac unledgeredBytes = UOC LUONG) va cau NEU CA HAI con so. Khoa doi ten
  vramUnattributedMeasured -> vramUnattributedDetected (ten cu khai "do duoc" cho ca so uoc luong).
Task 4: I-2 — `null` BI DOC THANH 0 lan nua, trong chinh file dung de diet lop do: unattributedBytes
  === null (dau vao ban) roi thang xuong nhanh cuoi. `khongBiet` nay gom CA NAM dieu kien.
Task 4: I-3 — {{degraded}} truyen roi BO (khong khuon VRAM_REFUSED* nao dung). Them khong gian
  `errors.trust.*`: `trusted` = CHUOI RONG, `degraded` = cau ha giong tu mang {{degradedReasons}} —
  cach duy nhat trong khuon hien co de co loi ha giong CO DIEU KIEN. Kem chu giai "≈" + tong byte
  nhuong duoc vao khuon i18n. ⇒ CONG cho CA HO: moi tham so sinh ra phai duoc IT NHAT mot khuon dung
  toi — chinh cong nay bat tiep `preemptableMb` dang truyen-roi-bo.
Task 4: I-4 — vi tu `measured` co HAI ban cai dat, ban thu hai (preemptCandidates) KHONG CA NAO CHAM
  => dot bien o do SONG. Gop ve holderFactFromLease(); dot bien `measured = actualBytes !== null` nay
  lam do 2 ca.
Task 4: M-1/M-2 — luoi phai o tren TONG, khong chi tung so hang: hai ho 1e308 (deu huu han) => tong
  Infinity => "tong Infinity MiB", dung hinh dang roi vao bay bigint => MAT CA LO su kien. Va `?? 0`
  cu la mot DAY: no bien "khong cong noi" thanh "nhuong duoc 0 MiB" = noi NGUOC.
Task 4: NOI THANG — (a) chi nhan duoc mo ta cua M-1/M-2 trong 8 Minor; SAU muc con lai KHONG co noi
  dung nen KHONG sua duoc, khong tuyen bo "da sua ca tam". Tu soat them va co sua: 3 cho tai lieu tu
  mau thuan sau ban va. (b) Lop 1 (SENTINEL) KHONG co luoi may DOC LAP — voi lop 2 dang chay, payload
  da tro nen khong ca nao phan biet duoc. No la PHONG VE CHIEU SAU, KHONG phai hang rao da chung minh.
  Giu day + KHAI BAO, thay vi bo mot lop phong ve hoac dung mot luoi gia.
Task 4: 16b8d168 + e2b46f67, 405/405 (+495 ke ben), i18n:check 0 lech.
  ★★★ LO TIEM i18n: sanitizeFreeParams la MOT LUOT QUET => payload TU HUY tai tao cu phap SAU khi
  lam sach. Reviewer chay 3/3 bien the SONG, trong do mot bien the lam i18n.t() KHONG TRA VE
  (exit 124 @25s, treo worker >8 phut). Lop con nguyen o tham so TU DO. Be mat that: modelId trong
  DB, .env, ten tep .gguf.
  DONG LOP bang HAI lop cau truc: (1) du lieu khong bao gio nam trong defaultValue (SENTINEL);
  (2) xoa ca lop ky tu [{}$] => S(S(x)) === S(x) BAT DONG => payload tu huy mat han co che.
  Sau va: ca 4 bien the CAM, bien the treo nay 1 ms.
  ⚠ DINH CHINH cau SAI co san trong errorCodes.ts: "khong phai lo injection vi skipOnVariables" —
  DUNG cho tham so TU DO, SAI cho khoa TU DIEN (raw vao defaultValue => thanh TEMPLATE).
Task 4: KHONG DAT 2 muc, implementer noi thang: (a) chi nhan duoc mo ta M-1/M-2 nen KHONG sua 6
  Minor con lai va KHONG tuyen bo da sua (loi cua controller: viet "sua ca tam" ma chi ta hai);
  (b) lop SENTINEL khong co luoi may doc lap — phong ve chieu sau, KHONG phai hang rao da chung minh.
Task 5: commit 47d2a857 — CO MA, NHUNG BI NGAT GIUA CHUNG (agent het han muc tuan, reset 2026-08-07
  12:00 Asia/Bangkok). Trang thai da kiem boi controller:
  - cay lam viec SACH (243 muc ban cua viec khac, 0 du dot bien)
  - 444/444 xanh (405 -> 444, +39 ca moi)
  - rang buoc 4 DAT: git grep "temporary overflow" = RONG
  - rang buoc 1 DAT: `export function reserve(...)` — VAN DONG BO
  - ca 4 ban giao + assertHeadroomPolicy DEU co nguoi tieu thu san xuat
  ⚠ CHUA LAM: bo dot bien day du · NGHIEM THU SONG (bat buoc, 2 luot: bi tu choi VA duoc cap)
  · bao cao · REVIEW TASK 5 · re-review.
  ⇒ CUONG CHE DANG BAT TRONG MA MA CHUA DUOC CHUNG MINH. Khong trien khai truoc khi review.
Task 5: implemented 47d2a857 (ĐÃ PUSH) — BẬT CƯỠNG CHẾ. reserve(request, ctx) tu choi THAT:
  lease===null ⇔ wouldRefuse ⇔ refusal!==null; vramWiring NEM VramRefusedError. VAN DONG BO.
  444/444 (405->444), 2 luot shuffle xanh, tsc sach, i18n:check 0 lech.
Task 5: vramEnforcement.ts (MOI, thuan) — effective = headroom − bienTuoiTick − byteNgoaiSo −
  phuPhiMatTinCay. KHONG so hang nao CONG ⇒ bat bien effective ≤ headroom, them mot ly do bat ky
  thi con so chi NHO DI (ca test cho MOI tap con). Don vi mat-tin-cay 1.024 MiB = can DUOI do duoc
  cua nen thiet bi (996 MiB) — la mot BIEN, KHONG phai uoc luong phan khong thay.
  no-tick 2 don vi (cau truc, khong tu lanh) > probe-blind 1 (tam thoi) — MOI MUC MOT CHINH SACH.
Task 5: TICK CU la pham tru THU BA — GIU so + CONG bien theo tuoi (co TRAN 1 don vi), KHONG BAO GIO
  di qua attributableBytes=null. Toc do 1.592.005 B/ms × tuoi 60 s = 95 GB ⇒ bien khong tran bien
  "mot nhip doi chieu chet" thanh "tu choi 100% luot xin".
Task 5: §5.2 coTheNhuong() — production KHONG BAO GIO · nhan roi (refCount===0) HOAC muc thap hon.
  Thu tu: background truoc · nhan roi truoc · cu truoc. CHI LIET KE, khong tu thu hoi: reserve() DONG
  BO ma nha VRAM that la BAT DONG BO ⇒ nha so ma thiet bi chua nha = noi doi dung chieu OOM.
  Nguoi THI HANH duy nhat hom nay: vramLoadOutcome.reclaim() (chi duong GGUF).
Task 5: cong 2 — hang cho khoa do theo HANG HIEU LUC = rank + floor(cho/10s) ⇒ chong chet doi
  (hang tang vo han theo thoi gian cho); hoa hang ⇒ FIFO. Mac dinh background (mac dinh AN TOAN).
Task 5: ★★ BAI HOC DAT NHAT — tsc bat 10/12 diem goi CHI VI chung dung mot VramTicket rong (thieu
  truong moi). aiReranker KHONG dung ⇒ tsc XANH ⇒ HAI loi goi beginVramAllocation se NUOT loi tu
  choi im lang. Bat duoc nho CA QUET "moi file goi beginVramAllocation phai nhap isVramRefusal".
  ⇒ Trinh bien dich bat duoc DUNG nhung noi tinh co cham vao mot kieu da doi — KHONG phai "moi noi
  tieu thu". Bang vi tu dung chung KHONG thay duoc bang tsc.
Task 5: ★★ GOTCHA — `git checkout -- <file>` khoi phuc ve HEAD, khong ve "truoc dot bien". Luot dot
  bien DAU chay TRUOC khi commit ⇒ xoa sach ban sua Task 5 cua vramBroker.ts (119 ca do o luot ke),
  phai dung lai tu dau. ⇒ QUY TAC: COMMIT TRUOC, DOT BIEN SAU.
Task 5: 5 dot bien / 8 ca do — (1) thu hoi production: 1 do · (2) bo chong chet doi: 2 do ·
  (3) blind coi thiet bi trong: 3 do · (4) tick cu di qua null: 1 do · (5) catch cua wiring nuot
  loi tu choi: 1 do. Sau moi luot: checkout + chay lai TOAN BO = 444/444, cay sach.
Task 5: NGHIEM THU SONG DAT CA HAI LUOT (PID 32964, node that, khong vitest, RTX 5090 32.607 MiB).
  Tran 32.607 · nen 1.243 (smi, baselineVerified TRUE) · attributable 0 · du dia THO 31.583 ·
  bien tuoi tick 2 MiB · phu phi 0 ⇒ du dia HIEU LUC 31.581 MiB.
  LUOT A: xin 35.263.067.514 B (33.629 MiB) ⇒ VramRefusedError/VRAM_REFUSED, du BON thanh phan,
  so 0 MiB, vramBeginFailureState 0/0, nvidia-smi khong doi ⇒ KHONG byte nao len card. He VAN CHAY.
  LUOT B: nap model THAT Qwen2.5-Coder-1.5B (940 MiB file) qua dung duong san xuat, 12.352 ms ⇒
  so 1.724 MiB (cuda-backend THAT 432 + model THAT 1.292, ca hai process-delta), smi 1.243→2.876.
  [5] mot luot SUY LUAN THAT 288 ms ⇒ lease gguf refCount 0 = NHAN ROI (dong bo engine→so CHAY THAT).
  [6] LUOT A2 (so da co nguoi giu): xin 29.859 vs con 28.835 ⇒ tu choi, DANG GIU = cuda-backend 432
  (production) + model 1.292, NHUONG DUOC = CHI model 1.292 ⇒ ba quy tac §5.2 chung minh cung luc.
  [7] LUOT B2: xin 26.787 ≤ 28.835 ⇒ DUOC CAP (so 28.511, 3 giay phep) ⇒ KHONG phai "ham luon tra khong".
Task 5: ⚠ HAI nguyen nhan CUNG trieu chung "tien trinh thoat em giua luot nap model": (a) noi ong
  stdio (| tail) — dung canh bao cua brief; (b) MOI hen gio cua duong VRAM deu .unref() (quyet dinh
  Pha 2A) ⇒ vong lap su kien rong ⇒ node exit 0 giua chung. Kich ban song phai giu mot setInterval.
Task 5: rang buoc 4 DAT — git grep "temporary overflow" RONG o server/client/shared/drizzle/scripts/
  tools. Con lai chi o docs/spec/plan (trich dan no nhu thu can diet) + knowledge/chunks.jsonl (KB
  sinh tu dong, thuoc 243 muc ban cua viec KHAC).
Task 5: KHONG BAO DAM (11 muc, day du o task-5-report.md §5) — dang chu y: (1) phu phi mat-tin-cay
  la BIEN chu khong phai uoc luong phan ngoai so (15/160 diem, CAN DUOI); (2) KHONG thi hanh thu hoi
  o tang broker — ONNX/sidecar/trainer co ten trong "dang giu" nhung KHONG AI THU HOI DUOC ⇒ tu choi
  thay vi lay cho (Task 7); (3) chua nghiem thu song o cau hinh api+worker (nhanh THUONG TRUC cua san
  xuat: no-tick + unverified-baseline, phu phi 3.072 MiB, moi co luoi MAY).
Task 5: MOI LO cho Task 6 — kbSyncScheduler NAY NEM loi tu choi len nguoi goi; §5.4 (hoan, khong
  chan) chua co ⇒ tam thoi mot luot cron bi tu choi HONG thay vi HOAN.
Task 5: VONG SUA 1 (review: 1 Critical / 6 Important / 6 Minor) — cad50895. 460/460 (444->460),
  shuffle xanh, ke ben 166/166, tsc sach, i18n:check 0 lech. 4 dot bien moi, deu co ca do.
Task 5: C-1 — `running = true` -> `await beginKbSyncVram()` (NGOAI moi try, NAY NEM) ->
  `running = false` KHONG trong finally ⇒ MOT loi tu choi binh thuong chot co VINH VIEN: dong bo
  tri thuc chet toi luc khoi dong lai, moi luot sau tra "already_running" trong khi khong luot nao
  chay, anh chup KB ro tren dia, hop dong "never throws" vo. Nay: finally + loi tu choi thanh KET
  QUA (skipped/vram_refused + don anh chup). I-6: tu choi o cong eval KHONG con roi vao
  gate_exception (nhanh do restoreKbArtifacts() = LUI mot luot sync DA THANH CONG) — nay "skipped",
  giu KB moi, dung nguyen tac co san "eval-unavailable ≠ regressed".
Task 5: (A) unledgeredChargeBytes la bo tich luy CHI TANG, khong tran, va DEM HAI LAN tren worker
  (attributable = deviceUsed − baseline DA BAO khoi byte do) ⇒ hai luot hong cua khoi 30B = du dia
  am ⇒ TU CHOI 100% tren card TRONG. Nay: chi tru khi MU + kep 4 don vi (cung tran voi ong
  unknownCount — thu da duoc kep vi DUNG LY DO NAY). ⚠ Van KHONG co duong tra lai.
Task 5: ★★ (E + I-3) LOI TU CHOI VAN BIEN MAT O TANG TREN CAI CATCH DA KIEM. Ca quet cua toi hoi
  "file co nhap isVramRefusal khong" — CA HAI file lot deu CO. aiReranker: try bao CA HAI diem goi,
  catch dong _rankCtxFailed (cua MOT CHIEU) ⇒ mot lan thieu VRAM tam thoi = MAT reranker GGUF vinh
  vien + chan doan sai. aiGgufEngine.getLlama(): viet lai MOI loi thanh "node-llama-cpp is not
  available" ⇒ tu choi production MAT DANH TINH + nguoi truc di cai mot goi da co san.
  ⇒ BAI HOC: LUOI PHAI DI THEO DUONG THOAT, KHONG THEO FILE.
Task 5: (B) hai ca chong chet doi day dong ho bang BOI SO cua CHINH hang so dang kiem ⇒ ca TU THAM
  CHIEU: dot bien -> MAX_SAFE_INTEGER cho 0 DO / 17 xanh. Nay moc TUYET DOI 30 s + mot ca khoa dai
  dung duoc cua hang so. Dot bien lai: 3 DO.
Task 5: (C) cau tu choi HUA NGUOC — "co the nhuong … tong N MiB" trong khi khong co che nao lay
  duoc N MiB do. Them vi tu THU HAI coThiHanhThuHoi() (hom nay: chi gguf-model nhan roi = evictLRU)
  + VramHolderFact.reclaimable; tong CHI cong ho thu hoi duoc; cau chu tach HAI NHOM; sua nhan SAI
  "(muc thap hon X)" -> "nhan roi, hoac muc thap hon X".
Task 5: (F) assertHeadroomPolicy bat 1/4 ca va CA BA ca lot deu theo chieu NOI — moi o co mot luot
  loc rieng AN MAT BANG CHUNG truoc khi loi kiem nhin thay (VRAM_DEVICE_TOTAL_MB= ⇒ am tham ve
  32.607, nhanh kiem tran la MA CHET; VRAM_SAFETY_RESERVE_MB= ⇒ dem 0; VRAM_DISTRUST_UNIT_MB= ⇒
  TAT ca chinh sach suy giam). Nay kiem CHUOI THO cua .env cho ca ba bien; "dat roi de trong" = LOI
  CAU HINH; "0" TUONG MINH van hop le cho dem/don vi. M-3: VRAM_CEILING_MB (bien KHONG ton tai) ->
  VRAM_DEVICE_TOTAL_MB.
Task 5: SAI LECH CO CHU DICH (khai thang): (E) o reranker toi KHONG nem tiep ma tra null — nem
  khong chan them duoc luot cap phat nao (giay phep da tra) nhung GIET nac lui co san (rankWithGguf
  -> null ⇒ rerank dung reranker LLM; nem thi roi ve identity = te hon). Cua mot chieu da dong.
Task 5: KHONG DAT — chi nhan duoc mo ta cua M-3 trong 6 Minor; 5 muc con lai KHONG co noi dung nen
  KHONG sua va KHONG tuyen bo da sua (tien le Task 4 vong 1).
Task 5: VONG CUOI (re-review: SAN SANG DONG — 7/7 nhom DU, 0 Critical/Important moi) — 2dc1c31f.
  461/461 (460->461), shuffle xanh, ke ben 117/117, tsc sach, i18n:check 0 lech. 2 dot bien, deu do.
  N-1 runEvalHarness van khai "Never throws" trong khi NAY NEM CO CHU Y — va chinh ban va I-6 DUA
  VAO luot nem do (cung lop hop-dong-lech voi C-1, nguoc chieu). N-2 vet cua luot kb:sync bi tu choi
  la CONSOLE-ONLY (nhanh return som khong dung lastRunAt/lastRunStats, cron vut gia tri tra ve) =>
  bao cao §9#3 HUA HON CO CHE; nay ghi lastRunStats that + ca khoa. N-3 ly do cua ca ghim dai hang
  so chat hon lap luan 6 lan => viet lai cho khop con so.
  M-2 bien theo tuoi THUC TE la THUE PHANG 1.024 MiB (cham tran sau ~675 ms, nhip xuat ban 60 s =>
  >=98,8% thoi gian dung o tran) => du dia hieu luc ON DINH cua worker ~30.559 MiB, KHONG phai
  31.581 (so nghiem thu song la ca TOT NHAT). M-5 model nap xong chua tung dung = ung vien nhuong
  cho VO HINH (so giu refCount=1 toi luot dung dau) => dong bo ngay luc dang ky. M-6 tu choi muc
  production o duong OCR suy bien IM LANG => them TIENG, GIU luong.
Task 5: KHONG SUA (co ly do, khong phai bo qua): (a) M-6 khong doi recognizeSingleLine thanh NEM —
  ham khai "Never throws => degrade" va nam tren duong production; nem bien "mat mot dong chu" thanh
  "hong ca luot kiem" ma KHONG chan them byte nao (giay phep da bi tu choi). Thu thieu la TIN HIEU.
  (b) M-2 khong doi cong thuc bien theo tuoi — "thue phang" la he qua cua tran 1 don vi / toc do DO
  DUOC, ca hai deu co nguon. Nang tran = khoa them VRAM o MOI tien trinh co tick; ha toc do = bia
  mot con so khong do duoc. Cai sai la CAU CHU, va cau chu da sua.
Task 5: complete — 47d2a857 + cad50895 + 2dc1c31f, 461/461. CUONG CHE DA BAT VA DA CHUNG MINH.
  Nghiem thu song 4 luot: A tu choi (xin 33.629 > du dia, 0 byte len card, tien trinh chay tiep) ·
  B duoc cap (model that 12.352 ms, so 1.724 MiB, smi 1.243->2.876) · A2 (so da co nguoi giu:
  dang giu = backend production + model, nhuong duoc = CHI model => chung minh ca 3 quy tac §5.2) ·
  B2 duoc cap. ⚠ Du dia on dinh THAT = ~30.559 MiB (KHONG phai 31.581 — bao cao da sai, da sua).
  C-1 da vá: kb:sync bi tu choi => {skipped, reason:"vram_refused"} + lastRunStats.reason,
  running=false trong finally, KHONG lui mot luot sync DA THANH CONG o cong eval.
Task 5: BAI HOC — "luoi phai di theo DUONG THOAT, khong theo FILE" (ca quet hoi "file co nhap
  isVramRefusal khong"; CA HAI cho lot deu co, mot catch rong hon o tang tren nuot lai).
Task 5: HAND-OFF Task 6 — vet THAT cua luot bi tu choi la `lastRunStats.reason = "vram_refused"`
  (truoc do chi console-only; bao cao §9 tung hua hon co che). CHUA co lui dan, CHUA co day.
Task 5: HAND-OFF Task 7 — `coThiHanhThuHoi()` la vi tu DUY NHAT; `reclaimable` hep dung bang
  evictLRU(). Mo rong phai sua DUNG vi tu do, sua cho khac la cau chu va co che lai troi khoi nhau.
Task 6: complete — 4251c9ad, 489/489 (461 -> 489, +28 ca), shuffle xanh, ke ben evalGate 11/11,
  tsc sach, i18n:check 0 lech. HOAN-KHONG-CHAN (§5.4) DA CHAY: 15' -> x2 -> tran 60', day
  KB_SYNC_MAX_DEFER_HOURS=6h, luot thu 8 roi NGOAI ngan sach => defer_exceeded + canh bao NEU DICH
  DANH ai dang giu cho. Tin hieu "KB co the da cu" (getKbHealth().staleDays) DUNG LAI, khong phat
  minh bien bao moi.
Task 6: ★★ NaN LA HINH DANG CHET NGUOI cua mot cai DAY — `elapsed + delay > NaN` la `false` => nhanh
  "thu lai" => HOAN VO HAN, IM LANG, va no trong y het "hoan dung". Nhanh khong-huu-han vi vay la
  nhanh DAU TIEN cua planKbSyncDefer: NaN di thang vao `exceeded` (KEU), khong phai `retry` (IM).
  Cung chieu fail-closed voi `NaN <= x === false` o vramEnforcement.
Task 6: ★★ `holdersKnown` — isVramRefusal nhan dien bang Error.name (co y), nen mot loi mang dung
  ten ma KHONG mang `facts` van lot toi. Thieu o nay thi `holders: []` bi doc thanh "khong co ai
  giu" — bien "toi khong biet" thanh "toi da kiem va khong co gi". Dot bien: 1 do.
Task 6: ★★ LUOI THEO DUONG THOAT (bai hoc Task 5, ap dung truoc khi bi bat): luot thu lai roi vao
  `already_running` KHONG vu trang gi ca => chuoi hoan dung im vinh vien voi nextRetryAt da qua =
  mot luot kb:sync bien mat IM LANG. ensureDeferArmed() la luoi cho dung duong thoat do.
Task 6: QUYET DINH — `reason` GIU NGUYEN "vram_refused" cho ca "da hoan" lan "qua day" (no tra loi
  "vi sao luot nay khong chay"); "da hoan hay da bo" la cau hoi KHAC, o RIENG `defer.exceeded`.
  => ca C-1 cua Task 5 khong phai sua mot dong nao.
Task 6: QUYET DINH — qua day thi NGUNG thu lai TRONG CHUOI DO, va luot cron ke tiep MO LAI ngan
  sach. Noi tiep chuoi thi day 6 gio chi keu DUNG MOT LAN trong ca doi tien trinh roi cam.
Task 6: KHONG DAT / KHONG BAO DAM (khai thang): (1) getKbSyncSchedulerStatus() KHONG co nguoi tieu
  thu SAN XUAT nao — vet #1 la "may doc duoc nhung chua ai doc". (2) "canh bao" = console.error +
  mot dong vram_events, KHONG phai ban ghi trong he `alerts` (can DDL/DB — ngoai pham vi).
  (3) ngan sach hoan KHONG BEN qua khoi dong lai => vong khoi-dong-lai lap thi day KHONG BAO GIO
  cham va defer_exceeded KHONG BAO GIO keu. (4) chi kb:sync duoc hoan; 4 ho background khac van
  nem/suy bien — co che chua phai helper dung chung. (5) khong co nghiem thu SONG (doi 15'->6h dong
  ho that + kb:sync that ghi lai ~164 file knowledge/**, brief cam).
Task 6: RUI RO TROI da khai — vi tu "chuoi hoan con song khong" viet HAI LAN
  (`deferStreak !== null && !exceeded` vs `s.exceeded || s.nextRetryAt === null`); tuong duong nho
  mot BAT BIEN (`exceeded === (nextRetryAt === null)`) chu khong nho mot ham dung chung.
Task 6: HAND-OFF Task 7 — cau canh bao in `reclaimable` cua tung ho => no TU DONG DUNG THEO neu
  Task 7 sua dung `coThiHanhThuHoi()`, va TU DONG SAI neu sua cho khac.
Task 6 VONG SUA 1 (review: 0 Critical/3 Important/6 Minor) — 7ed2c1fd + 4c1d292b + 8606ee12.
  507/507 (489->507, 46 ca), shuffle xanh, ke ben 11/11, tsc sach, i18n 0 lech. 12 dot bien, deu do.
Task 6: I-1 chuoi hoan nay SONG QUA khoi dong lai. Bao cao ban dau NOI NHE hon su that:
  startKbSyncScheduler() KHONG vu trang lai => luot thu lai da hua KHONG BAO GIO NO, va trong vong
  khoi-dong-lai lap (docker restart: unless-stopped / tsx watch) defer_exceeded KHONG BAO GIO KEU.
  Nay: SELECT MOT dong vram_events (KHONG DDL, index owner da co) -> planKbSyncDeferResume() thuan,
  4 ket cuc; day da qua luc tien trinh chet => PHAT defer_exceeded NGAY + nhan recoveredAfterRestart.
  Moi dong meo mo => "none" (FAIL-CLOSED). Min M-3 co that o day: soHuuHan() ghi NHAN CHUOI "NaN"
  vao detail => Number() se cho NaN => hoan vo han im lang; soTuDetail() chi nhan number huu han.
Task 6: ** BAI HOC LON NHAT — CO LOP LOI MA THEM MOT CA KHONG GIAI DUOC, PHAI DOI KIEU.
  Dot bien D3 cua reviewer (nguoi TIEU THU tu viet lai vi tu, quen exceeded) song sot CA VONG 1
  du toi da rut ham dung chung + ghim 4 to hop: duoi bat bien "exceeded <=> nextRetryAt === null"
  hai cach viet TRUNG NHAU nen MOI ca hanh vi deu mu. Loi giai: DeferStreak thanh HAI BIEN THE,
  bien the "exceeded" KHONG CO truong nextRetryAt => ban sao thu hai KHONG VIET RA DUOC (tsc chan);
  lach qua tsc => undefined => armDeferTimer(NaN) => hen gio VAN vu trang => ca khoi phuc DO.
  Lan thu HAI trong pha nay loi giai dung la "lam cho sai lam khong bieu dien duoc" (lan dau:
  VramUnledgeredFact = {...} | null, Task 4). D3 sau vong 2: 6 DO.
Task 6: * TU DAM VAO BAY MINH VUA CHEP LAI — ca "duong boot co goi ham khoi phuc khong" cua toi
  QUET VAN BAN than ham; dot bien xoa dung loi goi van XANH vi chuoi ten ham con nam trong
  DOCSTRING ngay phia tren. Bai hoc "luoi di theo DUONG THOAT khong theo FILE" nam ngay trong bao
  cao ban dau CUA CHINH TOI. Da thay bang bang chung HANH VI (goi that startKbSyncScheduler(),
  dong ho THAT, do tac dung) => dot bien I1a: 1 DO.
Task 6: (B) luoi cho 7 luot GIUA chuoi la vet THUA KE (ca do nam o file ke ben, C-1 cua Task 5).
  Them ca khoa TUNG LUOT => dot bien cua reviewer nay cho 2 DO, mot trong do o file cua Task 6.
Task 6: (C) SU THAT CUNG HON toi viet — background la muc THAP NHAT va preemptable = "muc thap
  hon muc dang xin" => RONG THEO DINH NGHIA, VINH VIEN voi kb:sync => preempt() cua Task 7 CUNG
  KHONG gianh duoc byte nao cho no. Duong DUY NHAT la mot ho khac TU NHA. M-4: khi khong ho nao
  reclaimable, cau hoan noi thang "thu lai nhieu kha nang van bi tu choi, can nguoi can thiep" —
  MOT CAU, khong phai mot co che (rut ngan day theo mot o UOC LUONG la thu pha nay cam).
Task 6: (M-5) bang ho background dem THIEU — thuc te 6 diem/5 chu, thieu gguf-embed-ctx
  (aiGgufEngine.ts:3111, beginVram NGOAI try xu-cau-chu => cau loi ra THO). Hai ho dang lam truoc
  la localSidecarTrainer + aiLlmFinetuneSidecar: chung VO hop dong "Never rejects" => JOB HUAN
  LUYEN bi danh THAT BAI, phai chay lai tay. Hom nay hoan moi ap cho 1/6 ho.
Task 6: KHONG SUA (co ly do): I-3 (noi defer len mat suc khoe KB) — reviewer xep "Chua xep",
  dieu phoi vien khong giao, dung 2-3 file ngoai pham vi. NHUNG da DON DUONG: M-6 chinh la cai bay
  se no "dung luc I-3 duoc sua" (mot mat bi poll se AN MAT tieng keu cau hinh) — nay da dong.
Task 6: VAN KHONG BAO DAM — (1) getKbSyncSchedulerStatus().defer van chua ai doc; (2) khoi phuc MU
  o cai dat khong DB, va flushVramEvents() ghi theo LO nen mot lo chua kip flush luc tien trinh
  chet la mot lo MAT HAN; (3) chua co nghiem thu SONG nao; (4) chi 1/6 ho background duoc hoan.
Task 6: complete — 4251c9ad + 7ed2c1fd + 4c1d292b + 8606ee12, 507/507 (28 -> 46 ca).
  ★ BAI HOC: them ca test KHONG giai duoc bai toan "hai ban sao vi tu trung nhau duoi mot bat bien".
  Loi giai la DOI KIEU — bien the "exceeded" khong co truong nextRetryAt => ban sao thu hai KHONG
  VIET RA DUOC (tsc chan). Lan thu HAI trong pha nay loi giai dung la "lam cho sai lam khong bieu
  dien duoc" thay vi "viet them test bat sai lam".
  ★ Implementer TU DAM vao bay vua chep lai tu Task 5: ca "duong boot co goi ham khoi phuc khong"
  QUET VAN BAN => dot bien xoa dung loi goi van XANH vi ten ham con trong DOCSTRING ngay tren.
  Da thay bang bang chung HANH VI.
CONTROLLER DECISION: BO luot re-review rieng cho Task 6, gop kiem chung vao REVIEW TOAN NHANH.
  Ly do: bang chung vong nay manh bat thuong (12 dot bien, moi luot co ca do, hai bay tu bat);
  can giu du dung luong cho review toan nhanh. DAY LA DANH DOI, khong phai ket luan Task 6 da sach.
Task 6: NO — getKbSyncSchedulerStatus().defer CHUA AI DOC · khoi phuc MU o cai dat khong DB, va
  flushVramEvents() ghi theo LO nen mot lo chua kip flush luc tien trinh chet la MAT HAN ·
  hoan moi ap cho 1/6 ho background (2 ho trainer VO hop dong "Never rejects" => job huan luyen
  bi danh THAT BAI, phai chay lai tay) · CHUA co nghiem thu song.
Task 6: ⚠ SU THAT CUNG cho Task 7 — `background` la muc THAP NHAT va preemptable = "muc thap hon
  muc dang xin" => RONG VINH VIEN voi kb:sync => preempt() cua Task 7 CUNG KHONG cuu duoc no.
Task 7: implemented 766fdfce + c9c9fc51 + dcf402fa — §8 VE MOT MOI. 539/539 (507->536->538->539),
  shuffle xanh, ke ben 129/129, tsc sach, i18n:check 0 lech. 8 dot bien / 1 SONG SOT roi da va.
Task 7: enforceVramGuard XOA (tran -> vramCaps.usableCeilingBytes -> broker.deviceUsableBytes, nen
  reserve() can luot xin bang CHINH kich thuoc cua no) · ensureCapacity HAP THU thanh kheGgufConThieu
  (Đ4: thuoc DEM co cua RIENG, ly do RIENG "gguf-slot-cap", 0 don vi phu phi byte) · evictLRU HAP THU
  thanh vramPreempt.preempt() (thu tu §5.2, dung khi DU theo CA HAI thuoc) · readVramState thanh MA
  CHET, xoa (keo theo 1 dong chet o vramAllocationSites: 160 -> 159).
Task 7: ★★★ LOI CO THAT CUA BAN TASK 5 — vi tu `kind === "gguf-model" && refCount === 0` cong NHAM
  model cua aiReranker (nap qua backend RIENG, NGOAI loadedModels ⇒ evictLRU khong voi toi) vao
  "tong nhuong duoc" = HUA NGUOC. Nay khai theo DIEM GOI (`request.reclaimer`), va vi tu tra TEN
  nguoi thi hanh (VramReclaimerId) chu khong phai boolean ⇒ ban sao viet tay KHONG lai duoc luot thi
  hanh; NGUOI_THI_HANH la Record<VramReclaimerId,…> ⇒ quen cai dat = loi tsc. Lan thu BA trong pha
  loi giai dung la "lam cho sai lam khong bieu dien duoc".
Task 7: MO RONG preempt() = sidecar thi giac (ho LON NHAT he, 7,8 GB) khi NHAN ROI — duong thu hoi
  DA TON TAI (stopSidecar, chinh module tu goi khi het han nhan roi) + releaseProof "process-exit"
  (lop bang chung manh nhat repo). ONNX VAN KHONG (duoi cache chi go tham chieu JS; release() duoi
  chan mot session.run dang bay = ABORT native; ca ba diem con la production).
Task 7: ★★★ MOT DOT BIEN DA SONG SOT — go `reclaimer: "vision-sidecar"` o DIEM GOI SAN XUAT cho
  538/538 XANH va tsc sach, vi MOI ca tu dung ho sidecar bang tay ⇒ khong ca nao doc cai ma duong san
  xuat THAT SU gui di. Neu lot: mo rong lon nhat cua task thanh MA CHET, im lang. Lop "luoi di theo
  FILE chu khong theo DUONG THOAT" TAI DIEN LAN THU BA (Task 5 -> Task 6 -> day). Va: rut object ra
  mot ham thuan `visionSidecarVramRequest()` chi THU HEP be mat mu, KHONG dong no.
Task 7: GOTCHA (Task 5 tai dien tren dau toi) — `git checkout --` sau dot bien 7 XOA mot ban sua
  CHUA COMMIT (chinh ham vua viet de va dot bien do). Quy tac dung: commit MOI thay doi truoc khi
  cham `git checkout --`, khong chi "truoc luot dot bien dau tien".
Task 7: SAI LECH CO CHU DICH — GGUF_VRAM_GUARD_PCT giu TEN + giu CO CHE nhung MAC DINH 90 -> 100
  (tat). "90" nghia CU (nguong phan ung, hau qua = mot luot duoi roi VAN NAP) ≠ "90" nghia MOI (tran
  CUNG, hau qua = TU CHOI); giu 90 la lang le cat 3.261 MiB khoi MOI may, chong len
  VRAM_SAFETY_RESERVE_MB = bia mot bien an toan thu hai KHONG DO DUOC (dung thu Task 5 tu choi lam o
  M-2), va lam sai con so nghiem thu song ~30.559 MiB. Mac dinh 100 duoc KHOA bang mot ca kem ly do.
Task 7: ⚠ DINH CHINH BAN GIAO TASK 6 §7.3 — "preemptable rong VINH VIEN voi kb:sync" NOI QUA.
  coTheNhuong() co HAI duong: production KHONG BAO GIO · con lai `refCount === 0` HOAC rank thap hon.
  Cau dung: preempt() KHONG gianh duoc cho kb:sync tu ho DANG BAN; no CHI gianh duoc tu ho NHAN ROI —
  va do chinh la ca "mot ho khac TU NHA" ma Task 6 goi la duong duy nhat, khac o cho he nay CHU DONG
  don. KHONG dao nguoc ban giao: co che hoan van CAN (ca "moi ho dang ban" van cho ke hoach RONG), M-4
  van dung va van xanh. Hai ca khoa CA HAI CHIEU.
  ⚠ He qua can chu du an biet: mot luot cron kb:sync CO THE tat sidecar thi giac dang nhan roi de lay
  7,8 GB (sidecar tu khoi dong lai theo yeu cau ⇒ gia phai tra la mot luot khoi dong nguoi). Neu day
  la danh doi sai thi can MOT QUYET DINH CHINH SACH, khong phai go loi khai reclaimer.
Task 7: DIEU KIEN RA #7 DAT — `git grep "temporary overflow"` RONG o server/client/shared/drizzle/
  scripts/tools. Con lai: 3 file docs trich dan no NHU THU CAN DIET + knowledge/chunks.jsonl (KB sinh
  tu dong, thuoc 243 muc ban cua viec KHAC). Co LUOI BANG MAY quet de quy 6 thu muc ma — va no da bat
  CHINH TOI BA LAN (docstring cua ban va nhac lai cum do; git grep khong phan biet ma voi chu thich)
  ⇒ cum duoc GHEP tu hai manh luc chay.
Task 7: bon bien tran nay co MOT nguoi doc (vram/vramCaps.ts), doc LUOI + nho (khong `const` muc
  module: hon hai chuc bo test dat chung trong beforeEach), va ca bon qua cong cau hinh luc boot.
  recSessionCache (ocrService) tu Map KHONG GIOI HAN thanh LRU theo AI_SESSION_CACHE_MAX + tra giay
  phep khi duoi (truoc do so CHI PHINH, headroom CHI GIAM, khong bao gio hoi).
Task 7: ba khoa in-flight gop thanh MOT helper motLuotThoi() — KHONG hap thu vao broker (bai toan
  chong-lam-trung-viec, KHONG phai so huu bo nho; cung ly do vramMeasureLock da tu tach minh).
Task 7: KHONG BAO DAM (13 muc, day du o task-7-report.md §9) — dang chu y: (1) KHONG co nghiem thu
  SONG, ba duong thu hoi chua chay tren phan cung that mot lan nao; (2) dot bien 7 song sot ⇒ phai
  hoi con DIEM GOI nao khac ma luoi khong doc cai no that su gui di (releaseProof/ttlMs/
  configDefaultBytes cung hinh dang, CHUA KIEM); (3) tran DEM la mot nguon TU CHOI MOI, doi hanh vi
  thay duoc tu ngoai, chua chay thu voi .env that (GGUF_MAX_LOADED_MODELS=4); (4) preempt() khong tu
  tay release() giay phep cua nguoi khac ⇒ khong co co che nao phat hien nguoi thi hanh NOI DOI.
Task 7: complete — 766fdfce + c9c9fc51 + dcf402fa, 539/539.
  ★ Dot bien 7 TUNG SONG SOT: go `reclaimer: "vision-sidecar"` o diem goi SAN XUAT => 0 do,
  538/538 xanh. Da va. Implementer tu khai 3 cho CUNG HINH DANG chua kiem: releaseProof, ttlMs,
  configDefaultBytes.
  ★★ DINH CHINH ban giao Task 6: "preemptable rong vinh vien voi kb:sync" la NOI QUA —
  coTheNhuong() co HAI duong => kb:sync LAY DUOC cho cua ho NHAN ROI. HE QUA VAN HANH:
  cron 03:00 nay CO THE tat sidecar thi giac nhan roi de lay 7,8 GB. Dung §5.2 nhung la hanh vi
  MOI thay duoc tu ngoai => can chu du an biet.
  ★ Sai lech co chu y: GGUF_VRAM_GUARD_PCT mac dinh 90 -> 100 (tat). Ly do: "90" nghia NGUONG
  PHAN UNG khac "90" nghia TRAN CUNG; giu 90 la bia mot bien an toan khong do duoc va lam sai
  con so nghiem thu 30.559 MiB cua Task 5.

REVIEW TOAN NHANH: bi NGAT (het han muc phien, reset 19:30 Asia/Bangkok). Ba agent chet cung luc
  (reviewer + 2 sub-agent no tu sinh). Reviewer chet DUNG luc dang chay dot bien.
  ⚠ CO DU DOT BIEN trong cay: server/services/llamaVisionSidecar.ts bi go `releaseProof:
  "process-exit"` — dung MOT trong ba cho Task 7 tu khai "cung hinh dang, chua kiem".
  CONTROLLER da chay not phep thu do thay vi vut di:
  ⇒ KET QUA: 1 DO / 539 — ca `C-bis. LUOI THEO DUONG THOAT — ★★★ diem goi SAN XUAT cua sidecar
  thi giac THAT SU khai nguoi thi hanh` (consolidation.test.ts). LUOI CO THAT cho releaseProof.
  Da khoi phuc bang `git checkout --`; cay sach (0 muc trong server/client/drizzle/shared); 539/539.
  ⚠ CON LAI CHUA KIEM: ttlMs, configDefaultBytes.

=== LUOT VA SAU REVIEW TOAN NHANH (2026-08-04) ===
WB C-1: DOT BIEN SONG SOT DA VA — `reclaimer: "gguf-idle-model"` o diem goi SAN XUAT cua
  loadGgufModel() go di cho 0 DO/539. Rut ra ham THUAN ggufModelVramRequest(); CA HAI duong
  (runner + DU PHONG) trai no; ca doc DUNG object ma san xuat gui di + phep dem BANG MAY khoa
  hai duong dung chung ham. Mock ../aiGgufEngine doi sang importOriginal (truoc do thay TRON
  module nen ham thuan vo hinh). Commit 7100565c. Dot bien lai => 1 DO/540.
WB C-2: stopSidecar() KHONG cho tien trinh chet ma nguoi thi hanh `return true` vo dieu kien =>
  vramWiring xin lai NGAY tren so chua nha => TU CHOI LAN HAI sau khi da giet 7,8 GB (net-am).
  Nay stopSidecar(): Promise<boolean> = "da quan sat duoc cai chet", cho co han
  (LLAMA_VISION_STOP_WAIT_MS, mac dinh 8.000 > moc SIGKILL 5.000), `daChet` giai quyet o DUNG hai
  nhanh tra giay phep va NGOAI try cua release(). Nguoi thi hanh chuyen nguyen cau tra loi len.
  Hai ca chay NGU NGHIA THAT (khong gia stopSidecar) o wiring.outofprocess.test.ts (C-2a/C-2b).
  Commit f6e33567. Dot bien lai => 2 DO/543.
WB I-1: ⚠⚠ SUA CON SO — .env DA DAT GGUF_VRAM_GUARD_PCT=90 TUONG MINH tu thoi nghia CU, va ba
  task sau do tinh moi con so nhu the khong co no. DA GO khoi .env (.env gitignore => doi may
  khac phai lam lai bang tay; khoi chu thich moi trong .env ghi day du phep tru).
  ⚠ CON SO DUNG: du dia hieu luc ON DINH cua worker = tran − 1.024 (dem) − 1.024 (bien tuoi)
  − [1.024 neu nen chua xac minh].
    guard 90 => tran 29.346 (−3.261) => 27.298 (nen da xac minh) / 26.274 (chua);
    khong guard => tran 32.607 => 30.559 (da xac minh) / 29.535 (chua).
  Con so ~30.559 trong bao cao Task 5/7 va progress.md CHI dung khi KHONG dat guard VA nen da
  xac minh — hai dieu kien deu tung bi bo quen. Da ghi ca hai vao vramEnforcement.ts.
  Vi sao GO chu khong giu: 30B (~16.870) + sidecar (7.825) = 24.695; voi guard 90 chi con 1.579
  MiB — nho hon tong ba ho thuong tru con lai (reranker GPU ~600 + embed ctx 654 + ONNX 339 =
  1.593) => dung cau hinh ma .env mo ta se cham TU CHOI. Va 3.261 MiB do la mot bien an toan
  THU HAI khong do duoc, chong len VRAM_SAFETY_RESERVE_MB + hai don vi mat-tin-cay.
  Them LUOI: vramCaps.doc() KEU dung MOT lan/tien trinh khi guardPct < 100, cau noi ro hau qua
  la TU CHOI (mot lua chon "tuong minh" ma hau qua im lang thi khong phai tuong minh).
WB I-2: preemptPlan() DON THUA o nhanh chi-thieu-KHE (deficitBytes=0 => `freed >= enough` dung
  ngay tu dau => vong chi dung khi du KHE => sidecar 7,8 GB nhan roi + cu hon bi keo vao ke hoach
  du no khong giai phong khe nao). Hai ban sao cua cung vong lap gop thanh MOT
  (`duyetTheoNhuCau`) + luat "bo qua ung vien khong gop vao dieu kien CON THIEU". Ca cu :372 mu
  vi ca ba ho deu la gguf-model. Commit 875b2c5d. Dot bien lai => 1 DO/545.
WB I-3: "gguf-slot-cap" ROI VramDegradationReason. No khong lam con so nao kem tin — no la mot
  cua tu choi RIENG (D4). Truoc do bi noi vao `reasons` SAU khi enf.trusted da tinh => nhat ky noi
  trusted, client noi degraded cho CUNG mot luot; va cau ra tu mau thuan ("xin 600 MiB, con 1200
  MiB — con so nay kem tin"). Nay: truong rieng VramRefusalFacts.slotsNeeded + ma VRAM_SLOT_CAP
  (+ i18n vi/en/zh) khi byte VUA ma het khe; thieu CA HAI van la VRAM_REFUSED nhung cau neu ca
  tran DEM. Bat bien `trusted <=> reasons rong` da tra lai + co ca khoa. Commit 9520ddef.
  ⚠ DINH CHINH REVIEW: {{degradedReasons}} KHONG vang khoi khuon VRAM_REFUSED* — no toi client
  qua o {{trust}} (errors.trust.degraded tu mang no, noi suy LONG o client/src/lib/errorCodes.ts,
  va refusal.test.ts:399 da khoa dung viec do). Loi THAT la KHUNG SAI, khong phai mat thong tin.
  ⚠ PHAT HIEN MOI: client/src/lib/errorCodes.vram.unit.test.ts DA DO 2 ca tu Task 4 (fixture
  thieu `reclaimable` => preemptableBytes = 0; va "15/160" chep tay nay la 15/159). tsc loai
  **/*.test.ts, va `npx vitest run server/services/vram/` khong chay file o client/ => nac i18n
  (nac DUY NHAT chay i18next that voi ban dich that) da TOI suot hai task. Da va + doc hang so.
WB I-4: "api mu vinh vien" SAI tu Task 2 (I-1, 212c2aea): startVramReconciler() nay goi TRUOC
  nhanh re ROLE o index.ts va __runReconcileTick() xuat ban tick BAT KE `ring` => api CO tick,
  chi TAT CHUONG. Da sua BON docstring (review neu ba; vramReconciler.describeTopologyHint() la
  cai thu tu) + them mot nhom ca QUET MA khoa THU TU do (roleTopology.test.ts).
  ⇒ Muc nang nhat "no-tick" (2 don vi) gan nhu BAT KHA DAT trong san xuat — dung vien dan no lam
  la chan THUONG TRUC cua api. Trong so 2 GIU NGUYEN vi van dung cho dan so con lai (cua so truoc
  nhip DAU, va ca reconciler khong bat duoc).
  ⚠⚠ NO CO DIA CHI (N-WB-1) — KHONG VA DUOC RE: api va worker CUNG CHUP NEN tren MOT thiet bi.
  api khoi dong lai khi worker giu 17 GB => nen cua api nuot tron khoi do => headroom cua api lac
  quan 17.000 MiB. Co che PHAT HIEN da co va dung huong (captureVramBaseline() thay `peers` =>
  baselineVerified = false), nhung phan ung la DUNG 1.024 MiB — thieu 17x. KHONG doan duoc byte
  cua ho la (`nvidia-smi --query-compute-apps` tra used_memory=[N/A] tren WDDM, DO DUOC o
  reconciler.baselinePids.test.ts) nen moi con so o day la so BIA; va day nen ve chi-so (bo nen)
  lai NOI LONG (`max(L,A) >= L`). Dia chi: vramReconciler.captureVramBaseline() nhanh `peers` +
  vramEnforcement.DISTRUST_UNITS["unverified-baseline"]. Loi giai that = SO CHUNG giua cac tien
  trinh = Pha 3.
