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

  theme: {
    toggleToLight: "Light mode",
    toggleToDark: "Dark mode",
  },

  shell: {
    nav: {
      dashboard: "Dashboard",
      machines: "Machines",
      onboarding: "Onboarding",
      inspector: "API Inspector",
      scenario: "Scenario",
      settings: "Settings",
    },
    sidebar: {
      brandSubtitle: "Machine Simulator",
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
      demoFallback: "Demo fallback",
      paletteAria: "Open command palette (⌘K)",
    },
    commandPalette: {
      designTokens: "Design tokens (reference)",
      searchPlaceholder: "Jump to a screen…",
      searchAria: "Search screens",
      dialogAria: "Command palette",
      listboxAria: "Screens",
      noResults: (vars: Vars) => `No screens match "${vars.query}".`,
    },
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
    subtitleBase: "Live read on the simulated fleet",
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
    empty: {
      title: "Press Start Fleet to begin",
      description: (vars: Vars) =>
        `The simulated fleet has ${vars.roster} machines waiting. Press “Start Fleet” to begin cycling and see live data on the dashboard.`,
      cta: "Start Fleet",
      ctaPending: "Starting…",
    },
  },

  machines: {
    title: "Machines",
    description:
      "Full roster with filters by device class and driver kind. Click a card on the Dashboard to jump straight to a machine's detail view.",
    comingSoon: "Coming in a later task",
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

  onboarding: {
    title: "Onboarding",
    subtitle:
      "Register, wait for approval, and claim/enroll a new machine with the ST4I server — or run the whole flow in demo mode, no real server required.",
    steps: {
      register: "Register",
      poll: "Approval",
      claim: "Claim / Enroll",
      done: "Done",
    },
    demoLiveToggle: {
      aria: "Onboarding path",
    },
    register: {
      description: "Register a new machine with the ST4I server (or simulate the demo flow).",
      serialLabel: "Serial number",
      serialPlaceholder: "e.g. SIM-0001",
      nameLabel: "Machine name",
      namePlaceholder: "e.g. Screw station 01",
      typeLabel: "Machine type",
      typePlaceholder: "e.g. Automation, IoT, AOI/AVI",
      submit: "Register machine",
      submitting: "Registering…",
    },
    poll: {
      waitingPrefix: "Waiting for an administrator to approve",
      waitingSuffix: ". In demo mode, the first check is approved instantly.",
      pending: "Pending",
      back: "Back",
      check: "Check approval",
      checking: "Checking…",
    },
    claim: {
      description: "Approved — get an mk_ key using either of the options below.",
      tabClaim: "Claim (mct_)",
      tabEnroll: "Enroll (met_)",
      claimTokenLabel: "Claim token",
      claimTokenHintDemo: "Not required in demo mode — any token is ignored.",
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
      machineCodeLabel: "Machine code",
      keyLabel: "mk_ key",
      reveal: "Show key",
      hide: "Hide key",
      copy: "Copy key",
      copied: "Copied.",
      viewFleet: "View fleet",
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
    connection: {
      title: "Server connection",
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
      auto: { hint: "Prefers Live, automatically falls back to Demo when disconnected." },
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
    title: "Recipe / config sync",
    description: "Pull the latest recipe and mapping config for this machine from the server, and report whether anything changed.",
    currentState: "Current state",
    syncBtn: "Sync recipe",
    syncing: "Syncing…",
    syncFailed: (vars: Vars) => `Sync failed: ${vars.message}`,
    lastResult: "Last sync result",
    changed: "Changed",
    version: "Version",
    applied: "Applied",
    yes: "Yes",
    no: "No",
    unknownError: "unknown error",
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
    passRateAria: (vars: Vars) => `Pass rate ${vars.pct}%`,
  },

  toast: {
    fleetStarted: "Fleet started.",
    fleetStartFailed: "Couldn't start the fleet.",
    fleetStopped: "Fleet stopped.",
    scenarioPresetApplied: (vars: Vars) => `Applied the "${vars.name}" preset.`,
    scenarioBurstApplied: "Burst triggered.",
    settingsSaved: "Settings saved.",
    settingsSaveFailed: "Couldn't save settings.",
    onboardingKeyStored: (vars: Vars) => `Key stored for ${vars.code}.`,
    configSynced: (vars: Vars) => `Config synced for ${vars.code}.`,
    configSyncFailed: "Config sync failed.",
    keyCopied: "Key copied.",
  },
}
