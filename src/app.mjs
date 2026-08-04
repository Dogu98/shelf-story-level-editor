import {
  PRODUCT_IDS,
  buildDifficultyReport,
  createDefaultLevel,
  createEmptyCatalog,
  difficultyReportToCsv,
  exportCatalogJson,
  importRows,
  normalizeBlockerIds,
  normalizeCatalog,
  parseCsv,
  validateCatalog
} from "./level-editor-core.mjs";

const SAMPLE_LEVELS_URL = "./levels.json";
const DRAFT_KEY = "shelf-story-level-editor-draft-v1";
let catalog = restoreDraft() || createEmptyCatalog();
let selectedLevelNumber = catalog.levels[0]?.levelNumber ?? null;
let validation = validateCatalog(catalog, { requireSequential: false });
let difficulty = buildDifficultyReport(catalog);
let toastTimer = null;

const elements = {
  levelList: byId("level-list"), levelSearch: byId("level-search"), emptyEditor: byId("empty-editor"),
  editor: byId("level-editor"), editorTitle: byId("editor-title"), form: byId("level-form"),
  itemRows: byId("item-rows"), issueList: byId("issue-list"), validationBadge: byId("validation-badge"),
  summaryCards: byId("summary-cards"), difficultyChart: byId("difficulty-chart"),
  difficultyAverage: byId("difficulty-average"), selectedReport: byId("selected-report"),
  catalogCount: byId("catalog-count"), saveState: byId("save-state"), toast: byId("toast"),
  jsonFile: byId("json-file"), sheetFile: byId("sheet-file")
};

wireActions();
renderAll();

function wireActions() {
  byId("load-production").addEventListener("click", loadSampleCatalog);
  byId("new-catalog").addEventListener("click", newCatalog);
  byId("add-level").addEventListener("click", addLevel);
  byId("duplicate-level").addEventListener("click", duplicateLevel);
  byId("delete-level").addEventListener("click", deleteLevel);
  byId("add-item").addEventListener("click", addItem);
  byId("validate-now").addEventListener("click", () => analyze(true));
  byId("export-json").addEventListener("click", exportJson);
  byId("export-report").addEventListener("click", exportReport);
  byId("download-template").addEventListener("click", downloadTemplate);
  elements.levelSearch.addEventListener("input", renderLevelList);
  elements.jsonFile.addEventListener("change", event => readJson(event.target.files[0]));
  elements.sheetFile.addEventListener("change", event => readSheet(event.target.files[0]));
  elements.form.addEventListener("input", updateLevelFromForm);
  elements.itemRows.addEventListener("input", updateItem);
  elements.itemRows.addEventListener("click", removeItem);
}

