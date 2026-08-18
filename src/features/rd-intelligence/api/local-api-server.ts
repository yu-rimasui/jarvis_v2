import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { TextDecoder } from "node:util";
import { ValidationError } from "../validation/source-item-parser.js";
import {
  completionBody,
  decodePathId,
  digestBody,
  draftEditBody,
  draftGenerationBody,
  emptyBody,
  importBody,
  parseListLimit,
  proposalBody,
  reasonBody,
  rejectSearchParams,
  xImportBody,
} from "./request-validation.js";
import { LocalApiApplication } from "./local-api-application.js";
import { readStaticAsset } from "./local-static-assets.js";

export const LOCAL_API_HOST = "127.0.0.1";
export const MAX_JSON_BODY_BYTES = 1_048_576;
export const LOCAL_API_TIMEOUTS = {
  request: 1_800_000,
  headers: 5_000,
  keepAlive: 2_000,
  socket: 1_800_000,
  maxRequestsPerSocket: 100,
} as const;

interface ApiErrorDocument {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

class HttpBoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly allow?: string,
    readonly closeConnection = false,
  ) {
    super(message);
    this.name = "HttpBoundaryError";
  }
}

const PUBLIC_DOMAIN_ERRORS: ReadonlyMap<
  string,
  { readonly status: number; readonly message: string }
> = new Map([
  [
    "SOURCE_ANALYSIS_NOT_FOUND",
    {
      status: 404,
      message: "The source analysis does not exist.",
    },
  ],
  [
    "EXPERIMENT_NOT_FOUND",
    {
      status: 404,
      message: "The experiment does not exist.",
    },
  ],
  [
    "DRAFT_ANALYSIS_NOT_FOUND",
    {
      status: 404,
      message: "The analysis for this draft does not exist.",
    },
  ],
  [
    "DRAFT_SOURCE_NOT_FOUND",
    {
      status: 404,
      message: "The source item for this draft does not exist.",
    },
  ],
  [
    "DRAFT_EXPERIMENT_NOT_FOUND",
    {
      status: 404,
      message: "The experiment for this draft does not exist.",
    },
  ],
  [
    "CONTENT_DRAFT_NOT_FOUND",
    {
      status: 404,
      message: "The content draft does not exist.",
    },
  ],
  [
    "INSIGHT_NOT_FOUND",
    {
      status: 404,
      message: "The ranked insight does not exist.",
    },
  ],
  [
    "EXPERIMENT_INVALID_TRANSITION",
    {
      status: 409,
      message: "The requested experiment transition is not allowed.",
    },
  ],
  [
    "EXPERIMENT_CONFLICT",
    {
      status: 409,
      message: "The experiment changed during this operation.",
    },
  ],
  [
    "DRAFT_EXPERIMENT_MISMATCH",
    {
      status: 409,
      message: "The experiment belongs to a different analysis.",
    },
  ],
  [
    "CONTENT_DRAFT_INVALID_TRANSITION",
    {
      status: 409,
      message: "The requested content draft transition is not allowed.",
    },
  ],
  [
    "CONTENT_DRAFT_CONFLICT",
    {
      status: 409,
      message: "The content draft changed during this operation.",
    },
  ],
  [
    "CONTENT_DRAFT_TOO_LONG",
    {
      status: 422,
      message: "The composed X draft exceeds 280 Unicode characters.",
    },
  ],
  [
    "CONTENT_DRAFT_EVIDENCE_VIOLATION",
    {
      status: 422,
      message: "The X draft contains unsupported evidence claims.",
    },
  ],
  ["DRAFT_EXPERIMENT_REQUIRED", { status: 422, message: "A completed experimentId is required." }],
  ["DRAFT_EXPERIMENT_INCOMPLETE", { status: 422, message: "Only a completed practice log can produce an X draft." }],
  ["PRACTICE_ANALYSIS_NOT_FOUND", { status: 404, message: "The practice analysis does not exist." }],
  ["PRACTICE_SOURCE_NOT_FOUND", { status: 404, message: "The practice source does not exist." }],
  ["PRACTICE_EXPERIMENT_NOT_FOUND", { status: 404, message: "The practice experiment does not exist." }],
  ["PRACTICE_EXPERIMENT_INVALID_STATE", { status: 409, message: "The practice experiment is not in the required state." }],
  ["LOCAL_INTEGRATION_UNAVAILABLE", { status: 503, message: "The local Vault integration is unavailable." }],
  ["VAULT_BOUNDARY_VIOLATION", { status: 422, message: "The Vault reference is outside the allowed R&D area." }],
  ["VAULT_NOTE_INVALID", { status: 422, message: "The Obsidian note is incomplete or invalid." }],
  ["VAULT_NOTE_NOT_FOUND", { status: 404, message: "The required Obsidian note does not exist." }],
  ["OLLAMA_REQUEST_FAILED", { status: 503, message: "The local Ollama request failed." }],
  ["OLLAMA_OUTPUT_INVALID", { status: 422, message: "Ollama did not return valid structured output." }],
]);

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  allow?: string,
  closeConnection = false,
): void {
  const body = JSON.stringify(value);
  const socket = closeConnection ? response.socket : undefined;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (allow !== undefined) response.setHeader("Allow", allow);
  if (closeConnection) {
    response.shouldKeepAlive = false;
    response.setHeader("Connection", "close");
  }
  response.end(body, () => {
    if (
      closeConnection &&
      socket !== null &&
      socket !== undefined &&
      !socket.destroyed
    ) {
      socket.destroySoon();
    }
  });
}

