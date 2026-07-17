# CasinoPlugin — Bauplan

> Status: 📝 Geplant, noch keine Implementierung. Dies ist ein Design-Dokument, kein Code.
> Ziel: Glücksspiel-Plugin, das ausschließlich über [[EcoPlugin]] (`economy-plugin`) Guthaben verwaltet — kein eigener Ledger, keine eigene Balance-Logik.

---

## 1. Grundentscheidungen (bereits geklärt)

| Frage | Entscheidung | Begründung |
|---|---|---|
| Balance-Zugriff | **Ausschließlich über Economy-Service** (`economy.balance.read`/`.write`) | Einzige Quelle der Wahrheit bleibt Economy — Casino darf nie direkt in `bot_economy_balances` schreiben |
| RTP / Gewinnchance | **Owner-konfigurierbar pro Spiel** (Dashboard-Setting) | Konsistent mit dem Economy-Muster: Server-Owner steuert die Wirtschaft seines Servers selbst, nichts hart codiert |
| Currency-Zugriff pro Spiel | **Owner wählt erlaubte Currencies pro Spiel** | Ermöglicht z. B. eine "ernste" Haupt-Currency vor Glücksspiel zu schützen und nur eine separate Casino-Währung freizugeben |
| Bet-Flow | **Zwei getrennte Ledger-Buchungen** (`removeBalance` Bet, dann `addBalance` Payout bei Gewinn) | Nachvollziehbare Transaktions-Historie ("Bet -100", "Payout +250") statt Netto-Delta; Abbruch vor Spielauflösung falls Bet-Abzug scheitert |
| Floor-Enforcement (`allow_negative`/`min_balance`) | **Bleibt vollständig in Economy** | Casino kennt die Regeln nicht, wertet nur `success`/`reason` der Economy-Response aus |

---

## 2. Dependency auf Economy

```json
"dependencies": {
  "economy-plugin": {
    "required": true,
    "capabilities": ["economy.balance.read", "economy.balance.write", "economy.currency.info"]
  }
}
```

- `economy.currency.info` (→ `listCurrencies(botId)`) wird im Casino-Dashboard gebraucht, um die Checkliste "erlaubte Currencies pro Spiel" zu befüllen.
- Kein `economy.balance.transfer` nötig — das ist User-zu-User (Pay-Command), Casino ist immer User-zu-"Haus".
- Wird Economy deaktiviert während Casino aktiv ist → Core blockt das automatisch (Reverse-Dependency-Check aus dem bestehenden DependencyResolver), kein Extra-Code in Casino nötig.

---

## 3. Datenbank-Schema

### `bot_casino_game_settings`
Pro Bot, pro Spiel eine Zeile.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | INT PK | |
| `bot_id` | INT | |
| `game_key` | VARCHAR(32) | z. B. `slots`, `coinflip`, `dice`, `blackjack`, `roulette` |
| `enabled` | BOOLEAN | Command-Toggle (Standard-Muster wie jedes andere Plugin) |
| `rtp` | DECIMAL(5,2) | Auszahlungsquote in %, z. B. `95.00` |
| `min_bet` | INT | |
| `max_bet` | INT | |
| `allowed_currencies` | JSON | Array von `currency_key`s aus Economy |
| `updated_at` | TIMESTAMP | |

UNIQUE (`bot_id`, `game_key`)

**Kein eigenes Balance-/Transaction-Schema** — läuft komplett über `bot_economy_balances` / `bot_economy_transactions` mit `source_plugin = 'casino-plugin'` und `reason` wie `'slots bet'` / `'slots payout'`.

---

## 4. Bet-Flow (Ablauf im Detail)

1. User führt z. B. `/slots [einsatz] [currency]` aus
2. Casino prüft **eigene** Regeln zuerst (kein Economy-Call nötig):
   - `currency_key ∈ allowed_currencies` für dieses Spiel?
   - `min_bet ≤ einsatz ≤ max_bet`?
   - Command/Spiel überhaupt `enabled`?
3. Casino ruft `economy.removeBalance(botId, guildId, userId, einsatz, currency, reason: '<game> bet', source: 'casino-plugin')`
   - Schlägt fehl (`insufficient_funds`) → Antwort an User, Spiel bricht ab, keine weitere Buchung
