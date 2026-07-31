import { z } from 'zod';
import JSONBig from 'json-bigint';

// src/client/errors.ts
var MinswapErrorCode = /* @__PURE__ */ ((MinswapErrorCode2) => {
  MinswapErrorCode2["NETWORK"] = "NETWORK";
  MinswapErrorCode2["TIMEOUT"] = "TIMEOUT";
  MinswapErrorCode2["RATE_LIMITED"] = "RATE_LIMITED";
  MinswapErrorCode2["NOT_FOUND"] = "NOT_FOUND";
  MinswapErrorCode2["INVALID_PARAMS"] = "INVALID_PARAMS";
  MinswapErrorCode2["PARSE_ERROR"] = "PARSE_ERROR";
  MinswapErrorCode2["API_ERROR"] = "API_ERROR";
  MinswapErrorCode2["GRAPHQL_ERROR"] = "GRAPHQL_ERROR";
  return MinswapErrorCode2;
})(MinswapErrorCode || {});
var MinswapError = class _MinswapError extends Error {
  name = "MinswapError";
  code;
  details;
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  /**
   * Type guard for narrowing an unknown error to a specific code.
   *
   * @example
   * try { await sdk.token.getById(id); }
   * catch (e) {
   *   if (MinswapError.is(e, MinswapErrorCode.RATE_LIMITED)) {
   *     // e.details.retryAfterMs is typed here
   *   }
   * }
   */
  static is(error, code) {
    return error instanceof _MinswapError && error.code === code;
  }
};

// src/client/url.ts
function buildUrl(base, path, query = {}) {
  let url;
  try {
    url = new URL(`${base.replace(/\/+$/, "")}${path}`);
  } catch (cause) {
    throw new MinswapError(
      `Invalid endpoint URL "${base}${path}"`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "url", reason: `could not be parsed: ${String(cause)}` }
    );
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      url.searchParams.set(key, value.join(","));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
function toEpochMs(value) {
  const ms = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(ms)) {
    throw new MinswapError(
      `Invalid time value: expected a finite epoch or a valid Date`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "time", reason: "not a finite epoch or valid Date" }
    );
  }
  return ms;
}
function toEpochSeconds(value) {
  return Math.floor(toEpochMs(value) / 1e3);
}
function toRfc3339(value) {
  return new Date(toEpochMs(value)).toISOString();
}

// src/client/aggregator-api-client.ts
var AggregatorApiClient = class {
  constructor(http, config) {
    this.http = http;
    this.config = config;
  }
  http;
  config;
  async get(options) {
    return this.http.request({
      url: buildUrl(this.baseUrl, options.path, options.query),
      method: "GET",
      endpoint: `GET ${options.path}`,
      schema: options.schema,
      notFound: options.notFound
    });
  }
  async post(options) {
    return this.http.request({
      url: buildUrl(this.baseUrl, options.path),
      method: "POST",
      body: options.body,
      endpoint: `POST ${options.path}`,
      schema: options.schema,
      notFound: options.notFound
    });
  }
  get baseUrl() {
    return this.config.endpoints.aggregatorApiUrl;
  }
};
var paginationSchema = z.object({
  offset: z.number().nullish(),
  limit: z.number().nullish(),
  // Cursors are strings on newer endpoints and numeric ids on older ones.
  last_cursor: z.union([z.string(), z.number()]).nullish()
});
function envelope(data) {
  return z.object({
    code: z.number(),
    message: z.string().nullish(),
    data,
    pagination: paginationSchema.nullish()
  });
}
var AppApiClient = class {
  constructor(http, config) {
    this.http = http;
    this.config = config;
  }
  http;
  config;
  async get(options) {
    return this.send(
      "GET",
      options.path,
      options,
      buildUrl(this.baseUrl, options.path, options.query)
    );
  }
  async post(options) {
    return this.send(
      "POST",
      options.path,
      options,
      buildUrl(this.baseUrl, options.path),
      options.body
    );
  }
  get baseUrl() {
    return this.config.endpoints.appApiUrl;
  }
  async send(method, path, options, url, body) {
    const response = await this.http.request({
      url,
      method,
      body,
      endpoint: `${method} ${path}`,
      headers: this.headers(options.currency),
      schema: envelope(options.schema),
      notFound: options.notFound
    });
    const pagination = response.pagination ? {
      offset: response.pagination.offset,
      limit: response.pagination.limit,
      lastCursor: response.pagination.last_cursor === null || response.pagination.last_cursor === void 0 ? null : String(response.pagination.last_cursor)
    } : void 0;
    return { data: response.data, pagination };
  }
  headers(currency) {
    const headers = {
      "x-currency": currency ?? this.config.currency
    };
    if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
    }
    return headers;
  }
};

// src/client/http.ts
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isRetryable(error) {
  if (error.code === "NETWORK" /* NETWORK */) {
    return true;
  }
  if (error.code === "API_ERROR" /* API_ERROR */) {
    const { status } = error.details;
    return status >= 500;
  }
  return false;
}
function toParseIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "<root>",
    message: issue.message
  }));
}
function parseOrThrow(schema, value, endpoint) {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issues = toParseIssues(result.error);
  throw new MinswapError(
    `${endpoint} returned an unexpected shape (${issues.length} issue(s)). This usually means the backend changed; please report it.`,
    "PARSE_ERROR" /* PARSE_ERROR */,
    { endpoint, issues }
  );
}
function apiError(endpoint, status, body) {
  return new MinswapError(`${endpoint} responded ${status}`, "API_ERROR" /* API_ERROR */, {
    endpoint,
    status,
    body
  });
}
function parseRetryAfterMs(header) {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds * 1e3;
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}
var HttpCore = class {
  constructor(options) {
    this.options = options;
  }
  options;
  async request(request) {
    const { retries, baseDelayMs } = this.options.retry;
    let lastError;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(request);
      } catch (error) {
        if (!(error instanceof MinswapError)) {
          throw error;
        }
        lastError = error;
        if (attempt >= retries || !isRetryable(error)) {
          throw lastError;
        }
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  async attempt(request) {
    const { timeoutMs } = this.options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.send(request, controller.signal);
      await this.assertOk(response, request);
      return await this.decode(response, request);
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new MinswapError(
          `Request to ${request.endpoint} timed out after ${timeoutMs}ms`,
          "TIMEOUT" /* TIMEOUT */,
          { endpoint: request.endpoint, timeoutMs }
        );
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }
  async send(request, signal) {
    const { fetch } = this.options;
    const headers = {
      accept: "application/json",
      ...request.headers
    };
    if (request.body !== void 0) {
      headers["content-type"] = "application/json";
    }
    try {
      return await fetch(request.url, {
        method: request.method,
        headers,
        body: request.body === void 0 ? void 0 : JSON.stringify(request.body),
        signal
      });
    } catch (cause) {
      if (signal.aborted) {
        throw cause;
      }
      throw new MinswapError(
        `Network request to ${request.endpoint} failed`,
        "NETWORK" /* NETWORK */,
        { endpoint: request.endpoint, cause }
      );
    }
  }
  async assertOk(response, request) {
    if (response.ok) {
      return;
    }
    if (response.status === 429) {
      throw new MinswapError(
        `Rate limited by ${new URL(request.url).host}. This host blocks breaching clients for an extended period; back off before retrying.`,
        "RATE_LIMITED" /* RATE_LIMITED */,
        {
          host: new URL(request.url).host,
          retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"))
        }
      );
    }
    if (request.parseErrorBody) {
      return;
    }
    if (response.status === 404 && request.notFound) {
      const { resource, id } = request.notFound;
      throw new MinswapError(`No ${resource} found for "${id}"`, "NOT_FOUND" /* NOT_FOUND */, {
        resource,
        id
      });
    }
    throw apiError(request.endpoint, response.status, await readBody(response));
  }
  async decode(response, request) {
    const raw = await response.text();
    let json;
    try {
      json = raw.length === 0 ? void 0 : (request.parseJson ?? JSON.parse)(raw);
    } catch {
      if (!response.ok) {
        throw apiError(request.endpoint, response.status, truncate(raw));
      }
      throw new MinswapError(
        `${request.endpoint} returned a body that is not valid JSON`,
        "PARSE_ERROR" /* PARSE_ERROR */,
        {
          endpoint: request.endpoint,
          issues: [
            {
              path: "<root>",
              message: `Expected JSON, received: ${truncate(raw)}`
            }
          ]
        }
      );
    }
    if (!response.ok && json === void 0) {
      throw apiError(request.endpoint, response.status, null);
    }
    return parseOrThrow(request.schema, json, request.endpoint);
  }
};
async function readBody(response) {
  try {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return truncate(text);
    }
  } catch {
    return void 0;
  }
}
function truncate(value, max = 300) {
  return value.length <= max ? value : `${value.slice(0, max)}\u2026`;
}

// src/client/app-graphql-client.ts
var graphqlEnvelope = z.object({
  data: z.unknown().nullish(),
  errors: z.array(
    z.object({
      message: z.string(),
      path: z.array(z.union([z.string(), z.number()])).nullish()
    })
  ).nullish()
});
var AppGraphqlClient = class {
  constructor(http, config) {
    this.http = http;
    this.config = config;
  }
  http;
  config;
  async execute(operation) {
    const endpoint = `GraphQL ${operation.operation}`;
    const response = await this.http.request({
      url: this.config.endpoints.appGraphqlUrl,
      method: "POST",
      endpoint,
      body: {
        // No `operationName`: each document defines exactly one operation, so
        // the server runs it without one. Sending the field name would have to
        // match the document's operation name exactly — a needless coupling.
        query: operation.document,
        variables: operation.variables ?? {}
      },
      schema: graphqlEnvelope,
      // Resolver errors can come back with a 400/500 status; decode the body
      // anyway so the GraphQL `errors` array is not lost as an opaque API error.
      parseErrorBody: true
    });
    if (response.errors && response.errors.length > 0) {
      throw new MinswapError(
        `${operation.operation} failed: ${response.errors.map((e) => e.message).join("; ")}`,
        "GRAPHQL_ERROR" /* GRAPHQL_ERROR */,
        {
          operation: operation.operation,
          errors: response.errors.map((e) => ({
            message: e.message,
            path: e.path ?? void 0
          }))
        }
      );
    }
    const data = response.data;
    if (data === null || data === void 0) {
      throw new MinswapError(
        `${operation.operation} returned no data and no errors`,
        "PARSE_ERROR" /* PARSE_ERROR */,
        {
          endpoint,
          issues: [{ path: "data", message: "Expected an object, received null" }]
        }
      );
    }
    const root = data;
    const keys = Object.keys(root);
    if (keys.length !== 1) {
      throw new MinswapError(
        `${operation.operation} expected a single root field, got [${keys.join(", ")}]`,
        "PARSE_ERROR" /* PARSE_ERROR */,
        {
          endpoint,
          issues: [
            { path: "data", message: `expected exactly one root field, got ${keys.length}` }
          ]
        }
      );
    }
    return parseOrThrow(operation.schema, root[keys[0]], endpoint);
  }
};

// src/client/config.ts
var DEFAULT_ENDPOINTS = {
  mainnet: {
    appApiUrl: "https://api-internal.minswap.org",
    aggregatorApiUrl: "https://agg-api.minswap.org",
    keyAppApiUrl: "https://k-app-monorepo-mainnet-prod.minswap.org/graphql",
    appGraphqlUrl: "https://app-monorepo-mainnet-prod.minswap.org/graphql"
  }
};
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_RETRY = {
  retries: 2,
  baseDelayMs: 300
};
function invalid(param, reason) {
  throw new MinswapError(`Invalid config: ${param} ${reason}`, "INVALID_PARAMS" /* INVALID_PARAMS */, {
    param,
    reason
  });
}
function resolveConfig(config = {}) {
  const network = config.network ?? "mainnet";
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    invalid(
      "fetch",
      "is not available on globalThis; pass an implementation via `new MinswapSdk({ fetch })`"
    );
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    invalid("timeoutMs", "must be a positive finite number");
  }
  const retries = config.retry?.retries ?? DEFAULT_RETRY.retries;
  if (!Number.isInteger(retries) || retries < 0) {
    invalid("retry.retries", "must be a non-negative integer");
  }
  const baseDelayMs = config.retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    invalid("retry.baseDelayMs", "must be a non-negative finite number");
  }
  return {
    network,
    currency: config.currency ?? "USD",
    apiKey: config.apiKey,
    endpoints: {
      ...DEFAULT_ENDPOINTS[network],
      ...config.endpoints
    },
    fetch: fetchImpl,
    timeoutMs,
    retry: { retries, baseDelayMs },
    rpcProvider: config.rpcProvider
  };
}
var graphqlEnvelope2 = z.object({
  data: z.unknown().nullish(),
  errors: z.array(
    z.object({
      message: z.string(),
      path: z.array(z.union([z.string(), z.number()])).nullish()
    })
  ).nullish()
});
var KeyAppApiClient = class {
  constructor(http, config) {
    this.http = http;
    this.config = config;
  }
  http;
  config;
  async execute(operation) {
    const endpoint = `GraphQL ${operation.operation}`;
    const response = await this.http.request({
      url: this.config.endpoints.keyAppApiUrl,
      method: "POST",
      endpoint,
      body: {
        // No `operationName`: each document defines exactly one operation, so
        // GraphQL runs it without one. Sending the field name here would have
        // to match the document's operation name exactly, which is a needless
        // coupling — `operation.operation` is only a label for errors and the
        // single-field unwrap below.
        query: operation.document,
        variables: operation.variables ?? {}
      },
      schema: graphqlEnvelope2,
      // This host returns resolver errors with a 400/500 status; decode the
      // body anyway so the GraphQL `errors` array is not lost.
      parseErrorBody: true
    });
    if (response.errors && response.errors.length > 0) {
      throw new MinswapError(
        `${operation.operation} failed: ${response.errors.map((e) => e.message).join("; ")}`,
        "GRAPHQL_ERROR" /* GRAPHQL_ERROR */,
        {
          operation: operation.operation,
          errors: response.errors.map((e) => ({
            message: e.message,
            path: e.path ?? void 0
          }))
        }
      );
    }
    const data = response.data;
    if (data === null || data === void 0) {
      throw new MinswapError(
        `${operation.operation} returned no data and no errors`,
        "PARSE_ERROR" /* PARSE_ERROR */,
        {
          endpoint,
          issues: [{ path: "data", message: "Expected an object, received null" }]
        }
      );
    }
    const root = data;
    const keys = Object.keys(root);
    if (keys.length !== 1) {
      throw new MinswapError(
        `${operation.operation} expected a single root field, got [${keys.join(", ")}]`,
        "PARSE_ERROR" /* PARSE_ERROR */,
        {
          endpoint,
          issues: [
            { path: "data", message: `expected exactly one root field, got ${keys.length}` }
          ]
        }
      );
    }
    return parseOrThrow(operation.schema, root[keys[0]], endpoint);
  }
};

// src/client/asset-id.ts
var POLICY_ID_HEX_LENGTH = 56;
function coinIdToAssetUnit(coinId) {
  if (coinId === "lovelace") {
    return "lovelace";
  }
  return coinId.replace(".", "");
}
function assetUnitToCoinId(unit) {
  if (unit === "lovelace" || unit.length <= POLICY_ID_HEX_LENGTH) {
    return unit;
  }
  return `${unit.slice(0, POLICY_ID_HEX_LENGTH)}.${unit.slice(POLICY_ID_HEX_LENGTH)}`;
}
function coinIdToInputAsset(coinId) {
  if (coinId === "lovelace") {
    return { currencySymbol: "", tokenName: "" };
  }
  const dot = coinId.indexOf(".");
  if (dot === -1) {
    return { currencySymbol: coinId, tokenName: "" };
  }
  return {
    currencySymbol: coinId.slice(0, dot),
    tokenName: coinId.slice(dot + 1)
  };
}
function inputAssetToCoinId(asset2) {
  if (asset2.currencySymbol === "") {
    return "lovelace";
  }
  return asset2.tokenName === "" ? asset2.currencySymbol : `${asset2.currencySymbol}.${asset2.tokenName}`;
}
function arrayOf(schema) {
  return z.array(schema).nullish().transform((value) => value ?? []);
}
var zeroableNumber = z.number().nullish().transform((value) => value ?? 0);
var coinBasicInfoSchema = z.object({
  coin_type: z.string().nullish(),
  symbol: z.string(),
  decimals: z.number(),
  icon_url: z.string(),
  verified: z.boolean()
}).transform((c) => ({
  coinId: c.coin_type ?? null,
  symbol: c.symbol,
  decimals: c.decimals,
  iconUrl: c.icon_url,
  verified: c.verified
}));
var coinAmountInfoSchema = z.object({
  coin_type: z.string().nullish(),
  symbol: z.string(),
  decimals: z.number(),
  icon_url: z.string(),
  verified: z.boolean(),
  amount: z.number(),
  usd_value: z.number()
}).transform((c) => ({
  coinId: c.coin_type ?? null,
  symbol: c.symbol,
  decimals: c.decimals,
  iconUrl: c.icon_url,
  verified: c.verified,
  amount: c.amount,
  usdValue: c.usd_value
}));
var poolCoinSchema = z.object({
  coin_type: z.string().nullish(),
  symbol: z.string(),
  decimals: z.number(),
  icon_url: z.string(),
  verified: z.boolean(),
  category: z.string().nullish()
}).transform((c) => ({
  coinId: c.coin_type ?? null,
  symbol: c.symbol,
  decimals: c.decimals,
  iconUrl: c.icon_url,
  verified: c.verified,
  /** Free-form; not constrained to the `categoryGroup` filter values. */
  category: c.category ?? null
}));
var poolRewardSchema = z.object({
  coin_type: z.string().nullish(),
  symbol: z.string(),
  decimals: z.number(),
  icon_url: z.string(),
  verified: z.boolean(),
  daily_amount: z.number(),
  daily_amount_usd: z.number(),
  apr: z.number()
}).transform((r) => ({
  coinId: r.coin_type ?? null,
  symbol: r.symbol,
  decimals: r.decimals,
  iconUrl: r.icon_url,
  verified: r.verified,
  dailyAmount: r.daily_amount,
  dailyAmountUsd: r.daily_amount_usd,
  apr: r.apr
}));
var poolFeeSchema = z.object({ fee_raw: z.number(), fee_usd: z.number() }).transform((f) => ({ feeRaw: f.fee_raw, feeUsd: f.fee_usd }));
var coinCandleSchema = z.object({
  t: z.string(),
  ohlcv: z.array(z.number()).nullish()
}).transform(({ t, ohlcv }) => {
  const [open = 0, high = 0, low = 0, close = 0, volume = 0] = ohlcv ?? [];
  return { timestamp: Date.parse(t), open, high, low, close, volume };
});
var poolCandleSchema = z.array(z.number()).transform(([seconds = 0, open = 0, high = 0, low = 0, close = 0, volume = 0]) => ({
  timestamp: seconds * 1e3,
  open,
  high,
  low,
  close,
  volume
}));
var VALID_BUCKET_MINUTES = [
  1,
  5,
  15,
  30,
  60,
  120,
  240,
  360,
  720,
  1440,
  5760,
  10080,
  43200
];
function assertBucket(bucketMinutes) {
  if (!VALID_BUCKET_MINUTES.includes(bucketMinutes)) {
    throw new MinswapError(
      `bucketMinutes must be one of ${VALID_BUCKET_MINUTES.join(", ")}; received ${bucketMinutes}`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "bucketMinutes", reason: "unsupported bucket size" }
    );
  }
}