async function loadSampleCatalog() {
  try {
    setStatus("Yükleniyor…");
    const response = await fetch(SAMPLE_LEVELS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setCatalog(await response.json(), 1);
    showToast("Public örnek kataloğundaki 20 level yüklendi.");
  } catch (error) {
    setStatus("Yükleme hatası", true);
    showToast(`Örnek katalog yüklenemedi: ${error.message}`, true);
  }
}

function newCatalog() {
  if (catalog.levels.length && !confirm("Mevcut taslak temizlensin mi?")) return;
  const next = createEmptyCatalog();
  next.levels.push(createDefaultLevel(1));
  setCatalog(next, 1);
}

function addLevel() {
  const nextNumber = catalog.levels.length ? Math.max(...catalog.levels.map(level => level.levelNumber)) + 1 : 1;
  catalog.levels.push(createDefaultLevel(nextNumber));
  selectedLevelNumber = nextNumber;
  commit("Yeni level eklendi.");
}

function duplicateLevel() {
  const level = selectedLevel();
  if (!level) return;
  const nextNumber = Math.max(0, ...catalog.levels.map(item => item.levelNumber)) + 1;
  const copy = structuredClone(level);
  copy.levelNumber = nextNumber;
  copy.levelId = `level_${String(nextNumber).padStart(3, "0")}`;
  copy.displayName = `${level.displayName} Kopyası`;
  copy.items = copy.items.map(item => ({ ...item, itemId: `${item.itemId}_${nextNumber}`, blockerIds: item.blockerIds.map(id => `${id}_${nextNumber}`) }));
  catalog.levels.push(copy);
  selectedLevelNumber = nextNumber;
  commit("Level kopyalandı.");
}

function deleteLevel() {
  const level = selectedLevel();
  if (!level || !confirm(`${level.displayName} silinsin mi?`)) return;
  catalog.levels = catalog.levels.filter(item => item !== level);
  selectedLevelNumber = catalog.levels[0]?.levelNumber ?? null;
  commit("Level silindi.");
}

function addItem() {
  const level = selectedLevel();
  if (!level) return;
  let index = level.items.length + 1;
  const ids = new Set(level.items.map(item => item.itemId));
  while (ids.has(`item_${index}`)) index++;
  level.items.push({ itemId: `item_${index}`, product: "Apple", blockerIds: [] });
  level.goalItemCount = level.items.length;
  level.performance.moveLimit = Math.max(level.performance.moveLimit, level.items.length);
  commit("Ürün eklendi.");
}

function removeItem(event) {
  const button = event.target.closest("[data-remove-item]");
  if (!button) return;
  const level = selectedLevel();
  if (!level) return;
  level.items.splice(Number(button.dataset.removeItem), 1);
  level.goalItemCount = Math.max(1, level.items.length);
  commit("Ürün kaldırıldı.");
}

function updateLevelFromForm(event) {
  const level = selectedLevel();
  const name = event.target.name;
  if (!level || !name) return;
  const numeric = new Set(["levelNumber", "trayCapacity", "matchSize", "goalItemCount", "moveLimit", "timeLimitSeconds", "threeStarMaxMoves", "twoStarMaxMoves", "threeStarMinTimeSeconds", "twoStarMinTimeSeconds"]);
  const value = numeric.has(name) ? Number(event.target.value) : event.target.value;
  if (Object.prototype.hasOwnProperty.call(level.performance, name)) level.performance[name] = value;
  else {
    level[name] = value;
    if (name === "levelNumber") selectedLevelNumber = Number(value);
  }
  commit(null, { keepForm: true });
}

function updateItem(event) {
  const input = event.target.closest("[data-item-index]");
  const level = selectedLevel();
  if (!input || !level) return;
  const item = level.items[Number(input.dataset.itemIndex)];
  if (!item) return;
  item[input.dataset.itemField] = input.dataset.itemField === "blockerIds" ? normalizeBlockerIds(input.value) : input.value;
  commit(null, { keepForm: true, keepItems: true });
}

async function readJson(file) {
  if (!file) return;
  try { setCatalog(JSON.parse(await file.text()), null); showToast(`${file.name} yüklendi.`); }
  catch (error) { showToast(`JSON okunamadı: ${error.message}`, true); }
  finally { elements.jsonFile.value = ""; }
}

async function readSheet(file) {
  if (!file) return;
  try {
    let rows;
    if (file.name.toLowerCase().endsWith(".csv")) rows = parseCsv(await file.text());
    else {
      if (!window.XLSX) throw new Error("Excel kütüphanesi yüklenemedi. CSV kullanabilirsiniz.");
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
      rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    }
    const imported = importRows(rows);
    setCatalog(imported, imported.levels[0]?.levelNumber);
    showToast(`${imported.levels.length} level aktarıldı.`);
  } catch (error) { showToast(`Aktarım başarısız: ${error.message}`, true); }
  finally { elements.sheetFile.value = ""; }
}

function exportJson() {
  const result = validateCatalog(catalog);
  if (!result.valid) return showToast("Önce doğrulama hatalarını düzeltin.", true);
  download(exportCatalogJson(catalog), "levels.json", "application/json;charset=utf-8");
  showToast("Unity uyumlu levels.json indirildi.");
}

function exportReport() {
  if (!catalog.levels.length) return showToast("Rapor için level gerekir.", true);
  download(difficultyReportToCsv(buildDifficultyReport(catalog)), "level-difficulty-report.csv", "text/csv;charset=utf-8");
}

function downloadTemplate() {
  const rows = [
    templateRow("apple_1", "Apple", ""), templateRow("apple_2", "Apple", ""), templateRow("apple_3", "Apple", ""),
    templateRow("milk_1", "Milk", "apple_1"), templateRow("milk_2", "Milk", "apple_2"), templateRow("milk_3", "Milk", "apple_3")
  ];
  if (window.XLSX) {
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, window.XLSX.utils.json_to_sheet(rows), "Levels");
    window.XLSX.writeFile(workbook, "shelf-story-level-template.xlsx");
  } else {
    const headers = Object.keys(rows[0]);
    download([headers.join(","), ...rows.map(row => headers.map(key => row[key]).join(","))].join("\n"), "shelf-story-level-template.csv", "text/csv;charset=utf-8");
  }
}

