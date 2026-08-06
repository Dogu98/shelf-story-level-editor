import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDifficultyReport,
  exportCatalogJson,
  parseCsv,
  solveLevel,
  validateCatalog
} from "../src/level-editor-core.mjs";
import {
  GitHubPublisher,
  buildCatalogChangeSummary,
  createDefaultContentBranchName,
  decodeUtf8Base64,
  encodeUtf8Base64,
  sanitizeBranchName
} from "../src/github-publish-core.mjs";

let passed = 0;
let total = 0;

await run("ships the complete static editor", async () => {
  const files = await Promise.all(["index.html", "styles.css", "github-publish.css", "src/app.mjs", "src/level-editor-core.mjs", "src/github-publish-core.mjs", "src/github-publish-ui.mjs", "levels.json"].map(path => readFile(path, "utf8")));
  assert.ok(files.every(content => content.length > 50));
  assert.match(files[0], /GitHub’a Kaydet|github-publish-ui/);
});

await run("loads twenty sequential sample levels", async () => {
  const catalog = JSON.parse(await readFile("levels.json", "utf8"));
  assert.equal(catalog.levels.length, 20);
  assert.deepEqual(catalog.levels.map(level => level.levelNumber), Array.from({ length: 20 }, (_, index) => index + 1));
});

await run("validates every sample level", async () => {
  const result = validateCatalog(JSON.parse(await readFile("levels.json", "utf8")));
  assert.equal(result.valid, true, result.issues.map(issue => issue.message).join("\n"));
});

await run("solves every sample level with tray rules", async () => {
  const catalog = JSON.parse(await readFile("levels.json", "utf8"));
  assert.equal(catalog.levels.every(level => solveLevel(level).solvable), true);
});

await run("creates deterministic difficulty output", async () => {
  const catalog = JSON.parse(await readFile("levels.json", "utf8"));
  const first = buildDifficultyReport(catalog);
  const second = buildDifficultyReport(catalog);
  assert.equal(first.levels.length, 20);
  assert.deepEqual(first.levels.map(level => level.score), second.levels.map(level => level.score));
});

await run("exports Unity compatible itemId JSON", async () => {
  const catalog = JSON.parse(await readFile("levels.json", "utf8"));
  const output = JSON.parse(exportCatalogJson(catalog));
  assert.equal(output.levels[0].items[0].itemId, "l01_apple_1");
  assert.equal(Object.hasOwn(output.levels[0].items[0], "id"), false);
});

await run("imports Turkish CSV headers", () => {
  const rows = parseCsv("Bölüm,Bölüm Adı,Ürün Kimliği,Ürün,Engeller\n1,Deneme,a1,Apple,\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Bölüm Adı"], "Deneme");
});

await run("builds added changed removed preview", () => {
  const base = { levels: [{ levelNumber: 1, levelId: "level_001", displayName: "A" }, { levelNumber: 2, levelId: "level_002", displayName: "B" }] };
  const next = { levels: [{ levelNumber: 1, levelId: "level_001", displayName: "A2" }, { levelNumber: 3, levelId: "level_003", displayName: "C" }] };
  const summary = buildCatalogChangeSummary(base, next);
  assert.equal(summary.changed.length, 1);
  assert.equal(summary.added.length, 1);
  assert.equal(summary.removed.length, 1);
});

await run("sanitizes new branch names", () => {
  assert.equal(sanitizeBranchName(" refs/heads/content/Level Güncelleme.lock "), "content/Level-G-ncelleme-lock");
  assert.match(createDefaultContentBranchName(new Date(2026, 7, 4, 12, 23)), /^content\/levels-20260804-1223$/);
});

await run("round trips Turkish JSON through base64", () => {
  const input = '{"name":"Çikolata ve Süt"}\n';
  assert.equal(decodeUtf8Base64(encodeUtf8Base64(input)), input);
});

await run("invokes browser fetch with the global object", async () => {
  const guardedFetch = function () {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve({
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ object: { sha: "base-sha" } }); }
    });
  };
  const publisher = new GitHubPublisher("test-token", guardedFetch);
  const reference = await publisher.getBranchReference("Dogu98", "shelf-story", "main");
  assert.equal(reference.object.sha, "base-sha");
});

await run("never persists the GitHub token", async () => {
  const ui = await readFile("src/github-publish-ui.mjs", "utf8");
  assert.match(ui, /type=\"password\"/);
  assert.doesNotMatch(ui, /localStorage\.setItem\([^)]*token/i);
  assert.doesNotMatch(ui, /sessionStorage\.setItem/i);
});

console.log(`PUBLIC LEVEL EDITOR SMOKE PASS: ${passed}/${total} tests passed.`);

async function run(name, test) {
  total++;
  try { await test(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { console.error(`FAIL: ${name} - ${error.message}`); process.exit(1); }
}
