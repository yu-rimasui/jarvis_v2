import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import {
  request,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createLocalApiRuntime } from "../src/features/rd-intelligence/api/local-api-runtime.js";
import {
  LOCAL_API_HOST,
  LOCAL_API_TIMEOUTS,
  MAX_JSON_BODY_BYTES,
  startLocalApiServer,
  type RunningLocalApi,
} from "../src/features/rd-intelligence/api/local-api-server.js";
import { createLogger } from "../src/features/rd-intelligence/logging/logger.js";

const temporaryDirectories: string[] = [];

test.after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface ApiResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly json: unknown;
  readonly text: string;
}

interface TextResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
}

interface RequestOptions {
  readonly body?: string;
  readonly headers?: OutgoingHttpHeaders;
}

async function apiRequest(
  running: RunningLocalApi,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  return new Promise((resolveResponse, rejectResponse) => {
    const requestHeaders: OutgoingHttpHeaders = {
      ...options.headers,
      ...(options.body === undefined
        ? {}
        : {
            "content-length": Buffer.byteLength(options.body),
          }),
    };
    const outgoing = request(
      {
        host: running.host,
        port: running.port,
        method,
        path,
        headers: requestHeaders,
        agent: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown;
          try {
            json = JSON.parse(text) as unknown;
          } catch {
            rejectResponse(
              new Error(`Expected JSON response, received: ${text}`),
            );
            return;
          }
          resolveResponse({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            json,
            text,
          });
        });
      },
    );
    outgoing.on("error", rejectResponse);
    if (options.body !== undefined) outgoing.write(options.body);
    outgoing.end();
  });
}

async function textRequest(
  running: RunningLocalApi,
  path: string,
  headers: OutgoingHttpHeaders = {},
): Promise<TextResponse> {
  return new Promise((resolveResponse, rejectResponse) => {
    const outgoing = request(
      {
        host: running.host,
        port: running.port,
        method: "GET",
        path,
        headers,
        agent: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          resolveResponse({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", rejectResponse);
    outgoing.end();
  });
}

async function incompleteChunkedOverflowRequest(
  running: RunningLocalApi,
): Promise<ApiResponse & { readonly elapsedMs: number }> {
  const startedAt = performance.now();
  return new Promise((resolveResponse, rejectResponse) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      outgoing.destroy();
      rejectResponse(
        new Error("Chunked overflow did not receive a bounded response"),
      );
    }, 2_000);
    const finish = (
      action: () => void,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const outgoing = request(
      {
        host: running.host,
        port: running.port,
        method: "POST",
        path: "/api/inbox/import",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
        agent: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          finish(() => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolveResponse({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              json: JSON.parse(text) as unknown,
              text,
              elapsedMs: performance.now() - startedAt,
            });
          });
        });
      },
    );
    outgoing.on("error", (error) => {
      finish(() => {
        rejectResponse(error);
      });
    });
    outgoing.write(Buffer.alloc(MAX_JSON_BODY_BYTES + 1, 0x78));
    // Intentionally do not call end(): the server must reject as soon as
    // the streamed body crosses its limit instead of waiting for EOF.
  });
}

function jsonBody(value: unknown): RequestOptions {
  return {
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
  };
}

function asRecord(
  value: unknown,
  description: string,
): Readonly<Record<string, unknown>> {
  assert.ok(
    typeof value === "object" &&
      value !== null &&
      !Array.isArray(value),
    description,
  );
  return value as Readonly<Record<string, unknown>>;
}

function field(
  value: unknown,
  name: string,
  description = name,
): unknown {
  return asRecord(value, description)[name];
}

function stringField(
  value: unknown,
  name: string,
  description = name,
): string {
  const candidate = field(value, name, description);
  if (typeof candidate !== "string") {
    throw new TypeError(`Expected string: ${description}`);
  }
  return candidate;
}

function arrayField(
  value: unknown,
  name: string,
  description = name,
): readonly unknown[] {
  const candidate = field(value, name, description);
  assert.ok(Array.isArray(candidate), description);
  return candidate;
}

