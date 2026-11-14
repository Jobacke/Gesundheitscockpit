# Erinnerungen per iOS-Kurzbefehle

Drei persönliche Automationen in der **Kurzbefehle-App** (Reiter *Automation*). Sie laufen lokal auf dem iPhone und brauchen keinen Server.

| Uhrzeit | Wann | Mitteilung |
|---|---|---|
| **06:30** | nur wenn heute **kein** Nachtdienst (RNM/RNH) zu Ende ging | Wiegen · Blutdruck · Morgentablette |
| **08:00** | nur **nach** einem Nachtdienst (RNM/RNH) | Wiegen · Blutdruck · Morgentablette |
| **18:00** | jeden Tag | Blutdruck · Abendtablette (+ Wiegen, falls noch kein Gewicht da ist) |

**Grundeinstellung für alle drei:**
Kurzbefehle → *Automation* → **+** → **Tageszeit** → Uhrzeit wählen → **Täglich** → **Sofort ausführen** → *Bei Ausführung benachrichtigen* **aus** → *Weiter* → **Neuer leerer Kurzbefehl**.

> **Erkennen eines Nachtdienstes:** Nachtdienste heißen im Kalender **„Familie“** immer **RNM** oder **RNH**. Die Automationen suchen deshalb die Termine, die **heute enden**, und prüfen, ob einer davon RNM oder RNH heißt. Wegen der zwei Namen geht das über die Aktion „Text abgleichen“, denn ein einzelner Filter kann nicht „RNM oder RNH“.

---

## Automation 1 – 06:30 Uhr (normaler Tag)

1. Aktion **Kalenderereignisse suchen**
   - *Filter hinzufügen*: **Kalender** · ist · **Familie**
   - *Filter hinzufügen*: **Enddatum** · ist · **heute**
   - Oben muss **„Alle der folgenden“** stehen (nicht „Beliebige“).
2. Aktion **Text kombinieren**: *Kalenderereignisse* → auf die blaue Variable tippen → **Titel** wählen. Trennzeichen: *Leerzeichen*.
3. Aktion **Text abgleichen**: Muster `RN[MH]` · in *Kombinierter Text*. „Groß-/Kleinschreibung beachten“ bleibt an.
4. Aktion **Wenn**: *Übereinstimmungen* · **hat keinen Wert**
   - darin: **Mitteilung anzeigen** (je nach iOS-Version auch „Benachrichtigung anzeigen“)
     Titel: `Gesundheitscockpit`
     Text: `Guten Morgen! Wiegen · Blutdruck messen · Morgentablette – dann kurz eintragen.`
5. *Sonst* bleibt leer.

## Automation 2 – 08:00 Uhr (nach Nachtdienst)

Wie Automation 1, nur mit der Bedingung **hat einen Wert**:

1. **Kalenderereignisse suchen**, **Text kombinieren** und **Text abgleichen**: genau wie Schritt 1 bis 3 oben.
   Tipp: Automation 1 fertig bauen, dann in der Kurzbefehle-Mediathek den Kurzbefehl **duplizieren** und nur die Bedingung ändern.
2. **Wenn**: *Übereinstimmungen* · **hat einen Wert**
   - **Mitteilung anzeigen**: `Nach dem Nachtdienst: Wiegen · Blutdruck messen · Morgentablette – dann kurz eintragen.`

## Automation 3 – 18:00 Uhr (Abendrunde)

1. Aktion **Health-Samples suchen**
   - **Typ** · ist · **Gewicht**
   - **Startdatum** · ist · **heute**
2. **Wenn**: *Health-Samples* · **hat einen Wert**
   - **Mitteilung anzeigen**: `Abendrunde: Blutdruck messen und Abendtablette nehmen.`
3. **Sonst**
   - **Mitteilung anzeigen**: `Abendrunde: Blutdruck messen, Abendtablette nehmen – und heute noch wiegen.`

> Garmin Connect schreibt das Gewicht manchmal mit Verzögerung nach Health. Wenn du gewogen hast und trotzdem „noch wiegen“ erscheint, öffne kurz Garmin Connect. Dann wird synchronisiert.

---

## Testen

Öffne in jeder Automation den Kurzbefehl und tippe unten rechts auf **▶︎**. Die Mitteilung sollte sofort erscheinen. Beim ersten Lauf fragt iOS nach dem Zugriff auf Kalender und Health. Bitte erlauben.

**Nachtdienst-Erkennung prüfen:** Teste Automation 2 (08:00) am Morgen nach deinem nächsten RNM- oder RNH-Dienst mit **▶︎**. Kommt die Mitteilung nicht, endet der Termin im Kalender wahrscheinlich nicht am Folgetag, etwa weil er als ganztägiger Termin eingetragen ist. Dann in Schritt 1 statt „Enddatum ist heute“ den Filter **Startdatum · liegt in den letzten · 1 Tage** verwenden.

**Tipp:** Leg das Gesundheitscockpit auf die erste Seite des Home-Bildschirms. Nach der Mitteilung bist du dann mit einem Tipp in der App.
