import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as ts from "typescript";

const temporaryDirectories: string[] = [];

test.after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function proposalInput(title: string) {
  return {
    title,
    hypothesis:
      "A narrow local MCP experiment will remove one repeated setup step.",
    expectedValue: "A recorded local go/no-go decision.",
    smallestFirstStep:
      "Compare one fixture-backed local run with the baseline.",
    requiredTools: ["Node.js", "SQLite"],
    estimatedEffort: "20 minutes",
    risk: "A synthetic item may not represent production usage.",
    successCriteria: "One repeated setup step is removed.",
    verificationMethod:
      "Record both local runs and compare their step counts.",
  };
}

function tableCount(
  database: DatabaseSync,
  table: "source_items" | "analyses" | "rankings",
): number {
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get();
  const count = row?.["count"];
  if (typeof count !== "number") {
    throw new TypeError(`Expected a count for ${table}`);
  }
  return count;
}

const EXECUTABLE_SOURCE_SUFFIXES = [
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
] as const;

const LOCAL_INBOUND_ADAPTER = resolve(
  "src/features/rd-intelligence/api/local-api-server.ts",
);

const SAFE_SOURCE_MODULES = new Set([
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:sqlite",
  "node:util",
]);

const SAFE_PACKAGE_SCRIPTS = {
  build: "tsc -p tsconfig.json",
  typecheck: "tsc -p tsconfig.json --noEmit",
  "db:init":
    "npm run build --silent && node dist/src/features/rd-intelligence/cli/init-db.js",
  "pipeline:fixture":
    "npm run build --silent && node dist/src/features/rd-intelligence/cli/run-fixture.js",
  "api:local":
    "npm run build --silent && node dist/src/features/rd-intelligence/cli/run-local-api.js",
  test: "npm run build --silent && node --test dist/tests/*.test.js",
  "test:unit":
    "npm run build --silent && node --test dist/tests/foundation.test.js dist/tests/analysis-ranking.test.js",
  "test:integration":
    "npm run build --silent && node --test dist/tests/pipeline.test.js dist/tests/experiment.test.js dist/tests/content-draft.test.js dist/tests/daily-digest.test.js dist/tests/local-api.test.js dist/tests/closed-loop.test.js",
  "test:local-api":
    "npm run build --silent && node --test dist/tests/local-api.test.js",
  "test:foundation":
    "npm run build --silent && node --test dist/tests/foundation.test.js",
} as const;

function executableSources(
  directory: string,
): readonly {
  readonly path: string;
  readonly contents: string;
}[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return executableSources(path);
      if (
        !entry.isFile() ||
        !EXECUTABLE_SOURCE_SUFFIXES.some((suffix) =>
          entry.name.endsWith(suffix),
        )
      ) {
        return [];
      }
      return [{ path, contents: readFileSync(path, "utf8") }];
    },
  );
}