function templateRow(itemId, product, blockerIds) {
  return { levelNumber:1, levelId:"level_001", displayName:"Elma ve Süt", trayCapacity:7, matchSize:3, goalDescription:"Tüm ürünleri eşleştir ve rafı temizle", goalItemCount:6, moveLimit:8, timeLimitSeconds:45, threeStarMaxMoves:6, twoStarMaxMoves:8, threeStarMinTimeSeconds:20, twoStarMinTimeSeconds:8, itemId, product, blockerIds };
}

function setCatalog(input, preferred = null) {
  catalog = normalizeCatalog(input);
  selectedLevelNumber = preferred ?? catalog.levels[0]?.levelNumber ?? null;
  commit();
}

function commit(message = null, options = {}) {
  catalog.levels.sort((a, b) => a.levelNumber - b.levelNumber);
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(catalog)); } catch { /* private mode */ }
  analyze(false, options);
  if (message) showToast(message);
}

function analyze(showMessage = false, options = {}) {
  validation = validateCatalog(catalog, { requireSequential: false });
  difficulty = buildDifficultyReport(catalog);
  renderLevelList();
  if (!options.keepForm) renderEditor(); else if (!options.keepItems) renderItems();
  renderInsights();
  elements.catalogCount.textContent = `${catalog.levels.length} level`;
  const errorCount = validation.issues.filter(item => item.severity === "error").length;
  setStatus(errorCount ? "Hata var" : "Taslak kaydedildi", Boolean(errorCount));
  if (showMessage) showToast(errorCount ? `${errorCount} hata bulundu.` : "Tüm level verileri geçerli.", Boolean(errorCount));
}

function renderAll() { analyze(); }

function renderLevelList() {
  const query = elements.levelSearch.value.trim().toLocaleLowerCase("tr-TR");
  const reports = new Map(difficulty.levels.map(item => [item.levelNumber, item]));
  const visible = catalog.levels.filter(level => !query || `${level.levelNumber} ${level.levelId} ${level.displayName}`.toLocaleLowerCase("tr-TR").includes(query));
  elements.levelList.innerHTML = visible.map(level => {
    const report = reports.get(level.levelNumber);
    return `<button class="level-card ${level.levelNumber === selectedLevelNumber ? "active" : ""}" data-level-number="${level.levelNumber}"><span class="level-number">${level.levelNumber}</span><span class="level-name"><strong>${escapeHtml(level.displayName)}</strong><span>${escapeHtml(level.levelId)}</span></span><span class="level-score">${report?.score?.toFixed(1) ?? "—"}</span></button>`;
  }).join("") || '<div class="empty-state" style="min-height:180px;padding:15px"><p>Level bulunamadı.</p></div>';
  elements.levelList.querySelectorAll("[data-level-number]").forEach(button => button.addEventListener("click", () => {
    selectedLevelNumber = Number(button.dataset.levelNumber); renderLevelList(); renderEditor(); renderSelectedReport();
  }));
}

function renderEditor() {
  const level = selectedLevel();
  elements.emptyEditor.hidden = Boolean(level); elements.editor.hidden = !level;
  if (!level) return;
  elements.editorTitle.textContent = `${level.displayName} • ${level.levelId}`;
  const values = { levelNumber:level.levelNumber, levelId:level.levelId, displayName:level.displayName, trayCapacity:level.trayCapacity, matchSize:level.matchSize, goalDescription:level.goalDescription, goalItemCount:level.goalItemCount, ...level.performance };
  for (const [name, value] of Object.entries(values)) { const input = elements.form.elements.namedItem(name); if (input) input.value = value; }
  renderItems();
}

