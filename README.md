# Gesundheitscockpit

Eigene Web-App (PWA) für die tägliche Gesundheitsroutine: Wiegen, Blutdruck morgens und abends, beide Tabletten, Befinden und Rücken. Dazu kommen ein Konstanz-Kalender, Serien und Verlaufsgrafiken.
Teil der App-Familie (Anthrazit-Metallic, Material **Smaragd**).

**Stufe 1 (diese Version):** Morgen- und Abend-Check, Konstanz, Verlauf, CSV-Export, Erinnerungen über iOS-Kurzbefehle.
**Als Nächstes (Stufe 1b):** Schlaf (Apple-Health-Export), Training (Analytics), Dienste (Kalender „Familie“) und die tägliche Ampel.

---

## Ohne Einrichtung ausprobieren (Demo-Modus)

Solange in `js/firebase-config.js` `null` steht, läuft die App im **Demo-Modus**. Die Daten bleiben dann nur auf dem Gerät.
Unter *Mehr → Beispieldaten erzeugen* siehst du, wie Konstanz und Verlauf mit Daten aussehen. Danach kannst du sie wieder löschen.

Lokal starten:
```bash
cd ~/Gesundheitscockpit
python3 -m http.server 8080
# → http://localhost:8080
```

---

## 1. Firebase-Projekt anlegen (ca. 10 Minuten)

1. **https://console.firebase.google.com** → *Projekt hinzufügen* → Name `Gesundheitscockpit` → Google Analytics **aus**.
2. **Authentication** → *Jetzt starten* → Anmeldemethode **E-Mail/Passwort** aktivieren.
   - Reiter *Nutzer* → **Nutzer hinzufügen**: deine E-Mail und ein Passwort.
   - Falls angeboten: unter *Einstellungen → Nutzeraktionen* die **Registrierung deaktivieren**. Dann kann sich niemand sonst ein Konto anlegen.
3. **Firestore Database** → *Datenbank erstellen* → Standort **europe-west3 (Frankfurt)** → *Produktionsmodus*.
   - Reiter **Regeln**: den Inhalt von `firestore.rules` einfügen → *Veröffentlichen*.
4. **Projekteinstellungen** (Zahnrad) → *Allgemein* → *Meine Apps* → Web-Symbol `</>` → Name `Gesundheitscockpit` (Firebase Hosting **nicht** anhaken).
   Den angezeigten `firebaseConfig`-Block in **`js/firebase-config.js`** einsetzen (statt `null`).
5. **Authentication → Einstellungen → Autorisierte Domains**: `jobacke.github.io` hinzufügen (und ggf. deine eigene Domain, z. B. `gesundheit.vjbackhaus.de`).

> Die Werte in `firebase-config.js` sind nicht geheim. Geschützt sind deine Daten durch das Login und durch `firestore.rules`: Jeder sieht nur seine eigenen Daten.

## 2. Auf GitHub veröffentlichen

```bash
cd ~/Gesundheitscockpit
git init
git add .
git commit -m "Gesundheitscockpit Stufe 1"
git branch -M main
git remote add origin https://github.com/Jobacke/Gesundheitscockpit.git   # Repo vorher auf github.com anlegen
git push -u origin main
```
Danach auf GitHub: *Settings → Pages → Branch `main` / `(root)`* → speichern.

- Im Code stehen **keine Gesundheitswerte**. Alle Daten liegen in Firestore. Ein öffentliches Repo ist deshalb unkritisch. GitHub Pages aus einem **privaten** Repo funktioniert nur mit GitHub Pro.
- Optional eigene Domain wie bei ZNA-Navi: Datei `CNAME` mit `gesundheit.vjbackhaus.de` anlegen und beim DNS-Anbieter einen CNAME auf `jobacke.github.io` setzen. Die Domain dann auch in Firebase unter *Autorisierte Domains* eintragen.

## 3. Auf dem iPhone installieren

Seite in **Safari** öffnen → *Teilen* → **Zum Home-Bildschirm**. Das Icon heißt „Gesundheit“.
Einmal anmelden, dann bleibst du angemeldet. Eingaben funktionieren auch offline und werden später synchronisiert.

## 4. Erinnerungen einrichten

→ siehe **[KURZBEFEHLE.md](KURZBEFEHLE.md)**: 06:30 normaler Tag, 08:00 nach Nachtdienst, 18:00 Abendrunde.

---

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html` | App-Hülle, Login, Tab-Leiste |
| `css/app.css` | Gestaltung (Anthrazit/Smaragd) |
| `js/app.js` | Ansichten Heute, Konstanz, Verlauf, Mehr |
| `js/store.js` | Datenschicht: Firebase (mit Offline-Cache) oder Demo-Modus |
| `js/firebase-config.js` | Firebase-Konfiguration |
| `sw.js` | Service Worker (offline). Bei Änderungen `CACHE`-Version hochzählen |
| `firestore.rules` | Sicherheitsregeln für Firestore |

**Datenmodell:** `users/{uid}/tage/{JJJJ-MM-TT}` mit `gewicht`, `bdMorgen {sys, dia, puls, zeit}`, `bdAbend {…}`, `tabletteMorgen`, `tabletteAbend`, `befinden` (1–5), `ruecken` (0–10), `notiz`.
Einstellungen (Grenzwerte) liegen in `users/{uid}.einstellungen`.

**Konstanz:** Ein Tag ist *komplett*, wenn alle fünf Aufgaben erledigt sind: Wiegen, Blutdruck morgens, Morgentablette, Blutdruck abends, Abendtablette.
