(function () {
  const firstNames = [
    "Anna", "Anton", "Anja", "Andreas", "Bettina", "Bernd", "Birgit", "Benedikt", "Carina", "Christian",
    "Claudia", "Clemens", "Daniela", "Daniel", "Doris", "Dominik", "Eva", "Erik", "Elisabeth", "Emil",
    "Franziska", "Florian", "Frieda", "Felix", "Gabriele", "Gerhard", "Greta", "Gregor", "Hannah", "Hans",
    "Helene", "Hannes", "Ines", "Isabell", "Ingrid", "Jonas", "Julia", "Johann", "Jana", "Jakob",
    "Katharina", "Karl", "Kerstin", "Konrad", "Laura", "Lukas", "Leonie", "Lorenz", "Maria", "Martin",
    "Marlene", "Matthias", "Monika", "Maximilian", "Nadine", "Niklas", "Nora", "Norbert", "Olivia", "Oliver",
    "Petra", "Peter", "Paula", "Paul", "Ramona", "Robert", "Rosa", "Rainer", "Sabine", "Stefan",
    "Sandra", "Sebastian", "Sofia", "Simon", "Theresa", "Thomas", "Tanja", "Tobias", "Ulrike", "Uwe",
    "Verena", "Viktor", "Valentina", "Vincent", "Waltraud", "Werner", "Yvonne", "Yannik", "Amelie", "Armin",
    "Bianca", "Bruno", "Christina", "Christoph", "Diana", "David", "Elena", "Elias", "Fabienne", "Fabian",
    "Gertrud", "Georg", "Heidi", "Heinrich", "Irina", "Jan", "Josefine", "Josef", "Karin", "Kilian",
    "Luisa", "Leonhard", "Magdalena", "Michael", "Nicole", "Noah", "Patricia", "Philipp", "Rebecca", "Rudolf",
    "Selina", "Sven", "Ursula", "Vera", "Wilhelm", "Xaver"
  ];

  const lastNames = [
    "Abele", "Ackermann", "Adler", "Albrecht", "Bach", "Bauer", "Baumann", "Beck", "Bergmann", "Binder",
    "Bischof", "Brandl", "Braun", "Breuer", "Brunner", "Buchner", "Burger", "Dietrich", "Drexler", "Eberl",
    "Eckert", "Engel", "Fischer", "Frank", "Franke", "Friedl", "Fuchs", "Geiger", "Graf", "Gruber",
    "Haag", "Haas", "Hahn", "Hartl", "Hecht", "Heinrich", "Heller", "Hermann", "Hoffmann", "Huber",
    "Jahn", "Jung", "Kaiser", "Keller", "Kern", "Kirchner", "Klein", "Klinger", "Koch", "Koenig",
    "Kraus", "Krause", "Kreuzer", "Lang", "Langer", "Lehner", "Lechner", "Lorenz", "Maier", "Mayer",
    "Meier", "Meyer", "Merkel", "Metzger", "Miller", "Moeller", "Mueller", "Neubauer", "Neumann", "Niedermeier",
    "Obermeier", "Ott", "Pfeiffer", "Pohl", "Preiss", "Reichl", "Reiter", "Richter", "Riedl", "Roth",
    "Sailer", "Schaefer", "Schaller", "Schenk", "Schmid", "Schmidt", "Schneider", "Scholz", "Schreiber", "Schroeder",
    "Schubert", "Schulz", "Schuster", "Schwarz", "Seidel", "Seitz", "Sommer", "Stadler", "Stein", "Steiner",
    "Strobl", "Thoma", "Unger", "Vogel", "Vogt", "Wagner", "Walter", "Weber", "Weigl", "Weiss",
    "Wimmer", "Winter", "Wirth", "Wolf", "Wolff", "Wunderlich", "Ziegler", "Zimmermann", "Bachmeier", "Baier",
    "Brandner", "Eichinger", "Forster", "Goetz", "Hirsch", "Kammerer", "Koller", "Kroner", "Lindner", "Moser",
    "Pichler", "Rieger", "Schreiner", "Spangler", "Stahl", "Weinberger", "Wenisch", "Wittmann", "Zeller", "Dobler"
  ];

  const femaleFirstNames = [
    "Anna", "Anja", "Bettina", "Birgit", "Carina", "Claudia", "Daniela", "Doris", "Eva", "Elisabeth",
    "Franziska", "Frieda", "Gabriele", "Greta", "Hannah", "Helene", "Ines", "Isabell", "Ingrid", "Julia",
    "Jana", "Katharina", "Kerstin", "Laura", "Leonie", "Maria", "Marlene", "Monika", "Nadine", "Nora",
    "Olivia", "Petra", "Paula", "Ramona", "Rosa", "Sabine", "Sandra", "Sofia", "Theresa", "Tanja",
    "Ulrike", "Verena", "Valentina", "Waltraud", "Yvonne", "Amelie", "Bianca", "Christina", "Diana",
    "Elena", "Fabienne", "Gertrud", "Heidi", "Irina", "Josefine", "Karin", "Luisa", "Magdalena",
    "Nicole", "Patricia", "Rebecca", "Selina", "Ursula", "Vera"
  ];

  const maleFirstNames = [
    "Anton", "Andreas", "Bernd", "Benedikt", "Christian", "Clemens", "Daniel", "Dominik", "Erik", "Emil",
    "Florian", "Felix", "Gerhard", "Gregor", "Hans", "Hannes", "Jonas", "Johann", "Jakob", "Karl",
    "Konrad", "Lukas", "Lorenz", "Martin", "Matthias", "Maximilian", "Niklas", "Norbert", "Oliver",
    "Peter", "Paul", "Robert", "Rainer", "Stefan", "Sebastian", "Simon", "Thomas", "Tobias", "Uwe",
    "Viktor", "Vincent", "Werner", "Yannik", "Armin", "Bruno", "Christoph", "David", "Elias", "Fabian",
    "Georg", "Heinrich", "Jan", "Josef", "Kilian", "Leonhard", "Michael", "Noah", "Philipp", "Rudolf",
    "Sven", "Wilhelm", "Xaver"
  ];

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomFirstName() {
    return pick(firstNames);
  }

  function randomFemaleFirstName() {
    return pick(femaleFirstNames);
  }

  function randomMaleFirstName() {
    return pick(maleFirstNames);
  }

  function randomTitledLastName() {
    return `${Math.random() < .5 ? "Frau" : "Herr"} ${pick(lastNames)}`;
  }

  function randomTitledLastNameForGender(gender) {
    return `${gender === "female" ? "Frau" : "Herr"} ${pick(lastNames)}`;
  }

  function randomName() {
    return Math.random() < .5 ? randomFirstName() : randomTitledLastName();
  }

  function applyDynamicNamePlaceholders(value) {
    if (value === null || value === undefined) return value;
    return String(value).replace(/\*(F_Vorname|H_Vorname|F_Nachname|H_Nachname|Vorname|Nachname|Name)\*/gi, (_match, token) => {
      const key = String(token).toLowerCase();
      if (key === "f_vorname") return randomFemaleFirstName();
      if (key === "h_vorname") return randomMaleFirstName();
      if (key === "f_nachname") return randomTitledLastNameForGender("female");
      if (key === "h_nachname") return randomTitledLastNameForGender("male");
      if (key === "vorname") return randomFirstName();
      if (key === "nachname") return randomTitledLastName();
      return randomName();
    });
  }

  function applyDynamicNamePlaceholdersToIncidentTemplate(template) {
    if (!template || typeof template !== "object") return template;
    const next = { ...template };
    ["callerName", "callerText", "report", "situationReport", "note"].forEach((key) => {
      if (typeof next[key] === "string") next[key] = applyDynamicNamePlaceholders(next[key]);
    });
    if (Array.isArray(next.patients)) {
      next.patients = next.patients.map((patient) => {
        if (!patient || typeof patient !== "object") return patient;
        const nextPatient = { ...patient };
        ["conditionReport", "noTransportText", "label"].forEach((key) => {
          if (typeof nextPatient[key] === "string") nextPatient[key] = applyDynamicNamePlaceholders(nextPatient[key]);
        });
        return nextPatient;
      });
    }
    return next;
  }

  window.dynamicNameCatalog = { firstNames, femaleFirstNames, maleFirstNames, lastNames };
  window.applyDynamicNamePlaceholders = applyDynamicNamePlaceholders;
  window.applyDynamicNamePlaceholdersToIncidentTemplate = applyDynamicNamePlaceholdersToIncidentTemplate;
})();
