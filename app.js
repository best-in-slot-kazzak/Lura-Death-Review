const STORAGE_KEY = "luraDeathReview:v1";
const DEFAULT_PERSONAL_SPELL_ID = 1254076;
const HEAVENS_GLAIVES_LABEL = "Heaven's Glaives";
const EARLY_WIPE_DEATH_LIMIT = 5;
const MASS_DEATH_SECOND_MINIMUM = 5;
const PHASE_ORDER = ["P1", "I1", "P2", "P3"];
const TARGET_BOSS_NAME = "Midnight Falls Mythic";
const LIGHTS_END_SPELL_NAME = "Light's End";
const LIGHTS_END_SPELL_ID = 1284699;
const COSMIC_FRACTURE_SPELL_NAME = "Cosmic Fracture";
const CRITICALITY_SPELL_NAME = "Criticality";
const CRITICALITY_SPELL_ID = 1281178;
const DISSONANCE_SPELL_NAME = "Dissonance";
const DARK_CONSTELLATION_SPELL_NAME = "Dark Constellation";
const STELLAR_IMPLOSION_SPELL_NAME = "Stellar Implosion";
const RADIANCE_SPELL_NAME = "Radiance";
const TEARS_OF_LURA_SPELL_NAME = "Tears of L'ura";
const TERMINATE_SPELL_NAME = "Terminate";
const TERMINATE_SPELL_ID = 1284934;
const TERMINATION_MATRIX_NAME = "Termination Matrix";
const INTERRUPT_LOOKBACK_SECONDS = 10;
const INTERRUPT_GRACE_SECONDS = 2.5;
const INTERRUPT_WAVE_GAP_SECONDS = 20;
const CRYSTAL_POP_WINDOW_SECONDS = 2;
const CRYSTAL_POP_UNKNOWN_MINIMUM = 4;
const CRYSTAL_POP_PLAYERS = new Set(["Ruthisoma", "Rezebel", "Uwumiao", "Mamaessen", "Rakkshasza", "Esmaiel"]);
const HEAVENS_GLAIVES_SPELL_NAME = HEAVENS_GLAIVES_LABEL;
const INTERRUPT_SEQUENCES = [
  ["Eliixdk", "Rootmuncher", "Rakkshasza", "Patchmyprey"],
  ["Azocariv", "Mamaessen", "Esmaiel", "Olanwizard"],
  ["Nóvamh", "Uwumiao", "Lözon", "Flappywappy"]
];
const READ_ONLY_MODE = document.body.dataset.mode === "readonly";

const DEFAULT_RULES = {
  groupSpells: [
    { spellId: 1251789, name: "Cosmic Fracture", label: "Cosmic Fracture / group failure" }
  ],
  personalSpells: [],
  phases: [
    { name: "P1", from: 0, to: 120 },
    { name: "P2", from: 120, to: 180 },
    { name: "P3", from: 180, to: 9999 }
  ],
  clusterWindowSeconds: 3,
  clusterMinimumDeaths: 3
};

let state = loadState();
let selectedPlayer = localStorage.getItem("luraDeathReview:selectedPlayer") || "";
let selectedReport = localStorage.getItem("luraDeathReview:selectedReport") || "all";
let selectedWipePhase = localStorage.getItem("luraDeathReview:selectedWipePhase") || "all";
let selectedWipeReason = "all";

function loadState() {
  if (window.LURA_EMBEDDED_STATE) {
    return {
      imports: window.LURA_EMBEDDED_STATE.imports || [],
      rules: window.LURA_EMBEDDED_STATE.rules || DEFAULT_RULES
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      imports: saved?.imports || [],
      rules: saved?.rules || DEFAULT_RULES
    };
  } catch {
    return { imports: [], rules: DEFAULT_RULES };
  }
}

