# Mod-Schnittstelle v1

Die normale Schicht funktioniert mit leerem Mod-Ordner. Ein kompatibles Paket lässt sich je ILS für die nächste Schicht aktivieren. Mods mit eigenem Einsatzkatalog werden im Karteneditor eingestellt, weitere Pakete auf dem Startbildschirm. Während der Schicht öffnen sich Mod-Ansichten über das Schichtmenü oder den zugehörigen Einsatz.

Mit `"incidentPanelOnly": true` im Manifest öffnet die Haupt-App die Ansicht ausschließlich aus einem Einsatz dieses Mods. Manuelle Katalogfälle mit Auslösegewicht 0 lassen sich im lokalen Advanced Admin als Anruf auslösen.

- Beim Start über `node server.mjs` liegt der Ordner im Projekt unter `mods/`.
- Electron liefert MANV mit. Zusätzliche lokale Mods liegen unter `Dokumente/LSTSIM/mods`. Ist dieselbe Mod-ID lokal und mitgeliefert vorhanden, gewinnt bei numerischen Versionsnummern die neuere kompatible Fassung. Bei gleicher Versionsnummer verwendet Electron die lokale Fassung. Eigene Karten und gespeicherte Einsatzkataloge bleiben im Benutzerprofil.
- Für einen eigenen Server lässt sich der Pfad mit `DISPATCH_MODS_DIR` setzen. Aktivierung und Mod-Daten werden getrennt vom Programm und den Mod-Dateien im jeweiligen Server- bzw. App-Profil gespeichert.

## Paket

Ein Paket ist ein Unterordner mit genau einer `manifest.json` und einem Einstiegspunkt `main.mjs`. Ordner und Manifest-ID müssen übereinstimmen. Die ID beginnt mit einem Kleinbuchstaben oder einer Ziffer und erlaubt außerdem Bindestriche und Unterstriche.

```json
{"id":"beispiel","name":"Beispiel","version":"1.0.0","apiVersion":1}
```

`main.mjs` exportiert eine Standardfunktion, beispielsweise `export default function (api) { api.root.textContent = "Bereit"; }`. Der Einstiegspunkt muss eigenständig gebündelt sein. Oberfläche und Code laufen in einem isolierten Frame. `api.root` ist der DOM-Knoten für die Ansicht. `api.version` enthält die Schnittstellenversion. Kompatible Pakete können beim Seitenstart geladen werden. Ein Fehler im Einstiegspunkt wird im Telefonprotokoll angezeigt, während die Schicht normal startet.

## Einsatzkatalog und Karteneditor

Ein Mod mit `"scenarioCatalog": true` im Manifest erhält einen eigenen Katalog im Einsatzeditor. Für den vorgesehenen Mod mit ID `manv` sind der Katalog und die Kartenfelder bereits verfügbar. Der Einsatzeditor speichert Mod-Einsätze in `mod-catalogs/<mod-id>.json` im Server- bzw. App-Profil. Dieser Katalog ist unabhängig von `incidents-dynamic.json`.

Im Karteneditor unter **Karte → Mod-Einsatzintervalle** liegt die Aktivierung je ILS. Vier Werte geben die Wahrscheinlichkeit von 0 bis 100 Prozent für jeweils einen Einsatz pro Block an. Die Blöcke sind 00–06, 06–12, 12–18 und 18–24 Uhr. Neue Einstellungen beginnen bei 0 %. Innerhalb eines erfolgreichen Blocks wird ein Zeitpunkt gewählt. Bei späterem Schichtbeginn werden vergangene Zeitpunkte übersprungen. Es werden verfügbare Katalogeinträge entsprechend Gewicht und eigenen Zeitfenstern ausgewählt. Im Testbetrieb bleiben automatische Auslösungen aus.

Fehlt ein aktivierter Mod, ist er inkompatibel oder schlägt sein Start fehl, führt die Haupt-App die Schicht regulär fort und schreibt einen Hinweis ins Telefonprotokoll. Kartenkonfiguration und Mod-Katalog bleiben gespeichert.

### Eigene Editorfelder

Im Manifest enthält `editor.scenario` die Felder für den Einsatzeditor und `editor.map` die Felder unter **Karte → Mod-Einsatzintervalle**. Der Einsatzeditor speichert die Werte in `modData`. Im laufenden Einsatz stehen sie unter `incident.created.scenario.data` bereit. Der Karteneditor speichert sie in `modScenarios[modId].data`. Der Mod liest sie über `state.get.centerConfig.data`.

```json
{
  "editor": {
    "scenario": [
      {"key":"count","label":"Anzahl","type":"number","min":1,"max":250,"step":1,"default":8,"required":true},
      {"key":"mix","label":"Verteilung","type":"weights","total":100,"options":[{"value":"a","label":"Gruppe A"},{"value":"b","label":"Gruppe B"}],"default":{"a":60,"b":40}},
      {"key":"departments","label":"Fachrichtungen","type":"weights","source":"departments"}
    ],
    "map": [
      {"key":"quotas","label":"Klinikquoten","type":"weights","source":"hospitals","total":100}
    ]
  }
}
```

