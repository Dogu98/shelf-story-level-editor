export const PRODUCT_IDS = ["Apple", "Bread", "Milk", "Coffee", "Cheese", "Chocolate", "Juice"];
const DEFAULT_GOAL = "Tüm ürünleri eşleştir ve rafı temizle";

export function createEmptyCatalog() {
  return { schemaVersion: 1, levels: [] };
}

export function createDefaultLevel(levelNumber = 1) {
  const id = String(levelNumber).padStart(3, "0");
  return normalizeLevel({
    levelNumber,
    levelId: `level_${id}`,
    displayName: `Yeni Bölüm ${levelNumber}`,
    trayCapacity: 7,
    matchSize: 3,
    goalDescription: DEFAULT_GOAL,
    goalItemCount: 6,
    performance: {
      moveLimit: 8,
      timeLimitSeconds: 45,
      threeStarMaxMoves: 6,
      twoStarMaxMoves: 8,
      threeStarMinTimeSeconds: 20,
      twoStarMinTimeSeconds: 8
    },
    items: [
      { itemId: "apple_1", product: "Apple", blockerIds: [] },
      { itemId: "apple_2", product: "Apple", blockerIds: [] },
      { itemId: "apple_3", product: "Apple", blockerIds: [] },
      { itemId: "milk_1", product: "Milk", blockerIds: ["apple_1"] },
      { itemId: "milk_2", product: "Milk", blockerIds: ["apple_2"] },
      { itemId: "milk_3", product: "Milk", blockerIds: ["apple_3"] }
    ]
  });
}

export function normalizeCatalog(input) {
  if (!input || typeof input !== "object") throw new Error("Katalog bir JSON nesnesi olmalıdır.");
  const catalog = {
    schemaVersion: numberOr(input.schemaVersion, 1),
    levels: Array.isArray(input.levels) ? input.levels.map(normalizeLevel) : []
  };
  catalog.levels.sort((a, b) => a.levelNumber - b.levelNumber);
  return catalog;
}

export function normalizeLevel(input = {}, index = 0) {
  const levelNumber = positiveInt(input.levelNumber, index + 1);
  const items = Array.isArray(input.items) ? input.items.map((item, itemIndex) => ({
    itemId: textOr(item?.itemId ?? item?.id, `item_${itemIndex + 1}`),
    product: textOr(item?.product, "Apple"),
    blockerIds: normalizeBlockerIds(item?.blockerIds)
  })) : [];
  const moveLimit = positiveInt(input.performance?.moveLimit, Math.max(items.length, 1));
  const timeLimitSeconds = positiveNumber(input.performance?.timeLimitSeconds, 45);
  return {
    levelNumber,
    levelId: textOr(input.levelId, `level_${String(levelNumber).padStart(3, "0")}`),
    displayName: textOr(input.displayName, `Bölüm ${levelNumber}`),
    trayCapacity: positiveInt(input.trayCapacity, 7),
    matchSize: positiveInt(input.matchSize, 3),
    goalDescription: textOr(input.goalDescription, DEFAULT_GOAL),
    goalItemCount: positiveInt(input.goalItemCount, items.length || 1),
    performance: {
      moveLimit,
      timeLimitSeconds,
      threeStarMaxMoves: positiveInt(input.performance?.threeStarMaxMoves, Math.min(moveLimit, Math.max(items.length, 1))),
      twoStarMaxMoves: positiveInt(input.performance?.twoStarMaxMoves, moveLimit),
      threeStarMinTimeSeconds: nonNegativeNumber(input.performance?.threeStarMinTimeSeconds, Math.round(timeLimitSeconds * 0.45)),
      twoStarMinTimeSeconds: nonNegativeNumber(input.performance?.twoStarMinTimeSeconds, Math.round(timeLimitSeconds * 0.15))
    },
    items
  };
}

export function normalizeBlockerIds(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (value === null || value === undefined || String(value).trim() === "") return [];
  return String(value).split(/[|,;]/).map(item => item.trim()).filter(Boolean);
}