function saveState() {
  if (READ_ONLY_MODE) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function secondsToTime(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function spellKey(death) {
  return death.killingBlow?.spellId || death.killingBlow?.spellName || "unknown";
}

function getPhase(time) {
  return state.rules.phases.find((phase) => time >= phase.from && time < phase.to)?.name || "Unknown";
}

function normalizePhase(value) {
  return String(value || "Unknown").trim().toUpperCase() || "Unknown";
}

function sortedImports() {
  const reportFirstSeen = new Map();
  for (const entry of state.imports) {
    const key = reportKey(entry);
    const value = importSortValue(entry);
    reportFirstSeen.set(key, Math.min(reportFirstSeen.get(key) ?? value, value));
  }

  return [...state.imports].sort((a, b) =>
    (reportFirstSeen.get(reportKey(a)) ?? 0) - (reportFirstSeen.get(reportKey(b)) ?? 0) ||
    reportKey(a).localeCompare(reportKey(b)) ||
    (a.fightId || 0) - (b.fightId || 0) ||
    importSortValue(a) - importSortValue(b)
  );
}

function visibleImports() {
  return sortedImports().filter((entry) => selectedReport === "all" || reportKey(entry) === selectedReport);
}

function importSortValue(entry) {
  const candidates = [
    entry.reportStartTime,
    entry.startTime,
    entry.fightMeta?.startTime,
    entry.fightMeta?.dateTime,
    entry.extractedAt
  ];
  for (const candidate of candidates) {
    const value = Date.parse(candidate);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function reportKey(entry) {
  return entry.reportCode || "manual";
}

function flattenDeaths(imports = visibleImports()) {
  return imports.flatMap((entry, importIndex) => {
    const sortedRows = [...entry.deaths].sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0));
    const deathOrderByDeath = new Map(sortedRows.map((death, index) => [death, index + 1]));
    const deathsBySecond = groupBy(entry.deaths.filter((death) => Number.isFinite(death.time)), (death) => death.time);

    return entry.deaths.map((death) => ({
      ...death,
      deathOrder: deathOrderByDeath.get(death) || null,
      isBeforeWipeCluster: (deathOrderByDeath.get(death) || 99999) < EARLY_WIPE_DEATH_LIMIT,
      isMassDeathSecond: Number.isFinite(death.time) && (deathsBySecond.get(death.time)?.length || 0) >= MASS_DEATH_SECOND_MINIMUM,
      importIndex,
      importId: entry.importId,
      reportCode: entry.reportCode,
      fightId: entry.fightId,
      pullLabel: entry.pullLabel || `Fight ${entry.fightId || importIndex + 1}`,
      pageUrl: entry.pageUrl,
      phase: normalizePhase(entry.fightMeta?.phase || getPhase(death.time))
    }));
  });
}

function classifyDeaths(deaths) {
  const groupIds = new Set(state.rules.groupSpells.map((spell) => Number(spell.spellId)).filter(Boolean));
  const personalIds = new Set(state.rules.personalSpells.map((spell) => Number(spell.spellId)).filter(Boolean));
  const classified = deaths.map((death) => ({
    ...death,
    classification: "unknown",
    classificationReason: "No rule matched"
  }));

  for (const death of classified) {
    const id = death.killingBlow?.spellId;
    if (groupIds.has(id)) {
      death.classification = "group";
      death.classificationReason = "Spell rule: Group";
    } else if (personalIds.has(id)) {
      death.classification = "personal";
      death.classificationReason = "Spell rule: Personal";
    }
  }

  const byPullAndSpell = groupBy(
    classified.filter((death) => death.time !== null && death.classification === "unknown"),
    (death) => `${death.importId}:${spellKey(death)}`
  );

  for (const cluster of byPullAndSpell.values()) {
    const sorted = [...cluster].sort((a, b) => a.time - b.time);
    for (let start = 0; start < sorted.length; start += 1) {
      const members = sorted.filter((death) => death.time >= sorted[start].time && death.time <= sorted[start].time + state.rules.clusterWindowSeconds);
      if (members.length >= state.rules.clusterMinimumDeaths) {
        for (const member of members) {
          member.classification = "group";
          member.classificationReason = `${members.length} Deaths in ${state.rules.clusterWindowSeconds}s`;
        }
      }
    }
  }

  for (const death of classified) {
    if (death.classification === "unknown") {
      death.classification = "personal";
      death.classificationReason = "Fallback: single death";
    }
  }

  return classified;
}

function buildPulls(deaths, imports = visibleImports()) {
  return imports.map((entry, index) => {
    const pullDeaths = deaths.filter((death) => death.importId === entry.importId);
    const duration = Math.max(...pullDeaths.map((death) => death.time || 0), 0);
    return {
      importId: entry.importId,
      number: index + 1,
      label: entry.pullLabel || `Fight ${entry.fightId || index + 1}`,
      reportCode: entry.reportCode || "-",
      fightId: entry.fightId || "-",
      duration: parseDuration(entry.fightMeta?.durationText) ?? duration,
      wipePhase: normalizePhase(entry.fightMeta?.phase || "Unknown"),
      bossPercent: entry.fightMeta?.percentText || "-",
      personalDeaths: pullDeaths.filter((death) => death.classification === "personal").length,
      groupDeaths: pullDeaths.filter((death) => death.classification === "group").length,
      primaryCause: primaryCause(pullDeaths)
    };
  });
}

function primaryCause(deaths) {
  const counts = new Map();
  for (const death of deaths) {
    const label = death.killingBlow?.spellName || "Unknown";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
}

function parseDuration(value) {
  const match = String(value || "").match(/(\d+):(\d+)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function render() {
  const imports = visibleImports();
  const deaths = classifyDeaths(flattenDeaths(imports));
  const pulls = buildPulls(deaths, imports);

  document.querySelector("#stat-pulls").textContent = pulls.length;

  renderReportSelect();
  renderPhaseChart(pulls);
  renderReportPhaseDelta(pulls, imports);
  renderPlayerSelect(deaths);
  renderPlayerSpellChart(deaths, pulls);
  renderWipePhaseFilter(pulls);
  renderWipeReasons(deaths, pulls);
}

function renderReportSelect() {
  const select = document.querySelector("#report-select");
  const reports = [...groupBy(sortedImports(), reportKey).entries()].map(([key, entries]) => ({
    key,
    label: reportLabel(key, entries),
    firstSeen: Math.min(...entries.map(importSortValue))
  })).sort((a, b) => a.firstSeen - b.firstSeen);

  const validKeys = new Set(["all", ...reports.map((report) => report.key)]);
  if (!validKeys.has(selectedReport)) {
    selectedReport = "all";
    localStorage.setItem("luraDeathReview:selectedReport", selectedReport);
  }

  select.innerHTML = [
    `<option value="all"${selectedReport === "all" ? " selected" : ""}>All reports</option>`,
    ...reports.map((report) => `<option value="${escapeHtml(report.key)}"${report.key === selectedReport ? " selected" : ""}>${escapeHtml(report.label)}</option>`)
  ].join("");
}

function reportLabel(key, entries) {
  const pullCount = entries.length;
  return `${reportDisplayName(entries)} · ${pullCount} pulls`;
}

function reportDisplayName(entriesOrEntry) {
  const entries = Array.isArray(entriesOrEntry) ? entriesOrEntry : [entriesOrEntry];
  const first = entries[0];
  return first?.reportName || entries.find((entry) => entry.reportName)?.reportName || first?.reportCode || "Manual import";
}

function formatDate(timestamp) {
  if (!timestamp) return "unknown date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(timestamp));
}

function earlySelectedSpellDeaths(deaths) {
  return deaths.filter((death) => {
    if (death.killingBlow?.spellId !== DEFAULT_PERSONAL_SPELL_ID) return false;
    return death.isBeforeWipeCluster || death.isMassDeathSecond;
  });
}

function missedInterruptReasonForPull(pullDeaths, interrupts, interruptSequences = INTERRUPT_SEQUENCES) {
  const terminateDeath = [...pullDeaths]
    .filter((death) => death.killingBlow?.spellName === TERMINATE_SPELL_NAME || death.killingBlow?.spellId === TERMINATE_SPELL_ID)
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999))[0];
  if (!terminateDeath) return { label: "Unknown", player: "", type: "unknown" };

  const deathTime = terminateDeath.time ?? 0;
  const beforeDeathInterrupts = (interrupts || [])
    .filter((event) => Number.isFinite(event.time) && event.time <= deathTime)
    .sort((a, b) => a.time - b.time);
  const relevantInterrupts = currentInterruptWave(beforeDeathInterrupts, deathTime, interruptSequences);

  const wrongKick = relevantInterrupts.find((event) =>
    isSequencePlayer(eventSourceName(event), interruptSequences) &&
    event.type === "Interrupt" &&
    !isTerminateMatrixInterrupt(event)
  );
  if (wrongKick) {
    return { label: `Missed Interrupt -> ${eventSourceName(wrongKick)}`, player: eventSourceName(wrongKick), type: "missed-interrupt" };
  }

  const validInterrupts = relevantInterrupts.filter(isTerminateMatrixInterrupt);
  const culprit = findMissedInterruptPlayer(validInterrupts, deathTime, terminateDeath.player, interruptSequences);

  return {
    label: culprit ? `Missed Interrupt -> ${culprit}` : "Missed Interrupt",
    player: culprit,
    type: "missed-interrupt"
  };
}

function isSequencePlayer(player, interruptSequences = INTERRUPT_SEQUENCES) {
  return interruptSequences.some((sequence) => sequence.includes(player));
}

function eventSourceName(event) {
  return normalizeActorName(event.source?.name || event.source?.rawName || "");
}

function normalizeActorName(value) {
  const text = String(value || "").trim();
  const ownerMatch = text.match(/\(([^)]+)\)/);
  return ownerMatch ? ownerMatch[1].trim() : text;
}

function isTerminateMatrixInterrupt(event) {
  return event.type === "Interrupt" &&
    (event.interruptedAbility?.spellName === TERMINATE_SPELL_NAME || event.interruptedAbility?.spellId === TERMINATE_SPELL_ID) &&
    event.target?.name === TERMINATION_MATRIX_NAME;
}

function currentInterruptWave(interrupts, deathTime, interruptSequences = INTERRUPT_SEQUENCES) {
  const sequenceInterrupts = interrupts
    .filter((event) => isSequencePlayer(eventSourceName(event), interruptSequences) || isTerminateMatrixInterrupt(event))
    .sort((a, b) => a.time - b.time);
  if (!sequenceInterrupts.length) return [];

  const waves = [];
  let currentWave = [];
  for (const event of sequenceInterrupts) {
    const previous = currentWave.at(-1);
    if (previous && event.time - previous.time > INTERRUPT_WAVE_GAP_SECONDS) {
      waves.push(currentWave);
      currentWave = [];
    }
    currentWave.push(event);
  }
  if (currentWave.length) waves.push(currentWave);

  return [...waves].reverse().find((wave) => wave[0].time >= deathTime - INTERRUPT_LOOKBACK_SECONDS) || waves.at(-1) || [];
}

function findMissedInterruptPlayer(validInterrupts, deathTime, terminateDeathPlayer, interruptSequences = INTERRUPT_SEQUENCES) {
  const normalizedTerminateDeathPlayer = normalizeActorName(terminateDeathPlayer);
  if (!validInterrupts.length) return isSequencePlayer(normalizedTerminateDeathPlayer, interruptSequences) ? normalizedTerminateDeathPlayer : "";

  const sequenceInterrupts = validInterrupts.filter((event) => isSequencePlayer(eventSourceName(event), interruptSequences));
  if (!sequenceInterrupts.length) return isSequencePlayer(normalizedTerminateDeathPlayer, interruptSequences) ? normalizedTerminateDeathPlayer : "";

  const waveStart = sequenceInterrupts[0].time;
  const sequenceEventsByLane = interruptSequences.map((sequence) =>
    sequenceInterrupts
      .filter((event) => sequence.includes(eventSourceName(event)))
      .sort((a, b) => a.time - b.time)
  );

  const candidates = [];

  for (let slot = 0; slot < 4; slot += 1) {
    for (let lane = 0; lane < interruptSequences.length; lane += 1) {
      const sequence = interruptSequences[lane];
      if (slot >= sequence.length) continue;
      const sequenceEvents = sequenceEventsByLane[lane];
      const expectedPlayer = sequence[slot];
      const previousPlayer = sequence[slot - 1];
      const previousEvent = slot === 0
        ? null
        : sequenceEvents.find((event) => eventSourceName(event) === previousPlayer);
      const cursorTime = previousEvent?.time ?? waveStart;

      if (slot > 0 && !previousEvent) {
        continue;
      }

      const event = sequenceEvents.find((candidate) => eventSourceName(candidate) === expectedPlayer && candidate.time >= cursorTime - 0.05);
      const dueTime = cursorTime + INTERRUPT_GRACE_SECONDS;
      if (!event) {
        const waveProgressedPastExpectedKick = sequenceInterrupts.some((candidate) => {
          const position = interruptSequencePosition(eventSourceName(candidate), interruptSequences);
          return position &&
            candidate.time >= cursorTime - 0.05 &&
            candidate.time <= deathTime &&
            (position.slot > slot || (position.slot === slot && position.lane !== lane));
        });
        if (deathTime > dueTime || waveProgressedPastExpectedKick) {
          candidates.push({ player: expectedPlayer, dueTime, slot, lane });
        }
        continue;
      }

      const gap = event.time - cursorTime;
      if (gap > INTERRUPT_GRACE_SECONDS) {
        candidates.push({ player: expectedPlayer, dueTime, slot, lane });
      }
    }
  }

  if (candidates.length) {
    candidates.sort((a, b) => a.slot - b.slot || a.dueTime - b.dueTime || a.lane - b.lane);
    return candidates[0].player;
  }

  const terminateDeathPlayerKicked = validInterrupts.some((event) => eventSourceName(event) === normalizedTerminateDeathPlayer);
  return isSequencePlayer(normalizedTerminateDeathPlayer, interruptSequences) && !terminateDeathPlayerKicked ? normalizedTerminateDeathPlayer : "";
}

function interruptSequencePosition(player, interruptSequences = INTERRUPT_SEQUENCES) {
  for (let lane = 0; lane < interruptSequences.length; lane += 1) {
    const slot = interruptSequences[lane].indexOf(player);
    if (slot >= 0) return { lane, slot };
  }
  return null;
}

function wipeReasonForPull(pullDeaths) {
  const ordered = [...pullDeaths].sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0));
  const firstFive = ordered.slice(0, 5);
  const lightsEndDeaths = firstFive.filter((death) => deathHasSpell(death, LIGHTS_END_SPELL_NAME, LIGHTS_END_SPELL_ID));
  if (!lightsEndDeaths.length) return { label: "Unknown", player: "", type: "unknown" };

  const crystalPlayerDeath = ordered.find((death, index) =>
    (index < 5 || isHeavensGlaivesDeath(death)) &&
    CRYSTAL_POP_PLAYERS.has(death.player) &&
    !deathHasSpell(death, LIGHTS_END_SPELL_NAME, LIGHTS_END_SPELL_ID) &&
    lightsEndDeaths.some((lightsEndDeath) => Math.abs((death.time ?? 99999) - (lightsEndDeath.time ?? -99999)) <= CRYSTAL_POP_WINDOW_SECONDS)
  );

  if (!crystalPlayerDeath) {
    const lastHitLightsEndDeaths = firstFive.filter((death) =>
      (death.lastHits || []).some((hit) => spellMatches(hit, LIGHTS_END_SPELL_NAME, LIGHTS_END_SPELL_ID))
    );
    return lastHitLightsEndDeaths.length >= CRYSTAL_POP_UNKNOWN_MINIMUM
      ? { label: "Crystal Pop -> Unknown", player: "", type: "crystal-pop-unknown" }
      : { label: "Unknown", player: "", type: "unknown" };
  }
  return { label: `Crystal Pop -> ${crystalPlayerDeath.player}`, player: crystalPlayerDeath.player, type: "crystal-pop" };
}