// src/modules/aggregator-module.ts
var AGGREGATOR_PROTOCOLS = [
  "MinswapV2",
  "Minswap",
  "MinswapStable",
  "Splash",
  "Spectrum",
  "SplashStable",
  "SundaeSwapV3",
  "SundaeSwap",
  "SundaeSwapStable",
  "WingRidersV2",
  "WingRiders",
  "WingRidersStableV1",
  "WingRidersStableV2",
  "OpenDjedV1",
  "ChakraBondingCurve",
  "CswapV1",
  "VyFinance",
  "MuesliSwap",
  "DanogoCLMMV1"
];
var CANCEL_ADAPTER_PROTOCOL = "MINSWAP_ADAPTER";
var assetSchema = z.object({
  token_id: z.string(),
  logo: z.string().nullish(),
  ticker: z.string().nullish(),
  is_verified: z.boolean().nullish(),
  price_by_ada: z.number().nullish(),
  price_by_usd: z.number().nullish(),
  project_name: z.string().nullish(),
  decimals: z.number().nullish()
}).transform((a) => ({
  coinId: assetUnitToCoinId(a.token_id),
  logo: a.logo ?? null,
  ticker: a.ticker ?? null,
  isVerified: a.is_verified ?? null,
  priceByAda: a.price_by_ada ?? null,
  priceByUsd: a.price_by_usd ?? null,
  projectName: a.project_name ?? null,
  decimals: a.decimals ?? null
}));
var pathAtomicSchema = z.object({
  pool_id: z.string(),
  protocol: z.string(),
  lp_token: z.string(),
  token_in: z.string(),
  token_out: z.string(),
  amount_in: z.string(),
  amount_out: z.string(),
  min_amount_out: z.string(),
  lp_fee: z.string(),
  dex_fee: z.string(),
  deposits: z.string(),
  price_impact: z.number(),
  pool_out_ref: z.string().nullish()
}).transform((p) => ({
  poolId: p.pool_id,
  protocol: p.protocol,
  lpToken: p.lp_token,
  tokenIn: assetUnitToCoinId(p.token_in),
  tokenOut: assetUnitToCoinId(p.token_out),
  amountIn: p.amount_in,
  amountOut: p.amount_out,
  minAmountOut: p.min_amount_out,
  lpFee: p.lp_fee,
  dexFee: p.dex_fee,
  deposits: p.deposits,
  priceImpact: p.price_impact,
  poolOutRef: p.pool_out_ref ?? null
}));
var pathSchema = z.object({
  pool_id: z.string(),
  protocol: z.string(),
  lp_token: z.string(),
  token_in: z.string(),
  token_out: z.string(),
  amount_in: z.string(),
  amount_out: z.string(),
  min_amount_out: z.string(),
  lp_fee: z.string(),
  dex_fee: z.string(),
  deposits: z.string(),
  price_impact: z.number(),
  pool_out_ref: z.string().nullish(),
  callback_paths: z.array(z.array(pathAtomicSchema)).nullish()
}).transform((p) => ({
  poolId: p.pool_id,
  protocol: p.protocol,
  lpToken: p.lp_token,
  tokenIn: assetUnitToCoinId(p.token_in),
  tokenOut: assetUnitToCoinId(p.token_out),
  amountIn: p.amount_in,
  amountOut: p.amount_out,
  minAmountOut: p.min_amount_out,
  lpFee: p.lp_fee,
  dexFee: p.dex_fee,
  deposits: p.deposits,
  priceImpact: p.price_impact,
  poolOutRef: p.pool_out_ref ?? null,
  callbackPaths: p.callback_paths ?? []
}));
var estimateSchema = z.object({
  token_in: z.string(),
  token_out: z.string(),
  amount_in: z.string(),
  amount_out: z.string(),
  min_amount_out: z.string(),
  total_lp_fee: z.string(),
  total_dex_fee: z.string(),
  deposits: z.string(),
  avg_price_impact: z.number(),
  paths: z.array(z.array(pathSchema)),
  aggregator_fee: z.string().nullish(),
  aggregator_fee_percent: z.number().nullish(),
  tokens: z.record(z.string(), assetSchema).nullish(),
  amount_in_decimal: z.boolean().nullish()
}).transform((e) => ({
  tokenIn: assetUnitToCoinId(e.token_in),
  tokenOut: assetUnitToCoinId(e.token_out),
  amountIn: e.amount_in,
  amountOut: e.amount_out,
  /** Worst acceptable output after slippage — pass to {@link AggregatorModule.buildTx}. */
  minAmountOut: e.min_amount_out,
  totalLpFee: e.total_lp_fee,
  totalDexFee: e.total_dex_fee,
  deposits: e.deposits,
  avgPriceImpact: e.avg_price_impact,
  /**
   * Split routes: the outer array is parallel splits of the input, the inner
   * array is the sequential hops of one split.
   */
  paths: e.paths,
  aggregatorFee: e.aggregator_fee ?? null,
  aggregatorFeePercent: e.aggregator_fee_percent ?? null,
  /** Metadata for every token mentioned, keyed by `coinId`. */
  tokens: e.tokens ? Object.fromEntries(
    Object.entries(e.tokens).map(([unit, asset2]) => [assetUnitToCoinId(unit), asset2])
  ) : {},
  amountInDecimal: e.amount_in_decimal ?? false
}));
var buildTxResponseSchema = z.object({ cbor: z.string() }).transform((r) => ({ cbor: r.cbor }));
var submitResponseSchema = z.object({ tx_id: z.string() }).transform((r) => ({ txId: r.tx_id }));
var pendingOrderSchema = z.object({
  owner_address: z.string(),
  protocol: z.string(),
  token_in: assetSchema,
  token_out: assetSchema,
  amount_in: z.string(),
  min_amount_out: z.string(),
  created_at: z.number(),
  tx_in: z.string(),
  dex_fee: z.string(),
  deposit: z.string()
}).transform((o) => ({
  ownerAddress: o.owner_address,
  protocol: o.protocol,
  tokenIn: o.token_in,
  tokenOut: o.token_out,
  amountIn: o.amount_in,
  minAmountOut: o.min_amount_out,
  /** Epoch seconds. */
  createdAt: o.created_at,
  /** The order's UTxO reference, `txHash#index` — pass to {@link AggregatorModule.cancelOrders}. */
  txIn: o.tx_in,
  dexFee: o.dex_fee,
  deposit: o.deposit
}));
var pendingOrdersSchema = z.object({
  orders: arrayOf(pendingOrderSchema),
  amount_in_decimal: z.boolean()
}).transform((r) => r.orders);
function estimateBody(params) {
  return dropUndefined({
    amount: params.amount,
    token_in: coinIdToAssetUnit(params.tokenIn),
    token_out: coinIdToAssetUnit(params.tokenOut),
    slippage: params.slippage,
    include_protocols: params.includeProtocols,
    exclude_protocols: params.excludeProtocols,
    allow_multi_hops: params.allowMultiHops,
    allow_non_atomic_multi_hops: params.allowNonAtomicMultiHops,
    partner: params.partner,
    amount_in_decimal: params.amountInDecimal
  });
}
var AggregatorModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /**
   * Quote a swap: the best route, expected output, fees, and price impact.
   *
   * @example
   * const quote = await sdk.aggregator.estimate({
   *   amount: "1000000",
   *   tokenIn: "lovelace",
   *   tokenOut: "29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6.4d494e",
   *   slippage: 0.5,
   * });
   */
  async estimate(params) {
    return this.sdk.clients.aggregatorApi.post({
      path: "/aggregator/estimate",
      body: estimateBody(params),
      schema: estimateSchema
    });
  }
  /**
   * Build the unsigned swap transaction for a quote.
   *
   * @example
   * const quote = await sdk.aggregator.estimate(params);
   * const { cbor } = await sdk.aggregator.buildTx({
   *   sender,
   *   estimate: params,
   *   minAmountOut: quote.minAmountOut,
   * });
   */
  async buildTx(params) {
    return this.sdk.clients.aggregatorApi.post({
      path: "/aggregator/build-tx",
      body: dropUndefined({
        sender: params.sender,
        min_amount_out: params.minAmountOut,
        estimate: estimateBody(params.estimate),
        amount_in_decimal: params.estimate.amountInDecimal,
        extra_output: params.extraOutput,
        inputs_to_choose: params.inputsToChoose
      }),
      schema: buildTxResponseSchema
    });
  }
  /**
   * Assemble a signed witness onto a built transaction and submit it.
   *
   * @param witnessSet CBOR of the witness set produced by signing the tx.
   */
  async submitTx(params) {
    return this.sdk.clients.aggregatorApi.post({
      path: "/aggregator/finalize-and-submit-tx",
      body: { cbor: params.cbor, witness_set: params.witnessSet },
      schema: submitResponseSchema
    });
  }
  /**
   * Build a transaction that cancels one or more open orders.
   *
   * The returned CBOR is **partially signed** by the server. Between 1 and 6
   * orders per call, the server's own limit.
   */
  async cancelOrders(params) {
    if (params.orders.length < 1 || params.orders.length > 6) {
      throw new MinswapError(
        `cancelOrders takes between 1 and 6 orders; received ${params.orders.length}`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "orders", reason: "must contain 1 to 6 entries" }
      );
    }
    return this.sdk.clients.aggregatorApi.post({
      path: "/aggregator/cancel-tx",
      body: {
        sender: params.sender,
        orders: params.orders.map((o) => ({
          tx_in: o.txIn,
          protocol: o.protocol
        }))
      },
      schema: buildTxResponseSchema
    });
  }
  /**
   * List an address's still-open aggregator orders.
   *
   * Only orders whose UTxO is still unspent are returned, so this is genuinely
   * "open orders" rather than history. For full history including filled and
   * cancelled orders, use {@link OrderModule.getHistory}.
   */
  async getPendingOrders(ownerAddress, options = {}) {
    return this.sdk.clients.aggregatorApi.get({
      path: "/aggregator/pending-orders",
      query: {
        owner_address: ownerAddress,
        amount_in_decimal: options.amountInDecimal
      },
      schema: pendingOrdersSchema
    });
  }
};
function dropUndefined(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === void 0) {
      delete obj[key];
    }
  }
  return obj;
}

// src/client/pagination.ts
function assertLimit(limit, max) {
  if (limit === void 0) {
    return;
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > max) {
    throw new MinswapError(
      `limit must be an integer between 1 and ${max}, received ${limit}`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "limit", reason: `must be an integer in 1..${max}` }
    );
  }
}
function encodeOffsetCursor(offset) {
  return String(offset);
}
function decodeOffsetCursor(cursor) {
  if (cursor === void 0) {
    return 0;
  }
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new MinswapError(`Malformed cursor "${cursor}"`, "INVALID_PARAMS" /* INVALID_PARAMS */, {
      param: "cursor",
      reason: "must be a cursor returned by a previous call"
    });
  }
  return offset;
}
function offsetPage(items, offset, limit) {
  const hasMore = items.length === limit;
  return {
    items,
    hasMore,
    nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null
  };
}
function cursorPage(items, lastCursor) {
  const nextCursor = lastCursor ?? null;
  return {
    items,
    nextCursor,
    hasMore: nextCursor !== null && items.length > 0
  };
}
async function* paginate(fetchPage, params = {}) {
  let cursor = params.cursor;
  const seen = /* @__PURE__ */ new Set();
  for (; ; ) {
    const page = await fetchPage({ ...params, cursor });
    yield* page.items;
    if (!page.hasMore || page.nextCursor === null) {
      return;
    }
    if (seen.has(page.nextCursor)) {
      throw new MinswapError(
        `Pagination stalled: cursor "${page.nextCursor}" was returned twice`,
        "API_ERROR" /* API_ERROR */,
        {
          endpoint: "<paginate>",
          status: 200,
          body: { repeatedCursor: page.nextCursor }
        }
      );
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
async function collect(fetchPage, options = {}) {
  const { maxItems = 1e3, ...params } = options;
  const items = [];
  for await (const item of paginate(fetchPage, params)) {
    items.push(item);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

// src/client/rpc-provider.ts
function parseTxIn(ref) {
  const parts = ref.split("#");
  const [txHash, rawIndex] = parts;
  if (parts.length !== 2 || !txHash || !/^\d+$/.test(rawIndex)) {
    throw new MinswapError(
      `Malformed output reference "${ref}", expected "txHash#index"`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "ref", reason: 'must look like "txHash#index"' }
    );
  }
  return { txHash, outputIndex: Number(rawIndex) };
}
function formatTxIn(ref) {
  return `${ref.txHash}#${ref.outputIndex}`;
}
function requireRpcProvider(provider, action) {
  if (!provider) {
    throw new MinswapError(
      `${action} needs chain access. Pass an rpcProvider when constructing MinswapSdk: new MinswapSdk({ rpcProvider })`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "rpcProvider", reason: `is required by ${action}` }
    );
  }
  return provider;
}
function lovelaceOf(utxo) {
  return utxo.assets["lovelace"] ?? 0n;
}
function isPureAda(utxo) {
  return Object.keys(utxo.assets).every((unit) => unit === "lovelace");
}
function selectCollateral(utxos, { minLovelace = 5000000n, count = 1 } = {}) {
  return utxos.filter((utxo) => isPureAda(utxo) && lovelaceOf(utxo) >= minLovelace).sort((a, b) => {
    const delta = lovelaceOf(a) - lovelaceOf(b);
    return delta < 0n ? -1 : delta > 0n ? 1 : 0;
  }).slice(0, count);
}

// src/modules/wallet-inputs.ts
async function resolveWalletInputs(sdk, action, params, needCollateral) {
  const haveInputs = params.inputsToChoose !== void 0;
  const haveCollateral = params.collateralUtxos !== void 0 || !needCollateral;
  if (haveInputs && haveCollateral) {
    return {
      inputsToChoose: params.inputsToChoose ?? [],
      collateralUtxos: params.collateralUtxos ?? []
    };
  }
  const utxos = await requireRpcProvider(sdk.rpcProvider, action).getUtxosByAddress(params.address);
  let collateralUtxos = [];
  if (needCollateral) {
    if (params.collateralUtxos !== void 0) {
      collateralUtxos = params.collateralUtxos;
    } else {
      const selected = selectCollateral(utxos);
      if (selected.length === 0) {
        throw new MinswapError(
          `${action} needs collateral, but no pure-ADA UTxO large enough was found at ${params.address}`,
          "INVALID_PARAMS" /* INVALID_PARAMS */,
          {
            param: "collateralUtxos",
            reason: "no adequate pure-ADA UTxO; supply collateralUtxos explicitly"
          }
        );
      }
      collateralUtxos = selected.map((u) => u.cbor);
    }
  }
  return {
    inputsToChoose: params.inputsToChoose ?? utxos.map((u) => u.cbor),
    collateralUtxos
  };
}
function toBigIntString(value) {
  return typeof value === "bigint" ? value.toString() : BigInt(value).toString();
}

// src/modules/farm-module.ts
var FARM_PROTOCOLS = [
  "minswap-cpmm-v1",
  "minswap-cpmm-v2",
  "minswap-stable-cpmm-v1"
];
var FARM_LIST_SORT_FIELDS = [
  "liquidity_locked_usd",
  "fee_apr_24h",
  "fee_apr_1w",
  "reward_apr",
  "total_apr_24h",
  "total_apr_1w",
  "point"
];
var farmSchema = z.object({
  pool_id: z.string().nullish(),
  protocol: z.string(),
  coin_a: poolCoinSchema,
  coin_b: poolCoinSchema,
  amount_a_locked: z.number(),
  amount_b_locked: z.number(),
  amount_a_locked_usd: z.number(),
  amount_b_locked_usd: z.number(),
  price_a: z.number(),
  price_b: z.number(),
  liquidity_locked: z.string().nullish(),
  liquidity_locked_usd: z.number(),
  fee_apr_24h: z.number(),
  fee_apr_1w: z.number(),
  rewards: arrayOf(poolRewardSchema),
  active: z.boolean(),
  pool_type: z.string(),
  point: z.number(),
  is_exclusive: z.boolean(),
  nft_id_allowed: z.string().nullish()
}).transform((f) => ({
  /** The farm's LP token id. This is the `lpAsset` the action methods need. */
  poolId: f.pool_id ?? null,
  protocol: f.protocol,
  coinA: f.coin_a,
  coinB: f.coin_b,
  amountALocked: f.amount_a_locked,
  amountBLocked: f.amount_b_locked,
  amountALockedUsd: f.amount_a_locked_usd,
  amountBLockedUsd: f.amount_b_locked_usd,
  priceA: f.price_a,
  priceB: f.price_b,
  /** Total staked liquidity, a raw decimal string. */
  liquidityLocked: f.liquidity_locked ?? null,
  liquidityLockedUsd: f.liquidity_locked_usd,
  feeApr24h: f.fee_apr_24h,
  feeApr1w: f.fee_apr_1w,
  rewards: f.rewards,
  active: f.active,
  poolType: f.pool_type,
  point: f.point,
  /** Whether this is a Launch Bowl (exclusive) farm — the `hasLBBonus` flag. */
  isExclusive: f.is_exclusive,
  nftIdAllowed: f.nft_id_allowed ?? null
}));
var cborResultSchema = z.string();
function inputAssets(coinIds) {
  return coinIds?.map(coinIdToInputAsset);
}
var FarmModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /** List farms with filtering and sorting. */
  async list(params = {}) {
    assertLimit(params.limit, 50);
    const limit = params.limit ?? 20;
    const offset = decodeOffsetCursor(params.cursor);
    if (params.coinIds && params.coinIds.length > 2) {
      throw new MinswapError(
        "coinIds accepts at most 2 entries \u2014 it filters for farms containing those coins.",
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "coinIds", reason: "at most 2 entries" }
      );
    }
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/pool/yield-pools",
      query: {
        offset,
        limit,
        pool_addresses: params.poolIds,
        protocols: params.protocols,
        coin_ids: params.coinIds,
        exclusive_only: params.exclusiveOnly,
        active: params.active,
        keyword: params.search,
        sort_field: params.sortBy ?? "liquidity_locked_usd",
        sort_direction: params.order ?? "desc"
      },
      schema: arrayOf(farmSchema),
      currency: params.currency
    });
    return offsetPage(data, offset, limit);
  }
  /** An address's farm positions. Sourced from the DeFi portfolio. */
  async getPositions(address) {
    const { farms } = await this.sdk.portfolio.getDefi(address);
    return farms;
  }
  /**
   * Stake LP tokens into a farm.
   *
   * Routes to a first deposit when the address holds no position in the farm,
   * or adds to the existing stake otherwise. The distinction is resolved from
   * the address's positions unless {@link FarmDepositParams.position} is given.
   */
  async deposit(params) {
    const position = params.position !== void 0 ? params.position : await this.findPosition(params.address, params.lpAsset);
    const amount = toBigIntString(params.amount);
    if (!position) {
      const inputs2 = await resolveWalletInputs(this.sdk, "farm.deposit", params, false);
      const cbor2 = await this.sdk.clients.keyAppApi.execute({
        operation: "buildFirstDepositV2",
        document: DOC_FIRST_DEPOSIT,
        variables: {
          options: {
            farmTx: this.farmTx(params, inputs2.inputsToChoose),
            amount,
            lbWhitelistAssets: inputAssets(params.lbWhitelistAssets)
          }
        },
        schema: cborResultSchema
      });
      return { cbor: cbor2 };
    }
    const inputs = await resolveWalletInputs(this.sdk, "farm.deposit", params, true);
    const cbor = await this.sdk.clients.keyAppApi.execute({
      operation: "buildStakeDepositV2",
      document: DOC_STAKE_DEPOSIT,
      variables: {
        options: {
          farmTx: this.farmTx(params, inputs.inputsToChoose),
          amount,
          collateralUtxos: inputs.collateralUtxos,
          additionalLbWhitelistAssets: inputAssets(params.lbWhitelistAssets)
        }
      },
      schema: cborResultSchema
    });
    return { cbor };
  }
  /**
   * Withdraw staked LP tokens.
   *
   * Routes to withdraw-all when the amount is the entire stake, or a partial
   * withdrawal otherwise, comparing against the position's staked amount.
   */
  async withdraw(params) {
    const position = params.position !== void 0 ? params.position : await this.findPosition(params.address, params.lpAsset);
    if (!position) {
      throw new MinswapError(
        `No farm position found for ${params.lpAsset} at this address`,
        "NOT_FOUND" /* NOT_FOUND */,
        { resource: "farm", id: params.lpAsset }
      );
    }
    const inputs = await resolveWalletInputs(this.sdk, "farm.withdraw", params, true);
    const amount = BigInt(toBigIntString(params.amount));
    const staked = stakedLpAmount(position);
    if (amount >= staked) {
      const cbor2 = await this.sdk.clients.keyAppApi.execute({
        operation: "buildStakeWithdrawAllV2",
        document: DOC_WITHDRAW_ALL,
        variables: {
          options: {
            farmTx: this.farmTx(params, inputs.inputsToChoose),
            collateralUtxos: inputs.collateralUtxos
          }
        },
        schema: cborResultSchema
      });
      return { cbor: cbor2 };
    }
    const cbor = await this.sdk.clients.keyAppApi.execute({
      operation: "buildStakeWithdrawV2",
      document: DOC_WITHDRAW,
      variables: {
        options: {
          farmTx: this.farmTx(params, inputs.inputsToChoose),
          amount: amount.toString(),
          collateralUtxos: inputs.collateralUtxos
        }
      },
      schema: cborResultSchema
    });
    return { cbor };
  }
  /** Harvest pending rewards from one or more farms in a single transaction. */
  async harvest(params) {
    if (params.farms.length === 0) {
      throw new MinswapError("harvest needs at least one farm", "INVALID_PARAMS" /* INVALID_PARAMS */, {
        param: "farms",
        reason: "must not be empty"
      });
    }
    const inputs = await resolveWalletInputs(this.sdk, "farm.harvest", params, true);
    const cbor = await this.sdk.clients.keyAppApi.execute({
      operation: "buildMultipleHarvestsV2",
      document: DOC_MULTIPLE_HARVESTS,
      variables: {
        options: {
          owner: params.address,
          pools: params.farms.map((f) => ({
            lpAsset: f.lpAsset,
            hasLBBonus: f.hasLBBonus
          })),
          inputsToChoose: inputs.inputsToChoose,
          useCoinSelectionStrategy: true,
          collateralUtxos: inputs.collateralUtxos,
          shouldSplitChange: params.shouldSplitChange
        }
      },
      schema: cborResultSchema
    });
    return { cbor };
  }
  /**
   * Force-withdraw a stake, forfeiting pending rewards.
   *
   * A safety valve for when a normal withdrawal cannot proceed. Prefer
   * {@link FarmModule.withdraw}.
   */
  async emergencyWithdraw(params) {
    const inputs = await resolveWalletInputs(this.sdk, "farm.emergencyWithdraw", params, true);
    const cbor = await this.sdk.clients.keyAppApi.execute({
      operation: "buildEmergencyWithdrawV2",
      document: DOC_EMERGENCY_WITHDRAW,
      variables: {
        options: {
          farmTx: this.farmTx(params, inputs.inputsToChoose),
          collateralUtxos: inputs.collateralUtxos
        }
      },
      schema: cborResultSchema
    });
    return { cbor };
  }
  farmTx(params, inputsToChoose) {
    return {
      owner: params.address,
      lpAsset: params.lpAsset,
      hasLBBonus: params.hasLBBonus,
      inputsToChoose,
      useCoinSelectionStrategy: true,
      shouldSplitChange: params.shouldSplitChange
    };
  }
  async findPosition(address, lpAsset) {
    const positions = await this.getPositions(address);
    return positions.find((p) => p.poolId === lpAsset) ?? null;
  }
};
function stakedLpAmount(position) {
  if (position.lpPosition?.lpAmount) {
    return BigInt(position.lpPosition.lpAmount);
  }
  throw new MinswapError(
    `Farm position ${position.poolId} has no staked LP amount to withdraw against`,
    "INVALID_PARAMS" /* INVALID_PARAMS */,
    { param: "position", reason: "position carries no lpPosition.lpAmount" }
  );
}
var DOC_FIRST_DEPOSIT = `mutation BuildFirstDepositV2($options: BuildFirstDepositTxOptions!) {
  buildFirstDepositV2(options: $options)
}`;
var DOC_STAKE_DEPOSIT = `mutation BuildStakeDepositV2($options: BuildStakeDepositOptions!) {
  buildStakeDepositV2(options: $options)
}`;
var DOC_WITHDRAW = `mutation BuildStakeWithdrawV2($options: BuildStakeWithdrawOptions!) {
  buildStakeWithdrawV2(options: $options)
}`;
var DOC_WITHDRAW_ALL = `mutation BuildStakeWithdrawAllV2($options: BuildStakeWithdrawAllOptions!) {
  buildStakeWithdrawAllV2(options: $options)
}`;
var DOC_MULTIPLE_HARVESTS = `mutation BuildMultipleHarvestsV2($options: BuildMultipleHarvestsOptions!) {
  buildMultipleHarvestsV2(options: $options)
}`;
var DOC_EMERGENCY_WITHDRAW = `mutation BuildEmergencyWithdrawV2($options: BuildEmergencyWithdrawOptions!) {
  buildEmergencyWithdrawV2(options: $options)
}`;