export function validateCatalog(input, options = {}) {
  const catalog = normalizeCatalog(input);
  const issues = [];
  if (catalog.schemaVersion !== 1) issues.push(issue("error", "catalog.schema", "schemaVersion değeri 1 olmalıdır."));
  if (!catalog.levels.length) issues.push(issue("error", "catalog.empty", "Katalogda en az bir level bulunmalıdır."));
  const ids = new Set();
  const numbers = new Set();
  catalog.levels.forEach((level, index) => {
    if (ids.has(level.levelId)) issues.push(issue("error", "level.duplicate-id", `Tekrarlanan levelId: ${level.levelId}`, level.levelNumber));
    if (numbers.has(level.levelNumber)) issues.push(issue("error", "level.duplicate-number", `Tekrarlanan levelNumber: ${level.levelNumber}`, level.levelNumber));
    if (options.requireSequential !== false && level.levelNumber !== index + 1) issues.push(issue("error", "level.sequence", `Level sırası ${index + 1} olmalıdır.`, level.levelNumber));
    ids.add(level.levelId);
    numbers.add(level.levelNumber);
    issues.push(...validateLevel(level));
  });
  return { valid: !issues.some(item => item.severity === "error"), issues, catalog };
}

export function validateLevel(input) {
  const level = normalizeLevel(input);
  const issues = [];
  if (!/^level_[0-9]{3,}$/.test(level.levelId)) issues.push(issue("warning", "level.id-format", "levelId için level_001 biçimi önerilir.", level.levelNumber));
  if (level.matchSize < 2) issues.push(issue("error", "level.match-size", "matchSize en az 2 olmalıdır.", level.levelNumber));
  if (level.trayCapacity < level.matchSize) issues.push(issue("error", "level.tray-capacity", "Tepsi kapasitesi eşleşme boyutundan küçük olamaz.", level.levelNumber));
  if (!level.items.length) return [...issues, issue("error", "level.items-empty", "Level en az bir ürün içermelidir.", level.levelNumber)];
  if (level.goalItemCount !== level.items.length) issues.push(issue("error", "level.goal-count", "Hedef ürün sayısı gerçek ürün sayısıyla aynı olmalıdır.", level.levelNumber));
  if (level.performance.moveLimit < level.items.length) issues.push(issue("error", "level.move-limit", "Hamle limiti ürün sayısından az olamaz.", level.levelNumber));
  if (level.performance.threeStarMaxMoves > level.performance.twoStarMaxMoves || level.performance.twoStarMaxMoves > level.performance.moveLimit) issues.push(issue("error", "level.star-moves", "Yıldız hamle eşikleri sıralı olmalıdır.", level.levelNumber));
  if (level.performance.twoStarMinTimeSeconds > level.performance.threeStarMinTimeSeconds || level.performance.threeStarMinTimeSeconds > level.performance.timeLimitSeconds) issues.push(issue("error", "level.star-time", "Yıldız süre eşikleri sıralı olmalıdır.", level.levelNumber));

  const itemMap = new Map();
  const productCounts = new Map();
  for (const item of level.items) {
    if (itemMap.has(item.itemId)) issues.push(issue("error", "item.duplicate-id", `Tekrarlanan itemId: ${item.itemId}`, level.levelNumber, item.itemId));
    itemMap.set(item.itemId, item);
    if (!PRODUCT_IDS.includes(item.product)) issues.push(issue("error", "item.product", `Geçersiz ürün: ${item.product}`, level.levelNumber, item.itemId));
    productCounts.set(item.product, (productCounts.get(item.product) || 0) + 1);
    const blockers = new Set();
    for (const blocker of item.blockerIds) {
      if (blocker === item.itemId) issues.push(issue("error", "item.self-blocker", "Ürün kendisini engelleyemez.", level.levelNumber, item.itemId));
      if (blockers.has(blocker)) issues.push(issue("error", "item.duplicate-blocker", `Tekrarlanan blocker: ${blocker}`, level.levelNumber, item.itemId));
      blockers.add(blocker);
    }
  }
  for (const item of level.items) for (const blocker of item.blockerIds) if (!itemMap.has(blocker)) issues.push(issue("error", "item.missing-blocker", `Blocker bulunamadı: ${blocker}`, level.levelNumber, item.itemId));
  for (const [product, count] of productCounts) if (count % level.matchSize !== 0) issues.push(issue("error", "level.product-count", `${product} adedi ${level.matchSize} ile tam bölünmelidir.`, level.levelNumber));
  if (hasBlockerCycle(level.items)) issues.push(issue("error", "level.blocker-cycle", "Blocker bağlantılarında döngü bulundu.", level.levelNumber));
  if (!issues.some(item => item.severity === "error") && !solveLevel(level).solvable) issues.push(issue("error", "level.unsolvable", "Level tepsi ve blocker kurallarıyla çözülemiyor.", level.levelNumber));
  return issues;
}

