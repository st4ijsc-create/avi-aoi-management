/**
 * English dictionary — must mirror `vi.ts`'s key shape exactly (see that file's doc comment and
 * `i18n/index.ts`'s dev-mode missing-key warning, which falls back to `vi` and logs if a key here
 * is ever missing).
 */
import type { Dictionary } from "./vi"

type Vars = Record<string, string | number>

export const en: Dictionary = {
  common: {
    connectivityError: "Could not reach the engine at the configured URL — check that St4i.EngineApi is running.",
  },

  // WS-D-D6 — login gate/auth context (`lib/auth.ts`, `App.tsx`'s top-level gate). `login`/`bootstrap`
  // render OUTSIDE the Shell chrome, same as `/tokens`/`/hmi/:code` — a themed standalone page, not a
  // route inside `<Shell>`. `userMenu` is the minimal vocabulary D7's real TopBar user menu will use;
  // this task only needs the keys to exist (see `lib/auth.ts`'s `AuthContextValue.logout`).
  auth: {
    splash: "Loading…",
    login: {
      title: "Sign in",
      subtitle: "Sign in to continue to the ST4I Machine Simulator.",
      usernameLabel: "Username",
      usernamePlaceholder: "e.g. admin",
      passwordLabel: "Password",
      passwordPlaceholder: "••••••••",
      submit: "Sign in",
      submitting: "Signing in…",
      invalidCredentials: "Invalid username or password.",
    },
    bootstrap: {
      title: "Create the first Admin account",
      description: "This deployment doesn't have any accounts yet — create the first Admin account to get started.",
      usernameLabel: "Username",
      displayNameLabel: "Display name (optional)",
      passwordLabel: "Password",
      confirmPasswordLabel: "Confirm password",
      submit: "Create Admin account",
      submitting: "Creating…",
      requiredError: "Username and password are required.",
      passwordMismatch: "Passwords don't match.",
      genericError: "Couldn't create the account — this deployment may already be bootstrapped.",
    },
    userMenu: {
      signedInAs: (vars: Vars) => `Signed in as ${vars.username}`,
      role: (vars: Vars) => `Role: ${vars.role}`,
      logout: "Log out",
      loggingOut: "Logging out…",
    },
  },

  theme: {
    pickerAriaLabel: (vars: Vars) => `Choose theme — currently ${vars.current}`,
    glass: { name: "Glass", description: "Light, premium" },
    console: { name: "Console", description: "Dark, high-tech" },
    warmth: { name: "Warmth", description: "Warm, industrial" },
  },

  shell: {
    nav: {
      dashboard: "Dashboard",
      machines: "Machines",
      productConfig: "Product Config",
      onboarding: "Onboarding",
      inspector: "API Inspector",
      scenario: "Scenario",
      historian: "Historian",
      reports: "OEE Reports",
      settings: "Settings",
      users: "Users",
      audit: "Audit Log",
      assets: "Asset Registry",
      connectors: "Connectors",
      site: "Site Link",
      alarms: "Alarm Center",
      line: "Line Control",
    },
    sidebar: {
      brandSubtitle: "Machine Simulator",
      // M-5 (branch-review) — `<nav aria-label>` was hardcoded English ("Main"), breaking vi/en
      // parity for the one landmark a screen-reader user relies on to jump straight to primary
      // navigation.
      navAria: "Main",
    },
    topBar: {
      fallbackTitle: "ST4I Machine Simulator",
      machineTitle: (vars: Vars) => `Machine ${vars.code}`,
      transportModeAria: "Transport mode",
      startFleet: "Start Fleet",
      starting: "Starting…",
      stop: "Stop",
      stopping: "Stopping…",
      engineConnected: "Engine connected",
      engineOffline: "Engine offline",
      connecting: "Connecting…",
      engineFaulted: "Engine faulted",
      paletteAria: "Open command palette (⌘K)",
    },
    commandPalette: {
      designTokens: "Design tokens (reference)",
      recipeConfig: "Recipes (Automation/IoT)",
      searchPlaceholder: "Jump to a screen…",
      searchAria: "Search screens",
      dialogAria: "Command palette",
      listboxAria: "Screens",
      noResults: (vars: Vars) => `No screens match "${vars.query}".`,
    },
  },

  // Task C6 — segmented nav switch between Product Config (`/products`) and Recipe Config
  // (`/recipes`), rendered atop both workspaces' list pages.
  configModeToggle: {
    ariaLabel: "Switch config area",
    products: "Products (AOI/AVI)",
    recipes: "Recipes (Automation/IoT)",
  },

  deviceClass: {
    Automation: "Automation",
    Iot: "IoT",
    AoiAvi: "AOI / AVI",
  },

  driverKind: {
    Simulated: "Simulated",
    HotFolderAoi: "Hot-folder AOI",
    Mqtt: "MQTT",
    Modbus: "Modbus",
    OpcUa: "OPC-UA",
  },

  lifecycleStatus: {
    development: "In development",
    active: "Active",
    eol: "End of life",
    archived: "Archived",
  },

  coordinateMode: {
    pixel: "Pixel",
    mm: "Millimeters (mm)",
  },

  measurementType: {
    DIMENSION: "2D dimension",
    VISUAL: "Visual",
    ELECTRICAL: "Electrical",
    POSITION: "Position",
    COLOR: "Color",
    SURFACE: "Surface",
    OTHER: "Other",
  },

  toleranceMode: {
    min_only: "Lower limit only",
    max_only: "Upper limit only",
    range: "Range (LSL–USL)",
    bilateral: "Bilateral (nominal ± tolerance)",
  },

  pointShape: {
    circle: "Circle",
    rect: "Rectangle",
    polygon: "Polygon",
    line: "Line",
    ring: "Ring",
    mask: "Mask",
    array: "Array (grid)",
  },

  recipeStatus: {
    draft: "Draft",
    active: "Active",
    archived: "Archived",
  },

  status: {
    idle: "Idle",
    ok: "OK",
    warn: "Warn",
    fail: "Fail",
    telemetry: "Telemetry",
  },

  dashboard: {
    title: "Dashboard",
    // SM-3 fix round 1 (review IMPORTANT 1) — this rendered UNCONDITIONALLY, so before the ecosystem
    // gate's removal a standalone customer never got far enough to see it; after that fix every product
    // install sees its own real machine's live data sitting directly under a label calling it a
    // simulated fleet, every load. Split by transport mode (the one condition that actually guarantees a
    // fabricated roster — see FleetHost.LoadFleet's own SM-1 remarks) rather than kept as one string.
    subtitleBaseDemo: "Live read on the simulated fleet",
    subtitleBaseLive: "Live read on your fleet",
    subtitleRoster: (vars: Vars) => ` — ${vars.roster} machines across Automation, IoT and AOI/AVI.`,
    kpi: {
      machinesOnline: "Machines online",
      totalCycles: "Total cycles",
      fpy: "First pass yield",
      onlineAll: "Whole fleet online",
      onlineNotYet: (vars: Vars) => `${vars.count} not yet running`,
      onlineNone: "Fleet not running",
      fpyOnTarget: "On target",
      fpyWatch: "Watch",
      fpyBelow: "Below target",
      fpyNoCycles: "No cycles yet",
    },
    mixedProvenance:
      "These figures reflect the real machine only — demo machines running alongside are excluded, not blended in.",
    empty: {
      title: "Press Start Fleet to begin",
      description: (vars: Vars) =>
        `The simulated fleet has ${vars.roster} machines waiting. Press “Start Fleet” to begin cycling and see live data on the dashboard.`,
      cta: "Start Fleet",
      ctaPending: "Starting…",
      // SM-3 — a fresh install has ZERO machines (SM-1 made that a legitimate product state), so
      // "press Start Fleet" is nonsense here: there is nothing to cycle. This is the honest first-run
      // destination — same copy/CTA shape as `machines.empty.noMachinesTitle/Description` below, so the
      // two screens agree on what "no machines yet" means.
      noMachinesTitle: "No machines yet",
      // SM-5 — was "Add one through Onboarding... Onboarding currently needs a reachable ST4I ecosystem
      // server", pointing at a dead end for a standalone customer (`/onboarding` is an ecosystem-
      // enrollment wizard). Now points at `/connectors` (`routes/Connectors.tsx`), a real, reachable
      // destination: add a Modbus TCP or OPC-UA machine with no server, no environment variables, no
      // hand-edited files.
      noMachinesDescription: "No machines are registered yet. Add a real Modbus or OPC-UA machine under Connectors to get started.",
    },
  },

  machines: {
    title: "Machines",
    // SM-3 fix round 1 (review IMPORTANT 1) — same "was always rendered, now on a real customer's own
    // machine" fix as dashboard.subtitleBaseDemo/Live above.
    descriptionDemo:
      "The full simulated fleet — search and filter by device class, driver, or status. Click a row to see its detail.",
    descriptionLive:
      "Your machine roster — search and filter by device class, driver, or status. Click a row to see its detail.",
    onlineCount: (vars: Vars) => `${vars.online} / ${vars.total} online`,
    search: {
      label: "Search machines",
      placeholder: "Search by machine code…",
    },
    filters: {
      type: "Device class",
      status: "Status",
      all: "All",
      clear: "Clear filters",
    },
    shownLabel: "shown",
    ofTotal: (vars: Vars) => `of ${vars.count} machines`,
    table: {
      code: "Code",
      type: "Type",
      driver: "Driver",
      status: "Status",
      passRate: "Pass rate",
      cycles: "Cycles",
      trend: "Trend",
      viewAction: "View detail",
      rowAria: (vars: Vars) => `View machine ${vars.code}`,
    },
    empty: {
      noMachinesTitle: "No machines yet",
      // SM-5 — was "Add one through Onboarding... Onboarding currently needs a reachable ST4I ecosystem
      // server", pointing at a dead end for a standalone customer (`/onboarding` is an ecosystem-
      // enrollment wizard). Now points at `/connectors` (`routes/Connectors.tsx`), a real, reachable
      // destination: add a Modbus TCP or OPC-UA machine with no server, no environment variables, no
      // hand-edited files.
      noMachinesDescription: "No machines are registered yet. Add a real Modbus or OPC-UA machine under Connectors to get started.",
      noMatchTitle: "No matching machines",
      noMatchDescription: "No machine matches the current search or filters — try clearing them.",
    },
  },

  productConfig: {
    title: "Product Config",
    description:
      "AOI/AVI product catalog — inspection points, spec, and reference images. Click a product to edit it.",
    countLabel: (vars: Vars) => `${vars.count} product${vars.count === 1 ? "" : "s"}`,
    createBtn: "Create product",
    search: {
      label: "Search products",
      placeholder: "Search by code or name…",
    },
    filters: {
      lifecycle: "Lifecycle",
      all: "All",
      clear: "Clear filters",
    },
    shownLabel: "shown",
    ofTotal: (vars: Vars) => `of ${vars.count} products`,
    table: {
      image: "Image",
      code: "Code",
      name: "Name",
      lifecycle: "Lifecycle",
      points: "Points",
      version: "Version",
      viewAction: "View detail",
      rowAria: (vars: Vars) => `View product ${vars.code}`,
    },
    versionShort: (vars: Vars) => `v${vars.version}`,
    noImageAlt: "No reference image yet",
    empty: {
      noProductsTitle: "No products yet",
      noProductsDescription: "The product catalog doesn't have any products yet. Create the first one to start configuring inspection points.",
      noMatchTitle: "No matching products",
      noMatchDescription: "No product matches the current search or filters — try clearing them.",
    },
    createDialog: {
      title: "Create a new product",
      description: "Create a new AOI/AVI product — inspection points can be added afterward.",
      codeLabel: "Product code",
      codePlaceholder: "e.g. MODEL-C",
      codeHint: "Unique identifier, case-insensitive — cannot be changed after creation.",
      codeRequired: "Product code is required.",
      codeDuplicate: (vars: Vars) => `Code "${vars.code}" already exists.`,
      nameLabel: "Product name",
      namePlaceholder: "e.g. Auxiliary control board",
      nameRequired: "Product name is required.",
      cancel: "Cancel",
      submit: "Create product",
      submitting: "Creating…",
      createFailed: "Couldn't create the product.",
    },
    form: {
      nameLabel: "Product name",
      lifecycleLabel: "Lifecycle status",
      coordinateModeLabel: "Coordinate system",
      imageWidthLabel: "Image width (px)",
      imageHeightLabel: "Image height (px)",
      referenceImageLabel: "Reference image",
      referenceImageUrlPlaceholder: "Image URL, or upload a file below…",
      uploadBtn: "Upload image",
      removeImageBtn: "Remove image",
      previewAlt: "Reference image preview",
      imageTooLarge: "Image too large (5 MB max).",
      imageReadFailed: "Couldn't read the image file.",
    },
  },

  notFound: {
    title: "Page not found",
    description: "That route doesn't exist. Use the sidebar or press ⌘K to jump to a screen.",
  },

  machineDetail: {
    back: "Back to dashboard",
    headerCycles: "Cycles",
    headerPassRate: "Pass rate",
    tabs: {
      overview: "Overview",
      spc: "SPC",
      telemetry: "Telemetry",
      board: "Board",
      config: "Config",
      settings: "Settings",
      log: "Log",
    },
    overview: {
      status: "Status",
      driver: "Driver",
      cycles: "Cycles",
      passRate: "Pass rate",
      lastConfigSync: "Last config sync",
      recentCycles: "Recent cycles",
    },
    notFoundState: {
      title: "Machine not found",
      description: (vars: Vars) =>
        `No machine with code ${vars.code} is registered in this fleet. It may not have started yet, or the code was mistyped.`,
    },
  },

  productConfigDetail: {
    back: "Back to Product Config",
    versionBadge: (vars: Vars) => `Points config version v${vars.version}`,
    notFoundState: {
      title: "Product not found",
      description: (vars: Vars) => `No product with code ${vars.code}. It may have been deleted, or the code was mistyped.`,
    },
    tabs: {
      info: "Product info",
      points: "Points",
      sync: "Sync",
    },
    info: {
      title: "Product info",
      codeLabel: "Product code",
      save: "Save changes",
      saving: "Saving…",
      dirty: "You have unsaved changes.",
      clean: "Saved.",
      saveFailed: "Couldn't save the product.",
      nameRequired: "Product name is required.",
      dangerZoneTitle: "Delete product",
      dangerZoneHint: "Permanently deletes this product along with every point, fiducial, and variant configured on it.",
      deleteBtn: "Delete product",
      deleteConfirmTitle: (vars: Vars) => `Delete product ${vars.code}?`,
      deleteConfirmDescription: (vars: Vars) =>
        `This permanently deletes "${vars.name}" and its ${vars.pointCount} configured point${vars.pointCount === 1 ? "" : "s"}. This can't be undone.`,
      deleteConfirmCancel: "Cancel",
      deleteConfirmSubmit: "Delete permanently",
      deleting: "Deleting…",
      deleteFailed: "Couldn't delete the product.",
    },
    points: {
      title: "Points",
      countLabel: (vars: Vars) => `${vars.count} active point${vars.count === 1 ? "" : "s"}`,
      empty: {
        title: "No points yet",
        description: "This product doesn't have any inspection points configured yet.",
      },
      table: {
        code: "Point code",
        name: "Point name",
        type: "Type",
        limits: "Limits",
      },
      noLimits: "—",
    },
    sync: {
      title: "Per-machine sync check",
      description: "Pick a machine from the fleet to compare its local points-config version against this product's.",
      machineLabel: "Machine",
      machinePlaceholder: "Choose a machine…",
      checkBtn: "Check",
      checking: "Checking…",
      checkFailed: "Sync check failed.",
      noMachines: "The fleet doesn't have any AOI/AVI machines to check yet.",
      resultLocalVersion: "Local version",
      resultEcosystemVersion: "Product version",
      resultState: "State",
      driftState: {
        in_sync: "In sync",
        drift: "Version drift",
        unknown: "Machine has never received this product",
      },
      viewMachineLink: (vars: Vars) => `View machine ${vars.code}`,
      seamNote: "Full pull/push with diff view and sync history lives on the machine detail page.",
    },
  },

  // Task C6 — recipe (System A: automation/IoT machine parameters) catalog list + create dialog,
  // `RecipeConfig.tsx`. Sibling workspace to `productConfig` above.
  recipeConfig: {
    title: "Recipes (Automation/IoT)",
    description:
      "Operating parameters for Automation/IoT machines — speed, torque, sensor thresholds… Click a recipe to edit it.",
    countLabel: (vars: Vars) => `${vars.count} recipes`,
    createBtn: "New recipe",
    demoOnlyNote:
      "Pushing a recipe to the real ecosystem is Demo-only — the real AVI/AOI server only allows pulling a recipe down to a machine (recipes are human-authored in SYNAPSE, 2-person approved). See the recipe page for details.",
    search: {
      label: "Search recipes",
      placeholder: "Search by code, name, or machine type…",
    },
    filters: {
      status: "Status",
      all: "All",
      clear: "Clear filters",
    },
    shownLabel: "shown",
    ofTotal: (vars: Vars) => `of ${vars.count} recipes`,
    table: {
      code: "Recipe code",
      name: "Recipe name",
      machineType: "Machine type",
      status: "Status",
      version: "Version",
      checksum: "Checksum",
      viewAction: "View details",
      rowAria: (vars: Vars) => `View recipe ${vars.code} details`,
    },
    versionShort: (vars: Vars) => `v${vars.version}`,
    empty: {
      noRecipesTitle: "No recipes yet",
      noRecipesDescription: "The recipe catalog is empty. Create the first recipe to start configuring parameters.",
      noMatchTitle: "No matching recipes",
      noMatchDescription: "No recipe matches the current search or filters — try clearing them.",
    },
    createDialog: {
      title: "Create a new recipe",
      description: "Create a new Automation/IoT recipe — you can edit its payload parameters after creating it.",
      codeLabel: "Recipe code",
      codePlaceholder: "e.g. SCREWDRIVE-M5",
      codeHint: "Unique identifier, case-insensitive — can't be changed after creation.",
      codeRequired: "A recipe code is required.",
      codeDuplicate: (vars: Vars) => `Code "${vars.code}" already exists.`,
      nameLabel: "Recipe name",
      nameRequired: "A recipe name is required.",
      cancel: "Cancel",
      submit: "Create recipe",
      submitting: "Creating…",
      createFailed: "Failed to create recipe.",
    },
    form: {
      nameLabel: "Recipe name",
      machineTypeLabel: "Machine type",
      machineTypeNone: "— Not set —",
      statusLabel: "Status",
    },
  },

  recipeConfigDetail: {
    back: "Back to recipes",
    versionBadge: (vars: Vars) => `Version v${vars.version}`,
    checksumLabel: "Checksum:",
    noChecksum: "No checksum yet — save to have the engine compute one.",
    demoOnlyNote:
      "Pushing this recipe to the real ecosystem is Demo-only — the real AVI/AOI server only allows pulling a recipe down (recipes are human-authored in SYNAPSE, 2-person approved; machines can't push their own). A real pull happens on the per-machine sync panel (machine detail page, Config tab).",
    notFoundState: {
      title: "Recipe not found",
      description: (vars: Vars) => `There's no recipe with code ${vars.code}. It may have been deleted, or the code may be mistyped.`,
    },
    tabs: {
      recipe: "Recipe",
      sync: "Sync",
    },
    info: {
      title: "Recipe info",
      codeLabel: "Recipe code",
      save: "Save changes",
      saving: "Saving…",
      dirty: "Unsaved changes.",
      clean: "Saved.",
      saveFailed: "Failed to save recipe.",
      nameRequired: "A recipe name is required.",
      dangerZoneTitle: "Delete recipe",
      dangerZoneHint: "Permanently delete this recipe — any machine currently resolving to it will no longer find it.",
      deleteBtn: "Delete recipe",
      deleteConfirmTitle: (vars: Vars) => `Delete recipe ${vars.code}?`,
      deleteConfirmDescription: (vars: Vars) => `This permanently deletes "${vars.name}". This can't be undone.`,
      deleteConfirmCancel: "Cancel",
      deleteConfirmSubmit: "Delete permanently",
      deleting: "Deleting…",
      deleteFailed: "Failed to delete recipe.",
    },
    payload: {
      title: "Parameters (payload)",
      description:
        "The recipe's real operating parameters — typed fields for known machine types, plus a generic key/value table for anything else.",
      typedTitle: "Machine-type fields",
      otherTitle: "Other fields",
      otherEmpty: "No custom fields yet.",
      otherValueAria: (vars: Vars) => `Value of ${vars.key}`,
      otherRemoveAria: (vars: Vars) => `Remove field ${vars.key}`,
      addKeyLabel: "New key",
      addKeyPlaceholder: "e.g. notes",
      addValueLabel: "Value",
      addValuePlaceholder: "Value…",
      addBtn: "Add field",
      addKeyRequired: "A key name is required.",
      addKeyDuplicate: (vars: Vars) => `Key "${vars.key}" already exists in this payload.`,
      fields: {
        speedRpm: "Speed",
        angleTarget: "Target angle",
        torqueTarget: "Target torque",
        torqueTolerance: "Torque tolerance",
        torqueUnit: "Torque unit",
        screwCount: "Screw count",
        clampTimeMs: "Clamp time",
        sampleIntervalMs: "Sample interval",
        thresholdLow: "Lower threshold",
        thresholdHigh: "Upper threshold",
      },
    },
    sync: {
      title: "Per-machine sync check",
      description: "Pick an Automation/IoT machine to see which recipe the simulated ecosystem currently resolves for its machine type.",
      machineLabel: "Machine",
      machinePlaceholder: "Choose a machine…",
      checkBtn: "Check",
      checking: "Checking…",
      checkFailed: "Sync check failed.",
      noMachines: "The fleet doesn't have any Automation/IoT machines to check yet.",
      resultState: "State",
      resultResolvedCode: "Resolved recipe",
      resultResolvedBy: "Resolved by",
      resolvedBy: {
        machine: "Machine-specific",
        machineType: "Machine type",
        none: "None",
      },
      resultLocalVersion: "Local (machine) version",
      resultEcosystemVersion: "Ecosystem version",
      differentCodeNote: (vars: Vars) =>
        `Machine ${vars.machineCode} resolves to recipe "${vars.resolvedCode}" — different from the recipe you're viewing.`,
      noRecipeResolved: "This machine hasn't resolved to any recipe yet.",
      viewMachineLink: (vars: Vars) => `View machine ${vars.code}`,
      seamNote: "Full pull with sync history lives on the machine detail page.",
    },
  },

  // Task C5 — measurement-point editor (board image-overlay canvas + full-spec point form +
  // fiducials/variants), the "Points" tab body in ProductConfigDetail.tsx.
  pointsEditor: {
    title: "Points & image map",
    addBtn: "Add point",
    includeDeletedLabel: "Show deleted points",
    canvas: {
      hint: "Click the image to add a point at that position — click a point to edit it.",
      noImageCaption: "No reference image yet",
      unplacedNote: (vars: Vars) => `${vars.count} point${vars.count === 1 ? "" : "s"} not yet positioned on the image — edit them in the list below.`,
      ariaLabel: (vars: Vars) => `Points map — ${vars.count} point${vars.count === 1 ? "" : "s"} shown`,
      pointAria: (vars: Vars) => `Point ${vars.code} — ${vars.name}`,
      figTitle: "FIG. 02 — BOARD REFERENCE MAP",
      dimensionUnit: "PX",
    },
    list: {
      actionsHeader: "Actions",
      inactiveTag: "Disabled",
      deletedTag: "Deleted",
      deleteAria: (vars: Vars) => `Delete point ${vars.code}`,
    },
    form: {
      newTitle: "New point",
      editTitle: (vars: Vars) => `Edit ${vars.code}`,
      codeLabel: "Point code",
      codeLocked: "The code can't be changed once created.",
      codeRequired: "Point code is required.",
      codeDuplicate: (vars: Vars) => `Code "${vars.code}" already exists on this product.`,
      nameLabel: "Point name",
      nameRequired: "Point name is required.",
      descriptionLabel: "Description",
      typeLabel: "Measurement type",
      typeCodeLabel: "Type code (measurementTypeCode)",
      unitLabel: "Unit",
      orderIndexLabel: "Order",
      activeLabel: "Active",
      sections: {
        basic: "Basic",
        limits: "2D limits",
        position: "Position & shape",
        threeD: "3D / solder / X-ray",
        image: "Reference image",
        lighting: "Lighting",
      },
      limits: {
        nominalLabel: "Nominal value",
        lowerLabel: "Lower limit (LSL)",
        upperLabel: "Upper limit (USL)",
        toleranceModeLabel: "Tolerance mode",
        toleranceModeNone: "— Not set —",
        tolPlusLabel: "Tolerance (+)",
        tolMinusLabel: "Tolerance (−)",
        orderError: "The lower limit must be ≤ the nominal value ≤ the upper limit.",
      },
      position: {
        normalizedXLabel: "Normalized X (0–1)",
        normalizedYLabel: "Normalized Y (0–1)",
        normalizedRangeError: "Normalized values must be between 0 and 1.",
        positionXLabel: (vars: Vars) => `Position X (${vars.unit})`,
        positionYLabel: (vars: Vars) => `Position Y (${vars.unit})`,
        radiusLabel: "Radius",
        normalizedRadiusLabel: "Normalized radius (0–1)",
        cropWidthLabel: "Crop width (px)",
        cropHeightLabel: "Crop height (px)",
        shapeLabel: "Shape",
        geometryLabel: "Geometry (JSON)",
        geometryHint: "JSON specific to the shape, e.g. {\"width\":36,\"height\":18}. Leave blank if not needed.",
        geometryInvalid: "Invalid geometry JSON.",
      },
      threeD: {
        positionZLabel: "Position Z",
        heightGroupLabel: "Height",
        areaGroupLabel: "Area",
        volumeGroupLabel: "Volume",
        minLabel: "Minimum",
        maxLabel: "Maximum",
        nominalLabel: "Nominal",
        unitLabel: "Unit",
        coplanarityMaxLabel: "Max coplanarity",
        warpageMaxLabel: "Max warpage",
        voidPctMaxLabel: "Max void %",
        offsetXMaxLabel: "Max X offset",
        offsetYMaxLabel: "Max Y offset",
        tiltMaxLabel: "Max tilt",
        thicknessMinLabel: "Min thickness",
        thicknessMaxLabel: "Max thickness",
        criteriaLabel: "Other criteria (JSON)",
        criteriaHint: "Additional pass/fail criteria, e.g. {\"expectPresence\":true}. Leave blank if not needed.",
        criteriaInvalid: "Invalid criteria JSON.",
      },
      image: {
        previewAlt: "Point image preview",
        urlPlaceholder: "Image URL, or upload a file below…",
        uploadBtn: "Upload image",
        removeBtn: "Remove image",
        tooLarge: "Image is too large (5 MB max).",
        readFailed: "Couldn't read the image file.",
      },
      lighting: {
        shotTitle: (vars: Vars) => `Shot #${vars.index}`,
        removeShotAria: (vars: Vars) => `Remove shot ${vars.index}`,
        addShotBtn: "Add shot",
        empty: "No lighting shots yet.",
        nameLabel: "Name",
        lightSourceLabel: "Light source",
        colorLabel: "Color",
        colorHexLabel: "Color (hex)",
        intensityLabel: "Intensity (%)",
        angleLabel: "Angle (deg)",
        exposureLabel: "Exposure (µs)",
        gainLabel: "Gain",
        focusOffsetLabel: "Focus offset (µm)",
        filterLabel: "Optical filter",
        purposeLabel: "Purpose",
      },
      save: "Save point",
      saving: "Saving…",
      create: "Create point",
      creating: "Creating…",
      cancelNew: "Discard new point",
      dirtyHint: "You have unsaved changes.",
      cleanHint: "Saved.",
      deleteBtn: "Delete point",
      deleteConfirmTitle: (vars: Vars) => `Delete point ${vars.code}?`,
      deleteConfirmDescription: (vars: Vars) =>
        `Point "${vars.name}" will be marked deleted (kept for sync purposes). This can't be undone from this screen.`,
      deleteConfirmCancel: "Cancel",
      deleteConfirmSubmit: "Delete point",
      deleting: "Deleting…",
      noSelection: {
        title: "No point selected",
        description: "Select a point on the image or in the list, or click \"Add point\".",
      },
    },
    fiducials: {
      title: "Fiducials",
      description: "Alignment marks used to register the image before measuring — normalized (0–1) position on the reference image.",
      addBtn: "Add fiducial",
      empty: "No fiducials yet.",
      editAria: (vars: Vars) => `Edit fiducial ${vars.code}`,
      deleteAria: (vars: Vars) => `Delete fiducial ${vars.code}`,
      table: {
        code: "Code",
        name: "Name",
        type: "Type",
        position: "Normalized position",
        actions: "Actions",
      },
      dialog: {
        addTitle: "Add fiducial",
        editTitle: "Edit fiducial",
        codeLabel: "Fiducial code",
        codeRequired: "Fiducial code is required.",
        codeDuplicate: (vars: Vars) => `Code "${vars.code}" already exists.`,
        nameLabel: "Name",
        typeLabel: "Type",
        normalizedXLabel: "Normalized X (0–1)",
        normalizedYLabel: "Normalized Y (0–1)",
        cancel: "Cancel",
        submit: "Save fiducial",
        submitting: "Saving…",
      },
      deleteConfirmTitle: (vars: Vars) => `Delete fiducial ${vars.code}?`,
      deleteConfirmDescription: "This saves immediately and can't be undone.",
      deleteConfirmCancel: "Cancel",
      deleteConfirmSubmit: "Delete fiducial",
    },
    variants: {
      title: "Variants",
      description: "Product variants (e.g. REV-B) — each variant can override a subset of points relative to the base (BASE) variant.",
      addBtn: "Add variant",
      empty: "No variants yet.",
      baseYes: "Base (BASE)",
      baseNo: "—",
      table: {
        code: "Code",
        name: "Name",
        base: "Base?",
        version: "Version",
        overrides: "Overrides",
      },
      dialog: {
        addTitle: "Add variant",
        codeLabel: "Variant code",
        codeRequired: "Variant code is required.",
        codeDuplicate: (vars: Vars) => `Code "${vars.code}" already exists.`,
        nameLabel: "Name",
        cancel: "Cancel",
        submit: "Create variant",
        submitting: "Creating…",
      },
    },
  },

  onboarding: {
    title: "Onboarding",
    subtitle:
      "Register, wait for approval, and claim/enroll a new machine with the ST4I server — or run the whole flow in demo mode, no real server required.",
    steps: {
      register: "Register",
      poll: "Approval",
      claim: "Claim / Enroll",
      done: "Done",
      // M-5 (branch-review) — `StepIndicator`'s own `aria-label` was hardcoded English
      // ("Onboarding progress"), breaking vi/en parity for the one wizard-progress landmark a
      // screen-reader user relies on throughout this whole flow.
      progressAria: "Onboarding progress",
    },
    demoLiveToggle: {
      aria: "Onboarding path",
      demo: "Demo",
      live: "Live",
    },
    modeHint: {
      demoLabel: "Demo",
      liveLabel: "Live",
      demo: "Simulated — no calls to a real server; every step happens instantly on the local engine.",
      live: (vars: Vars) => `Live — the steps below make real calls to ${vars.server}.`,
      liveNoServer: "Live — enter a server URL below to get started.",
    },
    register: {
      description: "Register a new machine with the ST4I server (or simulate the demo flow).",
      serialLabel: "Serial number",
      serialPlaceholder: "e.g. SIM-0001",
      nameLabel: "Machine name",
      namePlaceholder: "e.g. Screw station 01",
      defaultName: "Demo screw station",
      typeLabel: "Machine type",
      typeSelectPlaceholder: "Select machine type",
      // Group labels in the select popup — grouping is cosmetic only, it does NOT change the value
      // sent to the server (always the exact enum string below).
      typeGroups: {
        inspection: "Inspection",
        automation: "Automation",
        iot: "IoT",
      },
      // Dropdown values MUST match the real server's enum EXACTLY (case-sensitive —
      // server/constants/machineTypes.ts MACHINE_TYPES). This is the root cause this fix addresses:
      // the old free-text field sent "Automation" (lowercase tail) while the server only accepts
      // "AUTOMATION", so every Live registration 400'd. Labels are bilingual; the value actually sent
      // is always the key (e.g. "AOI"), never the label.
      machineTypes: {
        AVI: "AVI — Automated Visual Inspection",
        AOI: "AOI — Automated Optical Inspection",
        SPI: "SPI — Solder Paste Inspection",
        AXI: "AXI — Automated X-ray Inspection",
        ICT: "ICT — In-Circuit Test",
        FCT: "FCT — Functional Circuit Test",
        CMM: "CMM — Coordinate Measuring Machine",
        ICT_FUNC: "ICT_FUNC — Combined ICT + functional test cell",
        MOUNTER: "MOUNTER — SMT pick-and-place mounter",
        REFLOW: "REFLOW — Reflow soldering oven",
        STENCIL_PRINTER: "STENCIL_PRINTER — Solder-paste stencil printer",
        WAVE_SOLDER: "WAVE_SOLDER — Wave / selective soldering",
        AUTOMATION: "AUTOMATION — General automation station",
        ASSEMBLY: "ASSEMBLY — Assembly station",
        SCREWDRIVE: "SCREWDRIVE — Automatic screwdriving station",
        DISPENSING: "DISPENSING — Glue / paste dispensing",
        FEEDER: "FEEDER — Component feeder",
        PACKAGING: "PACKAGING — Packaging station",
        PALLETIZER: "PALLETIZER — Palletizer",
        ROBOT: "ROBOT — Generic industrial robot",
        ROBOT_TEST: "ROBOT_TEST — Robotic test cell",
        WELDER: "WELDER — Welding cell",
        IOT_SENSOR: "IOT_SENSOR — Self-developed IoT sensor",
        IOT_GATEWAY: "IOT_GATEWAY — Self-developed IoT gateway",
      },
      serverUrlLabel: "Server URL",
      serverUrlPlaceholder: "https://your-st4i-server",
      submit: "Register machine",
      submitting: "Registering…",
    },
    poll: {
      pendingTitle: "Waiting for approval on the ST4I system",
      waitingPrefix: "Waiting for an administrator to approve",
      waitingSuffixDemo: ". In demo mode, press the button below to approve instantly (simulating an admin).",
      waitingSuffixLive: ". After an administrator approves in the SYNAPSE Admin Console, press \"Check status\" below to update.",
      liveInstruction: "Open the SYNAPSE Admin Console to approve this machine, then paste the claim code (mct_…) below.",
      pending: "Pending",
      back: "Back",
      approveBtn: "Approve machine (simulate admin)",
      approving: "Approving…",
      liveCheckBtn: "Check status",
      liveChecking: "Checking…",
    },
    claim: {
      description: "Approved, retrieving configuration — get an mk_ key using Claim or Enroll below.",
      tabClaim: "Claim (mct_)",
      tabEnroll: "Enroll (met_)",
      claimTokenLabel: "Claim token",
      claimTokenHintDemo: "Not required in demo mode — any token is ignored.",
      claimTokenHintLive: "Paste the claim code (mct_…) issued by the administrator in the SYNAPSE Admin Console.",
      claimBtn: "Claim",
      claiming: "Claiming…",
      enrollTokenLabel: "Enroll token",
      enrollBtn: "Enroll",
      enrolling: "Enrolling…",
      back: "Back",
    },
    done: {
      savedFor: (vars: Vars) => `Key saved for ${vars.code}`,
      savedHint: "The key is encrypted (DPAPI) and stored on the machine running the engine.",
      joinedFleet: (vars: Vars) => `${vars.code} has joined the simulated fleet — you can watch it running now.`,
      machineCodeLabel: "Machine code",
      keyLabel: "mk_ key",
      reveal: "Show key",
      hide: "Hide key",
      copy: "Copy key",
      copied: "Copied.",
      viewFleet: "View fleet",
      viewMachine: "View new machine",
      registerAnother: "Register another machine",
    },
    pasteCard: {
      title: "Paste an existing mk_ key",
      description: "Already have an mk_ key from elsewhere (SDK, a teammate)? Save it directly here.",
      codeLabel: "Machine code",
      codePlaceholder: "e.g. SIM-0002",
      keyLabel: "mk_ key",
      save: "Save key",
      saving: "Saving…",
      saved: "Saved",
    },
    validation: {
      needBoth: "Both machine code and mk_ key are required.",
    },
    errors: {
      registerFailed: (vars: Vars) => `Registration failed: ${vars.message}`,
      pollFailed: (vars: Vars) => `Approval check failed: ${vars.message}`,
      claimFailed: (vars: Vars) => `Claim failed: ${vars.message}`,
      enrollFailed: (vars: Vars) => `Enroll failed: ${vars.message}`,
      pasteFailed: (vars: Vars) => `Paste-key failed: ${vars.message}`,
      serialRequired: "Serial number is required.",
      copyFailed: "Couldn't copy — please select the text manually.",
      unknown: "unknown error",
    },
    log: {
      title: "Activity log",
      empty: "No activity yet — start with Register below.",
      ariaLabel: "Onboarding activity",
    },
  },

  inspector: {
    title: "API Inspector",
    subtitle: (vars: Vars) =>
      `Live, envelope-by-envelope feed of every request the fleet sends — ${vars.count} captured this session.`,
    status: {
      live: "Live",
      paused: "Paused",
      connecting: "Connecting…",
      reconnecting: "Reconnecting…",
    },
    filters: {
      machine: "Machine",
      kind: "Kind",
      status: "Status",
      all: "All",
    },
    shownLabel: "shown",
    ofBuffered: (vars: Vars) => `of ${vars.count} buffered`,
    pause: "Pause",
    resume: "Resume",
    clear: "Clear",
    export: "Export",
    exportedNote: (vars: Vars) => `Exported ${vars.count} event${vars.count === 1 ? "" : "s"} to file`,
    emptyConnecting: "Connecting to the engine…",
    emptyNoTraffic: "No API traffic yet — start the fleet from the top bar to see live requests here.",
    emptyNoMatch: "No events match the current filters.",
    table: {
      time: "Time",
      machine: "Machine",
      kind: "Kind",
      method: "Method",
      path: "Path",
      status: "Status",
      latency: "Latency",
      mode: "Mode",
      dupError: "Dup / Error",
    },
  },

  scenario: {
    title: "Scenario",
    subtitle: "Demo sliders + presets — changes here apply live to the running fleet.",
    currentState: "Current state",
    liveAdjust: {
      title: "Live adjustment",
      hint: "Every drag applies immediately to the running fleet.",
    },
    cycleRate: "Cycle rate",
    defectRate: "Defect rate",
    faultRate: "Fault rate",
    networkOutage: "Network outage",
    networkOutageHint: "Switches the transport to high-failure store-and-forward.",
    burst: "Burst (6x, 4s)",
    presetsTitle: "Demo presets",
    presetsHint: "Each button resets all 3 sliders + network state, applied once to the running fleet.",
    presets: {
      normal: { label: "Normal shift", description: "The line's default speed and defect rate — the baseline for every other demo." },
      highDefect: { label: "High-defect batch", description: "Sharply raises the injected defect rate to demo andon/alerts." },
      sensorDrift: { label: "Sensor drift", description: "Speeds up the cycle to surface IOT_SENSOR's periodic calibration-drift events." },
      networkOutage: { label: "Demo network outage", description: "Switches to high-failure (~90%) store-and-forward while the fleet keeps running." },
      hotfolderAoi: { label: "Hot-folder AOI", description: "Writes a sample measurement file and lets the AOI driver read it back for real." },
    },
    presetCustomDescription: "Custom preset.",
  },

  settings: {
    title: "Settings",
    subtitle: "Connection, operating mode, machine auth, and language — wired to /v1/settings and /v1/mode.",
    theme: {
      title: "Theme",
      radioGroupAria: "Choose theme",
      appliesImmediately: "Applies immediately — no need to press Save.",
    },
    connection: {
      title: "Server connection",
      // M-6 (branch-review) — this field used to be `<FormField label="Server URL" labelEn="SERVER
      // URL">`: a literal string plus its own uppercase copy, not routed through `t()`/`gloss()` like
      // every other field on this screen, so it never followed a language switch (a vi UI still showed
      // "Server URL"/"SERVER URL" verbatim, in English, twice).
      serverUrlLabel: "Server URL",
      verifyTlsLabel: "Verify TLS",
      verifyTlsHint: "Rejects invalid HTTPS certificates.",
      check: "Check connection",
      checking: "Checking…",
      reachable: (vars: Vars) => `Reachable · HTTP ${vars.status} · ${vars.count} path${vars.count === 1 ? "" : "s"}`,
      unreachable: "Could not connect",
      requestFailed: "Check request failed",
    },
    mode: {
      title: "Operating mode",
      appliesImmediately: "Applies immediately — no need to press Save.",
      radioGroupAria: "Operating mode",
      live: { hint: "Calls the real ST4I server directly." },
      demo: { hint: "Self-simulates, no server required." },
    },
    auth: {
      title: "Machine authentication",
      machineCodeLabel: "Machine code used for authentication",
      machineCodeHint: "The mk_ key saved for this code is used when Live/Auto connects to the real server.",
      machineCodePlaceholder: "e.g. ENGINE-API-01",
      pasteCodeLabel: "Machine code",
      pasteCodePlaceholder: "e.g. SIM-0002",
      pasteKeyLabel: "mk_ key",
      saveKey: "Save key",
      savingKey: "Saving…",
      needBoth: "Both machine code and mk_ key are required.",
      unknownError: "Unknown error",
      savedTitle: "Saved on this browser",
      noneSaved: "No keys recorded in this session yet.",
      caveat: "This list only tracks what this browser has seen — not the full list on the engine's machine.",
    },
    language: {
      title: "Language",
      label: "Interface language",
      placeholder: "Choose a language",
      vi: "Tiếng Việt",
      en: "English",
    },
    save: "Save changes",
    saving: "Saving…",
    dirty: "You have unsaved changes.",
    clean: "Saved.",
  },

  ecosystemConnect: {
    title: "Ecosystem connection",
    description:
      "Connect this machine to a real ST4I ecosystem to sync configuration and pool fleet-wide data. Entirely optional — this machine works standalone without it.",
    descriptionFailed:
      "This machine is configured to reach an ST4I ecosystem, but the server isn't responding — check the address below, the network, or retry.",
    statusLabel: "Connection status",
    status: {
      standalone: "Standalone",
      testing: "Testing…",
      connected: "Connected",
      failed: "Connection failed",
    },
    emptyUrlHint: "Enter the ecosystem server address to get started.",
    failedHint: "The server didn't respond — check the address, the network, or retry.",
    saveAndTestBtn: "Save & test",
    saving: "Saving…",
    retryBtn: "Retry",
    retrying: "Retrying…",
    registerCta: "Register / claim this machine",
    settingsCta: "Open connection settings",
  },

  boardView: {
    waiting: "Waiting for the first inspection cycle…",
    pointsInspected: (vars: Vars) => `${vars.count} points inspected`,
    cleanBoard: "Clean board — no defects located",
    legend: {
      ng: "NG — defect located",
      ntf: "NTF — flagged, not a true defect",
    },
    ariaClean: (vars: Vars) => `Board view — all ${vars.count} inspected points OK, no defects located`,
    ariaDefects: (vars: Vars) =>
      `Board view — ${vars.defectCount} defect location${vars.defectCount === 1 ? "" : "s"} highlighted of ${vars.total} points inspected`,
  },

  configSyncPanel: {
    title: "Config sync",
    description:
      "Pull config from the ecosystem down to the machine, or push local changes up — review the diff before applying, see governance/conflict results, and the full sync history.",
    modeLabel: "Syncing with",
    mode: {
      Live: "Live — the real ST4I server",
      Demo: "Demo — simulated ecosystem",
      Auto: "Auto — falling back to Demo (no server/key configured)",
    },
    refreshBtn: "Refresh",
    refreshing: "Refreshing…",
    checkFailed: "Sync check failed.",
    connectivityError: "Couldn't check sync status — check the engine connection.",

    products: {
      title: "Version by product",
      empty: "The ecosystem doesn't have any products to sync yet.",
      localVersionShort: (vars: Vars) => `Local v${vars.version}`,
      localVersionNone: "Machine doesn't have it",
      ecosystemVersionShort: (vars: Vars) => `Ecosystem v${vars.version}`,
      selectAria: (vars: Vars) => `View sync detail for product ${vars.code}`,
    },

    driftState: {
      in_sync: "In sync",
      drift: "Version drift",
      unknown: "Machine has never received this",
    },

    detail: {
      versionHeading: (vars: Vars) => `${vars.code} — local ${vars.local} → ecosystem v${vars.eco}`,
      noLocalVersion: "none",
      imageIdentityLabel: "Reference image identity",
      imageIdentityNone: "No reference image yet.",
      pointsChecksumLocalLabel: "Local content checksum",
      pointsChecksumEcosystemLabel: "Ecosystem content checksum",
      pullBtn: "Pull to machine",
      pulling: "Pulling…",
      pullFailed: "Couldn't pull config.",
      pushBtn: "Push to ecosystem",
      pushDisabledHint: "The machine doesn't have this product yet — pull it before pushing.",
    },

    diff: {
      title: "Diff before applying",
      loading: "Loading diff…",
      failed: "Couldn't load the diff.",
      upToDate: "No differences — config already matches the ecosystem.",
      versionSame: "Same version",
      versionEcosystemAhead: (vars: Vars) => `Ecosystem is ${vars.count} version${Number(vars.count) === 1 ? "" : "s"} ahead`,
      versionLocalAhead: (vars: Vars) => `Local is ${vars.count} version${Number(vars.count) === 1 ? "" : "s"} ahead (edited locally, not pushed yet)`,
      addedTitle: (vars: Vars) => `New points (${vars.count})`,
      addedHint: "Only on the ecosystem — will be added to the machine on pull.",
      removedTitle: (vars: Vars) => `Removed points (${vars.count})`,
      removedHint: "Tombstoned on the ecosystem — will be removed from the machine on pull.",
      changedTitle: (vars: Vars) => `Changed points (${vars.count})`,
      fieldColumn: "Field",
      localColumn: "Local (machine)",
      ecosystemColumn: "Ecosystem",
      noValue: "—",
      yes: "Yes",
      no: "No",
      imageBefore: "Local image",
      imageAfter: "Ecosystem image",
      fields: {
        name: "Name",
        description: "Description",
        measurementType: "Measurement type",
        measurementTypeCode: "Measurement type code",
        unit: "Unit",
        lowerLimit: "Lower limit (LSL)",
        upperLimit: "Upper limit (USL)",
        nominalValue: "Nominal value",
        toleranceMode: "Tolerance mode",
        tolPlus: "Tolerance +",
        tolMinus: "Tolerance -",
        positionX: "Position X",
        positionY: "Position Y",
        radius: "Radius",
        normalizedX: "Position X (normalized)",
        normalizedY: "Position Y (normalized)",
        normalizedRadius: "Radius (normalized)",
        cropWidth: "Crop width",
        cropHeight: "Crop height",
        orderIndex: "Order index",
        shape: "Shape",
        isActive: "Active",
        referenceImageUrl: "Reference image",
        geometry: "Geometry (JSON)",
        cells: "Array cells (JSON)",
        positionZ: "Position Z",
        heightMin: "Height min",
        heightMax: "Height max",
        heightNominal: "Height nominal",
        heightUnit: "Height unit",
        areaMin: "Area min",
        areaMax: "Area max",
        areaNominal: "Area nominal",
        areaUnit: "Area unit",
        volumeMin: "Volume min",
        volumeMax: "Volume max",
        volumeNominal: "Volume nominal",
        volumeUnit: "Volume unit",
        coplanarityMax: "Coplanarity max",
        warpageMax: "Warpage max",
        voidPctMax: "Void % max",
        offsetXMax: "Offset X max",
        offsetYMax: "Offset Y max",
        tiltMax: "Tilt max",
        thicknessMin: "Thickness min",
        thicknessMax: "Thickness max",
        criteria: "Criteria (JSON)",
        lighting: "Lighting recipe (JSON)",
      },
    },

    pullResult: {
      title: "Pull result",
      summary: (vars: Vars) => `Applied: v${vars.from} → v${vars.to}`,
      pointsApplied: "Active points",
      pointsRemoved: "Removed points",
      notApplied: "Not applied.",
    },

    pushConfirm: {
      title: (vars: Vars) => `Push "${vars.code}" to the ecosystem?`,
      liveWarning: "LIVE mode — this WRITES to the real ST4I ecosystem and can't be undone from this machine.",
      autoNote:
        "Auto mode — this may write to the real ST4I server if a server/key is configured; otherwise it writes to the simulated Demo ecosystem.",
      demoNote: "Demo mode — this only writes to the local simulated ecosystem, safe to try.",
      summary: (vars: Vars) =>
        `This pushes all ${vars.count} active point${Number(vars.count) === 1 ? "" : "s"} of "${vars.code}" (local version v${vars.version}) to the ecosystem.`,
      governanceNote:
        "If the product isn't in “Development” status, limit changes (LSL/USL) may be blocked by threshold governance — only geometry and images sync in that case.",
      cancel: "Cancel",
      submit: "Confirm push",
      submitting: "Pushing…",
    },

    pushResult: {
      title: "Push result",
      versionBump: (vars: Vars) => `v${vars.from} → v${vars.to}`,
      created: "Created",
      updated: "Updated",
      pointsFailed: "Failed",
      staleConflicts: "Conflicts (stale write)",
      blindOverwrites: "Overwrites without a lock",
      limitBlockedBanner:
        "Approved limits (LSL/USL) were BLOCKED by threshold governance — only geometry/image/name synced. Limit changes must go through SYNAPSE's approval workflow.",
      conflictBanner: (vars: Vars) => `${vars.count} point${Number(vars.count) === 1 ? "" : "s"} had a stale-write conflict — not overwritten.`,
      notConfirmed: "Push requires confirmation — nothing was sent.",
      pointsTitle: "Per-point results",
      pointStatus: {
        created: "Created",
        updated: "Updated",
        conflict: "Conflict",
        failed: "Failed",
      },
      pointLimitBlocked: "Limit blocked",
    },

    history: {
      title: "Sync history",
      empty: "No sync operations for this machine yet.",
      columnOp: "Operation",
      columnCode: "Code",
      columnVersion: "Version",
      columnStatus: "Status",
      columnTime: "Time",
      op: {
        pull: "Pull",
        push: "Push",
      },
      status: {
        success: "Success",
        failed: "Failed",
      },
      versionCell: (vars: Vars) => `v${vars.from} → v${vars.to}`,
      detailsLabel: "Technical details",
      loading: "Loading history…",
      failed: "Couldn't load history.",
    },

    recipe: {
      versionHeading: (vars: Vars) => `${vars.code} — local ${vars.local} → ecosystem v${vars.eco}`,
      resolvedByLabel: "Resolved by",
      resolvedBy: {
        machine: "Machine-specific",
        machineType: "Machine type",
        none: "None",
      },
      checksumLabel: "Checksum (local copy)",
      noneResolved: "No recipe/settings resolve for this machine's type yet.",
      pullBtn: "Pull to machine",
      pulling: "Pulling…",
      pullFailed: "Couldn't pull the recipe.",
      pushUnavailable:
        "Pushing a recipe to the real ecosystem isn't available — recipes are human-authored in SYNAPSE (2-person approved). You can try pushing in Demo mode from the recipe authoring area.",
      viewRecipeLink: (vars: Vars) => `View recipe ${vars.code}`,
    },
  },

  cycleLogTable: {
    empty: "No cycles logged yet.",
    showing: (vars: Vars) => `Showing ${vars.visible} of ${vars.total} logged cycles, newest first.`,
    headers: {
      time: "Time",
      serial: "Serial",
      verdict: "Verdict",
      keyMetric: "Key metric",
    },
    verdict: {
      pass: "Pass",
      warn: "Warn",
      fail: "Fail",
      telemetry: "Telemetry",
    },
  },

  spcChart: {
    waiting: "Waiting for cycles — the SPC chart needs at least 2 judged readings.",
    latest: "Latest",
    mean: "Mean",
    outOfControl: (vars: Vars) => `${vars.out} of ${vars.total} out of control`,
    allWithinLimits: "All cycles within limits",
    legend: {
      value: "Value",
      mean: "Mean",
      distribution: "Distribution",
    },
    tooltipCycle: (vars: Vars) => `Cycle ${vars.cycle}`,
    tooltipValue: "Value",
    xAxisLabel: "Cycle",
    meanLabel: (vars: Vars) => `Mean ${vars.value}`,
    uclLabel: (vars: Vars) => `UCL ${vars.value}`,
    lclLabel: (vars: Vars) => `LCL ${vars.value}`,
  },

  telemetryChart: {
    noSamples: "No telemetry samples yet — this machine hasn't reported a metric this session.",
    tooltipSample: (vars: Vars) => `Sample ${vars.sample}`,
    xAxisLabel: "Sample",
    perSeriesNote: "Each line scaled to its own range — see values above for actual readings",
  },

  machineCard: {
    cycleTrend: "Cycle trend",
    cyclesUnit: "cycles",
    passRateNotApplicableAria: "Pass rate not applicable — telemetry only",
    passRateNoDataAria: "No pass-rate data yet — machine hasn't run a cycle",
    passRateAria: (vars: Vars) => `Pass rate ${vars.pct}%`,
  },

  hmi: {
    entryButton: "Machine HMI",
    entryButtonAria: (vars: Vars) => `Open machine HMI for ${vars.code}`,
    back: "Back to machine detail",
    shift: (vars: Vars) => `SHIFT ${vars.n}`,

    tabs: {
      railAria: "Switch operator panel tab",
      operation: "Operation",
      settings: "Settings",
    },

    status: {
      // SM-4 — renamed from "E-STOP ENGAGED": this is a supervisory software latch (`FleetHost.Estop`),
      // not a safety device. It stops this software's own read pipeline / disconnects from the
      // configured device(s) — it does not, and cannot, stop any machine (see README §1's safety note).
      // Deliberately distinct text from `controls.estopBanner` below ("HALT ENGAGED") — both render on
      // screen at once (nameplate lamp + control-rail banner) and a Playwright `exact: true` text match
      // (`11-hmi.spec.ts`) depends on them not colliding.
      estop: "HALTED",
      sub: {
        run: "Running",
        fault: "Stopped",
        idle: "Standing by",
      },
    },

    connectivity: {
      online: "ONLINE",
      connecting: "CONNECTING",
      offline: "OFFLINE",
    },

    controls: {
      title: "PHYSICAL CONTROLS",
      start: "START",
      pause: "PAUSE",
      reset: "RESET",
      // SM-4 — this control is NOT an emergency stop and must never be labeled as one: it is a
      // supervisory software latch that stops this software's own read pipeline and disconnects from
      // the configured device(s). It has no write path to any device and cannot stop a machine — see
      // README §1. "HALT" describes what it actually does without borrowing the authority of a safety
      // term; a real E-STOP is a hardwired, safety-rated circuit per ISO 13849, never a software control.
      estop: "HALT",
      estopBanner: "HALT ENGAGED",
      estopHint: "Press RESET to unlock the controls",
    },

    log: {
      title: "SYSTEM LOG",
      empty: "No events yet.",
      estopEngaged: "HALT — fleet stopped, controls locked",
      estopFailed: "HALT FAILED — engine did not confirm the stop",
      estopReset: "RESET — HALT cleared",
      estopResetFailed: "RESET FAILED — HALT still latched",
      fleetStarted: "Fleet started",
      fleetPaused: "Fleet paused",
    },

    progress: {
      title: "PRODUCTION PROGRESS",
      okLabel: "OK",
      ngLabel: "NG",
      totalLabel: "TOTAL",
      packetsLabel: "PACKETS",
    },

    schematic: {
      figAutomation: "FIG. 01 — AUTOMATION / SCREWDRIVE CELL",
      figAoi: "FIG. 01 — AOI / AVI CELL",
      figIot: "FIG. 01 — IOT SENSOR NODE",
      idleNote: "Machine stopped — static drawing",
      feeder: "FEEDER",
      remaining: "REMAINING (SIMULATED)",
      feederDisclosure: "Remaining-screw count is a simulated estimate derived from the cycle counter — not a real inventory signal from the machine.",
      zAxis: "Z-AXIS",
      node: "SENSOR NODE",
      uplink: "UPLINK",
      noProduct: "No product config linked",
      pointsSynced: (vars: Vars) => `${vars.count} configured positions`,
      aggregateDefects: (vars: Vars) => `${vars.count} defects (aggregate)`,
      aggregateDisclosure: "Positions: real product config · Defect count: machine-wide aggregate, not assigned to any single position",
      configuredPosition: (vars: Vars) => `${vars.code} — configured position (not a measurement result)`,
      livePointResults: (vars: Vars) => `${vars.ng}/${vars.total} points NG — matched to the real measured position`,
      livePointDisclosure:
        "Position and result both come straight from the real inspection cycle — each point lights by its own result, no longer an aggregate.",
      measuredResult: (vars: Vars) => `${vars.code} — ${vars.result}`,
    },

    readoutPanel: {
      title: "OPERATING READOUTS",
    },

    readout: {
      cycles: "Cycles",
      passRate: "Pass Rate",
      cycleRate: "Cycle Rate",
      cycleTime: "Cycle Time",
      metric: "Process Metric",
      driver: "Driver",
      configState: "Config State",
      boards: "Boards",
      pointsInspected: "Points Inspected",
      fpy: "FPY",
      defects: "Defects",
      lastDefect: "Last Defect",
      product: "Product",
      packets: "Packets",
      sampleRate: "Sample Rate",
      signal: "Signal",
      observedSpan: "Observed Span",
      status: "Status",
      configStateNotApplicable: "N/A",
      // I-5 — IoT has no pass/fail verdict at all (a sensor node reports a signal, not a judged
      // board/screw), so this tile is dead by construction on the IoT class, same structural gap
      // `configStateNotApplicable` (I-4) already names for CONFIG STATE. An explicit N/A reads as
      // "not applicable to this machine class"; the previous bare "—" was indistinguishable from
      // "waiting for data".
      passRateNotApplicable: "N/A",
    },
  },

  machineSettings: {
    title: "Machine Settings",
    description: "Server recommendations — adjustable per machine or per running product when needed.",
    productLabel: "Product",
    productSelectAria: "Select a product to view its configuration",
    noProducts: "No products yet.",
    iotHint: "IoT machines run no product — every adjustment applies to this machine.",
    baselineInfo: (vars: Vars) =>
      `Recommended v${vars.version} · ${vars.driftedCount} parameter${Number(vars.driftedCount) === 1 ? "" : "s"} adjusted from the recommendation`,
    notSupported: {
      title: "No operating-configuration parameters",
      description: (vars: Vars) => `Machine type "${vars.machineType}" has no operating-configuration parameter set for this feature yet.`,
    },
    loadFailed: "Couldn't load the machine configuration.",
    columns: {
      label: "Parameter",
      value: "Effective",
      range: "Allowed Range",
      recommended: "Recommended",
      source: "Source",
    },
    provenance: {
      baseline: "Recommended",
      machine: "Machine-adjusted",
      machineProduct: "Product-adjusted",
    },
    adjustedBy: (vars: Vars) => `${vars.by} · ${vars.when}`,
    adjustedByUnknown: (vars: Vars) => `${vars.when}`,
    relativeTime: {
      justNow: "just now",
      minutesAgo: (vars: Vars) => `${vars.n} minute${Number(vars.n) === 1 ? "" : "s"} ago`,
      hoursAgo: (vars: Vars) => `${vars.n} hour${Number(vars.n) === 1 ? "" : "s"} ago`,
      daysAgo: (vars: Vars) => `${vars.n} day${Number(vars.n) === 1 ? "" : "s"} ago`,
    },
    resetAction: "Reset to default",
    resetAria: (vars: Vars) => `Reset ${vars.key} to the recommended value`,
    editAction: "Edit",
    editAria: (vars: Vars) => `Edit ${vars.key}`,
    editDialog: {
      titleFor: (vars: Vars) => `Edit ${vars.label}`,
      valueLabel: "New value",
      rangeHint: (vars: Vars) => `Allowed range: ${vars.min}–${vars.max} ${vars.unit}`,
      scopeLabel: "Applies to",
      scopeMachine: "This machine (every product)",
      scopeProduct: (vars: Vars) => `Only the selected product — ${vars.product}`,
      noteLabel: "Note (optional)",
      notePlaceholder: "Why this value…",
      cancel: "Cancel",
      save: "Save",
      saving: "Saving…",
      invalidNumber: "Enter a valid number.",
      outOfRange: (vars: Vars) => `${vars.key} must be between ${vars.min} and ${vars.max} ${vars.unit} (got ${vars.value}).`,
      serverErrorFallback: "The server rejected this value.",
    },
  },

  historian: {
    title: "Historian",
    description:
      "Browse durably-stored cycle results across the whole fleet — filter by machine, time, serial, or verdict, and export to CSV.",
    filters: {
      machine: "Machine",
      allMachines: "All machines",
      from: "From date",
      to: "To date",
      serial: "Serial",
      serialPlaceholder: "Search by serial number…",
      verdict: "Verdict",
      allVerdicts: "All verdicts",
      clear: "Clear filters",
    },
    export: {
      csv: "Export CSV",
    },
    table: {
      time: "Time",
      machine: "Machine",
      serial: "Serial",
      verdict: "Verdict",
      keyMetric: "Key metric",
      ngPoints: "NG / Points",
      genealogyAction: "View genealogy",
      empty: "No historian records match the current filters.",
      loadFailed: "Couldn't load the historian.",
      // SM-2 fix round 1 — per-row data-lineage tags (see HistorianResultDto.isFabricated). Rendered
      // next to the verdict badge in both the results table and the genealogy dialog.
      fabricated: "Demo",
      unknownProvenance: "Unknown origin",
    },
    pagination: {
      showing: (vars: Vars) => `Showing ${vars.from}–${vars.to} of ${vars.total} records`,
      prev: "Prev",
      next: "Next",
    },
    genealogy: {
      title: (vars: Vars) => `Genealogy — Serial ${vars.serial}`,
      description: "Every historian record on file for this serial, across every machine.",
      loading: "Loading genealogy…",
      empty: "No records found for this serial.",
      failed: "Couldn't load genealogy.",
    },
  },

  reports: {
    title: "OEE Reports",
    description:
      "Availability, performance, quality, and OEE for one machine — plus the 3 loss buckets and editable targets, computed over the durably-stored historian log.",
    filters: {
      machine: "Machine",
      from: "From date",
      to: "To date",
    },
    export: {
      pdf: "Export PDF",
    },
    empty: {
      noMachines: "No machines in the fleet yet.",
    },
    loadFailed: "Couldn't load OEE data.",
    kpi: {
      availability: "Availability",
      performance: "Performance",
      quality: "Quality",
      oee: "OEE",
    },
    lossChart: {
      title: "OEE loss (3 buckets)",
      downtime: "Downtime loss",
      speed: "Speed loss",
      quality: "Quality loss",
      yAxisLabel: "Minutes",
      tooltipMinutes: (vars: Vars) => `${vars.minutes} min`,
      tooltipSeconds: (vars: Vars) => `${vars.seconds}s`,
      minutesShort: (vars: Vars) => `${vars.minutes} min`,
      total: (vars: Vars) => `Total loss: ${vars.minutes} min`,
    },
    targets: {
      title: "OEE Targets",
      idealCycleLabel: "Ideal Cycle Time (seconds)",
      ratioLabel: "Planned Production Ratio (0–1)",
      overridden: "Overridden",
      baseline: "Default",
      save: "Save Targets",
      saving: "Saving…",
      invalidNumber: "Enter a valid number for both fields.",
      saveFailedFallback: "The server rejected these values.",
      loadFailed: "Couldn't load OEE targets.",
    },
  },

  // WS-D-D7 — `/users` (`routes/Users.tsx`, Admin-only): roster table, add-user/reset-password
  // dialogs, per-row role/disable-enable actions, and the client-side "not authorized"/last-admin-
  // guard copy (the REAL enforcement is server-side — see `UserEndpoints.cs` — these are just the
  // friendlier front-line messages for the common case).
  users: {
    title: "Users",
    description: "Manage local sign-in accounts — role, enable/disable, password reset. Only Admins see this screen.",
    addUser: "Add user",
    table: {
      username: "Username",
      role: "Role",
      displayName: "Display name",
      status: "Status",
      lastLogin: "Last login",
      actions: "Actions",
      roleAria: (vars: Vars) => `${vars.username}'s role`,
    },
    status: {
      enabled: "Enabled",
      disabled: "Disabled",
    },
    never: "Never",
    actions: {
      disable: "Disable",
      enable: "Enable",
      resetPassword: "Reset password",
    },
    lastAdminGuard: "Can't do that — this is the last enabled Admin, and this action would leave no one able to administer the system.",
    createDialog: {
      title: "Add user",
      description: "Create a new local sign-in account.",
      usernameLabel: "Username",
      usernamePlaceholder: "e.g. operator1",
      passwordLabel: "Password",
      displayNameLabel: "Display name (optional)",
      roleLabel: "Role",
      cancel: "Cancel",
      submit: "Create user",
      submitting: "Creating…",
      usernameRequired: "Username is required.",
      usernameDuplicate: (vars: Vars) => `Username "${vars.username}" already exists.`,
      passwordTooShort: (vars: Vars) => `Password must be at least ${vars.count} characters.`,
    },
    resetPasswordDialog: {
      title: (vars: Vars) => `Reset password for ${vars.username}`,
      description: "This user will need to sign in again with the new password; any current sessions are revoked.",
      newPasswordLabel: "New password",
      cancel: "Cancel",
      submit: "Reset password",
      submitting: "Resetting…",
      passwordTooShort: (vars: Vars) => `Password must be at least ${vars.count} characters.`,
    },
    empty: {
      title: "No users yet",
      description: "The user roster is empty.",
    },
    notAuthorized: {
      title: "Not authorized",
      description: "Only Admin accounts can manage users.",
    },
  },

  // WS-D-D8 — `/audit` (`routes/Audit.tsx`, Admin-only): paginated/filterable viewer over the
  // hash-chained audit log (D3's `GET /v1/audit`) + a "Verify chain integrity" button (D3's
  // `GET /v1/audit/verify`). `limitation.body` mirrors D3's own honest tamper-evidence wording
  // (`SqliteAuditStore`'s doc comment) — deliberately not overstated as unqualified "tamper-proof".
  audit: {
    title: "Audit Log",
    description:
      "Browse and filter the hash-chained audit log — every create/update/delete a user performed, with before/after values and the request's correlation id. Only Admins see this screen.",
    filters: {
      from: "From date",
      to: "To date",
      actor: "Actor",
      actorPlaceholder: "e.g. demo-admin",
      action: "Action",
      actionPlaceholder: "e.g. user.role_change",
      target: "Target",
      targetPlaceholder: "e.g. a machine code, username…",
      clear: "Clear filters",
    },
    table: {
      seq: "Seq",
      time: "Time",
      actor: "Actor",
      action: "Action",
      target: "Target",
      change: "Before → After",
      correlationId: "Correlation ID",
      viewDetail: "View detail",
      empty: "No audit records match the current filters.",
      loadFailed: "Couldn't load the audit log.",
    },
    pagination: {
      showing: (vars: Vars) => `Showing ${vars.from}–${vars.to} of ${vars.total} records`,
      prev: "Prev",
      next: "Next",
    },
    detailDialog: {
      title: (vars: Vars) => `Record #${vars.seq} detail`,
      description: "This change's before and after values, as full JSON.",
      oldValue: "Old value",
      newValue: "New value",
      none: "No value recorded.",
    },
    verify: {
      button: "Verify chain integrity",
      verifying: "Verifying…",
      intact: (vars: Vars) => `Chain intact (${vars.count} entries).`,
      broken: (vars: Vars) => `Chain BROKEN at seq ${vars.seq} — ${vars.detail}`,
      failed: "Couldn't verify the chain — check the engine connection.",
    },
    limitation: {
      title: "About tamper detection",
      body: "Detects in-app modification & interior deletion; not resistant to direct database-file tampering.",
    },
    notAuthorized: {
      title: "Not authorized",
      description: "Only Admin accounts can view the audit log.",
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
    title: "Asset Registry",
    description:
      "The registered assets (machines) in the system — asset code, URN, device class, driver, and lifecycle state. A machine registers automatically the first time it connects to the engine; transitioning its lifecycle state requires Engineer or above.",
    table: {
      code: "Code",
      urn: "URN",
      deviceClass: "Device class",
      driverKind: "Driver",
      lifecycle: "Lifecycle",
      updated: "Updated",
      rowAria: (vars: Vars) => `View detail for asset ${vars.code}`,
      empty: "No assets registered yet.",
      loadFailed: "Couldn't load the asset registry.",
    },
    lifecycle: {
      Provisioned: "Provisioned",
      Commissioning: "Commissioning",
      Active: "Active",
      Maintenance: "Maintenance",
      Decommissioned: "Decommissioned",
    },
    detail: {
      title: (vars: Vars) => `Asset ${vars.code} detail`,
      description: "Full record and current lifecycle state for this asset.",
      loadFailed: "Couldn't load the asset detail.",
      urn: "URN",
      deviceClass: "Device class",
      driverKind: "Driver",
      machineType: "Machine type",
      currentLifecycle: "Current state",
      checksum: "Checksum",
      checksumNone: "No checksum yet.",
      created: "Created",
      updated: "Last updated",
      transition: "Transition lifecycle state",
      transitionRequiresEngineer: "Only Engineer accounts (or above) can transition the lifecycle state.",
      save: "Save",
      saving: "Saving…",
    },
  },

  // GP-7 (`.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-7-brief.md` item 1) —
  // the small status card `AssetRegistry.tsx` renders above the asset table, over GP-5's
  // `GET /v1/connectors`: every currently-registered connector (from `connectors.json` or the legacy
  // env vars) that failed to start. An empty list is the healthy state — `empty` reads as a plain
  // confirmation, not an absence of information — because most decommissioned/typo-free installs will
  // see this card empty essentially always.
  connectors: {
    title: "Connector status",
    description: "Connectors configured (via connectors.json or an environment variable) that failed to start.",
    empty: "All configured connectors started normally.",
    loadFailed: "Couldn't check connector status.",
    // `error` is a factory's own exception message, forwarded verbatim and unsanitized — see
    // `ConnectorStatus` in `lib/api.ts`.
    errorLabel: (vars: Vars) => `Error: ${vars.error}`,
    itemAria: (vars: Vars) => `Connector ${vars.id} failed to start: ${vars.error}`,
  },

  // GĐ3 EC-4 (`routes/Site.tsx`, `.superpowers/sdd/2026-07-27-giaidoan3-ecosystem-connect-blueprint/
  // task-4-brief.md`) — the web page over EC-3's `/v1/site*` endpoints: this device's own identity
  // fingerprint + cert PEM (to register at a SYNAPSE Site), an Engineer-gated Site-link form (host/
  // port + paste the Site's trust PEM + enable), and a live northbound bridge-status badge. Reads are
  // Operator; only the PUT-driving form is Engineer+-gated (`site.form.readOnlyNote`), same "page open
  // to everyone, one control gated" shape `assets` above already established.
  // SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md,
  // `routes/Connectors.tsx`) — add/view/remove a real Modbus TCP or OPC-UA connector configuration.
  // Reads are Operator; the add-connector form and per-row Remove are Engineer+-gated. Named
  // `connectorConfig` (NOT `connectors`) — that key is already taken by the GP-7 "connector status"
  // card above (`AssetRegistry.tsx`'s failed-to-start list), a distinct, older feature this task does
  // not touch.
  connectorConfig: {
    title: "Connectors",
    description:
      "Add a real Modbus TCP or OPC-UA machine and it appears in the fleet roster — no environment variables or hand-edited files required. Only the two protocols this build can actually drive are offered; a graphical register/node-map builder is a separate future project, so paste or upload the map JSON here for now.",
    list: {
      title: "Configured connectors",
      description: "Every connector configuration currently saved on this machine.",
      empty: "No connector configured yet.",
      loadFailed: "Couldn't load the configured connectors.",
      table: {
        kind: "Protocol",
        machineCode: "Machine code",
        hostPort: "Host : Port",
        updated: "Last updated",
        remove: "Remove",
      },
    },
    removeConfirm: {
      title: "Remove this connector configuration?",
      description:
        "This only removes the SAVED configuration — it does not remove the machine from the fleet roster. If this connector is currently running, it keeps running until the application is fully restarted; there is no way to remove a machine from a live roster yet.",
      submit: "Remove",
      removing: "Removing…",
      cancel: "Cancel",
    },
    form: {
      title: "Add a connector",
      description: "Pick the protocol, enter the connection settings, and paste or upload the register/node map JSON for this machine.",
      kindModbus: "Modbus TCP",
      kindOpcUa: "OPC-UA",
      hostLabel: "Host / IP address",
      hostPlaceholder: "10.0.0.5",
      portLabel: "Port",
      opcUaNote:
        "The OPC-UA endpoint URL, security mode, and any username/password all live inside the node-map JSON below — there is nothing extra to enter here.",
      mapJsonLabel: "Register / node map (JSON)",
      mapJsonHint:
        "The same JSON shape the ST4I_MODBUS_MAP / ST4I_OPCUA_MAP environment variables already use (see the documentation for the exact fields). There is no visual mapper yet — paste or upload the JSON directly.",
      mapJsonPlaceholder: "Paste the register/node map JSON here…",
      uploadButton: "Upload a file…",
      test: "Test connection",
      testing: "Testing…",
      testResultOk: "Connected — the device responded.",
      save: "Save",
      saving: "Saving…",
      appliedLive: "Saved and added to the fleet. If the fleet was already running, it restarted to apply this immediately.",
      savedRestartNeeded:
        "Saved. This machine was already in the roster — the change applies on the next Stop/Start (or a full application restart), not immediately to an already-running fleet.",
      readOnlyNote: "Only Engineer accounts (or above) can add or remove a connector.",
    },
    errors: {
      badRequest: "The connector settings were rejected — check the fields and the map JSON.",
      conflict: "A connector of this protocol is already configured for a different machine — remove it first.",
      forbidden: "You don't have permission to configure connectors.",
      generic: "Couldn't save the connector.",
    },
  },

  site: {
    title: "Site / Ecosystem",
    description:
      "This device's identity, for registering it at a SYNAPSE Site, and (Engineer or above) configuring the Site link that federates the local UNS spine up to the wider ecosystem.",
    identity: {
      title: "Device identity",
      description: "This device's own fingerprint and public certificate — use these to register it at your Site.",
      fingerprintLabel: "Device fingerprint (SHA-256)",
      copyFingerprint: "Copy fingerprint",
      pemLabel: "Device certificate (PEM)",
      showPem: "Show certificate",
      hidePem: "Hide certificate",
      copyPem: "Copy certificate",
      copied: "Copied.",
      copyFailed: "Couldn't copy — select and copy manually instead.",
      register: "Register this identity at your SYNAPSE Site.",
      loadFailed: "Couldn't load the device identity.",
      // GĐ3 closeout WI-4 — certificate expiry + Admin-only rotation.
      expiryLabel: "Certificate expiry",
      expired: (vars: Vars) => `This certificate EXPIRED ${vars.days} day(s) ago — rotate it now.`,
      expiringSoon: (vars: Vars) => `This certificate expires in ${vars.days} day(s) — plan a rotation soon.`,
      rotateButton: "Rotate identity",
      rotateConfirmTitle: "Rotate device identity?",
      rotateConfirmDescription:
        "This mints a brand-new certificate and fingerprint for this device, replacing the current one everywhere it's used. The Site you're linked to has PINNED the CURRENT fingerprint — the moment you rotate, the uplink will stop working and stay down until an operator pastes the NEW fingerprint into that Site's trust configuration. Only do this when you're ready to update the Site right after. This cannot be undone.",
      rotateConfirmSubmit: "Rotate identity",
      rotateCancel: "Cancel",
      rotating: "Rotating…",
      rotateSuccessTitle: "Identity rotated",
      rotateSuccessDescription:
        "This device now presents a new certificate. Copy the fingerprint below and update it at your SYNAPSE Site now — the uplink stays down until you do.",
      rotateDone: "Done",
      rotateErrorBadRequest: "The current fingerprint wasn't sent correctly — reload the page and try again.",
      rotateErrorConflict:
        "The device identity changed since this page loaded (it may already have been rotated) — reload the page to see the current fingerprint, then try again.",
      rotateErrorForbidden: "You don't have permission to rotate the device identity.",
      rotateErrorGeneric: "Couldn't rotate the device identity.",
    },
    form: {
      title: "Site connection",
      description: "Configure the link up to a SYNAPSE Site — re-paste the Site's trust certificate every time you save.",
      hostLabel: "Site host",
      hostPlaceholder: "site.example.com",
      portLabel: "Port",
      trustPemLabel: "Site trust certificate (PEM)",
      trustPemPlaceholder: "Paste the Site broker's CA or self-signed certificate…",
      trustPemHint:
        "For security, the saved certificate is never shown again — this field always starts blank; to ENABLE the connection, re-paste the trust certificate every time you save, even if you're only changing host/port.",
      enabledLabel: "Enable the Site connection",
      save: "Save",
      saving: "Saving…",
      readOnlyNote: "Only Engineer accounts (or above) can edit the Site connection.",
      readOnlyHost: "Site host",
      readOnlyPort: "Port",
      readOnlyEnabled: "Enabled",
      readOnlyDisabled: "Disabled",
    },
    status: {
      title: "Bridge status",
      Disabled: "Disabled",
      Connecting: "Connecting…",
      Connected: "Connected",
      Degraded: "Degraded",
      Down: "Down",
      // GĐ3 closeout WI-3 — the spool writer and/or forward loop died in the background; the MQTT
      // clients can still look connected while this is true, which is exactly why it outranks them.
      Faulted: "Faulted",
      faultedWarning:
        "The bridge's internal spool/forward loop has stopped — production data may no longer be persisted or forwarded even though the connection itself looks fine. This does not clear on its own: re-applying the Site link below (Save) or rotating the identity rebuilds the bridge and clears it — a service restart also works but isn't required. Check the machine's logs for the underlying error.",
      lastError: (vars: Vars) => `Last error: ${vars.error}`,
      siteVerified: (vars: Vars) => `Verified Site certificate: ${vars.fingerprint}`,
      unsDisabled: "The local UNS spine is disabled (ST4I_UNS_ENABLED=false); enable it to federate this device to a Site.",
    },
    errors: {
      badRequest: "Host, port, or trust certificate is invalid for enabling the Site connection.",
      conflict: "The local UNS spine is disabled — the Site link can't be applied.",
      forbidden: "You don't have permission to edit the Site connection.",
      generic: "Couldn't save the Site connection.",
      loadFailed: "Couldn't load the Site connection status.",
    },
    discover: {
      title: "Discover Sites on the LAN",
      button: "Discover Sites",
      scanning: "Scanning the LAN… (~4s)",
      resultsTitle: "Sites found on the LAN",
      empty: "No Sites found on the LAN.",
      error: "Couldn't scan the LAN for Sites.",
      pick: (vars: Vars) => `Use ${vars.instanceName} (${vars.host}:${vars.port}) to fill in the Site host and port`,
    },
    // GĐ3 closeout WI-3 — the durable northbound spool's own telemetry (`GET /v1/site`'s `spoolDepth`/
    // `lastAckedSeq`/`droppedTotal`). `droppedLabel`'s value is rendered in a danger tone, and
    // `droppedWarning` only shown at all, whenever `droppedTotal > 0` — that count means production data
    // that will NEVER reach the Site, not a neutral statistic.
    spool: {
      title: "Northbound spool",
      depthLabel: "Messages queued",
      lastAckedLabel: "Last acked sequence",
      droppedLabel: "Permanently dropped",
      droppedWarning: (vars: Vars) =>
        `${vars.count} message(s) were permanently dropped by the spool and can never be recovered — the Site never received this production data.`,
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
    title: "Alarm Center",
    description:
      "Alarms currently active in the system (safety-policy denials, driver health, NG rate) — Ack to work one, or browse the full history.",
    tabs: {
      active: "Active",
      history: "History",
    },
    table: {
      priority: "Priority",
      source: "Source",
      code: "Code",
      message: "Message",
      count: "Count",
      lastRaised: "Last raised",
      ack: "Ack",
      acking: "Acking…",
      viewDetail: "View alarm detail",
      empty: "No active alarms.",
      loadFailed: "Couldn't load the active alarms.",
    },
    priority: {
      Critical: "Critical",
      High: "High",
      Medium: "Medium",
      Low: "Low",
    },
    source: {
      Policy: "Safety policy",
      DriverHealth: "Driver health",
      NgRate: "NG rate",
      // GĐ3 closeout WI-4 — the identity/certificate-expiry evaluator (raised at High, never Critical).
      Identity: "Certificate expiry",
    },
    detail: {
      title: (vars: Vars) => `Alarm #${vars.id} detail`,
      description: "The full record for this alarm, including its runbook.",
      runbook: "Runbook",
      runbookNone: "No runbook attached to this alarm.",
      firstRaised: "First raised",
      lastRaised: "Last raised",
      state: "State",
      acked: "Acknowledgment",
      ackedBy: (vars: Vars) => `Acknowledged by ${vars.actor} at ${vars.at}`,
      ackedNone: "Not yet acknowledged.",
    },
    state: {
      Active: "Active",
      Acked: "Acked",
      Cleared: "Cleared",
    },
    history: {
      table: {
        time: "Time",
        event: "Event",
        key: "Key",
        source: "Source",
        priority: "Priority",
        message: "Message",
        actor: "Actor",
        actorNone: "System",
        empty: "No alarm history yet.",
        loadFailed: "Couldn't load the alarm history.",
      },
      event: {
        raised: "Raised",
        cleared: "Cleared",
        acked: "Acked",
      },
    },
    pagination: {
      showing: (vars: Vars) => `Showing ${vars.from}–${vars.to} of ${vars.total}`,
      prev: "Prev",
      next: "Next",
    },
  },

  // GĐ3 sub-4 LC-4 (`routes/LineControl.tsx`) — the operator UI over LC-3's supervisory PackML state
  // machine: a live state badge (`GET /v1/line`, polled) + transition-gated command buttons
  // (`POST /v1/line/{command}`) mirroring `LineController.Execute`'s own transition table, so the UI
  // never offers a command the server would reject. Abort is the one deliberate exception — styled as
  // the always-enabled, always-reachable stop action, mirroring the physical convention that a real
  // emergency-stop control is never greyed out. SM-4: Abort is a software abort of THIS software's own
  // pipeline, not a safety device — see README §1.
  line: {
    title: "Line Control",
    description:
      "The line's current PackML state and its control commands (Start/Hold/Unhold/Stop/Abort/Reset) — only the commands valid from the current state can be pressed.",
    status: {
      title: "Line status",
      holdReason: (vars: Vars) => `Hold reason: ${vars.reason}`,
      pipelineLabel: "Pipeline",
      running: "Running",
      notRunning: "Not running",
      // SM-4 — was "E-STOP": this reads `FleetHost.EstopEngaged`, a supervisory software latch, not a
      // safety device — see README §1.
      estopLabel: "Halt latch (software)",
      estopEngaged: "Engaged",
      estopClear: "Not engaged",
      loadFailed: "Couldn't load the line status.",
    },
    state: {
      Idle: "Idle",
      Execute: "Running",
      Held: "Held",
      Stopped: "Stopped",
      Aborted: "Aborted",
    },
    commands: {
      title: "Control commands",
      start: "Start",
      hold: "Hold",
      unhold: "Unhold",
      stop: "Stop",
      abort: "Abort",
      reset: "Reset",
      // Full accessible names (`aria-label`, not the visible button text) — see `vi.ts`'s own comment:
      // "Stop" alone is IDENTICAL to `shell.topBar.stop` (TopBar's own Fleet-level Stop button, always
      // visible in the same Shell chrome), so these disambiguate for assistive tech while the visible
      // chrome stays terse PackML terms.
      startAria: "Start the line",
      holdAria: "Hold the line",
      unholdAria: "Unhold the line",
      stopAria: "Stop the line",
      // SM-4 — was "Abort (emergency stop) the line": describes what actually happens instead of
      // borrowing the authority of a safety term. See README §1 — this product has no write path to
      // any device and cannot stop a machine.
      abortAria: "Abort (stops data collection immediately) the line",
      resetAria: "Reset the line",
    },
    errors: {
      generic: "Couldn't run that command — the current state doesn't allow it.",
    },
  },

  toast: {
    fleetStarted: "Fleet started.",
    fleetStartFailed: "Couldn't start the fleet.",
    fleetStopped: "Fleet stopped.",
    scenarioPresetApplied: (vars: Vars) => `Applied the "${vars.name}" preset.`,
    scenarioBurstApplied: "Burst triggered.",
    sitePrefilled: (vars: Vars) => `Filled host/port from ${vars.instanceName}.`,
    settingsSaved: "Settings saved.",
    settingsSaveFailed: "Couldn't save settings.",
    oeeTargetsSaved: "OEE targets saved.",
    oeeTargetsSaveFailed: "Couldn't save OEE targets.",
    onboardingKeyStored: (vars: Vars) => `Key stored for ${vars.code}.`,
    configPulled: (vars: Vars) => `Pulled config for ${vars.code} (v${vars.version}).`,
    configPullFailed: "Couldn't pull config.",
    configPushed: (vars: Vars) => `Pushed config for ${vars.code} (v${vars.version}).`,
    configPushBlocked: (vars: Vars) => `Pushed config for ${vars.code} — some limits were blocked by threshold governance.`,
    configPushConflicts: (vars: Vars) =>
      `Pushed config for ${vars.code} — ${vars.count} point${Number(vars.count) === 1 ? "" : "s"} had a stale-write conflict and weren't overwritten.`,
    configPushFailed: "Couldn't push config.",
    machineSettingUpdated: (vars: Vars) => `Updated ${vars.key}.`,
    machineSettingUpdateFailed: "Couldn't update the parameter.",
    machineSettingReset: (vars: Vars) => `Reset ${vars.key} to the recommended value.`,
    machineSettingResetFailed: "Couldn't reset the parameter.",
    keyCopied: "Key copied.",
    productCreated: (vars: Vars) => `Product ${vars.code} created.`,
    productSaved: "Product saved.",
    productDeleted: (vars: Vars) => `Product ${vars.code} deleted.`,
    recipeCreated: (vars: Vars) => `Recipe ${vars.code} created.`,
    recipeSaved: "Recipe saved.",
    recipeDeleted: (vars: Vars) => `Recipe ${vars.code} deleted.`,
    pointCreated: (vars: Vars) => `Point ${vars.code} created.`,
    pointSaved: "Point saved.",
    pointSaveFailed: "Couldn't save the point.",
    pointDeleted: (vars: Vars) => `Point ${vars.code} deleted.`,
    pointDeleteFailed: "Couldn't delete the point.",
    fiducialSaved: "Fiducial saved.",
    fiducialSaveFailed: "Couldn't save the fiducial.",
    fiducialDeleted: "Fiducial deleted.",
    variantSaved: "Variant added.",
    variantSaveFailed: "Couldn't save the variant.",
    userCreated: (vars: Vars) => `Created user ${vars.username}.`,
    userCreateFailed: "Couldn't create the user.",
    userRoleUpdated: (vars: Vars) => `Updated ${vars.username}'s role.`,
    userRoleUpdateFailed: "Couldn't update the role.",
    userDisabled: (vars: Vars) => `Disabled ${vars.username}.`,
    userEnabled: (vars: Vars) => `Enabled ${vars.username}.`,
    userStatusUpdateFailed: "Couldn't update the user's status.",
    userPasswordReset: (vars: Vars) => `Reset ${vars.username}'s password.`,
    userPasswordResetFailed: "Couldn't reset the password.",
    logoutFailed: "Couldn't log out.",
    assetLifecycleUpdated: (vars: Vars) => `Updated ${vars.code}'s lifecycle.`,
    assetLifecycleUpdateFailed: "Couldn't update the asset's lifecycle.",
    connectorSaveFailed: "Couldn't save the connector.",
    connectorRemoved: "Connector configuration removed.",
    connectorRemoveFailed: "Couldn't remove the connector.",
    siteLinkSaved: "Site connection saved.",
    siteLinkSaveFailed: "Couldn't save the Site connection.",
    fingerprintCopied: "Fingerprint copied.",
    certCopied: "Certificate copied.",
    identityRotated: "Device identity rotated.",
    identityRotateFailed: "Couldn't rotate the device identity.",
    alarmAcked: (vars: Vars) => `Acknowledged alarm ${vars.code}.`,
    alarmAckFailed: "Couldn't acknowledge the alarm.",
    lineCommandApplied: (vars: Vars) => `Command applied — current state: ${vars.state}.`,
    lineCommandFailed: "Couldn't run the line control command.",
  },
}