function responseData(response: ApiResponse): unknown {
  return field(response.json, "data", "API response data");
}

function errorCode(response: ApiResponse): string {
  return stringField(
    field(response.json, "error", "API error document"),
    "code",
    "API error code",
  );
}

function proposalInput() {
  return {
    title: "Local API contract experiment",
    hypothesis:
      "A loopback-only API makes the local research flow auditable.",
    expectedValue: "A complete locally persisted workflow.",
    smallestFirstStep: "Exercise one synthetic item through the API.",
    requiredTools: ["Node.js", "SQLite"],
    estimatedEffort: "20 minutes",
    risk: "Synthetic input may not represent later integrations.",
    successCriteria: "All requested local states persist and reload.",
    verificationMethod: "Read every state back through the local API.",
  };
}

function completionInput() {
  return {
    result: "The full synthetic workflow persisted through loopback.",
    verificationEvidence:
      "The integration test reloaded every state from SQLite.",
    learned: "A small HTTP adapter can preserve the domain boundaries.",
    nextDecision: "Connect the dashboard without adding external writes.",
    hypothesisSupport: "supported",
    reusableKnowledge:
      "Keep local transport validation separate from domain transitions.",
    nextExperiment: "Exercise two concurrent local review requests.",
    publishableFirstHandExperience:
      "ローカルAPIを通して合成データの状態を最後まで確認した。",
  };
}

function manualItem() {
  return {
    sourceType: "manual",
    sourceExternalId: "local-api-item-001",
    title: "Loopback APIで扱うMCP検証",
    author: "Synthetic Local Author",
    content:
      "合成データです。MCPとTypeScriptの検証をSQLiteへ保存します。",
    canonicalUrl: "https://example.test/local-api/item-001",
    publishedAt: "2026-07-28T09:00:00+09:00",
    sourceMetadata: { synthetic: true },
  };
}

async function withApi(
  action: (
    running: RunningLocalApi,
    runtime: ReturnType<typeof createLocalApiRuntime>,
  ) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-local-api-"));
  temporaryDirectories.push(directory);
  const runtime = createLocalApiRuntime({
    databasePath: join(directory, "local-api.sqlite"),
    migrationsDirectory: resolve("migrations"),
    logger: createLogger(() => undefined),
  });
  const running = await startLocalApiServer(runtime.application, {
    port: 0,
  });
  try {
    await action(running, runtime);
  } finally {
    await running.close();
    runtime.close();
  }
}