Weitere Feldtypen sind `text`, `boolean` und `select`. Bei einer Auswahl stehen die Einträge in `options` als `{value,label}`. Gewichtsfelder können feste Optionen sowie die vorhandenen Fachrichtungen oder die Kliniken der gerade bearbeiteten Karte verwenden. `total` ist optional und legt eine feste Sollsumme fest. Die Haupt-App rendert das Schema. Der Mod legt Bedeutung, Standardwerte und Einsatzregeln fest.

Führungsressourcen lassen sich im Karteneditor bei Wachen und Gruppen unter den Typen `LNA`, `ORGL` und `UG-SANEL` anlegen. Sie haben eigene Fahrzeug-IDs. Die Mod-Schnittstelle unterstützt dieselben Alarmierungs- und Ankunftsereignisse wie bei anderen Fahrzeugen.

## Befehle

`await api.command(name, args)` liefert das Ergebnis oder wirft einen Fehler. Vor der Meldung `shift.started` steht nur `state.get` zur Verfügung. Alle anderen Befehle laufen innerhalb der aktiven Schicht.

| Befehl | Argumente und Wirkung |
| --- | --- |
| `state.get` | Liefert Uhr, Fahrzeuge, Gruppen, Kliniken, die Kartenkonfiguration unter `centerConfig` und die Einsätze des eigenen Mods. |
| `clock.after`, `clock.cancel` | `timerId` und beim Anlegen `seconds`, optional `incidentId`. Sendet einmalig `clock.timer` mit `timerId`, `incidentId` und `second`. Termine folgen Pause und Geschwindigkeit. Die Zeit unter `state.get.second` läuft in Simulationssekunden seit Mitternacht des Starttags. |
| `storage.get`, `storage.set` | Liest bzw. schreibt `value` als JSON je Mod und ILS. |
| `call.queue` | `scenarioId`, `keyword`, `callerText` sowie optional `callerName`, `type` (`emergency` oder `transport`), `lat` und `lng`, `location`, `required` (Fahrzeugtypen), `signal`. Liefert die Anruf-ID. Der Einsatz wird über die normale Notrufannahme angelegt. |
| `scenario.list`, `call.queueScenario` | Liest den eigenen Mod-Katalog. Mit `scenarioId` kann der Mod einen vorhandenen Eintrag gezielt als Anruf einreihen. |
| `incident.requirements` | `incidentId`, `required`. Setzt den gewünschten Fahrzeugbedarf. Die Standard-ELRD-Automatik läuft für diese Einsätze nicht. |
| `incident.patientCount` | `incidentId`, `count`. Meldet die bestätigte Gesamtzahl für die Einsatzliste, unabhängig von den bereits im Host registrierten Patienten. |
| `incident.attention` | `incidentId`, `items`, optional `openClinicTargets`. Zeigt fachlichen Handlungsbedarf an. Offene Klinikziele haben einen eigenen Eintrag im Handlungsbedarf und markieren die Einsatzkarte pulsierend. |
| `patient.add` | `incidentId`, `patientId` sowie optional `label`, `required`, `departments`, `report`, `transportNeeded`. Ist die Lage unklar, kann der Einsatz zunächst ohne Patienten starten. |
| `patient.update` | Ändert dieselben Felder bei einem bestehenden Patienten vor dem Transport. Bestehende Fahrzeugzuordnungen bleiben erhalten. |
| `patient.assign` | `incidentId`, `patientId`, `vehicleId`. Verknüpft ein Fahrzeug am Einsatzort mit einem offenen Patienten. Optional `carrier: true` autorisiert dieses Transportfahrzeug für den Patienten, etwa bei einer vom Mod geprüften Ersatzzuteilung. |
| `patient.complete` | `incidentId`, `patientId`, optional `reason`. Schließt einen Patienten ohne Transport ab. Bei `deferClearance: true` entscheidet der Mod anschließend über die Freimeldung. |
| `vehicle.alarm`, `vehicle.release` | `incidentId`, `vehicleId`, bei Freigabe optional `reason`. Verwendet die bestehenden Alarmierungs- und Freimeldeabläufe. Mit `automatic: true` wird eine offene Freimeldung nach einer Simulationsminute automatisch bestätigt. |
| `vehicle.role` | `incidentId`, `vehicleId`, `role`. Reserviert ein freies Fahrzeug am Einsatzort für eine vom Mod bestimmte Rolle. `role: null` gibt die Rolle wieder frei. |
| `group.alarm`, `group.release` | `incidentId`, `groupId`. Alarmiert eine Komponente für genau einen Einsatz oder gibt sie zurück. Bei einer Zusage weist der Host die Fahrzeuge direkt zu. Im Snapshot enthält jede Gruppe ihren Typ unter `kind`. |
| `incident.disposition` | `incidentId`. Öffnet die Disposition für den Einsatz. `supportGroups: true` blendet die SEG-/UGRD-Komponenten direkt ein. |
| `radio.log` | `incidentId`, `message`, optional `level` (`radio`, `warn`, `urgent`). Protokolliert eine Meldung beim zugehörigen Einsatz. |
| `vehicle.report` | `incidentId`, `vehicleId`, `code` (0 oder 5), `message`. Setzt einen Sprechwunsch eines Fahrzeugs vor Ort. Bei Status 5 kann `openPanel: true` nach J die Einsatzansicht des Mods öffnen. Liefert `false`, wenn das Fahrzeug bereits im Funk gebunden ist. |
| `hospital.hold`, `hospital.release` | `incidentId`, `hospitalId`, beim Beginn zusätzlich `readyAfterSeconds`. Verhindert sofort neue reguläre Abmeldungen und schaltet die Klinik nach der gewählten Simulationsdauer auf aufnahmebereit. Die Bereitschaft gilt bis zur letzten Freigabe. `hospital.release` ohne Klinik-ID gibt alle Sperren des Einsatzes frei. Der Einsatzabschluss tut dies automatisch. |
| `transport.request`, `transport.start` | `incidentId`, `patientId`, `vehicleId`, optional `signal`. `transport.request` öffnet den regulären Zielzuweisungsablauf per Funk. `transport.start` nimmt zusätzlich `hospitalId` und optional `transportId` sowie `escortVehicleId`. Die Begleitung bleibt bis zur Übergabe gebunden. Eine Transport-ID kann je Einsatz einmal verwendet werden. |
| `transport.retarget` | `incidentId`, `vehicleId`, `transportId`, `hospitalId`. Ändert das Ziel des laufenden Auftrags. Die Auftrags-ID, die Begleitung und die Anfragen anderer Fahrzeuge bleiben erhalten. |
| `incident.close` | `incidentId`. Schließt die Lage nach Abschluss aller Patienten und Transporte. Mit `cancelPendingResponses: true` zieht der Host noch wartende oder anfahrende Fahrzeuge zurück. |

