/**
 * Vietnamese dictionary — the app's default language (Task 8). Source of truth for key shape; `en.ts`
 * must mirror every key here exactly (see `i18n/index.ts`'s dev-mode missing-key warning).
 *
 * Values are either a plain string (interpolated via `{var}` tokens) or a function of the same `vars`
 * bag, for entries that need real logic (English pluralization; Vietnamese doesn't inflect for count,
 * so its functions usually just interpolate too, kept as functions for shape-parity with `en.ts`).
 */

type Vars = Record<string, string | number>

export const vi = {
  common: {
    connectivityError:
      "Không thể kết nối tới engine ở địa chỉ đã cấu hình — hãy kiểm tra St4i.EngineApi đã chạy chưa.",
  },

  theme: {
    toggleToLight: "Chế độ sáng",
    toggleToDark: "Chế độ tối",
  },

  shell: {
    nav: {
      dashboard: "Bảng điều khiển",
      machines: "Danh sách máy",
      onboarding: "Thêm máy mới",
      inspector: "Theo dõi API",
      scenario: "Kịch bản",
      settings: "Cài đặt",
    },
    sidebar: {
      brandSubtitle: "Máy mô phỏng",
    },
    topBar: {
      fallbackTitle: "Máy mô phỏng ST4I",
      machineTitle: (vars: Vars) => `Máy ${vars.code}`,
      transportModeAria: "Chế độ truyền tải",
      startFleet: "Chạy Fleet",
      starting: "Đang chạy…",
      stop: "Dừng",
      stopping: "Đang dừng…",
      engineConnected: "Đã kết nối engine",
      engineOffline: "Mất kết nối engine",
      connecting: "Đang kết nối…",
      demoFallback: "Dự phòng Demo",
      engineFaulted: "Engine gặp lỗi",
      paletteAria: "Mở bảng lệnh (⌘K)",
    },
    commandPalette: {
      designTokens: "Bảng thiết kế (tham khảo)",
      searchPlaceholder: "Tới màn hình…",
      searchAria: "Tìm màn hình",
      dialogAria: "Bảng lệnh",
      listboxAria: "Màn hình",
      noResults: (vars: Vars) => `Không tìm thấy màn hình nào khớp “${vars.query}”.`,
    },
  },

  deviceClass: {
    Automation: "Automation",
    Iot: "IoT",
    AoiAvi: "AOI / AVI",
  },

  driverKind: {
    Simulated: "Mô phỏng",
    HotFolderAoi: "Hot-folder AOI",
    Mqtt: "MQTT",
  },

  status: {
    idle: "Chưa hoạt động",
    ok: "Đạt",
    warn: "Cảnh báo",
    fail: "Lỗi",
    telemetry: "Dữ liệu cảm biến",
  },

  dashboard: {
    title: "Bảng điều khiển",
    subtitleBase: "Theo dõi trực tiếp đội máy mô phỏng",
    subtitleRoster: (vars: Vars) => ` — ${vars.roster} máy thuộc Automation, IoT và AOI/AVI.`,
    kpi: {
      machinesOnline: "Máy đang hoạt động",
      totalCycles: "Tổng chu kỳ",
      fpy: "Tỷ lệ đạt lần đầu",
      onlineAll: "Toàn bộ đội đang hoạt động",
      onlineNotYet: (vars: Vars) => `${vars.count} máy chưa chạy`,
      onlineNone: "Đội máy chưa chạy",
      fpyOnTarget: "Đạt mục tiêu",
      fpyWatch: "Cần theo dõi",
      fpyBelow: "Dưới mục tiêu",
      fpyNoCycles: "Chưa có chu kỳ",
    },
    empty: {
      title: "Bấm Chạy Fleet để bắt đầu",
      description: (vars: Vars) =>
        `Đội máy mô phỏng có ${vars.roster} máy đang chờ. Nhấn “Chạy Fleet” để bắt đầu chu trình và xem dữ liệu trực tiếp trên bảng điều khiển.`,
      cta: "Chạy Fleet",
      ctaPending: "Đang chạy…",
    },
  },

  machines: {
    title: "Danh sách máy",
    description:
      "Toàn bộ đội máy mô phỏng — tìm và lọc theo nhóm thiết bị, driver hoặc trạng thái. Bấm vào một dòng để xem chi tiết.",
    onlineCount: (vars: Vars) => `${vars.online} / ${vars.total} đang hoạt động`,
    search: {
      label: "Tìm máy",
      placeholder: "Tìm theo mã máy…",
    },
    filters: {
      type: "Nhóm thiết bị",
      status: "Trạng thái",
      all: "Tất cả",
      clear: "Xóa bộ lọc",
    },
    shownLabel: "hiển thị",
    ofTotal: (vars: Vars) => `trên ${vars.count} máy`,
    table: {
      code: "Mã máy",
      type: "Nhóm thiết bị",
      driver: "Driver",
      status: "Trạng thái",
      passRate: "Tỷ lệ đạt",
      cycles: "Chu kỳ",
      trend: "Xu hướng",
      viewAction: "Xem chi tiết",
      rowAria: (vars: Vars) => `Xem chi tiết máy ${vars.code}`,
    },
    empty: {
      noMachinesTitle: "Chưa có máy nào",
      noMachinesDescription: "Đội máy mô phỏng hiện chưa có máy nào. Thêm một máy mới qua Onboarding để bắt đầu.",
      noMatchTitle: "Không tìm thấy máy phù hợp",
      noMatchDescription: "Không có máy nào khớp với tìm kiếm hoặc bộ lọc hiện tại — thử xóa bộ lọc.",
    },
  },

  notFound: {
    title: "Không tìm thấy trang",
    description: "Đường dẫn này không tồn tại. Dùng thanh bên hoặc nhấn ⌘K để tới một màn hình.",
  },

  machineDetail: {
    back: "Về bảng điều khiển",
    headerCycles: "Chu kỳ",
    headerPassRate: "Tỷ lệ đạt",
    tabs: {
      overview: "Tổng quan",
      spc: "SPC",
      telemetry: "Cảm biến",
      board: "Bo mạch",
      config: "Cấu hình",
      log: "Nhật ký",
    },
    overview: {
      status: "Trạng thái",
      driver: "Driver",
      cycles: "Chu kỳ",
      passRate: "Tỷ lệ đạt",
      lastConfigSync: "Lần đồng bộ cấu hình gần nhất",
      recentCycles: "Chu kỳ gần đây",
    },
    notFoundState: {
      title: "Không tìm thấy máy",
      description: (vars: Vars) =>
        `Không có máy với mã ${vars.code} trong đội máy này. Có thể máy chưa khởi động, hoặc mã đã gõ sai.`,
    },
  },

  onboarding: {
    title: "Thêm máy mới",
    subtitle:
      "Đăng ký, chờ duyệt và claim/enroll một máy mới với ST4I server — hoặc chạy toàn bộ luồng ở chế độ demo, không cần server thật.",
    steps: {
      register: "Đăng ký",
      poll: "Chờ duyệt",
      claim: "Claim / Enroll",
      done: "Hoàn tất",
    },
    demoLiveToggle: {
      aria: "Đường dẫn onboarding",
      demo: "Demo",
      live: "Live",
    },
    modeHint: {
      demoLabel: "Demo",
      liveLabel: "Live",
      demo: "Mô phỏng — không gọi server thật, các bước diễn ra tức thì trên engine cục bộ.",
      live: (vars: Vars) => `Trực tiếp — các bước dưới đây gọi thật tới ${vars.server}.`,
      liveNoServer: "Trực tiếp — nhập địa chỉ server bên dưới để bắt đầu.",
    },
    register: {
      description: "Đăng ký một máy mới với ST4I server (hoặc mô phỏng luồng demo).",
      serialLabel: "Số serial",
      serialPlaceholder: "vd: SIM-0001",
      nameLabel: "Tên máy",
      namePlaceholder: "vd: Trạm vít 01",
      defaultName: "Trạm vít demo",
      typeLabel: "Loại máy",
      typeSelectPlaceholder: "Chọn loại máy",
      // Nhãn nhóm trong danh sách chọn — nhóm chỉ để dễ tìm, KHÔNG ảnh hưởng giá trị gửi đi (luôn là
      // đúng chuỗi enum bên dưới).
      typeGroups: {
        inspection: "Kiểm tra",
        automation: "Tự động hóa",
        iot: "IoT",
      },
      // Giá trị dropdown PHẢI khớp chính xác (phân biệt hoa/thường) với enum của server thật
      // (server/constants/machineTypes.ts MACHINE_TYPES) — đây là lý do bug gốc: trường tự do trước
      // đây gửi "Automation" (chữ thường) trong khi server chỉ chấp nhận "AUTOMATION", nên Live
      // register luôn trả về HTTP 400. Nhãn hiển thị song ngữ, nhưng giá trị gửi đi luôn là khóa (vd.
      // "AOI") — không phải nhãn.
      machineTypes: {
        AVI: "AVI — Kiểm tra ngoại quan tự động",
        AOI: "AOI — Kiểm tra quang học tự động",
        SPI: "SPI — Kiểm tra keo hàn",
        AXI: "AXI — Kiểm tra X-quang tự động",
        ICT: "ICT — Kiểm tra mạch điện (In-Circuit Test)",
        FCT: "FCT — Kiểm tra chức năng",
        CMM: "CMM — Máy đo tọa độ 3 chiều",
        ICT_FUNC: "ICT_FUNC — ICT kết hợp kiểm tra chức năng",
        MOUNTER: "MOUNTER — Máy gắn linh kiện SMT",
        REFLOW: "REFLOW — Lò hàn reflow",
        STENCIL_PRINTER: "STENCIL_PRINTER — Máy in kem hàn",
        WAVE_SOLDER: "WAVE_SOLDER — Máy hàn sóng",
        AUTOMATION: "AUTOMATION — Trạm tự động hóa chung",
        ASSEMBLY: "ASSEMBLY — Trạm lắp ráp",
        SCREWDRIVE: "SCREWDRIVE — Trạm siết vít tự động",
        DISPENSING: "DISPENSING — Trạm bơm keo / chất lỏng",
        FEEDER: "FEEDER — Bộ cấp linh kiện",
        PACKAGING: "PACKAGING — Trạm đóng gói",
        PALLETIZER: "PALLETIZER — Máy xếp pallet",
        ROBOT: "ROBOT — Robot công nghiệp",
        ROBOT_TEST: "ROBOT_TEST — Trạm kiểm tra bằng robot",
        WELDER: "WELDER — Trạm hàn",
        IOT_SENSOR: "IOT_SENSOR — Cảm biến IoT",
        IOT_GATEWAY: "IOT_GATEWAY — Gateway IoT",
      },
      serverUrlLabel: "Địa chỉ server",
      serverUrlPlaceholder: "https://your-st4i-server",
      submit: "Đăng ký máy",
      submitting: "Đang đăng ký…",
    },
    poll: {
      pendingTitle: "Đang chờ duyệt trên hệ thống ST4I",
      waitingPrefix: "Đang chờ quản trị viên duyệt",
      waitingSuffixDemo: ". Ở chế độ demo, nhấn nút bên dưới để duyệt ngay (mô phỏng admin).",
      waitingSuffixLive: ". Sau khi quản trị viên duyệt trên SYNAPSE Admin Console, bấm \"Kiểm tra trạng thái\" bên dưới để cập nhật.",
      liveInstruction: "Mở SYNAPSE Admin Console để duyệt máy này, rồi dán mã claim (mct_…) bên dưới.",
      pending: "Đang chờ",
      back: "Quay lại",
      approveBtn: "Duyệt máy (mô phỏng admin)",
      approving: "Đang duyệt…",
      liveCheckBtn: "Kiểm tra trạng thái",
      liveChecking: "Đang kiểm tra…",
    },
    claim: {
      description: "Đã duyệt, đang nhận cấu hình — nhận khóa mk_ bằng Claim hoặc Enroll bên dưới.",
      tabClaim: "Claim (mct_)",
      tabEnroll: "Enroll (met_)",
      claimTokenLabel: "Claim token",
      claimTokenHintDemo: "Không bắt buộc ở chế độ demo — token bất kỳ đều được bỏ qua.",
      claimTokenHintLive: "Dán mã claim (mct_…) mà quản trị viên đã cấp trong SYNAPSE Admin Console.",
      claimBtn: "Claim",
      claiming: "Đang claim…",
      enrollTokenLabel: "Enroll token",
      enrollBtn: "Enroll",
      enrolling: "Đang enroll…",
      back: "Quay lại",
    },
    done: {
      savedFor: (vars: Vars) => `Đã lưu khóa cho ${vars.code}`,
      savedHint: "Khóa được mã hóa (DPAPI) và lưu trên máy chạy engine.",
      joinedFleet: (vars: Vars) => `${vars.code} đã tham gia đội máy mô phỏng — có thể xem máy hoạt động ngay.`,
      machineCodeLabel: "Mã máy",
      keyLabel: "Khóa mk_",
      reveal: "Hiện khóa",
      hide: "Ẩn khóa",
      copy: "Sao chép khóa",
      copied: "Đã sao chép.",
      viewFleet: "Xem đội máy",
      viewMachine: "Xem máy vừa thêm",
      registerAnother: "Đăng ký máy khác",
    },
    pasteCard: {
      title: "Dán khóa mk_ có sẵn",
      description: "Đã có khóa mk_ từ nơi khác (SDK, đồng nghiệp)? Lưu trực tiếp tại đây.",
      codeLabel: "Mã máy",
      codePlaceholder: "vd: SIM-0002",
      keyLabel: "Khóa mk_",
      save: "Lưu khóa",
      saving: "Đang lưu…",
      saved: "Đã lưu",
    },
    validation: {
      needBoth: "Cần nhập cả mã máy và khóa mk_.",
    },
    errors: {
      registerFailed: (vars: Vars) => `Đăng ký thất bại: ${vars.message}`,
      pollFailed: (vars: Vars) => `Kiểm tra duyệt thất bại: ${vars.message}`,
      claimFailed: (vars: Vars) => `Claim thất bại: ${vars.message}`,
      enrollFailed: (vars: Vars) => `Enroll thất bại: ${vars.message}`,
      pasteFailed: (vars: Vars) => `Lưu khóa thất bại: ${vars.message}`,
      serialRequired: "Số serial là bắt buộc.",
      copyFailed: "Không thể sao chép — hãy chọn văn bản thủ công.",
      unknown: "lỗi không xác định",
    },
    log: {
      title: "Nhật ký hoạt động",
      empty: "Chưa có hoạt động — bắt đầu với Đăng ký bên dưới.",
      ariaLabel: "Hoạt động onboarding",
    },
  },

  inspector: {
    title: "Theo dõi API",
    subtitle: (vars: Vars) =>
      `Luồng trực tiếp, từng gói tin của mọi request đội máy gửi đi — ${vars.count} đã ghi nhận trong phiên này.`,
    status: {
      live: "Trực tiếp",
      paused: "Tạm dừng",
      connecting: "Đang kết nối…",
      reconnecting: "Đang kết nối lại…",
    },
    filters: {
      machine: "Máy",
      kind: "Loại",
      status: "Trạng thái",
      all: "Tất cả",
    },
    shownLabel: "hiển thị",
    ofBuffered: (vars: Vars) => `trên ${vars.count} đã lưu`,
    pause: "Tạm dừng",
    resume: "Tiếp tục",
    clear: "Xóa",
    export: "Xuất",
    exportedNote: (vars: Vars) => `Đã xuất ${vars.count} sự kiện ra tệp`,
    emptyConnecting: "Đang kết nối tới engine…",
    emptyNoTraffic: "Chưa có lưu lượng API nào — hãy chạy fleet từ thanh trên để xem request trực tiếp tại đây.",
    emptyNoMatch: "Không có sự kiện nào khớp bộ lọc hiện tại.",
    table: {
      time: "Thời gian",
      machine: "Máy",
      kind: "Loại",
      method: "Phương thức",
      path: "Đường dẫn",
      status: "Trạng thái",
      latency: "Độ trễ",
      mode: "Chế độ",
      dupError: "Trùng / Lỗi",
    },
  },

  scenario: {
    title: "Kịch bản",
    subtitle: "Thanh trượt + preset trình diễn — thay đổi ở đây tác động thật lên fleet đang chạy.",
    currentState: "Trạng thái hiện tại",
    liveAdjust: {
      title: "Điều chỉnh trực tiếp",
      hint: "Mỗi lần kéo áp dụng ngay lên fleet đang chạy.",
    },
    cycleRate: "Tốc độ chu kỳ (Cycle rate)",
    defectRate: "Tỷ lệ lỗi (Defect rate)",
    faultRate: "Tỷ lệ lỗi thiết bị (Fault rate)",
    networkOutage: "Mất mạng (Network outage)",
    networkOutageHint: "Chuyển transport sang store-and-forward lỗi cao.",
    burst: "Burst (6x, 4s)",
    presetsTitle: "Preset trình diễn",
    presetsHint: "Mỗi nút đặt lại cả 3 chỉ số + trạng thái mạng, áp dụng một lần lên fleet đang chạy.",
    presets: {
      normal: { label: "Ca bình thường", description: "Tốc độ và tỷ lệ lỗi mặc định của dây chuyền — nền cho mọi demo khác." },
      highDefect: { label: "Lô lỗi cao", description: "Tăng mạnh tỷ lệ lỗi tiêm thêm để trình diễn andon/cảnh báo." },
      sensorDrift: { label: "Sensor drift", description: "Tăng tốc chu kỳ để lộ sự kiện trôi hiệu chuẩn định kỳ của IOT_SENSOR." },
      networkOutage: { label: "Mất mạng demo", description: "Chuyển sang store-and-forward lỗi cao (~90%) trong khi fleet vẫn chạy." },
      hotfolderAoi: { label: "Hot-folder AOI", description: "Ghi một file đo lường mẫu rồi để driver AOI đọc lại thật." },
    },
    presetCustomDescription: "Preset tùy chỉnh.",
  },

  settings: {
    title: "Cài đặt",
    subtitle: "Kết nối, chế độ vận hành, xác thực máy và ngôn ngữ — kết nối trực tiếp tới /v1/settings và /v1/mode.",
    connection: {
      title: "Kết nối máy chủ",
      verifyTlsLabel: "Xác thực TLS (Verify TLS)",
      verifyTlsHint: "Từ chối chứng chỉ HTTPS không hợp lệ.",
      check: "Kiểm tra kết nối",
      checking: "Đang kiểm tra…",
      reachable: (vars: Vars) => `Kết nối được · HTTP ${vars.status} · ${vars.count} path`,
      unreachable: "Không thể kết nối",
      requestFailed: "Yêu cầu kiểm tra thất bại",
    },
    mode: {
      title: "Chế độ vận hành",
      appliesImmediately: "Áp dụng ngay lập tức — không cần bấm Lưu.",
      radioGroupAria: "Chế độ vận hành",
      live: { hint: "Gọi thẳng ST4I server thật." },
      demo: { hint: "Tự mô phỏng, không cần server." },
      auto: { hint: "Ưu tiên Live, tự rơi về Demo khi mất kết nối." },
    },
    auth: {
      title: "Xác thực máy",
      machineCodeLabel: "Mã máy đang dùng để xác thực",
      machineCodeHint: "Khóa mk_ đã lưu cho mã này sẽ được dùng khi Live/Auto kết nối server thật.",
      machineCodePlaceholder: "vd: ENGINE-API-01",
      pasteCodeLabel: "Mã máy",
      pasteCodePlaceholder: "vd: SIM-0002",
      pasteKeyLabel: "Khóa mk_",
      saveKey: "Lưu khóa",
      savingKey: "Đang lưu…",
      needBoth: "Cần nhập cả mã máy và khóa mk_.",
      unknownError: "Lỗi không xác định",
      savedTitle: "Đã lưu trên trình duyệt này",
      noneSaved: "Chưa có khóa nào được ghi nhận trong phiên này.",
      caveat: "Danh sách này chỉ ghi nhận trên trình duyệt — không phải danh sách đầy đủ trên máy chủ engine.",
    },
    language: {
      title: "Ngôn ngữ",
      label: "Ngôn ngữ giao diện",
      placeholder: "Chọn ngôn ngữ",
      vi: "Tiếng Việt",
      en: "English",
    },
    save: "Lưu thay đổi",
    saving: "Đang lưu…",
    dirty: "Có thay đổi chưa lưu.",
    clean: "Đã lưu.",
  },

  boardView: {
    waiting: "Đang chờ chu kỳ kiểm tra đầu tiên…",
    pointsInspected: (vars: Vars) => `${vars.count} điểm đã kiểm tra`,
    cleanBoard: "Bo mạch sạch — không phát hiện lỗi",
    legend: {
      ng: "NG — phát hiện lỗi",
      ntf: "NTF — được gắn cờ, không phải lỗi thật",
    },
    ariaClean: (vars: Vars) => `Sơ đồ bo mạch — cả ${vars.count} điểm kiểm tra đều đạt, không phát hiện lỗi`,
    ariaDefects: (vars: Vars) =>
      `Sơ đồ bo mạch — ${vars.defectCount} vị trí lỗi được đánh dấu trên ${vars.total} điểm kiểm tra`,
  },

  configSyncPanel: {
    title: "Đồng bộ recipe / cấu hình",
    description: "Lấy recipe và cấu hình mapping mới nhất cho máy này từ máy chủ, và báo cáo nếu có thay đổi.",
    currentState: "Trạng thái hiện tại",
    syncBtn: "Đồng bộ recipe",
    syncing: "Đang đồng bộ…",
    syncFailed: (vars: Vars) => `Đồng bộ thất bại: ${vars.message}`,
    lastResult: "Kết quả đồng bộ gần nhất",
    changed: "Đã thay đổi",
    version: "Phiên bản",
    applied: "Đã áp dụng",
    yes: "Có",
    no: "Không",
    unknownError: "lỗi không xác định",
  },

  cycleLogTable: {
    empty: "Chưa ghi nhận chu kỳ nào.",
    showing: (vars: Vars) => `Hiển thị ${vars.visible} trên ${vars.total} chu kỳ đã ghi, mới nhất trước.`,
    headers: {
      time: "Thời gian",
      serial: "Serial",
      verdict: "Kết quả",
      keyMetric: "Chỉ số chính",
    },
    verdict: {
      pass: "Đạt",
      warn: "Cảnh báo",
      fail: "Lỗi",
      telemetry: "Dữ liệu cảm biến",
    },
  },

  spcChart: {
    waiting: "Đang chờ chu kỳ — biểu đồ SPC cần ít nhất 2 lần đo đã đánh giá.",
    latest: "Gần nhất",
    mean: "Trung bình",
    outOfControl: (vars: Vars) => `${vars.out} trên ${vars.total} vượt giới hạn kiểm soát`,
    allWithinLimits: "Tất cả chu kỳ trong giới hạn",
    legend: {
      value: "Giá trị",
      mean: "Trung bình",
      distribution: "Phân bố",
    },
    tooltipCycle: (vars: Vars) => `Chu kỳ ${vars.cycle}`,
    tooltipValue: "Giá trị",
    xAxisLabel: "Chu kỳ",
    meanLabel: (vars: Vars) => `TB ${vars.value}`,
    uclLabel: (vars: Vars) => `UCL ${vars.value}`,
    lclLabel: (vars: Vars) => `LCL ${vars.value}`,
  },

  telemetryChart: {
    noSamples: "Chưa có dữ liệu cảm biến — máy này chưa gửi chỉ số nào trong phiên này.",
    tooltipSample: (vars: Vars) => `Mẫu ${vars.sample}`,
    xAxisLabel: "Mẫu",
    perSeriesNote: "Mỗi đường được co giãn theo khoảng riêng — xem giá trị thật ở trên.",
  },

  machineCard: {
    cycleTrend: "Xu hướng chu kỳ",
    cyclesUnit: "chu kỳ",
    passRateNotApplicableAria: "Không áp dụng tỷ lệ đạt — chỉ có dữ liệu cảm biến",
    passRateAria: (vars: Vars) => `Tỷ lệ đạt ${vars.pct}%`,
  },

  toast: {
    fleetStarted: "Đã chạy fleet.",
    fleetStartFailed: "Không thể chạy fleet.",
    fleetStopped: "Đã dừng fleet.",
    scenarioPresetApplied: (vars: Vars) => `Đã áp dụng preset “${vars.name}”.`,
    scenarioBurstApplied: "Đã kích hoạt Burst.",
    settingsSaved: "Đã lưu cài đặt.",
    settingsSaveFailed: "Không thể lưu cài đặt.",
    onboardingKeyStored: (vars: Vars) => `Đã lưu khóa cho ${vars.code}.`,
    configSynced: (vars: Vars) => `Đã đồng bộ cấu hình cho ${vars.code}.`,
    configSyncFailed: "Đồng bộ cấu hình thất bại.",
    keyCopied: "Đã sao chép khóa.",
  },
}

export type Dictionary = typeof vi