4. Bei Erfolg: Ergebnis anhand `rtp` würfeln (Payout-Multiplikator abhängig vom Spiel)
5. Bei Gewinn: `economy.addBalance(botId, guildId, userId, payout, currency, reason: '<game> payout', source: 'casino-plugin')`
6. Ergebnis-Embed an User (Einsatz, Ergebnis, neuer Kontostand)

---

## 5. Slash-Commands

Gemäß Plugin-Regeln: jeder Command bekommt eigenen Enable/Disable-Switch + Permission-Panel (`allowed_roles`, `banned_roles`, `required_permissions`, `banned_channels`).

| Command | Beschreibung |
|---|---|
| `/slots [einsatz] [currency]` | Klassische Slot-Machine |
| `/coinflip [einsatz] [currency] [seite]` | Kopf oder Zahl |
| `/dice [einsatz] [currency] [zahl]` | Würfel-Wette |
| `/blackjack [einsatz] [currency]` | (später — komplexeres Spiel mit mehreren Interaktionsschritten) |
| `/roulette [einsatz] [currency] [feld]` | (später) |

Welche Spiele im ersten Wurf umgesetzt werden ist noch offen (siehe Abschnitt 7).

---

## 6. Dashboard

**Spiele-Verwaltung** (`dashboard/pages/games.php`):
```
Slots      🟢 aktiv   RTP: [ 95 ] %   Einsatz: [ 10 ] – [ 500 ]
                       Erlaubte Currencies: ☑ Coins  ☐ Gems

Coinflip   🟢 aktiv   RTP: [ 97 ] %   Einsatz: [ 5 ]  – [ 200 ]
                       Erlaubte Currencies: ☑ Coins  ☑ Gems
```
- RTP-Feld mit Validierung (sinnvoller Bereich, z. B. 50–99%, um Owner vor Selbstschädigung/Total-Verlust-Configs zu schützen — genaue Grenzen offen)
- Currency-Checkliste wird dynamisch aus `economy.listCurrencies(botId)` befüllt
- Commands-Konfiguration (Permission-Panels) als eigene Seite, Standard-Muster wie bei Economy

---

## 7. Offene Punkte vor Implementierungsstart

- [ ] **Spiele-Umfang für v1**: alle 5 auf einmal oder erstmal nur Slots + Coinflip (einfache Single-Interaction-Spiele), Blackjack/Roulette (mehrstufige Interaktionen) später nachziehen?
- [ ] **Verantwortungsvolles Spielen**: optionales Tageslimit ("max. X Verlust pro User pro Tag") — sinnvoll für ein Spaß-Feature oder Overengineering?
- [ ] **Anti-Abuse**: Cooldown zwischen Bets (z. B. 2s) gegen Interaction-Spam/Discord-Rate-Limits?
- [ ] **RTP-Grenzen**: soll das Dashboard einen Min/Max-Bereich erzwingen (z. B. 50–99%), damit Owner sich nicht versehentlich ruiniert (RTP=150%) oder die Wirtschaft killt (RTP=0%)?
- [ ] **Payout-Berechnung pro Spiel**: RTP ist eine Gesamt-Kennzahl — muss pro Spiel in konkrete Multiplikatoren/Wahrscheinlichkeiten übersetzt werden (z. B. Slots: welche Symbol-Kombinationen zahlen wie viel). Das ist Spiellogik-Detail, kommt erst beim jeweiligen Spiel dran.

---

## 8. Implementierungs-Reihenfolge (Vorschlag)

1. Voraussetzung: EcoPlugin muss fertig implementiert & aktiv sein (siehe [[EcoPlugin]]-Plan)
2. DB-Migration `0001_casino_tables.sql` (`bot_casino_game_settings`)
3. Manifest mit `dependencies.economy-plugin` (required)
4. Core `index.js`: erstes Spiel (vermutlich Coinflip als einfachster Fall) inkl. Bet-Flow aus Abschnitt 4
5. Dashboard: Spiele-Verwaltung + Commands-Config
6. Zweites Spiel (Slots) nach Validierung des Bet-Flows
7. Testing: `insufficient_funds`-Pfad, RTP-Grenzfälle, parallele Bets desselben Users
