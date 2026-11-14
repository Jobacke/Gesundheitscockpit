# Erinnerungen per iOS-Kurzbefehle

Die drei Kurzbefehle sind fertig gebaut und liegen im Ordner `kurzbefehle/`. Du musst sie nur einmal signieren, aufs iPhone holen und jeweils mit einer Uhrzeit verknüpfen.

| Kurzbefehl | Automation um | Was passiert |
|---|---|---|
| **Gesundheit morgens** | 06:30 | Erinnerung, **außer** heute endet ein Nachtdienst (RNM/RNH) |
| **Gesundheit nach Nachtdienst** | 08:00 | Erinnerung **nur**, wenn heute ein Nachtdienst (RNM/RNH) endet |
| **Gesundheit abends** | 18:00 | Blutdruck + Abendtablette, Hinweis aufs Wiegen |

Nachtdienst-Erkennung: Termine in deinen Kalendern, die **heute enden** und deren Titel **RNM** oder **RNH** enthält, z. B. „RNM (Nachtschicht)“.

---

## 1. Signieren (Mac, einmalig)

Terminal öffnen und eingeben:

```bash
sh ~/Gesundheitscockpit/kurzbefehle/signieren.sh
```

Es erscheinen drei Häkchen-Zeilen (✓). Danach öffnet sich der Ordner im Finder, darin liegen drei neue Dateien **ohne** „unsigned“ im Namen.

## 2. Aufs iPhone holen

Im Finder die drei Dateien `Gesundheit abends.shortcut`, `Gesundheit morgens.shortcut` und `Gesundheit nach Nachtdienst.shortcut` markieren → Rechtsklick → **Teilen → AirDrop** → dein iPhone.
Auf dem iPhone öffnet sich jeweils die Kurzbefehle-App → **Kurzbefehl hinzufügen**.

## 3. Einmal von Hand starten

In der Kurzbefehle-App (Reiter **Kurzbefehle**) auf **Gesundheit morgens** tippen.
Beim ersten Start fragt iOS nach dem **Kalenderzugriff** → **Erlauben** (ggf. auch „Immer erlauben“). Danach kommt die Mitteilung.

## 4. Automationen anlegen (dreimal)

Für jede der drei Zeilen aus der Tabelle oben:

1. Kurzbefehle-App → unten **Automation** → oben rechts **+**
2. **Tageszeit** antippen
3. Uhrzeit einstellen (06:30, 08:00 bzw. 18:00), **Täglich** ist schon gewählt
4. **Sofort ausführen** wählen, Schalter **„Bei Ausführung benachrichtigen“ aus**
5. Oben rechts **Weiter**
6. In der Liste den passenden Kurzbefehl antippen (z. B. **Gesundheit morgens**). Fertig.

---

## Prüfen

- Am Morgen nach dem nächsten RNM/RNH-Dienst: Um 06:30 kommt **nichts**, um 08:00 kommt „Nach dem Nachtdienst …“.
- Falls eine Mitteilung ausbleibt: Kurzbefehl in der App antippen und schauen, ob eine Fehlermeldung erscheint. Einen Screenshot davon an Claude schicken.