function sendStaticAsset(
  response: ServerResponse,
  asset: { readonly body: Buffer; readonly contentType: string },
): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", asset.contentType);
  response.setHeader("Content-Length", asset.body.byteLength);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(asset.body);
}

function errorDocument(
  code: string,
  message: string,
): ApiErrorDocument {
  return {
    error: { code, message },
  };
}

function sendSafeError(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
): void {
  const requestIsIncomplete = !request.complete;
  if (error instanceof HttpBoundaryError) {
    sendJson(
      response,
      error.status,
      errorDocument(error.code, error.message),
      error.allow,
      error.closeConnection || requestIsIncomplete,
    );
    return;
  }
  if (error instanceof ValidationError) {
    sendJson(
      response,
      400,
      errorDocument(
        error.code,
        "The request failed runtime validation.",
      ),
      undefined,
      requestIsIncomplete,
    );
    return;
  }

  let code: string | undefined;
  try {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      code = error.code;
    }
  } catch {
    code = undefined;
  }
  const publicError =
    code === undefined ? undefined : PUBLIC_DOMAIN_ERRORS.get(code);
  if (code !== undefined && publicError !== undefined) {
    sendJson(
      response,
      publicError.status,
      errorDocument(code, publicError.message),
      undefined,
      requestIsIncomplete,
    );
    return;
  }

  sendJson(
    response,
    500,
    errorDocument(
      "INTERNAL_ERROR",
      "The local API could not complete the request.",
    ),
    undefined,
    requestIsIncomplete,
  );
}

