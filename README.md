# Leitstellen-Simulation

Browserbasierte Simulation einer integrierten Leitstelle mit Rettungsdienst, Feuerwehr, Polizei, Krankentransport, Funkstatus, Einsatzbearbeitung und Kartenlogik.

Das Projekt befindet sich in einer Alpha-Version und ist fuer Tests, Entwicklung und Balancing gedacht. Es ist nicht fuer produktive Leitstellenarbeit geeignet.

Dieses Projekt laeuft mit Unterstuetzung durch Codex.

## Changelog

### 0.4.6

- Krankenhausabmeldungen: Kliniken koennen sich zufaellig per quittierbarem 19222-Anruf ab- und wieder anmelden. Abgemeldete Kliniken werden dunkelrot dargestellt, gelten fuer die Zielauswahl als ungeeignet und koennen spaeter einen Folge-Transport ausloesen.
- Transportziel-Workflow: Offene Krankenhaus-Zuweisungen werden als eigener gelber Hinweis angezeigt, lassen Einsatzkarten blinken und zaehlen in den blinkenden Uebersichts-Badges wie Nachforderungen.
- OSM-Datenimport: Strassen, Verkehrsflaechen und Outdoor-Flaechen koennen aus OpenStreetMap importiert werden. Strassen werden nach Wohn-/Innerortsstrasse, ausserorts und Autobahn/Trunk klassifiziert.
- Einsatzorte: Wohnadressen, Strassenpool, Outdoor und zufaellige Punkte nutzen Reverse-Geocoding fuer die naechste Adresse. Definierte POI/Kliniken behalten ihren Namen.
- Karteneditor: Einsatzgebiete koennen aus mehreren Landkreis-/Stadtgrenzen aufgebaut werden, Gewichtungszonen liegen separat und OSM-Importe zeigen Fortschritt/Debug-Ansichten.
- Electron/Desktop: Lokale Nutzerdaten werden robuster mit gebuendelten Karten und Einsatzkatalogen abgeglichen. Legacy-`incidents-data.json` wurde entfernt, der dynamische Katalog ist massgeblich.
- UGRD/SEG und Hintergrundlogik: Mehrfachalarmierungen werden blockiert, Nichtausruecken sperrt die Gruppe temporaer, erfolgreiche Rueckmeldungen laufen ueber Funkstatus.
- Patienten-/Fahrzeuglogik: Reanimation, HvO/FR, ITW/ITH/VEF, ELRD und Nachforderungslogik wurden weiter stabilisiert.

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
- Einsatzannahme mit mehreren wartenden Anrufen, Einsatzbearbeitung, Nachalarmierung und Testbetrieb.
- Fahrzeugliste mit Status, Schichtlogik, Funkstatus und Sortierung nach Wache, Status, Typ oder Status + Typ.
- Karte mit Rettungswachen, Fremdwachen, Krankenhaeusern, Fremd-KH, POI, Einsatzstellen und Fahrzeugpositionen.
- OpenStreetMap/Esri-Kartenanzeige und OSRM-basierte Fahrzeiten mit Fahrzeugprofilen.
- Importierte OSM-Strassen-/Outdoor-Pools fuer realistischere Einsatzorte und Heimfahrtziele.
- Unterscheidung von SoSi/ohne SoSi bei Ausrueckzeit und Fahrt.
- Rettungsdienstlogik mit KTW, RTW, NEF, VEF, REF, RTH, ITW, ITH, ELRD, HvO und FR.
- Patientenversorgung mit dynamischem Zustand, variierender Behandlungsdauer, Fortschrittsanzeige, Mehrpatientenlagen und Krankenhauszuweisung.
- Transportzielauswahl nach Fachrichtung, optional mit Fremd-KH und Anzeige abgemeldeter Kliniken.
- Zufallsabmeldungen von Kliniken mit 19222-Anruf, Mindestabmeldezeit und Folge-Transporten bei Fehlzuweisung/Abmeldung.
- Krankentransporte mit Ziel-POI, Heimfahrtziel, planbaren Einsaetzen und Fahrzeit zum Ziel.
- Funkleiste mit Status 0/5, Sprechaufforderung und Rueckmeldungen.
- Status-8-Logik mit Rueckfrage "Einsatzklar?" und verzogener Freimeldung.
- Fremdwachen und Fremdfahrzeuge mit fahrzeugbezogener Verfuegbarkeitswahrscheinlichkeit und 15-Minuten-Neuwuerfelung.
- Fremdfahrzeuge koennen im Einsatzdialog bei Bedarf eingeblendet werden.
- Fremdwachen und Fremd-KH sind optisch abgesetzt.
- Feuerwehr/Polizei/AeND als externe Unterstuetzung.
- UGRD/SEG-Alarmierung mit Hintergrundfahrzeugen und Rueckmeldung, wenn eine Gruppe nicht ausrueckt.
- Karteneditor fuer Wachen, Fahrzeuge, Kliniken, Fremdwachen, Fremd-KH, POI, Einsatzgebiet und Gewichtungszonen.
- Import von Landkreis-/Stadtgrenzen fuer Einsatzgebiete und OSM-Datenimport fuer POI, Strassen und Outdoor-Flaechen.
- Einsatzeditor mit dynamischen Einsatzvarianten, POI-Kategorien, Mehrfachauswahl, Zeitfenstern, Gewichtung und individuellen Patientenzustandsmeldungen.
- Optionaler KI-Einsatzgenerator ueber OpenRouter API-Key. Der Key wird ueber Umgebung/Server bereitgestellt und soll nicht ins Repository.

