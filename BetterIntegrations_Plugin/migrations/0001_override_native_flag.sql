-- Erweitert die CORE-Tabelle bot_custom_commands (nicht plugin-prefixed, da dieses
-- Feature bewusst mit dem bestehenden Command-Builder-System zusammenarbeitet statt
-- eine Parallel-Struktur zu bauen). Wird NICHT über den normalen {PREFIX}-Migrationslauf
-- ausgeführt (BetterIntegrations ist ein reines Dashboard-Plugin ohne Core-Runtime, das
-- migrations[]-Array in manifest.json bleibt deshalb leer) — hier nur als Dokumentation/
-- Reproduktionsanleitung, tatsächlich einmalig manuell ausgeführt am 2026-07-19.
ALTER TABLE bot_custom_commands ADD COLUMN overrides_native TINYINT(1) NOT NULL DEFAULT 0;