function assertLocalBoundary(request: IncomingMessage): void {
  const localPort = request.socket.localPort;
  const expectedHost =
    localPort === undefined
      ? undefined
      : `${LOCAL_API_HOST}:${String(localPort)}`;
  const host = request.headers.host;
  const remoteAddress = request.socket.remoteAddress;

  if (
    request.socket.localAddress !== LOCAL_API_HOST ||
    remoteAddress !== LOCAL_API_HOST ||
    expectedHost === undefined ||
    host !== expectedHost
  ) {
    throw new HttpBoundaryError(
      403,
      "LOCAL_BOUNDARY_REQUIRED",
      "This API only accepts requests through its 127.0.0.1 boundary.",
    );
  }

  const origin = request.headers.origin;
  if (
    origin !== undefined &&
    origin !== `http://${expectedHost}`
  ) {
    throw new HttpBoundaryError(
      403,
      "SAME_ORIGIN_REQUIRED",
      "Browser requests must use the local API origin.",
    );
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentEncoding = request.headers["content-encoding"];
  if (
    contentEncoding !== undefined &&
    contentEncoding.toLocaleLowerCase("en-US") !== "identity"
  ) {
    throw new HttpBoundaryError(
      415,
      "UNSUPPORTED_CONTENT_ENCODING",
      "Request body compression is not supported.",
      undefined,
      true,
    );
  }

  const declaredLength = request.headers["content-length"];
  const discardDeclaredOversize =
    declaredLength !== undefined &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_JSON_BODY_BYTES;

  const { chunks, byteLength } = await new Promise<{
    readonly chunks: readonly Buffer[];
    readonly byteLength: number;
  }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;

    const cleanup = (preserveFailureListeners = false): void => {
      request.off("data", onData);
      request.off("end", onEnd);
      if (!preserveFailureListeners) {
        request.off("aborted", onAborted);
        request.off("error", onError);
      }
    };
    const fail = (
      error: HttpBoundaryError,
      preserveFailureListeners = false,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup(preserveFailureListeners);
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      if (settled) return;
      const buffer =
        typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      byteLength += buffer.byteLength;
      if (discardDeclaredOversize) return;
      if (byteLength > MAX_JSON_BODY_BYTES) {
        request.pause();
        fail(
          new HttpBoundaryError(
            413,
            "REQUEST_BODY_TOO_LARGE",
            "The JSON request body must not exceed 1048576 bytes.",
            undefined,
            true,
          ),
          true,
        );
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ chunks, byteLength });
    };
    const onAborted = (): void => {
      fail(
        new HttpBoundaryError(
          400,
          "REQUEST_BODY_INCOMPLETE",
          "The request body could not be read completely.",
          undefined,
          true,
        ),
      );
    };
    const onError = (): void => {
      fail(
        new HttpBoundaryError(
          400,
          "REQUEST_BODY_INCOMPLETE",
          "The request body could not be read completely.",
          undefined,
          true,
        ),
      );
    };

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });

  if (discardDeclaredOversize) {
    throw new HttpBoundaryError(
      413,
      "REQUEST_BODY_TOO_LARGE",
      "The JSON request body must not exceed 1048576 bytes.",
      undefined,
      true,
    );
  }
  if (byteLength === 0) return {};

  const contentType = request.headers["content-type"];
  if (
    contentType === undefined ||
    contentType.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") !==
      "application/json"
  ) {
    throw new HttpBoundaryError(
      415,
      "JSON_CONTENT_TYPE_REQUIRED",
      "A non-empty request body must use application/json.",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, byteLength),
    );
  } catch {
    throw new HttpBoundaryError(
      400,
      "INVALID_JSON",
      "The request body must be valid UTF-8 JSON.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpBoundaryError(
      400,
      "INVALID_JSON",
      "The request body must be valid JSON.",
    );
  }
}

