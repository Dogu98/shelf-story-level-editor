export const LEVELS_REPOSITORY_PATH = "Assets/Resources/Levels/levels.json";

export class GitHubApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.details = details;
  }
}

export function sanitizeBranchName(value) {
  let branch = String(value ?? "").trim().replace(/^refs\/heads\//i, "").replace(/\s+/g, "-").replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/\.{2,}/g, ".").replace(/\/{2,}/g, "/").replace(/(^|\/)\.+(?=\/|$)/g, "$1").replace(/(^|\/)\-+/g, "$1").replace(/[-./]+$/g, "").replace(/^[-./]+/g, "");
  if (branch.includes("@{")) branch = branch.replace(/@\{/g, "-");
  if (branch.endsWith(".lock")) branch = `${branch.slice(0, -5)}-lock`;
  return branch.slice(0, 120);
}

export function createDefaultContentBranchName(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `content/levels-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function buildCatalogChangeSummary(baseCatalog, nextCatalog) {
  const baseLevels = Array.isArray(baseCatalog?.levels) ? baseCatalog.levels : [];
  const nextLevels = Array.isArray(nextCatalog?.levels) ? nextCatalog.levels : [];
  const base = new Map(baseLevels.map(level => [String(level.levelId || level.levelNumber), level]));
  const next = new Map(nextLevels.map(level => [String(level.levelId || level.levelNumber), level]));
  const result = { baseCount: baseLevels.length, nextCount: nextLevels.length, added: [], changed: [], removed: [], unchanged: [] };
  for (const [key, level] of next) {
    if (!base.has(key)) result.added.push(levelSummary(level));
    else if (stableJson(base.get(key)) !== stableJson(level)) result.changed.push(levelSummary(level));
    else result.unchanged.push(levelSummary(level));
  }
  for (const [key, level] of base) if (!next.has(key)) result.removed.push(levelSummary(level));
  const sort = (a, b) => a.levelNumber - b.levelNumber || a.levelId.localeCompare(b.levelId);
  for (const key of ["added", "changed", "removed", "unchanged"]) result[key].sort(sort);
  result.hasChanges = result.added.length + result.changed.length + result.removed.length > 0;
  return result;
}

export function encodeUtf8Base64(value) {
  const text = String(value ?? "");
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeUtf8Base64(value) {
  const encoded = String(value ?? "").replace(/\s/g, "");
  if (typeof Buffer !== "undefined") return Buffer.from(encoded, "base64").toString("utf8");
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHubPublisher {
  constructor(token, fetchImplementation = globalThis.fetch) {
    if (!String(token ?? "").trim()) throw new Error("GitHub tokenı gereklidir.");
    if (typeof fetchImplementation !== "function") throw new Error("Fetch desteği bulunamadı.");
    this.token = String(token).trim();
    this.fetch = fetchImplementation;
  }

  async preview({ owner, repo, baseBranch = "main", path = LEVELS_REPOSITORY_PATH, nextCatalog }) {
    validateRepositoryInput(owner, repo, baseBranch);
    const [reference, file] = await Promise.all([this.getBranchReference(owner, repo, baseBranch), this.getFile(owner, repo, path, baseBranch)]);
    let baseCatalog;
    try { baseCatalog = JSON.parse(file.text); }
    catch (error) { throw new GitHubApiError(`Private repodaki level JSON okunamadı: ${error.message}`); }
    return {
      owner, repo, baseBranch, path,
      baseSha: reference.object.sha,
      baseFileSha: file.sha,
      baseCatalog,
      nextCatalog,
      nextJson: `${JSON.stringify(nextCatalog, null, 2)}\n`,
      summary: buildCatalogChangeSummary(baseCatalog, nextCatalog)
    };
  }

  async publish({ prepared, newBranch, commitMessage, createPullRequest = true, pullRequestTitle = "Level içerik güncellemesi" }) {
    if (!prepared?.summary?.hasChanges) throw new Error("Commit edilecek level değişikliği bulunamadı.");
    const branch = sanitizeBranchName(newBranch);
    if (!branch) throw new Error("Geçerli bir yeni dal adı girin.");
    if (branch === prepared.baseBranch) throw new Error("Yeni dal base branch ile aynı olamaz.");
    if (!String(commitMessage ?? "").trim()) throw new Error("Commit mesajı gereklidir.");
    await this.createBranch(prepared.owner, prepared.repo, branch, prepared.baseSha);
    const commit = await this.updateFile(prepared.owner, prepared.repo, prepared.path, branch, prepared.baseFileSha, prepared.nextJson, String(commitMessage).trim());
    let pullRequest = null, pullRequestError = null;
    if (createPullRequest) {
      try { pullRequest = await this.createPullRequest(prepared.owner, prepared.repo, branch, prepared.baseBranch, String(pullRequestTitle || "Level içerik güncellemesi").trim(), buildPullRequestBody(prepared.summary)); }
      catch (error) { pullRequestError = error; }
    }
    return {
      branch, commit, pullRequest, pullRequestError,
      branchUrl: `https://github.com/${prepared.owner}/${prepared.repo}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`
    };
  }

  async getBranchReference(owner, repo, branch) { return this.request(`/repos/${encode(owner)}/${encode(repo)}/git/ref/heads/${encodePath(branch)}`); }
  async getFile(owner, repo, path, ref) {
    const result = await this.request(`/repos/${encode(owner)}/${encode(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
    if (!result?.sha || typeof result.content !== "string") throw new GitHubApiError("GitHub dosya yanıtı beklenen biçimde değil.");
    return { ...result, text: decodeUtf8Base64(result.content) };
  }
  async createBranch(owner, repo, branch, sha) { return this.request(`/repos/${encode(owner)}/${encode(repo)}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha } }); }
  async updateFile(owner, repo, path, branch, sha, content, message) { return this.request(`/repos/${encode(owner)}/${encode(repo)}/contents/${encodePath(path)}`, { method: "PUT", body: { message, content: encodeUtf8Base64(content), branch, sha } }); }
  async createPullRequest(owner, repo, head, base, title, body) { return this.request(`/repos/${encode(owner)}/${encode(repo)}/pulls`, { method: "POST", body: { title, head, base, body, draft: true } }); }

  async request(path, options = {}) {
    const response = await this.fetch(`https://api.github.com${path}`, {
      method: options.method || "GET",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch { payload = { message: text }; } }
    if (!response.ok) throw new GitHubApiError(payload?.message || `GitHub API isteği başarısız oldu (${response.status}).`, response.status, payload);
    return payload;
  }
}

