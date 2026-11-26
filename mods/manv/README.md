# MANV-Übersicht

Electron liefert MANV ab Version 0.5.4 mit. Beim Browserstart aus dem Projekt liegt das Paket unter `mods/manv`. Eigene kompatible Fassungen können unter `Dokumente/LSTSIM/mods/manv` installiert werden. Bei numerischen Versionsnummern gewinnt die neuere Fassung, bei Gleichstand die lokale Kopie. Ein im Einsatzeditor gespeicherter lokaler MANV-Katalog hat weiterhin Vorrang.

1. Im Karteneditor unter **Karte → Mod-Einsatzintervalle** MANV für die gewünschte ILS aktivieren und die Karte speichern. In der mitgelieferten Stadt-Testkarte ist MANV bereits aktiviert.
2. Eine neue Schicht starten und im Schichtmenü den lokalen **Advanced Admin** öffnen. Falls nötig, vorher den Admin-Modus aktivieren.
3. **Übung · MANV nach Busunfall** (Sollwert 8 Patienten) oder **Übung · Amoklage an einer Schule** auswählen. Den 112-Anruf annehmen, den Einsatz anlegen und in der Einsatzliste **MANV-Übersicht öffnen** wählen. Beide Übungen haben Auslösegewicht 0.
4. RTW, NEF und Führungsmittel disponieren. FW und POL sind im Anruf bereits ausgewählt. In der Fahrzeugauswahl lassen sich **SEG / UGRD** einblenden und mit disponieren. Im MANV-Fenster stehen Klinik-Alarm und Klinikzuweisung zur Verfügung.
5. In der Karte **ILS Regensburg (Testversion Stadt Regensburg)** stehen zusätzlich Übungs-RTW, -KTW, -NEF und Führungsmittel bereit. Die UGRD-/SEG-Übungswache stellt fünf SEG-Transport, eine SEG-Behandlung und eine UG SanEL. Mit **Freie Klinikziele zuweisen** lassen sich mehrere transportbereite Patienten in einem Schritt passenden Kliniken zuweisen.

## Schulübung

Die Schule ist fiktiv. Der Fall verwendet **40 Verletzte und 35 % SK I, 25 % SK II, 40 % SK III** als Sollwerte. Jeder Start zieht 34–46 Patienten und variiert die Anteile um bis zu fünf Prozentpunkte. Sichtung und Zustand können die Verteilung im Verlauf weiter ändern. Der Katalogeintrag hat Auslösegewicht 0 und ist gezielt im lokalen Advanced Admin startbar. Normale MANV-Einträge verwenden die im Karteneditor eingestellten Sechs-Stunden-Blöcke. Eigene Änderungen werden im separaten lokalen MANV-Katalog gespeichert.

SEG-Behandlung umfasst einen GW-SAN, SEG-Transport zwei KTW und UG SanEL ein Führungsfahrzeug. Die Ausrückwahrscheinlichkeit gilt für die gesamte Komponente. Ohne aktiven MANV-Mod bleiben SEG-Behandlung, UG SanEL, LNA und OrgL in der Schicht deaktiviert. SEG-Transport stellt weiterhin zwei KTW für reguläre Einsätze.

Die Versorgung funktioniert mit normalen Fahrzeugen und den tatsächlichen Kliniken der gewählten ILS. Für den Test werden Kliniken mit Unfallchirurgie und Innerer Medizin benötigt, darunter mindestens eine mit Pädiatrie und dem passenden Fachgebiet. Für einzelne abweichende Bedarfe kann Psychiatrie nötig sein. Fehlt ein geeigneter Standort, bleibt die Zielzuweisung als Aufgabe offen.

Unter **Automatische Klinikzuweisung** lassen sich im MANV-Fenster Quoten pro Einsatz eintragen. Sie müssen zusammen 100 % ergeben. Einschalten lässt sich die Automatik, sobald LNA und OrgL vor Ort sind. Ist eine der beiden Funktionen nicht mehr vor Ort, schaltet sich die Automatik aus. Die Quote wird unter den geeigneten, aufnahmebereiten Kliniken mit mehr als 0 % angewandt.

## Spielbalance

Bei variablen MANV beträgt die Abweichung bis zu 15 % bei der Anzahl und bis zu 5 Prozentpunkte pro Sichtungskategorie. Alter wird pro Patient unabhängig mit 10 % Kinderanteil gezogen.

Die zufällige Verschlechterung entspricht ohne Entlastung 12,5 % in 30 Minuten Wartezeit, die Verbesserung 2 %. Eine eingetroffene SEG-Behandlungseinheit deckt für den Risikopuffer fünf Wartende ab. Die SEG senkt das Verschlechterungsrisiko um bis zu 50 %, LNA und OrgL senken es standardmäßig nochmals um 25 %. Bei der ärztlichen Sichtung können 6 % der noch unversorgten roten Patienten blau eingestuft werden. Die Sterbeprüfung läuft davon unabhängig gemäß MANV-Plan. Die Übergabe von Rot an RTW beendet dieses laufende Risiko, Blau behält es bis zum Ende der Transportvorbereitung.