test("local API persists the complete inbox, insight, experiment, draft, digest, and history flow", async () => {
  await withApi(async (running) => {
    assert.equal(running.host, LOCAL_API_HOST);
    const address = running.server.address();
    assert.ok(address !== null && typeof address !== "string");
    assert.equal(address.address, LOCAL_API_HOST);
    assert.equal(
      running.server.requestTimeout,
      LOCAL_API_TIMEOUTS.request,
    );
    assert.equal(
      running.server.headersTimeout,
      LOCAL_API_TIMEOUTS.headers,
    );
    assert.equal(
      running.server.keepAliveTimeout,
      LOCAL_API_TIMEOUTS.keepAlive,
    );
    assert.equal(running.server.timeout, LOCAL_API_TIMEOUTS.socket);
    assert.equal(
      running.server.maxRequestsPerSocket,
      LOCAL_API_TIMEOUTS.maxRequestsPerSocket,
    );

    const imported = await apiRequest(
      running,
      "POST",
      "/api/inbox/import",
      jsonBody({ items: [manualItem()] }),
    );
    assert.equal(imported.status, 200);
    const importRun = field(responseData(imported), "run");
    assert.equal(stringField(importRun, "status"), "succeeded");
    assert.equal(field(importRun, "insertedCount"), 1);

    const inbox = await apiRequest(
      running,
      "GET",
      "/api/inbox?limit=10",
    );
    assert.equal(inbox.status, 200);
    const inboxItems = arrayField(responseData(inbox), "items");
    assert.equal(inboxItems.length, 1);
    assert.equal(stringField(inboxItems[0], "title"), manualItem().title);

    const insights = await apiRequest(
      running,
      "GET",
      "/api/insights?limit=10",
    );
    assert.equal(insights.status, 200);
    const insightItems = arrayField(responseData(insights), "items");
    assert.equal(insightItems.length, 1);
    const analysis = field(insightItems[0], "analysis");
    const analysisId = stringField(analysis, "id");
    assert.equal(
      field(field(insightItems[0], "ranking"), "overallScore"),
      71,
    );

    const detail = await apiRequest(
      running,
      "GET",
      `/api/insights/${analysisId}`,
    );
    assert.equal(detail.status, 200);
    assert.equal(
      stringField(field(responseData(detail), "sourceItem"), "title"),
      manualItem().title,
    );

    const missingInsight = await apiRequest(
      running,
      "GET",
      "/api/insights/missing-insight",
    );
    assert.equal(missingInsight.status, 404);
    assert.equal(errorCode(missingInsight), "INSIGHT_NOT_FOUND");

    const proposed = await apiRequest(
      running,
      "POST",
      `/api/insights/${analysisId}/experiments`,
      jsonBody(proposalInput()),
    );
    assert.equal(proposed.status, 201);
    const proposedExperiment = field(
      responseData(proposed),
      "experiment",
    );
    const experimentId = stringField(proposedExperiment, "id");
    assert.equal(stringField(proposedExperiment, "status"), "proposed");

    const invalidStart = await apiRequest(
      running,
      "POST",
      `/api/experiments/${experimentId}/start`,
    );
    assert.equal(invalidStart.status, 409);
    assert.equal(errorCode(invalidStart), "EXPERIMENT_INVALID_TRANSITION");

    for (const action of ["approve", "start"] as const) {
      const transitioned = await apiRequest(
        running,
        "POST",
        `/api/experiments/${experimentId}/${action}`,
      );
      assert.equal(transitioned.status, 200);
    }
    const completed = await apiRequest(
      running,
      "POST",
      `/api/experiments/${experimentId}/complete`,
      jsonBody(completionInput()),
    );
    assert.equal(completed.status, 200);
    assert.equal(
      stringField(
        field(responseData(completed), "experiment"),
        "status",
      ),
      "completed",
    );
    assert.equal(
      stringField(
        field(responseData(completed), "learning"),
        "hypothesisSupport",
      ),
      "supported",
    );

    const experimentDetail = await apiRequest(
      running,
      "GET",
      `/api/experiments/${experimentId}`,
    );
    assert.equal(experimentDetail.status, 200);
    assert.equal(
      arrayField(responseData(experimentDetail), "runs").length,
      1,
    );
    assert.deepEqual(
      arrayField(responseData(experimentDetail), "events").map(
        (event) => stringField(event, "toStatus"),
      ),
      ["proposed", "approved", "in_progress", "completed"],
    );

    const blockedProposal = await apiRequest(
      running,
      "POST",
      `/api/insights/${analysisId}/experiments`,
      jsonBody({
        ...proposalInput(),
        title: "Blocked local API experiment",
      }),
    );
    const blockedExperimentId = stringField(
      field(responseData(blockedProposal), "experiment"),
      "id",
    );
    const blocked = await apiRequest(
      running,
      "POST",
      `/api/experiments/${blockedExperimentId}/block`,
      jsonBody({ reason: "A local fixture is not ready." }),
    );
    assert.equal(blocked.status, 200);
    assert.equal(
      stringField(field(responseData(blocked), "experiment"), "status"),
      "blocked",
    );

    const generated = await apiRequest(
      running,
      "POST",
      `/api/insights/${analysisId}/x-drafts`,
      jsonBody({ experimentId }),
    );
    assert.equal(generated.status, 201);
    const generatedDraft = field(responseData(generated), "draft");
    const draftId = stringField(generatedDraft, "id");
    assert.equal(
      stringField(generatedDraft, "evidenceScope"),
      "completed_experiment",
    );

    const edited = await apiRequest(
      running,
      "PATCH",
      `/api/x-drafts/${draftId}`,
      jsonBody({
        hook: stringField(generatedDraft, "hook"),
        body: stringField(generatedDraft, "body"),
        keyTakeaway: stringField(generatedDraft, "keyTakeaway"),
        sourceLinks: arrayField(generatedDraft, "sourceLinks"),
      }),
    );
    assert.equal(edited.status, 200);
    assert.equal(
      stringField(field(responseData(edited), "draft"), "status"),
      "draft",
    );
    for (const action of ["review", "approve"] as const) {
      const reviewed = await apiRequest(
        running,
        "POST",
        `/api/x-drafts/${draftId}/${action}`,
      );
      assert.equal(reviewed.status, 200);
    }
    const draftDetail = await apiRequest(
      running,
      "GET",
      `/api/x-drafts/${draftId}`,
    );
    assert.equal(
      stringField(field(responseData(draftDetail), "draft"), "status"),
      "approved",
    );
    assert.deepEqual(
      arrayField(responseData(draftDetail), "events").map((event) =>
        stringField(event, "toStatus"),
      ),
      ["draft", "draft", "needs_review", "approved"],
    );

    const missingExperiment = await apiRequest(
      running,
      "POST",
      `/api/insights/${analysisId}/x-drafts`,
      jsonBody({}),
    );
    assert.equal(missingExperiment.status, 422);
    assert.equal(errorCode(missingExperiment), "DRAFT_EXPERIMENT_REQUIRED");

    const rejectedDraftResponse = await apiRequest(
      running,
      "POST",
      `/api/insights/${analysisId}/x-drafts`,
      jsonBody({ experimentId }),
    );
    const rejectedDraftId = stringField(
      field(responseData(rejectedDraftResponse), "draft"),
      "id",
    );
    const rejectedDraft = await apiRequest(
      running,
      "POST",
      `/api/x-drafts/${rejectedDraftId}/reject`,
      jsonBody({ reason: "The wording needs another local pass." }),
    );
    assert.equal(rejectedDraft.status, 200);
    assert.equal(
      stringField(
        field(responseData(rejectedDraft), "draft"),
        "status",
      ),
      "rejected",
    );

    const digest = await apiRequest(
      running,
      "POST",
      "/api/digests",
      jsonBody({ localDate: "2026-07-28" }),
    );
    assert.equal(digest.status, 200);
    const digestValue = field(responseData(digest), "digest");
    assert.equal(stringField(digestValue, "localDate"), "2026-07-28");
    assert.equal(stringField(digestValue, "timeZone"), "Asia/Tokyo");

    const history = await apiRequest(
      running,
      "GET",
      "/api/processing-history?limit=100",
    );
    assert.equal(history.status, 200);
    const historyItems = arrayField(responseData(history), "items");
    assert.ok(
      historyItems.some(
        (run) =>
          stringField(run, "status") === "failed" &&
          stringField(run, "errorCode") ===
            "EXPERIMENT_INVALID_TRANSITION",
      ),
    );
    assert.deepEqual(
      new Set(historyItems.map((run) => stringField(run, "operation"))),
      new Set(["collect", "experiment", "draft", "digest"]),
    );

    const experiments = await apiRequest(
      running,
      "GET",
      "/api/experiments",
    );
    assert.equal(
      arrayField(responseData(experiments), "items").length,
      2,
    );
    const drafts = await apiRequest(running, "GET", "/api/x-drafts");
    assert.equal(arrayField(responseData(drafts), "items").length, 2);

    for (const forbiddenPath of [
      `/api/x-drafts/${draftId}/publish`,
      `/api/x-drafts/${draftId}/published`,
      "/api/publish",
    ]) {
      const response = await apiRequest(
        running,
        "POST",
        forbiddenPath,
      );
      assert.equal(response.status, 404);
      assert.equal(errorCode(response), "ENDPOINT_NOT_FOUND");
    }
  });
});