// src/liquidity/config.ts
var MAINNET_NETWORK_ENV = 764824073;
var BATCHER_FEE = 2000000n;
var DEPOSIT_ADA = 2000000n;
var DEX_V2 = {
  lpPolicyId: "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c",
  orderScriptHash: "c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c",
  tradingFeeDenominator: 10000n
};
var DEX_V1 = {
  lpPolicyId: "e4214b7cce62ac6fbba385d164df48e157eae5863521b4b67ca71d86",
  orderScriptHash: "a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b"
};

// src/liquidity/plutus.ts
function constr(index, fields) {
  return { constructor: index, fields };
}
function integer(value) {
  return { int: BigInt(value).toString() };
}
function bytes(hex) {
  return { bytes: hex };
}

// src/liquidity/datum/dex-v2.ts
function killable(killOnFailed) {
  return constr(0, []);
}
function direction(dir) {
  return constr(dir === "A_TO_B" ? 1 : 0, []);
}
function depositStep(params) {
  return constr(4, [
    constr(0, [integer(params.depositAmountA), integer(params.depositAmountB)]),
    integer(params.minimumLP),
    killable()
  ]);
}
function withdrawStep(params) {
  return constr(5, [
    constr(0, [integer(params.withdrawalLPAmount)]),
    integer(params.minimumAssetA),
    integer(params.minimumAssetB),
    killable()
  ]);
}
function zapOutStep(params) {
  return constr(6, [
    direction(params.direction),
    constr(0, [integer(params.withdrawalLPAmount)]),
    integer(params.minimumReceived),
    killable()
  ]);
}
function credential(c) {
  return constr(c.isScript ? 1 : 0, [bytes(c.hash)]);
}
function addressData(payment, stake) {
  const stakeMaybe = stake ? constr(0, [constr(0, [credential(stake)])]) : constr(1, []);
  return constr(0, [credential(payment), stakeMaybe]);
}
function orderDatum(params) {
  const sender = addressData(
    { hash: params.paymentKeyHash, isScript: params.paymentIsScript },
    params.stakeKeyHash ? { hash: params.stakeKeyHash, isScript: params.stakeIsScript } : null
  );
  const noDatum = constr(0, []);
  return constr(0, [
    constr(0, [bytes(params.paymentKeyHash)]),
    // canceller = SIGNATURE [pubKeyHash]
    sender,
    // refundReceiver
    noDatum,
    // refundReceiverDatum
    sender,
    // successReceiver
    noDatum,
    // successReceiverDatum
    constr(0, [bytes(params.lpAsset.policyId), bytes(params.lpAsset.nameHex)]),
    params.step,
    integer(params.maxBatcherFee),
    constr(1, [])
    // expiredOptions = Nothing
  ]);
}

// src/liquidity/datum/dex-v1.ts
function asset(a) {
  return constr(0, [bytes(a.policyId), bytes(a.nameHex)]);
}
function depositStep2(params) {
  return constr(2, [integer(params.minimumLP)]);
}
function withdrawStep2(params) {
  return constr(3, [integer(params.minimumAssetA), integer(params.minimumAssetB)]);
}
function oneSideDepositStep(params) {
  return constr(4, [asset(params.desiredAsset), integer(params.minimumLP)]);
}
function orderDatum2(params) {
  const address = addressData(
    { hash: params.paymentKeyHash, isScript: params.paymentIsScript },
    params.stakeKeyHash ? { hash: params.stakeKeyHash, isScript: params.stakeIsScript } : null
  );
  const datumHashMaybe = params.receiverDatumHash ? constr(0, [bytes(params.receiverDatumHash)]) : constr(1, []);
  return constr(0, [
    address,
    // sender
    address,
    // receiver
    datumHashMaybe,
    params.step,
    integer(params.batcherFee),
    integer(params.outputADA)
  ]);
}

// src/liquidity/math/dex-v2.ts
var FEE_DENOMINATOR = 10000n;
function sqrt(value) {
  if (value < 0n) {
    throw new Error("sqrt of a negative number");
  }
  if (value < 2n) {
    return value;
  }
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}
function calculateAmountOut(params) {
  const diff = FEE_DENOMINATOR - params.tradingFeeNumerator;
  const inWithFee = diff * params.amountIn;
  return inWithFee * params.reserveOut / (FEE_DENOMINATOR * params.reserveIn + inWithFee);
}
function calculateDepositSwapAmount(params) {
  const { amountIn, amountOut, reserveIn, reserveOut, tradingFeeNumerator } = params;
  const x = (amountOut + reserveOut) * reserveIn;
  const y = 4n * (amountOut + reserveOut) * (amountOut * reserveIn * reserveIn - amountIn * reserveIn * reserveOut);
  const z14 = 2n * (amountOut + reserveOut);
  const twoDenomMinusFee = 2n * FEE_DENOMINATOR - tradingFeeNumerator;
  const a = x * x * (twoDenomMinusFee * twoDenomMinusFee) - y * FEE_DENOMINATOR * (FEE_DENOMINATOR - tradingFeeNumerator);
  const b = twoDenomMinusFee * x;
  return [sqrt(a) - b, z14 * (FEE_DENOMINATOR - tradingFeeNumerator)];
}
function calculateDepositAmount(params) {
  const { amountA, amountB, pool } = params;
  const { reserveA, reserveB, totalLiquidity, feeANumerator, feeBNumerator } = pool;
  const ratioA = amountA * totalLiquidity / reserveA;
  const ratioB = amountB * totalLiquidity / reserveB;
  if (ratioA > ratioB) {
    const [num, den] = calculateDepositSwapAmount({
      amountIn: amountA,
      amountOut: amountB,
      reserveIn: reserveA,
      reserveOut: reserveB,
      tradingFeeNumerator: feeANumerator
    });
    return (amountA * den - num) * totalLiquidity / (reserveA * den + num);
  }
  if (ratioA < ratioB) {
    const [num, den] = calculateDepositSwapAmount({
      amountIn: amountB,
      amountOut: amountA,
      reserveIn: reserveB,
      reserveOut: reserveA,
      tradingFeeNumerator: feeBNumerator
    });
    return (amountB * den - num) * totalLiquidity / (reserveB * den + num);
  }
  return ratioA;
}
function calculateWithdrawAmount(params) {
  const { withdrawalLPAmount, reserveA, reserveB, totalLiquidity } = params;
  return {
    withdrawalA: withdrawalLPAmount * reserveA / totalLiquidity,
    withdrawalB: withdrawalLPAmount * reserveB / totalLiquidity
  };
}
function calculateZapOutAmount(params) {
  const { withdrawalLPAmount, direction: direction2, pool } = params;
  const { reserveA, reserveB, totalLiquidity, feeANumerator, feeBNumerator } = pool;
  const { withdrawalA, withdrawalB } = calculateWithdrawAmount({
    withdrawalLPAmount,
    reserveA,
    reserveB,
    totalLiquidity
  });
  const reserveAAfter = reserveA - withdrawalA;
  const reserveBAfter = reserveB - withdrawalB;
  if (direction2 === "A_TO_B") {
    return withdrawalB + calculateAmountOut({
      reserveIn: reserveAAfter,
      reserveOut: reserveBAfter,
      amountIn: withdrawalA,
      tradingFeeNumerator: feeANumerator
    });
  }
  return withdrawalA + calculateAmountOut({
    reserveIn: reserveBAfter,
    reserveOut: reserveAAfter,
    amountIn: withdrawalB,
    tradingFeeNumerator: feeBNumerator
  });
}
function minimumWithSlippage(amount, slippagePercent) {
  if (!(slippagePercent >= 0)) {
    throw new Error(`slippage must be a non-negative percent, received ${slippagePercent}`);
  }
  const bps = BigInt(Math.round(slippagePercent * 100));
  return amount * (10000n - bps) / 10000n;
}

// src/liquidity/math/dex-v1.ts
function calculateSwapExactIn(params) {
  const { amountIn, reserveIn, reserveOut } = params;
  const numerator = amountIn * 997n * reserveOut;
  const denominator = amountIn * 997n + reserveIn * 1000n;
  return numerator / denominator;
}
function calculateDeposit(params) {
  const { depositedAmountA, depositedAmountB, reserveA, reserveB, totalLiquidity } = params;
  const deltaLiquidityA = depositedAmountA * totalLiquidity / reserveA;
  const deltaLiquidityB = depositedAmountB * totalLiquidity / reserveB;
  let necessaryAmountA;
  let necessaryAmountB;
  let lpAmount;
  if (deltaLiquidityA > deltaLiquidityB) {
    necessaryAmountA = depositedAmountB * reserveA / reserveB;
    necessaryAmountB = depositedAmountB;
    lpAmount = deltaLiquidityB;
  } else if (deltaLiquidityA < deltaLiquidityB) {
    necessaryAmountA = depositedAmountA;
    necessaryAmountB = depositedAmountA * reserveB / reserveA;
    lpAmount = deltaLiquidityA;
  } else {
    necessaryAmountA = depositedAmountA;
    necessaryAmountB = depositedAmountB;
    lpAmount = deltaLiquidityA;
  }
  return { necessaryAmountA, necessaryAmountB, lpAmount };
}
function calculateWithdraw(params) {
  const { withdrawalLPAmount, reserveA, reserveB, totalLiquidity } = params;
  return {
    amountAReceive: withdrawalLPAmount * reserveA / totalLiquidity,
    amountBReceive: withdrawalLPAmount * reserveB / totalLiquidity
  };
}
function calculateZapIn(params) {
  const { amountIn, reserveIn, reserveOut, totalLiquidity } = params;
  const swapAmountIn = (sqrt(1997n ** 2n * reserveIn ** 2n + 4n * 997n * 1000n * amountIn * reserveIn) - 1997n * reserveIn) / (2n * 997n);
  const receiveAmountOut = calculateSwapExactIn({ amountIn: swapAmountIn, reserveIn, reserveOut });
  const minimumLP = receiveAmountOut * totalLiquidity / (reserveOut - receiveAmountOut);
  return { minimumLP, swapAmountIn, receiveAmountOut };
}

// src/liquidity/serializer.ts
var INTERNAL_SDK = "@minswap/internal-sdk";
var cached;
async function loadDexSerializer() {
  cached ??= (async () => {
    let mod;
    try {
      mod = await import(
        /* @vite-ignore */
        INTERNAL_SDK
      );
    } catch (cause) {
      throw new MinswapError(
        `Liquidity operations need ${INTERNAL_SDK} to serialize transactions. Install it: npm install ${INTERNAL_SDK}`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: INTERNAL_SDK, reason: `could not be imported: ${String(cause)}` }
      );
    }
    await mod.RustModule.load();
    return mod;
  })();
  return cached;
}
async function toDatumHex(datum) {
  const { PlutusData: plutus } = await loadDexSerializer();
  return plutus.toDataHex(datum);
}
async function loadDexBuilder() {
  return loadDexSerializer();
}

// src/liquidity/build/assemble.ts
async function assembleOrder(order) {
  const b = await loadDexBuilder();
  const { TxBuilderV2, TxOut, Value, Address, Asset, Bytes, DatumSource, Utxo, EmulatorProvider } = b;
  const CoinSelectionAlgorithm = b.CoinSelectionAlgorithm;
  const valueMap = { lovelace: order.lovelace };
  for (const a of order.assets) {
    valueMap[Asset.fromBlockFrostString(a.unit).toString()] = a.amount;
  }
  const datumSource = order.datumKind === "inline" ? DatumSource.newInlineDatum(Bytes.fromHex(order.orderDatumHex)) : DatumSource.newOutlineDatum(Bytes.fromHex(order.orderDatumHex));
  const output = new TxOut(
    Address.fromBech32(order.orderAddress),
    new Value(valueMap),
    datumSource
  );
  const txb = new TxBuilderV2(MAINNET_NETWORK_ENV);
  txb.payTo(output);
  const txc = await txb.completeUnsafe({
    changeAddress: Address.fromBech32(order.sender),
    provider: new EmulatorProvider(MAINNET_NETWORK_ENV),
    walletUtxos: order.walletUtxoCbors.map((c) => Utxo.fromHex(c)),
    walletCollaterals: order.collateralCbors?.map((c) => Utxo.fromHex(c)),
    coinSelectionAlgorithm: CoinSelectionAlgorithm.MINSWAP
  });
  return txc.complete();
}

