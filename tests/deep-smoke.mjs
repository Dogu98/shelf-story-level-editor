import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PRODUCT_IDS,
  buildDifficultyReport,
  calculateDifficulty,
  createDefaultLevel,
  createEmptyCatalog,
  difficultyReportToCsv,
  exportCatalogJson,
  importRows,
  normalizeBlockerIds,
  normalizeCatalog,
  normalizeLevel,
  parseCsv,
  solveLevel,
  validateCatalog,
  validateLevel
} from "../src/level-editor-core.mjs";
import {
  GitHubApiError,
  GitHubPublisher,
  LEVELS_REPOSITORY_PATH,
  buildCatalogChangeSummary,
  createDefaultContentBranchName,
  decodeUtf8Base64,
  encodeUtf8Base64,
  sanitizeBranchName
} from "../src/github-publish-core.mjs";

const production = JSON.parse(await readFile("levels.json", "utf8"));
let passed = 0;
let total = 0;

await run("production catalog contains twenty sequential levels", () => {
  assert.equal(production.schemaVersion, 1);
  assert.equal(production.levels.length, 20);
  assert.deepEqual(production.levels.map(level => level.levelNumber), Array.from({ length: 20 }, (_, index) => index + 1));
});

await run("production identifiers are globally unique", () => {
  const levelIds = production.levels.map(level => level.levelId);
  const itemIds = production.levels.flatMap(level => level.items.map(item => item.itemId));
  assert.equal(new Set(levelIds).size, levelIds.length);
  assert.equal(new Set(itemIds).size, itemIds.length);
});

await run("production catalog passes every validator", () => {
  const report = validateCatalog(production);
  assert.equal(report.valid, true, report.issues.map(issue => `${issue.code}: ${issue.message}`).join("\n"));
});

await run("every production level is deterministically solvable", () => {
  for (const level of production.levels) {
    const first = solveLevel(level);
    const second = solveLevel(level);
    assert.equal(first.solvable, true, level.levelId);
    assert.deepEqual(first, second, level.levelId);
    assert.equal(first.minimumMoves, level.items.length);
    assert.ok(first.exploredStates > 0);
  }
});

await run("production performance thresholds are internally ordered", () => {
  for (const level of production.levels) {
    const rules = level.performance;
    assert.ok(rules.threeStarMaxMoves <= rules.twoStarMaxMoves);
    assert.ok(rules.twoStarMaxMoves <= rules.moveLimit);
    assert.ok(rules.twoStarMinTimeSeconds <= rules.threeStarMinTimeSeconds);
    assert.ok(rules.threeStarMinTimeSeconds <= rules.timeLimitSeconds);
  }
});

await run("default level is immediately valid and solvable", () => {
  const level = createDefaultLevel(21);
  assert.equal(validateLevel(level).filter(issue => issue.severity === "error").length, 0);
  assert.equal(solveLevel(level).solvable, true);
});

await run("legacy id fields normalize to itemId", () => {
  const level = normalizeLevel({ ...baseLevel(), items: [{ id: "legacy_1", product: "Apple", blockerIds: [] }, { id: "legacy_2", product: "Apple", blockerIds: [] }, { id: "legacy_3", product: "Apple", blockerIds: [] }], goalItemCount: 3, performance: rules(3) });
  assert.deepEqual(level.items.map(item => item.itemId), ["legacy_1", "legacy_2", "legacy_3"]);
});