test("local API serves only the explicit same-origin dashboard assets", async () => {
  await withApi(async (running) => {
    const dashboard = await textRequest(running, "/");
    assert.equal(dashboard.status, 200);
    assert.match(
      String(dashboard.headers["content-type"]),
      /^text\/html; charset=utf-8$/u,
    );
    assert.equal(dashboard.headers["cache-control"], "no-store");
    assert.equal(
      dashboard.headers["access-control-allow-origin"],
      undefined,
    );
    assert.match(
      String(dashboard.headers["content-security-policy"]),
      /connect-src 'self'/u,
    );
    assert.match(dashboard.text, /\/assets\/app\.js/u);

    const appScript = await textRequest(running, "/assets/app.js");
    assert.equal(appScript.status, 200);
    assert.match(
      String(appScript.headers["content-type"]),
      /^text\/javascript; charset=utf-8$/u,
    );
    assert.match(appScript.text, /\/api\/health/u);

    const appStyles = await textRequest(running, "/assets/app.css");
    assert.equal(appStyles.status, 200);
    assert.match(
      String(appStyles.headers["content-type"]),
      /^text\/css; charset=utf-8$/u,
    );

    const rdRoute = await textRequest(running, "/rd-intelligence");
    assert.equal(rdRoute.status, 200);
    assert.match(rdRoute.text, /\/assets\/app\.js/u);

    for (const blockedPath of [
      "/src/features/rd-intelligence/api/local-api-server.ts",
      "/mocks/dashboard/index.html",
      "/data/rd-intelligence.sqlite",
      "/fixtures/source-items.json",
      "/rd-intelligence.js",
      "/assets/app.js.map",
      "/index.html?cache=1",
    ]) {
      const blocked = await textRequest(running, blockedPath);
      assert.equal(blocked.status, 404);
      assert.doesNotMatch(
        String(blocked.headers["content-type"]),
        /^text\/(?:html|javascript|css)/u,
      );
    }

    const rejectedOrigin = await textRequest(running, "/", {
      origin: "https://outside.example",
    });
    assert.equal(rejectedOrigin.status, 403);
    assert.match(rejectedOrigin.text, /SAME_ORIGIN_REQUIRED/u);
  });
});