// src/liquidity/build/dex-v1.ts
var isAda = (a) => a.policyId === "" && a.nameHex === "";
var unitOf = (a) => a.policyId + a.nameHex;
async function resolveSender(sender) {
  const b = await loadDexBuilder();
  const addr = b.Address.fromBech32(sender);
  const paymentKeyHash = addr.toPaymentCredential().payload.hex;
  const stakeAddr = addr.toStakeAddress?.();
  const stakeKeyHash = stakeAddr ? stakeAddr.toPubKeyHash()?.keyHash.hex ?? null : null;
  const orderAddress = b.Address.fromPlutusJson(
    addressData(
      { hash: DEX_V1.orderScriptHash, isScript: true },
      stakeKeyHash ? { hash: stakeKeyHash } : null
    ),
    MAINNET_NETWORK_ENV
  ).toString();
  return { paymentKeyHash, stakeKeyHash, orderAddress };
}
async function build(sender, senderBech32, step, lovelace, assets, walletUtxoCbors) {
  const datum = orderDatum2({
    paymentKeyHash: sender.paymentKeyHash,
    stakeKeyHash: sender.stakeKeyHash,
    step,
    batcherFee: BATCHER_FEE,
    outputADA: DEPOSIT_ADA
  });
  const cbor = await assembleOrder({
    orderAddress: sender.orderAddress,
    orderDatumHex: await toDatumHex(datum),
    datumKind: "outline",
    lovelace,
    assets,
    sender: senderBech32,
    walletUtxoCbors
  });
  return { cbor };
}
function adaSide(asset2, amount) {
  return isAda(asset2) ? amount : 0n;
}
function tokenAsset(asset2, amount) {
  return isAda(asset2) || amount === 0n ? [] : [{ unit: unitOf(asset2), amount }];
}
async function buildAddLiquidity(params) {
  if (params.amountA <= 0n || params.amountB <= 0n) {
    throw new Error(
      "V1 add-liquidity needs both amounts > 0; use buildZapIn for a one-sided deposit"
    );
  }
  const { lpAmount } = calculateDeposit({
    depositedAmountA: params.amountA,
    depositedAmountB: params.amountB,
    reserveA: params.reserveA,
    reserveB: params.reserveB,
    totalLiquidity: params.totalLiquidity
  });
  const minimumLP = minimumWithSlippage(lpAmount, params.slippage);
  const step = depositStep2({ minimumLP });
  const lovelace = DEPOSIT_ADA + BATCHER_FEE + adaSide(params.assetA, params.amountA) + adaSide(params.assetB, params.amountB);
  const assets = [
    ...tokenAsset(params.assetA, params.amountA),
    ...tokenAsset(params.assetB, params.amountB)
  ];
  const sender = await resolveSender(params.sender);
  return build(sender, params.sender, step, lovelace, assets, params.walletUtxoCbors);
}
async function buildZapIn(params) {
  const { minimumLP: rawLP } = calculateZapIn({
    amountIn: params.amountIn,
    reserveIn: params.reserveIn,
    reserveOut: params.reserveOut,
    totalLiquidity: params.totalLiquidity
  });
  const minimumLP = minimumWithSlippage(rawLP, params.slippage);
  const step = oneSideDepositStep({
    desiredAsset: { policyId: params.desiredAsset.policyId, nameHex: params.desiredAsset.nameHex },
    minimumLP
  });
  const lovelace = DEPOSIT_ADA + BATCHER_FEE + adaSide(params.assetIn, params.amountIn);
  const assets = tokenAsset(params.assetIn, params.amountIn);
  const sender = await resolveSender(params.sender);
  return build(sender, params.sender, step, lovelace, assets, params.walletUtxoCbors);
}
async function buildRemoveLiquidity(params) {
  const { amountAReceive, amountBReceive } = calculateWithdraw({
    withdrawalLPAmount: params.lpAmount,
    reserveA: params.reserveA,
    reserveB: params.reserveB,
    totalLiquidity: params.totalLiquidity
  });
  const step = withdrawStep2({
    minimumAssetA: minimumWithSlippage(amountAReceive, params.slippage),
    minimumAssetB: minimumWithSlippage(amountBReceive, params.slippage)
  });
  const assets = [{ unit: unitOf(params.lpAsset), amount: params.lpAmount }];
  const sender = await resolveSender(params.sender);
  return build(
    sender,
    params.sender,
    step,
    DEPOSIT_ADA + BATCHER_FEE,
    assets,
    params.walletUtxoCbors
  );
}

// src/liquidity/build/dex-v2.ts
var isAda2 = (a) => a.policyId === "" && a.nameHex === "";
var unitOf2 = (a) => a.policyId + a.nameHex;
async function resolveSender2(sender) {
  const b = await loadDexBuilder();
  const addr = b.Address.fromBech32(sender);
  const paymentKeyHash = addr.toPaymentCredential().payload.hex;
  const stakeAddr = addr.toStakeAddress?.();
  const stakeKeyHash = stakeAddr ? stakeAddr.toPubKeyHash()?.keyHash.hex ?? null : null;
  const orderAddress = b.Address.fromPlutusJson(
    addressData(
      { hash: DEX_V2.orderScriptHash, isScript: true },
      stakeKeyHash ? { hash: stakeKeyHash } : null
    ),
    MAINNET_NETWORK_ENV
  ).toString();
  return { paymentKeyHash, stakeKeyHash, orderAddress };
}
async function build2(sender, senderBech32, lpAsset, step, lovelace, assets, walletUtxoCbors) {
  const datum = orderDatum({
    paymentKeyHash: sender.paymentKeyHash,
    stakeKeyHash: sender.stakeKeyHash,
    lpAsset: { policyId: lpAsset.policyId, nameHex: lpAsset.nameHex },
    step,
    maxBatcherFee: BATCHER_FEE
  });
  const cbor = await assembleOrder({
    orderAddress: sender.orderAddress,
    orderDatumHex: await toDatumHex(datum),
    datumKind: "inline",
    lovelace,
    assets,
    sender: senderBech32,
    walletUtxoCbors
  });
  return { cbor };
}
function adaSide2(asset2, amount) {
  return isAda2(asset2) ? amount : 0n;
}
function tokenAsset2(asset2, amount) {
  return isAda2(asset2) || amount === 0n ? [] : [{ unit: unitOf2(asset2), amount }];
}
async function buildAddLiquidity2(params) {
  const lp = calculateDepositAmount({
    amountA: params.amountA,
    amountB: params.amountB,
    pool: params.pool
  });
  const minimumLP = minimumWithSlippage(lp, params.slippage);
  const step = depositStep({
    depositAmountA: params.amountA,
    depositAmountB: params.amountB,
    minimumLP});
  const lovelace = DEPOSIT_ADA + BATCHER_FEE + adaSide2(params.assetA, params.amountA) + adaSide2(params.assetB, params.amountB);
  const assets = [
    ...tokenAsset2(params.assetA, params.amountA),
    ...tokenAsset2(params.assetB, params.amountB)
  ];
  const sender = await resolveSender2(params.sender);
  return build2(
    sender,
    params.sender,
    params.lpAsset,
    step,
    lovelace,
    assets,
    params.walletUtxoCbors
  );
}
async function buildRemoveLiquidity2(params) {
  const { withdrawalA, withdrawalB } = calculateWithdrawAmount({
    withdrawalLPAmount: params.lpAmount,
    reserveA: params.pool.reserveA,
    reserveB: params.pool.reserveB,
    totalLiquidity: params.pool.totalLiquidity
  });
  const step = withdrawStep({
    withdrawalLPAmount: params.lpAmount,
    minimumAssetA: minimumWithSlippage(withdrawalA, params.slippage),
    minimumAssetB: minimumWithSlippage(withdrawalB, params.slippage)});
  const assets = [{ unit: unitOf2(params.lpAsset), amount: params.lpAmount }];
  const sender = await resolveSender2(params.sender);
  return build2(
    sender,
    params.sender,
    params.lpAsset,
    step,
    DEPOSIT_ADA + BATCHER_FEE,
    assets,
    params.walletUtxoCbors
  );
}
async function buildZapOut(params) {
  const received = calculateZapOutAmount({
    withdrawalLPAmount: params.lpAmount,
    direction: params.direction,
    pool: params.pool
  });
  const step = zapOutStep({
    direction: params.direction,
    withdrawalLPAmount: params.lpAmount,
    minimumReceived: minimumWithSlippage(received, params.slippage)});
  const assets = [{ unit: unitOf2(params.lpAsset), amount: params.lpAmount }];
  const sender = await resolveSender2(params.sender);
  return build2(
    sender,
    params.sender,
    params.lpAsset,
    step,
    DEPOSIT_ADA + BATCHER_FEE,
    assets,
    params.walletUtxoCbors
  );
}

// src/liquidity/datum/stableswap.ts
function depositStep3(params) {
  return constr(1, [integer(params.minimumLP)]);
}
function withdrawStep3(params) {
  return constr(2, [{ list: params.minimumAmounts.map(integer) }]);
}
function withdrawOneCoinStep(params) {
  return constr(4, [integer(params.assetOutIndex), integer(params.minimumAssetOut)]);
}
function maybe(value) {
  return value ? constr(0, [value]) : constr(1, []);
}
function orderDatum3(params) {
  const payment = { hash: params.paymentKeyHash, isScript: params.paymentIsScript };
  const stake = params.stakeKeyHash ? { hash: params.stakeKeyHash, isScript: params.stakeIsScript } : null;
  const sender = addressData(payment, stake);
  const r = params.receiver;
  const receiver = r ? addressData(
    { hash: r.paymentKeyHash, isScript: r.paymentIsScript },
    r.stakeKeyHash ? { hash: r.stakeKeyHash, isScript: r.stakeIsScript } : null
  ) : sender;
  return constr(0, [
    sender,
    receiver,
    maybe(params.receiverDatumHash ? bytes(params.receiverDatumHash) : null),
    params.step,
    integer(params.batcherFee),
    integer(params.outputADA)
  ]);
}

// src/liquidity/math/stableswap.ts
function zipWith(a, b, f) {
  const n = Math.min(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(f(a[i], b[i]));
  }
  return out;
}
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function getD(mulBalances, amp) {
  const sumMulBalances = mulBalances.reduce((sum, balance) => sum + balance, 0n);
  if (sumMulBalances === 0n) {
    return 0n;
  }
  const length = BigInt(mulBalances.length);
  let dPrev = 0n;
  let d = sumMulBalances;
  const ann = amp * length;
  for (let i = 0; i < 255; i++) {
    let dp = d;
    for (const mulBalance of mulBalances) {
      dp = dp * d / (mulBalance * length);
    }
    dPrev = d;
    d = (ann * sumMulBalances + dp * length) * d / ((ann - 1n) * d + (length + 1n) * dp);
    if (d > dPrev) {
      if (d - dPrev <= 1n) {
        break;
      }
    } else {
      if (dPrev - d <= 1n) {
        break;
      }
    }
  }
  return d;
}
function getYD(i, xp, amp, d) {
  const length = BigInt(xp.length);
  invariant(0 <= i && i < xp.length, "getYD failed: i must be less than length of xp");
  let c = d;
  let s = 0n;
  const ann = amp * length;
  let _x = 0n;
  for (let index = 0; index < Number(length); index++) {
    if (index !== i) {
      _x = xp[index];
    } else {
      continue;
    }
    s += _x;
    c = c * d / (_x * length);
  }
  c = c * d / (ann * length);
  const b = s + d / ann;
  let yPrev = 0n;
  let y = d;
  for (let index = 0; index < 255; index++) {
    yPrev = y;
    y = (y * y + c) / (2n * y + b - d);
    if (y > yPrev) {
      if (y - yPrev <= 1n) {
        break;
      }
    } else {
      if (yPrev - y <= 1n) {
        break;
      }
    }
  }
  return y;
}
function getDMem(balances, multiples, amp) {
  const mulBalances = zipWith(balances, multiples, (a, b) => a * b);
  return getD(mulBalances, amp);
}
function calculateDeposit2(params) {
  const {
    amountIns,
    amp,
    multiples,
    datumBalances,
    totalLiquidity,
    fee,
    adminFee,
    feeDenominator
  } = params;
  const tempDatumBalances = [...datumBalances];
  const length = multiples.length;
  invariant(
    amountIns.length === length,
    `calculateDeposit error: amountIns's length ${amountIns.length} is invalid, must be ${length}`
  );
  let newDatumBalances = [];
  let lpAmount = 0n;
  if (totalLiquidity === 0n) {
    for (let i = 0; i < length; ++i) {
      invariant(amountIns[i] > 0n, `calculateDeposit error: amount index ${i} must be positive`);
    }
    newDatumBalances = zipWith(tempDatumBalances, amountIns, (a, b) => a + b);
    const d1 = getDMem(newDatumBalances, multiples, amp);
    invariant(d1 > 0n, "calculateDeposit: d1 must be greater than 0");
    lpAmount = d1;
  } else {
    let sumIns = 0n;
    for (let i = 0; i < length; ++i) {
      if (amountIns[i] < 0n) {
        invariant(
          amountIns[i] > 0n,
          `calculateDeposit error: amountIns index ${i} must be non-negative`
        );
      }
      sumIns += amountIns[i];
    }
    invariant(sumIns > 0n, "calculateDeposit error: sum of amountIns must be positive");
    const newDatumBalanceWithoutFee = zipWith(tempDatumBalances, amountIns, (a, b) => a + b);
    const d0 = getDMem(tempDatumBalances, multiples, amp);
    const d1 = getDMem(newDatumBalanceWithoutFee, multiples, amp);
    invariant(d1 > d0, `calculateDeposit: d1 must be greater than d0, d1: ${d1}, d0: ${d0}`);
    const specialFee = fee * BigInt(length) / (4n * (BigInt(length) - 1n));
    const newDatBalancesWithTradingFee = [];
    for (let i = 0; i < tempDatumBalances.length; i++) {
      const oldBalance = tempDatumBalances[i];
      const newBalance = newDatumBalanceWithoutFee[i];
      const idealBalance = d1 * oldBalance / d0;
      let different = 0n;
      if (newBalance > idealBalance) {
        different = newBalance - idealBalance;
      } else {
        different = idealBalance - newBalance;
      }
      const tradingFeeAmount = specialFee * different / feeDenominator;
      const adminFeeAmount = tradingFeeAmount * adminFee / feeDenominator;
      newDatumBalances.push(newBalance - adminFeeAmount);
      newDatBalancesWithTradingFee.push(newBalance - tradingFeeAmount);
    }
    for (let i = 0; i < length; ++i) {
      invariant(
        newDatBalancesWithTradingFee[i] > 0n,
        "calculateDeposit error: deposit amount is too small"
      );
    }
    const d2 = getDMem(newDatBalancesWithTradingFee, multiples, amp);
    lpAmount = totalLiquidity * (d2 - d0) / d0;
  }
  invariant(lpAmount > 0n, `calculateDeposit error: lpAmountOut ${lpAmount} must be positive`);
  return lpAmount;
}
function calculateWithdraw2(params) {
  const { withdrawalLPAmount, multiples, datumBalances, totalLiquidity } = params;
  const tempDatumBalances = [...datumBalances];
  const length = multiples.length;
  invariant(
    withdrawalLPAmount > 0n,
    "calculateWithdraw error: withdrawalLPAmount must be positive"
  );
  const amountOuts = tempDatumBalances.map(
    (balance) => balance * withdrawalLPAmount / totalLiquidity
  );
  let sumOuts = 0n;
  for (let i = 0; i < length; ++i) {
    invariant(amountOuts[i] >= 0n, "calculateWithdraw error: amountOuts must be non-negative");
    sumOuts += amountOuts[i];
  }
  invariant(sumOuts > 0n, "calculateWithdraw error: sum of amountOuts must be positive");
  return amountOuts;
}
function calculateZapOut(params) {
  const {
    amountLpIn,
    outIndex,
    amp,
    multiples,
    datumBalances,
    totalLiquidity,
    fee,
    adminFee,
    feeDenominator
  } = params;
  const tempDatumBalances = [...datumBalances];
  const length = multiples.length;
  invariant(amountLpIn > 0n, `calculateZapOut error: amountLpIn ${amountLpIn} must be positive`);
  invariant(
    0 <= outIndex && outIndex < length,
    `calculateZapOut error: outIndex ${outIndex} is not valid`
  );
  const mulBalances = zipWith(tempDatumBalances, multiples, (a, b) => a * b);
  const mulOut = multiples[outIndex];
  const d0 = getD(mulBalances, amp);
  const d1 = d0 - amountLpIn * d0 / totalLiquidity;
  const mulBalancesReduced = mulBalances;
  const newYWithoutFee = getYD(outIndex, mulBalances, amp, d1);
  const specialFee = fee * BigInt(length) / (4n * (BigInt(length) - 1n));
  const amountOutWithoutFee = (mulBalances[outIndex] - newYWithoutFee) / mulOut;
  for (let i = 0; i < length; ++i) {
    const diff = i === outIndex ? mulBalances[i] * d1 / d0 - newYWithoutFee : mulBalances[i] - mulBalances[i] * d1 / d0;
    mulBalancesReduced[i] -= diff * specialFee / feeDenominator;
  }
  const newY = getYD(outIndex, mulBalancesReduced, amp, d1);
  const amountOut = (mulBalancesReduced[outIndex] - newY - 1n) / mulOut;
  tempDatumBalances[outIndex] -= amountOut + (amountOutWithoutFee - amountOut) * adminFee / feeDenominator;
  return amountOut;
}
function minimumWithSlippage2(amount, slippagePercent) {
  if (!(slippagePercent >= 0)) {
    throw new Error(`slippage must be a non-negative percent, received ${slippagePercent}`);
  }
  const bps = BigInt(Math.round(slippagePercent * 100));
  return amount * (10000n - bps) / 10000n;
}

// src/liquidity/build/stableswap.ts
var unitOfLpAsset = (a) => a.policyId + a.nameHex;
async function resolveSender3(sender) {
  const b = await loadDexBuilder();
  const addr = b.Address.fromBech32(sender);
  const paymentKeyHash = addr.toPaymentCredential().payload.hex;
  const stakeAddr = addr.toStakeAddress?.();
  const stakeKeyHash = stakeAddr ? stakeAddr.toPubKeyHash()?.keyHash.hex ?? null : null;
  return { paymentKeyHash, stakeKeyHash };
}
async function build3(sender, senderBech32, config, step, lovelace, assets, walletUtxoCbors) {
  const datum = orderDatum3({
    paymentKeyHash: sender.paymentKeyHash,
    stakeKeyHash: sender.stakeKeyHash,
    step,
    batcherFee: BATCHER_FEE,
    outputADA: DEPOSIT_ADA
  });
  const cbor = await assembleOrder({
    orderAddress: config.orderAddress,
    orderDatumHex: await toDatumHex(datum),
    datumKind: "inline",
    lovelace,
    assets,
    sender: senderBech32,
    walletUtxoCbors
  });
  return { cbor };
}
var isAda3 = (coinId) => coinId === "lovelace";
function splitAmounts(config, amounts) {
  const assets = [];
  let ada = 0n;
  for (let i = 0; i < config.assets.length; i++) {
    const amount = amounts[i] ?? 0n;
    if (amount === 0n) {
      continue;
    }
    if (isAda3(config.assets[i])) {
      ada += amount;
    } else {
      assets.push({ unit: coinIdToAssetUnit(config.assets[i]), amount });
    }
  }
  return { assets, ada };
}
async function buildAddLiquidity3(params) {
  const { config, poolState } = params;
  const lp = calculateDeposit2({
    amp: poolState.amp,
    multiples: config.multiples,
    datumBalances: poolState.balances,
    fee: config.fee,
    adminFee: config.adminFee,
    feeDenominator: config.feeDenominator,
    amountIns: params.amounts,
    totalLiquidity: poolState.totalLiquidity
  });
  const step = depositStep3({ minimumLP: minimumWithSlippage2(lp, params.slippage) });
  const { assets, ada } = splitAmounts(config, params.amounts);
  const lovelace = DEPOSIT_ADA + BATCHER_FEE + ada;
  const sender = await resolveSender3(params.sender);
  return build3(sender, params.sender, config, step, lovelace, assets, params.walletUtxoCbors);
}
async function buildRemoveLiquidity3(params) {
  const { config, poolState } = params;
  const amountOuts = calculateWithdraw2({
    withdrawalLPAmount: params.lpAmount,
    multiples: config.multiples,
    datumBalances: poolState.balances,
    totalLiquidity: poolState.totalLiquidity
  });
  const step = withdrawStep3({
    minimumAmounts: amountOuts.map((a) => minimumWithSlippage2(a, params.slippage))
  });
  const assets = [{ unit: unitOfLpAsset(params.lpAsset), amount: params.lpAmount }];
  const sender = await resolveSender3(params.sender);
  return build3(
    sender,
    params.sender,
    config,
    step,
    DEPOSIT_ADA + BATCHER_FEE,
    assets,
    params.walletUtxoCbors
  );
}
async function buildZapOut2(params) {
  const { config, poolState } = params;
  const received = calculateZapOut({
    amp: poolState.amp,
    multiples: config.multiples,
    datumBalances: poolState.balances,
    fee: config.fee,
    adminFee: config.adminFee,
    feeDenominator: config.feeDenominator,
    amountLpIn: params.lpAmount,
    outIndex: params.assetOutIndex,
    totalLiquidity: poolState.totalLiquidity
  });
  const step = withdrawOneCoinStep({
    assetOutIndex: BigInt(params.assetOutIndex),
    minimumAssetOut: minimumWithSlippage2(received, params.slippage)
  });
  const assets = [{ unit: unitOfLpAsset(params.lpAsset), amount: params.lpAmount }];
  const sender = await resolveSender3(params.sender);
  return build3(
    sender,
    params.sender,
    config,
    step,
    DEPOSIT_ADA + BATCHER_FEE,
    assets,
    params.walletUtxoCbors
  );
}