export function solveLevel(input) {
  const level = normalizeLevel(input);
  if (level.items.length > 30) return { solvable: false, exploredStates: 0, minimumMoves: 0, reason: "solver-limit" };
  const indexById = new Map(level.items.map((item, index) => [item.itemId, index]));
  const blockerMasks = level.items.map(item => item.blockerIds.reduce((mask, id) => {
    const index = indexById.get(id);
    return index === undefined ? mask : mask | (1 << index);
  }, 0));
  const productIndexes = new Map(PRODUCT_IDS.map((product, index) => [product, index]));
  const products = level.items.map(item => productIndexes.get(item.product) ?? 0);
  const initialMask = (1 << level.items.length) - 1;
  const memo = new Set();
  let exploredStates = 0;

  function search(mask, tray, moves) {
    if (mask === 0) return moves;
    const key = `${mask}:${tray.join(".")}`;
    if (memo.has(key)) return null;
    memo.add(key);
    exploredStates++;
    for (let index = 0; index < level.items.length; index++) {
      const bit = 1 << index;
      if (!(mask & bit) || (blockerMasks[index] & mask) !== 0) continue;
      const nextTray = tray.slice();
      const productIndex = products[index];
      nextTray[productIndex]++;
      if (nextTray[productIndex] >= level.matchSize) nextTray[productIndex] -= level.matchSize;
      if (nextTray.reduce((sum, count) => sum + count, 0) > level.trayCapacity) continue;
      const result = search(mask & ~bit, nextTray, moves + 1);
      if (result !== null) return result;
    }
    return null;
  }

  const minimumMoves = search(initialMask, Array(PRODUCT_IDS.length).fill(0), 0);
  return { solvable: minimumMoves !== null, exploredStates, minimumMoves: minimumMoves ?? 0 };
}

export function calculateDifficulty(input) {
  const level = normalizeLevel(input);
  const solution = solveLevel(level);
  const blockerCount = level.items.reduce((sum, item) => sum + item.blockerIds.length, 0);
  const maxBlockerDepth = blockerDepth(level.items);
  const productVariety = new Set(level.items.map(item => item.product)).size;
  const trayPressure = Math.max(0, level.matchSize + productVariety - level.trayCapacity);
  const movePressure = Math.max(0, level.items.length / Math.max(1, level.performance.moveLimit));
  const timePressure = Math.max(0, level.items.length / Math.max(1, level.performance.timeLimitSeconds / 6));
  const score = clamp(1 + productVariety * 0.45 + blockerCount * 0.22 + maxBlockerDepth * 0.55 + trayPressure * 0.8 + movePressure + timePressure + Math.log10(solution.exploredStates + 1) * 0.65, 1, 10);
  return {
    levelNumber: level.levelNumber,
    levelId: level.levelId,
    displayName: level.displayName,
    score: Number(score.toFixed(1)),
    band: score < 3.5 ? "Kolay" : score < 6.5 ? "Orta" : score < 8.5 ? "Zor" : "Çok Zor",
    solvable: solution.solvable,
    exploredStates: solution.exploredStates,
    minimumMoves: solution.minimumMoves,
    blockerCount,
    maxBlockerDepth,
    productVariety,
    trayCapacity: level.trayCapacity
  };
}

export function buildDifficultyReport(input) {
  const catalog = normalizeCatalog(input);
  const levels = catalog.levels.map(calculateDifficulty);
  const averageScore = levels.length ? Number((levels.reduce((sum, item) => sum + item.score, 0) / levels.length).toFixed(1)) : 0;
  return { generatedAt: new Date().toISOString(), averageScore, levels };
}

export function difficultyReportToCsv(report) {
  const header = ["levelNumber", "levelId", "displayName", "score", "band", "solvable", "minimumMoves", "blockerCount", "maxBlockerDepth", "productVariety", "trayCapacity", "exploredStates"];
  const rows = report.levels.map(level => header.map(key => csvCell(level[key])).join(","));
  return `\uFEFF${header.join(",")}\n${rows.join("\n")}\n`;
}