`api.onEvent((event, payload) => { … })` liefert `shift.started`, `clock.minute`, `clock.timer`, `panel.opened`, `incident.created`, `incident.closed`, `vehicle.alarmed`, `vehicle.departed`, `vehicle.arrived`, `vehicle.reportAnswered`, `group.unitAvailable`, `group.unavailable`, `hospital.ready`, `transport.started`, `transport.destinationRequested`, `transport.retargeted`, `transport.arrived` und `transport.handover`. Einsatzereignisse enthalten `incidentId` und gehen ausschließlich an den zuständigen Mod. Transportereignisse enthalten `transportId`, `vehicleId` und `patientId`. Die Ankunft setzt Status 8, das Ende der Übergabe ist ein eigener Schritt. Der Rückgabewert von `onEvent` meldet einen Listener wieder ab.

In v1 übernimmt das Modul eigene Anrufe und zeitgesteuerte Fälle aus seinem Katalog. Bei einem Katalogeinsatz enthält `incident.created` unter `scenario` die gewählte Variante mit den vorbereiteten Patienten und Lagemeldungen. Der Mod entscheidet, welche Patienten er wann in die Simulation übernimmt. Eine Hochstufung eines bereits laufenden Standardeinsatzes braucht einen zusätzlichen, ausdrücklichen Übergabepunkt. Die Haupt-App bleibt für Fahrzeuge, Fahrten und Übergaben zuständig. Fachliche Abläufe und automatische Nachforderungen für eigene Einsätze steuert der Mod.

## Mitgelieferte Szenarien und Disposition

Die optionale Datei `scenarios.json` im Mod-Ordner liefert den Startkatalog. Sobald ein lokaler Katalog gespeichert wird, hat er Vorrang. Das gilt auch für einen lokal geleerten Katalog.

Ein Manifest kann unter `scenarioResources` Erstbedarf als Liste von Regeln hinterlegen. Jede Regel enthält `types` mit Fahrzeugtypen und optional `field` mit dem Schlüssel eines booleschen Szenariofeldes. Ohne Feld gilt die Regel immer. Bei einem Feld greift die Regel bis zur ausdrücklichen Deaktivierung. Damit steht der Bedarf vor der Einsatzanlage bereits im Dispositionsdialog. `call.locationLabel` in einem Katalogeintrag kann einen festen Anzeigenamen für einen variabel platzierten Ort setzen.

`incident.attention` setzt mit `items` eine Liste kurzer Aufgaben für die Einsatzliste und den Handlungsbedarf. Eine leere Liste räumt die Aufgaben ab. `service.arrived` meldet das Eintreffen von FW oder POL. Der aktuelle Stand beider Dienste steht auch unter `state.get.incidents[].services`.