function renderItems() {
  const level = selectedLevel(); if (!level) return;
  elements.itemRows.innerHTML = level.items.map((item, index) => `<tr><td class="item-index">${index + 1}</td><td><input data-item-index="${index}" data-item-field="itemId" value="${escapeAttribute(item.itemId)}"></td><td><select data-item-index="${index}" data-item-field="product">${PRODUCT_IDS.map(product => `<option ${product === item.product ? "selected" : ""}>${product}</option>`).join("")}</select></td><td><input data-item-index="${index}" data-item-field="blockerIds" value="${escapeAttribute(item.blockerIds.join(" | "))}" placeholder="apple_1 | apple_2"></td><td><button class="remove-item" type="button" data-remove-item="${index}">×</button></td></tr>`).join("");
}

function renderInsights() {
  const errors = validation.issues.filter(item => item.severity === "error");
  const warnings = validation.issues.filter(item => item.severity === "warning");
  elements.summaryCards.innerHTML = [["Level",catalog.levels.length],["Ürün",catalog.levels.reduce((sum,level)=>sum+level.items.length,0)],["Hata",errors.length],["Uyarı",warnings.length]].map(([label,value]) => `<div class="summary-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  elements.validationBadge.className = `badge ${errors.length ? "error" : warnings.length ? "warning" : "success"}`;
  elements.validationBadge.textContent = errors.length ? `${errors.length} hata` : warnings.length ? `${warnings.length} uyarı` : "Geçerli";
  const issues = validation.issues.filter(item => item.levelNumber === null || item.levelNumber === selectedLevelNumber).slice(0, 12);
  elements.issueList.innerHTML = issues.length ? issues.map(item => `<div class="issue ${item.severity}"><strong>${item.severity === "error" ? "Hata" : "Uyarı"} • ${escapeHtml(item.code)}</strong>${escapeHtml(item.message)}</div>`).join("") : '<div class="issue-empty">Seçili levelde sorun bulunamadı.</div>';
  elements.difficultyAverage.textContent = difficulty.levels.length ? `Ort. ${difficulty.averageScore}` : "—";
  elements.difficultyChart.innerHTML = difficulty.levels.map(item => `<div class="difficulty-row" title="${escapeAttribute(item.displayName)} • ${item.band}"><span>${item.levelNumber}</span><div class="difficulty-track"><div class="difficulty-fill" style="width:${item.score * 10}%"></div></div><span class="difficulty-value">${item.score.toFixed(1)}</span></div>`).join("") || '<div class="empty-report">Level eklediğinizde zorluk eğrisi gösterilir.</div>';
  renderSelectedReport();
}

function renderSelectedReport() {
  const report = difficulty.levels.find(item => item.levelNumber === selectedLevelNumber);
  if (!report) { elements.selectedReport.className = "selected-report empty-report"; elements.selectedReport.textContent = "Bir level seçin."; return; }
  elements.selectedReport.className = "selected-report";
  elements.selectedReport.innerHTML = `<div class="report-hero"><strong>${report.score.toFixed(1)} / 10</strong><span>${escapeHtml(report.band)} • ${report.solvable ? "Çözülebilir" : "Çözülemiyor"}</span></div><div class="report-grid">${[["Ürün çeşidi",report.productVariety],["Blocker",report.blockerCount],["Blocker derinliği",report.maxBlockerDepth],["Minimum hamle",report.minimumMoves || "—"],["Tepsi",report.trayCapacity],["Aranan durum",report.exploredStates]].map(([label,value]) => `<div class="report-metric"><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}

function selectedLevel() { return catalog.levels.find(level => level.levelNumber === selectedLevelNumber) || null; }
function restoreDraft() { try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? normalizeCatalog(JSON.parse(raw)) : null; } catch { return null; } }
function download(content, fileName, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
function setStatus(message, error = false) { elements.saveState.textContent = message; elements.saveState.style.background = error ? "var(--red-soft)" : "var(--green-soft)"; elements.saveState.style.color = error ? "var(--red)" : "var(--green)"; }
function showToast(message, error = false) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.className = `toast visible${error ? " error" : ""}`; toastTimer = setTimeout(() => elements.toast.className = "toast", 3600); }
function byId(id) { return document.getElementById(id); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
