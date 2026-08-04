import { exportCatalogJson, normalizeCatalog, validateCatalog } from "./level-editor-core.mjs";
import { GitHubPublisher, createDefaultContentBranchName, sanitizeBranchName } from "./github-publish-core.mjs";

const DRAFT_KEY = "shelf-story-level-editor-draft-v1";
const DEFAULT_REPOSITORY = "Dogu98/shelf-story";
let prepared = null, publisher = null, previewSnapshot = null;

install();

function install() {
  const toolbar = document.querySelector(".toolbar");
  if (!toolbar || document.getElementById("github-publish")) return;
  const button = document.createElement("button");
  button.id = "github-publish";
  button.className = "button github-button";
  button.type = "button";
  button.textContent = "GitHub’a Kaydet";
  toolbar.insertBefore(button, toolbar.querySelector(".toolbar-spacer"));
  document.body.insertAdjacentHTML("beforeend", modalMarkup());
  button.addEventListener("click", openModal);
  byId("github-modal-close").addEventListener("click", closeModal);
  byId("github-modal-cancel").addEventListener("click", closeModal);
  byId("github-modal-backdrop").addEventListener("click", event => { if (event.target === event.currentTarget) closeModal(); });
  byId("github-preview").addEventListener("click", previewChanges);
  byId("github-commit").addEventListener("click", commitChanges);
  byId("github-approve").addEventListener("change", updateCommitAvailability);
  byId("github-branch").addEventListener("input", event => { event.target.value = sanitizeBranchName(event.target.value); resetPreview("Dal adı değişti; yeniden ön izleme yapın."); });
  for (const id of ["github-repository", "github-base", "github-commit-message", "github-create-pr", "github-pr-title"]) byId(id).addEventListener("change", () => resetPreview("Yayın ayarları değişti; yeniden ön izleme yapın."));
}

function openModal() {
  byId("github-repository").value = DEFAULT_REPOSITORY;
  byId("github-base").value = "main";
  byId("github-branch").value = createDefaultContentBranchName();
  byId("github-commit-message").value = "content: update level catalog from public web editor";
  byId("github-pr-title").value = "Level içerik güncellemesi";
  byId("github-create-pr").checked = true;
  byId("github-approve").checked = false;
  byId("github-token").value = "";
  prepared = publisher = previewSnapshot = null;
  renderPreview(null);
  setStatus("Token yalnızca bu pencere açıkken bellekte tutulur.");
  byId("github-modal-backdrop").hidden = false;
  document.body.classList.add("modal-open");
  setTimeout(() => byId("github-token").focus(), 0);
}

function closeModal() {
  byId("github-token").value = "";
  prepared = publisher = previewSnapshot = null;
  byId("github-modal-backdrop").hidden = true;
  document.body.classList.remove("modal-open");
}

async function previewChanges() {
  try {
    setBusy(true, "Private repodaki güncel levels.json okunuyor…");
    const catalog = currentCatalog();
    const validation = validateCatalog(catalog);
    if (!validation.valid) throw new Error(`Katalogda ${validation.issues.filter(item => item.severity === "error").length} hata var.`);
    const token = byId("github-token").value.trim();
    if (!token) throw new Error("Fine-grained GitHub tokenı girin.");
    const { owner, repo } = parseRepository(byId("github-repository").value);
    const baseBranch = byId("github-base").value.trim();
    const branch = sanitizeBranchName(byId("github-branch").value);
    if (!branch) throw new Error("Geçerli bir yeni dal adı girin.");
    if (branch === baseBranch) throw new Error("Yeni dal base branch ile aynı olamaz.");
    previewSnapshot = exportCatalogJson(catalog);
    publisher = new GitHubPublisher(token);
    prepared = await publisher.preview({ owner, repo, baseBranch, nextCatalog: JSON.parse(previewSnapshot) });
    renderPreview(prepared.summary);
    byId("github-approve").checked = false;
    setStatus(prepared.summary.hasChanges ? "Ön izleme hazır. Değişiklikleri kontrol edip onaylayın." : "Private repodaki JSON ile taslak aynı; commit oluşturulmayacak.", !prepared.summary.hasChanges);
  } catch (error) {
    prepared = publisher = previewSnapshot = null;
    renderPreview(null);
    setStatus(formatError(error), true);
  } finally { setBusy(false); }
}

