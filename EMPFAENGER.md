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

## Gewicht direkt aus Garmin Connect (Personal API)

- Garmin Connect (Web) → Einstellungen → **Persönlicher API-Schlüssel** → *Schlüssel erstellen* (Laufzeit 1 Jahr; Garmin mailt vor Ablauf).
- Schlüssel in Apps Script als Skripteigenschaft **`GARMIN_API_KEY`** eintragen (nie in Chats oder Dateien).
- Funktion **`garminTesten`** ausführen: zeigt die Gewichtswerte der letzten 14 Tage.
- Danach holt die 15-Minuten-Zeitsteuerung (`erinnerungPruefen`) das Gewicht der letzten 3 Tage automatisch.
- **Tageswert = erste Messung des Tages** (Morgengewicht), Körperfett/Muskelmasse aus der ersten Messung mit diesen Werten. Alle Messungen mit Uhrzeit stehen in `health/{Datum}.gewichtMessungen`.
- `tage/{Datum}.gewicht`: von Hand eingetragene Werte bleiben; automatisch übernommene werden auf das Morgengewicht korrigiert (Quelle „Garmin“).
- Das Cockpit errechnet aus den Messungen vor/nach einer Trainingseinheit (aus Analytics) den Flüssigkeitsverlust.
- In Health Auto Export bei „Cockpit Tageswerte“ und „Cockpit Heute“ **kein Gewicht** mehr auswählen – Garmin ist die einzige Quelle.
- Protokoll: Skripteigenschaft `LETZTER_GARMIN_ABGLEICH`. Schlüssel abgelaufen → neuen erstellen und `GARMIN_API_KEY` ersetzen.

## Blutdruck-Messreihen (Omron X7 Smart AFib)

- Das X7 misst dreimal und schreibt alle Einzelwerte nach Apple Health. Der Empfänger fasst Werte innerhalb von 10 Minuten (`BD_REIHE_MIN`) zu einer Messreihe zusammen und übernimmt den **Mittelwert** (`anzahl` = Zahl der Einzelwerte, in `health.bdMessungen` auch die Einzelwerte).
- Tageswert morgens = **erste** Messreihe vor 12 Uhr, abends = **erste** Messreihe ab 12 Uhr (jeweils vor der Tablette). Weitere Messreihen stehen in `health.bdMessungen` und im Cockpit unter dem Blutdruckfeld.
- Automatisch übernommene Werte werden aktualisiert, von Hand eingetragene bleiben.
- Änderung betrifft `doPost` → nach dem Einfügen **Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Version: Neue Version** (Adresse bleibt gleich).

## Tabletten aus Apple Health (ab v1.7.0)

- Health Auto Export: eigene Automation **„Cockpit Tabletten“** (REST API, gleiche URL), Datentyp **Medikamente**, Format JSON, Datumsbereich **Heute**.
- Jede Einnahme mit Status „Taken“ hakt die Morgen- (geplant vor 12 Uhr) bzw. Abendtablette ab; Quelle „Apple Health“ mit Uhrzeit.
- Von Hand im Cockpit gesetzte/entfernte Häkchen haben immer Vorrang.
- Mehrere Medikamente in Health? Skripteigenschaft `MEDIKAMENT` = Teil des Namens. Protokoll: `LETZTE_TABLETTEN` (zeigt auch die gefundenen Medikamentennamen).

## Wirklicher Auto-Export ohne manuelles Öffnen & ohne Homescreen-Icons (ab v1.8.6)

### 1. Empfänger-Speedup (~10× schneller, verhindert iOS-Hintergrund-Timeouts)
- `Code.gs` ruft `dienstAktualisieren()` nicht mehr bei jedem Webhook-POST synchron auf (läuft über den eigenen 3-Stunden-Trigger) und schreibt alle Firestore-Dokumente parallel via `UrlFetchApp.fetchAll(...)`.
- Nach dem Einfügen der neuen `Code.gs` einmal in Apps Script: **Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Version: Neue Version → Bereitstellen**.

### 2. Health Auto Export & iOS-Einstellungen prüfen
- **iOS Einstellungen → Allgemein → Hintergrundaktualisierung → Health Auto Export: EIN** (Stromsparmodus **AUS**).
- In den Automationen von Health Auto Export: **Sync-Intervall** auf **15 Min.** stellen.

### 3. Unsichtbarer iOS-Autopilot (0 Homescreen-Icons, 0 manuelle Klicks)
Apple verschlüsselt HealthKit bei gesperrtem iPhone. Mit Apples eingebauter **Kurzbefehle-App → Reiter „Automation“** (erscheint **nicht** auf dem Homescreen) läuft der Export lautlos genau dann, wenn das iPhone ohnehin entsperrt ist:
1. In **Kurzbefehle → Kurzbefehle** einen einzigen Hilfs-Kurzbefehl **`Health Sync`** anlegen (nicht zum Homescreen hinzufügen) mit den Aktionen **Health Auto Export → Automation ausführen** für `Cockpit Heute`, `Cockpit Blutdruck`, `Cockpit Tabletten`, `Cockpit Tageswerte`.
2. In **Kurzbefehle → Automation (+)** diese 3 unsichtbaren Trigger mit **`Sofort ausführen`** (Bestätigung AUS, Benachrichtigung AUS) auf `Health Sync` legen:
   - **App → `OMRON connect` → Wird geschlossen** *(Blutdruck landet sofort nach dem Messen im Cockpit)*
   - **App → `Health` → Wird geschlossen** *(Tabletten landen sofort nach dem Abhaken im Cockpit)*
   - **Ladegerät → Wird getrennt** *(und/oder **Wecker → Wird gestoppt** – Schlaf, Ruhepuls & HRV landen morgens automatisch im Cockpit)*
