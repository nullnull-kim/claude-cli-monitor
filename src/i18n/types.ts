/**
 * i18n type-safe translation interface.
 * Column headers stay English in all locales (design spec §9.4).
 * CLI messages are fully translated.
 */

export interface Translations {
  // ── Init flow ──
  init: {
    welcome: string;
    stepLang: string;
    stepModel: string;
    stepRows: string;
    stepColors: string;
    stepLiveColor: string;
    stepMainColor: string;
    stepReport: string;
    langAuto: string;
    modelShort: string;
    modelFull: string;
    rowsPrompt: string;
    rowsPreview: string;
    colorsIndividual: string;
    colorsRandom: string;
    colorsUniform: string;
    reportOn: string;
    reportOff: string;
    confirm: string;
    applied: string;
    cancelled: string;
    invalidInput: string;
    noInput: string;
    done: string;
  };

  // ── Config commands ──
  config: {
    title: string;
    currentSettings: string;
    agentNumber: string;
    colorNumber: string;
    apply: string;
    yes: string;
    no: string;
    quit: string;
    resetConfirm: string;
    resetDone: string;
    invalidValue: string;
    currentColor: string;
    availableColors: string;
    colorChanged: string;
  };

  // ── CLI ──
  cli: {
    noSessions: string;
    sessionNotFound: string;
    analyzing: string;
    watching: string;
    reportSaved: string;
    error: string;
  };

  // ── Column headers (English in all locales, per spec §9.4) ──
  columns: {
    status: string;
    model: string;
    agent: string;
    task: string;
    used: string;
    time: string;
    cost: string;
  };

  // ── Report (markdown + terminal) ──
  report: {
    title: string;
    session: string;
    model: string;
    agents: string;
    maxDepth: string;
    time: string;
    agentChainTree: string;
    tokenAttribution: string;
    mainSession: string;
    total: string;
    warnings: string;
    generatedBy: string;
    noAgentsFound: string;
    zeroTokenWarning: string;
    compactionWarning: string;
    sessionsWithSubagents: string;
    andMore: string;
    // Table headers
    colNum: string;
    colTask: string;
    colAgent: string;
    colModel: string;
    colUsed: string;
    colPercent: string;
    colBar: string;
    colCost: string;
    colTime: string;
    colTools: string;
    // Session list headers
    colSession: string;
    colDate: string;
    colProject: string;
    // Metadata labels
    directory: string;
    mainModel: string;
    date: string;
    project: string;
  };
}
