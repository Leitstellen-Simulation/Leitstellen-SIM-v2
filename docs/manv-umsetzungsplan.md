# Umsetzungsplan für das MANV-Modul

## Ziel und Einbindung

Eine Großschadenslage beginnt mit einer unvollständigen Erstmeldung. Die Leitstelle baut aus Lage auf Sicht, Rückmeldungen, Vorsichtung und ärztlicher Sichtung schrittweise ihr Lagebild auf. Das separat installierbare MANV-Modul besitzt die Einsatzregeln, Rollen, Patienten, Klinikverteilung und das MANV-Fenster. Die Haupt-App stellt Fahrzeugzustände, Funk, Simulationszeit, Karte und Transportbefehle bereit. [Mod-Schnittstelle v1](mod-api.md)

Für einen vom Mod übernommenen Einsatz ist der Mod die alleinige Quelle für Patientenzustände und Freigaben. Sobald ein Transportauftrag entsteht, erhält die Haupt-App die nötigen Referenzen und die Entscheidung des Mods. Der Host meldet Fahrzeugankunft, Abfahrt und Klinikübergabe über die allgemeinen Schnittstellen zurück.

Der Einsatzeditor speichert MANV-Szenarien im separaten Katalog. Im Karteneditor schaltet jede ILS MANV manuell frei und stellt die vier Sechs-Stunden-Blöcke ein. Fehlt das Paket oder startet es fehlerhaft, läuft der Regelbetrieb weiter und die Konfiguration bleibt gespeichert.

## 1. Konfiguration je MANV-Szenario

| Einstellung | Umsetzung im Modul |
| --- | --- |
| Patientenzahl | Einstellbarer Sollwert mit einer Zufallsabweichung von ±15 %. Einmal je Einsatz eine ganzzahlige Anzahl aus dem zulässigen Bereich ziehen. Diese Zahl ist intern fest. Die ILS sieht zuerst eine Schätzung und erfährt die bestätigte Anzahl durch Rückmeldungen. |
| Anteile SK I, II und III | Drei Einstellwerte mit exakt 100 % Summe. Beim Erzeugen darf jeder Wert um bis zu **5 Prozentpunkte** abweichen. Die gezogenen Anteile liegen gemeinsam im erlaubten Bereich und ergeben genau 100 %. Auf ganze Patienten verteilen, indem übrige Plätze an die größten Rundungsreste gehen. So bleibt auch bei kleinen Lagen die Patientenzahl exakt erhalten. |
| Klinikbedarf | Szenario legt Hauptfachrichtungen und deren Gewichtung fest, etwa Unfallchirurgie oder Innere Medizin. Ein kleiner konfigurierbarer Anteil kann zu anderen plausiblen Bedarfen wie einer akuten Belastungsreaktion führen. Alter separat ziehen, sodass im Mittel etwa 10 % Kinder vorkommen. Die Zielwahl berücksichtigt sowohl die passende Fachrichtung als auch die pädiatrische Eignung. |
| Führungsmittel der Erstalarmierung | ELRD, SanEL und UG SanEL einzeln als Bedarf einstellbar. Die Auswahl SanEL umfasst LNA und OrgL, die separat alarmiert werden und separat eintreffen können. Die UG SanEL bekommt Status und offene Nachforderung analog zur ELRD-Logik. Die Lage bleibt auch bei fehlender UG SanEL manuell bearbeitbar. |

