(async function () {
  const WAIT_AFTER_LOAD_MS = 5000;
  const STEP_DELAY_MS = 300;
  const TARGET_BOSS_NAME = "Midnight Falls Mythic";
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

  const reportCodeFromUrl = (pageUrl) => {
    const url = new URL(pageUrl);
    return (url.pathname.match(/\/reports\/([^/]+)/) || [])[1] || "";
  };

  const fightIdFromUrl = (pageUrl) => {
    const url = new URL(pageUrl);
    return Number(url.searchParams.get("fight")) || null;
  };

  const collectFightIds = () => {
    const ids = new Set();
    for (const link of document.querySelectorAll("a[href*='fight=']")) {
      try {
        const url = new URL(link.href, window.location.href);
        const fightId = Number(url.searchParams.get("fight"));
        if (fightId) ids.add(fightId);
      } catch {}
    }
    for (const match of document.body.innerHTML.matchAll(/[?&]fight=(\d+)/g)) ids.add(Number(match[1]));
    for (const match of document.body.innerHTML.matchAll(/fight['"]?\s*[:=]\s*['"]?(\d+)/gi)) ids.add(Number(match[1]));
    const currentFight = fightIdFromUrl(window.location.href);
    if (currentFight) ids.add(currentFight);
    return [...ids].filter(Boolean).sort((a, b) => a - b);
  };

  const waitForDeathsTable = async (docProvider, timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const doc = docProvider();
      const table = doc.querySelector("table[id^='deaths-table'], table.deaths-table");
      const rows = table ? table.querySelectorAll("tbody tr").length : 0;
      if (table && rows) return table;
      await delay(250);
    }
    return docProvider().querySelector("table[id^='deaths-table'], table.deaths-table");
  };

  const waitForEventsTable = async (docProvider, timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const doc = docProvider();
      const table = doc.querySelector("table.events-table, table.events-grid-view");
      const rows = table ? table.querySelectorAll("tbody tr").length : 0;
      if (table && rows) return table;
      await delay(250);
    }
    return docProvider().querySelector("table.events-table, table.events-grid-view");
  };

  const waitForSummaryTable = async (docProvider, timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const doc = docProvider();
      const table = doc.querySelector("table.summary-table, table.dataTable");
      const rows = table ? table.querySelectorAll("tbody tr").length : 0;
      if (table && rows) return table;
      await delay(250);
    }
    return docProvider().querySelector("table.summary-table, table.dataTable");
  };

  const findFightNode = (doc, fightId, options = {}) => {
    const nodeFightId = (node) => {
      const href = node?.getAttribute?.("href") || node?.closest?.("a[href*='fight=']")?.getAttribute("href") || "";
      try {
        return Number(new URL(href, window.location.href).searchParams.get("fight")) || null;
      } catch {
        return null;
      }
    };
    const candidates = uniqueNodes([
      ...doc.querySelectorAll(".fight, .wipe, a[href*='fight=']"),
      ...[...doc.querySelectorAll(".fight-phase")].map((node) => node.closest(".fight, .wipe, a[href*='fight=']") || node.parentElement)
    ]).filter((node) => node?.querySelector?.(".fight-phase"));
    const exactFightNode = candidates.find((node) => nodeFightId(node) === fightId);
    if (exactFightNode || options.exactOnly) return exactFightNode || null;

    return (
      candidates.find((node) => node.classList.contains("selected") || node.classList.contains("active")) ||
      candidates[0] ||
      doc.querySelector(".fight-phase")?.parentElement
    );
  };

  function uniqueNodes(nodes) {
    return [...new Set(nodes.filter(Boolean))];
  }

  const extractFightMeta = (doc, fightId) => {
    const fightNode = findFightNode(doc, fightId);
    return fightNode
      ? {
          label: (fightNode.childNodes[0]?.textContent || "").trim(),
          durationText: fightNode.querySelector(".fight-duration")?.textContent.replace(/[()]/g, "").trim() || "",
          percentText: fightNode.querySelector(".fight-percent")?.textContent.replace("-", "").trim() || "",
          phase: fightNode.querySelector(".fight-phase")?.textContent.trim() || "",
          clockTime: fightNode.querySelector(".fight-time")?.textContent.trim() || ""
        }
      : {};
  };

  const extractBossName = (doc) => doc.querySelector("#filter-fight-boss-text")?.childNodes[0]?.textContent.trim() || "";

  const extractDeaths = (table) => {
    if (!table) return [];

    return [...table.querySelectorAll("tbody tr")].map((row, index) => {
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
  };

  const extractInterrupts = (table) => {
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

  const extractDamageTaken = (table) => {
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

  const loadFightInPopup = (popup, pageUrl) =>
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      popup.location.href = pageUrl;

      const tick = async () => {
        if (popup.closed) {
          reject(new Error("Import-Fenster wurde geschlossen."));
          return;
        }

        if (Date.now() - startedAt > 45000) {
          reject(new Error(`Timeout beim Laden von ${pageUrl}`));
          return;
        }

        try {
          const doc = popup.document;
          const loaded = doc.readyState === "complete" || doc.readyState === "interactive";
          const samePage = popup.location.href.includes(`fight=${fightIdFromUrl(pageUrl)}`);
          if (loaded && samePage) {
            await delay(WAIT_AFTER_LOAD_MS);
            resolve(doc);
            return;
          }
        } catch (error) {
          reject(new Error(`Kein Zugriff auf Import-Fenster: ${error.message}`));
          return;
        }

        window.setTimeout(tick, 250);
      };

      tick();
    });

  const baseUrl = new URL(window.location.href);
  const fightIds = collectFightIds();
  if (!fightIds.length) {
    throw new Error("Keine Fight-IDs im Report gefunden. Öffne einen WarcraftLogs-Report mit sichtbarer Pull-/Wipe-Liste.");
  }

  const statusBox = document.createElement("div");
  statusBox.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:999999;background:#111;color:#fff;border:1px solid #555;border-radius:8px;padding:12px;font:13px system-ui;max-width:360px";
  statusBox.textContent = `Lura Death Review: starte ${fightIds.length} Fight(s)...`;
  document.body.appendChild(statusBox);

  const popup = window.open("about:blank", "luraDeathReviewImport", "popup=yes,width=1180,height=900,left=80,top=80");
  if (!popup) {
    statusBox.textContent = "Lura Death Review: Popup wurde blockiert.";
    throw new Error("Popup wurde blockiert. Erlaube Popups für WarcraftLogs und starte das Skript erneut.");
  }

  const results = [];
  const failures = [];

  try {
    for (let index = 0; index < fightIds.length; index += 1) {
      const fightId = fightIds[index];
      const fightUrl = new URL(baseUrl.href);
      fightUrl.searchParams.set("fight", String(fightId));
      fightUrl.searchParams.set("type", "deaths");
      statusBox.textContent = `Lura Death Review: lade Fight ${fightId} (${index + 1}/${fightIds.length}), warte ${WAIT_AFTER_LOAD_MS / 1000}s...`;

      try {
        const doc = await loadFightInPopup(popup, fightUrl.href);
        const table = await waitForDeathsTable(() => popup.document, 1500);
        const deaths = extractDeaths(table);
        const fightMeta = extractFightMeta(popup.document, fightId);
        const bossName = extractBossName(popup.document);

        const hasTerminateDeath = deaths.some((death) => death.killingBlow.spellName === "Terminate" || death.killingBlow.spellId === 1284934);
        let interrupts = [];
        let heavenGlaivesDamageTaken = [];

        if (hasTerminateDeath) {
          const interruptUrl = new URL(fightUrl.href);
          interruptUrl.searchParams.set("type", "interrupts");
          interruptUrl.searchParams.set("view", "events");
          statusBox.textContent = `Lura Death Review: loading interrupts for Fight ${fightId} (${index + 1}/${fightIds.length})...`;
          const interruptDoc = await loadFightInPopup(popup, interruptUrl.href);
          const interruptTable = await waitForEventsTable(() => popup.document, 1500);
          interrupts = extractInterrupts(interruptTable);
          console.log(`Fight ${fightId}: ${interrupts.length} interrupt events read.`);
        }

        const damageUrl = new URL(fightUrl.href);
        damageUrl.searchParams.set("type", "damage-taken");
        damageUrl.searchParams.set("ability", String(HEAVENS_GLAIVES_SPELL_ID));
        statusBox.textContent = `Lura Death Review: loading Heaven's Glaives damage for Fight ${fightId} (${index + 1}/${fightIds.length})...`;
        await loadFightInPopup(popup, damageUrl.href);
        const damageTable = await waitForSummaryTable(() => popup.document, 1500);
        heavenGlaivesDamageTaken = extractDamageTaken(damageTable);
        console.log(`Fight ${fightId}: ${heavenGlaivesDamageTaken.length} Heaven's Glaives damage rows read.`);

        if (bossName && bossName !== TARGET_BOSS_NAME) {
          console.log(`Fight ${fightId}: skipped boss ${bossName}.`);
        } else if (deaths.length) {
          results.push({
            source: "warcraftlogs-deaths-table",
            extractedAt: new Date().toISOString(),
            pageUrl: fightUrl.href,
            reportCode: reportCodeFromUrl(fightUrl.href),
            fightId,
            bossName,
            pullLabel: fightMeta.label || `Fight ${fightId}`,
            fightMeta,
            deaths,
            interrupts,
            heavenGlaivesDamageTaken
          });
          console.log(`Fight ${fightId}: ${deaths.length} Deaths gelesen.`);
        } else {
          failures.push(fightId);
          console.warn(`Fight ${fightId}: keine Deaths-Tabelle gefunden oder leer.`);
        }
      } catch (error) {
        failures.push(fightId);
        console.warn(`Fight ${fightId}: fehlgeschlagen.`, error);
      }

      await delay(STEP_DELAY_MS);
    }
  } finally {
    if (!popup.closed) popup.close();
  }

  if (!results.length) {
    statusBox.textContent = "Lura Death Review: keine Deaths ausgelesen.";
    throw new Error("Keine Deaths ausgelesen. WarcraftLogs blockiert eventuell das Import-Fenster oder die Tabelle braucht eine andere clientseitige Route.");
  }

  const json = JSON.stringify(results, null, 2);
  const copyJson = window.copy
    ? Promise.resolve(window.copy(json))
    : navigator.clipboard
      ? navigator.clipboard.writeText(json)
      : Promise.reject(new Error("Clipboard nicht verfügbar"));

  copyJson.then(
    () => {
      statusBox.textContent = `Lura Death Review: ${results.length} Pull(s) kopiert. Fehlgeschlagen: ${failures.length || 0}.`;
      console.log(`Lura Death Review JSON für ${results.length} Pull(s) wurde in die Zwischenablage kopiert.`, results);
      if (failures.length) console.warn("Fights ohne Death-Daten:", failures);
    },
    () => {
      statusBox.textContent = "Lura Death Review: Kopieren blockiert, JSON steht in der Console.";
      console.log("Kopieren nicht erlaubt. JSON manuell kopieren:", json);
    }
  );
})();
