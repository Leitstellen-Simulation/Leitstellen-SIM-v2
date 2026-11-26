const modScenarioWindows = ["00–06 Uhr", "06–12 Uhr", "12–18 Uhr", "18–24 Uhr"];

function modScenarioOptions(manifests = [], configured = {}) {
  const options = new Map([["manv", { id: "manv", name: "MANV", installed: false }]]);
  for (const mod of manifests) {
    if (mod.scenarioCatalog) options.set(mod.id, { id: mod.id, name: mod.name, installed: true });
  }
  for (const id of Object.keys(configured || {})) {
    if (!options.has(id)) options.set(id, { id, name: id, installed: false });
  }
  return [...options.values()];
}

function normalizeModScenarioConfig(config) {
  const chanceByBlock = modScenarioWindows.map((_, index) =>
    Math.max(0, Math.min(100, Number(config?.chanceByBlock?.[index]) || 0)));
  return { ...config, enabled: config?.enabled === true, chanceByBlock };
}

function modScenarioCatalogUrl(modId) {
  return `/api/mods/${encodeURIComponent(modId)}/catalog`;
}

function selectShiftMods(manifests, preferences, configured) {
  return {
    selected: manifests.filter((mod) => mod.scenarioCatalog
      ? configured[mod.id]?.enabled === true : preferences.includes(mod.id)),
    unavailable: modScenarioOptions(manifests, configured)
      .filter((mod) => !mod.installed && configured[mod.id]?.enabled === true)
  };
}

function createModScenarioSchedule(config, startMinute, random = Math.random) {
  const { enabled, chanceByBlock } = normalizeModScenarioConfig(config);
  let lastMinute = Math.floor(startMinute) - 1;
  let lastBlock = null;
  let plannedMinute = null;
  return function takeDue(endMinute) {
    const end = Math.floor(endMinute);
    if (!enabled || end <= lastMinute) return [];
    const due = [];
    const firstBlock = Math.floor((lastMinute + 1) / 360);
    const finalBlock = Math.floor(end / 360);
    for (let block = firstBlock; block <= finalBlock; block += 1) {
      if (block !== lastBlock) {
        lastBlock = block;
        const chance = chanceByBlock[block % modScenarioWindows.length] / 100;
        plannedMinute = chance > 0 && random() < chance ? block * 360 + Math.floor(random() * 360) : null;
      }
      if (plannedMinute !== null && plannedMinute > lastMinute && plannedMinute <= end) {
        due.push(plannedMinute);
        plannedMinute = null;
      }
    }
    lastMinute = end;
    return due;
  };
}