async function commitChanges() {
  try {
    if (!prepared || !publisher) throw new Error("Önce ön izleme oluşturun.");
    if (!byId("github-approve").checked) throw new Error("Ön izlemeyi onaylamanız gerekiyor.");
    if (exportCatalogJson(currentCatalog()) !== previewSnapshot) return resetPreview("Taslak ön izlemeden sonra değişti. Yeniden ön izleme yapın.", true);
    setBusy(true, "Yeni dal oluşturuluyor ve levels.json commit ediliyor…");
    const result = await publisher.publish({ prepared, newBranch: byId("github-branch").value, commitMessage: byId("github-commit-message").value, createPullRequest: byId("github-create-pr").checked, pullRequestTitle: byId("github-pr-title").value });
    renderSuccess(result);
    byId("github-token").value = "";
    prepared = publisher = previewSnapshot = null;
    byId("github-approve").checked = false;
  } catch (error) { setStatus(formatError(error), true); }
  finally { setBusy(false); }
}

function currentCatalog() {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) throw new Error("Kaydedilmiş level taslağı bulunamadı.");
  try { return normalizeCatalog(JSON.parse(raw)); }
  catch (error) { throw new Error(`Yerel taslak okunamadı: ${error.message}`); }
}

function renderPreview(summary) {
  const container = byId("github-preview-result");
  if (!summary) {
    container.className = "github-preview empty";
    container.innerHTML = "<p>Ön izleme sonrasında eklenen, değişen ve silinen leveller burada görünür.</p>";
    return updateCommitAvailability();
  }
  container.className = "github-preview";
  container.innerHTML = `<div class="github-summary-grid">${card("Önce",summary.baseCount)}${card("Sonra",summary.nextCount)}${card("Eklenen",summary.added.length)}${card("Değişen",summary.changed.length)}${card("Silinen",summary.removed.length)}</div>${section("Eklenen leveller",summary.added,"added")}${section("Değişen leveller",summary.changed,"changed")}${section("Silinen leveller",summary.removed,"removed")}${summary.hasChanges ? "" : '<div class="github-no-change">Değişiklik bulunamadı.</div>'}`;
  updateCommitAvailability();
}

function renderSuccess(result) {
  const commitUrl = result.commit?.commit?.html_url || result.commit?.content?.html_url || result.branchUrl;
  const prLink = result.pullRequest?.html_url ? `<a class="github-result-link" href="${escapeAttribute(result.pullRequest.html_url)}" target="_blank" rel="noopener">Taslak PR’ı Aç</a>` : "";
  const warning = result.pullRequestError ? `<p class="github-result-warning">Dal ve commit oluşturuldu; PR açılamadı: ${escapeHtml(formatError(result.pullRequestError))}</p>` : "";
  const container = byId("github-preview-result");
  container.className = "github-preview success-result";
  container.innerHTML = `<h3>GitHub kaydı tamamlandı</h3><p><strong>${escapeHtml(result.branch)}</strong> dalı oluşturuldu ve levels.json commit edildi.</p><div class="github-result-actions"><a class="github-result-link" href="${escapeAttribute(result.branchUrl)}" target="_blank" rel="noopener">Dalı Aç</a><a class="github-result-link" href="${escapeAttribute(commitUrl)}" target="_blank" rel="noopener">Commit’i Aç</a>${prLink}</div>${warning}`;
  setStatus(result.pullRequest ? "Commit ve taslak PR oluşturuldu." : "Commit yeni dala kaydedildi.");
}

