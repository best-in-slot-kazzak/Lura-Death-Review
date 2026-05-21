# Lura Importer

Local browser app for manually importing WarcraftLogs death tables.

## Start The App

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173
```

## Import From WarcraftLogs

1. Open the desired WarcraftLogs report pull, e.g. `?fight=10&type=deaths`.
2. Open the browser console.
3. Copy the pull script from the app.
4. Run the script on the WarcraftLogs page.
5. Paste the copied JSON into the app and click `Import`.

You can optionally enter a report name before importing. The analysis report selector will use that name instead of only showing the WarcraftLogs report code. You can also enter a report-specific interrupt order, one sequence per line, using `->`, commas, or semicolons between player names. Leave it empty to use the default order.

If `Unexpected token '&'` appears, an HTML-escaped version was copied. Copy the contents of `wcl-extractor.js` directly.

For multiple pulls in one report, use `Copy all wipes script`. This script finds fight IDs in the open report, loads each `type=deaths` view in a small popup window, waits 5 seconds per fight for client-rendered tables, and copies a JSON array that can be pasted into the same import field. If the browser blocks the window, allow popups for WarcraftLogs.

The extractor records the boss name from `#filter-fight-boss-text`. New imports only keep `Midnight Falls Mythic` pulls when that boss name is present, so stray pulls from other bosses in the report are skipped.

## Classification

The app separates deaths using three mechanisms:

- known group spells by spell ID, e.g. `1251789` for `Cosmic Fracture`
- death clusters: multiple players dying to the same spell within a few seconds
- fallback: unknown single deaths are counted as personal deaths

Rules and phase fallbacks are currently kept in code so the import screen stays focused.

If WarcraftLogs renders `.fight-phase`, `.fight-percent`, and `.fight-duration` in the fight selector, the extractor imports these values directly. Time-based phases are only a fallback.

## Analysis

Import and analysis are separate views. In analysis, choose a player and ability; the chart shows cumulative qualifying deaths for that player over pull order. `Heaven's Glaives` is the default ability, and `Cosmic Fracture` is excluded from this personal ability selection.

For this analysis, deaths count when the player dies to the selected ability before the wipe tipping point or during the same fight second as a mass-death event. The early tipping point is currently death #5 per pull, and mass-death seconds require at least 5 deaths.

Wipe reasons are evaluated in priority order. `Missed Interrupt` is triggered by a `Terminate` death. New imports also collect `type=interrupts&view=events` data for those pulls so the app can identify the missed player from the report-specific interrupt sequences, or the default order when no custom order was entered. Older imported data needs to be re-imported for player attribution on this rule.

## GitHub Pages Analyzer

The `docs/` folder contains a read-only analyzer variant for GitHub Pages. It has no import screen and loads embedded data from `docs/data.js`.

To publish the current local data:

1. Open the local importer app.
2. Use `Copy Pages data` in the import view.
3. Replace the contents of `docs/data.js` with the copied script.
4. Commit and push.

On GitHub, enable Pages for the repository and select `Deploy from a branch`, branch `main`, folder `/docs`.
