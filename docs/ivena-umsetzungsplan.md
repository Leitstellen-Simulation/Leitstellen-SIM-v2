# Umsetzungsplan für eine IVENA-ähnliche Klinikanmeldung

## Ziel

Die Leitstelle meldet simulierte Patienten bei einer geeigneten Klinik an und sieht, welche Versorgungskapazität für diesen Fall verfügbar ist. Das Modul wird je ILS aktiviert. Daten, Freigaben und Meldungen laufen in der Simulation. Das Bedienkonzept übernimmt die Grundidee aus Zuweisungsmerkmalen und aktueller Kapazität. Für den ersten Stand reichen im Spiel definierte Merkmale. Eine vollständige Nachbildung der bayerischen PZC-Tabelle ist ein späterer Ausbau. [IVENA-Module](https://www.ivena.de/page.php?k1=main&k2=ueber&k3=pakete&lang=1) · [Rettungsdienstausschuss Bayern, Empfehlungen zu PZC und Behandlungskapazitäten](https://rda.aelrd-bayern.de/ords/apexext/f?p=405%3A21%3A17373214355734%3A%3A%3A%3A%3A)

## 1. Anschluss an die bestehende Transportlogik

Der Funk liefert über `requestTransportDestination` und `activateTransportRequest` schon einen Auftrag je Patient mit Lagebericht und erforderlicher Fachrichtung. `nearestHospitals` bewertet Klinik und Entfernung. `beginTransport` startet nach Auswahl derzeit direkt den Transport. Die neue Anmeldung kommt genau zwischen Zielauswahl und Transportstart.

- Auftrag, Patient, Fahrzeug und Klinik eindeutig verknüpfen. Zielwechsel nur für den betroffenen Transportauftrag bearbeiten. Die bestehende Zuweisung erst freigeben, wenn ein geeignetes neues Ziel bestätigt ist oder der Auftrag ausdrücklich storniert wurde.
- Festes POI-Ziel, Heimfahrt und ambulantes Ergebnis umgehen die Klinikanmeldung. Bei einem fest vorgegebenen Krankenhausziel, etwa einer Verlegung, bleibt die Zielbindung erhalten und die Anmeldung läuft für diese Klinik.
- Karten mit dem Modul „aus“ nutzen die vorhandene Klinikauswahl. Bei Karten ohne gepflegte Kapazitätswerte bleibt fachliche Eignung sichtbar. Der Zustand lautet dann „Kapazität unbekannt“ und kann im Simulationsablauf telefonisch geklärt werden.

## 2. Regelbetrieb

| Baustein | Umsetzung |
| --- | --- |
| Zuweisungsmerkmale | Aus dem simulierten Patientenprofil Behandlungsschwerpunkt, Dringlichkeit, Altersgruppe, besondere Anforderungen und voraussichtliche Ankunft ableiten. Diese Merkmale in der bestehenden Zielauswahl anzeigen und bei Bedarf korrigierbar machen. Später kann ein kleiner, versionierter PZC-Katalog ergänzt werden. |
| Klinik und Kapazität | Stabile Klinik-ID und Fachrichtung verwenden. Mehrere fachliche Einträge eines Standorts können einen konfigurierten Kapazitätspool teilen. Die optische Gruppierung auf der Karte hat keinen Einfluss auf den Pool. Freie, gebundene und seit der Übergabe belegte Kapazität werden getrennt gerechnet. Kliniken können einzelne Bereiche zeitweise abmelden. |
| Anmeldung | Die Auswahl öffnet eine kompakte Übersicht mit Befund, Dringlichkeit, Kapazität und Ziel. Beim Absenden den letzten freien Platz atomar reservieren. Eine simulierte Bestätigung startet den bestehenden Transport. Bei Ablehnung, Zeitüberschreitung oder zwischenzeitlicher Schließung bleibt der Patient mit einem konkreten Grund in der Zielauswahl. Statusmeldungen laufen über den bestehenden Handlungsbedarf und Funk. |
| Ankunft und Freigabe | Bei Status 8 verbraucht die Übergabe die reservierte Kapazität. Nach einer konfigurierten Zeit in Simulationsminuten wird der Platz wieder verfügbar. Storno, Abbruch und Ablauf geben eine Reservierung genau einmal frei. Ein TNA-Rendezvous verändert den Transportweg, die bestätigte Klinikanmeldung bleibt dem Patienten zugeordnet. |
| Oberfläche und Zeiten | Den bestehenden Dialog erweitern. Geeignete Ziele zuerst, Abmeldegrund und Fremd-KH-Filter sichtbar. Alle Kandidaten können nach Luftlinie sortiert werden. Externe Fahrzeitabfragen bleiben auf höchstens drei geeignete Vorschläge begrenzt und werden zwischengespeichert. |

## 3. MANV und Tests

Für das optionale [MANV-Modul](manv-umsetzungsplan.md) kann dieselbe Anmeldung einen zweiten Kapazitätsmodus anbieten. Für die Lage melden Kliniken verfügbare Plätze je Sichtungskategorie. Diese Plätze werden pro bestätigter Zuweisung gezählt. Ein MANV-Kontingent verweist bei Bedarf auf dieselben realen Spielressourcen wie der Regelbetrieb, damit ein Platz nur einmal vergeben wird. Eine Sammelansicht bündelt Anmeldungen. Jede Bestätigung bleibt patientenbezogen. Rückmeldungen zu Selbsteinweisern können später als eigener Meldungstyp ergänzt werden. [IVENA-Anwenderbeirat Bayern zum MANV-Modul](https://rda.aelrd-bayern.de/ords/apexext/f?p=405%3A21%3A%3AAPPLICATION_PROCESS%3DGETFILE_EMPF%3A%3A%3AFILE_ID%3A262)

- Den vollständigen Standardablauf mit einem RTW von Status 5 über Klinikbestätigung und Status 7 bis zur Übergabe testen. Ablehnung, Abmeldung, fehlende Fachrichtung und Fremd-KH durchspielen.
- Zwei gleichzeitige Anmeldungen für den letzten Platz, Doppelklick, Bestätigung nach einem Storno und Umlenkung während der Anfahrt testen. Ein Zielwechsel darf die Bestätigungen anderer Patienten nicht verändern.
- Drei Patienten aus einem Einsatz auf zwei Kliniken verteilen. Eine Abmeldung während der Fahrt, eine TNA-Übergabe und einen RTH-Transport abdecken. Bei Pause und Tempowechsel sollen Reservierungsfristen und Belegung mit der Simulationsuhr laufen.
- Beide Module getrennt testen. Der IVENA-ähnliche Regelbetrieb ist zuerst lieferbar und kann anschließend als Zielzuweisung für MANV dienen.