## Fahrzeugtypen und Aufgaben

Die Simulation unterscheidet zwischen transportierenden Fahrzeugen, Notarztmitteln, Einsatzleitung und Ersthelfern. Einige Fahrzeuge koennen andere Anforderungen ersetzen, andere stabilisieren nur.

| Typ | Rolle in der Simulation | Kann behandeln / ersetzen |
| --- | --- | --- |
| KTW | Krankentransportwagen | KTP-Patienten, einfache Transporte und ambulante/niedrige Versorgung. Kann RTW-Patienten nicht vollstaendig versorgen. |
| RTW | Rettungswagen | Standardfahrzeug fuer Notfallpatienten. Kann KTW- und REF-Anforderungen ersetzen. |
| REF | Rettungseinsatzfahrzeug / First-Response-RD | Kann ambulante Patienten und REF-Patienten versorgen, aber nicht transportieren. Bleibt vor Ort, bis ein geeignetes Fahrzeug uebernimmt. |
| NEF | Notarzteinsatzfahrzeug | Notarztmittel ohne Transport. Erfuellt NEF-/VEF-Anforderungen und begleitet Transporte, wenn noetig. |
| VEF | Verlegungseinsatzfahrzeug | Wird wie ein NEF behandelt, vor allem fuer Sekundaer-/Verlegungseinsaetze gedacht. |
| RTH | Rettungshubschrauber | Luftrettungsmittel mit Notarzt. Kann NEF ersetzen und selbst transportieren. |
| ITW | Intensivtransportwagen | Transportfahrzeug mit Notarzt. Kann KTW, RTW, REF und NEF ersetzen. Wenn kein ITW zwingend benoetigt ist, fragt er nach, ob stattdessen die eigentlich vorgesehenen Mittel anfahren sollen. |
| ITH | Intensivtransporthubschrauber | Luftrettungsmittel fuer Intensivtransporte. Kann RTH/NEF-Funktionen uebernehmen und fuer explizite ITH-Patienten genutzt werden. |
| ELRD | Einsatzleiter Rettungsdienst | Keine regulaere Patientenversorgung. Er wird ab mehreren Patienten relevant und gibt Transportfreigaben/Koordination. |
| HvO | Helfer vor Ort | Behandelt nicht, reduziert aber die Zustandsverschlechterung bis Rettungsmittel eintreffen. |
| FR | First Responder | Wie HvO, typischerweise Feuerwehr/First-Responder-Logik. Behandelt nicht, stabilisiert nur. |

Fahrzeuge mit Notarztfunktion sind `NEF`, `VEF`, `RTH`, `ITH` und `ITW`. Transportfaehig sind `KTW`, `RTW`, `ITW`, `RTH` und `ITH`.

## Ersetzungslogik

Grundregeln:

- Ein `RTW` kann einen `KTW` und ein `REF` ersetzen.
- Ein `ITW` kann `KTW`, `RTW`, `REF`, `NEF` und `VEF` ersetzen.
- Ein `VEF`, `RTH`, `ITH` oder `ITW` kann eine `NEF`-Anforderung erfuellen.
- Ein `NEF`, `RTH`, `ITH` oder `ITW` kann eine `VEF`-Anforderung erfuellen.
- Ein `ITH` kann einen `RTH` ersetzen.
- Ambulante Patienten koennen in bestimmten Faellen auch durch ein Notarztmittel oder REF abgeschlossen werden, wenn kein Transport erforderlich ist.
- Reanimationspatienten erzwingen immer `RTW + NEF` und zwingende Notarztbegleitung. Rueckfragen "Transport ohne NEF" sind dort ausgeschlossen.
- Verstorbene Patienten benoetigen nur noch ein Notarztmittel zur Todesfeststellung, keinen RTW-Transport.