test("local API enforces its loopback trust boundary and returns bounded non-leaking JSON errors", async () => {
  await withApi(async (running) => {
    const health = await apiRequest(running, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.headers["access-control-allow-origin"], undefined);
    assert.equal(health.headers["cache-control"], "no-store");

    const sameOrigin = await apiRequest(
      running,
      "GET",
      "/api/health",
      {
        headers: {
          origin: `http://${LOCAL_API_HOST}:${String(running.port)}`,
        },
      },
    );
    assert.equal(sameOrigin.status, 200);
    assert.equal(
      sameOrigin.headers["access-control-allow-origin"],
      undefined,
    );

    const badOrigin = await apiRequest(
      running,
      "GET",
      "/api/health",
      { headers: { origin: "https://outside.example" } },
    );
    assert.equal(badOrigin.status, 403);
    assert.equal(errorCode(badOrigin), "SAME_ORIGIN_REQUIRED");

    const rejectedImport = await apiRequest(
      running,
      "POST",
      "/api/inbox/import",
      {
        ...jsonBody({ items: [manualItem()] }),
        headers: {
          "content-type": "application/json",
          origin: "https://outside.example",
        },
      },
    );
    assert.equal(rejectedImport.status, 403);
    assert.equal(errorCode(rejectedImport), "SAME_ORIGIN_REQUIRED");
    const unchangedInbox = await apiRequest(
      running,
      "GET",
      "/api/inbox",
    );
    assert.deepEqual(
      arrayField(responseData(unchangedInbox), "items"),
      [],
    );
    const unchangedHistory = await apiRequest(
      running,
      "GET",
      "/api/processing-history",
    );
    assert.deepEqual(
      arrayField(responseData(unchangedHistory), "items"),
      [],
    );

    const badHost = await apiRequest(
      running,
      "GET",
      "/api/health",
      { headers: { host: `localhost:${String(running.port)}` } },
    );
    assert.equal(badHost.status, 403);
    assert.equal(errorCode(badHost), "LOCAL_BOUNDARY_REQUIRED");

    const invalidJson = await apiRequest(
      running,
      "POST",
      "/api/digests",
      {
        body: "{not-json",
        headers: { "content-type": "application/json" },
      },
    );
    assert.equal(invalidJson.status, 400);
    assert.equal(errorCode(invalidJson), "INVALID_JSON");

    const wrongContentType = await apiRequest(
      running,
      "POST",
      "/api/digests",
      {
        body: "{}",
        headers: { "content-type": "text/plain" },
      },
    );
    assert.equal(wrongContentType.status, 415);
    assert.equal(
      errorCode(wrongContentType),
      "JSON_CONTENT_TYPE_REQUIRED",
    );

    const largeBody = JSON.stringify({
      items: "x".repeat(MAX_JSON_BODY_BYTES),
    });
    const oversized = await apiRequest(
      running,
      "POST",
      "/api/inbox/import",
      {
        body: largeBody,
        headers: { "content-type": "application/json" },
      },
    );
    assert.equal(oversized.status, 413);
    assert.equal(errorCode(oversized), "REQUEST_BODY_TOO_LARGE");

    const chunkedOverflow =
      await incompleteChunkedOverflowRequest(running);
    assert.equal(chunkedOverflow.status, 413);
    assert.equal(
      errorCode(chunkedOverflow),
      "REQUEST_BODY_TOO_LARGE",
    );
    assert.equal(chunkedOverflow.headers.connection, "close");
    assert.ok(chunkedOverflow.elapsedMs < 2_000);

    const privateMarker = "private-input-must-not-leak";
    const validation = await apiRequest(
      running,
      "POST",
      "/api/digests",
      jsonBody({ localDate: privateMarker }),
    );
    assert.equal(validation.status, 400);
    assert.equal(errorCode(validation), "VALIDATION_ERROR");
    assert.doesNotMatch(validation.text, new RegExp(privateMarker, "u"));

    const unknownField = await apiRequest(
      running,
      "POST",
      "/api/digests",
      jsonBody({ unexpected: true }),
    );
    assert.equal(unknownField.status, 400);
    assert.equal(errorCode(unknownField), "VALIDATION_ERROR");

    const invalidLimit = await apiRequest(
      running,
      "GET",
      "/api/inbox?limit=1&limit=2",
    );
    assert.equal(invalidLimit.status, 400);

    const missing = await apiRequest(
      running,
      "GET",
      "/api/not-present",
    );
    assert.equal(missing.status, 404);
    assert.equal(errorCode(missing), "ENDPOINT_NOT_FOUND");

    const wrongMethod = await apiRequest(
      running,
      "POST",
      "/api/health",
    );
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.allow, "GET");
    assert.equal(errorCode(wrongMethod), "METHOD_NOT_ALLOWED");
  });
});