function assertNoExternalWriteCapability(
  path: string,
  source: string,
): void {
  const isLocalInboundAdapter = path === LOCAL_INBOUND_ADAPTER;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".js") ||
      path.endsWith(".mjs") ||
      path.endsWith(".cjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS,
  );
  const importDeclarations = sourceFile.statements.filter(
    ts.isImportDeclaration,
  );
  const staticModuleEntries: {
    readonly specifier: string;
    readonly lexicalSpecifier: string;
  }[] = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      staticModuleEntries.push({
        specifier: statement.moduleSpecifier.text,
        lexicalSpecifier:
          statement.moduleSpecifier.getText(sourceFile),
      });
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression !== undefined &&
      ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      staticModuleEntries.push({
        specifier: statement.moduleReference.expression.text,
        lexicalSpecifier:
          statement.moduleReference.expression.getText(sourceFile),
      });
    }
  }
  for (const entry of staticModuleEntries) {
    const allowed =
      entry.specifier.startsWith("./") ||
      entry.specifier.startsWith("../") ||
      SAFE_SOURCE_MODULES.has(entry.specifier) ||
      (isLocalInboundAdapter &&
        entry.specifier === "node:http" &&
        entry.lexicalSpecifier === '"node:http"');
    assert.equal(
      allowed,
      true,
      `${path} uses an unreviewed static module specifier: ${entry.lexicalSpecifier}`,
    );
  }
  const loaderCalls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword) {
        loaderCalls.push("dynamic import");
      } else if (
        ts.isIdentifier(expression) &&
        [
          "require",
          "createRequire",
          "getBuiltinModule",
          "eval",
          "Function",
        ].includes(expression.text)
      ) {
        loaderCalls.push(expression.text);
      } else if (
        ts.isPropertyAccessExpression(expression) &&
        ((ts.isIdentifier(expression.expression) &&
          expression.expression.text === "process" &&
          ["binding", "dlopen", "getBuiltinModule"].includes(
            expression.name.text,
          )) ||
          (ts.isIdentifier(expression.expression) &&
            expression.expression.text === "module" &&
            ["createRequire", "register", "registerHooks"].includes(
              expression.name.text,
            )))
      ) {
        loaderCalls.push(expression.getText(sourceFile));
      } else if (
        ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        (expression.expression.text === "process" ||
          expression.expression.text === "module") &&
        expression.argumentExpression !== undefined &&
        ts.isStringLiteralLike(expression.argumentExpression) &&
        [
          "binding",
          "dlopen",
          "getBuiltinModule",
          "createRequire",
          "register",
          "registerHooks",
        ].includes(expression.argumentExpression.text)
      ) {
        loaderCalls.push(expression.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.deepEqual(
    loaderCalls,
    [],
    `${path} must not call a dynamic module, code, or native loader`,
  );

  assert.doesNotMatch(
    source,
    /\b(?:import|require)\s*\(|\b(?:createRequire|getBuiltinModule)\b|\bprocess\s*\.\s*(?:binding|dlopen)\s*\(|\bmodule\s*\.\s*(?:register|registerHooks)\s*\(/u,
    `${path} uses a dynamic module or native loader`,
  );
  assert.doesNotMatch(
    source,
    /(["'`])(?:undici|node-fetch|axios|got|superagent)\1/u,
    `${path} imports an outbound HTTP client package`,
  );
  assert.doesNotMatch(
    source,
    /\bfetch\b/u,
    `${path} captures or invokes fetch`,
  );
  assert.doesNotMatch(
    source,
    /\b(?:WebSocket|EventSource)\b/u,
    `${path} uses a browser-style outbound transport`,
  );
  assert.doesNotMatch(
    source,
    /\b(?:setTimeout|setInterval|setImmediate)\b/u,
    `${path} creates an autonomous timer`,
  );
  assert.doesNotMatch(
    source,
    /\b(?:cron|scheduleJob)\b/iu,
    `${path} introduces a scheduler`,
  );
  assert.doesNotMatch(
    source,
    /\b(?:ClientRequest|globalAgent)\b/u,
    `${path} exposes an outbound HTTP client identifier`,
  );
  assert.doesNotMatch(
    source,
    /\beval\s*\(|\b(?:new\s+)?Function\s*\(/u,
    `${path} uses dynamic native or code loading`,
  );
  assert.doesNotMatch(
    source,
    /(?:api\.(?:x|twitter)\.com|graph\.(?:facebook|instagram)\.com|\/2\/tweets\b|statuses\/update|media_publish|createTweet|postTweet)/iu,
    `${path} contains a social publishing endpoint`,
  );

  if (isLocalInboundAdapter) {
    const httpImports = importDeclarations.filter(
      (declaration) =>
        ts.isStringLiteralLike(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text.replace(/^node:/u, "").split(
          "/",
          1,
        )[0] === "http",
    );
    assert.equal(
      httpImports.length,
      1,
      `${path} must contain the one reviewed static named node:http import`,
    );
    const httpImport = httpImports[0];
    assert.ok(httpImport);
    assert.equal(
      httpImport.moduleSpecifier.getText(sourceFile),
      '"node:http"',
      `${path} must use the literal node:http module specifier`,
    );
    const importClause = httpImport.importClause;
    assert.ok(importClause);
    assert.equal(importClause.isTypeOnly, false);
    assert.equal(importClause.name, undefined);
    assert.ok(
      importClause.namedBindings !== undefined &&
        ts.isNamedImports(importClause.namedBindings),
      `${path} must use named imports rather than a namespace import`,
    );
    assert.deepEqual(
      importClause.namedBindings.elements.map((element) => ({
        imported: (element.propertyName ?? element.name).text,
        local: element.name.text,
        typeOnly: element.isTypeOnly,
      })),
      [
        {
          imported: "createServer",
          local: "createServer",
          typeOnly: false,
        },
        {
          imported: "IncomingMessage",
          local: "IncomingMessage",
          typeOnly: true,
        },
        {
          imported: "RequestListener",
          local: "RequestListener",
          typeOnly: true,
        },
        {
          imported: "Server",
          local: "Server",
          typeOnly: true,
        },
        {
          imported: "ServerResponse",
          local: "ServerResponse",
          typeOnly: true,
        },
      ],
      `${path} must import only the reviewed inbound HTTP identifiers`,
    );
    assert.deepEqual(
      staticModuleEntries.filter(
        ({ specifier }) =>
          specifier.replace(/^node:/u, "").split("/", 1)[0] ===
          "http",
      ),
      [
        {
          specifier: "node:http",
          lexicalSpecifier: '"node:http"',
        },
      ],
      `${path} must have node:http as its only execution/network capability specifier`,
    );
    assert.equal(
      source.match(/\.listen\s*\(/gu)?.length,
      1,
      `${path} must have exactly one listen call`,
    );
    assert.match(
      source,
      /export const LOCAL_API_HOST = "127\.0\.0\.1";/u,
      `${path} must fix the bind host to IPv4 loopback`,
    );
    assert.match(
      source,
      /server\.listen\(port, LOCAL_API_HOST,/u,
      `${path} must bind with the fixed loopback constant`,
    );
    for (const assignment of [
      "server.requestTimeout = LOCAL_API_TIMEOUTS.request;",
      "server.headersTimeout = LOCAL_API_TIMEOUTS.headers;",
      "server.keepAliveTimeout = LOCAL_API_TIMEOUTS.keepAlive;",
      "server.timeout = LOCAL_API_TIMEOUTS.socket;",
      "server.maxRequestsPerSocket =",
    ]) {
      assert.ok(
        source.includes(assignment),
        `${path} must set finite inbound server bounds: ${assignment}`,
      );
    }
    assert.doesNotMatch(
      source,
      /(?:0\.0\.0\.0|\[?::\]?|localhost)/u,
      `${path} must not include a wildcard or alternate bind host`,
    );
    assert.doesNotMatch(
      source,
      /access-control-allow-origin/iu,
      `${path} must not enable cross-origin access`,
    );
  } else {
    assert.doesNotMatch(
      source,
      /\.listen\s*\(/u,
      `${path} must not open another listener`,
    );
  }

  if (path.includes(join("src", "api"))) {
    assert.doesNotMatch(
      source,
      /\/api\/[^"']*publish/iu,
      `${path} must not expose a publish endpoint`,
    );
  }
}

function assertSafePackageManifest(): void {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve("package.json"), "utf8"),
  );
  assert.ok(
    typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed),
    "package.json must contain an object",
  );
  const manifest = parsed as Readonly<Record<string, unknown>>;
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    assert.deepEqual(
      manifest[field] ?? {},
      {},
      `package.json ${field} must stay empty for this local stage`,
    );
  }
  assert.equal(
    manifest["imports"],
    undefined,
    "package.json must not alias hidden module capabilities",
  );
  assert.deepEqual(
    manifest["scripts"],
    SAFE_PACKAGE_SCRIPTS,
    "package scripts must stay within the reviewed local build, CLI, and test entrypoints",
  );
  assert.deepEqual(
    manifest["devDependencies"],
    {
      "@types/node": "22.20.1",
      typescript: "5.9.3",
    },
    "development executables must remain pinned to the reviewed toolchain",
  );
}

test("closed-loop preflight permits only the reviewed static inbound HTTP import", () => {
  const source = readFileSync(LOCAL_INBOUND_ADAPTER, "utf8");
  assert.doesNotThrow(() => {
    assertNoExternalWriteCapability(LOCAL_INBOUND_ADAPTER, source);
  });

  const namespaceImport = source.replace(
    /import \{\n  createServer,[\s\S]*?\n\} from "node:http";/u,
    'import * as http from "node:http";',
  );
  assert.notEqual(namespaceImport, source);
  const rejectedVariants = [
    namespaceImport,
    source.replace('"node:http"', '"http"'),
    source.replace("  createServer,", "  request,"),
    `${source}\nimport { request as outbound } from "node:http";`,
    `${source}\nvoid import("node:" + "http");`,
    `${source}\nconst hidden = require("node:http");`,
    `${source}\nprocess.getBuiltinModule("node:http");`,
  ];
  for (const variant of rejectedVariants) {
    assert.throws(() => {
      assertNoExternalWriteCapability(
        LOCAL_INBOUND_ADAPTER,
        variant,
      );
    });
  }
});

test("local R&D loop turns a manual import into reviewed evidence-backed draft and digest without publishing", async () => {
  const sources = executableSources(resolve("src"));
  assert.ok(sources.length > 0);
  for (const source of sources) {
    assertNoExternalWriteCapability(source.path, source.contents);
  }
  assertSafePackageManifest();
  const originalFetch = globalThis.fetch;
  let outboundFetchAttempts = 0;
  globalThis.fetch = (async () => {
    outboundFetchAttempts += 1;
    throw new Error("Closed-loop test blocked an outbound fetch");
  }) as typeof fetch;
  const tcpServersBefore = process
    .getActiveResourcesInfo()
    .filter((resource) => resource === "TCPServerWrap").length;
  let database: DatabaseSync | undefined;

  try {
    const [
      contentDraftModule,
      dailyDigestModule,
      experimentModule,
      pipelineModule,
      manualCollectorModule,
      loggerModule,
      fakeProviderModule,
      contentDraftRepositoryModule,
      dailyDigestRepositoryModule,
      experimentRepositoryModule,
      initializeModule,
      pipelineRepositoriesModule,
      localApiServerModule,
    ] = await Promise.all([
      import("../src/features/rd-intelligence/application/content-draft-service.js"),
      import("../src/features/rd-intelligence/application/daily-digest-service.js"),
      import("../src/features/rd-intelligence/application/experiment-service.js"),
      import("../src/features/rd-intelligence/application/research-pipeline.js"),
      import("../src/features/rd-intelligence/collectors/manual-import-collector.js"),
      import("../src/features/rd-intelligence/logging/logger.js"),
      import("../src/features/rd-intelligence/providers/fake-llm-provider.js"),
      import("../src/features/rd-intelligence/storage/sqlite/content-draft-repository.js"),
      import("../src/features/rd-intelligence/storage/sqlite/daily-digest-repository.js"),
      import("../src/features/rd-intelligence/storage/sqlite/experiment-repository.js"),
      import("../src/features/rd-intelligence/storage/sqlite/initialize.js"),
      import("../src/features/rd-intelligence/storage/sqlite/pipeline-repositories.js"),
      import("../src/features/rd-intelligence/api/local-api-server.js"),
    ]);
    assert.equal(localApiServerModule.LOCAL_API_HOST, "127.0.0.1");
    assert.deepEqual(localApiServerModule.LOCAL_API_TIMEOUTS, {
      request: 15_000,
      headers: 5_000,
      keepAlive: 2_000,
      socket: 15_000,
      maxRequestsPerSocket: 100,
    });
    assert.equal(
      process
        .getActiveResourcesInfo()
        .filter((resource) => resource === "TCPServerWrap").length,
      tcpServersBefore,
      "importing the inbound adapter must not open a listener",
    );
    assert.equal(
      outboundFetchAttempts,
      0,
      "importing the inbound adapter must not attempt an outbound fetch",
    );
    const {
      ContentDraftEvidenceViolationError,
      ContentDraftService,
    } = contentDraftModule;
    const { DailyDigestService } = dailyDigestModule;
    const { ExperimentService } = experimentModule;
    const { ResearchPipeline } = pipelineModule;
    const { ManualImportCollector } = manualCollectorModule;
    const { createLogger } = loggerModule;
    const { FakeLlmProvider } = fakeProviderModule;
    const { SqliteContentDraftRepository } =
      contentDraftRepositoryModule;
    const { SqliteDailyDigestRepository } =
      dailyDigestRepositoryModule;
    const { SqliteExperimentRepository } =
      experimentRepositoryModule;
    const { initializeDatabase } = initializeModule;
    const {
      SqliteAnalysisRepository,
      SqliteProcessingRunRepository,
      SqliteSourceItemRepository,
      SqliteTopicClusterRepository,
    } = pipelineRepositoriesModule;

    const directory = mkdtempSync(
      join(tmpdir(), "jarvis-rd-closed-loop-"),
    );
    temporaryDirectories.push(directory);
    const logger = createLogger(() => undefined);
    const initialized = initializeDatabase({
      databasePath: join(directory, "closed-loop.sqlite"),
      migrationsDirectory: resolve("migrations"),
      logger,
    });
    database = initialized.database;
    const sourceItems = new SqliteSourceItemRepository(database);
    const topicClusters = new SqliteTopicClusterRepository(database);
    const analyses = new SqliteAnalysisRepository(database);
    const processingRuns = new SqliteProcessingRunRepository(
      database,
    );
    const pipeline = new ResearchPipeline({
      repositories: {
        sourceItems,
        topicClusters,
        analyses,
        processingRuns,
      },
      llmProvider: new FakeLlmProvider(),
      logger,
      now: () => new Date("2026-07-28T03:00:00.000Z"),
    });
    const manualCollector = new ManualImportCollector([
      {
        sourceType: "manual",
        sourceExternalId: "closed-loop-manual-001",
        title: "MCPのローカル検証候補",
        author: "Synthetic Local Author",
        content:
          "合成データです。MCPとTypeScriptを使った小さな実験を、SQLiteへ記録して比較します。https://github.com/modelcontextprotocol/typescript-sdk",
        canonicalUrl:
          "https://example.test/manual/closed-loop-001?utm_source=fixture",
        publishedAt: "2026-07-28T10:00:00+09:00",
        sourceMetadata: {
          synthetic: true,
          importMethod: "manual",
        },
        topicUrl:
          "https://github.com/modelcontextprotocol/typescript-sdk",
      },
    ]);

    const firstCollection = await pipeline.run(manualCollector);
    const duplicateCollection = await pipeline.run(manualCollector);

    assert.deepEqual(
      {
        status: firstCollection.status,
        received: firstCollection.receivedCount,
        inserted: firstCollection.insertedCount,
        duplicate: firstCollection.duplicateCount,
        processed: firstCollection.processedCount,
      },
      {
        status: "succeeded",
        received: 1,
        inserted: 1,
        duplicate: 0,
        processed: 1,
      },
    );
    assert.deepEqual(
      {
        status: duplicateCollection.status,
        inserted: duplicateCollection.insertedCount,
        duplicate: duplicateCollection.duplicateCount,
        processed: duplicateCollection.processedCount,
      },
      {
        status: "succeeded",
        inserted: 0,
        duplicate: 1,
        processed: 0,
      },
    );
    assert.equal(tableCount(initialized.database, "source_items"), 1);
    assert.equal(tableCount(initialized.database, "analyses"), 1);
    assert.equal(tableCount(initialized.database, "rankings"), 1);

    const ranked = await analyses.listRanked(10);
    assert.equal(ranked.length, 1);
    const insight = ranked[0];
    if (insight === undefined) throw new Error("Expected one insight");
    assert.equal(insight.analysis.providerId, "local-fake");
    assert.equal(insight.analysis.schemaVersion, "analysis-v1");
    assert.equal(insight.analysis.primaryCategory, "MCP");
    assert.deepEqual(
      new Set(
        insight.analysis.claims.map((claim) => claim.claimClass),
      ),
      new Set(["OBSERVATION", "HYPOTHESIS"]),
    );
    assert.equal(insight.ranking.overallScore, 71);
    assert.deepEqual(
      {
        relevance: insight.ranking.relevance.score,
        novelty: insight.ranking.novelty.score,
        actionability: insight.ranking.actionability.score,
        authorCredibility:
          insight.ranking.authorCredibility.score,
      },
      {
        relevance: 4,
        novelty: 3,
        actionability: 4,
        authorCredibility: 2.5,
      },
    );
    for (const component of [
      insight.ranking.relevance,
      insight.ranking.novelty,
      insight.ranking.actionability,
      insight.ranking.authorCredibility,
    ]) {
      assert.ok(component.reason.length > 0);
    }

    const experiments = new SqliteExperimentRepository(
      initialized.database,
    );
    const experimentService = new ExperimentService({
      analyses,
      experiments,
      processingRuns,
      logger,
      now: () => new Date("2026-07-28T04:00:00.000Z"),
    });
    const drafts = new SqliteContentDraftRepository(
      initialized.database,
    );
    const draftService = new ContentDraftService({
      analyses,
      sourceItems,
      experiments,
      drafts,
      processingRuns,
      logger,
      now: () => new Date("2026-07-28T05:00:00.000Z"),
    });

    const pendingExperiment = await experimentService.propose(
      insight.analysis.id,
      proposalInput("未完了の根拠ガード"),
    );
    const pendingDraft = await draftService.generateX(
      insight.analysis.id,
      pendingExperiment.id,
    );
    assert.equal(pendingExperiment.status, "proposed");
    assert.equal(pendingDraft.draft.evidenceScope, "source_only");
    assert.deepEqual(
      pendingDraft.draft.provenance.map(({ kind }) => kind),
      [
        "SOURCE",
        "INTERPRETATION",
        "HYPOTHESIS",
      ],
    );
    assert.match(pendingDraft.draft.body, /未検証/u);
    assert.doesNotMatch(pendingDraft.draft.body, /実際に試した/u);
    await assert.rejects(
      async () =>
        draftService.edit(pendingDraft.draft.id, {
          hook: "検証候補: 実際に試して処理時間を短縮した",
          body: pendingDraft.draft.body,
          keyTakeaway:
            "次の一歩: 実測で手作業が減ることを確認した",
          sourceLinks: pendingDraft.draft.sourceLinks,
        }),
      ContentDraftEvidenceViolationError,
    );
    const unchangedPendingDraft = await draftService.getDetail(
      pendingDraft.draft.id,
    );
    assert.deepEqual(unchangedPendingDraft.draft, pendingDraft.draft);
    assert.equal(unchangedPendingDraft.draft.status, "draft");
    assert.deepEqual(
      unchangedPendingDraft.draft.provenance,
      pendingDraft.draft.provenance,
    );
    assert.deepEqual(
      unchangedPendingDraft.events.map(({ toStatus }) => toStatus),
      ["draft"],
    );
    const rejectedEditHistory = (
      await processingRuns.list(100)
    ).filter(
      ({ sourceOrProvider, status }) =>
        sourceOrProvider === "draft:edit" && status === "failed",
    );
    assert.equal(rejectedEditHistory.length, 1);
    assert.equal(
      rejectedEditHistory[0]?.errorCode,
      "CONTENT_DRAFT_EVIDENCE_VIOLATION",
    );
    assert.equal(
      rejectedEditHistory[0]?.errorKind,
      "ContentDraftEvidenceViolationError",
    );

    const experiment = await experimentService.propose(
      insight.analysis.id,
      proposalInput("完了まで追跡するローカル実験"),
    );
    assert.equal(experiment.status, "proposed");
    assert.equal(
      (await experimentService.approve(experiment.id)).status,
      "approved",
    );
    assert.equal(
      (await experimentService.start(experiment.id)).status,
      "in_progress",
    );
    const completed = await experimentService.complete(
      experiment.id,
      {
        result:
          "The fixture-backed comparison removed one repeated setup step.",
        verificationEvidence:
          "Both runs were stored locally and their step counts were compared.",
        learned:
          "A narrow MCP boundary made the repeated setup measurable.",
        nextDecision:
          "Repeat the comparison with one additional synthetic item.",
        hypothesisSupport: "supported",
        reusableKnowledge:
          "Small read-only boundaries are easier to verify before adoption.",
        nextExperiment:
          "Repeat with a second fixture-backed source item.",
        publishableFirstHandExperience:
          "ローカルの合成データで2回比較し、手作業が1つ減ることを確認した。",
      },
    );
    assert.equal(completed.experiment.status, "completed");
    assert.deepEqual(
      completed.events.map(({ toStatus }) => toStatus),
      ["proposed", "approved", "in_progress", "completed"],
    );
    assert.equal(completed.runs.length, 1);
    assert.equal(
      completed.runs[0]?.verificationEvidence,
      "Both runs were stored locally and their step counts were compared.",
    );
    if (completed.learning === undefined) {
      throw new Error("Expected completion to persist a learning");
    }
    assert.equal(completed.learning.hypothesisSupport, "supported");
    assert.equal(
      completed.learning.publishableFirstHandExperience,
      "ローカルの合成データで2回比較し、手作業が1つ減ることを確認した。",
    );

    const completedDraft = await draftService.generateX(
      insight.analysis.id,
      experiment.id,
    );
    assert.equal(
      completedDraft.draft.evidenceScope,
      "completed_experiment",
    );
    assert.deepEqual(
      completedDraft.draft.provenance.map(({ kind }) => kind),
      [
        "SOURCE",
        "INTERPRETATION",
        "HYPOTHESIS",
        "EXPERIENCE",
        "EXPERIMENT_RESULT",
      ],
    );
    assert.match(completedDraft.draft.body, /実際に試した:/u);
    assert.match(completedDraft.draft.body, /結果:/u);
    assert.ok(completedDraft.draft.characterCount <= 280);
    assert.equal(
      (
        await draftService.submitForReview(
          completedDraft.draft.id,
        )
      ).status,
      "needs_review",
    );
    assert.equal(
      (await draftService.approve(completedDraft.draft.id)).status,
      "approved",
    );
    const reviewedDraft = await draftService.getDetail(
      completedDraft.draft.id,
    );
    assert.deepEqual(
      reviewedDraft.events.map(({ toStatus }) => toStatus),
      ["draft", "needs_review", "approved"],
    );
    assert.ok(
      reviewedDraft.events.every(
        ({ toStatus }) => toStatus !== "published",
      ),
    );

    const digestService = new DailyDigestService({
      dailyDigests: new SqliteDailyDigestRepository(
        initialized.database,
      ),
      processingRuns,
      logger,
      now: () => new Date("2026-07-28T06:00:00.000Z"),
    });
    const digest = await digestService.generate();
    assert.equal(digest.localDate, "2026-07-28");
    assert.equal(digest.timeZone, "Asia/Tokyo");
    assert.deepEqual(digest.topInsightIds, [insight.analysis.id]);
    assert.ok(
      digest.proposedExperimentIds.includes(pendingExperiment.id),
    );
    assert.ok(
      digest.draftCandidateIds.includes(pendingDraft.draft.id),
    );
    assert.ok(
      !digest.draftCandidateIds.includes(completedDraft.draft.id),
    );
    assert.equal(digest.duplicateCount, 1);
    assert.equal(digest.lowConfidenceCount, 0);
    assert.equal(digest.processingFailureCount, 0);

    const history = await processingRuns.list(100);
    assert.equal(history.length, 13);
    assert.equal(
      history.filter(({ status }) => status === "succeeded").length,
      12,
    );
    assert.deepEqual(
      history
        .filter(({ status }) => status === "failed")
        .map(({ sourceOrProvider, errorCode, errorKind }) => ({
          sourceOrProvider,
          errorCode,
          errorKind,
        })),
      [
        {
          sourceOrProvider: "draft:edit",
          errorCode: "CONTENT_DRAFT_EVIDENCE_VIOLATION",
          errorKind: "ContentDraftEvidenceViolationError",
        },
      ],
    );
    assert.deepEqual(
      new Set(history.map(({ operation }) => operation)),
      new Set(["collect", "experiment", "draft", "digest"]),
    );
    assert.ok(
      history.some(
        ({ operation, sourceOrProvider }) =>
          operation === "digest" &&
          sourceOrProvider === "digest:manual",
      ),
    );
    assert.ok(
      history.every(
        ({ sourceOrProvider }) =>
          sourceOrProvider !== "draft:record_published",
      ),
    );
    assert.equal(outboundFetchAttempts, 0);
  } finally {
    globalThis.fetch = originalFetch;
    database?.close();
  }
});
