const initialCategories = ["red", "yellow", "green"];
const priority = ["red", "blue", "yellow", "green"];
const categoryLabel = { red: "SK I · Rot", yellow: "SK II · Gelb", green: "SK III · Grün", blue: "SK IV · Blau", dead: "Verstorben" };
const departments = {
  trauma: "Unfallchirurgie", internal: "Innere Medizin", pediatrics: "Pädiatrie", cardiology: "Kardiologie",
  neurology: "Neurologie", psychiatry: "Psychiatrie", icu: "Intensivmedizin", stroke: "Stroke Unit",
  obstetrics: "Geburtshilfe", gynecology: "Gynäkologie", ophthalmology: "Augenheilkunde", radiotherapy: "Strahlentherapie"
};
const leaders = { ELRD: "ELRD", LNA: "Leitender Notarzt", ORGL: "Organisatorischer Leiter", "UG-SANEL": "UG SanEL" };
const roles = { scene: "Vorläufige Einsatzleitung", medical: "Vorläufige ärztliche Leitung", screen: "Vorsichtung", doctor: "Ärztliche Sichtung", treatment: "SEG Behandlung" };
const phaseLabel = { waiting: "Wartet", preparing: "Transportvorbereitung", ready: "Transportbereit", driving: "Auf Transport", handover: "Übergabe", done: "Übergeben", dead: "Verstorben" };
const clinicReminderSeconds = 10 * 60;
const isDoctor = ({ type }) => ["NEF", "VEF"].includes(type);
const isAirTransport = ({ type }) => ["RTH", "ITH"].includes(type);
const isFree = (unit) => !unit.patientId && !unit.role && !unit.transportId && !unit.radioBusy && !unit.clearPending;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const int = (min, max, random) => min + Math.floor(random() * (max - min + 1));
const terminal = (patient) => ["done", "dead"].includes(patient.phase);
const sortByPriority = (a, b) => (priority.indexOf(a.category) + 5) % 5 - (priority.indexOf(b.category) + 5) % 5;

function weighted(entries, random) {
  let draw = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [key, weight] of entries) {
    draw -= weight;
    if (draw < 0) return key;
  }
  return entries.at(-1)?.[0];
}

export function spreadPatients(data = {}, random = Math.random) {
  const base = clamp(Math.round(Number(data.count) || 8), 1, 250);
  const count = int(Math.ceil(base * .85), Math.min(250, Math.floor(base * 1.15)), random);
  let mix = initialCategories.map((key) => clamp(Number(data.mix?.[key]) || 0, 0, 100));
  const sum = mix.reduce((total, value) => total + value, 0);
  mix = sum ? mix.map((value) => 100 * value / sum) : [30, 30, 40];
  const lows = mix.map((value) => Math.max(0, value - 5));
  const highs = mix.map((value) => Math.min(100, value + 5));
  let remaining = 100;
  mix = mix.map((_, index) => {
    const min = Math.max(lows[index], remaining - highs.slice(index + 1).reduce((a, b) => a + b, 0));
    const max = Math.min(highs[index], remaining - lows.slice(index + 1).reduce((a, b) => a + b, 0));
    const next = min + (max - min) * random();
    remaining -= next;
    return next;
  });
  const exact = mix.map((share) => count * share / 100);
  const rounded = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - rounded[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of order.slice(0, count - rounded.reduce((a, b) => a + b, 0))) rounded[index]++;
  const categories = initialCategories.flatMap((category, index) => Array(rounded[index]).fill(category));
  for (let index = categories.length - 1; index > 0; index--) {
    const other = int(0, index, random);
    [categories[index], categories[other]] = [categories[other], categories[index]];
  }
  return { categories, mix };
}

export function mortality(minute, category) {
  const progress = (clamp(minute, 1, 50) - 1) / 49;
  return (.01 + .09 * progress ** 2) * (category === "blue" ? 2 : 1);
}

function buildPatients(data, random) {
  const main = Object.entries(data.departments || {}).filter(([key, value]) => departments[key] && Number(value) > 0)
    .map(([key, value]) => [key, Number(value)]);
  const weights = main.length ? main : [["trauma", 75], ["internal", 25]];
  return spreadPatients(data, random).categories.map((category, index) => {
    const child = random() < .10;
    const other = random() < clamp(Number(data.otherPercent ?? 5), 0, 100) / 100;
    const mainDepartment = other
      ? (category === "green" && !child ? "psychiatry" : "internal")
      : weighted(weights, random);
    const needs = [...new Set([mainDepartment, ...(child ? ["pediatrics"] : [])])];
    return {
      id: `p-${index + 1}`, label: `Pat ${index + 1}`, category, child, departments: needs,
      yellowType: random() < .5 ? "RTW" : "KTW", doctorNeeded: random() < .05,
      phase: "waiting", prescreen: null, doctorScreen: null, riskMinutes: 0, riskSeconds: 0,
      vehicleId: null, hospitalId: null, registered: false
    };
  });
}

const transportType = (patient) => patient.category === "green" ? "KTW" : patient.category === "yellow" ? patient.yellowType : "RTW";
const needsDoctor = (patient) => patient.doctorNeeded && ["red", "blue"].includes(patient.category);
const atScenePatients = (scene) => scene.patients.filter((patient) => ["waiting", "preparing", "ready"].includes(patient.phase));
const ktwOverrideRisk = (patient) => ["red", "blue"].includes(patient.category) ? .15 : .075;
const canAssignKtw = (patient) => patient.phase === "waiting" && patient.prescreen && transportType(patient) === "RTW"
  && (patient.category === "red" || patient.doctorScreen);
const availableKtws = (scene, snapshot) => snapshot.vehicles.filter((unit) =>
  unit.incidentId === scene.id && unit.status === 4 && unit.type === "KTW" && isFree(unit));

function carrierIndex(patient, pool, waiting) {
  const rank = priority.indexOf(patient.category);
  const air = pool.findIndex(isAirTransport);
  if (rank < 2 && needsDoctor(patient) && air !== -1) return air;
  const ground = pool.findIndex((unit) => unit.type === transportType(patient));
  if (ground !== -1) return ground;
  return waiting.some((other) => priority.indexOf(other.category) < rank) ? -1 : air;
}

function doctorTriage(patient, random) {
  if (patient.category === "blue") return "blue";
  const draw = random();
  if (patient.category === "red") {
    if (patient.phase === "waiting" && draw < .06) return "blue";
    if (draw < .31) return "yellow";
  }
  if (patient.category === "yellow" && draw < .30) return "green";
  if (patient.phase === "waiting" && draw >= .90 && patient.category !== "red") {
    return initialCategories[initialCategories.indexOf(patient.category) - 1];
  }
  return patient.category;
}
const isCompatible = (hospital, patient) => (!hospital.pediatricOnly || patient.departments.includes("pediatrics"))
  && patient.departments.every((key) => hospital.departments.includes(key));
const distance = (scene, target) => Math.hypot(scene.lat - target.lat,
  (scene.lng - target.lng) * Math.cos(scene.lat * Math.PI / 180));

export function chooseHospital(scene, patient, hospitals, weights) {
  const suitable = hospitals.filter((hospital) => hospital.available && isCompatible(hospital, patient));
  const nearest = (a, b) => distance(scene, a) - distance(scene, b);
  if (!weights) return suitable.sort(nearest)[0];
  const quota = suitable.filter((hospital) => weights[hospital.id] > 0);
  const load = new Map();
  for (const other of scene.patients) {
    if (other !== patient && other.hospitalId && other.phase !== "dead") {
      load.set(other.hospitalId, (load.get(other.hospitalId) || 0) + 1);
    }
  }
  return quota.sort((a, b) => ((load.get(a.id) || 0) + 1) / weights[a.id] - ((load.get(b.id) || 0) + 1) / weights[b.id]
    || nearest(a, b))[0];
}