// src/liquidity/config-stableswap.ts
var STABLESWAP_CONFIGS = [
  {
    key: "djed-iusd",
    lpAsset: "2c07095028169d7ab4376611abef750623c8f955597a38cd15248640.444a45442d695553442d534c50",
    orderAddress: "addr1w9xy6edqv9hkptwzewns75ehq53nk8t73je7np5vmj3emps698n9g",
    assets: [
      "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61.446a65644d6963726f555344",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344"
    ],
    multiples: [1n, 1n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "usdc-djed",
    lpAsset: "ac49e0969d76ed5aa9e9861a77be65f4fc29e9a979dc4c37a99eb8f4.555344432d444a45442d534c50",
    orderAddress: "addr1w93d8cuht3hvqt2qqfjqgyek3gk5d6ss2j93e5sh505m0ng8cmze2",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.55534443",
      "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61.446a65644d6963726f555344"
    ],
    multiples: [1n, 100n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "usdm-iusd",
    lpAsset: "31f92531ac9f1af3079701fab7c66ce997eb07988277ee5b9d640301.5553444d2d695553442d534c50",
    orderAddress: "addr1wxtv9k2lcum5pmcc4wu44a5tufulszahz84knff87wcawycez9lug",
    assets: [
      "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344"
    ],
    multiples: [1n, 1n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "djed-usdm",
    lpAsset: "5b042cf53c0b2ce4f30a9e743b4871ad8c6dcdf1d845133395f55a8e.444a45442d5553444d2d534c50",
    orderAddress: "addr1wxr9ppdymqgw6g0hvaaa7wc6j0smwh730ujx6lczgdynehsguav8d",
    assets: [
      "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61.446a65644d6963726f555344",
      "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d"
    ],
    multiples: [1n, 1n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "djed-myusd",
    lpAsset: "b69f5d48c91297142c46b764b69ab57844e3e7af9d7ba9bc63c3c517.444a45442d4d795553442d534c50",
    orderAddress: "addr1w9ksys0l07s9933kgkn4uxylsss5k6lqvt6e66kfc7am9sgtwqgv0",
    assets: [
      "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61.446a65644d6963726f555344",
      "92776616f1f32c65a173392e4410a3d8c39dcf6ef768c73af164779c.4d79555344"
    ],
    multiples: [1n, 1n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "myusd-usdm",
    lpAsset: "5827249dcaf49ce7ccae2e0577fd9bf9514a4c34adabc7eb57e19259.4d795553442d5553444d2d534c50",
    orderAddress: "addr1w8akt26kwj9kc2y56p8x3s9e9lp2qqtcxql0rmnz55u6lks99kkjc",
    assets: [
      "92776616f1f32c65a173392e4410a3d8c39dcf6ef768c73af164779c.4d79555344",
      "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d"
    ],
    multiples: [1n, 1n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "usdc-iusd",
    lpAsset: "40b6f8a17ba5d9bab02fc776c9677212b40bfc3df77346f0b1edcba6.555344432d695553442d534c50",
    orderAddress: "addr1w86a53qhsmh0qszg486ell6nchy77yq6txksfz8p4z4r39cd4e04m",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.55534443",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344"
    ],
    multiples: [1n, 100n],
    fee: 1000000n,
    adminFee: 5000000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "usdc-iusd-0.1",
    lpAsset: "48bee898de501ff287165fdfc5be34818f3a41e474ae8f47f8c59f7a.555344432d695553442d302e312d534c50",
    orderAddress: "addr1wy42rt3rdptdaa2lwlntkx49ksuqrmqqjlu7pf5l5f8upmgj3gq2m",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.55534443",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344"
    ],
    multiples: [1n, 100n],
    fee: 10000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "usdm-usda",
    lpAsset: "5f0d38b3eb8fea72cd3cbdaa9594a74d0db79b5a27e85be5e9015bd6.5553444d2d555344412d534c50",
    orderAddress: "addr1w8cafpjmeer4j8t8aseqayhwkf4ezuufue0clvfthxecsacv83rt0",
    assets: [
      "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad.0014df105553444d",
      "fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae456.55534441"
    ],
    multiples: [1n, 1n],
    fee: 5000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "iusd-usda",
    lpAsset: "5fd1180269cd5a01f397f37a17981424a3ec3bdab1e743a61f3bb113.695553442d555344412d534c50",
    orderAddress: "addr1w83fd654hwp5kzqkae4hqrasprq72tt4ppeghy20706jweqrcqkf3",
    assets: [
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344",
      "fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae456.55534441"
    ],
    multiples: [1n, 1n],
    fee: 10000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "weth-ieth",
    lpAsset: "b6b60bf469adb18c21ff3ad06bbdb9e78327b34d4c15db162de53b1c.774554482d694554482d534c50",
    orderAddress: "addr1wykr5fpg2qjca5lt75qmh9g459vnwr08wj5xlfcwyleyqagryre2v",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.455448",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69455448"
    ],
    multiples: [1n, 100n],
    fee: 10000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "wbtc-ibtc",
    lpAsset: "d4e0b170fc503735b260b1a0c99223c2b4e6dd6e87ccdcabfba28b8a.774254432d694254432d534c50",
    orderAddress: "addr1wx0mfd2vxe6x80fa50fw325n2ufnaaa53xkmrnuukt5d6uqyjjvj4",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.425443",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69425443"
    ],
    multiples: [1n, 100n],
    fee: 10000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "wsol-isol",
    lpAsset: "d3facc199b218a60723500bb80fcfc091f5bd67bdb74df4c099d8174.77534f4c2d69534f4c2d534c50",
    orderAddress: "addr1wxaw7dge3st4v7jreug6t5zfhqlkvsjpkddxvm6e3rcgpysxvuf5z",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.534f4c",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69534f4c"
    ],
    multiples: [1n, 100n],
    fee: 10000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  },
  {
    key: "usdt-iusd",
    lpAsset: "628718ccbdfaec8db0894f3ba25374374de672d487788e6158897070.555344542d695553442d534c50",
    orderAddress: "addr1wyqahucg38jpnenl8rw7rnqvyew6q8vrcshcdqfg4pehdds3f3j2h",
    assets: [
      "25c5de5f5b286073c593edfd77b48abc7a48e5a4f3d4cd9d428ff935.55534454",
      "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880.69555344"
    ],
    multiples: [1n, 100n],
    fee: 10000000n,
    adminFee: 500000000n,
    feeDenominator: 10000000000n
  }
];
var BY_LP_ASSET = new Map(STABLESWAP_CONFIGS.map((c) => [c.lpAsset, c]));
function getStableswapConfigByLpAsset(lpAsset) {
  const config = BY_LP_ASSET.get(lpAsset);
  if (!config) {
    throw new Error(`No Stableswap config found for LP asset ${lpAsset}`);
  }
  return config;
}
var assetSchema2 = z.object({
  currencySymbol: z.string(),
  tokenName: z.string(),
  metadata: z.object({ decimals: z.number().nullish() }).nullish()
});
var ammPoolSchema = z.object({
  type: z.enum(["DEX", "DEX_V2", "STABLESWAP"]),
  lpAsset: assetSchema2,
  poolAssets: z.array(assetSchema2),
  utxo: z.object({
    address: z.string(),
    datum: z.string(),
    txIn: z.string(),
    // A JSON blob `{"$ledgerValue":{unit: amountString, ...}}`; V1 reserves are
    // read from it (V2/stableswap take reserves from the datum).
    value: z.string()
  })
});
var poolsSchema = z.array(ammPoolSchema);
var POOL_FIELDS = `
  type
  lpAsset { currencySymbol tokenName }
  poolAssets { currencySymbol tokenName metadata { decimals } }
  utxo { address datum txIn value }
`;
var BY_LP_ASSETS_QUERY = `query AppliedPoolsByLpAssets($lpAssets: [InputAsset!]!) {
  appliedPoolsByLPAssets(lpAssets: $lpAssets) {${POOL_FIELDS}}
}`;
var BY_PAIRS_QUERY = `query AppliedPoolsByPairs($pairs: [InputPair!]!) {
  appliedPoolsByPairs(pairs: $pairs) {${POOL_FIELDS}}
}`;
async function getAppliedPoolsByLpAssets(client, lpAssets) {
  const pools = await client.execute({
    operation: "appliedPoolsByLPAssets",
    document: BY_LP_ASSETS_QUERY,
    variables: { lpAssets },
    schema: poolsSchema
  });
  return Promise.all(pools.map(toAppliedPool));
}
async function getAppliedPoolsByPairs(client, pairs) {
  const pools = await client.execute({
    operation: "appliedPoolsByPairs",
    document: BY_PAIRS_QUERY,
    variables: { pairs },
    schema: poolsSchema
  });
  return Promise.all(pools.map(toAppliedPool));
}
function mapVersion(type) {
  switch (type) {
    case "DEX":
      return "V1";
    case "DEX_V2":
      return "V2";
    case "STABLESWAP":
      return "STABLESWAP";
  }
}
function toPoolAsset(asset2) {
  return { policyId: asset2.currencySymbol, nameHex: asset2.tokenName };
}
function unitOf3(a) {
  return a.policyId === "" ? "lovelace" : `${a.policyId}.${a.nameHex}`;
}
async function toAppliedPool(pool) {
  const version = mapVersion(pool.type);
  const [rawA, rawB] = pool.poolAssets;
  if (!rawA || !rawB) {
    throw new MinswapError(
      `Pool ${pool.utxo.txIn} returned ${pool.poolAssets.length} pool assets, expected 2`,
      "PARSE_ERROR" /* PARSE_ERROR */,
      {
        endpoint: "GraphQL appliedPools",
        issues: [{ path: "poolAssets", message: `expected 2, got ${pool.poolAssets.length}` }]
      }
    );
  }
  const fields = await decodeDatumFields(pool.utxo.datum);
  let assetA;
  let assetB;
  let state;
  if (version === "V2") {
    assetA = decodeAssetNode(fields[1], "V2 pool datum", "assetA");
    assetB = decodeAssetNode(fields[2], "V2 pool datum", "assetB");
    state = decodeV2State(fields);
  } else if (version === "STABLESWAP") {
    assetA = toPoolAsset(rawA);
    assetB = toPoolAsset(rawB);
    state = decodeStableswapState(fields);
  } else {
    assetA = decodeAssetNode(fields[0], "V1 pool datum", "assetA");
    assetB = decodeAssetNode(fields[1], "V1 pool datum", "assetB");
    state = decodeV1State(fields, pool.utxo.value, assetA, assetB);
  }
  const decimals = { lovelace: 6 };
  for (const a of [rawA, rawB]) {
    const d = a.metadata?.decimals;
    if (a.currencySymbol !== "" && d != null) {
      decimals[`${a.currencySymbol}.${a.tokenName}`] = d;
    }
  }
  return {
    version,
    lpAsset: toPoolAsset(pool.lpAsset),
    assetA,
    assetB,
    state,
    utxoRef: pool.utxo.txIn,
    poolAddress: pool.utxo.address,
    rawDatum: pool.utxo.datum,
    decimals
  };
}
async function decodeDatumFields(datumHex) {
  const builder = await loadDexBuilder();
  const decoder = builder.PlutusData;
  const fields = decoder.fromDataHex(datumHex).fields;
  if (!fields) {
    throw parseError("pool datum", "fields", "datum is not a constructor with fields");
  }
  return fields;
}
function parseError(endpoint, path, message) {
  return new MinswapError(`${endpoint}: ${message}`, "PARSE_ERROR" /* PARSE_ERROR */, {
    endpoint,
    issues: [{ path, message }]
  });
}
function decodeAssetNode(node, endpoint, field) {
  const f = node?.fields;
  if (!f || f.length < 2 || f[0]?.bytes === void 0 || f[1]?.bytes === void 0) {
    throw parseError(endpoint, field, "expected an asset Constr[policyId, assetNameHex]");
  }
  return { policyId: f[0].bytes, nameHex: f[1].bytes };
}
function readInt(node, endpoint, field) {
  if (!node || node.int === void 0) {
    throw parseError(endpoint, field, "expected an integer");
  }
  return BigInt(node.int);
}
function requireFields(fields, min, endpoint) {
  if (fields.length < min) {
    throw parseError(endpoint, "fields", `expected >=${min}, got ${fields.length}`);
  }
}
function decodeV2State(fields) {
  requireFields(fields, 8, "V2 pool datum");
  return {
    kind: "V2",
    totalLiquidity: readInt(fields[3], "V2 pool datum", "totalLiquidity"),
    reserveA: readInt(fields[4], "V2 pool datum", "reserveA"),
    reserveB: readInt(fields[5], "V2 pool datum", "reserveB"),
    feeANumerator: readInt(fields[6], "V2 pool datum", "feeANumerator"),
    feeBNumerator: readInt(fields[7], "V2 pool datum", "feeBNumerator")
  };
}
function decodeStableswapState(fields) {
  requireFields(fields, 3, "Stableswap pool datum");
  const balancesList = fields[0]?.list;
  if (!balancesList) {
    throw parseError("Stableswap pool datum", "balances", "expected a list");
  }
  return {
    kind: "STABLESWAP",
    balances: balancesList.map((b, i) => readInt(b, "Stableswap pool datum", `balances[${i}]`)),
    totalLiquidity: readInt(fields[1], "Stableswap pool datum", "totalLiquidity"),
    amp: readInt(fields[2], "Stableswap pool datum", "amp")
  };
}
var ledgerValueSchema = z.object({ $ledgerValue: z.record(z.string(), z.string()) });
function decodeV1State(fields, valueJson, assetA, assetB) {
  requireFields(fields, 3, "V1 pool datum");
  const totalLiquidity = readInt(fields[2], "V1 pool datum", "totalLiquidity");
  let parsed;
  try {
    parsed = JSON.parse(valueJson);
  } catch {
    throw parseError("V1 pool value", "value", "not valid JSON");
  }
  const ledger = ledgerValueSchema.safeParse(parsed);
  if (!ledger.success) {
    throw parseError("V1 pool value", "$ledgerValue", "missing ledger value map");
  }
  const amounts = ledger.data.$ledgerValue;
  return {
    kind: "V1",
    reserveA: BigInt(amounts[unitOf3(assetA)] ?? "0"),
    reserveB: BigInt(amounts[unitOf3(assetB)] ?? "0"),
    totalLiquidity
  };
}

