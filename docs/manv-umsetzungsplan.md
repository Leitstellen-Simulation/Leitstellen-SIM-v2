# Umsetzungsplan für das MANV-Modul

## Ziel

Eine Großschadenslage soll mit unvollständiger Erstmeldung beginnen. Die Leitstelle alarmiert über eine konfigurierbare Alarm- und Ausrückeordnung, verarbeitet die Rückmeldungen der Einsatzkräfte und behält Patienten, SEG und offene Transporte im Blick. MANV ist je ILS zuschaltbar. Für den ersten spielbaren Stand sind 5–15 Patienten ein sinnvoller Testbereich. Die Auslösung richtet sich nach Szenario und örtlicher Konfiguration.

Die bayerische Ausführungsverordnung unterscheidet ELRD und Sanitäts-Einsatzleitung. LNA und OrgL bilden die SanEL. In der Simulation werden die Rollen deshalb separat alarmiert und ihre Ankunft separat geführt. Die erste Meldung schätzt das Ausmaß, spätere Meldungen aktualisieren Anzahl und Sichtung. Sichtungskategorie und Behandlungsfortschritt sind getrennte Daten. [AVBayRDG § 10](https://www.gesetze-bayern.de/Content/Document/BayAVRDG-10) · [AVBayRDG § 11](https://www.gesetze-bayern.de/Content/Document/BayAVRDG-11) · [BBK zur Sichtung](https://www.bbk.bund.de/DE/Themen/Gesundheitlicher-Bevoelkerungsschutz/Triage-Sichtung/triage-sichtung_node.html)

## 1. Bestehende Abläufe absichern

| Bereich | Vorarbeit |
| --- | --- |
| Patienten und Transporte | Fahrzeugzuordnung und Transportaufträge durchgehend an Einsatz-ID, Patienten-ID und Transportauftrag binden. `patientForVehicle` fällt derzeit auf den ersten Patienten zurück. Beim Zielwechsel setzt `changeTransportDestination` die gesamte Anfrageliste neu. Beides kann in Mehrpatientenlagen andere Patienten betreffen. |
| ELRD und Nachforderung | Die bestehende ELRD-Automatik für kleinere Mehrpatienteneinsätze prüfen. Im MANV sollen Führung und Freigaben über das Modul laufen. Handlungsbedarf entsteht aus empfangenen Meldungen und offenen Entscheidungen. |
| SEG und UGRD | `alarmSupportGroup` stellt heute primär disponierbare Hintergrundfahrzeuge bereit. Bereits vorhandene Ausrückverzögerungen, Teilausrücken, Nichtausrücken und Rückruf für das Modul anbinden. Ein Einsatzauftrag für eine SEG braucht eigene Rollen und darf dieselben Kräfte nur einmal binden. |
| Behandlungsverlauf | Verschlechterung bis zur Reanimation, Übergabe, konkurrierende RTW-Zuordnung und das Freimelden von Notarztfahrzeugen patientenbezogen testen. Ein Fahrzeug im Transport bleibt bis zur Übergabe gebunden, auch wenn die Lage vor Ort abgearbeitet ist. |

## 2. Spielbaren ersten Stand bauen

1. **Modul und Daten.** Ein eigenes Modul verwaltet je Einsatz die Aktivierungsstufe, bestätigte Meldungen, Führungsrollen, zugeteilte SEG und die Patientenübersicht. Der Karteneditor erhält einen ILS-Schalter, ein Alarmierungsprofil und optionale Rollen für einzelne Gruppen. Alte Karten lesen MANV als ausgeschaltet. Der Einsatzeditor erhält patientenbezogene Varianten und einen optionalen MANV-Auslöser. Ein festes Szenario im lokalen Testmenü dient als erster Einstieg.
2. **Lage und Sichtung.** Der Notruf liefert zunächst eine Schätzung. Nach Ankunft kann ein Einsatzmittel eine erste Lage melden. Die Sichtung macht Patienten nach und nach samt Kategorie und Transportbedarf sichtbar. In der ersten Version lassen sich SK I–III spielen. Vorläufige und bestätigte Sichtung bleiben unterscheidbar. Änderungen durch Verschlechterung werden mit Zeit und betroffenen Patienten gemeldet.
3. **Führung und SEG.** Alarmierung und Ankunft von ELRD, LNA und OrgL getrennt führen. Die Übergabe der Koordination ist ein eigener Zustand. Pro ILS kann die AAO eine Empfehlung für Führung, Regelrettungsdienst, SEG Behandlung und SEG Transport hinterlegen. Eine SEG Behandlung stellt begrenzte Versorgungskapazität an der Patientenablage bereit. Eine SEG Transport liefert tatsächlich ausgerückte Fahrzeuge für spätere Transportaufträge. Betreuung, Technik/Logistik und UG SanEL folgen als eigene Rollen. [Bayerisches Innenministerium zu SEG-Aufgaben](https://www.stmi.bayern.de/assets/stmi/sus/rettungswesen/id3_27_veroeffentlichungen_ar_manv_20130222.pdf)
4. **Oberfläche und Funk.** In der Einsatzkarte bleiben Kopf und Handlungsbedarf kompakt. Ein eigener MANV-Dialog bündelt bestätigte und gesichtete Patientenzahl, Sichtung, Behandlung, Transportfreigaben und Gruppenstatus. Funk meldet wesentliche Lageänderungen gesammelt. Einzelne dringende Änderungen und offene Freigaben bleiben gezielt am betroffenen Patienten erreichbar.
5. **Transporte und Abschluss.** Eine Freigabe verknüpft einen Patienten mit einem geeigneten Fahrzeug. Zuweisung, Abfahrt und Übergabe sind getrennte Schritte. Das Ziel kommt aus der normalen Klinikauswahl oder dem optionalen [Klinikanmeldungsmodul](ivena-umsetzungsplan.md). Die Lage endet erst nach Abschluss aller Patientenpfade. Freie Gruppen und Führungskräfte werden zurückgerufen. Gebundene Kräfte beenden ihren Auftrag regulär.

## 3. Abnahme und Ausbau

- Einen 8-Patienten-Testfall mit unklarer Erstmeldung durchspielen. Ankunft, Sichtung, Wechsel einer Sichtungskategorie, SanEL-Übernahme, Teilausrücken einer SEG und getrennte Transporte müssen im Protokoll nachvollziehbar sein.
- Zwei MANV parallel testen. Eine SEG darf nur einem laufenden Auftrag gleichzeitig zugeordnet sein. Gemischte Ziele, Zielwechsel eines einzelnen Fahrzeugs, Ablehnung einer Klinik, Doppelklicks auf Alarmierungen und wiederholte Funkmeldungen dürfen keine Doppelbelegungen erzeugen.
- Pause, Tempoänderung, Abbruch, Schichtende und Freimeldung nach Übergabe prüfen. Die Zahl gesichteter, noch vor Ort befindlicher, transportierter und abgeschlossener Patienten muss aus ihren Zuständen ableitbar bleiben.
- Bei deaktiviertem Modul die bisherigen Mehrpatienteneinsätze mit ELRD testen. TNA bleibt für Mehrpatientenlagen ausgeschlossen. Bei Hochstufung eines laufenden Einzelpatienteneinsatzes muss eine bestehende TNA-Sitzung über einen ausdrücklichen Zustandswechsel behandelt werden.
- Danach Betreuungsfälle ohne behandlungsbedürftige Verletzung, Behandlungsplätze, größere Lagen und überörtliche Kräfte ergänzen. Für den Ausbau der Klinikverteilung dient die Rückmeldung nach Sichtungskategorien als Orientierung. [IVENA-Anwenderbeirat Bayern zum MANV-Modul](https://rda.aelrd-bayern.de/ords/apexext/f?p=405%3A21%3A%3AAPPLICATION_PROCESS%3DGETFILE_EMPF%3A%3A%3AFILE_ID%3A262)
