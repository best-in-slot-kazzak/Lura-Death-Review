(async function () {
  const WAIT_AFTER_LOAD_MS = 5000;
  const TERMINATE_SPELL_ID = 1284934;
  const TERMINATE_SPELL_NAME = "Terminate";
  const HEAVENS_GLAIVES_SPELL_ID = 1254076;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const parseNumber = (value) => {
    const cleaned = String(value || "").replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  };

  const parseCompactNumber = (value) => {
    const text = String(value || "").trim().toLowerCase();
    const match = text.match(/([\d.,]+)\s*([kmb])?/);
    if (!match) return null;
    const numericText = match[1].includes(".") && match[1].includes(",")
      ? match[1].replace(/,/g, "")
      : match[1].replace(",", ".");
    const number = Number(numericText);
    if (!Number.isFinite(number)) return null;
    const multipliers = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
    return Math.round(number * (multipliers[match[2]] || 1));
  };

  const parseTime = (value) => {
    const text = String(value || "").trim();
    const match = text.match(/(\d+):(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || 0}`);
  };

  const spellIdFromHref = (href) => {
    const match = String(href || "").match(/spell=(\d+)/);
    return match ? Number(match[1]) : null;
  };

  const normalizeActorName = (value) => {
    const text = String(value || "").trim();
    const ownerMatch = text.match(/\(([^)]+)\)/);
    return ownerMatch ? ownerMatch[1].trim() : text;
  };

  const extractInterrupts = (doc) => {
    const table = doc.querySelector("table.events-table, table.events-grid-view");
    if (!table) return [];

    return [...table.querySelectorAll("tbody tr")].map((row, index) => {
      const cells = [...row.children];
      const abilityLinks = [...(cells[2]?.querySelectorAll("a[href*='spell=']") || [])];
      const sourceTargetActors = [...(cells[3]?.querySelectorAll(".death-heal-actor") || [])];
      const sourceLink = sourceTargetActors[0]?.querySelector("a");
      const targetLink = sourceTargetActors[1]?.querySelector("a");

      return {
        row: index + 1,
        timeText: cells[0] ? cells[0].textContent.trim() : "",
        time: parseTime(cells[0]?.textContent),
        type: cells[1] ? cells[1].textContent.trim() : "",
        ability: {
          spellId: spellIdFromHref(abilityLinks[0]?.href),
          spellName: abilityLinks[0]?.textContent.trim() || ""
        },
        interruptedAbility: {
          spellId: spellIdFromHref(abilityLinks[1]?.href),
          spellName: abilityLinks[1]?.textContent.trim() || ""
        },
        source: {
          rawName: sourceLink?.textContent.trim() || "",
          name: normalizeActorName(sourceLink?.textContent),
          className: [...(sourceLink?.classList || [])][0] || ""
        },
        target: {
          name: targetLink?.textContent.trim() || "",
          className: [...(targetLink?.classList || [])][0] || ""
        }
      };
    }).filter((event) => event.type === "Interrupt");
  };

  const extractDamageTaken = (doc) => {
    const table = doc.querySelector("table.summary-table, table.dataTable");
    if (!table) return [];

    return [...table.querySelectorAll("tbody tr")].map((row, index) => {
      const cells = [...row.children];
      const nameCell = cells.find((cell) => cell.querySelector(".main-table-link")) || cells[0];
      const nameLink = nameCell?.querySelector(".main-table-link");
      const icon = nameCell?.querySelector("img[class*='actor-sprite-']");
      const classSpec = icon ? (icon.className.match(/actor-sprite-([^\s]+)/) || [])[1] : "";
      const amountCell = cells.find((cell) => cell !== nameCell && parseCompactNumber(cell.textContent) !== null);
      const amountText = amountCell ? amountCell.textContent.trim() : "";

      return {
        row: index + 1,
        player: nameLink ? nameLink.textContent.trim() : "",
        classSpec,
        amountText,
        amount: parseCompactNumber(amountText)
      };
    }).filter((entry) => entry.player && Number.isFinite(entry.amount));
  };

  const loadHeavenGlaivesDamageTaken = async () => {
    const popup = window.open("about:blank", "luraDeathReviewGlaivesDamage", "popup=yes,width=1180,height=900,left=160,top=160");
    if (!popup) {
      console.warn("Heaven's Glaives damage import skipped because the popup was blocked.");
      return [];
    }

    const damageUrl = new URL(window.location.href);
    damageUrl.searchParams.set("type", "damage-taken");
    damageUrl.searchParams.set("ability", String(HEAVENS_GLAIVES_SPELL_ID));
    popup.location.href = damageUrl.href;

    const startedAt = Date.now();
    while (Date.now() - startedAt < 45000) {
      if (popup.closed) return [];
      try {
        const loaded = popup.document.readyState === "complete" || popup.document.readyState === "interactive";
        const sameFight = popup.location.href.includes(`fight=${fightId}`);
        if (loaded && sameFight) {
          await delay(WAIT_AFTER_LOAD_MS);
          const damageTaken = extractDamageTaken(popup.document);
          popup.close();
          return damageTaken;
        }
      } catch {}
      await delay(250);
    }

    popup.close();
    return [];
  };

  const loadInterrupts = async () => {
    const popup = window.open("about:blank", "luraDeathReviewInterrupts", "popup=yes,width=1180,height=900,left=120,top=120");
    if (!popup) {
      console.warn("Interrupt import skipped because the popup was blocked.");
      return [];
    }

    const interruptUrl = new URL(window.location.href);
    interruptUrl.searchParams.set("type", "interrupts");
    interruptUrl.searchParams.set("view", "events");
    popup.location.href = interruptUrl.href;

    const startedAt = Date.now();
    while (Date.now() - startedAt < 45000) {
      if (popup.closed) return [];
      try {
        const loaded = popup.document.readyState === "complete" || popup.document.readyState === "interactive";
        const sameFight = popup.location.href.includes(`fight=${fightId}`);
        if (loaded && sameFight) {
          await delay(WAIT_AFTER_LOAD_MS);
          const interrupts = extractInterrupts(popup.document);
          popup.close();
          return interrupts;
        }
      } catch {}
      await delay(250);
    }

    popup.close();
    return [];
  };

  const url = new URL(window.location.href);
  const reportCode = (url.pathname.match(/\/reports\/([^/]+)/) || [])[1] || "";
  const fightId = Number(url.searchParams.get("fight")) || null;
  const table = document.querySelector("table[id^='deaths-table'], table.deaths-table");
  const nodeFightId = (node) => {
    const href = node?.getAttribute?.("href") || node?.closest?.("a[href*='fight=']")?.getAttribute("href") || "";
    try {
      return Number(new URL(href, window.location.href).searchParams.get("fight")) || null;
    } catch {
      return null;
    }
  };
  const fightCandidates = [...new Set([
    ...document.querySelectorAll(".fight, .wipe, a[href*='fight=']"),
    ...[...document.querySelectorAll(".fight-phase")].map((node) => node.closest(".fight, .wipe, a[href*='fight=']") || node.parentElement)
  ].filter(Boolean))].filter((node) => node.querySelector && node.querySelector(".fight-phase"));
  const bossName = document.querySelector("#filter-fight-boss-text")?.childNodes[0]?.textContent.trim() || "";
  const fightNode =
    fightCandidates.find((node) => nodeFightId(node) === fightId) ||
    fightCandidates.find((node) => node.classList.contains("selected") || node.classList.contains("active")) ||
    fightCandidates[0] ||
    document.querySelector(".fight-phase")?.parentElement;

  const fightMeta = fightNode
    ? {
        label: (fightNode.childNodes[0]?.textContent || "").trim(),
        durationText: fightNode.querySelector(".fight-duration")?.textContent.replace(/[()]/g, "").trim() || "",
        percentText: fightNode.querySelector(".fight-percent")?.textContent.replace("-", "").trim() || "",
        phase: fightNode.querySelector(".fight-phase")?.textContent.trim() || "",
        clockTime: fightNode.querySelector(".fight-time")?.textContent.trim() || ""
      }
    : {};

  if (!table) {
    throw new Error("Keine WarcraftLogs Deaths-Tabelle gefunden. Öffne den Deaths-Tab des gewünschten Pulls.");
  }

  const rows = [...table.querySelectorAll("tbody tr")];
  const deaths = rows.map((row, index) => {
    const cells = [...row.children];
    const nameCell = cells[1];
    const killingCell = cells[2];
    const lastHitsCell = cells[4];
    const nameSpan = nameCell && nameCell.querySelector(".main-table-link");
    const icon = nameCell && nameCell.querySelector("img[class*='actor-sprite-']");
    const classSpec = icon ? (icon.className.match(/actor-sprite-([^\s]+)/) || [])[1] : "";
    const killingSpellLink = killingCell && killingCell.querySelector("a[href*='spell=']");
    const killingSpellSpan = killingCell && killingCell.querySelector("span[class^='school-']");
    const lastHits = lastHitsCell
      ? [...lastHitsCell.querySelectorAll("span[class^='school-']")].map((span) => {
          const wrapper = span.closest("span[style]");
          const link = wrapper ? wrapper.querySelector("a[href*='spell=']") : null;
          const countMatch = span.textContent.match(/\(x\s*(\d+)\)/);
          return {
            spellId: spellIdFromHref(link && link.href),
            spellName: span.childNodes[0] ? span.childNodes[0].textContent.trim() : span.textContent.trim(),
            count: countMatch ? Number(countMatch[1]) : 1
          };
        })
      : [];

    return {
      row: index + 1,
      timeText: cells[0] ? cells[0].textContent.trim() : "",
      time: parseTime(cells[0] && cells[0].textContent),
      player: nameSpan ? nameSpan.textContent.trim() : "",
      classSpec,
      killingBlow: {
        spellId: spellIdFromHref(killingSpellLink && killingSpellLink.href),
        spellName: killingSpellSpan ? killingSpellSpan.childNodes[0].textContent.trim() : (killingCell ? killingCell.textContent.trim() : "")
      },
      over: cells[3] ? cells[3].textContent.trim() : "",
      lastHits,
      damageTaken: parseNumber(cells[5] && cells[5].textContent),
      healingReceived: parseNumber(cells[6] && cells[6].textContent)
    };
  });
  const hasTerminateDeath = deaths.some((death) => death.killingBlow.spellName === TERMINATE_SPELL_NAME || death.killingBlow.spellId === TERMINATE_SPELL_ID);
  const interrupts = hasTerminateDeath ? await loadInterrupts() : [];
  const heavenGlaivesDamageTaken = await loadHeavenGlaivesDamageTaken();

  const payload = {
    source: "warcraftlogs-deaths-table",
    extractedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    reportCode,
    fightId,
    bossName,
    pullLabel: fightMeta.label || (fightId ? `Fight ${fightId}` : ""),
    fightMeta,
    deaths,
    interrupts,
    heavenGlaivesDamageTaken
  };

  const json = JSON.stringify(payload, null, 2);
  const copyJson = window.copy
    ? Promise.resolve(window.copy(json))
    : navigator.clipboard
      ? navigator.clipboard.writeText(json)
      : Promise.reject(new Error("Clipboard nicht verfügbar"));

  copyJson.then(
    () => console.log("Lura Death Review JSON wurde in die Zwischenablage kopiert:", payload),
    () => console.log("Kopieren nicht erlaubt. JSON manuell kopieren:", json)
  );
})();