test("local API turns inherited-key error codes into a non-reflecting generic 500", async () => {
  await withApi(async (running, runtime) => {
    const privateMarker = "private-hostile-error-marker";
    const errors = ["constructor", "__proto__"].map((code) => {
      const error = new Error(`${privateMarker}:${code}`);
      const prototype = Object.create(
        Error.prototype,
      ) as object;
      Object.defineProperty(prototype, "code", {
        value: code,
        enumerable: true,
      });
      Object.setPrototypeOf(error, prototype);
      assert.equal(error instanceof Error, true);
      assert.equal(Object.hasOwn(error, "code"), false);
      return error;
    });

    Object.defineProperty(runtime.application, "listInbox", {
      configurable: true,
      value: async () => {
        const error = errors.shift();
        if (error === undefined) {
          throw new Error(privateMarker);
        }
        throw error;
      },
    });

    for (const hostileCode of ["constructor", "__proto__"]) {
      const response = await apiRequest(
        running,
        "GET",
        "/api/inbox",
      );
      assert.equal(response.status, 500);
      assert.equal(errorCode(response), "INTERNAL_ERROR");
      assert.doesNotMatch(
        response.text,
        new RegExp(privateMarker, "u"),
      );
      assert.doesNotMatch(
        response.text,
        new RegExp(hostileCode, "u"),
      );
    }
  });
});