SK IV und Tod können sich aus dem Verlauf ergeben. Die Anfangsverteilung beschreibt SK I–III. Vorsichtungsstatus, ärztliche Einstufung, Transportbedarf und abschließender Patientenzustand werden getrennt gespeichert. Die bayerische Einteilung der Führungsrollen und die BBK-Sichtungskategorien dienen als Referenz für die Bezeichnungen. [AVBayRDG § 10](https://www.gesetze-bayern.de/Content/Document/BayAVRDG-10) · [BBK zur Sichtung](https://www.bbk.bund.de/DE/Themen/Gesundheitlicher-Bevoelkerungsschutz/Triage-Sichtung/triage-sichtung_node.html)

## 2. Ablauf an der Einsatzstelle

1. **Erstmeldung.** Das erste eingetroffene Rettungsmittel meldet die Lage auf Sicht, unabhängig vom Fahrzeugtyp. Der erste RTW übernimmt bis zur Übergabe an den ELRD die vorläufige Einsatzleitung und ergänzt die erste strukturierte Lagemeldung. Solange er diese Rolle hat, ist er für Patientenversorgung und Transport gebunden.
2. **Ärztliche Führung.** Das erste NEF übernimmt die vorläufige ärztliche Leitung, wenn der LNA noch fehlt. Währenddessen ist es für Sichtung, Versorgung und Begleitung gebunden. Ist der LNA vor Ort, kann das erste NEF nach der Übergabe oder bei seiner Ankunft direkt ärztlich sichten. Eine bereits laufende Sichtung bleibt beim eingeteilten NEF.
3. **Vorsichtung.** Der zweite RTW übernimmt die Vorsichtung. Ist der ELRD vor Ort und der zweite RTW noch nicht eingetroffen, kann der erste RTW nach der Übergabe selbst vorsichten. Das eingeteilte Fahrzeug führt seine Aufgabe bei späteren Ankünften zu Ende. Pro Person dauert die Vorsichtung 20–40 simulierte Sekunden. Ergebnis ist SK I, II, III oder Tod. Der vorsichtende RTW bleibt bis zur vollständigen Vorsichtung gebunden. Ein anderer freier RTW kann einen bereits vorgesichteten roten Patienten übernehmen.
4. **Ärztliche Sichtung.** Ärztlich sichten kann das nächste freie NEF an der Einsatzstelle oder das erste NEF, sobald der LNA übernommen hat. Pro Person dauert sie **60 simulierte Sekunden**. Sie bestätigt oder ändert die Vorsichtung und kann SK IV (blau) ergeben. Als Ablauf für v1 kann die ärztliche Sichtung bereits vorgesichteter Personen parallel zur noch laufenden Vorsichtung stattfinden. Rot ist die einzige Kategorie, die mit abgeschlossener Vorsichtung bereits vor ärztlicher Sichtung transportiert werden kann.
5. **Zuteilung.** Freie geeignete Rettungsmittel übernehmen den höchstpriorisierten verfügbaren Patienten in der Reihenfolge **Rot → Blau → Gelb → Grün**. Führungs- und Sichtungsrollen gelten als belegt. Die Eignung des Rettungsmittels und der Freigabestatus bestimmen, welche Patienten für die Zuteilung in Frage kommen. Ein freier KTW kann dadurch einen geeigneten gelben oder grünen Patienten übernehmen, während rote Patienten auf RTW warten.

Übergaben und Rollenwechsel werden im Funk und im MANV-Fenster sichtbar. Der ELRD übernimmt die Koordination beim Eintreffen, LNA und OrgL werden als getrennte Ankünfte erfasst. Eine SEG Behandlung stellt vor Ort einen wirksamen Behandlungspuffer bereit. SEG Transport liefert die tatsächlich ausgerückten Fahrzeuge. [AVBayRDG § 11](https://www.gesetze-bayern.de/Content/Document/BayAVRDG-11) · [Bayerisches Innenministerium zu SEG-Aufgaben](https://www.stmi.bayern.de/assets/stmi/sus/rettungswesen/id3_27_veroeffentlichungen_ar_manv_20130222.pdf)

## 3. Vereinfachter Patientenverlauf

| Zustand | Spielregel |
| --- | --- |
| Wartet auf geeignetes Rettungsmittel | Zufällige Verschlechterung mit einer Größenordnung von 10–15 %, Verbesserung deutlich seltener. Bezugszeitraum und seltene Verbesserungsquote sind noch festzulegen. Eine eingetroffene SEG Behandlung senkt das Verschlechterungsrisiko relativ um bis zu 50 %, abhängig von Versorgungskapazität und Zahl wartender Patienten. Bei LNA und OrgL vor Ort greift eine weitere konfigurierbare Senkung. |
| Zwischen Vorsichtung und ärztlicher Sichtung | Der Zustand kann sich noch verbessern oder verschlechtern. Bei der ärztlichen Sichtung wird der aktuelle Zustand berücksichtigt. Das Modul führt pro Patient eine gemeinsame Zeitlinie, damit dieselbe Verschlechterung nur einmal verarbeitet und gemeldet wird. |
| Übernahme durch geeignetes Rettungsmittel | Einmalig 5–12 simulierte Minuten bis zur Transportbereitschaft ziehen. Mit der tatsächlichen Übernahme enden die zufälligen Verschlechterungen und Verbesserungen beim Warten. Bei Rot endet zusätzlich die laufende Sterbeprüfung. Die besondere Prüfung bei Blau während der Vorbereitung ist unten festgelegt. |
| Rot | Mindestens ein RTW. Für rund 5 % der roten Patienten ist NA-Begleitung erforderlich. Das Modul zieht diesen Bedarf einmalig pro Patient. Die Begleitung bindet den NA bis zur Klinikübergabe. Kann kein NA begleiten, kann die ILS den RTW bewusst ohne NA freigeben. |
| Gelb | Einmalig je Patient 50 % RTW-Bedarf und 50 % KTW-Bedarf ziehen. |
| Grün | KTW als erforderliches Transportmittel. |
| Blau | Immer RTW und rund 5 % Chance auf NA-Begleitung. Bei Übernahme läuft dieselbe Vorbereitung von 5–12 Minuten. Für v1 läuft das doppelte Minutenrisiko während dieser Vorbereitung weiter. Ein dabei eingetretener tödlicher Ausgang wird am Ende gemeldet. Überlebende werden auf Rot hochgestuft und für den roten Transportweg freigegeben. Der bereits gezogene NA-Bedarf bleibt erhalten. |
| Tod | Der Patient bleibt in der Lagezählung und erhält keinen Transportauftrag. |

### Sterbewahrscheinlichkeit für Rot und Blau

Das Modul zählt pro Patient die vollendeten simulierten Minuten mit aktivem Risiko. Bei Rot beginnt die Prüfung mit **1 % in Minute 1** und erreicht **10 % pro Minute ab Minute 50**. Als langsam anlaufende Kurve wird für v1 ein quadratischer Anstieg angesetzt. Für Minute `m` gilt `pRot = 0.01 + 0.09 × ((min(m, 50) - 1) / 49)²`.

Bei Blau gilt in derselben Risikominute `pBlau = 2 × pRot`, also 2 % zu Beginn und maximal 20 % ab Minute 50. Der Zähler bleibt beim Wechsel Blau → Rot erhalten. Ist der Patient anschließend noch in der Wartephase, gilt ab der nächsten Prüfung die rote Kurve an derselben Stelle mit maximal 10 % pro Minute. Hat der RTW den Patienten weiterhin übernommen, endet die laufende Prüfung mit der Hochstufung. In Kategorien außerhalb von Rot und Blau pausiert der Zähler. Ein tödliches Ergebnis beendet weitere Würfe.

Bei durchgehend roten Patienten ohne Übernahme ergibt die quadratische Kurve bis Minute 30 rund 46,7 % und bis Minute 50 rund 87,5 % kumuliertes Risiko. Diese Werte dienen der Einordnung in den Spieltests.

### Manuelle Abfahrt ohne erforderlichen NA

Ist ein roter Patient transportbereit, braucht NA-Begleitung und es steht kein geeigneter NA zur Verfügung, kann die ILS **Ohne NA starten** wählen. Der Mod zeigt das Risiko vor der Bestätigung und würfelt nach gültiger Ziel- und Fahrzeugzuweisung **einmalig 10 %**. Bei einem tödlichen Ausgang meldet er den Tod vor Abfahrt und gibt den RTW und eine bereits reservierte Zielzuweisung frei. Andernfalls beauftragt er die Fahrt ohne NA. Die Entscheidung ist pro Transportauftrag einmalig, auch bei Doppelklick oder erneuter Zustellung. Der automatische Klinik-Fallback verwendet ausschließlich freigegebene Transporte.

## 4. MANV-Fenster und Klinikzuweisung

Aus dem aufgeklappten Einsatz öffnet sich ein eigenes MANV-Fenster. Es zeigt Lage auf Sicht, bestätigte Patientenzahl, Vorsichtung, ärztliche Sichtung, zugeordnetes Fahrzeug, dessen Transportbereitschaft sowie Zielklinik und Übergabe. Zur Übersicht zählen auch noch ungesichtete Personen als Anzahl, sobald die ILS diese aus einer Meldung kennt. Bestätigte Patientendetails erscheinen entsprechend dem gemeldeten Kenntnisstand.

- **Manuelle Zuweisung.** Die ILS wählt im MANV-Fenster pro Patient eine Zielklinik. Die Auswahl zeigt Eignung und Aufnahmebereitschaft. Ein Transportauftrag bindet genau einen Patienten und ein Fahrzeug. Parallel anstehende Zuweisungen bleiben unabhängig.
- **Automatische Quoten.** Im einzelnen MANV-Einsatz legt die ILS die Klinikanteile mit einer Summe von 100 % fest und schaltet die Automatik ein, sobald LNA und OrgL vor Ort sind. Verlässt eine der beiden Funktionen die Einsatzstelle, schaltet sich die Automatik ab. Die festen Quoten werden unter den für den jeweiligen Patienten geeigneten, aufnahmebereiten Kliniken mit positiver Quote angewandt. Die Verteilung berücksichtigt bereits zugewiesene Patienten. Die manuelle Auswahl bleibt möglich.
- **Fallback für rote Patienten.** Ist fünf simulierte Minuten nach erreichter Transportbereitschaft noch keine Zielklinik zugeteilt, startet ein für Rot freigegebener Transport automatisch. Als Standard für das „nächste KH“ ist die nächste geeignete und aufnahmebereite Klinik vorgesehen. Fehlt eine solche Klinik, erscheint offener Handlungsbedarf. Der Fallback ist auch ohne UG SanEL verfügbar. Eine zeitgleich eintreffende manuelle Zuweisung und der automatische Start müssen denselben Auftrag verwenden.
- **Klinik-Alarm MANV.** Eigene Aktion in der Alarmierung. Ab Auslösung sind neue Abmeldungen im betroffenen Kliniknetz gesperrt. Alle auf der aktiven Karte geführten Kliniken melden sich innerhalb von 15–30 simulierten Minuten grün, auch zuvor abgemeldete Häuser. Die Fachrichtungen gelten weiter. Bei mehreren gleichzeitigen Lagen bleibt der Alarm wirksam, bis die letzte zugehörige Lage ihn beendet. Danach übernimmt die normale Verfügbarkeitslogik. Laufende Transporte behalten ihre Aufträge.

Für v1 erfolgt die Verteilung über Eignung und Quoten. Das optionale [IVENA-ähnliche Modul](ivena-umsetzungsplan.md) kann später echte Kontingente je Sichtungskategorie beitragen. Solche Kontingente müssten pro bestätigter Zuweisung reserviert werden. [IVENA-Anwenderbeirat Bayern zum MANV-Modul](https://rda.aelrd-bayern.de/ords/apexext/f?p=405%3A21%3A%3AAPPLICATION_PROCESS%3DGETFILE_EMPF%3A%3A%3AFILE_ID%3A262)

## 5. Technische Umsetzung und Abnahme

1. **Szenarien und reproduzierbarer Testfall.** Patientenzahl, Anteile, Fachrichtungsgewichte und Anfangsbedarf im Mod-Katalog konfigurieren. Den Zufall für Testläufe reproduzierbar machen. Grenzfälle mit sehr kleiner Patientenzahl, Anteilen von 0 oder 100 %, Kinderanteil und exakter Summe testen. Ein Fall mit acht Patienten dient als erster spielbarer Ablauf.
2. **Rollen und Zeit.** Der Mod führt pro Einsatz die Zustände für Führung, Vorsichtung und ärztliche Sichtung. Die Haupt-App bietet generische Ereignistermine in Simulationssekunden, damit die 20–40 bzw. 60 Sekunden korrekt pausieren und auf Tempoänderungen reagieren. Führungsfahrzeuge und Gruppen über eindeutige IDs reservieren. LNA, OrgL und UG SanEL müssen über die gemeinsamen Fahrzeug- bzw. Gruppenabläufe separat alarmierbar und beobachtbar werden.
3. **Patienten und Transporte.** Der Mod berechnet Sichtung, Verlauf, Sterberisiko, Zuteilung, Begleitbedarf und manuelle Ausnahmefreigaben. Für seine Einsätze ruft die Haupt-App ausschließlich den zuständigen Controller auf. Der Host prüft generisch Fahrzeugverfügbarkeit, Zuordnung und Ziel, startet die Fahrt und meldet den Transportfortschritt zurück. Auftrags-, Patienten- und Fahrzeug-ID bis zur Übergabe durchreichen. Einen Zielwechsel immer auf den betroffenen Transport beschränken. Die heutige Zielwechselroutine setzt die Anfrageliste des ganzen Einsatzes neu. [Zielwechsel in der Haupt-App](../app-render.js)
4. **Klinik-Alarm und Fenster.** Klinikbereitschaft mit einem allgemeinen, zeitlich begrenzten Verfügbarkeitsmechanismus im Host absichern. MANV-Regeln und Quoten bleiben im Mod. Das eigene Fenster und Statusmeldungen über die bestehende Mod-Schnittstelle öffnen. Die Freigabe weiterer Fahrzeuge und Gruppen darf laufende Transporte nicht abbrechen.
5. **Negativ- und Paralleltests.** Zwei MANV mit geteilter Klinikverfügbarkeit testen. Eine SEG und jeder Patient bzw. Transportauftrag dürfen jeweils nur einmal gebunden sein. Insbesondere Rollenübernahme durch RTW 1 und NEF 1, späte Ankunft eines zweiten Fahrzeugs, minutengenauer Risikoanstieg mit Blau → Rot, roter Frühtransport und beide Ergebnisse der einmaligen 10-%-Freigabe prüfen. Weitere Testfälle sind fehlende UG SanEL, keine passende Kinderklinik, zeitgleiche Zielwahl und Klinik-Alarm nach vorheriger Abmeldung. Pause, Zeitbeschleunigung, Mitternacht, Abbruch, Schichtende und Regelbetrieb mit fehlendem oder deaktiviertem Mod prüfen.

## Entscheidungen vor der Spielbalance

- Für die 10–15 % zufällige Verschlechterung ist ein Zeitbezug nötig. Ein erster Vorschlag ist eine Prüfung pro Wartephase mit dokumentierter, seltener Verbesserung.
- Die Ersatzregeln decken eine fehlende zweite Einheit ab, sobald ELRD oder LNA am Einsatzort sind. Für den Fall, dass gleichzeitig die jeweilige Führungskraft fehlt, bleibt eine ausdrückliche Rollenentscheidung der ILS als möglicher Ausbau offen.
- Quoten ohne passendes Ziel, Freigabe des Klinik-Alarms und Ausnahmemeldungen im Handlungsbedarf zuerst simulieren. Die Lage sollte nachvollziehbar bleiben, wenn Ressourcen fehlen oder Transporte sich stauen.