await run("blocker text accepts pipe comma semicolon and arrays", () => {
  assert.deepEqual(normalizeBlockerIds("a|b,c;d"), ["a", "b", "c", "d"]);
  assert.deepEqual(normalizeBlockerIds([" a ", "", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeBlockerIds(null), []);
});

await run("empty catalog is rejected", () => assertIssue(validateCatalog(createEmptyCatalog()), "catalog.empty"));
await run("unsupported schema is rejected", () => assertIssue(validateCatalog({ schemaVersion: 2, levels: [baseLevel()] }), "catalog.schema"));
await run("duplicate level id is rejected", () => assertIssue(validateCatalog({ schemaVersion: 1, levels: [baseLevel(1, "level_001"), baseLevel(2, "level_001")] }), "level.duplicate-id"));
await run("duplicate level number is rejected", () => assertIssue(validateCatalog({ schemaVersion: 1, levels: [baseLevel(1, "level_001"), baseLevel(1, "level_002")] }), "level.duplicate-number"));
await run("non sequential levels are rejected", () => assertIssue(validateCatalog({ schemaVersion: 1, levels: [baseLevel(2, "level_002")] }), "level.sequence"));

await run("duplicate item id is rejected", () => {
  const level = baseLevel();
  level.items[1].itemId = level.items[0].itemId;
  assertIssue({ issues: validateLevel(level) }, "item.duplicate-id");
});

await run("invalid product is rejected", () => {
  const level = baseLevel();
  level.items[0].product = "NotAProduct";
  assertIssue({ issues: validateLevel(level) }, "item.product");
});

await run("missing blocker is rejected", () => {
  const level = baseLevel();
  level.items[3].blockerIds = ["missing"];
  assertIssue({ issues: validateLevel(level) }, "item.missing-blocker");
});

await run("self blocker is rejected", () => {
  const level = baseLevel();
  level.items[0].blockerIds = [level.items[0].itemId];
  assertIssue({ issues: validateLevel(level) }, "item.self-blocker");
});

await run("duplicate blocker is rejected", () => {
  const level = baseLevel();
  level.items[3].blockerIds = ["apple_1", "apple_1"];
  assertIssue({ issues: validateLevel(level) }, "item.duplicate-blocker");
});

await run("blocker cycle is rejected", () => {
  const level = baseLevel();
  level.items[0].blockerIds = ["apple_2"];
  level.items[1].blockerIds = ["apple_1"];
  assertIssue({ issues: validateLevel(level) }, "level.blocker-cycle");
});

await run("non divisible product count is rejected", () => {
  const level = baseLevel();
  level.items.pop();
  level.goalItemCount = 5;
  level.performance = rules(5);
  assertIssue({ issues: validateLevel(level) }, "level.product-count");
});

await run("goal count mismatch is rejected", () => {
  const level = baseLevel();
  level.goalItemCount = 5;
  assertIssue({ issues: validateLevel(level) }, "level.goal-count");
});

await run("move limit below item count is rejected", () => {
  const level = baseLevel();
  level.performance.moveLimit = 5;
  level.performance.twoStarMaxMoves = 5;
  level.performance.threeStarMaxMoves = 5;
  assertIssue({ issues: validateLevel(level) }, "level.move-limit");
});

await run("invalid star move ordering is rejected", () => {
  const level = baseLevel();
  level.performance.threeStarMaxMoves = 8;
  level.performance.twoStarMaxMoves = 7;
  assertIssue({ issues: validateLevel(level) }, "level.star-moves");
});

await run("invalid star time ordering is rejected", () => {
  const level = baseLevel();
  level.performance.twoStarMinTimeSeconds = 30;
  level.performance.threeStarMinTimeSeconds = 20;
  assertIssue({ issues: validateLevel(level) }, "level.star-time");
});

await run("tray capacity below match size is rejected", () => {
  const level = baseLevel();
  level.trayCapacity = 2;
  assertIssue({ issues: validateLevel(level) }, "level.tray-capacity");
});

await run("exact full tray without a match is a losing state", () => {
  const level = forcedExactCapacityLevel();
  const solution = solveLevel(level);
  assert.equal(solution.solvable, false);
  assertIssue({ issues: validateLevel(level) }, "level.unsolvable");
});

await run("a match clearing at capacity remains legal", () => {
  const level = normalizeLevel({
    ...baseLevel(), trayCapacity: 3, goalItemCount: 3, performance: rules(3),
    items: [1, 2, 3].map(index => ({ itemId: `a${index}`, product: "Apple", blockerIds: [] }))
  });
  assert.equal(solveLevel(level).solvable, true);
});

await run("solver reports its thirty item safety boundary", () => {
  const level = baseLevel();
  level.items = Array.from({ length: 31 }, (_, index) => ({ itemId: `x${index}`, product: "Apple", blockerIds: [] }));
  level.goalItemCount = 31;
  level.performance = rules(31);
  assert.equal(solveLevel(level).reason, "solver-limit");
});

await run("difficulty values remain bounded and deterministic", () => {
  for (const level of production.levels) {
    const first = calculateDifficulty(level);
    const second = calculateDifficulty(level);
    assert.ok(first.score >= 1 && first.score <= 10);
    assert.deepEqual(first, second);
  }
});

await run("difficulty report covers the full catalog", () => {
  const report = buildDifficultyReport(production);
  assert.equal(report.levels.length, 20);
  assert.ok(report.averageScore >= 1 && report.averageScore <= 10);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
});

await run("difficulty CSV is BOM prefixed and safely quoted", () => {
  const report = buildDifficultyReport({ schemaVersion: 1, levels: [{ ...baseLevel(), displayName: 'Virgül, "Test"' }] });
  const csv = difficultyReportToCsv(report);
  assert.ok(csv.startsWith("\uFEFFlevelNumber"));
  assert.match(csv, /"Virgül, ""Test"""/);
});

await run("comma CSV handles BOM CRLF commas and escaped quotes", () => {
  const csv = '\uFEFFBölüm,Bölüm Adı,Ürün\r\n1,"Kahve, ""Özel""",Coffee\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows[0]["Bölüm Adı"], 'Kahve, "Özel"');
});

await run("semicolon CSV from Turkish Excel is detected", () => {
  const rows = parseCsv('Bölüm;Bölüm Adı;Ürün\r\n1;"Elma; Süt";Apple\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Bölüm Adı"], "Elma; Süt");
  assert.equal(rows[0].Ürün, "Apple");
});

await run("Excel style rows group items by level", () => {
  const imported = importRows([
    row(1, "a1", "Apple"), row(1, "a2", "Apple"), row(1, "a3", "Apple"),
    row(2, "b1", "Bread"), row(2, "b2", "Bread"), row(2, "b3", "Bread")
  ]);
  assert.equal(imported.levels.length, 2);
  assert.equal(imported.levels[0].items.length, 3);
  assert.equal(imported.levels[1].items.length, 3);
});

await run("rows without a level number are rejected", () => {
  assert.throws(() => importRows([{ Ürün: "Apple" }]), /levelNumber/);
});

await run("Unity JSON export uses itemId and a final newline", () => {
  const output = exportCatalogJson(production);
  const parsed = JSON.parse(output);
  assert.ok(output.endsWith("\n"));
  assert.ok(Object.hasOwn(parsed.levels[0].items[0], "itemId"));
  assert.equal(Object.hasOwn(parsed.levels[0].items[0], "id"), false);
});

await run("catalog change summary ignores object key order", () => {
  const left = { levels: [{ levelNumber: 1, levelId: "level_001", displayName: "A", x: 1, y: 2 }] };
  const right = { levels: [{ y: 2, x: 1, displayName: "A", levelId: "level_001", levelNumber: 1 }] };
  assert.equal(buildCatalogChangeSummary(left, right).hasChanges, false);
});

await run("catalog change summary reports add change remove", () => {
  const summary = buildCatalogChangeSummary(
    { levels: [{ levelNumber: 1, levelId: "a", displayName: "A" }, { levelNumber: 2, levelId: "b", displayName: "B" }] },
    { levels: [{ levelNumber: 1, levelId: "a", displayName: "A2" }, { levelNumber: 3, levelId: "c", displayName: "C" }] }
  );
  assert.deepEqual([summary.added.length, summary.changed.length, summary.removed.length], [1, 1, 1]);
});

await run("branch names are safe and timestamped", () => {
  assert.equal(sanitizeBranchName(" refs/heads/content/Level Güncelleme.lock "), "content/Level-G-ncelleme-lock");
  assert.equal(createDefaultContentBranchName(new Date(2026, 7, 6, 11, 5)), "content/levels-20260806-1105");
});

await run("unicode JSON survives base64 conversion", () => {
  const value = JSON.stringify({ title: "Çikolata, süt ve kahve ☕" });
  assert.equal(decodeUtf8Base64(encodeUtf8Base64(value)), value);
});

await run("publisher preview reads branch and current private JSON", async () => {
  const requests = [];
  const publisher = new GitHubPublisher("token", routeFetch(requests, {
    "/repos/Dogu98/shelf-story/git/ref/heads/main": [200, { object: { sha: "base-sha" } }],
    [`/repos/Dogu98/shelf-story/contents/${LEVELS_REPOSITORY_PATH}?ref=main`]: [200, { sha: "file-sha", content: encodeUtf8Base64(JSON.stringify(production)) }]
  }));
  const preview = await publisher.preview({ owner: "Dogu98", repo: "shelf-story", baseBranch: "main", nextCatalog: production });
  assert.equal(preview.baseSha, "base-sha");
  assert.equal(preview.baseFileSha, "file-sha");
  assert.equal(preview.summary.hasChanges, false);
  assert.equal(requests.every(request => request.headers.Authorization === "Bearer token"), true);
});

await run("publisher writes branch file then draft PR in order", async () => {
  const requests = [];
  const publisher = new GitHubPublisher("token", routeFetch(requests, {
    "/repos/Dogu98/shelf-story/git/refs": [201, { ref: "refs/heads/content/test" }],
    [`/repos/Dogu98/shelf-story/contents/${LEVELS_REPOSITORY_PATH}`]: [200, { commit: { sha: "commit-sha", html_url: "https://example/commit" } }],
    "/repos/Dogu98/shelf-story/pulls": [201, { number: 4, draft: true, html_url: "https://example/pr" }]
  }));
  const prepared = preparedChange();
  const result = await publisher.publish({ prepared, newBranch: "content/test", commitMessage: "content: test", createPullRequest: true });
  assert.deepEqual(requests.map(request => request.method), ["POST", "PUT", "POST"]);
  assert.equal(requests[0].body.ref, "refs/heads/content/test");
  assert.equal(requests[1].body.sha, "file-sha");
  assert.equal(requests[2].body.draft, true);
  assert.equal(result.pullRequest.number, 4);
});

for (const status of [401, 403, 404, 422]) {
  await run(`GitHub API preserves ${status} error status`, async () => {
    const publisher = new GitHubPublisher("token", async () => response(status, { message: `status-${status}` }));
    await assert.rejects(publisher.getBranchReference("Dogu98", "shelf-story", "main"), error => error instanceof GitHubApiError && error.status === status);
  });
}

await run("browser fetch keeps the global invocation context", async () => {
  const guarded = function () {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return Promise.resolve(response(200, { object: { sha: "ok" } }));
  };
  const publisher = new GitHubPublisher("token", guarded);
  assert.equal((await publisher.getBranchReference("Dogu98", "shelf-story", "main")).object.sha, "ok");
});

await run("token is never persisted and stale previews are blocked", async () => {
  const ui = await readFile("src/github-publish-ui.mjs", "utf8");
  assert.match(ui, /type=\"password\"/);
  assert.doesNotMatch(ui, /localStorage\.setItem\([^)]*token/i);
  assert.doesNotMatch(ui, /sessionStorage\.setItem/i);
  assert.match(ui, /previewSnapshot/);
  assert.match(ui, /Taslak ön izlemeden sonra değişti/);
});

await run("HTML references every required static asset", async () => {
  const html = await readFile("index.html", "utf8");
  for (const asset of ["styles.css", "github-publish.css", "src/app.mjs", "src/github-publish-ui.mjs"]) assert.match(html, new RegExp(asset.replaceAll(".", "\\.")));
  assert.match(html, /xlsx@0\.18\.5/);
  assert.match(html, /https:\/\/cdn\.jsdelivr\.net/);
});

await run("responsive CSS and modal breakpoints are present", async () => {
  const [styles, githubStyles] = await Promise.all([readFile("styles.css", "utf8"), readFile("github-publish.css", "utf8")]);
  assert.match(styles, /@media \(max-width: 1320px\)/);
  assert.match(githubStyles, /@media \(max-width:760px\)/);
});

await run("workflows use minimum repository permissions", async () => {
  const [smoke, pages] = await Promise.all([readFile(".github/workflows/smoke.yml", "utf8"), readFile(".github/workflows/pages.yml", "utf8")]);
  assert.match(smoke, /permissions:\s*\n\s*contents: read/);
  assert.match(pages, /contents: read/);
  assert.match(pages, /pages: write/);
  assert.match(pages, /id-token: write/);
  assert.doesNotMatch(pages, /contents: write/);
});

console.log(`DEEP PUBLIC EDITOR SMOKE PASS: ${passed}/${total} tests passed.`);

async function run(name, test) {
  total++;
  try { await test(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { console.error(`FAIL: ${name} - ${error.stack || error.message}`); process.exit(1); }
}

function baseLevel(levelNumber = 1, levelId = "level_001") {
  return {
    levelNumber, levelId, displayName: "Test", trayCapacity: 7, matchSize: 3,
    goalDescription: "Tüm ürünleri temizle", goalItemCount: 6, performance: rules(6),
    items: [
      { itemId: "apple_1", product: "Apple", blockerIds: [] },
      { itemId: "apple_2", product: "Apple", blockerIds: [] },
      { itemId: "apple_3", product: "Apple", blockerIds: [] },
      { itemId: "milk_1", product: "Milk", blockerIds: ["apple_1"] },
      { itemId: "milk_2", product: "Milk", blockerIds: ["apple_2"] },
      { itemId: "milk_3", product: "Milk", blockerIds: ["apple_3"] }
    ]
  };
}

function rules(itemCount) {
  return { moveLimit: itemCount, timeLimitSeconds: 60, threeStarMaxMoves: itemCount, twoStarMaxMoves: itemCount, threeStarMinTimeSeconds: 20, twoStarMinTimeSeconds: 5 };
}

function forcedExactCapacityLevel() {
  const sequence = [
    ["a1", "Apple", []],
    ["b1", "Bread", ["a1"]],
    ["a2", "Apple", ["b1"]],
    ["a3", "Apple", ["a2"]],
    ["b2", "Bread", ["a3"]],
    ["b3", "Bread", ["b2"]]
  ];
  return normalizeLevel({ ...baseLevel(), trayCapacity: 3, items: sequence.map(([itemId, product, blockerIds]) => ({ itemId, product, blockerIds })) });
}

function row(levelNumber, itemId, product) {
  return { Bölüm: levelNumber, "Bölüm Adı": `Bölüm ${levelNumber}`, "Tepsi Kapasitesi": 7, Eşleşme: 3, Hamle: 3, Süre: 45, "3 Yıldız Hamle": 3, "2 Yıldız Hamle": 3, "3 Yıldız Süre": 20, "2 Yıldız Süre": 5, "Hedef Ürün": 3, "Ürün Kimliği": itemId, Ürün: product, Engeller: "" };
}

function assertIssue(report, code) {
  assert.ok(report.issues.some(issue => issue.code === code), `Expected issue ${code}; got ${report.issues.map(issue => issue.code).join(", ")}`);
}

function preparedChange() {
  const next = structuredClone(production);
  next.levels[0].displayName += " Test";
  return {
    owner: "Dogu98", repo: "shelf-story", baseBranch: "main", path: LEVELS_REPOSITORY_PATH,
    baseSha: "base-sha", baseFileSha: "file-sha", nextCatalog: next,
    nextJson: `${JSON.stringify(next, null, 2)}\n`,
    summary: buildCatalogChangeSummary(production, next)
  };
}

function routeFetch(requests, routes) {
  return async (url, options = {}) => {
    const path = url.replace("https://api.github.com", "");
    const route = routes[path];
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, method, body, headers: options.headers || {} });
    if (!route) return response(404, { message: `Missing mock route ${path}` });
    return response(route[0], route[1]);
  };
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async text() { return payload === null ? "" : JSON.stringify(payload); } };
}