function runeOrderReasonForPull(pullDeaths) {
  const firstFive = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 5);
  return firstFive.some((death) => deathHasSpell(death, DISSONANCE_SPELL_NAME))
    ? { label: "Rune Order", player: "", type: "rune-order" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function deathHasSpell(death, spellName, spellId) {
  return spellMatches(death.killingBlow, spellName, spellId) ||
    (death.lastHits || []).some((hit) => spellMatches(hit, spellName, spellId));
}

function isHeavensGlaivesDeath(death) {
  return spellMatches(death.killingBlow, HEAVENS_GLAIVES_SPELL_NAME, DEFAULT_PERSONAL_SPELL_ID);
}

function spellMatches(spell, spellName, spellId) {
  const idMatches = spellId !== undefined && spellId !== null && spell?.spellId === spellId;
  const nameMatches = Boolean(spellName) && normalizeSpellName(spell?.spellName) === normalizeSpellName(spellName);
  return idMatches || nameMatches;
}

function normalizeSpellName(value) {
  return String(value || "").trim().toLowerCase();
}

function fallbackWipeReasonForPull(pullDeaths) {
  const cosmicDeaths = pullDeaths.filter((death) => death.killingBlow?.spellName === COSMIC_FRACTURE_SPELL_NAME);
  if (cosmicDeaths.length > 1) return { label: "Crystal Adds", player: "", type: "crystal-adds" };

  const firstFive = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 5);
  const glaivesDeaths = firstFive.filter((death) =>
    death.killingBlow?.spellName === HEAVENS_GLAIVES_SPELL_NAME ||
    death.killingBlow?.spellId === DEFAULT_PERSONAL_SPELL_ID
  );
  if (glaivesDeaths.length >= 3) return { label: "Glaives :(", player: "", type: "glaives" };

  return { label: "Unknown", player: "", type: "unknown" };
}