// src/modules/liquidity-module.ts
var assetId = (coinId) => {
  const a = coinIdToInputAsset(coinId);
  return { policyId: a.currencySymbol, nameHex: a.tokenName };
};
var coinIdOf = (a) => a.policyId === "" ? "lovelace" : `${a.policyId}.${a.nameHex}`;
var eqAsset = (x, y) => x.policyId === y.policyId && x.nameHex === y.nameHex;
var LiquidityModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  async addLiquidity(params) {
    const applied = await this.resolvePool(params.pool);
    const walletUtxoCbors = await this.walletUtxos(params);
    const amountA = this.depositAmount(applied, params, coinIdOf(applied.assetA));
    const amountB = this.depositAmount(applied, params, coinIdOf(applied.assetB));
    const state = applied.state;
    const common = { sender: params.sender, slippage: params.slippage, walletUtxoCbors };
    if (state.kind === "V2") {
      return buildAddLiquidity2({
        ...common,
        lpAsset: applied.lpAsset,
        assetA: applied.assetA,
        assetB: applied.assetB,
        amountA,
        amountB,
        pool: state
      });
    }
    if (state.kind === "STABLESWAP") {
      const config = getStableswapConfigByLpAsset(coinIdOf(applied.lpAsset));
      return buildAddLiquidity3({
        ...common,
        lpAsset: applied.lpAsset,
        config,
        amounts: config.assets.map((coinId) => this.depositAmount(applied, params, coinId)),
        poolState: state
      });
    }
    if (amountA > 0n && amountB > 0n) {
      return buildAddLiquidity({
        ...common,
        lpAsset: applied.lpAsset,
        assetA: applied.assetA,
        assetB: applied.assetB,
        amountA,
        amountB,
        reserveA: state.reserveA,
        reserveB: state.reserveB,
        totalLiquidity: state.totalLiquidity
      });
    }
    const inIsA = amountA > 0n;
    return buildZapIn({
      ...common,
      lpAsset: applied.lpAsset,
      assetIn: inIsA ? applied.assetA : applied.assetB,
      amountIn: inIsA ? amountA : amountB,
      desiredAsset: inIsA ? applied.assetB : applied.assetA,
      reserveIn: inIsA ? state.reserveA : state.reserveB,
      reserveOut: inIsA ? state.reserveB : state.reserveA,
      totalLiquidity: state.totalLiquidity
    });
  }
  /** One-sided deposit. Routes through the version's correct on-chain step. */
  async zapIn(params) {
    return this.addLiquidity({
      pool: params.pool,
      amounts: { [params.assetIn]: params.amountIn },
      slippage: params.slippage,
      sender: params.sender,
      walletUtxoCbors: params.walletUtxoCbors,
      amountsInDecimal: params.amountInDecimal
    });
  }
  /**
   * Withdraw liquidity. Two-sided by default; pass `assetOut` to receive a single
   * coin instead (a zap-out) — the mirror of a one-sided {@link addLiquidity}.
   */
  async removeLiquidity(params) {
    const applied = await this.resolvePool(params.pool);
    const walletUtxoCbors = await this.walletUtxos(params);
    const lpAmount = BigInt(params.lpAmount);
    const state = applied.state;
    const common = { sender: params.sender, slippage: params.slippage, walletUtxoCbors };
    if (params.assetOut !== void 0) {
      return this.withdrawOneSide(applied, params.assetOut, lpAmount, common);
    }
    if (state.kind === "V2") {
      return buildRemoveLiquidity2({
        ...common,
        lpAsset: applied.lpAsset,
        lpAmount,
        pool: state
      });
    }
    if (state.kind === "STABLESWAP") {
      return buildRemoveLiquidity3({
        ...common,
        lpAsset: applied.lpAsset,
        config: getStableswapConfigByLpAsset(coinIdOf(applied.lpAsset)),
        lpAmount,
        poolState: state
      });
    }
    return buildRemoveLiquidity({
      ...common,
      lpAsset: applied.lpAsset,
      lpAmount,
      reserveA: state.reserveA,
      reserveB: state.reserveB,
      totalLiquidity: state.totalLiquidity
    });
  }
  /** One-sided withdraw. A convenience wrapper over {@link removeLiquidity} with `assetOut`. */
  async zapOut(params) {
    return this.removeLiquidity({
      pool: params.pool,
      lpAmount: params.lpAmount,
      slippage: params.slippage,
      sender: params.sender,
      walletUtxoCbors: params.walletUtxoCbors,
      assetOut: params.assetOut
    });
  }
  async withdrawOneSide(applied, assetOut, lpAmount, common) {
    const state = applied.state;
    const out = assetId(assetOut);
    if (state.kind === "STABLESWAP") {
      const config = getStableswapConfigByLpAsset(coinIdOf(applied.lpAsset));
      const assetOutIndex = config.assets.findIndex((c) => c === coinIdOf(out));
      if (assetOutIndex < 0) {
        throw notAPoolCoin(assetOut);
      }
      return buildZapOut2({
        ...common,
        lpAsset: applied.lpAsset,
        config,
        lpAmount,
        assetOutIndex,
        poolState: state
      });
    }
    if (state.kind === "V1") {
      throw new MinswapError(
        "DEX V1 has no zap-out; call removeLiquidity without assetOut for a two-sided withdraw",
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "assetOut", reason: "V1 pools do not support zap-out" }
      );
    }
    let direction2;
    if (eqAsset(out, applied.assetB)) {
      direction2 = "A_TO_B";
    } else if (eqAsset(out, applied.assetA)) {
      direction2 = "B_TO_A";
    } else {
      throw notAPoolCoin(assetOut);
    }
    return buildZapOut({
      ...common,
      lpAsset: applied.lpAsset,
      lpAmount,
      direction: direction2,
      pool: state
    });
  }
  async resolvePool(ref) {
    const client = this.sdk.clients.appGraphql;
    if (typeof ref === "string") {
      const [pool] = await getAppliedPoolsByLpAssets(client, [coinIdToInputAsset(ref)]);
      if (!pool) {
        throw poolNotFound("LP asset", ref);
      }
      return pool;
    }
    const pools = await getAppliedPoolsByPairs(client, [
      { assetA: coinIdToInputAsset(ref.assetA), assetB: coinIdToInputAsset(ref.assetB) }
    ]);
    const pairId = `${ref.assetA}/${ref.assetB}`;
    if (pools.length === 0) {
      throw poolNotFound("pair", pairId);
    }
    if (ref.version) {
      const match = pools.find((p) => p.version === ref.version);
      if (!match) {
        throw new MinswapError(
          `No ${ref.version} pool for ${pairId} (available: ${pools.map((p) => p.version).join(", ")})`,
          "NOT_FOUND" /* NOT_FOUND */,
          { resource: "pool", id: `${pairId}@${ref.version}` }
        );
      }
      return match;
    }
    if (pools.length > 1) {
      throw new MinswapError(
        `${pairId} has ${pools.length} pools (${pools.map((p) => p.version).join(", ")}); pass \`version\` or the pool's LP token to choose one`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "pool", reason: "ambiguous pair \u2014 multiple pools across versions" }
      );
    }
    return pools[0];
  }
  async walletUtxos(params) {
    if (params.walletUtxoCbors !== void 0) {
      return params.walletUtxoCbors;
    }
    const provider = requireRpcProvider(this.sdk.rpcProvider, "liquidity");
    const utxos = await provider.getUtxosByAddress(params.sender);
    return utxos.map((u) => u.cbor);
  }
  /** The deposit amount for `coinId` in raw base units; `0` when the coin is not supplied. */
  depositAmount(applied, params, coinId) {
    const value = params.amounts[coinId];
    if (value === void 0) {
      return 0n;
    }
    return this.toRaw(value, coinId, applied.decimals[coinId], params.amountsInDecimal);
  }
  toRaw(value, coinId, decimals, inDecimal) {
    if (!inDecimal) {
      return BigInt(value);
    }
    if (decimals === void 0) {
      throw new MinswapError(
        `Cannot convert a decimal amount for ${coinId}: its decimals are unknown`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "amountsInDecimal", reason: `no decimals metadata for ${coinId}` }
      );
    }
    return decimalToRaw(value, decimals);
  }
};
function decimalToRaw(value, decimals) {
  const text = typeof value === "string" ? value.trim() : value.toString();
  const negative = text.startsWith("-");
  const parts = (negative ? text.slice(1) : text).split(".");
  const [intPart, fracPart = ""] = parts;
  if (parts.length > 2 || !/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || intPart + fracPart === "") {
    throw new MinswapError(`Invalid decimal amount "${text}"`, "INVALID_PARAMS" /* INVALID_PARAMS */, {
      param: "amount",
      reason: 'not a decimal number (use a string like "1.5")'
    });
  }
  if (fracPart.length > decimals) {
    throw new MinswapError(
      `Decimal amount "${text}" has more than ${decimals} decimal places`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: "amount", reason: `too many decimal places for a ${decimals}-decimal coin` }
    );
  }
  const raw = BigInt((intPart || "0") + fracPart.padEnd(decimals, "0"));
  return negative ? -raw : raw;
}
function poolNotFound(kind, id) {
  return new MinswapError(`No liquidity pool found for ${kind} ${id}`, "NOT_FOUND" /* NOT_FOUND */, {
    resource: "pool",
    id
  });
}
function notAPoolCoin(coinId) {
  return new MinswapError(`${coinId} is not a coin of this pool`, "INVALID_PARAMS" /* INVALID_PARAMS */, {
    param: "assetOut",
    reason: "must be one of the pool's coins"
  });
}
var ORDER_STATUSES = ["pending", "partially_filled", "filled", "cancelled"];
var ORDER_SOURCE_DIRECT = "direct";
var orderExtraSchema = z.object({
  expired_at: z.string().nullish(),
  max_cancelling_tip: z.number().nullish(),
  killable: z.boolean().nullish(),
  limit_amount: z.number().nullish(),
  limit_rate: z.string().nullish(),
  stop_amount: z.number().nullish(),
  stop_loss_rate: z.string().nullish(),
  routes: arrayOf(z.string()),
  max_hop_count: z.number().nullish(),
  min_fill_amount: z.number().nullish(),
  lp_asset: z.string().nullish()
}).transform((e) => ({
  expiredAt: e.expired_at ?? null,
  /** Already normalized to ADA by the backend, despite being a string on-chain. */
  maxCancellingTip: e.max_cancelling_tip ?? null,
  killable: e.killable ?? null,
  limitAmount: e.limit_amount ?? null,
  /** Stays a string upstream; not converted. */
  limitRate: e.limit_rate ?? null,
  stopAmount: e.stop_amount ?? null,
  stopLossRate: e.stop_loss_rate ?? null,
  routes: e.routes,
  maxHopCount: e.max_hop_count ?? null,
  minFillAmount: e.min_fill_amount ?? null,
  lpAsset: e.lp_asset ?? null
}));
var orderFillSchema = z.object({
  // These are dropped from the payload when zero rather than sent as 0.
  amount_a: zeroableNumber,
  amount_b: zeroableNumber,
  lp_amount: zeroableNumber,
  tx_digest: z.string(),
  block: z.number(),
  filled_at: z.number()
}).transform((f) => ({
  amountA: f.amount_a,
  amountB: f.amount_b,
  lpAmount: f.lp_amount,
  txHash: f.tx_digest,
  block: f.block,
  /** Epoch milliseconds. */
  filledAt: f.filled_at
}));
var orderHopSchema = z.object({
  type: z.string(),
  order_ref: z.string(),
  protocol: z.string().nullish(),
  pool_id: z.string().nullish(),
  coin_a: coinBasicInfoSchema,
  coin_b: coinBasicInfoSchema,
  a_to_b: z.boolean().nullish(),
  amount_a: z.number(),
  amount_b: z.number(),
  lp_amount: zeroableNumber,
  batcher_fee: z.number(),
  deposit_ada: z.number(),
  extra: orderExtraSchema.nullish(),
  fills: arrayOf(orderFillSchema)
}).transform((h) => ({
  type: h.type,
  /**
   * The hop's UTxO reference, `txHash#index`.
   *
   * This is what a cancellation targets, and it is only cancellable while
   * the hop is still pending.
   */
  orderRef: h.order_ref,
  protocol: h.protocol ?? null,
  poolId: h.pool_id ?? null,
  coinA: h.coin_a,
  coinB: h.coin_b,
  aToB: h.a_to_b ?? null,
  amountA: h.amount_a,
  amountB: h.amount_b,
  lpAmount: h.lp_amount,
  batcherFee: h.batcher_fee,
  depositAda: h.deposit_ada,
  extra: h.extra ?? null,
  fills: h.fills
}));
var orderSplitSchema = z.object({
  root_id: z.number(),
  status: z.string(),
  executed_at: z.number().nullish(),
  hops: arrayOf(orderHopSchema)
}).transform((s) => ({
  rootId: s.root_id,
  status: s.status,
  executedAt: s.executed_at ?? null,
  hops: s.hops
}));
var orderSchema = z.object({
  tx_digest: z.string(),
  order_key: z.string(),
  source: z.string().nullish(),
  status: z.string(),
  created_at: z.number(),
  executed_at: z.number().nullish(),
  splits: arrayOf(orderSplitSchema)
}).transform((o) => ({
  txHash: o.tx_digest,
  orderKey: o.order_key,
  /** `null` means the order was placed directly, not via an aggregator. */
  source: o.source ?? null,
  status: o.status,
  /** Epoch milliseconds. */
  createdAt: o.created_at,
  executedAt: o.executed_at ?? null,
  /**
   * An order can be split across several routes, each a chain of hops.
   * Cancellable UTxO references live on the hops.
   */
  splits: o.splits
}));
var OrderModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /** Fetch an address's order history, newest first. */
  async getHistory(params) {
    assertLimit(params.limit, 50);
    const { data, pagination } = await this.sdk.clients.appApi.post({
      path: "/api/v1/order/history",
      body: {
        address: params.address,
        // The cursor is a string because order ids exceed JS-safe integers.
        pagination: { cursor: params.cursor, limit: params.limit ?? 20 },
        filters: {
          statuses: params.statuses,
          types: params.types,
          protocols: params.protocols,
          sources: params.sources,
          pool_id: params.poolId,
          time_range: params.timeRange ? [toEpochMs(params.timeRange.from), toEpochMs(params.timeRange.to)] : void 0,
          search: params.search ?? "",
          coin_ids: params.coinIds,
          tx_digest: params.txHash
        }
      },
      schema: arrayOf(orderSchema),
      currency: params.currency
    });
    return cursorPage(data, pagination?.lastCursor);
  }
  /**
   * Collect the UTxO references that can still be cancelled for an order.
   *
   * Convenience over walking `splits[].hops[]` by hand; the result feeds
   * straight into a cancellation request.
   */
  static cancellableRefs(order) {
    if (order.status === "filled" || order.status === "cancelled") {
      return [];
    }
    return order.splits.filter((split) => split.status === "pending" || split.status === "partially_filled").flatMap((split) => split.hops.map((hop) => hop.orderRef));
  }
};
var POOL_TYPES = [
  "cpmm",
  "clmm",
  "dlmm",
  "weighted",
  "stableswap",
  "oracle",
  "unknown"
];
var POOL_FILTER_TYPES = POOL_TYPES.filter((t) => t !== "unknown");
var POOL_CATEGORY_GROUPS = ["stablecoin", "correlated", "meme", "other"];
var POOL_LIST_SORT_FIELDS = [
  "created_at",
  "tvl_usd",
  "apr_24h",
  "apr_1w",
  "apr_30d",
  "fee_24h",
  "fee_1w",
  "fee_30d",
  "volume_24h",
  "volume_1w",
  "volume_30d",
  "total_apr_24h",
  "total_apr_1w",
  "total_apr_30d"
];
var POOL_EVENT_ACTIONS = ["buy", "sell", "addLiquidity", "removeLiquidity"];
var ACTION_TO_WIRE = {
  buy: "buy",
  sell: "sell",
  addLiquidity: "join",
  removeLiquidity: "exit"
};
var ACTION_FROM_WIRE = {
  buy: "buy",
  sell: "sell",
  join: "addLiquidity",
  exit: "removeLiquidity"
};
var poolSchema = z.object({
  pool_id: z.string().nullish(),
  protocol: z.string(),
  coin_a: poolCoinSchema,
  coin_b: poolCoinSchema,
  amount_a: z.number(),
  amount_b: z.number(),
  amount_a_usd: z.number(),
  amount_b_usd: z.number(),
  price_a: z.number(),
  price_b: z.number(),
  price_ab: z.number(),
  tvl_usd: z.number(),
  tvl_usd_24h_change: z.number(),
  fee_rate: z.number(),
  fee_rate_a: z.number().nullish(),
  fee_rate_b: z.number().nullish(),
  fee_24h: z.number(),
  fee_24h_change: z.number(),
  fee_1w: z.number(),
  fee_30d: z.number().nullish(),
  fee_a_24h: poolFeeSchema,
  fee_b_24h: poolFeeSchema,
  fee_a_1w: poolFeeSchema,
  fee_b_1w: poolFeeSchema,
  fee_a_30d: poolFeeSchema.nullish(),
  fee_b_30d: poolFeeSchema.nullish(),
  volume_24h: z.number(),
  volume_24h_change: z.number(),
  volume_1w: z.number(),
  volume_30d: z.number().nullish(),
  fee_apr_24h: z.number(),
  fee_apr_1w: z.number(),
  fee_apr_30d: z.number().nullish(),
  rewards: arrayOf(poolRewardSchema),
  active: z.boolean(),
  created_at: z.string().nullish(),
  pool_type: z.string()
}).transform((p) => ({
  poolId: p.pool_id ?? null,
  protocol: p.protocol,
  coinA: p.coin_a,
  coinB: p.coin_b,
  amountA: p.amount_a,
  amountB: p.amount_b,
  amountAUsd: p.amount_a_usd,
  amountBUsd: p.amount_b_usd,
  priceA: p.price_a,
  priceB: p.price_b,
  priceAB: p.price_ab,
  tvlUsd: p.tvl_usd,
  tvlUsd24hChange: p.tvl_usd_24h_change,
  feeRate: p.fee_rate,
  /** Per-side fee rates exist only on protocols that support them. */
  feeRateA: p.fee_rate_a ?? null,
  feeRateB: p.fee_rate_b ?? null,
  fee24h: p.fee_24h,
  fee24hChange: p.fee_24h_change,
  fee1w: p.fee_1w,
  /** 30-day windows are Cardano-only and absent elsewhere. */
  fee30d: p.fee_30d ?? null,
  feeA24h: p.fee_a_24h,
  feeB24h: p.fee_b_24h,
  feeA1w: p.fee_a_1w,
  feeB1w: p.fee_b_1w,
  feeA30d: p.fee_a_30d ?? null,
  feeB30d: p.fee_b_30d ?? null,
  volume24h: p.volume_24h,
  volume24hChange: p.volume_24h_change,
  volume1w: p.volume_1w,
  volume30d: p.volume_30d ?? null,
  feeApr24h: p.fee_apr_24h,
  feeApr1w: p.fee_apr_1w,
  feeApr30d: p.fee_apr_30d ?? null,
  rewards: p.rewards,
  active: p.active,
  createdAt: p.created_at ?? null,
  poolType: p.pool_type
}));
var poolEventSchema = z.object({
  id: z.string(),
  pool_id: z.string().nullish(),
  coin_a: coinBasicInfoSchema,
  coin_b: coinBasicInfoSchema,
  amount_a: z.string(),
  amount_b: z.string(),
  amount_a_usd: z.string(),
  amount_b_usd: z.string(),
  sender: z.string().nullish(),
  tx_digest: z.string(),
  created_at: z.string(),
  action: z.string()
}).transform((e) => ({
  id: e.id,
  poolId: e.pool_id ?? null,
  coinA: e.coin_a,
  coinB: e.coin_b,
  /** Decimal strings, not numbers — parse with a bignum library. */
  amountA: e.amount_a,
  amountB: e.amount_b,
  amountAUsd: e.amount_a_usd,
  amountBUsd: e.amount_b_usd,
  sender: e.sender ?? null,
  txHash: e.tx_digest,
  createdAt: e.created_at,
  action: ACTION_FROM_WIRE[e.action] ?? e.action
}));
var POOL_IDS_CHUNK = 20;
var PoolModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /** List pools with filtering and sorting. */
  async list(params = {}) {
    assertLimit(params.limit, 50);
    const limit = params.limit ?? 20;
    const offset = decodeOffsetCursor(params.cursor);
    if (params.coinIds && params.coinIds.length > 2) {
      throw new MinswapError(
        "coinIds accepts at most 2 entries \u2014 it filters for pools containing those coins, it is not a bulk lookup. Use getByIds for that.",
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "coinIds", reason: "at most 2 entries" }
      );
    }
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/pool/liquidity-pools",
      query: {
        offset,
        limit,
        pool_addresses: params.poolIds,
        protocols: params.protocols,
        coin_ids: params.coinIds,
        tvl_min: params.minTvl,
        pool_type: params.poolType,
        category_group: params.categoryGroup,
        is_verified: params.isVerified,
        search: params.search,
        sort_field: params.sortBy ?? "volume_24h",
        sort_direction: params.order ?? "desc"
      },
      schema: arrayOf(poolSchema),
      currency: params.currency
    });
    return offsetPage(data, offset, limit);
  }
  /**
   * Fetch a single pool.
   *
   * @throws {MinswapError} with code `NOT_FOUND` when no such pool exists.
   */
  async getById(poolId, options = {}) {
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/pool/detail",
      query: { pool_id: poolId },
      schema: poolSchema,
      currency: options.currency,
      notFound: { resource: "pool", id: poolId }
    });
    return data;
  }
  /**
   * Fetch several pools by id.
   *
   * Chunked at 20, the upstream cap on `pool_addresses`. Ids that do not match
   * a pool are absent from the result rather than raising.
   */
  async getByIds(poolIds, options = {}) {
    if (poolIds.length === 0) {
      return [];
    }
    const chunks = [];
    for (let i = 0; i < poolIds.length; i += POOL_IDS_CHUNK) {
      chunks.push(poolIds.slice(i, i + POOL_IDS_CHUNK));
    }
    const pages = await Promise.all(
      chunks.map(
        (chunk) => this.sdk.clients.appApi.get({
          path: "/api/v1/pool/liquidity-pools",
          query: { pool_addresses: chunk, offset: 0, limit: chunk.length },
          schema: arrayOf(poolSchema),
          currency: options.currency
        })
      )
    );
    return pages.flatMap((page) => page.data);
  }
  /** OHLC candles for a pool. */
  async getOhlc(params) {
    assertBucket(params.bucketMinutes);
    assertLimit(params.limit, 500);
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/pool/ohlcv",
      query: {
        pool_id: params.poolId,
        // Epoch seconds here; the token chart wants RFC 3339 instead.
        from: params.from ? toEpochSeconds(params.from) : void 0,
        to: params.to ? toEpochSeconds(params.to) : void 0,
        bucket: params.bucketMinutes,
        limit: params.limit
      },
      schema: arrayOf(poolCandleSchema),
      currency: params.currency
    });
    return data;
  }
  /** Swaps and liquidity changes for a pool. */
  async getEvents(params) {
    assertLimit(params.limit, 50);
    const { data, pagination } = await this.sdk.clients.appApi.get({
      path: "/api/v1/pool/events",
      query: {
        pool_id: params.poolId,
        cursor: params.cursor,
        limit: params.limit ?? 20,
        desc: params.descending ?? true,
        action: params.actions?.map((a) => ACTION_TO_WIRE[a]),
        address: params.address,
        time_range: params.timeRange ? [toEpochMs(params.timeRange.from), toEpochMs(params.timeRange.to)] : void 0
      },
      schema: arrayOf(poolEventSchema),
      currency: params.currency
    });
    return cursorPage(data, pagination?.lastCursor);
  }
};
var poolInfoSchema = z.object({
  fee_apr_24h: z.number(),
  fee_apr_1w: z.number(),
  rewards: arrayOf(poolRewardSchema)
}).transform((p) => ({
  feeApr24h: p.fee_apr_24h,
  feeApr1w: p.fee_apr_1w,
  rewards: p.rewards
}));
var lpPositionSchema = z.object({
  protocol: z.string(),
  coin_a: coinBasicInfoSchema,
  coin_b: coinBasicInfoSchema,
  amount_a: z.number(),
  amount_b: z.number(),
  lp_amount: z.string().nullish(),
  pool_share: z.number(),
  a_usd_value: z.number(),
  b_usd_value: z.number(),
  position_id: z.string(),
  pool_id: z.string().nullish(),
  fee_rate: z.number(),
  fee_rate_a: z.number().nullish(),
  fee_rate_b: z.number().nullish(),
  pool_type: z.string(),
  pool_info: poolInfoSchema,
  total_usd_value: z.number()
}).transform((p) => ({
  protocol: p.protocol,
  coinA: p.coin_a,
  coinB: p.coin_b,
  amountA: p.amount_a,
  amountB: p.amount_b,
  /** Decimal string, not a number. Empty for Minswap CPMM positions. */
  lpAmount: p.lp_amount ?? null,
  poolShare: p.pool_share,
  aUsdValue: p.a_usd_value,
  bUsdValue: p.b_usd_value,
  positionId: p.position_id,
  poolId: p.pool_id ?? null,
  feeRate: p.fee_rate,
  feeRateA: p.fee_rate_a ?? null,
  feeRateB: p.fee_rate_b ?? null,
  poolType: p.pool_type,
  poolInfo: p.pool_info,
  totalUsdValue: p.total_usd_value
}));
var vaultPairPositionSchema = z.object({
  protocol: z.string(),
  coin_a: coinBasicInfoSchema,
  coin_b: coinBasicInfoSchema,
  amount_a: z.number(),
  amount_b: z.number(),
  a_usd_value: z.number(),
  b_usd_value: z.number(),
  pool_id: z.string().nullish(),
  share: z.number(),
  total_usd_value: z.number()
}).transform((p) => ({
  protocol: p.protocol,
  coinA: p.coin_a,
  coinB: p.coin_b,
  amountA: p.amount_a,
  amountB: p.amount_b,
  aUsdValue: p.a_usd_value,
  bUsdValue: p.b_usd_value,
  poolId: p.pool_id ?? null,
  share: p.share,
  totalUsdValue: p.total_usd_value
}));
var farmExtraSchema = z.object({
  script_version: z.string(),
  lb_whitelist_assets: arrayOf(z.string())
}).transform((e) => ({
  scriptVersion: e.script_version,
  lbWhitelistAssets: e.lb_whitelist_assets
}));
var farmPositionSchema = z.object({
  protocol: z.string(),
  staked_coin: coinAmountInfoSchema.nullish(),
  yield_position_id: z.string(),
  yield_pool_id: z.string(),
  yield_pending_rewards: arrayOf(coinAmountInfoSchema),
  cpmm_position: lpPositionSchema.nullish(),
  vault_pair_position: vaultPairPositionSchema.nullish(),
  total_usd_value: z.number(),
  extra: farmExtraSchema.nullish()
}).transform((p) => ({
  protocol: p.protocol,
  /**
   * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
   * `vaultPairPosition` describes it, checked in that precedence order
   * upstream.
   */
  stakedCoin: p.staked_coin ?? null,
  positionId: p.yield_position_id,
  /** Identifies the farm; pass to farm actions. */
  poolId: p.yield_pool_id,
  pendingRewards: p.yield_pending_rewards,
  lpPosition: p.cpmm_position ?? null,
  vaultPairPosition: p.vault_pair_position ?? null,
  totalUsdValue: p.total_usd_value,
  extra: p.extra ?? null
}));
var stakingExtraSchema = z.object({
  script_version: z.string(),
  stake_at: z.string(),
  duration: z.number().nullish(),
  multiplier: z.number().nullish()
}).transform((e) => ({
  scriptVersion: e.script_version,
  /** ISO-8601 string, not an epoch number. */
  stakeAt: e.stake_at,
  duration: e.duration ?? null,
  multiplier: e.multiplier ?? null
}));
var stakingPositionSchema = z.object({
  protocol: z.string(),
  staked_coin: coinAmountInfoSchema.nullish(),
  staking_position_id: z.string(),
  staking_pool_id: z.string(),
  staking_pending_rewards: arrayOf(coinAmountInfoSchema),
  share: z.number(),
  total_usd_value: z.number(),
  extra: stakingExtraSchema.nullish()
}).transform((p) => ({
  protocol: p.protocol,
  stakedCoin: p.staked_coin ?? null,
  /** The staking UTxO reference; staking actions take this directly. */
  positionId: p.staking_position_id,
  poolId: p.staking_pool_id,
  pendingRewards: p.staking_pending_rewards,
  /**
   * Share of the pool. Note `0` is ambiguous upstream between "no share" and
   * "could not be computed".
   */
  share: p.share,
  totalUsdValue: p.total_usd_value,
  extra: p.extra ?? null,
  /**
   * Tiered or flexible staking.
   *
   * The backend encodes this two ways and names it neither: flexible pools
   * carry a `-flexible` suffix on the pool id, and only tiered positions
   * carry `duration`/`multiplier`. Both signals are checked here so callers
   * never parse a string suffix.
   */
  kind: p.staking_pool_id.endsWith("-flexible") || p.extra?.duration === null || p.extra?.duration === void 0 ? "flexible" : "tiered"
}));
var minswapPortfolioSchema = z.object({
  project_code: z.string(),
  project_name: z.string(),
  project_description: z.string(),
  website_url: z.string(),
  icon_url: z.string(),
  cpmm: arrayOf(lpPositionSchema),
  yields: arrayOf(farmPositionSchema),
  stakings: arrayOf(stakingPositionSchema),
  total_usd_value: z.number()
}).transform((m) => ({
  projectCode: m.project_code,
  projectName: m.project_name,
  projectDescription: m.project_description,
  websiteUrl: m.website_url,
  iconUrl: m.icon_url,
  lp: m.cpmm,
  farms: m.yields,
  stakings: m.stakings,
  totalUsdValue: m.total_usd_value
}));
var portfolioDefiSchema = z.object({
  minswap: minswapPortfolioSchema.nullish(),
  total_usd_value: z.number()
}).transform((d) => ({
  /** Absent upstream when the wallet holds no Minswap position at all. */
  lp: d.minswap?.lp ?? [],
  farms: d.minswap?.farms ?? [],
  stakings: d.minswap?.stakings ?? [],
  project: d.minswap ? {
    code: d.minswap.projectCode,
    name: d.minswap.projectName,
    description: d.minswap.projectDescription,
    websiteUrl: d.minswap.websiteUrl,
    iconUrl: d.minswap.iconUrl
  } : null,
  minswapUsdValue: d.minswap?.totalUsdValue ?? 0,
  totalUsdValue: d.total_usd_value
}));
var PortfolioModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /**
   * Fetch every Minswap position held by an address.
   *
   * @param address A Cardano payment or stake address.
   */
  async getDefi(address, options = {}) {
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/portfolio/defi",
      query: {
        address,
        // Required by the backend, and `minswap` is the only value it accepts
        // on Cardano.
        protocols: "minswap",
        direct_address: options.directAddress
      },
      schema: portfolioDefiSchema,
      currency: options.currency
    });
    return data;
  }
};
var stakingPoolSchema = z.object({
  pool_id: z.string(),
  coin: poolCoinSchema,
  amount_locked: z.number(),
  amount_locked_usd: z.number(),
  active: z.boolean(),
  rewards: arrayOf(poolRewardSchema),
  staked_share: z.number(),
  stakers: z.number(),
  positions: z.number()
}).transform((p) => ({
  poolId: p.pool_id,
  coin: p.coin,
  amountLocked: p.amount_locked,
  amountLockedUsd: p.amount_locked_usd,
  active: p.active,
  rewards: p.rewards,
  stakedShare: p.staked_share,
  stakers: p.stakers,
  positions: p.positions,
  /**
   * Tiered (locked) or flexible staking.
   *
   * The backend encodes this only as a `-flexible` suffix on the pool id; the
   * SDK surfaces it as an explicit field so `stake`/`unstake` can route
   * without the caller parsing the id.
   */
  kind: p.pool_id.endsWith("-flexible") ? "flexible" : "tiered"
}));
var stakingListSchema = z.object({
  pools: arrayOf(stakingPoolSchema),
  total_amount_locked: z.number(),
  total_amount_locked_usd: z.number(),
  total_rewards: arrayOf(poolRewardSchema),
  total_stakers: z.number()
}).transform((r) => ({
  pools: r.pools,
  totalAmountLocked: r.total_amount_locked,
  totalAmountLockedUsd: r.total_amount_locked_usd,
  totalRewards: r.total_rewards,
  totalStakers: r.total_stakers
}));
var rewardAmountSchema = arrayOf(
  z.object({
    asset: z.object({ currencySymbol: z.string(), tokenName: z.string() }),
    reward: z.union([z.string(), z.number()])
  }).transform((r) => ({
    coinId: inputAssetToCoinId(r.asset),
    amount: String(r.reward)
  }))
);
var StakingModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /**
   * All MIN staking pools, tiered and flexible, with totals.
   *
   * The endpoint takes no parameters — it returns the full set.
   */
  async list(options = {}) {
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/pool/ms-staking-pools",
      schema: stakingListSchema,
      currency: options.currency
    });
    return data;
  }
  /** An address's staking positions. Sourced from the DeFi portfolio. */
  async getPositions(address) {
    const { stakings } = await this.sdk.portfolio.getDefi(address);
    return stakings;
  }
  /** Stake MIN into the tiered or flexible contract. */
  async stake(params) {
    const inputs = await resolveWalletInputs(this.sdk, "staking.stake", params, false);
    const operation = params.kind === "tiered" ? "minBarBuildTieredStakeTx" : "minBarBuildLiquidStakeTx";
    const document = params.kind === "tiered" ? DOC_TIERED_STAKE : DOC_LIQUID_STAKE;
    const cbor = await this.sdk.clients.keyAppApi.execute({
      operation,
      document,
      variables: {
        options: {
          owner: params.address,
          asset: coinIdToInputAsset(params.coinId),
          amount: toBigIntString(params.amount),
          inputsToChoose: inputs.inputsToChoose
        }
      },
      schema: z.string()
    });
    return { cbor };
  }
  /**
   * Unstake a position in full.
   *
   * A tiered unstake additionally reports the rewards it releases. For a partial
   * flexible withdrawal, this is not the method — unstake takes the whole
   * position.
   */
  async unstake(params) {
    const inputs = await resolveWalletInputs(this.sdk, "staking.unstake", params, false);
    if (params.kind === "tiered") {
      const result = await this.sdk.clients.keyAppApi.execute({
        operation: "minBarBuildTieredUnstakeTx",
        document: DOC_TIERED_UNSTAKE,
        variables: {
          options: {
            unstakeUtxoTxIn: params.positionId,
            inputsToChoose: inputs.inputsToChoose
          }
        },
        schema: z.object({ tx: z.string(), pendingRewards: rewardAmountSchema }).transform((r) => ({ cbor: r.tx, pendingRewards: r.pendingRewards }))
      });
      return result;
    }
    const cbor = await this.sdk.clients.keyAppApi.execute({
      operation: "minBarBuildLiquidUnstakeTx",
      document: DOC_LIQUID_UNSTAKE,
      variables: {
        options: {
          unstakeUtxoTxIn: params.positionId,
          inputsToChoose: inputs.inputsToChoose
        }
      },
      schema: z.string()
    });
    return { cbor, pendingRewards: null };
  }
};
var DOC_TIERED_STAKE = `mutation MinBarBuildTieredStakeTx($options: MinBarBuildTieredStakeOptions!) {
  minBarBuildTieredStakeTx(options: $options)
}`;
var DOC_LIQUID_STAKE = `mutation MinBarBuildLiquidStakeTx($options: MinBarBuildLiquidStakeOptions!) {
  minBarBuildLiquidStakeTx(options: $options)
}`;
var DOC_TIERED_UNSTAKE = `mutation MinBarBuildTieredUnstakeTx($options: MinBarBuildTieredUnstakeOptions!) {
  minBarBuildTieredUnstakeTx(options: $options) {
    tx
    pendingRewards {
      asset {
        currencySymbol
        tokenName
      }
      reward
    }
  }
}`;
var DOC_LIQUID_UNSTAKE = `mutation MinBarBuildLiquidUnstakeTx($options: MinBarBuildLiquidUnstakeOptions!) {
  minBarBuildLiquidUnstakeTx(options: $options)
}`;
var amountString = z.string();
var coinSchema = z.object({
  coin_type: z.string().nullish(),
  symbol: z.string(),
  name: z.string(),
  logo: z.string(),
  description: z.string(),
  liquidity: amountString,
  market_cap: amountString,
  fdv: amountString,
  circulating_supply: amountString,
  total_supply: amountString,
  holders: z.number(),
  creator: z.string(),
  published_at: z.string(),
  first_trade_at: z.string().nullish(),
  verified: z.boolean(),
  decimals: z.number(),
  category: z.string().nullish(),
  scam_label: z.string().nullish()
}).transform((c) => ({
  coinId: c.coin_type ?? null,
  symbol: c.symbol,
  name: c.name,
  logo: c.logo,
  description: c.description,
  liquidity: c.liquidity,
  marketCap: c.market_cap,
  fdv: c.fdv,
  circulatingSupply: c.circulating_supply,
  totalSupply: c.total_supply,
  holders: c.holders,
  creator: c.creator,
  publishedAt: c.published_at,
  firstTradeAt: c.first_trade_at ?? null,
  verified: c.verified,
  decimals: c.decimals,
  category: c.category ?? null,
  scamLabel: c.scam_label ?? null
}));
var priceSchema = z.object({
  price: z.number(),
  price_change_1h: z.number(),
  price_change_6h: z.number(),
  price_change_1d: z.number(),
  price_change_7d: z.number(),
  price_change_30d: z.number(),
  price_24h_low: z.number(),
  price_24h_high: z.number(),
  ath: z.number(),
  atl: z.number()
}).transform((p) => ({
  price: p.price,
  priceChange1h: p.price_change_1h,
  priceChange6h: p.price_change_6h,
  priceChange1d: p.price_change_1d,
  priceChange7d: p.price_change_7d,
  priceChange30d: p.price_change_30d,
  price24hLow: p.price_24h_low,
  price24hHigh: p.price_24h_high,
  ath: p.ath,
  atl: p.atl
}));
var volumeSchema = z.object({
  vol_buy_1h: z.number(),
  vol_sell_1h: z.number(),
  vol_buy_24h: z.number(),
  vol_sell_24h: z.number(),
  vol_buy_1w: z.number(),
  vol_sell_1w: z.number()
}).transform((v) => ({
  volBuy1h: v.vol_buy_1h,
  volSell1h: v.vol_sell_1h,
  volBuy24h: v.vol_buy_24h,
  volSell24h: v.vol_sell_24h,
  volBuy1w: v.vol_buy_1w,
  volSell1w: v.vol_sell_1w
}));
var socialMediaSchema = z.object({
  x: z.string().nullish(),
  telegram: z.string().nullish(),
  website: z.string().nullish(),
  github: z.string().nullish(),
  discord: z.string().nullish(),
  facebook: z.string().nullish(),
  coingecko_url: z.string().nullish(),
  coinmarketcap_url: z.string().nullish(),
  banner_url: z.string().nullish(),
  docs: z.string().nullish()
}).transform((s) => ({
  x: s.x ?? null,
  telegram: s.telegram ?? null,
  website: s.website ?? null,
  github: s.github ?? null,
  discord: s.discord ?? null,
  facebook: s.facebook ?? null,
  coingeckoUrl: s.coingecko_url ?? null,
  coinmarketcapUrl: s.coinmarketcap_url ?? null,
  bannerUrl: s.banner_url ?? null,
  docs: s.docs ?? null
}));
var securitySchema = z.object({
  mintable: z.boolean().nullish(),
  blacklist: z.boolean().nullish(),
  top_10_holders: z.number().nullish()
}).transform((s) => ({
  mintable: s.mintable ?? null,
  blacklist: s.blacklist ?? null,
  /** Share of supply held by the top 10 holders. */
  top10Holders: s.top_10_holders ?? null
}));
var tagSchema = z.object({ id: z.number(), name: z.string() });
var tokenDetailSchema = z.object({
  coin: coinSchema,
  price_change: priceSchema,
  volume: volumeSchema.nullish(),
  social_media: socialMediaSchema,
  tags: arrayOf(tagSchema),
  rank: z.number().nullish(),
  security: securitySchema.nullish(),
  suspicious_labels: arrayOf(z.string())
}).transform((d) => ({
  coin: d.coin,
  /** Spot price plus change/high/low windows. Named `price_change` upstream. */
  price: d.price_change,
  volume: d.volume ?? null,
  socialMedia: d.social_media,
  tags: d.tags,
  rank: d.rank ?? null,
  security: d.security ?? null,
  suspiciousLabels: d.suspicious_labels
}));
var tokenSummarySchema = z.object({
  coin_type: z.string().nullish(),
  name: z.string(),
  symbol: z.string(),
  icon_url: z.string(),
  website: z.string(),
  description: z.string(),
  decimal: z.number(),
  verified: z.boolean(),
  first_trade_at: z.string().nullish(),
  volume_24h: z.number().nullish(),
  price: z.number().nullish(),
  price_change_1d: z.number().nullish(),
  price_change_7d: z.number().nullish(),
  price_change_30d: z.number().nullish(),
  published_at: z.string()
}).transform((t) => ({
  coinId: t.coin_type ?? null,
  name: t.name,
  symbol: t.symbol,
  iconUrl: t.icon_url,
  website: t.website,
  description: t.description,
  decimals: t.decimal,
  verified: t.verified,
  firstTradeAt: t.first_trade_at ?? null,
  volume24h: t.volume_24h ?? null,
  price: t.price ?? null,
  priceChange1d: t.price_change_1d ?? null,
  priceChange7d: t.price_change_7d ?? null,
  priceChange30d: t.price_change_30d ?? null,
  publishedAt: t.published_at
}));
var tokenListItemSchema = z.object({
  coin_type: z.string().nullish(),
  name: z.string(),
  symbol: z.string(),
  logo: z.string(),
  price: amountString,
  price_change_5m: z.number(),
  price_change_30m: z.number(),
  price_change_1h: z.number(),
  price_change_6h: z.number(),
  price_change_1d: z.number(),
  price_change_7d: z.number(),
  price_change_30d: z.number(),
  vol_change_1d: z.number(),
  liq_change_1d: z.number(),
  tx_change_1d: z.number(),
  tx_24h: z.number(),
  tx_buy_24h: z.number(),
  tx_sell_24h: z.number(),
  volume_1h: amountString,
  volume_24h: amountString,
  volume_1w: amountString,
  vol_buy_24h: amountString,
  vol_sell_24h: amountString,
  maker_24h: z.number(),
  market_cap: amountString,
  liquidity_usd: amountString,
  circulating_supply: amountString,
  total_supply: amountString,
  published_at: z.string(),
  first_trade_at: z.string().nullish(),
  verified: z.boolean(),
  suspicious_labels: arrayOf(z.string()),
  rank: z.number().nullish(),
  decimals: z.number().nullish(),
  category: z.string().nullish(),
  holders: z.number(),
  security: securitySchema.nullish(),
  boosting_point: z.number(),
  scam_label: z.string().nullish()
}).transform((t) => ({
  coinId: t.coin_type ?? null,
  name: t.name,
  symbol: t.symbol,
  logo: t.logo,
  price: t.price,
  priceChange5m: t.price_change_5m,
  priceChange30m: t.price_change_30m,
  priceChange1h: t.price_change_1h,
  priceChange6h: t.price_change_6h,
  priceChange1d: t.price_change_1d,
  priceChange7d: t.price_change_7d,
  priceChange30d: t.price_change_30d,
  volumeChange1d: t.vol_change_1d,
  liquidityChange1d: t.liq_change_1d,
  txChange1d: t.tx_change_1d,
  tx24h: t.tx_24h,
  txBuy24h: t.tx_buy_24h,
  txSell24h: t.tx_sell_24h,
  volume1h: t.volume_1h,
  volume24h: t.volume_24h,
  volume1w: t.volume_1w,
  volBuy24h: t.vol_buy_24h,
  volSell24h: t.vol_sell_24h,
  maker24h: t.maker_24h,
  marketCap: t.market_cap,
  liquidityUsd: t.liquidity_usd,
  circulatingSupply: t.circulating_supply,
  totalSupply: t.total_supply,
  publishedAt: t.published_at,
  firstTradeAt: t.first_trade_at ?? null,
  verified: t.verified,
  suspiciousLabels: t.suspicious_labels,
  rank: t.rank ?? null,
  decimals: t.decimals ?? null,
  category: t.category ?? null,
  holders: t.holders,
  security: t.security ?? null,
  boostingPoint: t.boosting_point,
  scamLabel: t.scam_label ?? null
}));
var tokenTradeSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  action: z.string(),
  from_coin_ident: z.string().nullish(),
  from_coin_name: z.string(),
  from_coin_symbol: z.string(),
  to_coin_ident: z.string().nullish(),
  to_coin_name: z.string(),
  to_coin_symbol: z.string(),
  price: z.number(),
  amount_in: z.number(),
  amount_out: z.number(),
  usd_value: z.number(),
  tx_digest: z.string(),
  sender: z.string(),
  protocol: z.string(),
  source: z.string().nullish(),
  status: z.string()
}).transform((t) => ({
  id: t.id,
  /** Epoch milliseconds. */
  timestamp: t.timestamp,
  action: t.action,
  fromCoinId: t.from_coin_ident ?? null,
  fromCoinName: t.from_coin_name,
  fromCoinSymbol: t.from_coin_symbol,
  toCoinId: t.to_coin_ident ?? null,
  toCoinName: t.to_coin_name,
  toCoinSymbol: t.to_coin_symbol,
  price: t.price,
  amountIn: t.amount_in,
  amountOut: t.amount_out,
  usdValue: t.usd_value,
  txHash: t.tx_digest,
  sender: t.sender,
  protocol: t.protocol,
  source: t.source ?? null,
  status: t.status
}));
var TOKEN_LIST_SORT_BY = [
  "MARKETCAP",
  "VOLUME_1H",
  "VOLUME_1D",
  "VOLUME_1W",
  "PUBLISHED_AT",
  "LIQUIDITY",
  "TX_COUNT",
  "PRICE_CHANGE",
  "PRICE_CHANGE_5MIN",
  "PRICE_CHANGE_30MIN",
  "PRICE_CHANGE_1H",
  "PRICE_CHANGE_4H",
  "PRICE_CHANGE_6H",
  "PRICE_CHANGE_1D",
  "PRICE_CHANGE_1W"
];
var TOKEN_TRADE_ACTIONS = [
  "buy",
  "sell",
  "join",
  "single_join",
  "exit",
  "single_exit"
];
function toWireFilters(filters) {
  const wire = {
    search_term: filters.searchTerm,
    coin_ids: filters.coinIds,
    min_market_cap: filters.minMarketCap,
    max_market_cap: filters.maxMarketCap,
    min_liquidity: filters.minLiquidity,
    max_liquidity: filters.maxLiquidity,
    min_volume: filters.minVolume,
    max_volume: filters.maxVolume,
    min_top_10_holding: filters.minTop10Holding,
    max_top_10_holding: filters.maxTop10Holding,
    min_holder: filters.minHolder,
    max_holder: filters.maxHolder,
    min_price_1h_change: filters.minPrice1hChange,
    max_price_1h_change: filters.maxPrice1hChange,
    min_price_6h_change: filters.minPrice6hChange,
    max_price_6h_change: filters.maxPrice6hChange,
    min_price_24h_change: filters.minPrice24hChange,
    max_price_24h_change: filters.maxPrice24hChange,
    min_tx_buy_24h: filters.minTxBuy24h,
    max_tx_buy_24h: filters.maxTxBuy24h,
    min_tx_sell_24h: filters.minTxSell24h,
    max_tx_sell_24h: filters.maxTxSell24h,
    min_tx_24h: filters.minTx24h,
    max_tx_24h: filters.maxTx24h,
    publish_at_from: filters.publishAtFrom ? toRfc3339(filters.publishAtFrom) : void 0,
    publish_at_to: filters.publishAtTo ? toRfc3339(filters.publishAtTo) : void 0,
    has_x_social: filters.hasXSocial,
    has_telegram_social: filters.hasTelegramSocial,
    has_discord_social: filters.hasDiscordSocial,
    has_website_social: filters.hasWebsiteSocial,
    has_social: filters.hasSocial,
    verified: filters.verified,
    is_boosted: filters.isBoosted
  };
  for (const key of Object.keys(wire)) {
    if (wire[key] === void 0) {
      delete wire[key];
    }
  }
  return wire;
}
var INFO_LIST_CHUNK = 100;
var TokenModule = class {
  constructor(sdk) {
    this.sdk = sdk;
  }
  sdk;
  /**
   * Fetch full detail for a single token.
   *
   * @param coinId `policyId.assetNameHex`, or `lovelace` for ADA.
   * @throws {MinswapError} with code `NOT_FOUND` when no such token exists.
   */
  async getById(coinId, options = {}) {
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/coin/detail",
      query: { ident: coinId },
      schema: tokenDetailSchema,
      currency: options.currency,
      notFound: { resource: "token", id: coinId }
    });
    return data;
  }
  /**
   * Fetch compact records for many tokens at once.
   *
   * Requests are chunked at 100 ids, the upstream cap. Tokens that do not
   * exist are simply absent from the result, so the output length may be
   * shorter than the input and the order is not guaranteed to match.
   */
  async getByIds(coinIds, options = {}) {
    if (coinIds.length === 0) {
      return [];
    }
    const chunks = [];
    for (let i = 0; i < coinIds.length; i += INFO_LIST_CHUNK) {
      chunks.push(coinIds.slice(i, i + INFO_LIST_CHUNK));
    }
    const pages = await Promise.all(
      chunks.map(
        (chunk) => this.sdk.clients.appApi.post({
          path: "/api/v1/coin/info-list",
          body: {
            search: "",
            coin_types: chunk,
            verified: false,
            pagination: { offset: 0, limit: chunk.length }
          },
          schema: arrayOf(tokenSummarySchema),
          currency: options.currency
        })
      )
    );
    return pages.flatMap((page) => page.data);
  }
  /** List tokens with filtering and sorting. */
  async list(params = {}) {
    assertLimit(params.limit, 50);
    const limit = params.limit ?? 20;
    const offset = decodeOffsetCursor(params.cursor);
    const filters = toWireFilters(params.filters ?? {});
    if (Object.keys(filters).length === 0 && !params.applyBackendDefaults) {
      filters["min_liquidity"] = 0;
    }
    const { data } = await this.sdk.clients.appApi.post({
      path: "/api/v1/coin/list",
      body: {
        pagination: { offset, limit },
        sort_by: params.sortBy ?? "VOLUME_1D",
        order: params.order ?? "DESC",
        filters
      },
      schema: arrayOf(tokenListItemSchema),
      currency: params.currency
    });
    return offsetPage(data, offset, limit);
  }
  /** OHLC candles for a token, oldest bucket first. */
  async getOhlc(params) {
    const bucketMinutes = params.bucketMinutes ?? 1;
    assertBucket(bucketMinutes);
    if (params.limit !== void 0 && (!Number.isInteger(params.limit) || params.limit < 1)) {
      throw new MinswapError(
        `limit must be a positive integer; received ${params.limit}`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "limit", reason: "must be a positive integer" }
      );
    }
    const { data } = await this.sdk.clients.appApi.get({
      path: "/api/v1/coin/ohlc-chart",
      query: {
        coin_type: params.coinId,
        // This endpoint wants RFC 3339; the pool chart wants epoch seconds.
        from: params.from ? toRfc3339(params.from) : void 0,
        to: params.to ? toRfc3339(params.to) : void 0,
        bucketMinute: bucketMinutes,
        limit: params.limit
      },
      schema: arrayOf(coinCandleSchema),
      currency: params.currency
    });
    return data;
  }
  /** Recent trades for a token, newest first. */
  async getTradeHistory(params) {
    assertLimit(params.limit, 50);
    const { data, pagination } = await this.sdk.clients.appApi.post({
      path: "/api/v1/coin/trading-history",
      body: {
        coin_type: params.coinId,
        pagination: { cursor: params.cursor, limit: params.limit ?? 20 },
        filters: {
          time_range: params.timeRange ? [toEpochMs(params.timeRange.from), toEpochMs(params.timeRange.to)] : void 0,
          actions: params.actions,
          usd_value: params.usdValue,
          protocols: params.protocols,
          senders: params.senders
        }
      },
      schema: arrayOf(tokenTradeSchema),
      currency: params.currency
    });
    return cursorPage(data, pagination?.lastCursor);
  }
};