export function exportCatalogJson(input) {
  const catalog = normalizeCatalog(input);
  return `${JSON.stringify({
    schemaVersion: catalog.schemaVersion,
    levels: catalog.levels.map(level => ({
      ...level,
      items: level.items.map(item => ({ itemId: item.itemId, product: item.product, blockerIds: item.blockerIds }))
    }))
  }, null, 2)}\n`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  for (let index = 0; index <= source.length; index++) {
    const char = source[index] ?? "\n";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { value += '"'; index++; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value.replace(/\r$/, "")); if (row.some(cell => cell.trim() !== "")) rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(header => header.trim());
  return rows.slice(1).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

export function importRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Excel/CSV dosyasında veri bulunamadı.");
  const normalized = rows.map(row => Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeKey(key), value])));
  const groups = new Map();
  for (const row of normalized) {
    const levelNumber = positiveInt(read(row, "levelnumber", "level", "bolum"), 0);
    if (!levelNumber) throw new Error("Her satırda geçerli bir levelNumber bulunmalıdır.");
    if (!groups.has(levelNumber)) groups.set(levelNumber, []);
    groups.get(levelNumber).push(row);
  }
  const levels = [...groups.entries()].sort(([a], [b]) => a - b).map(([levelNumber, group]) => {
    const first = group[0];
    const items = group.map((row, index) => ({
      itemId: textOr(read(row, "itemid", "item", "urunkimligi"), `item_${index + 1}`),
      product: textOr(read(row, "product", "urun"), "Apple"),
      blockerIds: normalizeBlockerIds(read(row, "blockerids", "blockers", "engeller"))
    }));
    return normalizeLevel({
      levelNumber,
      levelId: read(first, "levelid", "kimlik"),
      displayName: read(first, "displayname", "levelname", "bolumadi"),
      trayCapacity: read(first, "traycapacity", "tepsikapasitesi"),
      matchSize: read(first, "matchsize", "eslesme"),
      goalDescription: read(first, "goaldescription", "hedef"),
      goalItemCount: read(first, "goalitemcount", "hedefurun"),
      performance: {
        moveLimit: read(first, "movelimit", "hamle"),
        timeLimitSeconds: read(first, "timelimitseconds", "sure"),
        threeStarMaxMoves: read(first, "threestarmaxmoves", "3yildizhamle"),
        twoStarMaxMoves: read(first, "twostarmaxmoves", "2yildizhamle"),
        threeStarMinTimeSeconds: read(first, "threestarminTimeSeconds", "3yildizsure"),
        twoStarMinTimeSeconds: read(first, "twostarminTimeSeconds", "2yildizsure")
      },
      items
    });
  });
  return normalizeCatalog({ schemaVersion: 1, levels });
}

function hasBlockerCycle(items) {
  const graph = new Map(items.map(item => [item.itemId, item.blockerIds]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const blocker of graph.get(id) || []) if (graph.has(blocker) && visit(blocker)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  return items.some(item => visit(item.itemId));
}

function blockerDepth(items) {
  const graph = new Map(items.map(item => [item.itemId, item.blockerIds]));
  const memo = new Map();
  function depth(id, seen = new Set()) {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return 0;
    const nextSeen = new Set(seen).add(id);
    const value = (graph.get(id) || []).reduce((max, blocker) => Math.max(max, 1 + depth(blocker, nextSeen)), 0);
    memo.set(id, value); return value;
  }
  return items.reduce((max, item) => Math.max(max, depth(item.itemId)), 0);
}

function issue(severity, code, message, levelNumber = null, itemId = null) { return { severity, code, message, levelNumber, itemId }; }
function normalizeKey(value) { return String(value).toLocaleLowerCase("tr-TR").replace(/[\s_\-.()]/g, "").replace(/[ıİ]/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c"); }
function read(row, ...keys) { for (const key of keys) { const value = row[normalizeKey(key)]; if (value !== undefined && value !== null && String(value).trim() !== "") return value; } return undefined; }
function textOr(value, fallback) { const text = String(value ?? "").trim(); return text || fallback; }
function numberOr(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function positiveInt(value, fallback) { const number = Math.trunc(Number(value)); return Number.isFinite(number) && number > 0 ? number : fallback; }
function positiveNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function nonNegativeNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function csvCell(value) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