function resetPreview(message, error = false) {
  if (!prepared && !previewSnapshot) return;
  prepared = publisher = previewSnapshot = null;
  byId("github-approve").checked = false;
  renderPreview(null);
  setStatus(message, error);
}
function updateCommitAvailability() { byId("github-commit").disabled = !prepared?.summary?.hasChanges || !byId("github-approve").checked; }
function setBusy(busy, message = null) { byId("github-preview").disabled = busy; byId("github-modal-cancel").disabled = busy; byId("github-modal-close").disabled = busy; if (busy) byId("github-commit").disabled = true; else updateCommitAvailability(); if (message) setStatus(message); }
function setStatus(message, error = false) { const element = byId("github-publish-status"); element.textContent = message; element.className = `github-publish-status${error ? " error" : ""}`; }
function section(title, levels, type) { return levels.length ? `<section class="github-change-section ${type}"><h4>${title}</h4><div>${levels.map(level => `<span>${level.levelNumber} • ${escapeHtml(level.displayName || level.levelId)}</span>`).join("")}</div></section>` : ""; }
function card(label, value) { return `<div><span>${label}</span><strong>${value}</strong></div>`; }
function parseRepository(value) { const parts = String(value ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean); if (parts.length !== 2) throw new Error("Repo alanını owner/repo biçiminde girin."); return { owner: parts[0], repo: parts[1] }; }
function formatError(error) { if (error?.status === 401) return "Token geçersiz veya süresi dolmuş."; if (error?.status === 403) return "Tokenın private repo için Contents yazma izni yok."; if (error?.status === 404) return "Private repo, branch veya levels.json bulunamadı. Token erişimini kontrol edin."; if (error?.status === 422) return "Dal adı zaten kullanılıyor. Yeni bir dal adı deneyin."; return error?.message || String(error); }

function modalMarkup() {
  return `<div id="github-modal-backdrop" class="github-modal-backdrop" hidden><section class="github-modal" role="dialog" aria-modal="true" aria-labelledby="github-modal-title"><header class="github-modal-header"><div><p class="panel-kicker">ÖN İZLE • ONAYLA • COMMIT ET</p><h2 id="github-modal-title">Private Oyun Reposuna Kaydet</h2></div><button id="github-modal-close" class="github-modal-close" type="button" aria-label="Kapat">×</button></header><div class="github-security-note"><strong>Token kaydedilmez.</strong> Fine-grained token yalnızca bu pencere açıkken bellekte tutulur. Private repo için <code>Contents: Read and write</code>; taslak PR için ayrıca <code>Pull requests: Read and write</code> gerekir.</div><div class="github-form-grid"><label class="span-2">Fine-grained GitHub Token<input id="github-token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label><label>Private Repo<input id="github-repository" autocomplete="off" spellcheck="false"></label><label>Base Branch<input id="github-base" autocomplete="off" spellcheck="false"></label><label class="span-2">Yeni Dal<input id="github-branch" autocomplete="off" spellcheck="false"></label><label class="span-2">Commit Mesajı<input id="github-commit-message" autocomplete="off"></label><label class="github-check span-2"><input id="github-create-pr" type="checkbox"><span>Commit sonrasında taslak Pull Request oluştur</span></label><label class="span-2">PR Başlığı<input id="github-pr-title" autocomplete="off"></label></div><div id="github-publish-status" class="github-publish-status"></div><div id="github-preview-result" class="github-preview empty"></div><label class="github-approval"><input id="github-approve" type="checkbox"><span>Eklenen, değişen ve silinen levelleri kontrol ettim.</span></label><footer class="github-modal-footer"><button id="github-modal-cancel" class="button" type="button">Vazgeç</button><span></span><button id="github-preview" class="button" type="button">1. Ön İzleme Oluştur</button><button id="github-commit" class="button success" type="button" disabled>2. Onayla ve Commit Et</button></footer></section></div>`;
}
function byId(id) { return document.getElementById(id); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