// src/sdk.ts
var MinswapSdk = class {
  config;
  clients;
  token;
  pool;
  portfolio;
  order;
  aggregator;
  farm;
  staking;
  liquidity;
  constructor(config = {}) {
    this.config = resolveConfig(config);
    const http = new HttpCore({
      fetch: this.config.fetch,
      timeoutMs: this.config.timeoutMs,
      retry: this.config.retry
    });
    this.clients = {
      appApi: new AppApiClient(http, this.config),
      aggregatorApi: new AggregatorApiClient(http, this.config),
      keyAppApi: new KeyAppApiClient(http, this.config),
      appGraphql: new AppGraphqlClient(http, this.config)
    };
    this.token = new TokenModule(this);
    this.pool = new PoolModule(this);
    this.portfolio = new PortfolioModule(this);
    this.order = new OrderModule(this);
    this.aggregator = new AggregatorModule(this);
    this.farm = new FarmModule(this);
    this.staking = new StakingModule(this);
    this.liquidity = new LiquidityModule(this);
  }
  /**
   * Chain access, when configured.
   *
   * Present only if an `rpcProvider` was supplied. Farm and staking actions
   * require it; every read works without it.
   */
  get rpcProvider() {
    return this.config.rpcProvider;
  }
};
var parseBig = JSONBig({ alwaysParseAsBig: true, useNativeBigInt: true }).parse;
var bigintish = z.union([z.bigint(), z.number(), z.string()]).transform((v) => BigInt(v));
var kupoMatchSchema = z.object({
  transaction_id: z.string(),
  transaction_index: bigintish,
  output_index: bigintish,
  address: z.string(),
  value: z.object({
    coins: bigintish,
    assets: z.record(z.string(), bigintish).nullish()
  }),
  datum_hash: z.string().nullish(),
  datum_type: z.enum(["inline", "hash"]).nullish(),
  script_hash: z.string().nullish()
});
var kupoMatchesSchema = z.array(kupoMatchSchema);
var kupoDatumSchema = z.object({ datum: z.string() }).nullish();
var KupoRpcProvider = class {
  http;
  baseUrl;
  headers;
  maxConcurrency;
  configuredSerializer;
  serializer;
  constructor(options) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new MinswapError(
        "No fetch implementation available; pass one via `new KupoRpcProvider({ fetch })`",
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "fetch", reason: "is not available on globalThis" }
      );
    }
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.headers = options.headers ?? {};
    this.maxConcurrency = options.maxConcurrency ?? 20;
    this.configuredSerializer = options.serializer;
    this.http = new HttpCore({
      fetch: fetchImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retry: { ...DEFAULT_RETRY, ...options.retry }
    });
  }
  async getUtxosByAddress(address) {
    const matches = await this.matches(`${encodeURIComponent(address)}?unspent`);
    return this.toRpcUtxos(matches);
  }
  async getUtxosByRefs(refs) {
    if (refs.length === 0) {
      return [];
    }
    const batches = await mapConcurrent(
      refs,
      this.maxConcurrency,
      (ref) => this.matches(`${ref.outputIndex}@${ref.txHash}?unspent`)
    );
    return this.toRpcUtxos(batches.flat());
  }
  async matches(pattern) {
    return this.http.request({
      url: `${this.baseUrl}/matches/${pattern}`,
      method: "GET",
      endpoint: `GET /matches/${pattern}`,
      headers: this.headers,
      schema: kupoMatchesSchema,
      parseJson: parseBig
    });
  }
  async getDatum(hash) {
    const result = await this.http.request({
      url: buildUrl(this.baseUrl, `/datums/${hash}`),
      method: "GET",
      endpoint: `GET /datums/${hash}`,
      headers: this.headers,
      schema: kupoDatumSchema,
      parseJson: parseBig
    });
    return result?.datum;
  }
  async toRpcUtxos(matches) {
    if (matches.length === 0) {
      return [];
    }
    const serializer = await this.loadSerializer();
    const hashes = [
      ...new Set(
        matches.filter((m) => m.datum_type === "inline" && m.datum_hash).map((m) => m.datum_hash)
      )
    ];
    const datums = /* @__PURE__ */ new Map();
    const resolved = await mapConcurrent(hashes, this.maxConcurrency, (h) => this.getDatum(h));
    for (const [i, h] of hashes.entries()) datums.set(h, resolved[i]);
    return matches.map((match) => this.toRpcUtxo(match, datums, serializer));
  }
  toRpcUtxo(match, datums, serializer) {
    const ref = `${match.transaction_id}#${match.output_index}`;
    if (match.script_hash) {
      throw new MinswapError(
        `UTxO ${ref} carries a reference script, which this provider cannot serialize faithfully yet. Exclude it from the inputs you pass to Minswap.`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "utxo", reason: "reference scripts are not supported" }
      );
    }
    const datum = match.datum_hash ? datums.get(match.datum_hash) : void 0;
    if (match.datum_type === "inline" && !datum) {
      throw new MinswapError(
        `UTxO ${ref} has an inline datum that Kupo did not return for hash ${match.datum_hash}`,
        "API_ERROR" /* API_ERROR */,
        { endpoint: `GET /datums/${match.datum_hash}`, status: 200, body: null }
      );
    }
    const kupoUtxo = {
      transaction_id: match.transaction_id,
      transaction_index: Number(match.transaction_index),
      output_index: Number(match.output_index),
      address: match.address,
      value: {
        coins: match.value.coins,
        assets: match.value.assets ?? void 0
      },
      datum_hash: match.datum_hash ?? null,
      datum_type: match.datum_type ?? null,
      // Ignored by the conversion, which reads only the input ref and output.
      created_at: { slot_no: 0, header_hash: "" }
    };
    let cbor;
    try {
      cbor = serializer.toCborHex(kupoUtxo, datum);
    } catch (cause) {
      throw new MinswapError(
        `UTxO ${ref} could not be serialized to CBOR`,
        "INVALID_PARAMS" /* INVALID_PARAMS */,
        { param: "utxo", reason: `serializer rejected ${ref}: ${String(cause)}` }
      );
    }
    return {
      txHash: match.transaction_id,
      outputIndex: Number(match.output_index),
      address: match.address,
      cbor,
      assets: toAssetMap(match.value),
      datumHash: match.datum_hash ?? null,
      datum: datum ?? null,
      scriptRef: null
    };
  }
  /**
   * Resolve the serializer on first use.
   *
   * Deferred rather than imported at module scope so consumers who never touch
   * this provider are not made to load a WebAssembly Cardano library.
   */
  loadSerializer() {
    if (this.configuredSerializer) {
      return Promise.resolve(this.configuredSerializer);
    }
    this.serializer ??= importLedger().then((ledger) => ({
      toCborHex: (utxo, datum) => ledger.Utxo.toHex(ledger.Utxo.fromKupo(utxo, datum))
    }));
    return this.serializer;
  }
};
var INTERNAL_SDK2 = "@minswap/internal-sdk";
async function importLedger() {
  let mod;
  try {
    mod = await import(
      /* @vite-ignore */
      INTERNAL_SDK2
    );
  } catch (cause) {
    throw new MinswapError(
      `KupoRpcProvider needs ${INTERNAL_SDK2} to serialize UTxOs. Install it: npm install ${INTERNAL_SDK2}`,
      "INVALID_PARAMS" /* INVALID_PARAMS */,
      { param: INTERNAL_SDK2, reason: `could not be imported: ${String(cause)}` }
    );
  }
  await mod.RustModule.load();
  return mod;
}
function toAssetMap(value) {
  const assets = { lovelace: value.coins };
  for (const [key, amount] of Object.entries(value.assets ?? {})) {
    const [policyId, assetName = ""] = key.split(".");
    assets[`${policyId}${assetName}`] = amount;
  }
  return assets;
}
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (; ; ) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export { AGGREGATOR_PROTOCOLS, AggregatorApiClient, AggregatorModule, AppApiClient, AppGraphqlClient, BATCHER_FEE, CANCEL_ADAPTER_PROTOCOL, DEFAULT_ENDPOINTS, DEFAULT_RETRY, DEFAULT_TIMEOUT_MS, DEPOSIT_ADA, DEX_V1, DEX_V2, FARM_LIST_SORT_FIELDS, FARM_PROTOCOLS, FarmModule, HttpCore, KeyAppApiClient, KupoRpcProvider, LiquidityModule, MAINNET_NETWORK_ENV, MinswapError, MinswapErrorCode, MinswapSdk, ORDER_SOURCE_DIRECT, ORDER_STATUSES, OrderModule, POOL_CATEGORY_GROUPS, POOL_EVENT_ACTIONS, POOL_FILTER_TYPES, POOL_LIST_SORT_FIELDS, POOL_TYPES, PoolModule, PortfolioModule, StakingModule, TOKEN_LIST_SORT_BY, TOKEN_TRADE_ACTIONS, TokenModule, VALID_BUCKET_MINUTES, arrayOf, assertBucket, assertLimit, assetUnitToCoinId, buildUrl, coinAmountInfoSchema, coinBasicInfoSchema, coinCandleSchema, coinIdToAssetUnit, coinIdToInputAsset, collect, cursorPage, decimalToRaw, decodeOffsetCursor, encodeOffsetCursor, formatTxIn, getAppliedPoolsByLpAssets, getAppliedPoolsByPairs, inputAssetToCoinId, isPureAda, loadDexBuilder, lovelaceOf, offsetPage, paginate, parseTxIn, poolCandleSchema, poolCoinSchema, poolFeeSchema, poolRewardSchema, requireRpcProvider, resolveConfig, resolveWalletInputs, selectCollateral, toBigIntString, toDatumHex, toEpochMs, toEpochSeconds, toRfc3339, zeroableNumber };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map