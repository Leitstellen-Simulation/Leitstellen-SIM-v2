# Leitstellen-Simulation

Browserbasierte Simulation einer integrierten Leitstelle mit Rettungsdienst, Feuerwehr, Polizei, Krankentransport, Funkstatus, Einsatzbearbeitung und Kartenlogik.

Das Projekt befindet sich in einer Alpha-Version und ist fuer Tests, Entwicklung und Balancing gedacht. Es ist nicht fuer produktive Leitstellenarbeit geeignet.

Dieses Projekt laeuft mit Unterstuetzung durch Codex.

## Installation

Voraussetzungen:

- Node.js 18 oder neuer
- Ein moderner Browser, z.B. Chrome, Edge oder Firefox
- Internetverbindung fuer Kartenkacheln und OSRM-Routing
- Python ist aktuell nicht erforderlich

Start unter Windows:

1. Repository klonen oder entpacken.
2. `start-dispatchsim.cmd` ausfuehren.
3. Browser oeffnet automatisch `http://127.0.0.1:4173/index.html`.

Start per Konsole:

```powershell
node server.mjs
```

Danach im Browser oeffnen:

```text
http://127.0.0.1:4173/index.html
```

Admin/Testbetrieb:

```text
start-dispatchsim-admin-test.cmd
```

Der lokale Server speichert Karten und Einsatzdaten ueber die eingebauten API-Endpunkte. Ohne den Node-Server kann die reine Oberflaeche zwar teilweise geladen werden, Speichern und einige Testfunktionen sind dann aber eingeschraenkt.

## Aktuelle Features

- Startbildschirm mit Kartenauswahl, Uhrzeit und Simulationsgeschwindigkeit.
- Einsatzannahme, Einsatzbearbeitung und Nachalarmierung.
- Fahrzeugliste mit Status, Schichtlogik, Funkstatus und Sortierung nach Wache, Status, Typ oder Status + Typ.
- Karte mit Rettungswachen, Fremdwachen, Krankenhaeusern, Fremd-KH, POI, Einsatzstellen und Fahrzeugpositionen.
- OpenStreetMap/Esri-Kartenanzeige und OSRM-basierte Fahrzeiten mit Fahrzeugprofilen.
- Unterscheidung von SoSi/ohne SoSi bei Ausrueckzeit und Fahrt.
- Rettungsdienstlogik mit KTW, RTW, NEF, REF und RTH.
- Patientenversorgung mit variierender Behandlungsdauer, Fortschrittsanzeige, Mehrpatientenlagen und Krankenhauszuweisung.
- Transportzielauswahl nach Fachrichtung, optional mit Fremd-KH.
- Funkleiste mit Status 0/5, Sprechaufforderung und Rueckmeldungen.
- Status-8-Logik mit Rueckfrage "Einsatzklar?" und verzogener Freimeldung.
- Fremdwachen und Fremdfahrzeuge mit Verfuegbarkeitswahrscheinlichkeit und 15-Minuten-Neuwuerfelung.
- Fremdfahrzeuge koennen im Einsatzdialog bei Bedarf eingeblendet werden.
- Fremdwachen und Fremd-KH sind optisch abgesetzt.
- Feuerwehr/Polizei/AeND als externe Unterstuetzung.
- Karteneditor fuer Wachen, Fahrzeuge, Kliniken, Fremdwachen, Fremd-KH, POI und Einsatzgebiet.
- Einsatzeditor mit POI-Kategorien, Mehrfachauswahl und individuellen Patientenzustandsmeldungen.

## Hinweise

- Die Simulation ist noch im Aufbau. Balancing, Einsatzlogik und Rueckmeldungen koennen sich stark aendern.
- Karten- und Routingfunktionen haengen von erreichbaren externen Diensten ab.
- Die Standard-Admin-Zugangsdaten sind nur fuer lokale Entwicklung/Testbetrieb gedacht. Fuer andere Umgebungen `DISPATCH_ADMIN_PASSWORD` setzen.

## Rueckmeldungen und Fehlerberichte

Fehler oder Verbesserungsvorschlaege bitte ueber GitHub Issues melden. Besonders hilfreich sind Funkprotokolle, Uhrzeit, beteiligte Fahrzeuge, Einsatzart und beobachteter Fortschritt.

## Lizenz

Die Lizenzierung ist noch nicht final festgelegt. Nutzung und Weitergabe erfolgen derzeit nach Ruecksprache mit den Entwicklern.
