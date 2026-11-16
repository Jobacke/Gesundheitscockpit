# Empfänger für Health Auto Export

Damit gelangen Schlaf, Ruhepuls, HRV, Gewicht und Blutdruck automatisch vom iPhone ins Cockpit, ohne Mac und ohne iCloud:

**iPhone (Health Auto Export, Automation „REST API“) → Google-Apps-Script (`empfaenger/Code.gs`) → Firestore → Gesundheitscockpit**

- Speichert pro Tag `users/{UID}/health/{Datum}`: Schlaf (Gesamt, Tief, REM, Kern, Wach, Einschlafen/Aufwachen), Ruhepuls, HRV, Gewicht, Blutdruck-Messungen
- Trägt **Gewicht** und **Blutdruck morgens/abends** in den Tag ein, aber nur, wenn dort noch nichts von Hand steht. Blutdruck vor 12 Uhr zählt als „morgens“, ab 12 Uhr als „abends“.
- Der Zugriff ist mit einem geheimen Schlüssel in der URL geschützt.

## Einrichtung

1. Die **Firebase-UID** ist in `Code.gs` oben bei `UID` schon eingetragen.
2. **script.google.com** → *Neues Projekt* → Name `Gesundheitscockpit Empfänger`.
3. Inhalt von `Code.gs` in die Datei `Code.gs` des Projekts kopieren.
4. *Projekteinstellungen* (Zahnrad) → Haken bei **„Manifestdatei ‚appsscript.json‘ im Editor anzeigen“** → im Editor `appsscript.json` öffnen und durch den Inhalt von `empfaenger/appsscript.json` ersetzen.
5. **Bereitstellen → Neue Bereitstellung** → Typ **Web-App** → Ausführen als **Ich**, Zugriff **Jeder** → *Bereitstellen* → Zugriff autorisieren.
6. Im Editor oben die Funktion **`einrichten`** wählen → **Ausführen**. Im Ausführungsprotokoll stehen dann „✓ Firestore-Zugriff funktioniert“ und die **URL für Health Auto Export**.
7. In **Health Auto Export** drei Automationen vom Typ **REST API** mit dieser URL anlegen:
   - **Cockpit Tageswerte**: Format JSON, *Daten zusammenfassen* **an**, Zeitintervall **Tage**, Datumsbereich **Vorherige 7 Tage**. Werte: Schlafanalyse, Ruhepuls, Herzfrequenzvariabilität, Gewicht. Vervollständigt die Vortage.
   - **Cockpit Heute**: wie „Cockpit Tageswerte“, aber Datumsbereich **Heute**. Nötig, weil „Vorherige 7 Tage“ den laufenden Tag (und damit die letzte Nacht) nicht enthält.
   - **Cockpit Blutdruck**: Format JSON, *Daten zusammenfassen* **aus**. Wert: Blutdruck. Nur so kommen Uhrzeiten für morgens/abends mit.

## Prüfen

- In Firebase → Firestore → `users` → deine UID → `health` liegen Tagesdokumente.
- Im Apps-Script-Projekt unter *Projekteinstellungen → Skripteigenschaften* steht bei `LETZTER_EMPFANG` der Zeitpunkt der letzten Lieferung.

## Änderungen am Code

Nach jeder Änderung an `Code.gs`: **Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version „Neue Version“ → Bereitstellen**. Die URL bleibt gleich.

## Erinnerungs-Mails (ab v1.4.2, ersetzt die Kurzbefehl-Erinnerungen)

- Funktion **`erinnerungEinrichten`** einmal im Editor ausführen: legt eine Zeitsteuerung alle 15 Minuten an und schickt eine Test-Mail.
- Ab **08:45** wird geprüft: Wiegen, Blutdruck morgens, Morgentablette. Ab **18:30**: zusätzlich Blutdruck abends und Abendtablette (plus noch Offenes vom Morgen).
- Fehlt etwas, kommt **eine** Mail pro Termin; ist alles eingetragen, keine.
- Empfänger: das Google-Konto des Skripts – oder die Skripteigenschaft `MAIL_AN` (andere Adresse).
- Protokoll: Skripteigenschaft `LETZTE_ERINNERUNG`. Testen jederzeit mit `erinnerungTesten`.