export function createManv(command, { random = Math.random } = {}) {
  const scenes = new Map();
  const act = (scene, name, args = {}) => command(name, { incidentId: scene.id, ...args });
  const radio = (scene, message, level = "radio") => act(scene, "radio.log", { message, level });
  const setRole = async (scene, vehicle, role) => {
    await act(scene, "vehicle.role", { vehicleId: vehicle.id, role });
    vehicle.role = role;
  };

  function create(incident, second, config) {
    const scenario = incident.scenario || {};
    const data = scenario.data || {};
    const scene = {
      ...incident, data, config, draw: random, patients: buildPatients(data, random), known: false, firstUnit: null, firstRtw: null,
      firstDoctor: null, lastSecond: second, clock: second, arrivalOrder: [],
      serviceReports: new Set(), leaders: {}, screen: null, physician: null, clinicAlert: null,
      clinicQuotas: Object.create(null), clinicAutomation: false, openClinicTargets: 0, lastClinicRadioAt: null,
      notices: new Set(), reports: [], surplusReleaseAt: new Map(), timer: false, closed: false
    };
    scenes.set(scene.id, scene);
    return scene;
  }

  async function setClinicAutomation(scene, snapshot, enabled) {
    if (scene.closed) throw new Error("Der Einsatz ist abgeschlossen.");
    if (scene.clinicAutomation === enabled) return;
    if (enabled) {
      const onSite = new Set(snapshot.vehicles.filter((unit) => unit.incidentId === scene.id && unit.status === 4)
        .map((unit) => unit.type));
      if (!onSite.has("LNA") || !onSite.has("ORGL")) throw new Error("LNA und OrgL müssen vor Ort sein.");
      const weights = snapshot.hospitals.map((hospital) => scene.clinicQuotas[hospital.id] ?? 0);
      if (!weights.every((weight) => Number.isInteger(weight) && weight >= 0 && weight <= 100)
          || weights.reduce((total, weight) => total + weight, 0) !== 100) {
        throw new Error("Die Klinikquoten müssen zusammen 100 % ergeben.");
      }
    }
    scene.clinicAutomation = enabled;
    await radio(scene, enabled ? "Automatische Klinikzuweisung nach Einsatzquoten aktiviert." : "Automatische Klinikzuweisung ausgeschaltet.");
  }

  async function prepareHostPatient(scene, patient) {
    const args = {
      patientId: patient.id, label: patient.label, required: [transportType(patient)], departments: patient.departments,
      report: `${categoryLabel[patient.category]} · ${patient.child ? "Kind · " : ""}${patient.departments.map((key) => departments[key]).join(" / ")}`
    };
    await act(scene, patient.registered ? "patient.update" : "patient.add", args);
    patient.registered = true;
  }

  async function markDead(scene, patient, reason, level = "urgent") {
    if (patient.registered) await act(scene, "patient.complete", { patientId: patient.id, reason, deferClearance: true });
    patient.category = "dead";
    patient.phase = "dead";
    patient.hospitalId = null;
    if (patient.prescreen || patient.vehicleId) await radio(scene, `${patient.label}: ${reason}`, level);
    patient.vehicleId = null;
  }

  async function advancePatients(scene, onSite, elapsed) {
    const waiting = scene.patients.filter((patient) => patient.phase === "waiting").length;
    const treatment = onSite.filter((vehicle) => vehicle.type === "GW-SAN").length;
    const groupReduction = Math.min(.5, treatment * 5 / Math.max(1, waiting) * .5);
    const leaderReduction = scene.leaders.LNA && scene.leaders.ORGL
      ? clamp(Number(scene.config.leadershipReduction ?? 25), 0, 100) / 100 : 0;
    const worsen = 1 - (1 - .125) ** (elapsed / 1800);
    const improve = 1 - (1 - .02) ** (elapsed / 1800);
    for (const patient of scene.patients) {
      const waitingNow = patient.phase === "waiting";
      const blueCare = patient.phase === "preparing" && patient.category === "blue";
      if ((!waitingNow && !blueCare) || !elapsed) continue;
      if (["red", "blue"].includes(patient.category) && !patient.fatalDuringPrep) {
        patient.riskSeconds += elapsed;
        while (patient.riskSeconds >= 60) {
          patient.riskSeconds -= 60;
          patient.riskMinutes++;
          if (scene.draw() >= mortality(patient.riskMinutes, patient.category)) continue;
          if (blueCare) patient.fatalDuringPrep = true;
          else await markDead(scene, patient, "Während der Wartezeit verstorben. Kein Transportauftrag.");
          break;
        }
      }
      if (!waitingNow || terminal(patient) || !initialCategories.includes(patient.category)) continue;
      const index = initialCategories.indexOf(patient.category);
      const draw = scene.draw();
      const next = draw < worsen * (1 - groupReduction) * (1 - leaderReduction) ? Math.max(0, index - 1)
        : draw > 1 - improve ? Math.min(2, index + 1) : index;
      if (next === index) continue;
      patient.category = initialCategories[next];
      if (patient.prescreen) {
        await radio(scene, `${patient.label}: Zustand ${next < index ? "verschlechtert" : "verbessert"}, aktuell ${categoryLabel[patient.category]}.`,
          next < index ? "warn" : "radio");
      }
    }
  }

  async function reconcileRoles(scene, units) {
    const sceneUnits = new Map(units.map((unit) => [unit.id, unit]));
    const freeForRole = (vehicle) => vehicle && !vehicle.patientId && !vehicle.role && !vehicle.transportId && !vehicle.clearPending;
    for (const [type, label] of Object.entries(leaders)) {
      const here = units.find((vehicle) => vehicle.type === type);
      if (here?.id === scene.leaders[type]) continue;
      if (here) await radio(scene, `${here.name}: ${label} an der Einsatzstelle.`);
      scene.leaders[type] = here?.id;
    }
    if (!units.length) return;
    if (!scene.firstUnit) {
      scene.firstUnit = units[0].id;
      scene.reports.push({ vehicleId: units[0].id, code: 0,
        message: scene.scenario?.report || "Lage auf Sicht: Mehrere Verletzte, Anzahl und Schweregrad noch unklar." });
    }
    const rtws = units.filter((vehicle) => vehicle.type === "RTW");
    const nefs = units.filter(isDoctor);
    if (!scene.firstRtw && rtws.length) {
      scene.firstRtw = rtws[0].id;
      if (!scene.leaders.ELRD && freeForRole(rtws[0])) {
        await setRole(scene, rtws[0], "scene");
        await radio(scene, `${rtws[0].name}: Übernehme bis zum Eintreffen des ELRD die vorläufige Einsatzleitung.`);
      }
      scene.known = true;
      const report = scene.scenario?.situationReport || "Mehrere Verletzte bestätigt. Vorsichtung wird eingeleitet.";
      const reason = scene.scenario?.assistanceReason;
      scene.reports.push({ vehicleId: rtws[0].id, code: 0,
        message: `${report} Derzeit ${scene.patients.length} Betroffene erfasst.${reason ? ` Nachforderung: ${reason}` : ""}` });
    }
    if (!scene.firstDoctor && nefs.length) {
      scene.firstDoctor = nefs[0].id;
      if (!scene.leaders.LNA && freeForRole(nefs[0])) {
        await setRole(scene, nefs[0], "medical");
        await radio(scene, `${nefs[0].name}: Übernehme bis zum Eintreffen des LNA die vorläufige ärztliche Leitung.`);
      }
    }

    for (const [id, role, leader] of [[scene.firstRtw, "scene", "ELRD"], [scene.firstDoctor, "medical", "LNA"]]) {
      const unit = sceneUnits.get(id);
      if (unit?.role !== role || !scene.leaders[leader]) continue;
      await setRole(scene, unit, null);
      await radio(scene, `${unit.name}: ${roles[role]} an ${leaders[leader]} übergeben.`);
    }
    for (const vehicle of units) {
      if (vehicle.type === "GW-SAN" && freeForRole(vehicle)) {
        await setRole(scene, vehicle, "treatment");
        await radio(scene, `${vehicle.name}: SEG Behandlung einsatzbereit. Übernehmen die Erstversorgung wartender Patienten.`);
      }
    }
    if (scene.screen && !sceneUnits.has(scene.screen.vehicleId)) scene.screen = null;
    if (scene.physician && !sceneUnits.has(scene.physician.vehicleId)) scene.physician = null;

    if (!scene.screen && scene.patients.some((patient) => !patient.prescreen)) {
      const next = rtws.find((vehicle) => vehicle.id !== scene.firstRtw && freeForRole(vehicle))
        || rtws.find((vehicle) => scene.leaders.ELRD && freeForRole(vehicle));
      if (next) {
        await setRole(scene, next, "screen");
        scene.screen = { vehicleId: next.id, due: scene.clock + int(20, 40, scene.draw) };
        await radio(scene, `${next.name}: Beginne mit der Vorsichtung.`);
      }
    }
    if (!scene.physician && scene.patients.some((patient) => patient.prescreen && !patient.doctorScreen && !terminal(patient)
        && !["driving", "handover"].includes(patient.phase))) {
      const next = nefs.find((vehicle) => vehicle.id !== scene.firstDoctor && freeForRole(vehicle))
        || nefs.find((vehicle) => scene.leaders.LNA && freeForRole(vehicle));
      if (next) {
        await setRole(scene, next, "doctor");
        scene.physician = { vehicleId: next.id, patientId: null, due: null };
        await radio(scene, `${next.name}: Ärztliche Sichtung beginnt.`);
      }
    }
  }

  async function screenPatients(scene, units) {
    const screen = scene.screen;
    if (screen && scene.clock >= screen.due) {
      const patient = scene.patients.find((entry) => !entry.prescreen);
      if (patient) patient.prescreen = patient.category;
      if (scene.patients.every((entry) => entry.prescreen)) {
        const unit = units.find((entry) => entry.id === screen.vehicleId);
        await setRole(scene, unit, null);
        scene.screen = null;
        const summary = [...initialCategories, "dead"].map((key) =>
          `${scene.patients.filter((entry) => entry.prescreen === key).length} ${categoryLabel[key]}`).join(", ");
        await radio(scene, `${unit.name}: Vorsichtung abgeschlossen. ${summary}. Transportfahrzeuge können übernommen werden.`);
      } else {
        screen.due = scene.clock + int(20, 40, scene.draw);
      }
    }
    const physician = scene.physician;
    if (!physician) return;
    const unit = units.find((entry) => entry.id === physician.vehicleId);
    if (physician.patientId && scene.clock >= physician.due) {
      const patient = scene.patients.find((entry) => entry.id === physician.patientId);
      if (!terminal(patient) && !["driving", "handover"].includes(patient.phase)) {
        patient.category = doctorTriage(patient, scene.draw);
        patient.doctorScreen = patient.category;
        if (patient.registered) await prepareHostPatient(scene, patient);
        if (patient.doctorScreen !== patient.prescreen) {
          await radio(scene, `${unit.name}: ${patient.label}, ärztliche Sichtung ergibt ${categoryLabel[patient.category]}.`);
        }
      }
      physician.patientId = null;
    }
    if (!physician.patientId) {
      const next = scene.patients.filter((patient) => patient.prescreen && !patient.doctorScreen && !terminal(patient)
        && !["driving", "handover"].includes(patient.phase)).sort(sortByPriority)[0];
      if (next) {
        physician.patientId = next.id;
        physician.due = scene.clock + 60;
      } else if (scene.patients.every((patient) => patient.prescreen)) {
        await setRole(scene, unit, null);
        scene.physician = null;
        await radio(scene, `${unit.name}: Ärztliche Sichtung der verbliebenen Patienten abgeschlossen.`);
      }
    }
  }

  async function assignPatients(scene, units) {
    const free = units.filter(isFree);
    const waiting = scene.patients.filter((patient) => patient.phase === "waiting").sort(sortByPriority);
    for (const patient of waiting) {
      if (!patient.prescreen || (patient.category !== "red" && !patient.doctorScreen)) continue;
      const index = carrierIndex(patient, free, waiting.filter((entry) => entry.phase === "waiting"));
      if (index === -1) continue;
      const [unit] = free.splice(index, 1);
      await assignCarrier(scene, patient, unit);
    }
  }

  async function assignCarrier(scene, patient, unit, risk = 0) {
    await prepareHostPatient(scene, patient);
    await act(scene, "patient.assign", { patientId: patient.id, vehicleId: unit.id, carrier: true });
    unit.patientId = patient.id;
    patient.vehicleId = unit.id;
    patient.phase = "preparing";
    patient.readyAt = scene.clock + int(5 * 60, 12 * 60, scene.draw);
    patient.ktwOverride = risk > 0;
    patient.ktwFatalDuringPrep = risk > 0 && scene.draw() < risk;
    patient.waitingForClinicSince = null;
  }

  async function assignKtw(scene, patient, vehicleId, snapshot) {
    const carrier = availableKtws(scene, snapshot).find((unit) => unit.id === vehicleId);
    if (scene.closed || !canAssignKtw(patient) || !carrier) throw new Error("Patient oder KTW ist nicht mehr verfügbar.");
    const risk = ktwOverrideRisk(patient);
    await assignCarrier(scene, patient, carrier, risk);
    await radio(scene, `${carrier.name}: ${patient.label} durch Leitstelle dem KTW zugewiesen (Risiko ${risk * 100} %).`, "warn");
  }

  function findEscort(units) {
    return units.find((unit) => isDoctor(unit) && isFree(unit));
  }

  async function startTransport(scene, patient, hospitals, units, withoutDoctor = false) {
    const carrier = units.find((unit) => unit.id === patient.vehicleId && (!unit.radioBusy || unit.clinicCall));
    const hospital = hospitals.find((entry) => entry.id === patient.hospitalId && entry.available && isCompatible(entry, patient));
    if (patient.phase !== "ready" || !carrier || !hospital) {
      if (withoutDoctor) throw new Error("Transportfahrzeug oder aufnahmebereite Zielklinik fehlt.");
      return false;
    }
    const requiresEscort = needsDoctor(patient) && !isAirTransport(carrier);
    const escort = requiresEscort ? findEscort(units) : null;
    if (withoutDoctor && (escort || patient.category !== "red" || !requiresEscort)) {
      throw new Error("Eine Ausnahmefreigabe ist in dieser Lage nicht erforderlich.");
    }
    if (requiresEscort && !escort && !withoutDoctor && !patient.withoutDoctor) return false;
    if (withoutDoctor && !patient.withoutDoctor) {
      if (scene.draw() < .10) {
        await markDead(scene, patient, "Nach Freigabe ohne NA-Begleitung noch vor der Abfahrt verstorben.");
        return false;
      }
      patient.withoutDoctor = true;
      await radio(scene, `${carrier.name}: Transport von ${patient.label} durch Leitstelle ohne NA-Begleitung freigegeben.`, "warn");
    }
    const started = await act(scene, "transport.start", {
      patientId: patient.id, vehicleId: carrier.id, hospitalId: hospital.id, transportId: patient.id,
      escortVehicleId: escort?.id || null, signal: patient.category === "red"
    });
    if (!started) return false;
    patient.phase = "driving";
    patient.escortId = escort?.id || null;
    if (escort) escort.transportId = patient.id;
    carrier.transportId = patient.id;
    await radio(scene, `${carrier.name}: ${patient.label} geht auf Transport nach ${hospital.name}${escort ? ` mit NA-Begleitung durch ${escort.name}` : ""}.`);
    return true;
  }

  async function advanceTransports(scene, snapshot, units) {
    for (const patient of [...scene.patients].sort(sortByPriority)) {
      const hasCarrier = units.some((unit) => unit.id === patient.vehicleId && unit.patientId === patient.id);
      if (["ready", "preparing"].includes(patient.phase) && !hasCarrier) {
        patient.phase = "waiting";
        patient.vehicleId = null;
        patient.ktwOverride = false;
        patient.ktwFatalDuringPrep = false;
        patient.waitingForClinicSince = null;
      }
      if (patient.phase === "preparing" && scene.clock >= patient.readyAt) {
        if (patient.ktwFatalDuringPrep) {
          await markDead(scene, patient, "Während der Transportvorbereitung im ersatzweise zugewiesenen KTW verstorben.");
          continue;
        }
        if (patient.category === "blue" && patient.fatalDuringPrep) {
          await markDead(scene, patient, "Während der Transportvorbereitung verstorben.");
          continue;
        }
        if (patient.category === "blue") {
          patient.category = "red";
          await radio(scene, `${patient.label}: Stabilisierung gelungen, jetzt SK I · Rot.`);
        }
        patient.phase = "ready";
        patient.waitingForClinicSince = patient.hospitalId ? null : patient.readyAt;
        await radio(scene, `${patient.label}: Transportbereit${needsDoctor(patient) ? ", NA-Begleitung erforderlich" : ""}.`);
      }
      if (patient.phase !== "ready") continue;
      if (patient.hospitalId && !snapshot.hospitals.some((entry) => entry.id === patient.hospitalId && entry.available && isCompatible(entry, patient))) {
        patient.hospitalId = null;
      }
      if (!patient.hospitalId && scene.clinicAutomation) {
        patient.hospitalId = chooseHospital(scene, patient, snapshot.hospitals, scene.clinicQuotas)?.id || null;
      }
      if (!patient.hospitalId && patient.category === "red" && scene.clock >= patient.readyAt + 300) {
        patient.hospitalId = chooseHospital(scene, patient, snapshot.hospitals)?.id || null;
      }
      if (!patient.hospitalId) {
        patient.waitingForClinicSince ??= scene.clock;
        continue;
      }
      patient.waitingForClinicSince = null;
      await startTransport(scene, patient, snapshot.hospitals, units);
    }
  }

  async function requestClinicTargets(scene, units, waiting) {
    if (!waiting.length || units.some((unit) => unit.clinicCall)) return;
    const reminder = scene.lastClinicRadioAt !== null;
    if (reminder && (scene.clock - scene.lastClinicRadioAt < clinicReminderSeconds
      || !waiting.some((patient) => scene.clock - patient.waitingForClinicSince >= clinicReminderSeconds))) return;

    const leadership = [scene.leaders["UG-SANEL"], scene.leaders.ORGL, scene.leaders.ELRD, scene.firstRtw];
    const speaker = leadership.map((id) => units.find((unit) => unit.id === id)).find(Boolean)
      || units.find((unit) => unit.type === "RTW");
    if (!speaker || speaker.radioBusy || speaker.clearPending) return;
    const targets = waiting.length === 1 ? "für ein transportbereites Fahrzeug fehlt das Klinikziel"
      : `für ${waiting.length} transportbereite Fahrzeuge fehlen die Klinikziele`;
    const lead = speaker.type === "UG-SANEL" ? "Hier SanEL" : "Hier Einsatzleitung";
    const message = `${lead}, ${targets}. ${reminder ? "Bitte um Rückmeldung zur Zielzuweisung." : "Bitte Klinikziele zuweisen."}`;
    if (await act(scene, "vehicle.report", { vehicleId: speaker.id, code: 5, message, openPanel: true })) {
      scene.lastClinicRadioAt = scene.clock;
    }
  }
  async function notice(scene, key, message) {
    if (scene.notices.has(key)) return;
    scene.notices.add(key);
    await radio(scene, message, "warn");
  }

  async function sendSceneReports(scene, units) {
    for (const report of [...scene.reports]) {
      const unit = units.find((entry) => entry.id === report.vehicleId);
      if (!unit) {
        scene.reports.splice(scene.reports.indexOf(report), 1);
        continue;
      }
      if (unit.radioBusy) continue;
      if (await act(scene, "vehicle.report", report)) {
        unit.radioBusy = true;
        scene.reports.splice(scene.reports.indexOf(report), 1);
      }
    }
  }

  function pendingGroupUnits(scene, snapshot) {
    return (snapshot.groups || []).filter((group) => group.incidentId === scene.id && group.status === "alarmed")
      .flatMap((group) => group.pending || !group.vehicles.length
        ? (group.vehicleTypes || []).slice(group.vehicles.length).map((type) => ({ type })) : []);
  }

  function transportShortfall(patients, pool) {
    const counts = { RTW: 0, KTW: 0 };
    let airEscorts = 0;
    const waiting = [...patients].sort(sortByPriority);
    for (const patient of waiting) {
      const index = carrierIndex(patient, pool, []);
      if (index === -1) counts[transportType(patient)]++;
      else {
        const [carrier] = pool.splice(index, 1);
        if (isAirTransport(carrier) && needsDoctor(patient)) airEscorts++;
      }
    }
    return { counts, airEscorts };
  }

  function escortsNeeded(patients, units) {
    return patients.filter((patient) => !patient.withoutDoctor && needsDoctor(patient)
      && !units.some((unit) => unit.id === patient.vehicleId && isAirTransport(unit))).length;
  }

  async function releaseSurplus(scene, units) {
    if (scene.screen || !scene.patients.every((patient) => patient.prescreen || terminal(patient))) {
      scene.surplusReleaseAt.clear();
      return;
    }
    const active = atScenePatients(scene);
    const pool = units.filter(isFree);
    const { counts, airEscorts } = transportShortfall(active.filter((patient) => patient.phase === "waiting"), pool);
    const fallbackKtws = pool.filter((unit) => unit.type === "KTW").slice(0, counts.RTW);
    const reserveDoctors = Math.max(escortsNeeded(active, units) - airEscorts,
      active.some((patient) => !patient.doctorScreen) ? 1 : 0);
    const spareDoctors = pool.filter(isDoctor).slice(reserveDoctors);
    const reason = active.length ? "für verbliebene Patienten nicht benötigt" : "kein Patient mehr an der Einsatzstelle";
    const surplus = pool.filter((unit) => !leaders[unit.type] && !fallbackKtws.includes(unit)
      && (!isDoctor(unit) || spareDoctors.includes(unit)));
    for (const id of scene.surplusReleaseAt.keys()) {
      if (!surplus.some((unit) => unit.id === id)) scene.surplusReleaseAt.delete(id);
    }
    for (const unit of surplus) {
      if (!scene.surplusReleaseAt.has(unit.id)) scene.surplusReleaseAt.set(unit.id, scene.clock + int(5 * 60, 13 * 60, scene.draw));
      if (scene.clock < scene.surplusReleaseAt.get(unit.id)) continue;
      if (!await act(scene, "vehicle.release", { vehicleId: unit.id, reason, automatic: true })) continue;
      scene.surplusReleaseAt.delete(unit.id);
      unit.radioBusy = true;
      unit.clearPending = true;
    }
  }

  async function closeIfFinished(scene) {
    if (!scene.patients.every(terminal)) return false;
    await act(scene, "incident.close", { cancelPendingResponses: true });
    scene.closed = true;
    scene.clinicAutomation = false;
    scene.attention = [];
    scene.openClinicTargets = 0;
    return true;
  }

  async function update(scene, snapshot) {
    if (!scene || scene.closed) return;
    scene.clock = Math.max(scene.lastSecond, snapshot.second);
    const elapsed = scene.clock - scene.lastSecond;
    scene.lastSecond = scene.clock;
    scene.snapshot = snapshot;
    const current = snapshot.incidents.find((entry) => entry.id === scene.id);
    if (!current || current.status === "geschlossen") return;
    const units = snapshot.vehicles.filter((unit) => unit.incidentId === scene.id && unit.status === 4);
    for (const unit of units) if (!scene.arrivalOrder.includes(unit.id)) scene.arrivalOrder.push(unit.id);
    units.sort((a, b) => scene.arrivalOrder.indexOf(a.id) - scene.arrivalOrder.indexOf(b.id));
    await advancePatients(scene, units, elapsed);
    if (await closeIfFinished(scene)) return;
    await reconcileRoles(scene, units);
    if (scene.known && !scene.patientCountReported) {
      await act(scene, "incident.patientCount", { count: scene.patients.length });
      scene.patientCountReported = true;
    }
    if (scene.clinicAutomation && (!scene.leaders.LNA || !scene.leaders.ORGL)) {
      scene.clinicAutomation = false;
      await radio(scene, "Klinikautomatik ausgeschaltet. LNA oder OrgL ist nicht mehr vor Ort.", "warn");
    }
    await screenPatients(scene, units);
    await assignPatients(scene, units);
    await sendSceneReports(scene, units);
    await advanceTransports(scene, snapshot, units);
    if (await closeIfFinished(scene)) return;

    await releaseSurplus(scene, units);

    const attention = [];
    const active = atScenePatients(scene);
    if (scene.known && active.length) {
      const wanted = { ELRD: scene.data.elrd !== false, LNA: scene.data.sanel !== false,
        ORGL: scene.data.sanel !== false, "UG-SANEL": scene.data.ug !== false };
      const responding = snapshot.vehicles.filter((unit) => unit.nextIncidentId === scene.id
        || (unit.incidentId === scene.id && unit.status === 3));
      const pendingGroups = pendingGroupUnits(scene, snapshot);
      const dispatched = [...units, ...responding, ...pendingGroups];
      for (const [type, required] of Object.entries(wanted)) {
        if (required && !dispatched.some((unit) => unit.type === type)) {
          attention.push(type === "UG-SANEL" ? "UG SanEL" : type === "ORGL" ? "OrgL" : type);
          await notice(scene, type, `Nachforderung ${leaders[type]} zur Koordination des MANV.`);
        }
      }
      const treatmentShortfall = (Number(scene.data.segTreatmentCount) || 0) - dispatched.filter((unit) => unit.type === "GW-SAN").length;
      if (treatmentShortfall > 0) attention.push(`${treatmentShortfall} SEG-Behandlung`);
      const available = [...units.filter(isFree), ...responding, ...pendingGroups];
      const { counts, airEscorts } = transportShortfall(active.filter((patient) => patient.prescreen && patient.phase === "waiting"), [...available]);
      for (const [type, count] of Object.entries(counts)) {
        if (count <= 0) continue;
        attention.push(`${count} ${type}`);
        await notice(scene, `transport-${type}`, `Nachforderung ${type}: Bereits gesichtete Patienten warten auf ein geeignetes Transportmittel.`);
      }
      const assessed = active.filter((patient) => patient.prescreen);
      const doctors = available.filter(isDoctor).length;
      const doctorsNeeded = escortsNeeded(assessed, units) - airEscorts;
      const needsTriage = !scene.physician && assessed.some((patient) => !patient.doctorScreen
        && patient.category !== "red");
      const missingDoctors = Math.max(0, doctorsNeeded + Number(needsTriage) - doctors);
      if (missingDoctors) attention.push(`${missingDoctors} NEF`);
    }
    const waiting = scene.patients.filter((patient) => patient.phase === "ready" && !patient.hospitalId);
    if (waiting.length !== scene.openClinicTargets || attention.join("|") !== (scene.attention || []).join("|")) {
      await act(scene, "incident.attention", { items: attention, openClinicTargets: waiting.length });
      scene.attention = attention;
      scene.openClinicTargets = waiting.length;
    }
    await requestClinicTargets(scene, units, waiting);
  }

  async function alarmClinics(scene, hospitals) {
    if (scene.clinicAlert) return;
    if (!hospitals.length) throw new Error("Für diese ILS sind keine Kliniken hinterlegt.");
    scene.clinicAlert = new Set();
    for (const hospital of hospitals) {
      await act(scene, "hospital.hold", { hospitalId: hospital.id, readyAfterSeconds: int(15 * 60, 30 * 60, scene.draw) });
    }
    await radio(scene, `Klinik-Alarm MANV an ${hospitals.length} Kliniken ausgelöst. Aufnahmebereitschaft wird innerhalb von 15–30 Minuten gemeldet.`, "urgent");
  }

  async function event(name, payload) {
    const scene = scenes.get(payload.incidentId);
    if (!scene) return;
    if (name === "vehicle.arrived" && !scene.arrivalOrder.includes(payload.vehicleId)) scene.arrivalOrder.push(payload.vehicleId);
    if (name === "service.arrived" && !scene.serviceReports.has(payload.service)) {
      scene.serviceReports.add(payload.service);
      await radio(scene, payload.service === "POL"
        ? "POL: An der Einsatzstelle. Die Abstimmung mit der Einsatzleitung läuft."
        : "FW: An der Einsatzstelle. Wir unterstützen die Rettung und Einrichtung der Patientenablage.");
    }
    if (name === "hospital.ready") {
      scene.clinicAlert?.add(payload.hospitalId);
      const hospital = scene.snapshot?.hospitals.find((entry) => entry.id === payload.hospitalId);
      if (hospital) await radio(scene, `${hospital.name}: Klinik-Alarm bestätigt, aufnahmebereit.`);
    }
    if (name === "transport.arrived" || name === "transport.handover" || name === "transport.retargeted") {
      const patient = scene.patients.find((entry) => entry.id === payload.patientId);
      if (patient) {
        patient.hospitalId = payload.hospitalId;
        if (name === "transport.arrived") patient.phase = "handover";
        if (name === "transport.handover") patient.phase = "done";
      }
    }
    if (name === "incident.closed") {
      scene.closed = true;
      scene.clinicAutomation = false;
    }
  }

  return { scenes, create, update, setClinicAutomation, alarmClinics, event, startTransport, assignKtw };
}