function pathId(
  match: RegExpMatchArray,
  field: string,
): string {
  const value = match[1];
  if (value === undefined) {
    throw new ValidationError(field, "must not be empty");
  }
  return decodePathId(value, field);
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  application: LocalApiApplication,
): Promise<void> {
  if (
    request.url === undefined ||
    request.url.length > 4_096 ||
    !request.url.startsWith("/") ||
    request.url.startsWith("//")
  ) {
    throw new HttpBoundaryError(
      400,
      "INVALID_REQUEST_TARGET",
      "The request target is invalid or too long.",
    );
  }

  let url: URL;
  try {
    url = new URL(request.url, "http://127.0.0.1");
  } catch {
    throw new HttpBoundaryError(
      400,
      "INVALID_REQUEST_TARGET",
      "The request target is invalid.",
    );
  }
  const rawPath = request.url.split("?", 1)[0];
  if (rawPath !== url.pathname) {
    throw new HttpBoundaryError(
      400,
      "INVALID_REQUEST_TARGET",
      "The request path must not contain normalized dot segments.",
    );
  }
  const method = request.method ?? "";
  const path = url.pathname;
  if (
    method === "GET" &&
    ((request.headers["content-length"] !== undefined &&
      request.headers["content-length"] !== "0") ||
      request.headers["transfer-encoding"] !== undefined)
  ) {
    request.resume();
    throw new HttpBoundaryError(
      400,
      "UNEXPECTED_REQUEST_BODY",
      "GET requests must not contain a request body.",
    );
  }

  if (method === "GET" && path === "/api/health") {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, {
      data: { status: "ok", boundHost: LOCAL_API_HOST },
    });
    return;
  }
  if (method === "GET" && path === "/api/readiness") {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, { data: await application.readiness() });
    return;
  }
  if (method === "POST" && path === "/api/collections/rss") {
    rejectSearchParams(url.searchParams);
    emptyBody(await readJsonBody(request));
    sendJson(response, 200, { data: { feeds: await application.collectRss() } });
    return;
  }
  if (method === "POST" && path === "/api/inbox/x-import") {
    rejectSearchParams(url.searchParams);
    const body = xImportBody(await readJsonBody(request));
    sendJson(response, 200, { data: { run: await application.importX(body) } });
    return;
  }
  if (method === "GET" && path === "/api/inbox") {
    const limit = parseListLimit(url.searchParams);
    sendJson(response, 200, {
      data: { items: await application.listInbox(limit) },
    });
    return;
  }
  if (method === "POST" && path === "/api/inbox/import") {
    rejectSearchParams(url.searchParams);
    const body = importBody(await readJsonBody(request));
    sendJson(response, 200, {
      data: { run: await application.importInbox(body["items"]) },
    });
    return;
  }
  if (method === "GET" && path === "/api/insights") {
    const limit = parseListLimit(url.searchParams);
    sendJson(response, 200, {
      data: { items: await application.listInsights(limit) },
    });
    return;
  }

  const insightMatch = path.match(/^\/api\/insights\/([^/]+)$/u);
  if (method === "GET" && insightMatch !== null) {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, {
      data: await application.getInsight(
        pathId(insightMatch, "analysisId"),
      ),
    });
    return;
  }
  const proposalMatch = path.match(
    /^\/api\/insights\/([^/]+)\/experiments$/u,
  );
  const practiceNoteMatch = path.match(
    /^\/api\/insights\/([^/]+)\/practice-note$/u,
  );
  if (method === "POST" && practiceNoteMatch !== null) {
    rejectSearchParams(url.searchParams);
    emptyBody(await readJsonBody(request));
    sendJson(response, 201, {
      data: await application.startPractice(pathId(practiceNoteMatch, "analysisId")),
    });
    return;
  }
  if (method === "POST" && proposalMatch !== null) {
    rejectSearchParams(url.searchParams);
    const body = proposalBody(await readJsonBody(request));
    sendJson(response, 201, {
      data: {
        experiment: await application.proposeExperiment(
          pathId(proposalMatch, "analysisId"),
          body,
        ),
      },
    });
    return;
  }
  const draftGenerationMatch = path.match(
    /^\/api\/insights\/([^/]+)\/x-drafts$/u,
  );
  if (method === "POST" && draftGenerationMatch !== null) {
    rejectSearchParams(url.searchParams);
    const body = draftGenerationBody(await readJsonBody(request));
    sendJson(response, 201, {
      data: await application.generateXDraft(
        pathId(draftGenerationMatch, "analysisId"),
        body["experimentId"],
      ),
    });
    return;
  }

  if (method === "GET" && path === "/api/experiments") {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, {
      data: { items: await application.listExperiments() },
    });
    return;
  }
  const experimentDetailMatch = path.match(
    /^\/api\/experiments\/([^/]+)$/u,
  );
  if (method === "GET" && experimentDetailMatch !== null) {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, {
      data: await application.getExperiment(
        pathId(experimentDetailMatch, "experimentId"),
      ),
    });
    return;
  }
  const experimentActionMatch = path.match(
    /^\/api\/experiments\/([^/]+)\/(approve|start|reject|block|complete)$/u,
  );
  const practiceImportMatch = path.match(
    /^\/api\/experiments\/([^/]+)\/import-log$/u,
  );
  if (method === "POST" && practiceImportMatch !== null) {
    rejectSearchParams(url.searchParams);
    emptyBody(await readJsonBody(request));
    sendJson(response, 200, {
      data: await application.importPracticeLog(pathId(practiceImportMatch, "experimentId")),
    });
    return;
  }
  if (method === "POST" && experimentActionMatch !== null) {
    rejectSearchParams(url.searchParams);
    const experimentId = pathId(
      experimentActionMatch,
      "experimentId",
    );
    const action = experimentActionMatch[2];
    const body = await readJsonBody(request);
    if (action === "approve") {
      emptyBody(body);
      sendJson(response, 200, {
        data: {
          experiment:
            await application.approveExperiment(experimentId),
        },
      });
      return;
    }
    if (action === "start") {
      emptyBody(body);
      sendJson(response, 200, {
        data: {
          experiment: await application.startExperiment(experimentId),
        },
      });
      return;
    }
    if (action === "reject" || action === "block") {
      const parsed = reasonBody(body);
      const experiment =
        action === "reject"
          ? await application.rejectExperiment(
              experimentId,
              parsed["reason"],
            )
          : await application.blockExperiment(
              experimentId,
              parsed["reason"],
            );
      sendJson(response, 200, { data: { experiment } });
      return;
    }
    const parsed = completionBody(body);
    sendJson(response, 200, {
      data: await application.completeExperiment(
        experimentId,
        parsed,
      ),
    });
    return;
  }

  if (method === "GET" && path === "/api/x-drafts") {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, {
      data: { items: await application.listDrafts() },
    });
    return;
  }
  const draftDetailMatch = path.match(
    /^\/api\/x-drafts\/([^/]+)$/u,
  );
  if (method === "GET" && draftDetailMatch !== null) {
    rejectSearchParams(url.searchParams);
    sendJson(response, 200, {
      data: await application.getDraft(
        pathId(draftDetailMatch, "draftId"),
      ),
    });
    return;
  }
  if (method === "PATCH" && draftDetailMatch !== null) {
    rejectSearchParams(url.searchParams);
    const body = draftEditBody(await readJsonBody(request));
    sendJson(response, 200, {
      data: {
        draft: await application.editDraft(
          pathId(draftDetailMatch, "draftId"),
          body,
        ),
      },
    });
    return;
  }
  const draftActionMatch = path.match(
    /^\/api\/x-drafts\/([^/]+)\/(review|approve|reject)$/u,
  );
  const draftReloadMatch = path.match(
    /^\/api\/x-drafts\/([^/]+)\/reload$/u,
  );
  if (method === "POST" && draftReloadMatch !== null) {
    rejectSearchParams(url.searchParams);
    emptyBody(await readJsonBody(request));
    sendJson(response, 200, {
      data: { draft: await application.reloadDraft(pathId(draftReloadMatch, "draftId")) },
    });
    return;
  }
  if (method === "POST" && draftActionMatch !== null) {
    rejectSearchParams(url.searchParams);
    const draftId = pathId(draftActionMatch, "draftId");
    const action = draftActionMatch[2];
    const body = await readJsonBody(request);
    if (action === "review" || action === "approve") {
      emptyBody(body);
      const draft =
        action === "review"
          ? await application.submitDraftForReview(draftId)
          : await application.approveDraft(draftId);
      sendJson(response, 200, { data: { draft } });
      return;
    }
    const parsed = reasonBody(body);
    sendJson(response, 200, {
      data: {
        draft: await application.rejectDraft(
          draftId,
          parsed["reason"],
        ),
      },
    });
    return;
  }

  if (method === "GET" && path === "/api/processing-history") {
    const limit = parseListLimit(url.searchParams, 100);
    sendJson(response, 200, {
      data: {
        items: await application.listProcessingHistory(limit),
      },
    });
    return;
  }
  if (method === "POST" && path === "/api/digests") {
    rejectSearchParams(url.searchParams);
    const body = digestBody(await readJsonBody(request));
    sendJson(response, 200, {
      data: {
        digest: await application.generateDigest(body["localDate"]),
      },
    });
    return;
  }

  if (method === "GET" && !path.startsWith("/api/") && url.search === "") {
    const asset = await readStaticAsset(path);
    if (asset !== undefined) {
      sendStaticAsset(response, asset);
      return;
    }
  }

  const allow = allowedMethods(path);
  if (allow !== undefined) {
    throw new HttpBoundaryError(
      405,
      "METHOD_NOT_ALLOWED",
      "The request method is not allowed for this endpoint.",
      allow,
    );
  }
  throw new HttpBoundaryError(
    404,
    "ENDPOINT_NOT_FOUND",
    "The local API endpoint does not exist.",
  );
}

