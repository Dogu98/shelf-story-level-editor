import assert from "node:assert/strict";

const base = "https://dogu98.github.io/shelf-story-level-editor";
const assets = [
  "/",
  "/levels.json",
  "/styles.css",
  "/github-publish.css",
  "/src/app.mjs",
  "/src/level-editor-core.mjs",
  "/src/github-publish-core.mjs",
  "/src/github-publish-ui.mjs"
];

const content = new Map();
for (const path of assets) {
  const response = await fetchWithRetry(`${base}${path}?smoke=${Date.now()}`);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  const text = await response.text();
  assert.ok(text.length > 40, `${path} was unexpectedly short`);
  content.set(path, text);
  console.log(`PASS: live ${path} (${text.length} bytes)`);
}

const html = content.get("/");
assert.match(html, /Level Editörü/);
assert.match(html, /src\/app\.mjs/);
assert.match(html, /src\/github-publish-ui\.mjs/);

const catalog = JSON.parse(content.get("/levels.json"));
assert.equal(catalog.schemaVersion, 1);
assert.equal(catalog.levels.length, 20);
assert.deepEqual(catalog.levels.map(level => level.levelNumber), Array.from({ length: 20 }, (_, index) => index + 1));

const core = content.get("/src/level-editor-core.mjs");
assert.match(core, /nextTotal >= level\.trayCapacity/);
assert.match(core, /detectCsvDelimiter/);

const githubCore = content.get("/src/github-publish-core.mjs");
assert.match(githubCore, /Reflect\.apply\(fetchImplementation, globalThis/);
assert.match(githubCore, /Assets\/Resources\/Levels\/levels\.json/);

const githubUi = content.get("/src/github-publish-ui.mjs");
assert.match(githubUi, /type=\"password\"/);
assert.doesNotMatch(githubUi, /localStorage\.setItem\([^)]*token/i);
assert.doesNotMatch(githubUi, /sessionStorage\.setItem/i);

console.log(`LIVE PAGES SMOKE PASS: ${assets.length + 8} checks passed.`);

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 3000));
  }
  throw lastError;
}
