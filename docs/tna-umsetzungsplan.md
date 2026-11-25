# Umsetzungsplan für das Telenotarzt-Modul

## Regeln für die Simulation

- TNA ist ein eigenes Modul pro Leitstelle. Neue und bestehende Leitstellen starten mit ausgeschaltetem Modul. Bei ausgeschaltetem Modul läuft ein ärztlicher Bedarf über die reguläre Nachforderung eines physischen Notarztmittels.
- Ein TNA wird ausschließlich durch einen RTW vor Ort für dessen zugeordneten Patienten nachgefordert. Die TNA-Wahrscheinlichkeit wird je Einsatzvariante eingestellt und beträgt bei bestehenden Varianten zunächst 0 %. Die Simulation würfelt einmal, sobald der RTW einen geeigneten Fall beurteilt.
- Voraussetzung ist genau ein Patient im gesamten Einsatz. Ein Mehrpatienteneinsatz bleibt ausgeschlossen, wenn später nur noch ein Patient vor Ort ist. Reanimation und zwingend physische ärztliche Versorgung schließen TNA aus.
- Der TNA kann die Behandlung vor Ort unterstützen und anschließend den Transport telenotärztlich begleiten. Die einzige Übergaberichtung ist **TNA → physischer Notarzt**. Die Anforderung eines physischen Notarztes und dessen tatsächliche Übernahme werden getrennt erfasst.
- Bei **5 % der TNA-begleiteten Transporte** fordert der RTW während der Fahrt einen physischen Notarzt nach. Diese feste Simulationsquote gilt pro Transport. Eine neue Route, ein Zielwechsel, Pause oder Tempowechsel lösen keinen weiteren Wurf aus.
- Ist die RTW-Technik ausgefallen, fordert der RTW bei weiter bestehendem ärztlichem Bedarf einen physischen Notarzt an und nennt den Ausfall als Grund. Eine Reanimation löst den physischen Notarztbedarf sofort aus, unabhängig von der Transportquote.

