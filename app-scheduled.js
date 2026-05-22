function createScheduledIncidentFromRate() {
  const plan = scheduledTransportPlan();
  if (!plan) return false;
  const incident = createIncident({
    id: makeId(),
    type: "scheduled",
    keyword: plan.keyword,
    title: plan.keyword,
    location: plan.origin.label,
    lat: plan.origin.lat,
    lng: plan.origin.lng,
    callerName: "Planbarer Krankentransport",
    callerText: plan.description,
    report: plan.description,
    situationReport: plan.description,
    required: ["KTW"],
    signal: false,
    patientCount: 1,
    transportNeeded: true,
    fixedDestinationId: plan.fixedDestinationId || null,
    fixedDestination: plan.fixedDestination || null
  });
  incident.status = "offen";
  reverseGeocodeScheduledIncidentOrigin(incident);
  renderAll();
  return true;
}

function scheduledTransportPlan() {
  const hour = Math.floor((state.minute % 1440) / 60);
  const localHospitals = localScheduledHospitals();
  const practices = poiByCategories(["practice"]);
  const dentalPractices = poiByCategories(["dentist"]);
  const dialysis = poiByCategories(["dialysis"]);
  const medicalPractices = [...practices, ...dentalPractices];
  const candidates = [];

  if (medicalPractices.length && localHospitals.length) {
    candidates.push(() => {
      const origin = randomItem(medicalPractices);
      const destination = weightedLocationChoice(localHospitals, origin);
      return scheduledPlan(
        "RD KTP - Transport zum Krankenhaus",
        origin,
        { fixedDestinationId: destination.id },
        `${origin.label} nach ${destination.label}`
      );
    });
  }

  if (localHospitals.length >= 2) {
    candidates.push(() => {
      const origin = randomItem(localHospitals);
      const destination = randomItem(localHospitals.filter((hospital) => hospital.id !== origin.id));
      return scheduledPlan(
        "RD KTP - Verlegung",
        origin,
        { fixedDestinationId: destination.id },
        `${origin.label} nach ${destination.label}`
      );
    });
  }

  if (hour >= 6 && hour < 22 && dialysis.length) {
    candidates.push(() => {
      const origin = randomScheduledAddress();
      const destination = randomItem(dialysis);
      return scheduledPlan(
        "RD KTP - Dialyse",
        origin,
        { fixedDestination: destinationPoint(destination) },
        `${origin.label} zur Dialyse ${destination.label}`
      );
    });
  }

  if (hour >= 8 && hour < 18 && medicalPractices.length) {
    candidates.push(() => {
      const origin = randomScheduledAddress();
      const destination = randomItem(medicalPractices);
      const target = destination.categories?.includes("dentist") ? "Zahnarztpraxis" : "Arztpraxis";
      return scheduledPlan(
        "RD KTP - Ambulanzfahrt",
        origin,
        { fixedDestination: destinationPoint(destination) },
        `${origin.label} zur ${target} ${destination.label}`
      );
    });
  }

  if (localHospitals.length) {
    candidates.push(() => {
      const origin = randomItem(localHospitals);
      const destination = randomHomeDestinationNear(origin);
      return scheduledPlan(
        Math.random() < 0.75 ? "RD KTP - Heimfahrt" : "RD KTP - Ambulanzfahrt",
        origin,
        { fixedDestination: destination },
        `${origin.label} nach Hause`
      );
    });
  }

  return candidates.length ? randomItem(candidates)() : null;
}

function scheduledPlan(keyword, origin, destination, description) {
  return {
    keyword,
    origin: destinationPoint(origin),
    description,
    ...destination
  };
}

function localScheduledHospitals() {
  return (state.center.hospitals || [])
    .filter((hospital) => !hospital.foreign && Number.isFinite(hospital.lat) && Number.isFinite(hospital.lng));
}

function poiByCategories(categories) {
  const wanted = new Set(categories);
  return (state.center.poi || [])
    .filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .filter((poi) => (poi.categories || []).some((category) => wanted.has(category)));
}

function randomScheduledAddress(fallback = "Adresse im Einsatzgebiet") {
  const point = randomPointInCoverage();
  return {
    id: makeId(`scheduled-address-${state.absoluteMinute}-${Math.random()}`),
    label: point.label && point.label !== defaultLocationLabel() ? point.label : fallback,
    address: point.label || fallback,
    lat: point.lat,
    lng: point.lng
  };
}

function destinationPoint(point) {
  return {
    id: point.id,
    label: point.label || point.address || "Zielort",
    address: point.address || point.label || "Zielort",
    lat: point.lat,
    lng: point.lng,
    type: point.type || ((point.categories || []).includes("hospital") ? "hospital" : "destination"),
    categories: point.categories || []
  };
}

async function reverseGeocodeScheduledIncidentOrigin(incident) {
  if (!incident || !window.fetch) return;
  if (String(incident.location || "").includes("Einsatzgebiet")) {
    const label = await reverseGeocodeScheduledPoint(incident.lat, incident.lng);
    if (label) incident.location = label;
  }
  const destination = incident.patient?.fixedDestination;
  if (destination && String(destination.label || "").includes("Einsatzgebiet")) {
    const label = await reverseGeocodeScheduledPoint(destination.lat, destination.lng);
    if (label) {
      destination.label = label;
      destination.address = label;
    }
  }
  renderIncidents();
}

async function reverseGeocodeScheduledPoint(lat, lng) {
  try {
    const response = await fetch(reverseGeocodeUrl(lat, lng), { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return formatGeocodeAddress(await response.json());
  } catch {
    return null;
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}