function allowedMethods(path: string): string | undefined {
  if (
    path === "/api/health" ||
    path === "/api/readiness" ||
    path === "/api/inbox" ||
    path === "/api/insights" ||
    path === "/api/experiments" ||
    path === "/api/x-drafts" ||
    path === "/api/processing-history"
  ) {
    return "GET";
  }
  if (
    path === "/api/inbox/import" ||
    path === "/api/inbox/x-import" ||
    path === "/api/collections/rss" ||
    path === "/api/digests"
  ) {
    return "POST";
  }
  if (
    /^\/api\/insights\/[^/]+$/u.test(path) ||
    /^\/api\/experiments\/[^/]+$/u.test(path)
  ) {
    return "GET";
  }
  if (
    /^\/api\/insights\/[^/]+\/(?:experiments|practice-note|x-drafts)$/u.test(path) ||
    /^\/api\/experiments\/[^/]+\/(?:approve|start|reject|block|complete|import-log)$/u.test(
      path,
    ) ||
    /^\/api\/x-drafts\/[^/]+\/(?:review|approve|reject|reload)$/u.test(path)
  ) {
    return "POST";
  }
  if (/^\/api\/x-drafts\/[^/]+$/u.test(path)) {
    return "GET, PATCH";
  }
  return undefined;
}