Für die fachliche Orientierung dienen die bayerische RTW-Nachforderung, die telenotärztliche Transportbegleitung und die Übergabe an einen eintreffenden physischen Notarzt. Die Aktivierungsregeln und die 5-%-Quote sind Festlegungen für diese Simulation. [Bayerisches Innenministerium – Telenotarzt in Bayern](https://www.stmi.bayern.de/a-z/anzeigen/telenotarzt-in-bayern/)

## 1. Bestehende Einsatzlogik prüfen

Vor dem Modulbau die relevanten Abläufe mit einer steuerbaren Simulationsuhr, festen Zufallswerten und kleinen Einsatzvorlagen testen. Befunde mit eigenen Regressionstests absichern, bevor der TNA-Pfad dieselben Stellen nutzt.

| Bereich | Prüffälle und erwartetes Ergebnis |
| --- | --- |
| Patientenidentität | Zwei parallele Einsätze mit derselben lokalen Patienten-ID, Transportzielwechsel und erneute Disposition prüfen. Ein reproduzierbarer Befund ist die Zuordnung zum falschen Einsatz durch `incidentForPatient`. Einsatz- und Patienten-ID müssen gemeinsam eindeutig sein. |
| Mehrpatienteneinsatz | Pro Patient getrennte Fahrzeugzuordnung, Nachforderung, Transportfreigabe und Klinikzuweisung prüfen. Abtransport, ambulanter Verbleib oder Abschluss eines Patienten dürfen die anderen Vorgänge nicht erledigen. Prüfen, ob die Freigabe eines überschüssigen Notarztmittels den Arztbedarf anderer Patienten beeinflusst. |
| ELRD | Nachforderung und Erstversorgung, Warten auf ELRD, Verzicht auf Warten und Eintreffen während einer offenen Rückfrage prüfen. ELRD bleibt gebunden, solange ein Patient vor Ort offen ist. Den Fall prüfen, dass der letzte Patient abgefahren ist, während ELRD noch einen Sprechwunsch offen hat. |
| CPR und Verschlechterung | Reanimation ab Einsatzbeginn und Übergang aus laufender Behandlung prüfen. Ein bereits offener Status 0, eine laufende Nachforderung und eine frühere Transportentscheidung dürfen den zusätzlichen Bedarf nicht verschlucken. Der bestehende Eskalationspfad setzt bei einer laufenden Nachforderung zunächst keinen neuen Funkauftrag ab. Ende-zu-Ende prüfen, wie der zusätzliche Bedarf danach im Funk und im Handlungsbedarf ankommt. |
| Disposition und Transport | Bewusst zwischen alarmiert, auf Anfahrt, vor Ort und tatsächlich übernommener Versorgung unterscheiden. KTW-/ITW-Übergaben, RTH-Transportmodus, physische Arztbegleitung, Zielwechsel, Todesfeststellung, Einsatzbearbeitung, Abbruch und Schichtwechsel prüfen. |

Relevante Einstiegspunkte sind `app-transport.js` für Zuordnung, Eskalation, Funk und Transport, `app.js` für Einsatzdaten und Bearbeitung sowie `app-queue.js` für offene Aufgaben.

## 2. Modul und Schnittstellen bauen

1. **Konfiguration.** Leitstellen-Schalter im Karteneditor und TNA-Wahrscheinlichkeit pro Variante im Einsatzeditor hinzufügen. Gespeicherte Werte durch Laden, Bearbeiten und Speichern erhalten. Fehlende Werte aus älteren Karten und Vorlagen als „aus“ beziehungsweise 0 % lesen. Die 5-%-Quote ist eine Konstante des Moduls.
2. **Nachforderung und Behandlung.** Der Kern meldet dem Modul, dass ein zugeordneter RTW vor Ort die Lage beurteilt. Das Modul prüft die Eignung, speichert das Würfelergebnis und liefert bei einem geeigneten Fall eine TNA-Anfrage. Funk und Handlungsbedarf verwenden den bestehenden Nachforderungsablauf. Ärztlicher Bedarf bleibt bis zur tatsächlichen Übernahme offen. Kann der TNA den Fall nicht übernehmen, bleibt der reguläre physische Nachforderungsweg verfügbar.
3. **Eigener Sitzungszustand.** Das Modul hält Anfrage, Verbindung, Versorgung vor Ort, Transportbegleitung, ausstehende physische Übernahme und Sitzungsende zusammen. Es bindet die Sitzung an Einsatz, Patient und RTW. Bestätigte TNA-Versorgung wird nur für geeignete Fälle bei der Behandlungs- und Transportfreigabe berücksichtigt. Die Zuordnung von Fahrzeugen und der physische Notarztbedarf verbleiben im Kern.
4. **Transport und Übergabe.** Beim ersten Start eines TNA-begleiteten Transports würfelt das Modul einmal. Bei einem Treffer plant es die Meldung für einen Zeitpunkt während der Fahrt ein. Der Kern hält den physischen Nachforderungsauftrag offen und rechnet ein passendes bereits anfahrendes Notarztmittel an. Für die erste Version ein explizites Rendezvous mit dem fahrenden RTW vorsehen. Die Übergabe erfolgt beim Zusammentreffen, danach greift die bestehende Logik für die physische Arztbegleitung. Erreicht der RTW früher die Klinik, endet der Transportpfad mit der Klinikübergabe. Aufträge und Timer für ein überholtes Rendezvous werden bereinigt.
5. **Grenzfälle und Rückfall.** Technikausfall und Reanimation nutzen den physischen Nachforderungsweg mit jeweils eigener Funkbegründung. Reanimation beendet den TNA-Pfad unmittelbar. Der allgemeine Zustandslauf prüft derzeit Patienten im Transport nicht weiter. Der neue Transportauslöser wird deshalb separat über die Simulationsuhr eingeplant. Wird eine Reanimation während eines solchen Transports über einen eigenen Zustandsübergang modelliert, muss sie dieselbe sofortige Eskalation auslösen. Zielwechsel, Abbruch, Klinikübergabe und Schichtende bereinigen jeweils die betroffenen Termine und Aufgaben.

## 3. Abnahme

- Mit ausgeschaltetem Modul und mit 0 % gegenüber identischen bestehenden Szenarien prüfen, dass ärztliche Nachforderungen, ELRD und Transporte wie bisher ausgelöst werden.
- Mit festen Zufallswerten 0 %, 100 % sowie Treffer und Fehlschlag der festen 5-%-Transportquote prüfen. Die Quote gilt für TNA-begleitete Transporte. Technikausfall und CPR werden separat getestet.
- Für einen einzelnen Patienten den vollständigen Ablauf RTW-Anfrage → TNA-Übernahme → Transportbegleitung → physische Nachforderung → Übergabe am Treffpunkt im Browser durchspielen. Zusätzlich Übergabe an die Klinik vor dem Treffpunkt prüfen.
- Bereits zugeteilte Notarztmittel, einen offenen Funkvorgang, Zielwechsel, Pause, Tempowechsel, Abbruch und Schichtende im selben Ablauf testen. Jede Nachforderung soll einmal erscheinen und mit dem richtigen Patienten und Transport verbunden bleiben.
- Reanimation ab Anruf und nach Verschlechterung vor, während und nach TNA-Beteiligung prüfen. Mehrpatientenfälle einschließlich ELRD und Fällen mit nur einem verbliebenen Patienten sind eigene Ausschlusstests.