export default function startManv(api) {
  const engine = createManv(api.command);
  const { root } = api;
  const style = document.createElement("style");
  style.textContent = `
    :root{font:14px system-ui,sans-serif;color:#142b3c;background:#f5f8fa;color-scheme:light}
    *{box-sizing:border-box} body{margin:0} main{padding:16px;max-width:1120px;margin:auto}
    h1,h2,p{margin:0} h1{font-size:1.4rem} h2{font-size:1rem}
    header,.bar,.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    header{justify-content:space-between;margin-bottom:12px}
    .muted{color:#526776}.eyebrow{font-size:.78rem;font-weight:750;color:#075b75}
    .bar{margin:8px 0}.block,details{background:#fff;border:1px solid #d0dee6;border-radius:10px;margin-top:10px;padding:10px}
    summary{cursor:pointer;font-weight:700} details[open]>summary{margin-bottom:8px}
    button,select,input{font:inherit;color:inherit;background:#fff;border:1px solid #b6c9d4;border-radius:6px;padding:6px 8px;max-width:100%}
    button{cursor:pointer;font-weight:650} button:hover:not(:disabled){background:#e6f2f7}
    button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #007e9a;outline-offset:2px}
    button:disabled{opacity:.5;cursor:default} .primary{background:#00566d;border-color:#00566d;color:white}
    .primary:hover:not(:disabled){background:#003b4f}
    .tag{padding:.2em .55em;border-radius:5px;background:#edf2f6;font-size:.85em;font-weight:700;display:inline-block;white-space:nowrap}
    .red{color:#8a1f28;background:#ffe2e5}.yellow{color:#745000;background:#fff0c1}.green{color:#18533b;background:#def4e6}
    .blue{color:#163e79;background:#dfeafd}.dead{color:#354253;background:#e2e7eb}.error{color:#922437}
    .patient-list{display:grid;gap:6px;margin-top:8px}
    .patient{min-width:0;display:grid;grid-template-columns:minmax(80px,.7fr) minmax(135px,1fr) minmax(110px,1fr) minmax(180px,1.6fr);gap:8px;align-items:center;border:1px solid #dae4ea;border-radius:7px;padding:8px}
    .patient small,.stack>*{display:block;overflow-wrap:anywhere}.patient select{width:100%}
    .stack>.actions{display:flex}
    .resource-needs{margin:5px 0 0;padding-left:1.3em;display:flex;flex-wrap:wrap;gap:4px 28px}
    .stack>*+*{margin-top:3px}.warn{border-color:#ca8a1d;color:#794a00}.status{min-height:1.25em;margin:8px 0}
    .quota-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:6px 16px;margin:8px 0}
    .quota-list label{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .quota-list input{width:5.3em;flex:none}
    @media(max-width:610px){main{padding:10px}.patient{grid-template-columns:repeat(2,minmax(0,1fr))}.patient .destination{grid-column:span 2}}
  `;
  document.head.append(style);
  const node = (tag, value = "", className = "") => {
    const element = document.createElement(tag);
    element.textContent = value;
    element.className = className;
    return element;
  };
  let selected = null;
  let latest = null;
  let jobs = Promise.resolve();
  let message = "";
  let messageError = false;
  let filter = "open";
  let lastView = "";
  let armOverride = null;
  let ktwChoice = null;

  function task(callback, incidentId = selected) {
    jobs = jobs.then(callback).catch((error) => {
      if (incidentId !== selected) return;
      message = error.message || String(error);
      messageError = true;
    }).finally(render);
    return jobs;
  }

  function run(callback) {
    return task(async () => {
      message = "";
      messageError = false;
      await callback();
    });
  }

  function button(label, key, callback, { className = "", disabled = false } = {}) {
    const element = node("button", label, className);
    element.type = "button";
    element.dataset.focus = key;
    element.disabled = disabled;
    element.addEventListener("click", callback);
    return element;
  }

  function selectControl(label, key, options, value, change) {
    const control = node("select");
    control.dataset.focus = key;
    control.setAttribute("aria-label", label);
    for (const [id, name] of options) control.append(new Option(name, id));
    control.value = value || "";
    control.addEventListener("change", () => change(control.value));
    return control;
  }

  function detail(label, key, content, open) {
    const element = node("details");
    element.dataset.section = key;
    element.open = open;
    element.append(node("summary", label), content);
    return element;
  }

  async function refresh() {
    latest = await api.command("state.get");
    return latest;
  }

  async function tick(scene, snapshot = null) {
    if (scene.closed) return;
    try {
      await engine.update(scene, snapshot || await refresh());
    } finally {
      if (!scene.closed && !scene.timer) {
        const due = [scene.screen?.due, scene.physician?.due].filter((value) => Number.isFinite(value) && value > scene.clock);
        const seconds = Math.max(.1, Math.min(10, ...due.map((value) => value - scene.clock)));
        await api.command("clock.after", { incidentId: scene.id, timerId: `pulse-${scene.id}`, seconds });
        scene.timer = true;
      }
    }
  }

  async function assignDestination(scene, patient, id) {
    if (!id || !["preparing", "ready"].includes(patient.phase)) return;
    const snapshot = await refresh();
    const hospital = snapshot.hospitals.find((entry) => entry.id === id && entry.available && isCompatible(entry, patient));
    if (!hospital) throw new Error("Die gewählte Klinik ist aktuell nicht geeignet oder aufnahmebereit.");
    patient.hospitalId = id;
    await tick(scene, snapshot);
  }

  function patientRow(scene, patient, snapshot) {
    const row = node("article", "", "patient");
    const triage = node("div", "", "stack");
    const badge = node("span", categoryLabel[patient.category], `tag ${patient.category}`);
    triage.append(node("strong", patient.label + (patient.child ? " · Kind" : "")), badge);
    const notes = [
      patient.prescreen ? `Vorsichtung: ${categoryLabel[patient.prescreen]}` : "",
      patient.doctorScreen ? `Ärztlich: ${categoryLabel[patient.doctorScreen]}` : ""
    ].filter(Boolean);
    for (const note of notes) triage.append(node("small", note, "muted"));
    const care = node("div", "", "stack");
    const clockText = patient.phase === "preparing" ? ` · ${Math.max(0, Math.ceil((patient.readyAt - scene.clock) / 60))} min` : "";
    const vehicle = snapshot.vehicles.find((unit) => unit.id === patient.vehicleId);
    care.append(node("strong", phaseLabel[patient.phase] + clockText), node("small", vehicle?.name || (terminal(patient) ? "" : "kein Fahrzeug"), "muted"));
    if (patient.ktwOverride) care.append(node("small", "KTW durch Leitstelle zugewiesen", "muted"));
    const substitutes = !scene.closed && canAssignKtw(patient) ? availableKtws(scene, snapshot) : [];
    if (substitutes.length) {
      const chosen = ktwChoice?.patientId === patient.id ? substitutes.find((unit) => unit.id === ktwChoice.vehicleId) : null;
      const risk = ktwOverrideRisk(patient) === .15 ? "15 %" : "7,5 %";
      const choices = [["", "KTW ersatzweise zuweisen"], ...substitutes.map((unit) => [unit.id, unit.name])];
      care.append(selectControl(`Ersatz-KTW für ${patient.label}`, `ktw-${patient.id}`, choices, chosen?.id, (id) => {
        ktwChoice = id ? { patientId: patient.id, vehicleId: id } : null;
        document.activeElement?.blur();
        render();
      }));
      if (chosen) care.append(button(`Zuweisen · ${risk} Todesrisiko`, `ktw-confirm-${patient.id}`, () => run(async () => {
        ktwChoice = null;
        await engine.assignKtw(scene, patient, chosen.id, await refresh());
        await tick(scene);
      }), { className: "warn" }));
    }
    const required = node("div", "", "stack");
    if (patient.phase !== "dead") {
      required.append(node("strong", transportType(patient) + (needsDoctor(patient) ? " + NA" : "")),
        node("small", patient.departments.map((key) => departments[key]).join(" / "), "muted"));
    }
    const destination = node("div", "", "stack destination");
    const hospitalName = snapshot.hospitals.find((entry) => entry.id === patient.hospitalId)?.name;
    if (["ready", "preparing"].includes(patient.phase)) {
      const hospitals = snapshot.hospitals.filter((entry) => isCompatible(entry, patient))
        .sort((a, b) => Number(b.available) - Number(a.available) || distance(scene, a) - distance(scene, b));
      const choices = [["", hospitals.some((entry) => entry.available) ? "Zielklinik wählen" : "Keine geeignete Klinik frei"],
        ...hospitals.map((entry) => [entry.id, entry.name + (entry.available ? "" : " · abgemeldet")])];
      const control = selectControl(`Zielklinik für ${patient.label}`, `hospital-${patient.id}`, choices, patient.hospitalId,
        (id) => run(() => assignDestination(scene, patient, id)));
      control.options[0].disabled = true;
      hospitals.forEach((entry, index) => { control.options[index + 1].disabled = !entry.available; });
      control.disabled = !hospitals.some((entry) => entry.available);
      destination.append(control);
      const escort = snapshot.vehicles.some((unit) => unit.incidentId === scene.id && unit.status === 4 && isDoctor(unit) && isFree(unit));
      if (patient.phase === "ready" && patient.category === "red" && patient.hospitalId && needsDoctor(patient)
          && vehicle && !isAirTransport(vehicle) && !escort && !patient.withoutDoctor) {
        const armed = armOverride === patient.id;
        destination.append(button(armed ? "10 % Todesrisiko bestätigen" : "Ohne NA starten", `override-${patient.id}`, () => {
          if (!armed) {
            armOverride = patient.id;
            render();
            return;
          }
          armOverride = null;
          run(async () => {
            const snapshot = await refresh();
            const units = snapshot.vehicles.filter((unit) => unit.incidentId === scene.id && unit.status === 4);
            await engine.startTransport(scene, patient, snapshot.hospitals, units, true);
            await tick(scene);
          });
        }, { className: "warn" }));
        if (armed) destination.append(button("Abbrechen", `cancel-${patient.id}`, () => { armOverride = null; render(); }));
      }
    } else if (hospitalName) {
      destination.append(node("strong", hospitalName));
    } else if (patient.phase === "dead") {
      destination.append(node("small", "Kein Transport", "muted"));
    }
    row.append(triage, care, required, destination);
    return row;
  }

  function alarmSection(scene, snapshot) {
    const area = node("div", "", "stack");
    const actions = node("div", "", "actions");
    const ready = scene.clinicAlert?.size || 0;
    const clinicLabel = scene.clinicAlert
      ? (scene.closed ? "Klinik-Alarm beendet" : `Klinik-Alarm · ${ready}/${snapshot.hospitals.length} bereit`)
      : "Klinik-Alarm MANV";
    actions.append(button(clinicLabel,
      "clinics", () => run(() => engine.alarmClinics(scene, snapshot.hospitals)),
      { className: "primary", disabled: Boolean(scene.clinicAlert) || scene.closed }));
    area.append(actions);
    const open = snapshot.incidents.find((entry) => entry.id === scene.id);
    const services = ["POL", "FW"].map((service) => `${service} · ${open?.services?.[service]?.status || "nicht alarmiert"}`);
    area.append(node("small", services.join("  |  "), "muted"));
    return area;
  }

  function groupSection(scene, snapshot, activeGroups) {
    const area = node("div", "", "stack");
    for (const group of activeGroups) {
      const row = node("div", "", "actions");
      const onSite = snapshot.vehicles.filter((unit) => unit.supportGroupId === group.id && unit.incidentId === scene.id && unit.status === 4).length;
      row.append(node("strong", group.name), node("small",
        group.pending ? "Alarmiert · wartet auf Rückmeldung" : `${group.vehicles.length} Fahrzeuge · ${onSite} vor Ort`, "muted"));
      area.append(row);
    }
    return area;
  }

  function vehicleSection(vehicles) {
    const area = node("div", "", "stack");
    if (!vehicles.length) area.append(node("p", "Noch keine Fahrzeuge alarmiert.", "muted"));
    for (const unit of vehicles) {
      const row = node("div", "", "actions");
      row.append(node("span", unit.type, "tag"), node("strong", unit.name),
        node("small", unit.queued ? "Alarmiert" : `S${unit.status} · ${unit.statusText || ""}`, "muted"));
      if (unit.role) row.append(node("small", roles[unit.role] || unit.role, "muted"));
      area.append(row);
    }
    return area;
  }

  function clinicQuotaSection(scene, snapshot) {
    const area = node("div", "", "stack");
    const leadersReady = Boolean(scene.leaders.LNA && scene.leaders.ORGL);
    if (scene.closed) return node("p", "Einsatz abgeschlossen.", "muted");
    if (!snapshot.hospitals.length) return node("p", "Für diese ILS sind keine Kliniken hinterlegt.", "muted");
    area.append(node("p", leadersReady
      ? "Die Einsatzquoten müssen zusammen 100 % ergeben. 0 % schließt ein Haus aus der Verteilung aus."
      : "LNA und OrgL müssen vor Ort sein. Die Einsatzquoten können bereits vorbereitet werden.", "muted"));
    const list = node("div", "", "quota-list");
    const actions = node("div", "", "actions");
    const total = node("span", "", "tag");
    const active = scene.clinicAutomation;
    const toggle = button(active ? "Automatik ausschalten" : "Automatik einschalten", "clinic-automation",
      () => run(async () => {
        const current = await refresh();
        await engine.setClinicAutomation(scene, current, !active);
        await tick(scene, current);
      }), { className: active ? "" : "primary" });
    const inputs = snapshot.hospitals.map((hospital) => {
      const label = node("label", hospital.name);
      const input = node("input");
      input.type = "number";
      input.min = 0;
      input.max = 100;
      input.step = 1;
      input.value = scene.clinicQuotas[hospital.id] ?? 0;
      input.disabled = scene.clinicAutomation;
      input.dataset.focus = `clinic-quota-${hospital.id}`;
      input.addEventListener("input", () => {
        scene.clinicQuotas[hospital.id] = input.value === "" ? 0 : input.valueAsNumber;
        updateTotal();
      });
      label.append(input);
      list.append(label);
      return input;
    });
    function updateTotal() {
      const sum = inputs.reduce((value, input) => value + (input.valueAsNumber || 0), 0);
      total.textContent = `${sum} / 100 %`;
      toggle.disabled = !scene.clinicAutomation && (!leadersReady || sum !== 100 || inputs.some((input) => !input.validity.valid));
    }
    updateTotal();
    actions.append(total, toggle);
    area.append(list, actions);
    return area;
  }

  function render() {
    if (!api.root.isConnected) return;
    const scene = engine.scenes.get(selected);
    const active = document.activeElement;
    // Preserve open selects and quota entry while timed updates arrive.
    if (["SELECT", "INPUT"].includes(active?.tagName) && root.contains(active) && !messageError) return;
    const snapshot = latest;
    const view = JSON.stringify([selected, filter, message, messageError, armOverride, ktwChoice, scene?.closed,
      scene && [scene.known, scene.clinicAlert ? [...scene.clinicAlert] : null, scene.attention, scene.openClinicTargets, scene.leaders,
        scene.clinicQuotas, scene.clinicAutomation,
        scene.patients.filter((entry) => entry.prescreen).map((entry) => [entry.id, entry.phase, entry.category, entry.doctorScreen, entry.vehicleId,
          entry.hospitalId, entry.ktwOverride, entry.phase === "preparing" ? Math.ceil((entry.readyAt - scene.clock) / 60) : null]),
        snapshot?.incidents.find((entry) => entry.id === scene.id)?.services,
        snapshot?.hospitals.map((entry) => entry.available),
        snapshot?.vehicles.map((unit) => [unit.id, unit.available, unit.incidentId, unit.queued, unit.status, unit.role, unit.radioBusy, unit.transportId]),
        snapshot?.groups.map((group) => [group.id, group.status, group.incidentId, group.pending, group.vehicles])]]);
    if (view === lastView) return;
    lastView = view;

    const oldSections = new Map([...root.querySelectorAll("details[data-section]")].map((entry) => [entry.dataset.section, entry.open]));
    const focusKey = root.contains(active) ? active.dataset.focus : null;
    const scroll = document.scrollingElement.scrollTop;
    const header = node("header");
    const title = node("div", "", "stack");
    title.append(node("p", "MANV · Einsatzführung", "eyebrow"), node("h1", scene?.location || "MANV-Übersicht"));
    header.append(title);
    const status = node("p", message, `status ${messageError ? "error" : "muted"}`);
    status.setAttribute("role", "status");
    root.replaceChildren(header, status);
    if (!scene || !snapshot) {
      root.append(node("p", "Noch kein MANV-Einsatz ausgewählt.", "muted"));
    } else {
      const situation = node("section", "", "block stack");
      situation.append(node("h2", scene.keyword), node("p", scene.known ? scene.scenario?.situationReport || "Großschadenslage bestätigt."
        : scene.firstUnit ? scene.scenario?.report || "Lage auf Sicht gemeldet." : "Wartet auf Lage auf Sicht.", "muted"));
      const known = scene.patients.filter((entry) => entry.prescreen);
      const bar = node("div", "", "bar");
      if (scene.known) {
        bar.append(node("span", `Vorgesichtet ${known.length}/${scene.patients.length}`, "tag"),
          node("span", `Ärztlich gesichtet ${known.filter((entry) => entry.doctorScreen).length}`, "tag"));
        for (const key of [...priority, "dead"]) bar.append(node("span", `${categoryLabel[key]} ${known.filter((entry) => entry.category === key).length}`, `tag ${key}`));
        bar.append(node("span", `Übergeben ${known.filter((entry) => entry.phase === "done").length}`, "tag"));
        const reclassified = known.filter((entry) => initialCategories.includes(entry.prescreen) && initialCategories.includes(entry.doctorScreen));
        const downgraded = reclassified.filter((entry) => initialCategories.indexOf(entry.doctorScreen) > initialCategories.indexOf(entry.prescreen)).length;
        const upgraded = reclassified.filter((entry) => initialCategories.indexOf(entry.doctorScreen) < initialCategories.indexOf(entry.prescreen)).length;
        if (downgraded || upgraded) bar.append(node("span", `Ärztlich umgestuft · ${downgraded} niedriger · ${upgraded} höher`, "tag"));
      }
      situation.append(bar);
      if (scene.attention?.length) {
        situation.append(node("h2", "Noch benötigt"));
        const needs = node("ul", "", "resource-needs warn");
        for (const item of scene.attention) needs.append(node("li", item));
        situation.append(needs);
      }
      if (scene.openClinicTargets) {
        const count = scene.openClinicTargets;
        situation.append(node("p", count === 1 ? "Ein Klinikziel offen" : `${count} Klinikziele offen`, "warn"));
      }
      const assignedIds = new Set(snapshot.incidents.find((entry) => entry.id === scene.id)?.assigned);
      const assigned = snapshot.vehicles.filter((unit) => assignedIds.has(unit.id));
      const activeGroups = snapshot.groups.filter((group) => group.incidentId === scene.id);
      root.append(situation,
        detail("Klinik-Alarm", "alarm", alarmSection(scene, snapshot), oldSections.get("alarm") ?? true));
      if (activeGroups.length) {
        root.append(detail("Alarmierte SEG / UGRD", "groups", groupSection(scene, snapshot, activeGroups), oldSections.get("groups") ?? false));
      }
      root.append(detail(`Fahrzeuge im Einsatz (${assigned.length})`, "vehicles", vehicleSection(assigned), oldSections.get("vehicles") ?? false));

      const roleBar = node("div", "", "bar");
      for (const unit of assigned.filter((entry) => entry.role || leaders[entry.type])) roleBar.append(node("span", `${roles[unit.role] || leaders[unit.type]} · ${unit.name}`, "tag"));
      if (roleBar.childNodes.length) root.append(roleBar);
      root.append(detail(scene.clinicAutomation ? "Automatische Klinikzuweisung · aktiv" : "Automatische Klinikzuweisung", "quotas",
        clinicQuotaSection(scene, snapshot), oldSections.get("quotas") ?? false));
      const patients = node("section", "", "block");
      const controls = node("div", "", "bar");
      controls.append(node("h2", "Patienten und Klinikziele"));
      controls.append(selectControl("Patientenfilter", "filter", [["open", "Offene Patienten"], ["ready", "Transportbereit"], ["all", "Alle gesichteten Patienten"]],
        filter, (value) => { document.activeElement?.blur(); filter = value; render(); }));
      if (known.some((entry) => entry.phase === "ready" && !entry.hospitalId)) {
        controls.append(button("Freie Klinikziele zuweisen", "batch-destination", () => run(async () => {
          const snapshot = await refresh();
          const waiting = scene.patients.filter((entry) => entry.phase === "ready" && !entry.hospitalId)
            .sort(sortByPriority);
          for (const patient of waiting) patient.hospitalId = chooseHospital(scene, patient, snapshot.hospitals)?.id || null;
          await tick(scene, snapshot);
        })));
      }
      patients.append(controls);
      const rows = known.filter((entry) => filter === "all" || (filter === "ready" ? entry.phase === "ready" : !terminal(entry)))
        .sort(sortByPriority);
      const list = node("div", "", "patient-list");
      for (const patient of rows) list.append(patientRow(scene, patient, snapshot));
      if (!rows.length) list.append(node("p", known.length ? "Keine Patienten in dieser Ansicht." : "Sichtungsergebnisse erscheinen hier, sobald sie vorliegen.", "muted"));
      patients.append(list);
      root.append(patients);
    }
    if (focusKey) [...root.querySelectorAll("[data-focus]")].find((entry) => entry.dataset.focus === focusKey)?.focus({ preventScroll: true });
    document.scrollingElement.scrollTop = scroll;
  }

  api.onEvent((event, payload) => {
    if (!["shift.started", "panel.opened", "incident.created", "clock.timer", "vehicle.arrived", "vehicle.alarmed", "vehicle.reportAnswered",
      "service.arrived", "group.unitAvailable", "group.unavailable", "hospital.ready", "transport.arrived",
      "transport.retargeted", "transport.handover", "incident.closed"].includes(event)) return;
    task(async () => {
      if (event === "shift.started") {
        await refresh();
        return;
      }
      if (event === "panel.opened") {
        if (!engine.scenes.has(payload.incidentId)) return;
        if (selected !== payload.incidentId) {
          selected = payload.incidentId;
          filter = "open";
          armOverride = null;
          ktwChoice = null;
          message = "";
          messageError = false;
          root.replaceChildren();
          document.scrollingElement.scrollTop = 0;
          lastView = "";
          render();
        }
        await refresh();
        return;
      }
      if (event === "incident.created") {
        const snapshot = await refresh();
        const incident = snapshot.incidents.find((entry) => entry.id === payload.incidentId);
        if (!incident) return;
        const scene = engine.create(incident, snapshot.second, snapshot.centerConfig.data || {});
        await tick(scene, snapshot);
        return;
      }
      const scene = engine.scenes.get(payload.incidentId);
      if (!scene) return;
      if (event === "clock.timer") scene.timer = false;
      await engine.event(event, payload);
      if (event === "incident.closed") await refresh();
      else if (!scene.closed) await tick(scene);
    }, payload.incidentId ?? selected);
  });

  root.addEventListener("focusout", (event) => {
    if (event.target.tagName === "INPUT" || (event.relatedTarget?.closest("[data-focus]") && root.contains(event.relatedTarget))) return;
    queueMicrotask(render);
  });
  render();
}