export function createLocalApiRequestHandler(
  application: LocalApiApplication,
): RequestListener {
  return (request, response) => {
    void (async () => {
      try {
        assertLocalBoundary(request);
        await route(request, response, application);
      } catch (error) {
        if (!response.headersSent) {
          sendSafeError(request, response, error);
        } else {
          response.destroy();
        }
      }
    })();
  };
}

export interface StartLocalApiOptions {
  readonly port?: number;
}

export interface RunningLocalApi {
  readonly host: typeof LOCAL_API_HOST;
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
}

export async function startLocalApiServer(
  application: LocalApiApplication,
  options: StartLocalApiOptions = {},
): Promise<RunningLocalApi> {
  const port = options.port ?? 4317;
  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new RangeError("Local API port must be an integer from 0 to 65535");
  }

  const server = createServer(createLocalApiRequestHandler(application));
  server.requestTimeout = LOCAL_API_TIMEOUTS.request;
  server.headersTimeout = LOCAL_API_TIMEOUTS.headers;
  server.keepAliveTimeout = LOCAL_API_TIMEOUTS.keepAlive;
  server.timeout = LOCAL_API_TIMEOUTS.socket;
  server.maxRequestsPerSocket =
    LOCAL_API_TIMEOUTS.maxRequestsPerSocket;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOCAL_API_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Local API did not receive an IPv4 address");
  }

  return {
    host: LOCAL_API_HOST,
    port: address.port,
    server,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  };
}