export function buildPullRequestBody(summary) {
  const list = (label, values) => values.length ? `- **${label}:** ${values.map(level => `${level.levelNumber} (${level.levelId})`).join(", ")}` : `- **${label}:** Yok`;
  return ["## Web Level Editörü", "", "Bu taslak PR, public Shelf Story Level Editörü tarafından oluşturuldu.", "", `- **Önceki level sayısı:** ${summary.baseCount}`, `- **Yeni level sayısı:** ${summary.nextCount}`, list("Eklenen", summary.added), list("Değişen", summary.changed), list("Silinen", summary.removed), "", "Birleştirmeden önce private oyun reposundaki smoke testlerinin tamamlanması beklenmelidir."].join("\n");
}

function validateRepositoryInput(owner, repo, baseBranch) { if (!String(owner ?? "").trim()) throw new Error("GitHub kullanıcı adı gereklidir."); if (!String(repo ?? "").trim()) throw new Error("Repo adı gereklidir."); if (!String(baseBranch ?? "").trim()) throw new Error("Base branch gereklidir."); }
function levelSummary(level) { return { levelNumber: Number(level?.levelNumber || 0), levelId: String(level?.levelId || ""), displayName: String(level?.displayName || "") }; }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function encode(value) { return encodeURIComponent(String(value)); }
function encodePath(value) { return String(value).split("/").map(encodeURIComponent).join("/"); }
