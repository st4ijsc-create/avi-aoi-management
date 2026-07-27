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

  // WS-D-D6 — cổng đăng nhập/auth context (`lib/auth.ts`, gate ở cấp cao nhất trong `App.tsx`).
  // `login`/`bootstrap` hiển thị BÊN NGOÀI khung Shell, giống `/tokens`/`/hmi/:code` — một trang
  // riêng có theme, không phải route bên trong `<Shell>`. `userMenu` là từ vựng tối thiểu cho menu
  // người dùng thật của D7 trên TopBar; task này chỉ cần các khóa tồn tại (xem `AuthContextValue.logout`
  // trong `lib/auth.ts`).
  auth: {
    splash: "Đang tải…",
    login: {
      title: "Đăng nhập",
      subtitle: "Đăng nhập để tiếp tục vào Máy mô phỏng ST4I.",
      usernameLabel: "Tên đăng nhập",
      usernamePlaceholder: "vd: admin",
      passwordLabel: "Mật khẩu",
      passwordPlaceholder: "••••••••",
      submit: "Đăng nhập",
      submitting: "Đang đăng nhập…",
      invalidCredentials: "Sai tên đăng nhập hoặc mật khẩu.",
    },
    bootstrap: {
      title: "Tạo tài khoản Admin đầu tiên",
      description: "Hệ thống này chưa có tài khoản nào — tạo tài khoản Admin đầu tiên để bắt đầu.",
      usernameLabel: "Tên đăng nhập",
      displayNameLabel: "Tên hiển thị (tùy chọn)",
      passwordLabel: "Mật khẩu",
      confirmPasswordLabel: "Xác nhận mật khẩu",
      submit: "Tạo tài khoản Admin",
      submitting: "Đang tạo…",
      requiredError: "Cần nhập cả tên đăng nhập và mật khẩu.",
      passwordMismatch: "Mật khẩu xác nhận không khớp.",
      genericError: "Không thể tạo tài khoản — hệ thống này có thể đã được khởi tạo rồi.",
    },
    userMenu: {
      signedInAs: (vars: Vars) => `Đã đăng nhập với ${vars.username}`,
      role: (vars: Vars) => `Vai trò: ${vars.role}`,
      logout: "Đăng xuất",
      loggingOut: "Đang đăng xuất…",
    },
  },

  // WS1 — 3-theme system (docs/PRODUCTION_UI_DESIGN.md). `name` is a proper noun, kept identical
  // in both dictionaries (like "ST4I" itself) — only `description` and the picker's own chrome
  // translate. Shared by `theme/ThemePicker.tsx`'s topbar quick-switch AND Settings' radiogroup.
  theme: {
    pickerAriaLabel: (vars: Vars) => `Chọn giao diện — hiện tại ${vars.current}`,
    glass: { name: "Glass", description: "Sáng, cao cấp" },
    console: { name: "Console", description: "Tối, công nghệ cao" },
    warmth: { name: "Warmth", description: "Ấm, công nghiệp" },
  },

  shell: {
    nav: {
      dashboard: "Bảng điều khiển",
      machines: "Danh sách máy",
      productConfig: "Cấu hình sản phẩm",
      onboarding: "Thêm máy mới",
      inspector: "Theo dõi API",
      scenario: "Kịch bản",
      historian: "Lịch sử dữ liệu",
      reports: "Báo cáo OEE",
      settings: "Cài đặt",
      users: "Người dùng",
      audit: "Nhật ký kiểm toán",
      assets: "Sổ đăng ký tài sản",
      site: "Liên kết Site",
      alarms: "Trung tâm cảnh báo",
      line: "Điều khiển dây chuyền",
    },
    sidebar: {
      brandSubtitle: "Máy mô phỏng",
      navAria: "Điều hướng chính",
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
      engineFaulted: "Engine gặp lỗi",
      paletteAria: "Mở bảng lệnh (⌘K)",
    },
    commandPalette: {
      designTokens: "Bảng thiết kế (tham khảo)",
      recipeConfig: "Recipe (Automation/IoT)",
      searchPlaceholder: "Tới màn hình…",
      searchAria: "Tìm màn hình",
      dialogAria: "Bảng lệnh",
      listboxAria: "Màn hình",
      noResults: (vars: Vars) => `Không tìm thấy màn hình nào khớp “${vars.query}”.`,
    },
  },

  // Task C6 — segmented nav switch between Product Config (`/products`) and Recipe Config
  // (`/recipes`), rendered atop both workspaces' list pages.
  configModeToggle: {
    ariaLabel: "Chuyển đổi khu vực cấu hình",
    products: "Sản phẩm (AOI/AVI)",
    recipes: "Recipe (Automation/IoT)",
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
    Modbus: "Modbus",
    OpcUa: "OPC-UA",
  },

  lifecycleStatus: {
    development: "Đang phát triển",
    active: "Đang dùng",
    eol: "Ngừng sản xuất",
    archived: "Lưu trữ",
  },

  coordinateMode: {
    pixel: "Pixel",
    mm: "Milimét (mm)",
  },

  measurementType: {
    DIMENSION: "Kích thước 2D",
    VISUAL: "Ngoại quan",
    ELECTRICAL: "Điện",
    POSITION: "Vị trí",
    COLOR: "Màu sắc",
    SURFACE: "Bề mặt",
    OTHER: "Khác",
  },

  toleranceMode: {
    min_only: "Chỉ giới hạn dưới",
    max_only: "Chỉ giới hạn trên",
    range: "Khoảng (LSL–USL)",
    bilateral: "Hai phía (danh nghĩa ± dung sai)",
  },

  pointShape: {
    circle: "Tròn",
    rect: "Chữ nhật",
    polygon: "Đa giác",
    line: "Đường thẳng",
    ring: "Vành khuyên",
    mask: "Mặt nạ",
    array: "Mảng (lưới)",
  },

  // draft = đang soạn thảo (chưa có máy nào dùng); active = phiên bản máy phân giải tới; archived =
  // đã lưu trữ, không còn hiệu lực — mirrors `lifecycleStatus`'s own enum-label block above.
  recipeStatus: {
    draft: "Bản nháp",
    active: "Đang dùng",
    archived: "Lưu trữ",
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

  productConfig: {
    title: "Cấu hình sản phẩm",
    description:
      "Danh mục sản phẩm AOI/AVI — điểm đo, thông số kỹ thuật và ảnh tham chiếu dùng để kiểm tra. Bấm vào một sản phẩm để chỉnh sửa.",
    countLabel: (vars: Vars) => `${vars.count} sản phẩm`,
    createBtn: "Tạo sản phẩm",
    search: {
      label: "Tìm sản phẩm",
      placeholder: "Tìm theo mã hoặc tên…",
    },
    filters: {
      lifecycle: "Vòng đời",
      all: "Tất cả",
      clear: "Xóa bộ lọc",
    },
    shownLabel: "hiển thị",
    ofTotal: (vars: Vars) => `trên ${vars.count} sản phẩm`,
    table: {
      image: "Ảnh",
      code: "Mã sản phẩm",
      name: "Tên sản phẩm",
      lifecycle: "Vòng đời",
      points: "Điểm đo",
      version: "Phiên bản",
      viewAction: "Xem chi tiết",
      rowAria: (vars: Vars) => `Xem chi tiết sản phẩm ${vars.code}`,
    },
    versionShort: (vars: Vars) => `v${vars.version}`,
    noImageAlt: "Chưa có ảnh tham chiếu",
    empty: {
      noProductsTitle: "Chưa có sản phẩm nào",
      noProductsDescription: "Danh mục sản phẩm hiện chưa có sản phẩm nào. Tạo sản phẩm đầu tiên để bắt đầu cấu hình điểm đo.",
      noMatchTitle: "Không tìm thấy sản phẩm phù hợp",
      noMatchDescription: "Không có sản phẩm nào khớp với tìm kiếm hoặc bộ lọc hiện tại — thử xóa bộ lọc.",
    },
    createDialog: {
      title: "Tạo sản phẩm mới",
      description: "Tạo một sản phẩm AOI/AVI mới — có thể thêm điểm đo sau khi tạo.",
      codeLabel: "Mã sản phẩm",
      codePlaceholder: "vd: MODEL-C",
      codeHint: "Định danh duy nhất, không phân biệt hoa/thường — không thể đổi sau khi tạo.",
      codeRequired: "Cần nhập mã sản phẩm.",
      codeDuplicate: (vars: Vars) => `Mã "${vars.code}" đã tồn tại.`,
      nameLabel: "Tên sản phẩm",
      namePlaceholder: "vd: Bo mạch điều khiển phụ",
      nameRequired: "Cần nhập tên sản phẩm.",
      cancel: "Hủy",
      submit: "Tạo sản phẩm",
      submitting: "Đang tạo…",
      createFailed: "Tạo sản phẩm thất bại.",
    },
    form: {
      nameLabel: "Tên sản phẩm",
      lifecycleLabel: "Trạng thái vòng đời",
      coordinateModeLabel: "Hệ tọa độ",
      imageWidthLabel: "Chiều rộng ảnh (px)",
      imageHeightLabel: "Chiều cao ảnh (px)",
      referenceImageLabel: "Ảnh tham chiếu",
      referenceImageUrlPlaceholder: "URL ảnh, hoặc tải tệp lên bên dưới…",
      uploadBtn: "Tải ảnh lên",
      removeImageBtn: "Bỏ ảnh",
      previewAlt: "Xem trước ảnh tham chiếu",
      imageTooLarge: "Ảnh quá lớn (tối đa 5 MB).",
      imageReadFailed: "Không thể đọc tệp ảnh.",
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
      settings: "Cài đặt",
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

  productConfigDetail: {
    back: "Về cấu hình sản phẩm",
    versionBadge: (vars: Vars) => `Phiên bản điểm đo v${vars.version}`,
    notFoundState: {
      title: "Không tìm thấy sản phẩm",
      description: (vars: Vars) => `Không có sản phẩm với mã ${vars.code}. Có thể đã bị xóa, hoặc mã đã gõ sai.`,
    },
    tabs: {
      info: "Thông tin sản phẩm",
      points: "Điểm đo",
      sync: "Đồng bộ",
    },
    info: {
      title: "Thông tin sản phẩm",
      codeLabel: "Mã sản phẩm",
      save: "Lưu thay đổi",
      saving: "Đang lưu…",
      dirty: "Có thay đổi chưa lưu.",
      clean: "Đã lưu.",
      saveFailed: "Lưu sản phẩm thất bại.",
      nameRequired: "Cần nhập tên sản phẩm.",
      dangerZoneTitle: "Xóa sản phẩm",
      dangerZoneHint: "Xóa vĩnh viễn sản phẩm này cùng toàn bộ điểm đo, fiducial và biến thể đã cấu hình.",
      deleteBtn: "Xóa sản phẩm",
      deleteConfirmTitle: (vars: Vars) => `Xóa sản phẩm ${vars.code}?`,
      deleteConfirmDescription: (vars: Vars) =>
        `Thao tác này xóa vĩnh viễn "${vars.name}" và ${vars.pointCount} điểm đo đã cấu hình. Không thể hoàn tác.`,
      deleteConfirmCancel: "Hủy",
      deleteConfirmSubmit: "Xóa vĩnh viễn",
      deleting: "Đang xóa…",
      deleteFailed: "Xóa sản phẩm thất bại.",
    },
    points: {
      title: "Điểm đo",
      countLabel: (vars: Vars) => `${vars.count} điểm đo đang hoạt động`,
      empty: {
        title: "Chưa có điểm đo nào",
        description: "Sản phẩm này chưa có điểm đo được cấu hình.",
      },
      table: {
        code: "Mã điểm",
        name: "Tên điểm",
        type: "Loại đo",
        limits: "Giới hạn",
      },
      noLimits: "—",
    },
    sync: {
      title: "Kiểm tra đồng bộ theo máy",
      description:
        "Chọn một máy trong đội máy để so sánh phiên bản cấu hình điểm đo cục bộ của máy đó với phiên bản của sản phẩm này.",
      machineLabel: "Máy",
      machinePlaceholder: "Chọn máy…",
      checkBtn: "Kiểm tra",
      checking: "Đang kiểm tra…",
      checkFailed: "Kiểm tra đồng bộ thất bại.",
      noMachines: "Đội máy hiện chưa có máy AOI/AVI nào để kiểm tra.",
      resultLocalVersion: "Phiên bản cục bộ",
      resultEcosystemVersion: "Phiên bản sản phẩm",
      resultState: "Trạng thái",
      driftState: {
        in_sync: "Đã đồng bộ",
        drift: "Lệch phiên bản",
        unknown: "Máy chưa từng nhận sản phẩm này",
      },
      viewMachineLink: (vars: Vars) => `Xem máy ${vars.code}`,
      seamNote: "Kéo/đẩy đầy đủ với xem khác biệt và lịch sử đồng bộ ở trang chi tiết máy.",
    },
  },

  // Task C6 — recipe (System A: automation/IoT machine parameters) catalog list + create dialog,
  // `RecipeConfig.tsx`. Sibling workspace to `productConfig` above — same list/filter/create idioms,
  // reached via `ConfigModeToggle` rather than a second sidebar entry (see that component's own doc
  // comment).
  recipeConfig: {
    title: "Recipe (Automation/IoT)",
    description:
      "Thông số vận hành cho máy Automation/IoT — tốc độ, mô-men xiết, ngưỡng cảm biến… Bấm vào một recipe để chỉnh sửa.",
    countLabel: (vars: Vars) => `${vars.count} recipe`,
    createBtn: "Tạo recipe",
    demoOnlyNote:
      "Đẩy (push) recipe lên hệ thống thật CHỈ mô phỏng ở chế độ Demo — máy chủ AVI/AOI thật chỉ cho phép kéo (pull) recipe xuống máy (recipe do người soạn trong SYNAPSE, duyệt 2 người). Xem chi tiết ở trang từng recipe.",
    search: {
      label: "Tìm recipe",
      placeholder: "Tìm theo mã, tên hoặc loại máy…",
    },
    filters: {
      status: "Trạng thái",
      all: "Tất cả",
      clear: "Xóa bộ lọc",
    },
    shownLabel: "hiển thị",
    ofTotal: (vars: Vars) => `trên ${vars.count} recipe`,
    table: {
      code: "Mã recipe",
      name: "Tên recipe",
      machineType: "Loại máy",
      status: "Trạng thái",
      version: "Phiên bản",
      checksum: "Checksum",
      viewAction: "Xem chi tiết",
      rowAria: (vars: Vars) => `Xem chi tiết recipe ${vars.code}`,
    },
    versionShort: (vars: Vars) => `v${vars.version}`,
    empty: {
      noRecipesTitle: "Chưa có recipe nào",
      noRecipesDescription: "Danh mục recipe hiện chưa có bản ghi nào. Tạo recipe đầu tiên để bắt đầu cấu hình thông số.",
      noMatchTitle: "Không tìm thấy recipe phù hợp",
      noMatchDescription: "Không có recipe nào khớp với tìm kiếm hoặc bộ lọc hiện tại — thử xóa bộ lọc.",
    },
    createDialog: {
      title: "Tạo recipe mới",
      description: "Tạo một recipe Automation/IoT mới — có thể chỉnh payload thông số sau khi tạo.",
      codeLabel: "Mã recipe",
      codePlaceholder: "vd: SCREWDRIVE-M5",
      codeHint: "Định danh duy nhất, không phân biệt hoa/thường — không thể đổi sau khi tạo.",
      codeRequired: "Cần nhập mã recipe.",
      codeDuplicate: (vars: Vars) => `Mã "${vars.code}" đã tồn tại.`,
      nameLabel: "Tên recipe",
      nameRequired: "Cần nhập tên recipe.",
      cancel: "Hủy",
      submit: "Tạo recipe",
      submitting: "Đang tạo…",
      createFailed: "Tạo recipe thất bại.",
    },
    form: {
      nameLabel: "Tên recipe",
      machineTypeLabel: "Loại máy",
      machineTypeNone: "— Chưa đặt —",
      statusLabel: "Trạng thái",
    },
  },

  recipeConfigDetail: {
    back: "Về danh sách recipe",
    versionBadge: (vars: Vars) => `Phiên bản v${vars.version}`,
    checksumLabel: "Checksum:",
    noChecksum: "Chưa có checksum — lưu để engine tính.",
    demoOnlyNote:
      "Đẩy (push) recipe này lên hệ thống thật CHỈ mô phỏng ở chế độ Demo — máy chủ AVI/AOI thật chỉ cho phép kéo (pull) recipe xuống (recipe do người soạn trong SYNAPSE, duyệt 2 người, không cho máy tự đẩy lên). Việc kéo recipe thật diễn ra ở bảng đồng bộ theo máy (trang chi tiết máy, tab Cấu hình).",
    notFoundState: {
      title: "Không tìm thấy recipe",
      description: (vars: Vars) => `Không có recipe với mã ${vars.code}. Có thể đã bị xóa, hoặc mã đã gõ sai.`,
    },
    tabs: {
      recipe: "Recipe",
      sync: "Đồng bộ",
    },
    info: {
      title: "Thông tin recipe",
      codeLabel: "Mã recipe",
      save: "Lưu thay đổi",
      saving: "Đang lưu…",
      dirty: "Có thay đổi chưa lưu.",
      clean: "Đã lưu.",
      saveFailed: "Lưu recipe thất bại.",
      nameRequired: "Cần nhập tên recipe.",
      dangerZoneTitle: "Xóa recipe",
      dangerZoneHint: "Xóa vĩnh viễn recipe này — máy đang phân giải tới recipe này sẽ không còn thấy nó.",
      deleteBtn: "Xóa recipe",
      deleteConfirmTitle: (vars: Vars) => `Xóa recipe ${vars.code}?`,
      deleteConfirmDescription: (vars: Vars) => `Thao tác này xóa vĩnh viễn "${vars.name}". Không thể hoàn tác.`,
      deleteConfirmCancel: "Hủy",
      deleteConfirmSubmit: "Xóa vĩnh viễn",
      deleting: "Đang xóa…",
      deleteFailed: "Xóa recipe thất bại.",
    },
    payload: {
      title: "Thông số (payload)",
      description:
        "Thông số vận hành thực tế của recipe — trường có kiểu riêng theo loại máy, cộng bảng khóa/giá trị chung cho các trường khác.",
      typedTitle: "Trường theo loại máy",
      otherTitle: "Trường khác",
      otherEmpty: "Chưa có trường tùy chỉnh nào.",
      otherValueAria: (vars: Vars) => `Giá trị của ${vars.key}`,
      otherRemoveAria: (vars: Vars) => `Xóa trường ${vars.key}`,
      addKeyLabel: "Khóa mới",
      addKeyPlaceholder: "vd: notes",
      addValueLabel: "Giá trị",
      addValuePlaceholder: "Giá trị…",
      addBtn: "Thêm trường",
      addKeyRequired: "Cần nhập tên khóa.",
      addKeyDuplicate: (vars: Vars) => `Khóa "${vars.key}" đã tồn tại trong payload này.`,
      fields: {
        speedRpm: "Tốc độ",
        angleTarget: "Góc xiết mục tiêu",
        torqueTarget: "Mô-men xiết mục tiêu",
        torqueTolerance: "Dung sai mô-men xiết",
        torqueUnit: "Đơn vị mô-men xiết",
        screwCount: "Số vít",
        clampTimeMs: "Thời gian giữ kẹp",
        sampleIntervalMs: "Chu kỳ lấy mẫu",
        thresholdLow: "Ngưỡng dưới",
        thresholdHigh: "Ngưỡng trên",
      },
    },
    sync: {
      title: "Kiểm tra đồng bộ theo máy",
      description: "Chọn một máy Automation/IoT để xem recipe hệ thống mô phỏng đang phân giải cho loại máy đó.",
      machineLabel: "Máy",
      machinePlaceholder: "Chọn máy…",
      checkBtn: "Kiểm tra",
      checking: "Đang kiểm tra…",
      checkFailed: "Kiểm tra đồng bộ thất bại.",
      noMachines: "Đội máy hiện chưa có máy Automation/IoT nào để kiểm tra.",
      resultState: "Trạng thái",
      resultResolvedCode: "Recipe phân giải được",
      resultResolvedBy: "Phân giải theo",
      resolvedBy: {
        machine: "Riêng theo máy",
        machineType: "Theo loại máy",
        none: "Không có",
      },
      resultLocalVersion: "Phiên bản cục bộ (máy)",
      resultEcosystemVersion: "Phiên bản hệ thống",
      differentCodeNote: (vars: Vars) =>
        `Máy ${vars.machineCode} phân giải tới recipe "${vars.resolvedCode}" — khác với recipe đang xem.`,
      noRecipeResolved: "Máy này chưa phân giải được recipe nào.",
      viewMachineLink: (vars: Vars) => `Xem máy ${vars.code}`,
      seamNote: "Kéo đầy đủ với lịch sử đồng bộ ở trang chi tiết máy.",
    },
  },

  // Task C5 — measurement-point editor (board image-overlay canvas + full-spec point form +
  // fiducials/variants), the "Điểm đo" tab body in ProductConfigDetail.tsx.
  pointsEditor: {
    title: "Điểm đo & bản đồ ảnh",
    addBtn: "Thêm điểm đo",
    includeDeletedLabel: "Hiện điểm đã xóa",
    canvas: {
      hint: "Bấm vào ảnh để thêm điểm đo tại vị trí đó — bấm vào một điểm để chỉnh sửa.",
      noImageCaption: "Chưa có ảnh tham chiếu",
      unplacedNote: (vars: Vars) => `${vars.count} điểm chưa xác định vị trí trên ảnh — chỉnh trong danh sách bên dưới.`,
      ariaLabel: (vars: Vars) => `Bản đồ điểm đo — ${vars.count} điểm đang hiển thị`,
      pointAria: (vars: Vars) => `Điểm đo ${vars.code} — ${vars.name}`,
      figTitle: "HÌNH 02 — SƠ ĐỒ THAM CHIẾU BO MẠCH",
      dimensionUnit: "PX",
    },
    list: {
      actionsHeader: "Thao tác",
      inactiveTag: "Đã tắt",
      deletedTag: "Đã xóa",
      deleteAria: (vars: Vars) => `Xóa điểm đo ${vars.code}`,
    },
    form: {
      newTitle: "Điểm đo mới",
      editTitle: (vars: Vars) => `Chỉnh sửa ${vars.code}`,
      codeLabel: "Mã điểm đo",
      codeLocked: "Không thể đổi mã sau khi đã tạo.",
      codeRequired: "Cần nhập mã điểm đo.",
      codeDuplicate: (vars: Vars) => `Mã "${vars.code}" đã tồn tại trong sản phẩm này.`,
      nameLabel: "Tên điểm đo",
      nameRequired: "Cần nhập tên điểm đo.",
      descriptionLabel: "Mô tả",
      typeLabel: "Loại đo",
      typeCodeLabel: "Mã loại đo (measurementTypeCode)",
      unitLabel: "Đơn vị",
      orderIndexLabel: "Thứ tự",
      activeLabel: "Đang hoạt động",
      sections: {
        basic: "Cơ bản",
        limits: "Giới hạn 2D",
        position: "Vị trí & hình",
        threeD: "3D / Hàn / X-ray",
        image: "Ảnh tham chiếu",
        lighting: "Chiếu sáng",
      },
      limits: {
        nominalLabel: "Giá trị danh nghĩa",
        lowerLabel: "Giới hạn dưới (LSL)",
        upperLabel: "Giới hạn trên (USL)",
        toleranceModeLabel: "Chế độ dung sai",
        toleranceModeNone: "— Không đặt —",
        tolPlusLabel: "Dung sai (+)",
        tolMinusLabel: "Dung sai (−)",
        orderError: "Giới hạn dưới phải ≤ giá trị danh nghĩa ≤ giới hạn trên.",
      },
      position: {
        normalizedXLabel: "Vị trí chuẩn hóa X (0–1)",
        normalizedYLabel: "Vị trí chuẩn hóa Y (0–1)",
        normalizedRangeError: "Giá trị chuẩn hóa phải trong khoảng 0–1.",
        positionXLabel: (vars: Vars) => `Vị trí X (${vars.unit})`,
        positionYLabel: (vars: Vars) => `Vị trí Y (${vars.unit})`,
        radiusLabel: "Bán kính",
        normalizedRadiusLabel: "Bán kính chuẩn hóa (0–1)",
        cropWidthLabel: "Chiều rộng crop (px)",
        cropHeightLabel: "Chiều cao crop (px)",
        shapeLabel: "Hình dạng",
        geometryLabel: "Hình học (JSON)",
        geometryHint: "JSON tùy theo hình dạng, vd. {\"width\":36,\"height\":18}. Để trống nếu không cần.",
        geometryInvalid: "JSON hình học không hợp lệ.",
      },
      threeD: {
        positionZLabel: "Vị trí Z",
        heightGroupLabel: "Chiều cao",
        areaGroupLabel: "Diện tích",
        volumeGroupLabel: "Thể tích",
        minLabel: "Tối thiểu",
        maxLabel: "Tối đa",
        nominalLabel: "Danh nghĩa",
        unitLabel: "Đơn vị",
        coplanarityMaxLabel: "Đồng phẳng tối đa",
        warpageMaxLabel: "Cong vênh tối đa",
        voidPctMaxLabel: "% Rỗng tối đa",
        offsetXMaxLabel: "Lệch X tối đa",
        offsetYMaxLabel: "Lệch Y tối đa",
        tiltMaxLabel: "Nghiêng tối đa",
        thicknessMinLabel: "Độ dày tối thiểu",
        thicknessMaxLabel: "Độ dày tối đa",
        criteriaLabel: "Tiêu chí khác (JSON)",
        criteriaHint: "Tiêu chí đạt/không đạt bổ sung, vd. {\"expectPresence\":true}. Để trống nếu không cần.",
        criteriaInvalid: "JSON tiêu chí không hợp lệ.",
      },
      image: {
        previewAlt: "Xem trước ảnh điểm đo",
        urlPlaceholder: "URL ảnh, hoặc tải tệp lên bên dưới…",
        uploadBtn: "Tải ảnh lên",
        removeBtn: "Bỏ ảnh",
        tooLarge: "Ảnh quá lớn (tối đa 5 MB).",
        readFailed: "Không thể đọc tệp ảnh.",
      },
      lighting: {
        shotTitle: (vars: Vars) => `Lần chụp #${vars.index}`,
        removeShotAria: (vars: Vars) => `Xóa lần chụp ${vars.index}`,
        addShotBtn: "Thêm lần chụp",
        empty: "Chưa có lần chụp nào.",
        nameLabel: "Tên",
        lightSourceLabel: "Nguồn sáng",
        colorLabel: "Màu",
        colorHexLabel: "Mã màu (hex)",
        intensityLabel: "Cường độ (%)",
        angleLabel: "Góc (độ)",
        exposureLabel: "Phơi sáng (µs)",
        gainLabel: "Gain",
        focusOffsetLabel: "Lệch tiêu cự (µm)",
        filterLabel: "Kính lọc quang học",
        purposeLabel: "Mục đích",
      },
      save: "Lưu điểm đo",
      saving: "Đang lưu…",
      create: "Tạo điểm đo",
      creating: "Đang tạo…",
      cancelNew: "Hủy điểm mới",
      dirtyHint: "Có thay đổi chưa lưu.",
      cleanHint: "Đã lưu.",
      deleteBtn: "Xóa điểm đo",
      deleteConfirmTitle: (vars: Vars) => `Xóa điểm đo ${vars.code}?`,
      deleteConfirmDescription: (vars: Vars) => `Điểm đo "${vars.name}" sẽ được đánh dấu đã xóa (vẫn giữ lại để đồng bộ). Không thể hoàn tác trên giao diện này.`,
      deleteConfirmCancel: "Hủy",
      deleteConfirmSubmit: "Xóa điểm đo",
      deleting: "Đang xóa…",
      noSelection: {
        title: "Chưa chọn điểm đo",
        description: "Chọn một điểm trên ảnh hoặc trong danh sách, hoặc bấm “Thêm điểm đo”.",
      },
    },
    fiducials: {
      title: "Fiducial",
      description: "Điểm mốc căn chỉnh dùng để định vị ảnh trước khi đo — vị trí chuẩn hóa (0–1) trên ảnh tham chiếu.",
      addBtn: "Thêm fiducial",
      empty: "Chưa có fiducial nào.",
      editAria: (vars: Vars) => `Sửa fiducial ${vars.code}`,
      deleteAria: (vars: Vars) => `Xóa fiducial ${vars.code}`,
      table: {
        code: "Mã",
        name: "Tên",
        type: "Loại",
        position: "Vị trí chuẩn hóa",
        actions: "Thao tác",
      },
      dialog: {
        addTitle: "Thêm fiducial",
        editTitle: "Sửa fiducial",
        codeLabel: "Mã fiducial",
        codeRequired: "Cần nhập mã fiducial.",
        codeDuplicate: (vars: Vars) => `Mã "${vars.code}" đã tồn tại.`,
        nameLabel: "Tên",
        typeLabel: "Loại",
        normalizedXLabel: "X chuẩn hóa (0–1)",
        normalizedYLabel: "Y chuẩn hóa (0–1)",
        cancel: "Hủy",
        submit: "Lưu fiducial",
        submitting: "Đang lưu…",
      },
      deleteConfirmTitle: (vars: Vars) => `Xóa fiducial ${vars.code}?`,
      deleteConfirmDescription: "Thao tác này lưu ngay lập tức, không thể hoàn tác.",
      deleteConfirmCancel: "Hủy",
      deleteConfirmSubmit: "Xóa fiducial",
    },
    variants: {
      title: "Biến thể",
      description: "Biến thể sản phẩm (vd. REV-B) — mỗi biến thể có thể override một số điểm đo so với biến thể gốc (BASE).",
      addBtn: "Thêm biến thể",
      empty: "Chưa có biến thể nào.",
      baseYes: "Gốc (BASE)",
      baseNo: "—",
      table: {
        code: "Mã",
        name: "Tên",
        base: "Gốc?",
        version: "Phiên bản",
        overrides: "Số override",
      },
      dialog: {
        addTitle: "Thêm biến thể",
        codeLabel: "Mã biến thể",
        codeRequired: "Cần nhập mã biến thể.",
        codeDuplicate: (vars: Vars) => `Mã "${vars.code}" đã tồn tại.`,
        nameLabel: "Tên",
        cancel: "Hủy",
        submit: "Tạo biến thể",
        submitting: "Đang tạo…",
      },
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
      progressAria: "Tiến trình thêm máy",
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
    theme: {
      title: "Giao diện",
      radioGroupAria: "Chọn giao diện",
      appliesImmediately: "Áp dụng ngay lập tức — không cần bấm Lưu.",
    },
    connection: {
      title: "Kết nối máy chủ",
      serverUrlLabel: "Địa chỉ máy chủ (Server URL)",
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

  // WS2-T2 (docs/PRODUCTION_UI_DESIGN.md §2.4) — the Live-mode "connect to ecosystem" gate that
  // Dashboard/Machines show instead of an empty/meaningless local fleet grid whenever this deployment
  // hasn't reached a real ST4I server yet. Never rendered in Demo mode (see `useEcosystemConnection`
  // in `lib/api.ts`) — Demo's fabricated fleet is legitimately populated, nothing to connect to.
  ecosystemConnect: {
    title: "Kết nối hệ sinh thái",
    description:
      "Máy đang ở chế độ Live nhưng chưa nối được hệ sinh thái ST4I thật — nhập địa chỉ máy chủ bên dưới rồi kiểm tra kết nối để xem đội máy thật.",
    statusLabel: "Trạng thái kết nối",
    status: {
      idle: "Chưa kiểm tra",
      testing: "Đang kiểm tra…",
      connected: "Đã kết nối",
      failed: "Không kết nối được",
    },
    emptyUrlHint: "Nhập địa chỉ máy chủ hệ sinh thái để bắt đầu.",
    failedHint: "Máy chủ không phản hồi — kiểm tra địa chỉ, mạng, hoặc thử lại.",
    saveAndTestBtn: "Lưu & kiểm tra",
    saving: "Đang lưu…",
    retryBtn: "Thử lại",
    retrying: "Đang thử…",
    registerCta: "Đăng ký / nhận máy này",
    settingsCta: "Mở Cài đặt kết nối",
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

  // Task C7 — per-machine config-sync workspace (replaces the old generic "sync recipe" stub):
  // version/drift header, field-level diff BEFORE apply, pull/push with a guarded confirm, governance
  // + conflict surfacing (never a plain "success" when limits were blocked), sync history. Points
  // (AOI/AVI, System B) vs recipe (Automation/IoT, System A) share this one namespace.
  configSyncPanel: {
    title: "Đồng bộ cấu hình",
    description:
      "Kéo (pull) cấu hình từ hệ sinh thái về máy hoặc đẩy (push) thay đổi cục bộ lên — xem khác biệt trước khi áp dụng, kiểm tra quản trị ngưỡng/xung đột và lịch sử đầy đủ.",
    modeLabel: "Đang đồng bộ với",
    mode: {
      Live: "Live — máy chủ ST4I thật",
      Demo: "Demo — hệ sinh thái mô phỏng",
      Auto: "Tự động — Demo dự phòng (chưa cấu hình máy chủ/khóa)",
    },
    refreshBtn: "Làm mới",
    refreshing: "Đang làm mới…",
    checkFailed: "Kiểm tra đồng bộ thất bại.",
    connectivityError: "Không thể kiểm tra đồng bộ — kiểm tra kết nối engine.",

    products: {
      title: "Phiên bản theo sản phẩm",
      empty: "Hệ sinh thái chưa có sản phẩm nào để đồng bộ.",
      localVersionShort: (vars: Vars) => `Cục bộ v${vars.version}`,
      localVersionNone: "Máy chưa có",
      ecosystemVersionShort: (vars: Vars) => `Hệ thống v${vars.version}`,
      selectAria: (vars: Vars) => `Xem chi tiết đồng bộ sản phẩm ${vars.code}`,
    },

    driftState: {
      in_sync: "Đã đồng bộ",
      drift: "Lệch phiên bản",
      unknown: "Máy chưa từng nhận",
    },

    detail: {
      versionHeading: (vars: Vars) => `${vars.code} — cục bộ ${vars.local} → hệ thống v${vars.eco}`,
      noLocalVersion: "chưa có",
      imageIdentityLabel: "Định danh ảnh tham chiếu",
      imageIdentityNone: "Chưa có ảnh tham chiếu.",
      pointsChecksumLocalLabel: "Checksum nội dung (cục bộ)",
      pointsChecksumEcosystemLabel: "Checksum nội dung (hệ thống)",
      pullBtn: "Kéo về máy",
      pulling: "Đang kéo…",
      pullFailed: "Kéo cấu hình thất bại.",
      pushBtn: "Đẩy lên hệ thống",
      pushDisabledHint: "Máy chưa có sản phẩm này — kéo về trước khi đẩy lên.",
    },

    diff: {
      title: "Khác biệt trước khi áp dụng",
      loading: "Đang tải khác biệt…",
      failed: "Không tải được khác biệt.",
      upToDate: "Không có khác biệt — cấu hình đã đồng bộ với hệ thống.",
      versionSame: "Cùng phiên bản",
      versionEcosystemAhead: (vars: Vars) => `Hệ thống trước ${vars.count} phiên bản`,
      versionLocalAhead: (vars: Vars) => `Cục bộ trước ${vars.count} phiên bản (đã sửa cục bộ, chưa đẩy lên)`,
      addedTitle: (vars: Vars) => `Điểm mới (${vars.count})`,
      addedHint: "Chỉ có trên hệ thống — sẽ được thêm vào máy khi kéo về.",
      removedTitle: (vars: Vars) => `Điểm đã xóa (${vars.count})`,
      removedHint: "Đã bị đánh dấu xóa trên hệ thống — sẽ bị xóa khỏi máy khi kéo về.",
      changedTitle: (vars: Vars) => `Điểm thay đổi (${vars.count})`,
      fieldColumn: "Trường",
      localColumn: "Cục bộ (máy)",
      ecosystemColumn: "Hệ thống",
      noValue: "—",
      yes: "Có",
      no: "Không",
      imageBefore: "Ảnh cục bộ",
      imageAfter: "Ảnh hệ thống",
      fields: {
        name: "Tên",
        description: "Mô tả",
        measurementType: "Loại đo",
        measurementTypeCode: "Mã loại đo",
        unit: "Đơn vị",
        lowerLimit: "Giới hạn dưới (LSL)",
        upperLimit: "Giới hạn trên (USL)",
        nominalValue: "Giá trị danh nghĩa",
        toleranceMode: "Chế độ dung sai",
        tolPlus: "Dung sai +",
        tolMinus: "Dung sai -",
        positionX: "Vị trí X",
        positionY: "Vị trí Y",
        radius: "Bán kính",
        normalizedX: "Vị trí X (chuẩn hóa)",
        normalizedY: "Vị trí Y (chuẩn hóa)",
        normalizedRadius: "Bán kính (chuẩn hóa)",
        cropWidth: "Chiều rộng vùng cắt",
        cropHeight: "Chiều cao vùng cắt",
        orderIndex: "Thứ tự",
        shape: "Hình dạng",
        isActive: "Đang hoạt động",
        referenceImageUrl: "Ảnh tham chiếu",
        geometry: "Hình học (JSON)",
        cells: "Ô lưới mảng (JSON)",
        positionZ: "Vị trí Z",
        heightMin: "Chiều cao tối thiểu",
        heightMax: "Chiều cao tối đa",
        heightNominal: "Chiều cao danh nghĩa",
        heightUnit: "Đơn vị chiều cao",
        areaMin: "Diện tích tối thiểu",
        areaMax: "Diện tích tối đa",
        areaNominal: "Diện tích danh nghĩa",
        areaUnit: "Đơn vị diện tích",
        volumeMin: "Thể tích tối thiểu",
        volumeMax: "Thể tích tối đa",
        volumeNominal: "Thể tích danh nghĩa",
        volumeUnit: "Đơn vị thể tích",
        coplanarityMax: "Độ đồng phẳng tối đa",
        warpageMax: "Độ vênh tối đa",
        voidPctMax: "Tỷ lệ rỗng khí tối đa (%)",
        offsetXMax: "Sai lệch X tối đa",
        offsetYMax: "Sai lệch Y tối đa",
        tiltMax: "Độ nghiêng tối đa",
        thicknessMin: "Độ dày tối thiểu",
        thicknessMax: "Độ dày tối đa",
        criteria: "Tiêu chí (JSON)",
        lighting: "Công thức chiếu sáng (JSON)",
      },
    },

    pullResult: {
      title: "Kết quả kéo về",
      summary: (vars: Vars) => `Đã áp dụng: v${vars.from} → v${vars.to}`,
      pointsApplied: "Điểm đang hoạt động",
      pointsRemoved: "Điểm đã xóa",
      notApplied: "Chưa áp dụng.",
    },

    pushConfirm: {
      title: (vars: Vars) => `Đẩy "${vars.code}" lên hệ thống?`,
      liveWarning: "Chế độ LIVE — thao tác này GHI vào hệ sinh thái ST4I THẬT, không thể hoàn tác từ máy này.",
      autoNote:
        "Chế độ Tự động — có thể đang ghi vào máy chủ ST4I thật nếu đã cấu hình máy chủ/khóa; nếu chưa, sẽ ghi vào hệ sinh thái Demo mô phỏng.",
      demoNote: "Chế độ Demo — thao tác chỉ ghi vào hệ sinh thái mô phỏng cục bộ, an toàn để thử.",
      summary: (vars: Vars) =>
        `Sẽ đẩy toàn bộ ${vars.count} điểm đo đang hoạt động của "${vars.code}" (phiên bản cục bộ v${vars.version}) lên hệ thống.`,
      governanceNote:
        "Nếu sản phẩm không ở trạng thái “Đang phát triển”, thay đổi giới hạn (LSL/USL) có thể bị quản trị ngưỡng chặn — chỉ hình học và ảnh được đồng bộ trong trường hợp đó.",
      cancel: "Hủy",
      submit: "Xác nhận đẩy lên",
      submitting: "Đang đẩy…",
    },

    pushResult: {
      title: "Kết quả đẩy lên",
      versionBump: (vars: Vars) => `v${vars.from} → v${vars.to}`,
      created: "Đã tạo",
      updated: "Đã cập nhật",
      pointsFailed: "Lỗi",
      staleConflicts: "Xung đột (ghi cũ)",
      blindOverwrites: "Ghi đè không khóa phiên bản",
      limitBlockedBanner:
        "Giới hạn đã duyệt (LSL/USL) bị quản trị ngưỡng CHẶN — chỉ hình học/ảnh/tên được đồng bộ. Sửa giới hạn phải qua quy trình duyệt trong SYNAPSE.",
      conflictBanner: (vars: Vars) => `${vars.count} điểm bị xung đột ghi cũ (stale write) — không bị ghi đè.`,
      notConfirmed: "Đẩy lên cần xác nhận — không có gì được gửi đi.",
      pointsTitle: "Kết quả theo điểm",
      pointStatus: {
        created: "Đã tạo",
        updated: "Đã cập nhật",
        conflict: "Xung đột",
        failed: "Lỗi",
      },
      pointLimitBlocked: "Giới hạn bị chặn",
    },

    history: {
      title: "Lịch sử đồng bộ",
      empty: "Chưa có lần đồng bộ nào cho máy này.",
      columnOp: "Thao tác",
      columnCode: "Mã",
      columnVersion: "Phiên bản",
      columnStatus: "Trạng thái",
      columnTime: "Thời gian",
      op: {
        pull: "Kéo về",
        push: "Đẩy lên",
      },
      status: {
        success: "Thành công",
        failed: "Thất bại",
      },
      versionCell: (vars: Vars) => `v${vars.from} → v${vars.to}`,
      detailsLabel: "Chi tiết kỹ thuật",
      loading: "Đang tải lịch sử…",
      failed: "Không tải được lịch sử.",
    },

    recipe: {
      versionHeading: (vars: Vars) => `${vars.code} — cục bộ ${vars.local} → hệ thống v${vars.eco}`,
      resolvedByLabel: "Phân giải theo",
      resolvedBy: {
        machine: "Riêng theo máy",
        machineType: "Theo loại máy",
        none: "Không có",
      },
      checksumLabel: "Checksum (bản cục bộ)",
      noneResolved: "Chưa có recipe/thông số nào phân giải được cho loại máy của máy này.",
      pullBtn: "Kéo về máy",
      pulling: "Đang kéo…",
      pullFailed: "Kéo recipe thất bại.",
      pushUnavailable:
        "Đẩy recipe lên hệ thống thật không khả dụng — recipe do người soạn trong SYNAPSE (duyệt 2 người). Có thể thử đẩy ở chế độ Demo trong khu vực soạn recipe.",
      viewRecipeLink: (vars: Vars) => `Xem recipe ${vars.code}`,
    },
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
    passRateNoDataAria: "Chưa có dữ liệu tỷ lệ đạt — máy chưa chạy chu kỳ nào",
    passRateAria: (vars: Vars) => `Tỷ lệ đạt ${vars.pct}%`,
  },

  // H2 — Machine HMI operator panel (`/hmi/:code`, docs/HMI_DESIGN_SPEC.md). `readout`/`schematic`
  // labels are read directly (not swapped) — Readout/Sheet's `labelEn`/`titleEn` are resolved by
  // looking this SAME key up in the other dictionary (see `components/hmi/bilingual.ts`), the same
  // idiom Sidebar.tsx's `resolveLabel` already uses for nav gloss.
  hmi: {
    entryButton: "Bảng điều khiển máy",
    entryButtonAria: (vars: Vars) => `Mở bảng điều khiển máy ${vars.code}`,
    back: "Về chi tiết máy",
    shift: (vars: Vars) => `CA ${vars.n}`,

    // Task 4 — the tab rail HMI_DESIGN_SPEC.md §8.1 has always reserved a row for, directly under the
    // nameplate, but never built until now (`components/hmi/TabRail.tsx`).
    tabs: {
      railAria: "Chuyển tab bảng điều khiển",
      operation: "Vận hành",
      settings: "Cài đặt",
    },

    status: {
      estop: "DỪNG KHẨN CẤP",
      // Nameplate lamp sub-line (H2b) — deliberately keyed off OPERATIONAL state (is the fleet
      // actually turning), not the lamp's own quality color, so a last-cycle FAIL result (which
      // colors the lamp "fault") doesn't misreport "Stopped" while the fleet keeps cycling. Only
      // `Hmi.tsx`'s own `estopEngaged`/`running` booleans choose between these three — see its
      // `lampSub` comment.
      sub: {
        run: "Đang vận hành",
        fault: "Đã dừng",
        idle: "Chờ lệnh",
      },
    },

    // H5 — nameplate connectivity chip (layout gap 4): reuses the SAME WS trace-stream connection
    // this panel already opens for the system log (`useInspectorStream`, lifted to `Hmi.tsx` and
    // passed down) — this is an honest reflection of whether THIS browser tab's live feed is up, not
    // a synthetic "always ONLINE" decoration.
    connectivity: {
      online: "TRỰC TUYẾN",
      connecting: "ĐANG KẾT NỐI",
      offline: "MẤT KẾT NỐI",
    },

    controls: {
      title: "Điều khiển vật lý",
      start: "BẮT ĐẦU",
      pause: "TẠM DỪNG",
      reset: "ĐẶT LẠI",
      estop: "DỪNG KHẨN",
      estopBanner: "ĐANG DỪNG KHẨN CẤP",
      estopHint: "Nhấn ĐẶT LẠI để gỡ khóa điều khiển",
    },

    log: {
      title: "Nhật ký hệ thống",
      empty: "Chưa có sự kiện nào.",
      estopEngaged: "DỪNG KHẨN — đã dừng fleet, khóa điều khiển",
      estopFailed: "LỖI DỪNG KHẨN — máy chủ không xác nhận đã dừng",
      estopReset: "ĐẶT LẠI — đã gỡ khóa dừng khẩn cấp",
      estopResetFailed: "LỖI ĐẶT LẠI — dừng khẩn cấp vẫn đang khóa",
      fleetStarted: "Đã khởi động fleet",
      fleetPaused: "Đã tạm dừng fleet",
    },

    progress: {
      title: "Tiến độ sản xuất",
      okLabel: "ĐẠT",
      ngLabel: "LỖI",
      totalLabel: "TỔNG",
      packetsLabel: "GÓI TIN",
    },

    schematic: {
      figAutomation: "HÌNH 01 — TRẠM TỰ ĐỘNG / GẮN VÍT",
      figAoi: "HÌNH 01 — TRẠM AOI / AVI",
      figIot: "HÌNH 01 — NÚT CẢM BIẾN IoT",
      idleNote: "Máy đang dừng — sơ đồ tĩnh",
      feeder: "CẤP VÍT",
      // I-6 — the engine reports no real feeder-inventory signal; this countdown is a deterministic
      // decoration derived from the cycle counter (`derive.ts`'s `feederRemaining`), not a live sensor
      // reading. "(MÔ PHỎNG)" ("simulated") makes that unmistakable right on the schematic instead of
      // only in a code comment — spec §7 still wants the feeder shown, just honestly labeled.
      remaining: "CÒN LẠI (MÔ PHỎNG)",
      feederDisclosure: "Số vít còn lại là ước tính mô phỏng theo số chu kỳ — không phải tín hiệu tồn kho thật từ máy.",
      zAxis: "TRỤC Z",
      node: "NÚT CẢM BIẾN",
      uplink: "TRẠM THU",
      noProduct: "Chưa gán sản phẩm cấu hình",
      // I-1/I-2 — reworded from "N điểm đo" ("N points measured", easily confused with the readout
      // grid's own "Điểm đã kiểm" tile, a DIFFERENT number — the engine's raw per-cycle board-point
      // count, not the product's configured point count these dots plot). "Vị trí cấu hình" ("N
      // configured positions") is unambiguous: this is catalogue geometry, not a live measurement.
      pointsSynced: (vars: Vars) => `${vars.count} vị trí cấu hình`,
      // I-1 — the per-point RESULT colour was removed (see `AoiSchematic.tsx`'s header comment); this
      // is the honest replacement: the real per-cycle NG count, disclosed as an aggregate rather than
      // implied to be located at any specific dot above.
      aggregateDefects: (vars: Vars) => `${vars.count} lỗi (tổng hợp)`,
      // Full disclosure text, carried only in the caption's `<title>` tooltip (unbounded length) —
      // the short visible line above already implies it via wording, this spells it out for anyone
      // who hovers/inspects.
      aggregateDisclosure: "Vị trí: đúng cấu hình sản phẩm · Kết quả lỗi: tổng hợp toàn máy, không gán vào từng vị trí",
      configuredPosition: (vars: Vars) => `${vars.code} — vị trí cấu hình (không phải kết quả đo)`,
      // WS3-T2 — the living twin closes the exact gap `aggregateDefects`/`aggregateDisclosure` above
      // exist for: once a real `CyclePlan` is in hand, each dot's colour IS its own real result, so
      // the caption can honestly say so instead of falling back to a machine-wide aggregate.
      livePointResults: (vars: Vars) => `${vars.ng}/${vars.total} điểm NG — đúng vị trí đo thực`,
      livePointDisclosure:
        "Vị trí và kết quả đều lấy trực tiếp từ chu trình đo thực — mỗi điểm sáng đúng theo kết quả của chính nó, không còn là tổng hợp.",
      // WS3-T2 — accessible `<title>` on a dot the twin has actually lit by its own real result (as
      // opposed to `configuredPosition` above, used for a dot that's real POSITION but no result yet
      // — pending this cycle, or no plan at all).
      measuredResult: (vars: Vars) => `${vars.code} — ${vars.result}`,
    },

    readoutPanel: {
      title: "Thông số vận hành",
    },

      // H5b — `metric`/`configState`/`passRate` shortened: live-reproduced ellipsis truncation at the
      // 1280×800 floor ("CHỈ SỐ QUY T…", "TRẠNG THÁI CẤ…", "TỶ LỆ …") — the readout grid's narrowest
      // tiles at that width (~160–200px) couldn't fit the old, longer strings even after switching the
      // gloss to its own line (`ReadoutGrid.tsx`'s `labelLayout="stack"`). Meaning stays legible via
      // the tile's own uppercase EN gloss + numeric context (e.g. "Tỷ lệ" beside a "%" figure).
    readout: {
      cycles: "Chu kỳ",
      passRate: "Tỷ lệ",
      cycleRate: "Tốc độ chu kỳ",
      cycleTime: "Thời gian chu kỳ",
      metric: "Chỉ số",
      driver: "Driver",
      configState: "Cấu hình",
      boards: "Số bo mạch",
      pointsInspected: "Điểm đã kiểm",
      fpy: "FPY",
      defects: "Số lỗi",
      lastDefect: "Lỗi gần nhất",
      product: "Sản phẩm",
      packets: "Gói tin",
      sampleRate: "Tốc độ mẫu",
      signal: "Tín hiệu",
      observedSpan: "Khoảng quan sát",
      status: "Trạng thái",
      // I-4 — IoT machines have no device_settings recipe in this fleet, so the checksum-based drift
      // check this tile shows for the other two classes can never resolve; an explicit "not
      // applicable" reads honestly, unlike a bare em dash (which looks identical to "still waiting
      // for data").
      configStateNotApplicable: "KHÔNG ÁP DỤNG",
      // I-5 — same "not applicable, not waiting" treatment as configStateNotApplicable (I-4): IoT
      // sensor nodes have no pass/fail verdict, so this tile can never resolve to a real number.
      passRateNotApplicable: "KHÔNG ÁP DỤNG",
    },
  },

  // Task 4/5 (docs/plans/2026-07-21-machine-config.md) — machine operating-configuration: shared
  // between the HMI's CÀI ĐẶT/SETTINGS tab (`SettingsTab.tsx`, at the machine) and the machine detail
  // screen's own settings tab (`MachineSettingsPanel.tsx`, from the office) — same data source, same
  // vocabulary, per the design doc's §5.
  machineSettings: {
    title: "Cài đặt máy",
    description: "Khuyến nghị từ máy chủ — chỉnh riêng theo máy hoặc theo từng sản phẩm khi cần.",
    productLabel: "Sản phẩm",
    productSelectAria: "Chọn sản phẩm để xem cấu hình",
    noProducts: "Chưa có sản phẩm nào.",
    // Design doc §2: "Máy không chạy sản phẩm (IoT sensor/gateway): chỉ có lớp theo máy; giao diện
    // không hiện chiều sản phẩm."
    iotHint: "Máy IoT không chạy sản phẩm — mọi điều chỉnh áp dụng cho máy này.",
    baselineInfo: (vars: Vars) =>
      `Khuyến nghị v${vars.version} · ${vars.driftedCount} tham số đã chỉnh so với khuyến nghị`,
    notSupported: {
      title: "Chưa có bộ tham số vận hành",
      description: (vars: Vars) => `Loại máy "${vars.machineType}" chưa có bộ tham số vận hành cho tính năng này.`,
    },
    loadFailed: "Không thể tải cấu hình máy.",
    columns: {
      label: "Tham số",
      value: "Hiệu lực",
      range: "Dải cho phép",
      recommended: "Khuyến nghị",
      source: "Nguồn",
    },
    // The provenance indicator (design doc §5) — "Có điều chỉnh tại máy" is a NORMAL, desirable state,
    // never colored as a fault (spec §2) — see `MachineSettingsPanel.tsx`'s `PROVENANCE_TONE` map,
    // which deliberately never uses the status-fault/status-warn ramp for these three values.
    provenance: {
      baseline: "Khuyến nghị",
      machine: "Chỉnh theo máy",
      machineProduct: "Chỉnh cho sản phẩm này",
    },
    adjustedBy: (vars: Vars) => `${vars.by} · ${vars.when}`,
    adjustedByUnknown: (vars: Vars) => `${vars.when}`,
    relativeTime: {
      justNow: "vừa xong",
      minutesAgo: (vars: Vars) => `${vars.n} phút trước`,
      hoursAgo: (vars: Vars) => `${vars.n} giờ trước`,
      daysAgo: (vars: Vars) => `${vars.n} ngày trước`,
    },
    resetAction: "Về mặc định",
    resetAria: (vars: Vars) => `Đặt lại ${vars.key} về khuyến nghị`,
    editAction: "Sửa",
    editAria: (vars: Vars) => `Sửa ${vars.key}`,
    editDialog: {
      titleFor: (vars: Vars) => `Sửa ${vars.label}`,
      valueLabel: "Giá trị mới",
      rangeHint: (vars: Vars) => `Dải cho phép: ${vars.min}–${vars.max} ${vars.unit}`,
      scopeLabel: "Áp dụng cho",
      scopeMachine: "Máy này (mọi sản phẩm)",
      scopeProduct: (vars: Vars) => `Chỉ sản phẩm đang chọn — ${vars.product}`,
      noteLabel: "Ghi chú (tuỳ chọn)",
      notePlaceholder: "Vì sao chỉnh giá trị này…",
      cancel: "Huỷ",
      save: "Lưu",
      saving: "Đang lưu…",
      invalidNumber: "Nhập một số hợp lệ.",
      // Mirrors the server's OWN 400 wording (docs/plans' hard requirement: "surface that honestly")
      // — see `mc-task12-report.md`'s `torqueTarget must be between 0.10 and 20.00 Nm (got 999.00).`
      outOfRange: (vars: Vars) => `${vars.key} phải nằm trong khoảng ${vars.min}–${vars.max} ${vars.unit} (đã nhập ${vars.value}).`,
      serverErrorFallback: "Máy chủ từ chối giá trị này.",
    },
  },

  // Task 12 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md) — `/historian`, the durable
  // per-cycle result log browse/filter/export screen (`routes/Historian.tsx`).
  historian: {
    title: "Lịch sử dữ liệu",
    description:
      "Duyệt kết quả chu kỳ đã lưu trữ lâu dài trên toàn đội máy — lọc theo máy, thời gian, serial hoặc kết quả, và xuất ra CSV.",
    filters: {
      machine: "Máy",
      allMachines: "Tất cả máy",
      from: "Từ ngày",
      to: "Đến ngày",
      serial: "Serial",
      serialPlaceholder: "Tìm theo số serial…",
      verdict: "Kết quả",
      allVerdicts: "Tất cả kết quả",
      clear: "Xóa bộ lọc",
    },
    export: {
      csv: "Xuất CSV",
    },
    table: {
      time: "Thời gian",
      machine: "Máy",
      serial: "Serial",
      verdict: "Kết quả",
      keyMetric: "Chỉ số chính",
      ngPoints: "Lỗi / Điểm đo",
      genealogyAction: "Xem phả hệ",
      empty: "Không có bản ghi lịch sử nào khớp với bộ lọc hiện tại.",
      loadFailed: "Không thể tải lịch sử dữ liệu.",
    },
    pagination: {
      showing: (vars: Vars) => `Hiển thị ${vars.from}–${vars.to} trên ${vars.total} bản ghi`,
      prev: "Trước",
      next: "Sau",
    },
    genealogy: {
      title: (vars: Vars) => `Phả hệ — Serial ${vars.serial}`,
      description: "Toàn bộ bản ghi lịch sử đã ghi nhận cho serial này, trên mọi máy.",
      loading: "Đang tải phả hệ…",
      empty: "Không tìm thấy bản ghi nào cho serial này.",
      failed: "Không thể tải phả hệ.",
    },
  },

  // Task 13 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md) — `/reports`, the per-machine
  // OEE screen (`routes/Reports.tsx`). Loss is split into exactly THREE honest buckets (Downtime/
  // Speed/Quality) — never the "six big losses" framework some OEE literature uses; see
  // `OeeLossChart.tsx`'s own doc comment for why.
  reports: {
    title: "Báo cáo OEE",
    description:
      "Tính sẵn sàng, hiệu suất, chất lượng và OEE cho một máy — cùng với 3 nhóm tổn thất và mục tiêu có thể chỉnh sửa, tính trên lịch sử dữ liệu đã lưu trữ.",
    filters: {
      machine: "Máy",
      from: "Từ ngày",
      to: "Đến ngày",
    },
    export: {
      pdf: "Xuất PDF",
    },
    empty: {
      noMachines: "Chưa có máy nào trong đội máy.",
    },
    loadFailed: "Không thể tải dữ liệu OEE.",
    kpi: {
      availability: "Tính sẵn sàng",
      performance: "Hiệu suất",
      quality: "Chất lượng",
      oee: "OEE",
    },
    lossChart: {
      title: "Tổn thất OEE (3 nhóm)",
      downtime: "Tổn thất dừng máy",
      speed: "Tổn thất tốc độ",
      quality: "Tổn thất chất lượng",
      yAxisLabel: "Phút",
      tooltipMinutes: (vars: Vars) => `${vars.minutes} phút`,
      tooltipSeconds: (vars: Vars) => `${vars.seconds} giây`,
      minutesShort: (vars: Vars) => `${vars.minutes} phút`,
      total: (vars: Vars) => `Tổng tổn thất: ${vars.minutes} phút`,
    },
    targets: {
      title: "Mục tiêu OEE",
      idealCycleLabel: "Thời gian chu kỳ lý tưởng (giây)",
      ratioLabel: "Tỷ lệ sản xuất theo kế hoạch (0–1)",
      overridden: "Đã tuỳ chỉnh",
      baseline: "Mặc định",
      save: "Lưu mục tiêu",
      saving: "Đang lưu…",
      invalidNumber: "Nhập một số hợp lệ cho cả hai trường.",
      saveFailedFallback: "Máy chủ từ chối giá trị này.",
      loadFailed: "Không thể tải mục tiêu OEE.",
    },
  },

  // WS-D-D7 — `/users` (`routes/Users.tsx`, Admin-only): roster table, add-user/reset-password
  // dialogs, per-row role/disable-enable actions, and the client-side "not authorized"/last-admin-
  // guard copy (the REAL enforcement is server-side — see `UserEndpoints.cs` — these are just the
  // friendlier front-line messages for the common case).
  users: {
    title: "Người dùng",
    description: "Quản lý tài khoản đăng nhập cục bộ — vai trò, khóa/mở khóa, đặt lại mật khẩu. Chỉ Admin mới thấy màn hình này.",
    addUser: "Thêm người dùng",
    table: {
      username: "Tên đăng nhập",
      role: "Vai trò",
      displayName: "Tên hiển thị",
      status: "Trạng thái",
      lastLogin: "Đăng nhập gần nhất",
      actions: "Hành động",
      roleAria: (vars: Vars) => `Vai trò của ${vars.username}`,
    },
    status: {
      enabled: "Đang hoạt động",
      disabled: "Đã khóa",
    },
    never: "Chưa từng",
    actions: {
      disable: "Khóa",
      enable: "Mở khóa",
      resetPassword: "Đặt lại mật khẩu",
    },
    lastAdminGuard: "Không thể thực hiện — đây là Admin cuối cùng đang hoạt động, thao tác này sẽ khiến không ai quản trị được hệ thống.",
    createDialog: {
      title: "Thêm người dùng",
      description: "Tạo một tài khoản đăng nhập cục bộ mới.",
      usernameLabel: "Tên đăng nhập",
      usernamePlaceholder: "vd: operator1",
      passwordLabel: "Mật khẩu",
      displayNameLabel: "Tên hiển thị (tùy chọn)",
      roleLabel: "Vai trò",
      cancel: "Hủy",
      submit: "Tạo người dùng",
      submitting: "Đang tạo…",
      usernameRequired: "Cần nhập tên đăng nhập.",
      usernameDuplicate: (vars: Vars) => `Tên đăng nhập "${vars.username}" đã tồn tại.`,
      passwordTooShort: (vars: Vars) => `Mật khẩu phải có ít nhất ${vars.count} ký tự.`,
    },
    resetPasswordDialog: {
      title: (vars: Vars) => `Đặt lại mật khẩu cho ${vars.username}`,
      description: "Người dùng này sẽ cần đăng nhập lại bằng mật khẩu mới; mọi phiên đăng nhập hiện tại sẽ bị hủy.",
      newPasswordLabel: "Mật khẩu mới",
      cancel: "Hủy",
      submit: "Đặt lại mật khẩu",
      submitting: "Đang đặt lại…",
      passwordTooShort: (vars: Vars) => `Mật khẩu phải có ít nhất ${vars.count} ký tự.`,
    },
    empty: {
      title: "Chưa có người dùng nào",
      description: "Danh sách người dùng đang trống.",
    },
    notAuthorized: {
      title: "Không có quyền truy cập",
      description: "Chỉ tài khoản Admin mới có thể quản lý người dùng.",
    },
  },

  // WS-D-D8 — `/audit` (`routes/Audit.tsx`, Admin-only): paginated/filterable viewer over the
  // hash-chained audit log (D3's `GET /v1/audit`) + a "Verify chain integrity" button (D3's
  // `GET /v1/audit/verify`). `limitation.body` mirrors D3's own honest tamper-evidence wording
  // (`SqliteAuditStore`'s doc comment) — deliberately not overstated as unqualified "tamper-proof".
  audit: {
    title: "Nhật ký kiểm toán",
    description:
      "Duyệt và lọc nhật ký kiểm toán được nối chuỗi hash — mọi hành động tạo/sửa/xóa mà người dùng đã thực hiện, kèm giá trị trước/sau và mã tương quan của yêu cầu. Chỉ Admin mới thấy màn hình này.",
    filters: {
      from: "Từ ngày",
      to: "Đến ngày",
      actor: "Người thực hiện",
      actorPlaceholder: "vd: demo-admin",
      action: "Hành động",
      actionPlaceholder: "vd: user.role_change",
      target: "Đối tượng",
      targetPlaceholder: "vd: mã máy, tên đăng nhập…",
      clear: "Xóa bộ lọc",
    },
    table: {
      seq: "STT",
      time: "Thời gian",
      actor: "Người thực hiện",
      action: "Hành động",
      target: "Đối tượng",
      change: "Trước → Sau",
      correlationId: "Mã tương quan",
      viewDetail: "Xem chi tiết",
      empty: "Không có bản ghi kiểm toán nào khớp với bộ lọc hiện tại.",
      loadFailed: "Không thể tải nhật ký kiểm toán.",
    },
    pagination: {
      showing: (vars: Vars) => `Hiển thị ${vars.from}–${vars.to} trên ${vars.total} bản ghi`,
      prev: "Trước",
      next: "Sau",
    },
    detailDialog: {
      title: (vars: Vars) => `Chi tiết bản ghi #${vars.seq}`,
      description: "Giá trị trước và sau của thay đổi này, ở dạng JSON đầy đủ.",
      oldValue: "Giá trị trước",
      newValue: "Giá trị sau",
      none: "Không có giá trị được ghi nhận.",
    },
    verify: {
      button: "Kiểm tra tính toàn vẹn chuỗi",
      verifying: "Đang kiểm tra…",
      intact: (vars: Vars) => `Chuỗi còn nguyên vẹn (${vars.count} bản ghi).`,
      broken: (vars: Vars) => `Chuỗi bị đứt tại STT ${vars.seq} — ${vars.detail}`,
      failed: "Không thể kiểm tra chuỗi — kiểm tra kết nối engine.",
    },
    limitation: {
      title: "Về khả năng phát hiện giả mạo",
      body: "Phát hiện chỉnh sửa trong ứng dụng và xóa bản ghi giữa chuỗi; không chống được việc chỉnh sửa trực tiếp tệp cơ sở dữ liệu.",
    },
    notAuthorized: {
      title: "Không có quyền truy cập",
      description: "Chỉ tài khoản Admin mới có thể xem nhật ký kiểm toán.",
    },
  },

  // P2-2 (WS-J Asset Registry) — `/assets` (`routes/AssetRegistry.tsx`): the persisted asset roster
  // P2-1's backend maintains (`GET /v1/assets`), Operator-readable like the rest of the fleet screens
  // (no page-level role gate). Only the lifecycle TRANSITION control inside the detail dialog is
  // gated (`assets.detail.transitionRequiresEngineer`) — the server's own `Policies.Engineer` on
  // `PUT /v1/assets/{code}/lifecycle` is the real enforcement, this is purely a friendlier front line.
  // Deliberately its OWN `lifecycle` vocabulary, not a reuse of `lifecycleStatus` above (that dict is
  // ProductModel's development/active/eol/archived vocabulary — a different concept entirely).
  assets: {
    title: "Sổ đăng ký tài sản",
    description:
      "Danh sách các tài sản (máy) đã đăng ký trong hệ thống — mã tài sản, URN, loại thiết bị, driver và trạng thái vòng đời. Một máy được đăng ký tự động khi kết nối với engine lần đầu; chuyển đổi trạng thái vòng đời cần quyền Engineer trở lên.",
    table: {
      code: "Mã tài sản",
      urn: "URN",
      deviceClass: "Loại thiết bị",
      driverKind: "Driver",
      lifecycle: "Vòng đời",
      updated: "Cập nhật lúc",
      rowAria: (vars: Vars) => `Xem chi tiết tài sản ${vars.code}`,
      empty: "Chưa có tài sản nào được đăng ký.",
      loadFailed: "Không thể tải sổ đăng ký tài sản.",
    },
    lifecycle: {
      Provisioned: "Đã cấp phát",
      Commissioning: "Đang chạy thử",
      Active: "Đang hoạt động",
      Maintenance: "Bảo trì",
      Decommissioned: "Đã ngừng sử dụng",
    },
    detail: {
      title: (vars: Vars) => `Chi tiết tài sản ${vars.code}`,
      description: "Thông tin đầy đủ và trạng thái vòng đời hiện tại của tài sản này.",
      loadFailed: "Không thể tải chi tiết tài sản.",
      urn: "URN",
      deviceClass: "Loại thiết bị",
      driverKind: "Driver",
      machineType: "Loại máy",
      currentLifecycle: "Trạng thái hiện tại",
      checksum: "Checksum",
      checksumNone: "Chưa có checksum.",
      created: "Ngày tạo",
      updated: "Cập nhật lần cuối",
      transition: "Chuyển trạng thái vòng đời",
      transitionRequiresEngineer: "Chỉ tài khoản Engineer trở lên mới có thể chuyển trạng thái vòng đời.",
      save: "Lưu",
      saving: "Đang lưu…",
    },
  },

  // GĐ3 EC-4 (`routes/Site.tsx`, `.superpowers/sdd/2026-07-27-giaidoan3-ecosystem-connect-blueprint/
  // task-4-brief.md`) — the web page over EC-3's `/v1/site*` endpoints: this device's own identity
  // fingerprint + cert PEM (to register at a SYNAPSE Site), an Engineer-gated Site-link form (host/
  // port + paste the Site's trust PEM + enable), and a live northbound bridge-status badge. Reads are
  // Operator; only the PUT-driving form is Engineer+-gated (`site.form.readOnlyNote`), same "page open
  // to everyone, one control gated" shape `assets` above already established.
  site: {
    title: "Site / Hệ sinh thái",
    description:
      "Định danh thiết bị này để đăng ký tại một SYNAPSE Site, và (Engineer trở lên) cấu hình liên kết lên Site để đẩy dữ liệu UNS cục bộ lên hệ sinh thái cấp cao hơn.",
    identity: {
      title: "Định danh thiết bị",
      description: "Vân tay và chứng chỉ công khai của thiết bị này — dùng để đăng ký tại Site của bạn.",
      fingerprintLabel: "Vân tay thiết bị (SHA-256)",
      copyFingerprint: "Sao chép vân tay",
      pemLabel: "Chứng chỉ thiết bị (PEM)",
      showPem: "Hiện chứng chỉ",
      hidePem: "Ẩn chứng chỉ",
      copyPem: "Sao chép chứng chỉ",
      copied: "Đã sao chép.",
      copyFailed: "Không thể sao chép — hãy chọn và sao chép thủ công.",
      register: "Đăng ký định danh này tại SYNAPSE Site của bạn.",
      loadFailed: "Không thể tải định danh thiết bị.",
    },
    form: {
      title: "Kết nối Site",
      description: "Cấu hình liên kết lên SYNAPSE Site — cần dán lại chứng chỉ tin cậy của Site mỗi lần lưu.",
      hostLabel: "Địa chỉ Site (host)",
      hostPlaceholder: "site.example.com",
      portLabel: "Cổng (port)",
      trustPemLabel: "Chứng chỉ tin cậy của Site (PEM)",
      trustPemPlaceholder: "Dán chứng chỉ CA hoặc chứng chỉ tự ký của Site broker…",
      trustPemHint:
        "Vì lý do bảo mật, chứng chỉ đã lưu không bao giờ được hiển thị lại — ô này luôn để trống; muốn BẬT kết nối, hãy dán lại chứng chỉ tin cậy mỗi lần lưu, kể cả khi chỉ đổi host/cổng.",
      enabledLabel: "Bật kết nối tới Site",
      save: "Lưu",
      saving: "Đang lưu…",
      readOnlyNote: "Chỉ tài khoản Engineer trở lên mới có thể chỉnh sửa kết nối Site.",
      readOnlyHost: "Địa chỉ Site (host)",
      readOnlyPort: "Cổng (port)",
      readOnlyEnabled: "Đã bật",
      readOnlyDisabled: "Đã tắt",
    },
    status: {
      title: "Trạng thái cầu nối",
      Disabled: "Đã tắt",
      Connecting: "Đang kết nối…",
      Connected: "Đã kết nối",
      Degraded: "Suy giảm",
      Down: "Mất kết nối",
      lastError: (vars: Vars) => `Lỗi gần nhất: ${vars.error}`,
      siteVerified: (vars: Vars) => `Đã xác thực chứng chỉ Site: ${vars.fingerprint}`,
      unsDisabled:
        "Lõi UNS cục bộ đang tắt (ST4I_UNS_ENABLED=false); hãy bật lõi UNS để liên kết thiết bị này với một Site.",
    },
    errors: {
      badRequest: "Host, cổng hoặc chứng chỉ tin cậy không hợp lệ khi bật kết nối Site.",
      conflict: "Lõi UNS cục bộ đang tắt — không thể áp dụng liên kết Site.",
      forbidden: "Bạn không có quyền chỉnh sửa kết nối Site.",
      generic: "Không thể lưu kết nối Site.",
      loadFailed: "Không thể tải trạng thái kết nối Site.",
    },
    discover: {
      title: "Dò tìm Site trên mạng LAN",
      button: "Dò tìm Site",
      scanning: "Đang quét mạng LAN… (~4 giây)",
      resultsTitle: "Site tìm thấy trên mạng LAN",
      empty: "Không tìm thấy Site nào trên mạng LAN.",
      error: "Không thể quét mạng LAN để tìm Site.",
      pick: (vars: Vars) =>
        `Dùng ${vars.instanceName} (${vars.host}:${vars.port}) để điền vào ô Địa chỉ Site và Cổng`,
    },
  },

  // GĐ3 sub-4 LC-4 (`routes/AlarmCenter.tsx`, `.superpowers/sdd/2026-07-27-giaidoan3-alarms-
  // linecontroller-blueprint/task-4-brief.md`) — the operator UI over LC-1/2's ISA-18.2 alarm backbone:
  // an active-alarms table (`GET /v1/alarms`, polled) with a priority chip, an Ack action
  // (`POST /v1/alarms/{id}/ack`), a per-row detail dialog (runbook + first/last-raised + acked-by), and
  // a History tab over the paged append-only log (`GET /v1/alarms/history`). Reads are Operator (every
  // authenticated role sees the whole page); Ack is likewise Operator — the RequireRole wrap around it
  // is a structural/defense-in-depth gate only (Operator is the lowest role, so in practice every
  // signed-in user already passes it), same honest caveat the brief itself makes.
  alarms: {
    title: "Trung tâm cảnh báo",
    description:
      "Các cảnh báo đang hoạt động trong hệ thống (chính sách an toàn bị từ chối, sức khỏe driver, tỷ lệ NG) — xác nhận (Ack) để xử lý, hoặc xem lịch sử đầy đủ.",
    tabs: {
      active: "Đang hoạt động",
      history: "Lịch sử",
    },
    table: {
      priority: "Mức độ",
      source: "Nguồn",
      code: "Mã",
      message: "Nội dung",
      count: "Số lần",
      lastRaised: "Lần gần nhất",
      ack: "Xác nhận",
      acking: "Đang xác nhận…",
      viewDetail: "Xem chi tiết cảnh báo",
      empty: "Không có cảnh báo nào đang hoạt động.",
      loadFailed: "Không thể tải danh sách cảnh báo.",
    },
    priority: {
      Critical: "Nghiêm trọng",
      High: "Cao",
      Medium: "Trung bình",
      Low: "Thấp",
    },
    source: {
      Policy: "Chính sách an toàn",
      DriverHealth: "Sức khỏe driver",
      NgRate: "Tỷ lệ NG",
    },
    detail: {
      title: (vars: Vars) => `Chi tiết cảnh báo #${vars.id}`,
      description: "Thông tin đầy đủ của cảnh báo này, bao gồm hướng dẫn xử lý (runbook).",
      runbook: "Hướng dẫn xử lý",
      runbookNone: "Chưa có hướng dẫn xử lý cho cảnh báo này.",
      firstRaised: "Lần đầu phát sinh",
      lastRaised: "Lần gần nhất",
      state: "Trạng thái",
      acked: "Xác nhận",
      ackedBy: (vars: Vars) => `Đã xác nhận bởi ${vars.actor} lúc ${vars.at}`,
      ackedNone: "Chưa được xác nhận.",
    },
    state: {
      Active: "Đang hoạt động",
      Acked: "Đã xác nhận",
      Cleared: "Đã xóa",
    },
    history: {
      table: {
        time: "Thời điểm",
        event: "Sự kiện",
        key: "Khóa",
        source: "Nguồn",
        priority: "Mức độ",
        message: "Nội dung",
        actor: "Người thực hiện",
        actorNone: "Hệ thống",
        empty: "Chưa có lịch sử cảnh báo nào.",
        loadFailed: "Không thể tải lịch sử cảnh báo.",
      },
      event: {
        raised: "Phát sinh",
        cleared: "Đã xóa",
        acked: "Đã xác nhận",
      },
    },
    pagination: {
      showing: (vars: Vars) => `Hiển thị ${vars.from}–${vars.to} / ${vars.total}`,
      prev: "Trước",
      next: "Sau",
    },
  },

  // GĐ3 sub-4 LC-4 (`routes/LineControl.tsx`) — the operator UI over LC-3's supervisory PackML state
  // machine: a live state badge (`GET /v1/line`, polled) + transition-gated command buttons
  // (`POST /v1/line/{command}`) mirroring `LineController.Execute`'s own transition table, so the UI
  // never offers a command the server would reject. Abort is the one deliberate exception — styled as
  // the always-enabled emergency action, same as a real E-STOP control never being greyed out.
  line: {
    title: "Điều khiển dây chuyền",
    description:
      "Trạng thái PackML hiện tại của dây chuyền và các lệnh điều khiển (Chạy/Tạm dừng/Tiếp tục/Dừng/Dừng khẩn cấp/Đặt lại) — chỉ những lệnh hợp lệ từ trạng thái hiện tại mới có thể bấm được.",
    status: {
      title: "Trạng thái dây chuyền",
      holdReason: (vars: Vars) => `Lý do tạm dừng: ${vars.reason}`,
      pipelineLabel: "Pipeline",
      running: "Đang chạy",
      notRunning: "Không chạy",
      estopLabel: "Dừng khẩn cấp (E-STOP)",
      estopEngaged: "Đã kích hoạt",
      estopClear: "Chưa kích hoạt",
      loadFailed: "Không thể tải trạng thái dây chuyền.",
    },
    state: {
      Idle: "Chờ",
      Execute: "Đang chạy",
      Held: "Tạm dừng",
      Stopped: "Đã dừng",
      Aborted: "Đã dừng khẩn cấp",
    },
    commands: {
      title: "Lệnh điều khiển",
      start: "Chạy",
      hold: "Tạm dừng",
      unhold: "Tiếp tục",
      stop: "Dừng",
      abort: "Dừng khẩn cấp",
      reset: "Đặt lại",
      // Full accessible names (`aria-label`, not the visible button text) — the visible labels above
      // are deliberately short PackML terms, but "Dừng" alone is IDENTICAL to `shell.topBar.stop`
      // (TopBar's own Fleet-level Stop button, always visible in the same Shell chrome) — a real
      // screen-reader user hearing "Dừng" twice on this one page couldn't tell the fleet-power-switch
      // apart from the PackML line command without more context. These give every command button its
      // own unambiguous full name while the visible chrome stays terse.
      startAria: "Chạy dây chuyền",
      holdAria: "Tạm dừng dây chuyền",
      unholdAria: "Tiếp tục dây chuyền",
      stopAria: "Dừng dây chuyền",
      abortAria: "Dừng khẩn cấp dây chuyền",
      resetAria: "Đặt lại dây chuyền",
    },
    errors: {
      generic: "Không thể thực hiện lệnh — trạng thái hiện tại không hợp lệ cho lệnh này.",
    },
  },

  toast: {
    fleetStarted: "Đã chạy fleet.",
    fleetStartFailed: "Không thể chạy fleet.",
    fleetStopped: "Đã dừng fleet.",
    scenarioPresetApplied: (vars: Vars) => `Đã áp dụng preset “${vars.name}”.`,
    scenarioBurstApplied: "Đã kích hoạt Burst.",
    sitePrefilled: (vars: Vars) => `Đã điền host/cổng từ ${vars.instanceName}.`,
    settingsSaved: "Đã lưu cài đặt.",
    settingsSaveFailed: "Không thể lưu cài đặt.",
    oeeTargetsSaved: "Đã lưu mục tiêu OEE.",
    oeeTargetsSaveFailed: "Không thể lưu mục tiêu OEE.",
    onboardingKeyStored: (vars: Vars) => `Đã lưu khóa cho ${vars.code}.`,
    configPulled: (vars: Vars) => `Đã kéo cấu hình cho ${vars.code} (v${vars.version}).`,
    configPullFailed: "Kéo cấu hình thất bại.",
    configPushed: (vars: Vars) => `Đã đẩy cấu hình cho ${vars.code} (v${vars.version}).`,
    configPushBlocked: (vars: Vars) => `Đã đẩy cấu hình cho ${vars.code} — một số giới hạn bị quản trị ngưỡng chặn.`,
    configPushConflicts: (vars: Vars) =>
      `Đã đẩy cấu hình cho ${vars.code} — ${vars.count} điểm bị xung đột ghi cũ, không được ghi đè.`,
    configPushFailed: "Đẩy cấu hình thất bại.",
    machineSettingUpdated: (vars: Vars) => `Đã cập nhật ${vars.key}.`,
    machineSettingUpdateFailed: "Không thể cập nhật tham số.",
    machineSettingReset: (vars: Vars) => `Đã đặt lại ${vars.key} về khuyến nghị.`,
    machineSettingResetFailed: "Không thể đặt lại tham số.",
    keyCopied: "Đã sao chép khóa.",
    productCreated: (vars: Vars) => `Đã tạo sản phẩm ${vars.code}.`,
    productSaved: "Đã lưu sản phẩm.",
    productDeleted: (vars: Vars) => `Đã xóa sản phẩm ${vars.code}.`,
    recipeCreated: (vars: Vars) => `Đã tạo recipe ${vars.code}.`,
    recipeSaved: "Đã lưu recipe.",
    recipeDeleted: (vars: Vars) => `Đã xóa recipe ${vars.code}.`,
    pointCreated: (vars: Vars) => `Đã tạo điểm đo ${vars.code}.`,
    pointSaved: "Đã lưu điểm đo.",
    pointSaveFailed: "Lưu điểm đo thất bại.",
    pointDeleted: (vars: Vars) => `Đã xóa điểm đo ${vars.code}.`,
    pointDeleteFailed: "Xóa điểm đo thất bại.",
    fiducialSaved: "Đã lưu fiducial.",
    fiducialSaveFailed: "Lưu fiducial thất bại.",
    fiducialDeleted: "Đã xóa fiducial.",
    variantSaved: "Đã thêm biến thể.",
    variantSaveFailed: "Lưu biến thể thất bại.",
    userCreated: (vars: Vars) => `Đã tạo người dùng ${vars.username}.`,
    userCreateFailed: "Không thể tạo người dùng.",
    userRoleUpdated: (vars: Vars) => `Đã cập nhật vai trò của ${vars.username}.`,
    userRoleUpdateFailed: "Không thể cập nhật vai trò.",
    userDisabled: (vars: Vars) => `Đã khóa ${vars.username}.`,
    userEnabled: (vars: Vars) => `Đã mở khóa ${vars.username}.`,
    userStatusUpdateFailed: "Không thể cập nhật trạng thái người dùng.",
    userPasswordReset: (vars: Vars) => `Đã đặt lại mật khẩu cho ${vars.username}.`,
    userPasswordResetFailed: "Không thể đặt lại mật khẩu.",
    logoutFailed: "Không thể đăng xuất.",
    assetLifecycleUpdated: (vars: Vars) => `Đã cập nhật vòng đời của ${vars.code}.`,
    assetLifecycleUpdateFailed: "Không thể cập nhật vòng đời tài sản.",
    siteLinkSaved: "Đã lưu kết nối Site.",
    siteLinkSaveFailed: "Không thể lưu kết nối Site.",
    fingerprintCopied: "Đã sao chép vân tay.",
    certCopied: "Đã sao chép chứng chỉ.",
    alarmAcked: (vars: Vars) => `Đã xác nhận cảnh báo ${vars.code}.`,
    alarmAckFailed: "Không thể xác nhận cảnh báo.",
    lineCommandApplied: (vars: Vars) => `Đã thực hiện lệnh — trạng thái hiện tại: ${vars.state}.`,
    lineCommandFailed: "Không thể thực hiện lệnh điều khiển dây chuyền.",
  },
}

export type Dictionary = typeof vi