function radianceReasonForPull(pullDeaths) {
  const firstFive = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 5);
  return firstFive.some((death) => death.killingBlow?.spellName === RADIANCE_SPELL_NAME)
    ? { label: "Child was left behind 💔", player: "", type: "child-left-behind" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function circleOverlapCrystalPopReasonForPull(pullDeaths) {
  const ordered = [...pullDeaths].sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0));
  const firstFive = ordered.slice(0, 5);
  const hasEarlyLightsEnd = firstFive.some((death) => deathHasSpell(death, LIGHTS_END_SPELL_NAME, LIGHTS_END_SPELL_ID));
  if (!hasEarlyLightsEnd) return { label: "Unknown", player: "", type: "unknown" };

  const criticalityShardholder = ordered.find((death) =>
    CRYSTAL_POP_PLAYERS.has(death.player) &&
    spellMatches(death.killingBlow, CRITICALITY_SPELL_NAME, CRITICALITY_SPELL_ID)
  );
  const lightEndCriticalityOverlapDeaths = firstFive.filter((death) =>
    hasLastHitSpell(death, LIGHTS_END_SPELL_NAME, LIGHTS_END_SPELL_ID) &&
    hasLastHitSpell(death, CRITICALITY_SPELL_NAME, CRITICALITY_SPELL_ID)
  );

  return criticalityShardholder || lightEndCriticalityOverlapDeaths.length >= 2
    ? { label: "Circle overlap resulted in crystal pop", player: "", type: "circle-overlap-crystal-pop" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function hasLastHitSpell(death, spellName, spellId) {
  return (death.lastHits || []).some((hit) => spellMatches(hit, spellName, spellId));
}

function p3PickupReasonForPull(pullDeaths) {
  const firstFive = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 5);
  return firstFive.some((death) => (death.lastHits || []).some((hit) => spellMatches(hit, TEARS_OF_LURA_SPELL_NAME)))
    ? { label: "Start of P3 pickup", player: "", type: "p3-pickup" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function p3RuneOrderReasonForPull(pullDeaths) {
  const firstFive = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 5);
  return firstFive.some((death) => death.killingBlow?.spellName === DISSONANCE_SPELL_NAME)
    ? { label: "P3 Rune order", player: "", type: "p3-rune-order" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function p3DarkConstellationReasonForPull(pullDeaths) {
  const firstFive = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 5);
  const darkConstellationDeaths = firstFive.filter((death) =>
    spellMatches(death.killingBlow, DARK_CONSTELLATION_SPELL_NAME)
  );
  return darkConstellationDeaths.length >= 2
    ? { label: "Dark Constellation massacre", player: "", type: "dark-constellation-massacre" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function p3MissedBigSoaksReasonForPull(pullDeaths) {
  const firstSeven = [...pullDeaths]
    .sort((a, b) => (a.time ?? 99999) - (b.time ?? 99999) || (a.row ?? 0) - (b.row ?? 0))
    .slice(0, 7);
  return firstSeven.some((death) => spellMatches(death.killingBlow, STELLAR_IMPLOSION_SPELL_NAME))
    ? { label: "Missed big soaks", player: "", type: "missed-big-soaks" }
    : { label: "Unknown", player: "", type: "unknown" };
}

function renderWipeReasons(deaths, pulls) {
  const imports = visibleImports();
  const classByPlayer = playerClassMap(deaths, imports);
  const phaseRows = buildWipeReasonRows(deaths, pulls, imports);
  renderWipeReasonFilter(phaseRows);
  renderWipeReasonInsights(selectedWipeReason === "all" ? phaseRows : []);
  const rows = selectedWipeReason === "all"
    ? phaseRows
    : phaseRows.filter((row) => reasonBucket(row.reason).key === selectedWipeReason);
  renderWipePlayerBreakdown(rows, classByPlayer);

  document.querySelector("#wipe-reasons-list").innerHTML = rows.length
    ? [...rows].reverse().map(({ pull, reason, reportName }) => `
      <div class="wipe-row">
        <div>
          <strong>${renderReasonLabel(reason, classByPlayer)}</strong>
          <span>${renderReportFightLink(pull, reportName)}</span>
        </div>
        <span class="wipe-meta">${secondsToTime(pull.duration)} · ${escapeHtml(pull.wipePhase)}</span>
      </div>
    `).join("")
    : `<div class="wipe-row empty">No pulls imported.</div>`;
}

function renderWipePlayerBreakdown(rows, classByPlayer) {
  const container = document.querySelector("#wipe-player-breakdown");
  const enabled = selectedWipeReason === "crystal-pop" || selectedWipeReason === "missed-interrupt";
  const playerRows = rows.filter((row) => row.reason.player);
  if (!enabled || !playerRows.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const counts = [...groupBy(playerRows, (row) => row.reason.player).entries()]
    .map(([player, reasonRows]) => ({
      player,
      count: reasonRows.length,
      share: Math.round((reasonRows.length / playerRows.length) * 100)
    }))
    .sort((a, b) => b.count - a.count || a.player.localeCompare(b.player));

  container.hidden = false;
  container.innerHTML = `
    <div class="reason-bars">
      ${counts.map((item) => `
        <div class="reason-bar-row">
          <div class="reason-bar-meta">
            <strong style="color:${classColor(classByPlayer.get(item.player))}">${escapeHtml(item.player)}</strong>
            <span>${item.share}% · ${item.count} Pulls</span>
          </div>
          <div class="reason-bar-track player-track">
            <span style="width:${item.share}%; background:${classColor(classByPlayer.get(item.player))}"></span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderReportFightLink(pull, reportName) {
  const label = `${pull.label} · ${reportName}`;
  if (!pull.reportCode || pull.reportCode === "-" || !pull.fightId || pull.fightId === "-") return escapeHtml(label);
  const url = `https://www.warcraftlogs.com/reports/${encodeURIComponent(pull.reportCode)}?fight=${encodeURIComponent(pull.fightId)}`;
  return `<a href="${url}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function buildWipeReasonRows(deaths, pulls, imports) {
  const importsById = new Map(imports.map((entry) => [entry.importId, entry]));
  const filteredPulls = selectedWipePhase === "all" ? pulls : pulls.filter((pull) => pull.wipePhase === selectedWipePhase);
  return filteredPulls.map((pull) => {
    const pullDeaths = deaths.filter((death) => death.importId === pull.importId);
    const entry = importsById.get(pull.importId) || {};
    const reason = wipeReasonForPhase(pull, pullDeaths, entry);
    return { pull, reason, reportName: reportDisplayName(entry), deaths: pullDeaths };
  });
}

function renderWipeReasonInsights(rows) {
  const container = document.querySelector("#wipe-reason-insights");
  if (!rows.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  container.hidden = false;
  const buckets = [...groupBy(rows, (row) => reasonBucket(row.reason).key).entries()]
    .map(([key, bucketRows]) => ({
      ...reasonBucket(bucketRows[0].reason),
      count: bucketRows.length,
      share: Math.round((bucketRows.length / rows.length) * 100)
    }))
    .sort((a, b) => b.count - a.count);

  container.innerHTML = `
    <div class="reason-bars">
      ${buckets.map((bucket) => `
        <div class="reason-bar-row">
          <div class="reason-bar-meta">
            <strong>${escapeHtml(bucket.label)}</strong>
            <span>${bucket.share}% · ${bucket.count} Pulls</span>
          </div>
          <div class="reason-bar-track">
            <span class="${escapeHtml(bucket.key)}" style="width:${bucket.share}%; background:${reasonColor(bucket.key)}"></span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function reasonDisplayText(reason) {
  if (reason.type === "crystal-pop") return `Crystal Pop -> ${reason.player}`;
  if (reason.type === "crystal-pop-unknown") return "Crystal Pop -> Unknown";
  return reason.label || "Unknown";
}

function reasonClass(reason) {
  return reason.type || "unknown";
}

function reasonBucket(reason) {
  if (reason.type === "crystal-pop" || reason.type === "crystal-pop-unknown") return { key: "crystal-pop", label: "Crystal Pop" };
  if (reason.type === "missed-interrupt") return { key: "missed-interrupt", label: "Missed Interrupt" };
  if (reason.type === "rune-order") return { key: "rune-order", label: "Rune Order" };
  if (reason.type === "crystal-adds") return { key: "crystal-adds", label: "Crystal Adds" };
  if (reason.type === "glaives") return { key: "glaives", label: "Glaives :(" };
  if (reason.type === "child-left-behind") return { key: "child-left-behind", label: "Child was left behind 💔" };
  if (reason.type === "p3-pickup") return { key: "p3-pickup", label: "Start of P3 pickup" };
  if (reason.type === "p3-rune-order") return { key: "p3-rune-order", label: "P3 Rune order" };
  if (reason.type === "dark-constellation-massacre") return { key: "dark-constellation-massacre", label: "Dark Constellation massacre" };
  if (reason.type === "missed-big-soaks") return { key: "missed-big-soaks", label: "Missed big soaks" };
  if (reason.type === "circle-overlap-crystal-pop") return { key: "circle-overlap-crystal-pop", label: "Circle overlap resulted in crystal pop" };
  return { key: "unknown", label: "Unknown" };
}

function reasonColor(reasonKey) {
  const colors = {
    "crystal-pop": "#e6b450",
    "missed-interrupt": "#ef6f6c",
    "rune-order": "#6fb7ff",
    "crystal-adds": "#86d7ff",
    "glaives": "#b8a7ff",
    "child-left-behind": "#f48cba",
    "p3-pickup": "#ff6fb1",
    "p3-rune-order": "#6fb7ff",
    "dark-constellation-massacre": "#ff3b3b",
    "missed-big-soaks": "#ff9f43",
    "circle-overlap-crystal-pop": "#d48cff",
    "unknown": "#a8b4bd"
  };
  return colors[reasonKey] || colors.unknown;
}

function wipeReasonForPhase(pull, pullDeaths, entry) {
  const wipePhase = normalizePhase(pull.wipePhase);
  if (wipePhase === "P3") {
    const p3RuneOrderReason = p3RuneOrderReasonForPull(pullDeaths);
    const p3PickupReason = p3RuneOrderReason.type === "unknown" ? p3PickupReasonForPull(pullDeaths) : p3RuneOrderReason;
    const p3DarkConstellationReason = p3PickupReason.type === "unknown" ? p3DarkConstellationReasonForPull(pullDeaths) : p3PickupReason;
    return p3DarkConstellationReason.type === "unknown" ? p3MissedBigSoaksReasonForPull(pullDeaths) : p3DarkConstellationReason;
  }

  if (wipePhase === "I1") {
    const crystalPopReason = wipeReasonForPull(pullDeaths);
    return crystalPopReason.type === "unknown" ? radianceReasonForPull(pullDeaths) : crystalPopReason;
  }

  if (wipePhase === "P2") {
    const circleOverlapReason = circleOverlapCrystalPopReasonForPull(pullDeaths);
    return circleOverlapReason.type === "unknown" ? radianceReasonForPull(pullDeaths) : circleOverlapReason;
  }

  const runeOrderReason = runeOrderReasonForPull(pullDeaths);
  const interruptReason = runeOrderReason.type === "unknown" ? missedInterruptReasonForPull(pullDeaths, entry.interrupts || [], interruptSequencesForImport(entry)) : runeOrderReason;
  const crystalPopReason = interruptReason.type === "unknown" ? wipeReasonForPull(pullDeaths) : interruptReason;
  const fallbackReason = crystalPopReason.type === "unknown" ? fallbackWipeReasonForPull(pullDeaths) : crystalPopReason;
  return fallbackReason.type === "unknown" ? radianceReasonForPull(pullDeaths) : fallbackReason;
}

function interruptSequencesForImport(entry) {
  return Array.isArray(entry.interruptSequences) && entry.interruptSequences.length
    ? entry.interruptSequences
    : INTERRUPT_SEQUENCES;
}

function renderWipePhaseFilter(pulls) {
  const select = document.querySelector("#wipe-phase-filter");
  const phases = unique(PHASE_ORDER.concat(pulls.map((pull) => pull.wipePhase))).filter((phase) => phase && phase !== "Unknown");
  const valid = new Set(["all", ...phases]);
  if (!valid.has(selectedWipePhase)) {
    selectedWipePhase = "all";
    localStorage.setItem("luraDeathReview:selectedWipePhase", selectedWipePhase);
  }

  select.innerHTML = [
    `<option value="all"${selectedWipePhase === "all" ? " selected" : ""}>All phases</option>`,
    ...phases.map((phase) => `<option value="${escapeHtml(phase)}"${phase === selectedWipePhase ? " selected" : ""}>${escapeHtml(phase)}</option>`)
  ].join("");
}

function renderWipeReasonFilter(rows) {
  const select = document.querySelector("#wipe-reason-filter");
  const reasons = [...groupBy(rows, (row) => reasonBucket(row.reason).key).entries()]
    .map(([key, reasonRows]) => ({ key, label: reasonBucket(reasonRows[0].reason).label, count: reasonRows.length }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const valid = new Set(["all", ...reasons.map((reason) => reason.key)]);
  if (!valid.has(selectedWipeReason)) {
    selectedWipeReason = "all";
    localStorage.setItem("luraDeathReview:selectedWipeReason", selectedWipeReason);
  }

  select.innerHTML = [
    `<option value="all"${selectedWipeReason === "all" ? " selected" : ""}>All reasons</option>`,
    ...reasons.map((reason) => `<option value="${escapeHtml(reason.key)}"${reason.key === selectedWipeReason ? " selected" : ""}>${escapeHtml(reason.label)} (${reason.count})</option>`)
  ].join("");
}

function renderReasonLabel(reason, classByPlayer) {
  if (reason.type === "missed-interrupt") return `<span class="reason-label missed-interrupt">Missed Interrupt${reason.player ? ` -> <span style="color:${classColor(classByPlayer.get(reason.player))}">${escapeHtml(reason.player)}</span>` : ""}</span>`;
  if (reason.type === "rune-order") return `<span class="reason-label rune-order">Rune Order</span>`;
  if (reason.type === "crystal-adds") return `<span class="reason-label crystal-adds">Crystal Adds</span>`;
  if (reason.type === "glaives") return `<span class="reason-label glaives">Glaives :(</span>`;
  if (reason.type === "child-left-behind") return `<span class="reason-label child-left-behind">Child was left behind 💔</span>`;
  if (reason.type === "p3-pickup") return `<span class="reason-label p3-pickup">Start of P3 pickup</span>`;
  if (reason.type === "p3-rune-order") return `<span class="reason-label p3-rune-order">P3 Rune order</span>`;
  if (reason.type === "dark-constellation-massacre") return `<span class="reason-label dark-constellation-massacre" style="color:${reasonColor("dark-constellation-massacre")}">Dark Constellation massacre</span>`;
  if (reason.type === "missed-big-soaks") return `<span class="reason-label missed-big-soaks" style="color:${reasonColor("missed-big-soaks")}">Missed big soaks</span>`;
  if (reason.type === "circle-overlap-crystal-pop") return `<span class="reason-label circle-overlap-crystal-pop">Circle overlap resulted in crystal pop</span>`;
  if (reason.type === "crystal-pop-unknown") return `<span class="reason-label crystal-pop">Crystal Pop -> Unknown</span>`;
  if (reason.type !== "crystal-pop") return `<span class="reason-label unknown">Unknown</span>`;
  return `<span class="reason-label crystal-pop">Crystal Pop -> <span style="color:${classColor(classByPlayer.get(reason.player))}">${escapeHtml(reason.player)}</span></span>`;
}

function renderPlayerSelect(deaths) {
  const select = document.querySelector("#player-select");
  const players = unique(deaths.map((death) => death.player)).sort((a, b) => a.localeCompare(b));
  if (!players.length) {
    select.innerHTML = `<option value="">No data</option>`;
    selectedPlayer = "";
    return;
  }

  const classByPlayer = playerClassMap(deaths);
  if (!selectedPlayer || !players.includes(selectedPlayer)) {
    selectedPlayer = players[0];
    localStorage.setItem("luraDeathReview:selectedPlayer", selectedPlayer);
  }

  select.innerHTML = players
    .map((player) => {
      const className = classByPlayer.get(player);
      const label = className ? `${player} (${className})` : player;
      return `<option value="${escapeHtml(player)}"${player === selectedPlayer ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  select.style.setProperty("--selected-class-color", classColor(classByPlayer.get(selectedPlayer)));
}

function renderPlayerSpellChart(deaths, pulls) {
  document.querySelector("#selected-spell-chart-title").textContent = "Heaven's Glaives Trend";

  const selectedDeaths = earlySelectedSpellDeaths(deaths);
  const playerDeaths = selectedDeaths.filter((death) => death.player === selectedPlayer);
  const affectedPulls = new Set(playerDeaths.map((death) => death.importId)).size;
  const pullShare = pulls.length ? Math.round((affectedPulls / pulls.length) * 100) : 0;
  document.querySelector("#stat-selected-rate").textContent = `${affectedPulls} Pulls (${pullShare}%)`;
  renderGlaivesDamageTotal(visibleImports());

  const canvas = document.querySelector("#player-spell-chart");
  const { ctx, width, height } = setupCanvas(canvas);
  drawBase(ctx, width, height);
  if (!pulls.length || !selectedPlayer) return;

  const allPlayerSeries = buildSpellSeries(selectedDeaths, pulls);
  const selectedSeries = allPlayerSeries.get(selectedPlayer) || pulls.map((pull) => ({ pull, count: 0, cumulative: 0 }));
  const maxCumulative = Math.max(1, ...[...allPlayerSeries.values()].flatMap((series) => series.map((point) => point.cumulative)));
  const step = (width - 78) / Math.max(pulls.length - 1, 1);
  const chartBottom = height - 34;
  const chartTop = 26;
  const chartHeight = chartBottom - chartTop;

  ctx.fillStyle = "rgba(121, 168, 255, 0.28)";
  selectedSeries.forEach((point, index) => {
    if (!point.count) return;
    const x = 42 + step * index - 5;
    const barHeight = Math.max(8, (point.count / maxCumulative) * chartHeight);
    ctx.fillRect(x, chartBottom - barHeight, 10, barHeight);
  });

  ctx.strokeStyle = "#42c2a3";
  ctx.lineWidth = 2;
  ctx.beginPath();
  selectedSeries.forEach((point, index) => {
    const x = 42 + step * index;
    const y = chartBottom - (point.cumulative / maxCumulative) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  selectedSeries.forEach((point, index) => {
    const x = 42 + step * index;
    const y = chartBottom - (point.cumulative / maxCumulative) * chartHeight;
    ctx.fillStyle = point.count ? "#ef6f6c" : "#42c2a3";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#a8b4bd";
  ctx.fillText(String(maxCumulative), 18, chartTop + 4);
  ctx.fillText("0", 28, chartBottom);
  ctx.fillText("Pull 1", 42, height - 10);
  if (pulls.length > 1) ctx.fillText(`Pull ${pulls.length}`, width - 72, height - 10);
}

function renderGlaivesDamageTotal(imports) {
  const total = imports.flatMap((entry) => entry.heavenGlaivesDamageTaken || [])
    .filter((row) => normalizeActorName(row.player) === selectedPlayer)
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  document.querySelector("#glaives-damage-total").textContent = `Total ${HEAVENS_GLAIVES_LABEL} Damage for ${selectedPlayer || "Player"}: ${formatCompactNumber(total)}`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value || 0);
}

function buildSpellSeries(selectedDeaths, pulls) {
  const players = unique(selectedDeaths.map((death) => death.player));
  const byPlayer = new Map();
  for (const player of players) {
    let cumulative = 0;
    byPlayer.set(player, pulls.map((pull) => {
      const count = selectedDeaths.filter((death) => death.player === player && death.importId === pull.importId).length;
      cumulative += count;
      return { pull, count, cumulative };
    }));
  }
  return byPlayer;
}

function playerClassMap(deaths, imports = []) {
  const map = new Map();
  for (const death of deaths) {
    if (!death.player || !death.classSpec) continue;
    map.set(death.player, death.classSpec.split("-")[0]);
  }
  for (const entry of imports) {
    for (const event of entry.interrupts || []) {
      const player = eventSourceName(event);
      const className = event.source?.className;
      if (!player || !className || className === "Pet" || className === "Boss") continue;
      if (!map.has(player)) map.set(player, className);
    }
  }
  return map;
}

function classColor(className) {
  const colors = {
    DeathKnight: "#C41E3A",
    DemonHunter: "#A330C9",
    Druid: "#FF7C0A",
    Evoker: "#33937F",
    Hunter: "#AAD372",
    Mage: "#3FC7EB",
    Monk: "#00FF98",
    Paladin: "#F48CBA",
    Priest: "#FFFFFF",
    Rogue: "#FFF468",
    Shaman: "#0070DD",
    Warlock: "#8788EE",
    Warrior: "#C69B6D"
  };
  return colors[className] || "#edf2f5";
}

function aggregate(rows, keyFn) {
  return [...groupBy(rows, keyFn).values()]
    .map((groupRows) => ({ count: groupRows.length, rows: groupRows }))
    .sort((a, b) => b.count - a.count);
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, rect.width * ratio);
  canvas.height = Math.max(1, Number(canvas.getAttribute("height")) * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  return { ctx, width: rect.width, height: Number(canvas.getAttribute("height")) };
}

function drawBase(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#303941";
  ctx.fillStyle = "#a8b4bd";
  ctx.font = "12px system-ui";
  for (let i = 0; i <= 4; i += 1) {
    const y = 24 + ((height - 52) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(42, y);
    ctx.lineTo(width - 18, y);
    ctx.stroke();
  }
}

function renderPhaseChart(pulls) {
  const canvas = document.querySelector("#phase-chart");
  const { ctx, width, height } = setupCanvas(canvas);
  drawBase(ctx, width, height);
  if (!pulls.length) return;
  const counts = new Map();
  for (const pull of pulls) counts.set(pull.wipePhase, (counts.get(pull.wipePhase) || 0) + 1);
  const phases = unique(PHASE_ORDER.concat([...counts.keys()])).filter((phase) => counts.has(phase) || PHASE_ORDER.includes(phase));
  const colors = ["#42c2a3", "#e6b450", "#79a8ff", "#ef6f6c", "#a78bfa"];
  const barWidth = Math.min(64, (width - 70) / Math.max(phases.length, 1) - 12);
  phases.forEach((phase, index) => {
    const value = counts.get(phase) || 0;
    const pct = value / pulls.length;
    const x = 48 + index * ((width - 76) / Math.max(phases.length, 1));
    const h = pct * (height - 62);
    ctx.fillStyle = colors[index % colors.length];
    ctx.fillRect(x, height - 30 - h, barWidth, h);
    ctx.fillStyle = "#edf2f5";
    ctx.fillText(`${Math.round(pct * 100)}%`, x, height - 38 - h);
    ctx.fillStyle = "#a8b4bd";
    ctx.fillText(phase, x, height - 12);
  });
}

function renderReportPhaseDelta(pulls, imports) {
  const container = document.querySelector("#report-phase-delta");
  const importsById = new Map(imports.map((entry) => [entry.importId, entry]));
  const rows = [...groupBy(pulls, (pull) => {
    const entry = importsById.get(pull.importId);
    return entry ? reportKey(entry) : pull.reportCode;
  }).entries()].map(([key, reportPulls]) => {
    const entry = importsById.get(reportPulls[0]?.importId);
    const total = reportPulls.length || 1;
    const phases = Object.fromEntries(PHASE_ORDER.map((phase) => {
      const count = reportPulls.filter((pull) => pull.wipePhase === phase).length;
      return [phase, Math.round((count / total) * 100)];
    }));
    return {
      key,
      label: reportDisplayName(entry || { reportCode: key }),
      firstSeen: entry ? importSortValue(entry) : 0,
      phases,
      total
    };
  }).sort((a, b) => a.firstSeen - b.firstSeen || a.key.localeCompare(b.key));

  if (rows.length < 2) {
    container.innerHTML = `<div class="phase-delta-empty">Select all reports to compare phase movement between raid nights.</div>`;
    return;
  }

  container.innerHTML = rows.map((row, index) => {
    const previous = rows[index - 1];
    return `
      <div class="phase-delta-row">
        <div class="phase-delta-report">
          <strong>${escapeHtml(row.label)}</strong>
          <span>${row.total} pulls</span>
        </div>
        <div class="phase-delta-phases">
          ${PHASE_ORDER.map((phase) => {
            const value = row.phases[phase] || 0;
            const delta = previous ? value - (previous.phases[phase] || 0) : 0;
            const deltaText = previous && delta ? `${delta > 0 ? "+" : ""}${delta}%` : "";
            return `
              <div class="phase-chip">
                <span class="phase-dot" style="background:${phaseColor(phase)}"></span>
                <strong>${phase}</strong>
                <span>${value}%</span>
                ${deltaText ? `<em class="${delta > 0 ? "up" : "down"}">${deltaText}</em>` : `<em>-</em>`}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function phaseColor(phase) {
  const colors = {
    P1: "#42c2a3",
    I1: "#e6b450",
    P2: "#79a8ff",
    P3: "#ef6f6c"
  };
  return colors[phase] || "#a78bfa";
}

function importPayload(raw) {
  const payload = JSON.parse(raw);
  const reportName = document.querySelector("#report-name").value.trim();
  const interruptSequences = parseInterruptOrder(document.querySelector("#interrupt-order").value);
  const entries = (Array.isArray(payload) ? payload : [payload]).filter((entry) => !entry.bossName || entry.bossName === TARGET_BOSS_NAME);
  if (!entries.length) throw new Error(`No ${TARGET_BOSS_NAME} pulls found in this import.`);

  for (const entry of entries) {
    if (!Array.isArray(entry.deaths)) throw new Error("Import does not contain a deaths array.");
    const importId = `${entry.reportCode || "manual"}:${entry.fightId || Date.now()}:${entry.extractedAt || Date.now()}`;
    const existingIndex = state.imports.findIndex((saved) => saved.importId === importId);
    const existing = existingIndex >= 0 ? state.imports[existingIndex] : null;
    const normalized = {
      ...entry,
      reportName: reportName || entry.reportName || existing?.reportName || "",
      interruptSequences: interruptSequences || entry.interruptSequences || existing?.interruptSequences || null,
      importId,
      deaths: entry.deaths.map((death) => ({
        ...death,
        time: Number.isFinite(death.time) ? death.time : null
      }))
    };
    if (existingIndex >= 0) state.imports[existingIndex] = normalized;
    else state.imports.push(normalized);
  }
  saveState();
}

function parseInterruptOrder(value) {
  const rows = String(value || "")
    .split(/\n+/)
    .map((line) => line
      .split(/\s*(?:->|,|;)\s*/)
      .map((player) => player.trim())
      .filter(Boolean))
    .filter((sequence) => sequence.length);
  return rows.length ? rows : null;
}

const copyExtractorButton = document.querySelector("#copy-extractor");
if (copyExtractorButton) {
  copyExtractorButton.addEventListener("click", async () => {
    try {
      const response = await fetch("./wcl-extractor.js", { cache: "no-store" });
      const script = await response.text();
      await navigator.clipboard.writeText(script);
      document.querySelector("#import-status").textContent = "Pull script copied.";
    } catch {
      document.querySelector("#import-status").textContent = "Script copy failed. Open the app via http://127.0.0.1:4174 instead of file://.";
    }
  });
}

const copyAllExtractorButton = document.querySelector("#copy-all-extractor");
if (copyAllExtractorButton) {
  copyAllExtractorButton.addEventListener("click", async () => {
    try {
      const response = await fetch("./wcl-extractor-all.js", { cache: "no-store" });
      const script = await response.text();
      await navigator.clipboard.writeText(script);
      document.querySelector("#import-status").textContent = "All wipes script copied.";
    } catch {
      document.querySelector("#import-status").textContent = "Script copy failed. Open the app via http://127.0.0.1:4174 instead of file://.";
    }
  });
}

const copyPagesDataButton = document.querySelector("#copy-pages-data");
if (copyPagesDataButton) {
  copyPagesDataButton.addEventListener("click", async () => {
    const status = document.querySelector("#import-status");
    const dataScript = `window.LURA_EMBEDDED_STATE = ${JSON.stringify(state, null, 2)};\n`;
    try {
      await navigator.clipboard.writeText(dataScript);
      status.textContent = "Pages data copied.";
    } catch {
      status.textContent = "Pages data copy failed.";
    }
  });
}

const importDataButton = document.querySelector("#import-data");
if (importDataButton) {
  importDataButton.addEventListener("click", () => {
    const status = document.querySelector("#import-status");
    try {
      importPayload(document.querySelector("#import-json").value);
      document.querySelector("#import-json").value = "";
      status.textContent = "Import successful.";
      render();
    } catch (error) {
      status.textContent = `Import failed: ${error.message}`;
    }
  });
}

const clearDataButton = document.querySelector("#clear-data");
if (clearDataButton) {
  clearDataButton.addEventListener("click", () => {
    state.imports = [];
    saveState();
    render();
    document.querySelector("#import-status").textContent = "Data cleared.";
  });
}

document.querySelector("#player-select").addEventListener("change", (event) => {
  selectedPlayer = event.target.value;
  localStorage.setItem("luraDeathReview:selectedPlayer", selectedPlayer);
  render();
});

document.querySelector("#report-select").addEventListener("change", (event) => {
  selectedReport = event.target.value;
  localStorage.setItem("luraDeathReview:selectedReport", selectedReport);
  render();
});

document.querySelector("#wipe-phase-filter").addEventListener("change", (event) => {
  selectedWipePhase = event.target.value;
  localStorage.setItem("luraDeathReview:selectedWipePhase", selectedWipePhase);
  render();
});

document.querySelector("#wipe-reason-filter").addEventListener("change", (event) => {
  selectedWipeReason = event.target.value;
  localStorage.setItem("luraDeathReview:selectedWipeReason", selectedWipeReason);
  render();
});

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.viewTarget;
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.id !== target;
    });
    document.querySelectorAll("[data-view-target]").forEach((navButton) => {
      navButton.classList.toggle("active", navButton === button);
      navButton.classList.toggle("secondary", navButton !== button);
    });
    render();
  });
});

window.addEventListener("resize", render);
render();
