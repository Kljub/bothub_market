'use strict';

// Minesweeper-Glücksspiel-Logik (kein Discord/DB-Zugriff) — 24 Spielfelder statt
// eines vollen 5x5=25-Feldes: Discords Hard-Limit ist 5 Action-Rows x 5 Buttons,
// und die letzte Reihe braucht einen Slot für den 🔥-Cashout-Button (4 Zellen +
// 1 Cashout-Button in Reihe 5). Der Multiplikator ist die mathematisch FAIRE
// Quote (EV=1.0 bei jedem Reveal-Schritt, hergeleitet aus der Wahrscheinlichkeit,
// k sichere Felder in Folge zu treffen) — mehr Minen ergeben automatisch einen
// höheren Multiplikator, ganz ohne Owner-Zutun. Die RTP-Einstellung skaliert
// diesen fairen Wert nachträglich (= House-Edge), exakt wie bei den Casino-Spielen.

const GRID_SIZE = 24;

function clampMines(mines) {
    return Math.max(1, Math.min(GRID_SIZE - 1, Math.floor(mines)));
}

/** Faire (EV=1.0) Multiplikator-Kurve für eine gegebene Minen-Anzahl, ein Eintrag pro sicherem Reveal (Index 0 = nach dem 1. sicheren Klick). */
function fairMultiplierCurve(mineCount) {
    const m = clampMines(mineCount);
    const safeCells = GRID_SIZE - m;
    const curve = [];
    let mult = 1;
    for (let k = 0; k < safeCells; k++) {
        mult *= (GRID_SIZE - k) / (GRID_SIZE - m - k);
        curve.push(mult);
    }
    return curve;
}

/** Skalierter (tatsächlicher) Multiplikator nach k sicheren Reveals, inkl. RTP-House-Edge. */
function multiplierAt(mineCount, safeRevealed, rtp) {
    if (safeRevealed <= 0) return 1;
    const curve = fairMultiplierCurve(mineCount);
    const fair = curve[Math.min(safeRevealed, curve.length) - 1] ?? curve[curve.length - 1];
    return fair * (rtp / 100);
}

function generateGrid(mineCount, rng = Math.random) {
    const m = clampMines(mineCount);
    const cells = Array.from({ length: GRID_SIZE }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const mines = new Set(cells.slice(0, m));
    return { mines, mineCount: m, safeCells: GRID_SIZE - m };
}

module.exports = { GRID_SIZE, clampMines, fairMultiplierCurve, multiplierAt, generateGrid };