## Patientenlogik

Patienten haben neben dem Behandlungsfortschritt einen dynamischen Zustand. Dieser Zustand kann sich verschlechtern, solange nicht ausreichend geeignete Mittel vor Ort sind.

| Zustand | Startwert | Grundverschlechterung |
| --- | ---: | ---: |
| planbarer Krankentransport | 100% | 0% pro Minute |
| stabil | 60-100% | 0,6% pro Minute |
| potentiell kritisch | 30-60% | 0,8% pro Minute |
| kritisch | 1-30% | 1,0% pro Minute |
| Reanimation | 0% | eigener Reanimationstimer |

Wenn der Zustand auf 0% faellt, wird der Patient reanimationspflichtig. Eine Reanimation startet mit einer Ueberlebenschance zwischen 50% und 100%. Ohne passende Versorgung sinkt diese um 10% pro Minute.

Reduktion der Verschlechterung:

- Sind alle benoetigten Fahrzeuge am Patienten, faellt der Zustand nicht weiter.
- Ist irgendein Notarztmittel am Reanimationspatienten, faellt der Reanimationstimer nicht weiter.
- Bei Reanimation senkt ein RTW vor Ort den Reanimationsabfall auf 2,5% pro Minute.
- Bei Reanimation senkt ein anderes Rettungsmittel vor Ort den Abfall auf 5% pro Minute.
- Bei stabilen Patienten reduzieren REF/RTW bei fehlendem Notarzt die Verschlechterung um 75%, sonstige Rettungsmittel um 40%, HvO/FR um 20%.
- Bei potentiell kritischen Patienten reduzieren REF/RTW bei fehlendem Notarzt um 60%, sonstige Rettungsmittel um 30%, HvO/FR um 20%.
- Bei kritischen Patienten reduzieren REF/RTW bei fehlendem Notarzt um 50%, sonstige Rettungsmittel inklusive HvO/FR um 30%.

Weitere Regeln:

- REF-Patienten, die unter 60% fallen, werden automatisch zu RTW-Patienten.
- Ambulantwahrscheinlichkeiten werden bei potentiell kritischen Patienten halbiert und bei kritischen Patienten stark reduziert.
- Reanimationspatienten werden nicht ueber die normale Ambulantwahrscheinlichkeit abgeschlossen.
- Behandlungszeiten sind ungefaehr: KTP 15 Minuten, RTW-Notfall 25 Minuten, Notarzt-/arztbegleitete Einsaetze 30 Minuten, jeweils leicht variiert.

## Fahrzeiten und Routing

Die Fahrzeit basiert nach Moeglichkeit auf OSRM-Routing und wird lokal mit Fahrzeugfaktoren angepasst. Wenn Routing nicht erreichbar ist, nutzt die Simulation Fallback-Werte.

| Typ | Ohne SoSi | Mit SoSi |
| --- | --- | --- |
| KTW | Faktor 1,0 | 1,3x schneller |
| RTW | Faktor 0,9, max. 80 km/h | 1,2x schneller, max. 130 km/h |
| ITW | Faktor 0,9, max. 80 km/h | 1,1x schneller, max. 110 km/h |
| NEF/VEF/REF/ELRD | Faktor 1,0 | 1,4x schneller |
| RTH/ITH | direkte Luftlinie, ca. 180-200 km/h |

Zusaetzlich gibt es einen globalen Geschwindigkeitsaufschlag fuer die Simulation. Ohne Sondersignal verlaengert sich ausserdem die Ausrueckzeit.

## Hinweise

- Die Simulation ist noch im Aufbau. Balancing, Einsatzlogik und Rueckmeldungen koennen sich stark aendern.
- Karten- und Routingfunktionen haengen von erreichbaren externen Diensten ab.
- Die Standard-Admin-Zugangsdaten sind nur fuer lokale Entwicklung/Testbetrieb gedacht. Fuer andere Umgebungen `DISPATCH_ADMIN_PASSWORD` setzen.

## Rueckmeldungen und Fehlerberichte

Fehler oder Verbesserungsvorschlaege bitte ueber GitHub Issues melden. Besonders hilfreich sind Funkprotokolle, Uhrzeit, beteiligte Fahrzeuge, Einsatzart und beobachteter Fortschritt.

## Lizenz

Die Lizenzierung ist noch nicht final festgelegt. Nutzung und Weitergabe erfolgen derzeit nach Ruecksprache mit den Entwicklern.
