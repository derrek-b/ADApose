import { ZodType, z } from 'zod';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type RetryConfig = {
    /** Number of retries *after* the initial attempt. `0` disables retrying. */
    retries: number;
    /** Base for exponential backoff: attempt N waits `baseDelayMs * 2^N`. */
    baseDelayMs: number;
};
type HttpCoreOptions = {
    fetch: FetchLike;
    timeoutMs: number;
    retry: RetryConfig;
};
type HttpRequest<T> = {
    /** Fully-qualified URL, query string already applied. */
    url: string;
    method: "GET" | "POST";
    /** Human-readable label used in error details, e.g. `POST /api/v1/coin/list`. */
    endpoint: string;
    headers?: Record<string, string>;
    /** Serialized as JSON when present. */
    body?: unknown;
    /** Validated at the trust boundary; the resolved value is `T`. */
    schema: ZodType<T>;
    /**
     * When provided, a 404 is reported as {@link MinswapErrorCode.NOT_FOUND}
     * carrying this resource/id instead of a generic API error.
     */
    notFound?: {
        resource: string;
        id: string;
    };
    /**
     * Override how the response body is turned into a value.
     *
     * Defaults to `JSON.parse`. Kupo returns unbounded integers — token
     * quantities and large lovelace amounts both exceed `Number.MAX_SAFE_INTEGER`
     * — so that transport substitutes a bigint-preserving parser. Parsing those
     * as doubles would silently round the amount and produce transaction bytes
     * that do not match the chain.
     */
    parseJson?: (raw: string) => unknown;
    /**
     * Decode the response body even when the HTTP status is not 2xx.
     *
     * GraphQL returns resolver errors in the body — an `errors` array — often with
     * a 400 or 500 status. Without this, that body is thrown away as an opaque
     * API error and the structured errors are lost. The GraphQL client sets it so
     * those errors surface as {@link MinswapErrorCode.GRAPHQL_ERROR}. A 429 is
     * still reported as a rate limit regardless.
     */
    parseErrorBody?: boolean;
};
/**
 * Shared transport for every Minswap backend: fetch with a timeout, a
 * conservative retry policy, uniform error mapping, and schema validation.
 *
 * Stateless apart from its options, so all three API clients share one instance.
 */
declare class HttpCore {
    private readonly options;
    constructor(options: HttpCoreOptions);
    request<T>(request: HttpRequest<T>): Promise<T>;
    private attempt;
    private send;
    private assertOk;
    private decode;
}

/** A transaction output reference, `txHash#outputIndex`. */
type RpcTxIn = {
    txHash: string;
    outputIndex: number;
};
type RpcUtxo = {
    txHash: string;
    outputIndex: number;
    address: string;
    /**
     * Full CBOR hex of the UTxO.
     *
     * Required, not optional: the farm and MIN staking mutations take wallet
     * inputs as CBOR hex (`inputsToChoose`), so a provider that cannot produce
     * this cannot support those actions.
     */
    cbor: string;
    /** Unit -> quantity. `lovelace` for ADA; other units are `policyId + assetNameHex`. */
    assets: Record<string, bigint>;
    datumHash?: string | null;
    datum?: string | null;
    scriptRef?: string | null;
};
/**
 * Chain access the SDK needs but does not provide.
 *
 * The SDK never signs or submits transactions, but some actions still need to
 * know what a wallet holds — farm and staking mutations require the caller's
 * UTxOs as inputs. Rather than depend on a specific wallet or indexer, the SDK
 * takes this interface and lets you supply the implementation (Lucid,
 * Blockfrost, Maestro, Kupo, your own node).
 *
 * Optional overall: token, pool, portfolio, and order reads never touch it.
 * Only farm and staking actions do, and they fail with a clear error when it
 * is absent.
 */
interface RpcProvider {
    /** Every UTxO at an address. Used to fund and collateralize actions. */
    getUtxosByAddress(address: string): Promise<RpcUtxo[]>;
    /**
     * Resolve specific outputs by reference.
     *
     * Used to confirm a position's UTxO is still unspent before building an
     * action against it. Implementations should omit references they cannot
     * find rather than throwing.
     */
    getUtxosByRefs(refs: RpcTxIn[]): Promise<RpcUtxo[]>;
}
/** Parse `txHash#index` into a structured reference. */
declare function parseTxIn(ref: string): RpcTxIn;
declare function formatTxIn(ref: RpcTxIn): string;
/**
 * Narrow an optional provider to a present one, with an error that says what
 * to do about it.
 */
declare function requireRpcProvider(provider: RpcProvider | undefined, action: string): RpcProvider;
/** Lovelace held by a UTxO. */
declare function lovelaceOf(utxo: RpcUtxo): bigint;
/** True when a UTxO holds only ADA, which is what collateral must be. */
declare function isPureAda(utxo: RpcUtxo): boolean;
/**
 * Pick UTxOs usable as collateral.
 *
 * Collateral must be pure ADA and is forfeited if a script fails, so the
 * largest holdings are deliberately avoided: this takes the smallest adequate
 * ones. A CIP-30 wallet's designated collateral should be preferred when the
 * caller has it — this is the fallback for providers with no such concept.
 */
declare function selectCollateral(utxos: RpcUtxo[], { minLovelace, count }?: {
    minLovelace?: bigint;
    count?: number;
}): RpcUtxo[];

/**
 * Only mainnet is currently served. Testnet deployments of the app API and
 * aggregator APIs are not public, so rather than ship an enum member that
 * resolves to a dead host, point {@link MinswapSdkConfig.endpoints} at
 * whatever you are running.
 */
type MinswapNetwork = "mainnet";
/** Value of the `X-Currency` header. Drives which fiat denomination prices come back in. */
type MinswapCurrency = "USD" | "ADA";
type MinswapEndpoints = {
    /** Minswap app API — tokens, pools, farms, staking, portfolio. */
    appApiUrl: string;
    /**
     * Aggregator REST API.
     *
     * Defaults to the public `agg-api.minswap.org` ingress rather than the
     * `aggr-monorepo-*` origin. That ingress additionally routes
     * `/aggregator/cancel-tx` through to the key-aggr service, so a single base
     * URL covers the whole aggregator surface including cancellation.
     */
    aggregatorApiUrl: string;
    /** key-app-api GraphQL endpoint — farm and MIN staking transaction building. */
    keyAppApiUrl: string;
    /**
     * app-monorepo GraphQL endpoint — reads a pool's on-chain state (reserves,
     * total liquidity, fee) for quoting liquidity operations.
     *
     * This is a different host from {@link appApiUrl} (the Go read API): it is the
     * TypeScript monorepo's GraphQL server, which serves `appliedPoolsBy*` with the
     * pool UTxO's Plutus datum inline so the SDK can decode reserves without its
     * own chain access.
     */
    appGraphqlUrl: string;
};
declare const DEFAULT_ENDPOINTS: Record<MinswapNetwork, MinswapEndpoints>;
declare const DEFAULT_TIMEOUT_MS = 30000;
declare const DEFAULT_RETRY: RetryConfig;
type MinswapSdkConfig = {
    /** @default "mainnet" */
    network?: MinswapNetwork;
    /** @default "USD" */
    currency?: MinswapCurrency;
    /**
     * Sent as `X-API-Key` to the app API host, which raises the rate limit above
     * the anonymous per-IP budget. Optional — the API is usable without one.
     */
    apiKey?: string;
    /** Override any subset of the default hosts. Useful for staging or a local backend. */
    endpoints?: Partial<MinswapEndpoints>;
    /**
     * Injected for testing, or for runtimes with a non-global fetch.
     * @default globalThis.fetch
     */
    fetch?: FetchLike;
    /** Per-request timeout in milliseconds. @default 30000 */
    timeoutMs?: number;
    /** Retry policy for transient failures. 429 is never retried. @default {retries: 2, baseDelayMs: 300} */
    retry?: Partial<RetryConfig>;
    /**
     * Chain access, used to resolve a wallet's UTxOs.
     *
     * Only farm and MIN staking actions need this — they take the caller's
     * address and must supply its UTxOs as transaction inputs. Every read
     * (token, pool, portfolio, order) works without it, so it stays optional and
     * the actions that require it fail with a clear message when it is absent.
     */
    rpcProvider?: RpcProvider;
};
/** {@link MinswapSdkConfig} with every default filled in. */
type ResolvedMinswapConfig = {
    network: MinswapNetwork;
    currency: MinswapCurrency;
    apiKey: string | undefined;
    endpoints: MinswapEndpoints;
    fetch: FetchLike;
    timeoutMs: number;
    retry: RetryConfig;
    rpcProvider: RpcProvider | undefined;
};
declare function resolveConfig(config?: MinswapSdkConfig): ResolvedMinswapConfig;

type QueryValue = string | number | boolean | (string | number)[] | undefined | null;
type Query = Record<string, QueryValue>;
/**
 * Join a base, a path, and a query object into a URL.
 *
 * `undefined` and `null` entries are dropped so callers can spread optional
 * params without guarding each one. Empty arrays are dropped too (they would
 * otherwise emit a bare `key=`). Non-empty arrays are comma-joined, which is the
 * convention every Minswap backend uses for repeated filters.
 */
declare function buildUrl(base: string, path: string, query?: Query): string;
/**
 * Normalize a caller-supplied instant to epoch milliseconds.
 *
 * Endpoints disagree on wire format — some want RFC 3339, others epoch
 * seconds — so modules accept `Date | number` and convert at the last moment.
 * A non-finite input (`NaN`, an `Invalid Date`) is rejected with a typed error
 * rather than propagating a raw `RangeError` from downstream conversions.
 */
declare function toEpochMs(value: Date | number): number;
declare function toEpochSeconds(value: Date | number): number;
declare function toRfc3339(value: Date | number): string;

type AggregatorApiGetOptions<T> = {
    path: string;
    query?: Query;
    schema: ZodType<T>;
    notFound?: {
        resource: string;
        id: string;
    };
};
type AggregatorApiPostOptions<T> = Omit<AggregatorApiGetOptions<T>, "query"> & {
    body?: unknown;
};
/**
 * Client for the aggregator REST API (`agg-api.minswap.org`).
 *
 * Unlike the app API there is no response envelope — handlers return their
 * payload directly. There is also no authentication; access is limited only by
 * per-IP rate limiting.
 *
 * Note this host's ingress also fronts `/aggregator/cancel-tx`, which is served
 * by a separate key-holding service. That split is invisible here by design:
 * one base URL covers quoting, building, submitting, and cancelling.
 */
declare class AggregatorApiClient {
    private readonly http;
    private readonly config;
    constructor(http: HttpCore, config: ResolvedMinswapConfig);
    get<T>(options: AggregatorApiGetOptions<T>): Promise<T>;
    post<T>(options: AggregatorApiPostOptions<T>): Promise<T>;
    private get baseUrl();
}

type AppApiPagination = {
    offset?: number | null;
    limit?: number | null;
    lastCursor?: string | null;
};
type AppApiResult<T> = {
    data: T;
    pagination: AppApiPagination | undefined;
};
type AppApiGetOptions<T> = {
    path: string;
    query?: Query;
    schema: ZodType<T>;
    /** Currency for this call only; falls back to the SDK-wide setting. */
    currency?: MinswapCurrency;
    notFound?: {
        resource: string;
        id: string;
    };
};
type AppApiPostOptions<T> = Omit<AppApiGetOptions<T>, "query"> & {
    body?: unknown;
};
/**
 * Client for the Minswap app API (`api-internal.minswap.org`).
 *
 * Read-only analytics: tokens, pools, yield pools, MIN staking, portfolio.
 * It builds no transactions — every write path in this SDK goes elsewhere.
 */
declare class AppApiClient {
    private readonly http;
    private readonly config;
    constructor(http: HttpCore, config: ResolvedMinswapConfig);
    get<T>(options: AppApiGetOptions<T>): Promise<AppApiResult<T>>;
    post<T>(options: AppApiPostOptions<T>): Promise<AppApiResult<T>>;
    private get baseUrl();
    private send;
    private headers;
}

type AppGraphqlOperation<T> = {
    /** Operation name, used for error reporting only. */
    operation: string;
    /** The GraphQL document to execute. */
    document: string;
    variables?: Record<string, unknown>;
    /** Validates the payload under the operation's field, not the whole envelope. */
    schema: ZodType<T>;
};
/**
 * Read client for the app-monorepo GraphQL host (`appGraphqlUrl`).
 *
 * Deliberately identical in shape to {@link KeyAppApiClient} — same envelope,
 * same single-root-field unwrap, same `parseErrorBody` so resolver errors
 * carried on a non-2xx status surface as {@link MinswapErrorCode.GRAPHQL_ERROR}
 * — but it runs **queries** (pool state), not mutations, and the results are
 * plain read data, never partially-signed CBOR. It exists as its own class
 * rather than being folded into the key-app client because it targets a
 * different host and a different operation kind.
 */
declare class AppGraphqlClient {
    private readonly http;
    private readonly config;
    constructor(http: HttpCore, config: ResolvedMinswapConfig);
    execute<T>(operation: AppGraphqlOperation<T>): Promise<T>;
}

type KeyAppApiOperation<T> = {
    /** Operation name, used for error reporting only. */
    operation: string;
    /** The GraphQL document to execute. */
    document: string;
    variables?: Record<string, unknown>;
    /** Validates the payload under the operation's field, not the whole envelope. */
    schema: ZodType<T>;
};
/**
 * Client for key-app-api (`k-app-monorepo-mainnet-prod.minswap.org/graphql`).
 *
 * This host builds farm and MIN staking transactions. It exists as a separate
 * transport because those contracts require Minswap-held keys as required
 * signers and the reward math depends on the backend's indexed database — so
 * the transaction cannot be constructed client-side.
 *
 * Everything it returns is CBOR that has already been **partially signed** by
 * the server. Consumers must sign with `partialSign = true` and assemble the
 * witness onto the existing one rather than replacing it.
 */
declare class KeyAppApiClient {
    private readonly http;
    private readonly config;
    constructor(http: HttpCore, config: ResolvedMinswapConfig);
    execute<T>(operation: KeyAppApiOperation<T>): Promise<T>;
}

/**
 * Contract every module satisfies.
 *
 * Modules hold a back-reference to the root SDK and read their transport and
 * configuration from it, so adding a module never requires threading new
 * arguments through the constructor chain.
 */
interface IMinswapModule {
    readonly sdk: MinswapSdk;
}

/**
 * Protocols the aggregator can route through. Wire values, not display names.
 */
declare const AGGREGATOR_PROTOCOLS: readonly ["MinswapV2", "Minswap", "MinswapStable", "Splash", "Spectrum", "SplashStable", "SundaeSwapV3", "SundaeSwap", "SundaeSwapStable", "WingRidersV2", "WingRiders", "WingRidersStableV1", "WingRidersStableV2", "OpenDjedV1", "ChakraBondingCurve", "CswapV1", "VyFinance", "MuesliSwap", "DanogoCLMMV1"];
type AggregatorProtocol = (typeof AGGREGATOR_PROTOCOLS)[number];
/**
 * Protocol accepted when cancelling. The aggregator additionally recognizes
 * `MINSWAP_ADAPTER` here for orders it placed on a user's behalf via its
 * adapter path.
 */
declare const CANCEL_ADAPTER_PROTOCOL = "MINSWAP_ADAPTER";
type CancelProtocol = AggregatorProtocol | typeof CANCEL_ADAPTER_PROTOCOL;
declare const assetSchema: z.ZodPipe<z.ZodObject<{
    token_id: z.ZodString;
    logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    ticker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_verified: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    price_by_ada: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    price_by_usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    project_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    decimals: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string;
    logo: string | null;
    ticker: string | null;
    isVerified: boolean | null;
    priceByAda: number | null;
    priceByUsd: number | null;
    projectName: string | null;
    decimals: number | null;
}, {
    token_id: string;
    logo?: string | null | undefined;
    ticker?: string | null | undefined;
    is_verified?: boolean | null | undefined;
    price_by_ada?: number | null | undefined;
    price_by_usd?: number | null | undefined;
    project_name?: string | null | undefined;
    decimals?: number | null | undefined;
}>>;
type AggregatorAsset = z.infer<typeof assetSchema>;
declare const pathSchema: z.ZodPipe<z.ZodObject<{
    pool_id: z.ZodString;
    protocol: z.ZodString;
    lp_token: z.ZodString;
    token_in: z.ZodString;
    token_out: z.ZodString;
    amount_in: z.ZodString;
    amount_out: z.ZodString;
    min_amount_out: z.ZodString;
    lp_fee: z.ZodString;
    dex_fee: z.ZodString;
    deposits: z.ZodString;
    price_impact: z.ZodNumber;
    pool_out_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    callback_paths: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodArray<z.ZodPipe<z.ZodObject<{
        pool_id: z.ZodString;
        protocol: z.ZodString;
        lp_token: z.ZodString;
        token_in: z.ZodString;
        token_out: z.ZodString;
        amount_in: z.ZodString;
        amount_out: z.ZodString;
        min_amount_out: z.ZodString;
        lp_fee: z.ZodString;
        dex_fee: z.ZodString;
        deposits: z.ZodString;
        price_impact: z.ZodNumber;
        pool_out_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        poolId: string;
        protocol: AggregatorProtocol;
        lpToken: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        lpFee: string;
        dexFee: string;
        deposits: string;
        priceImpact: number;
        poolOutRef: string | null;
    }, {
        pool_id: string;
        protocol: string;
        lp_token: string;
        token_in: string;
        token_out: string;
        amount_in: string;
        amount_out: string;
        min_amount_out: string;
        lp_fee: string;
        dex_fee: string;
        deposits: string;
        price_impact: number;
        pool_out_ref?: string | null | undefined;
    }>>>>>>;
}, z.core.$strip>, z.ZodTransform<{
    poolId: string;
    protocol: AggregatorProtocol;
    lpToken: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    lpFee: string;
    dexFee: string;
    deposits: string;
    priceImpact: number;
    poolOutRef: string | null;
    callbackPaths: {
        poolId: string;
        protocol: AggregatorProtocol;
        lpToken: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        lpFee: string;
        dexFee: string;
        deposits: string;
        priceImpact: number;
        poolOutRef: string | null;
    }[][];
}, {
    pool_id: string;
    protocol: string;
    lp_token: string;
    token_in: string;
    token_out: string;
    amount_in: string;
    amount_out: string;
    min_amount_out: string;
    lp_fee: string;
    dex_fee: string;
    deposits: string;
    price_impact: number;
    pool_out_ref?: string | null | undefined;
    callback_paths?: {
        poolId: string;
        protocol: AggregatorProtocol;
        lpToken: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        lpFee: string;
        dexFee: string;
        deposits: string;
        priceImpact: number;
        poolOutRef: string | null;
    }[][] | null | undefined;
}>>;
type AggregatorPath = z.infer<typeof pathSchema>;
declare const estimateSchema: z.ZodPipe<z.ZodObject<{
    token_in: z.ZodString;
    token_out: z.ZodString;
    amount_in: z.ZodString;
    amount_out: z.ZodString;
    min_amount_out: z.ZodString;
    total_lp_fee: z.ZodString;
    total_dex_fee: z.ZodString;
    deposits: z.ZodString;
    avg_price_impact: z.ZodNumber;
    paths: z.ZodArray<z.ZodArray<z.ZodPipe<z.ZodObject<{
        pool_id: z.ZodString;
        protocol: z.ZodString;
        lp_token: z.ZodString;
        token_in: z.ZodString;
        token_out: z.ZodString;
        amount_in: z.ZodString;
        amount_out: z.ZodString;
        min_amount_out: z.ZodString;
        lp_fee: z.ZodString;
        dex_fee: z.ZodString;
        deposits: z.ZodString;
        price_impact: z.ZodNumber;
        pool_out_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        callback_paths: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodArray<z.ZodPipe<z.ZodObject<{
            pool_id: z.ZodString;
            protocol: z.ZodString;
            lp_token: z.ZodString;
            token_in: z.ZodString;
            token_out: z.ZodString;
            amount_in: z.ZodString;
            amount_out: z.ZodString;
            min_amount_out: z.ZodString;
            lp_fee: z.ZodString;
            dex_fee: z.ZodString;
            deposits: z.ZodString;
            price_impact: z.ZodNumber;
            pool_out_ref: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>, z.ZodTransform<{
            poolId: string;
            protocol: AggregatorProtocol;
            lpToken: string;
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
            amountOut: string;
            minAmountOut: string;
            lpFee: string;
            dexFee: string;
            deposits: string;
            priceImpact: number;
            poolOutRef: string | null;
        }, {
            pool_id: string;
            protocol: string;
            lp_token: string;
            token_in: string;
            token_out: string;
            amount_in: string;
            amount_out: string;
            min_amount_out: string;
            lp_fee: string;
            dex_fee: string;
            deposits: string;
            price_impact: number;
            pool_out_ref?: string | null | undefined;
        }>>>>>>;
    }, z.core.$strip>, z.ZodTransform<{
        poolId: string;
        protocol: AggregatorProtocol;
        lpToken: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        lpFee: string;
        dexFee: string;
        deposits: string;
        priceImpact: number;
        poolOutRef: string | null;
        callbackPaths: {
            poolId: string;
            protocol: AggregatorProtocol;
            lpToken: string;
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
            amountOut: string;
            minAmountOut: string;
            lpFee: string;
            dexFee: string;
            deposits: string;
            priceImpact: number;
            poolOutRef: string | null;
        }[][];
    }, {
        pool_id: string;
        protocol: string;
        lp_token: string;
        token_in: string;
        token_out: string;
        amount_in: string;
        amount_out: string;
        min_amount_out: string;
        lp_fee: string;
        dex_fee: string;
        deposits: string;
        price_impact: number;
        pool_out_ref?: string | null | undefined;
        callback_paths?: {
            poolId: string;
            protocol: AggregatorProtocol;
            lpToken: string;
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
            amountOut: string;
            minAmountOut: string;
            lpFee: string;
            dexFee: string;
            deposits: string;
            priceImpact: number;
            poolOutRef: string | null;
        }[][] | null | undefined;
    }>>>>;
    aggregator_fee: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    aggregator_fee_percent: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    tokens: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodPipe<z.ZodObject<{
        token_id: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        ticker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_verified: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        price_by_ada: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        price_by_usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        project_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        decimals: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    }, {
        token_id: string;
        logo?: string | null | undefined;
        ticker?: string | null | undefined;
        is_verified?: boolean | null | undefined;
        price_by_ada?: number | null | undefined;
        price_by_usd?: number | null | undefined;
        project_name?: string | null | undefined;
        decimals?: number | null | undefined;
    }>>>>>;
    amount_in_decimal: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
}, z.core.$strip>, z.ZodTransform<{
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    /** Worst acceptable output after slippage — pass to {@link AggregatorModule.buildTx}. */
    minAmountOut: string;
    totalLpFee: string;
    totalDexFee: string;
    deposits: string;
    avgPriceImpact: number;
    /**
     * Split routes: the outer array is parallel splits of the input, the inner
     * array is the sequential hops of one split.
     */
    paths: {
        poolId: string;
        protocol: AggregatorProtocol;
        lpToken: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        lpFee: string;
        dexFee: string;
        deposits: string;
        priceImpact: number;
        poolOutRef: string | null;
        callbackPaths: {
            poolId: string;
            protocol: AggregatorProtocol;
            lpToken: string;
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
            amountOut: string;
            minAmountOut: string;
            lpFee: string;
            dexFee: string;
            deposits: string;
            priceImpact: number;
            poolOutRef: string | null;
        }[][];
    }[][];
    aggregatorFee: string | null;
    aggregatorFeePercent: number | null;
    /** Metadata for every token mentioned, keyed by `coinId`. */
    tokens: {
        [k: string]: {
            coinId: string;
            logo: string | null;
            ticker: string | null;
            isVerified: boolean | null;
            priceByAda: number | null;
            priceByUsd: number | null;
            projectName: string | null;
            decimals: number | null;
        };
    };
    amountInDecimal: boolean;
}, {
    token_in: string;
    token_out: string;
    amount_in: string;
    amount_out: string;
    min_amount_out: string;
    total_lp_fee: string;
    total_dex_fee: string;
    deposits: string;
    avg_price_impact: number;
    paths: {
        poolId: string;
        protocol: AggregatorProtocol;
        lpToken: string;
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        minAmountOut: string;
        lpFee: string;
        dexFee: string;
        deposits: string;
        priceImpact: number;
        poolOutRef: string | null;
        callbackPaths: {
            poolId: string;
            protocol: AggregatorProtocol;
            lpToken: string;
            tokenIn: string;
            tokenOut: string;
            amountIn: string;
            amountOut: string;
            minAmountOut: string;
            lpFee: string;
            dexFee: string;
            deposits: string;
            priceImpact: number;
            poolOutRef: string | null;
        }[][];
    }[][];
    aggregator_fee?: string | null | undefined;
    aggregator_fee_percent?: number | null | undefined;
    tokens?: Record<string, {
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    }> | null | undefined;
    amount_in_decimal?: boolean | null | undefined;
}>>;
type AggregatorEstimate = z.infer<typeof estimateSchema>;
declare const pendingOrderSchema: z.ZodPipe<z.ZodObject<{
    owner_address: z.ZodString;
    protocol: z.ZodString;
    token_in: z.ZodPipe<z.ZodObject<{
        token_id: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        ticker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_verified: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        price_by_ada: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        price_by_usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        project_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        decimals: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    }, {
        token_id: string;
        logo?: string | null | undefined;
        ticker?: string | null | undefined;
        is_verified?: boolean | null | undefined;
        price_by_ada?: number | null | undefined;
        price_by_usd?: number | null | undefined;
        project_name?: string | null | undefined;
        decimals?: number | null | undefined;
    }>>;
    token_out: z.ZodPipe<z.ZodObject<{
        token_id: z.ZodString;
        logo: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        ticker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        is_verified: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        price_by_ada: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        price_by_usd: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        project_name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        decimals: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    }, {
        token_id: string;
        logo?: string | null | undefined;
        ticker?: string | null | undefined;
        is_verified?: boolean | null | undefined;
        price_by_ada?: number | null | undefined;
        price_by_usd?: number | null | undefined;
        project_name?: string | null | undefined;
        decimals?: number | null | undefined;
    }>>;
    amount_in: z.ZodString;
    min_amount_out: z.ZodString;
    created_at: z.ZodNumber;
    tx_in: z.ZodString;
    dex_fee: z.ZodString;
    deposit: z.ZodString;
}, z.core.$strip>, z.ZodTransform<{
    ownerAddress: string;
    protocol: AggregatorProtocol;
    tokenIn: {
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    };
    tokenOut: {
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    };
    amountIn: string;
    minAmountOut: string;
    /** Epoch seconds. */
    createdAt: number;
    /** The order's UTxO reference, `txHash#index` — pass to {@link AggregatorModule.cancelOrders}. */
    txIn: string;
    dexFee: string;
    deposit: string;
}, {
    owner_address: string;
    protocol: string;
    token_in: {
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    };
    token_out: {
        coinId: string;
        logo: string | null;
        ticker: string | null;
        isVerified: boolean | null;
        priceByAda: number | null;
        priceByUsd: number | null;
        projectName: string | null;
        decimals: number | null;
    };
    amount_in: string;
    min_amount_out: string;
    created_at: number;
    tx_in: string;
    dex_fee: string;
    deposit: string;
}>>;
type PendingOrder = z.infer<typeof pendingOrderSchema>;
/** Parameters shared by {@link AggregatorModule.estimate} and the estimate echoed into build-tx. */
type EstimateParams = {
    /**
     * Input amount. Raw base units by default; a decimal figure when
     * {@link EstimateParams.amountInDecimal} is set.
     */
    amount: string;
    /** Input token as a `coinId` (`policyId.assetNameHex`, or `lovelace`). */
    tokenIn: string;
    /** Output token as a `coinId`. */
    tokenOut: string;
    /** Slippage tolerance, in percent. */
    slippage: number;
    includeProtocols?: AggregatorProtocol[];
    excludeProtocols?: AggregatorProtocol[];
    allowMultiHops?: boolean;
    allowNonAtomicMultiHops?: boolean;
    /** Partner code for referral fees, if you have one. */
    partner?: string;
    /** Treat `amount` and returned amounts as decimal figures rather than base units. */
    amountInDecimal?: boolean;
};
type BuildTxParams = {
    /** Address funding the swap and receiving the output. */
    sender: string;
    /** The same parameters passed to {@link AggregatorModule.estimate}. */
    estimate: EstimateParams;
    /**
     * Minimum acceptable output. Take this from the estimate's `minAmountOut`, or
     * set a stricter value. The server rejects anything below its own recomputed
     * minimum.
     */
    minAmountOut: string;
    /** An additional output, e.g. a wallet's own fee. */
    extraOutput?: {
        address: string;
        lovelace: string;
    };
    /**
     * Specific wallet UTxOs to spend, as CBOR hex. Omit to let the server choose
     * from the sender's UTxOs — unlike farm and staking, the aggregator can
     * resolve them itself, so no {@link RpcProvider} is required here.
     */
    inputsToChoose?: string[];
};
type CancelOrderRef = {
    /** The order's UTxO reference, `txHash#index`. */
    txIn: string;
    protocol: CancelProtocol;
};
type GetPendingOrdersOptions = {
    /** Return amounts as decimal figures rather than base units. */
    amountInDecimal?: boolean;
};
/**
 * The aggregator: quote a swap, build its transaction, submit it, cancel open
 * orders, and list pending ones.
 *
 * The SDK never signs. `buildTx` and `cancelOrders` return unsigned CBOR;
 * `cancelOrders`' CBOR is additionally *partially signed* by the server (for
 * collateral sponsorship and fee refunds), so sign it with `partialSign` and
 * assemble the witness onto the existing one rather than replacing it.
 *
 * Token ids are `coinId`s here as everywhere else in the SDK, converted to the
 * aggregator's concatenated unit form at the request boundary.
 */
declare class AggregatorModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
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
    estimate(params: EstimateParams): Promise<AggregatorEstimate>;
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
    buildTx(params: BuildTxParams): Promise<{
        cbor: string;
    }>;
    /**
     * Assemble a signed witness onto a built transaction and submit it.
     *
     * @param witnessSet CBOR of the witness set produced by signing the tx.
     */
    submitTx(params: {
        cbor: string;
        witnessSet: string;
    }): Promise<{
        txId: string;
    }>;
    /**
     * Build a transaction that cancels one or more open orders.
     *
     * The returned CBOR is **partially signed** by the server. Between 1 and 6
     * orders per call, the server's own limit.
     */
    cancelOrders(params: {
        sender: string;
        orders: CancelOrderRef[];
    }): Promise<{
        cbor: string;
    }>;
    /**
     * List an address's still-open aggregator orders.
     *
     * Only orders whose UTxO is still unspent are returned, so this is genuinely
     * "open orders" rather than history. For full history including filled and
     * cancelled orders, use {@link OrderModule.getHistory}.
     */
    getPendingOrders(ownerAddress: string, options?: GetPendingOrdersOptions): Promise<PendingOrder[]>;
}

/**
 * Uniform pagination input.
 *
 * The backends behind this SDK use three mutually incompatible schemes —
 * offset/limit, a GET cursor keyed on `desc`, and a POST cursor keyed on
 * `before` — and mix them across endpoints that otherwise look alike. Callers
 * see only this shape; each module translates it for the endpoint it wraps.
 */
type PageParams = {
    limit?: number;
    /**
     * Opaque continuation token from a previous {@link Page.nextCursor}.
     * Do not construct or parse these; the encoding differs per endpoint.
     */
    cursor?: string;
};
type Page<T> = {
    items: T[];
    /** Pass to the next call to continue. `null` when the result set is exhausted. */
    nextCursor: string | null;
    hasMore: boolean;
};
declare function assertLimit(limit: number | undefined, max: number): void;
/** Offset-paginated endpoints carry the next offset as the opaque cursor. */
declare function encodeOffsetCursor(offset: number): string;
declare function decodeOffsetCursor(cursor: string | undefined): number;
/**
 * Build a page from an offset-based response.
 *
 * These endpoints report no total, so a full page is treated as "there may be
 * more" — the final page is detected by it coming back short (or empty).
 */
declare function offsetPage<T>(items: T[], offset: number, limit: number): Page<T>;
/**
 * Build a page from a cursor-based response.
 *
 * The backend nulls `last_cursor` on the final page *and* on an empty result
 * set, so a null cursor means end-of-stream rather than an error.
 */
declare function cursorPage<T>(items: T[], lastCursor: string | null | undefined): Page<T>;
/**
 * Walk every page of a paginated endpoint, yielding items one at a time.
 *
 * @example
 * for await (const token of paginate((p) => sdk.token.list({ ...filters, ...p }))) {
 *   console.log(token.ticker);
 * }
 */
declare function paginate<T>(fetchPage: (params: PageParams) => Promise<Page<T>>, params?: PageParams): AsyncGenerator<T, void, undefined>;
/** Collect a paginated endpoint into an array, capped to avoid unbounded reads. */
declare function collect<T>(fetchPage: (params: PageParams) => Promise<Page<T>>, options?: PageParams & {
    maxItems?: number;
}): Promise<T[]>;

declare const lpPositionSchema: z.ZodPipe<z.ZodObject<{
    protocol: z.ZodString;
    coin_a: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
    }>>;
    coin_b: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
    }>>;
    amount_a: z.ZodNumber;
    amount_b: z.ZodNumber;
    lp_amount: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    pool_share: z.ZodNumber;
    a_usd_value: z.ZodNumber;
    b_usd_value: z.ZodNumber;
    position_id: z.ZodString;
    pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fee_rate: z.ZodNumber;
    fee_rate_a: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fee_rate_b: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    pool_type: z.ZodString;
    pool_info: z.ZodPipe<z.ZodObject<{
        fee_apr_24h: z.ZodNumber;
        fee_apr_1w: z.ZodNumber;
        rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
            daily_amount: z.ZodNumber;
            daily_amount_usd: z.ZodNumber;
            apr: z.ZodNumber;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            daily_amount: number;
            daily_amount_usd: number;
            apr: number;
            coin_type?: string | null | undefined;
        }>>>>>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[], {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[] | null | undefined>>;
    }, z.core.$strip>, z.ZodTransform<{
        feeApr24h: number;
        feeApr1w: number;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
    }, {
        fee_apr_24h: number;
        fee_apr_1w: number;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
    }>>;
    total_usd_value: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    protocol: string;
    coinA: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    coinB: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    amountA: number;
    amountB: number;
    /** Decimal string, not a number. Empty for Minswap CPMM positions. */
    lpAmount: string | null;
    poolShare: number;
    aUsdValue: number;
    bUsdValue: number;
    positionId: string;
    poolId: string | null;
    feeRate: number;
    feeRateA: number | null;
    feeRateB: number | null;
    poolType: string;
    poolInfo: {
        feeApr24h: number;
        feeApr1w: number;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
    };
    totalUsdValue: number;
}, {
    protocol: string;
    coin_a: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    coin_b: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    amount_a: number;
    amount_b: number;
    pool_share: number;
    a_usd_value: number;
    b_usd_value: number;
    position_id: string;
    fee_rate: number;
    pool_type: string;
    pool_info: {
        feeApr24h: number;
        feeApr1w: number;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
    };
    total_usd_value: number;
    lp_amount?: string | null | undefined;
    pool_id?: string | null | undefined;
    fee_rate_a?: number | null | undefined;
    fee_rate_b?: number | null | undefined;
}>>;
type PortfolioLpPosition = z.infer<typeof lpPositionSchema>;
declare const farmPositionSchema: z.ZodPipe<z.ZodObject<{
    protocol: z.ZodString;
    staked_coin: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        amount: z.ZodNumber;
        usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        amount: number;
        usd_value: number;
        coin_type?: string | null | undefined;
    }>>>>;
    yield_position_id: z.ZodString;
    yield_pool_id: z.ZodString;
    yield_pending_rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        amount: z.ZodNumber;
        usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        amount: number;
        usd_value: number;
        coin_type?: string | null | undefined;
    }>>>>>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[], {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[] | null | undefined>>;
    cpmm_position: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        protocol: z.ZodString;
        coin_a: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
        }>>;
        coin_b: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
        }>>;
        amount_a: z.ZodNumber;
        amount_b: z.ZodNumber;
        lp_amount: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        pool_share: z.ZodNumber;
        a_usd_value: z.ZodNumber;
        b_usd_value: z.ZodNumber;
        position_id: z.ZodString;
        pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fee_rate: z.ZodNumber;
        fee_rate_a: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fee_rate_b: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        pool_type: z.ZodString;
        pool_info: z.ZodPipe<z.ZodObject<{
            fee_apr_24h: z.ZodNumber;
            fee_apr_1w: z.ZodNumber;
            rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
                daily_amount: z.ZodNumber;
                daily_amount_usd: z.ZodNumber;
                apr: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                daily_amount: number;
                daily_amount_usd: number;
                apr: number;
                coin_type?: string | null | undefined;
            }>>>>>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[], {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[] | null | undefined>>;
        }, z.core.$strip>, z.ZodTransform<{
            feeApr24h: number;
            feeApr1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        }, {
            fee_apr_24h: number;
            fee_apr_1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        }>>;
        total_usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        /** Decimal string, not a number. Empty for Minswap CPMM positions. */
        lpAmount: string | null;
        poolShare: number;
        aUsdValue: number;
        bUsdValue: number;
        positionId: string;
        poolId: string | null;
        feeRate: number;
        feeRateA: number | null;
        feeRateB: number | null;
        poolType: string;
        poolInfo: {
            feeApr24h: number;
            feeApr1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        };
        totalUsdValue: number;
    }, {
        protocol: string;
        coin_a: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coin_b: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amount_a: number;
        amount_b: number;
        pool_share: number;
        a_usd_value: number;
        b_usd_value: number;
        position_id: string;
        fee_rate: number;
        pool_type: string;
        pool_info: {
            feeApr24h: number;
            feeApr1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        };
        total_usd_value: number;
        lp_amount?: string | null | undefined;
        pool_id?: string | null | undefined;
        fee_rate_a?: number | null | undefined;
        fee_rate_b?: number | null | undefined;
    }>>>>;
    vault_pair_position: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        protocol: z.ZodString;
        coin_a: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
        }>>;
        coin_b: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
        }>>;
        amount_a: z.ZodNumber;
        amount_b: z.ZodNumber;
        a_usd_value: z.ZodNumber;
        b_usd_value: z.ZodNumber;
        pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        share: z.ZodNumber;
        total_usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        aUsdValue: number;
        bUsdValue: number;
        poolId: string | null;
        share: number;
        totalUsdValue: number;
    }, {
        protocol: string;
        coin_a: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coin_b: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amount_a: number;
        amount_b: number;
        a_usd_value: number;
        b_usd_value: number;
        share: number;
        total_usd_value: number;
        pool_id?: string | null | undefined;
    }>>>>;
    total_usd_value: z.ZodNumber;
    extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        script_version: z.ZodString;
        lb_whitelist_assets: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
    }, z.core.$strip>, z.ZodTransform<{
        scriptVersion: string;
        lbWhitelistAssets: string[];
    }, {
        script_version: string;
        lb_whitelist_assets: string[];
    }>>>>;
}, z.core.$strip>, z.ZodTransform<{
    protocol: string;
    /**
     * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
     * `vaultPairPosition` describes it, checked in that precedence order
     * upstream.
     */
    stakedCoin: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    } | null;
    positionId: string;
    /** Identifies the farm; pass to farm actions. */
    poolId: string;
    pendingRewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[];
    lpPosition: {
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        /** Decimal string, not a number. Empty for Minswap CPMM positions. */
        lpAmount: string | null;
        poolShare: number;
        aUsdValue: number;
        bUsdValue: number;
        positionId: string;
        poolId: string | null;
        feeRate: number;
        feeRateA: number | null;
        feeRateB: number | null;
        poolType: string;
        poolInfo: {
            feeApr24h: number;
            feeApr1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        };
        totalUsdValue: number;
    } | null;
    vaultPairPosition: {
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        aUsdValue: number;
        bUsdValue: number;
        poolId: string | null;
        share: number;
        totalUsdValue: number;
    } | null;
    totalUsdValue: number;
    extra: {
        scriptVersion: string;
        lbWhitelistAssets: string[];
    } | null;
}, {
    protocol: string;
    yield_position_id: string;
    yield_pool_id: string;
    yield_pending_rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[];
    total_usd_value: number;
    staked_coin?: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    } | null | undefined;
    cpmm_position?: {
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        /** Decimal string, not a number. Empty for Minswap CPMM positions. */
        lpAmount: string | null;
        poolShare: number;
        aUsdValue: number;
        bUsdValue: number;
        positionId: string;
        poolId: string | null;
        feeRate: number;
        feeRateA: number | null;
        feeRateB: number | null;
        poolType: string;
        poolInfo: {
            feeApr24h: number;
            feeApr1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        };
        totalUsdValue: number;
    } | null | undefined;
    vault_pair_position?: {
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        aUsdValue: number;
        bUsdValue: number;
        poolId: string | null;
        share: number;
        totalUsdValue: number;
    } | null | undefined;
    extra?: {
        scriptVersion: string;
        lbWhitelistAssets: string[];
    } | null | undefined;
}>>;
type PortfolioFarmPosition = z.infer<typeof farmPositionSchema>;
declare const stakingPositionSchema: z.ZodPipe<z.ZodObject<{
    protocol: z.ZodString;
    staked_coin: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        amount: z.ZodNumber;
        usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        amount: number;
        usd_value: number;
        coin_type?: string | null | undefined;
    }>>>>;
    staking_position_id: z.ZodString;
    staking_pool_id: z.ZodString;
    staking_pending_rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        amount: z.ZodNumber;
        usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        amount: number;
        usd_value: number;
        coin_type?: string | null | undefined;
    }>>>>>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[], {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[] | null | undefined>>;
    share: z.ZodNumber;
    total_usd_value: z.ZodNumber;
    extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        script_version: z.ZodString;
        stake_at: z.ZodString;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        multiplier: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>, z.ZodTransform<{
        scriptVersion: string;
        /** ISO-8601 string, not an epoch number. */
        stakeAt: string;
        duration: number | null;
        multiplier: number | null;
    }, {
        script_version: string;
        stake_at: string;
        duration?: number | null | undefined;
        multiplier?: number | null | undefined;
    }>>>>;
}, z.core.$strip>, z.ZodTransform<{
    protocol: string;
    stakedCoin: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    } | null;
    /** The staking UTxO reference; staking actions take this directly. */
    positionId: string;
    poolId: string;
    pendingRewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[];
    /**
     * Share of the pool. Note `0` is ambiguous upstream between "no share" and
     * "could not be computed".
     */
    share: number;
    totalUsdValue: number;
    extra: {
        scriptVersion: string;
        /** ISO-8601 string, not an epoch number. */
        stakeAt: string;
        duration: number | null;
        multiplier: number | null;
    } | null;
    /**
     * Tiered or flexible staking.
     *
     * The backend encodes this two ways and names it neither: flexible pools
     * carry a `-flexible` suffix on the pool id, and only tiered positions
     * carry `duration`/`multiplier`. Both signals are checked here so callers
     * never parse a string suffix.
     */
    kind: StakingKind;
}, {
    protocol: string;
    staking_position_id: string;
    staking_pool_id: string;
    staking_pending_rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    }[];
    share: number;
    total_usd_value: number;
    staked_coin?: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        amount: number;
        usdValue: number;
    } | null | undefined;
    extra?: {
        scriptVersion: string;
        /** ISO-8601 string, not an epoch number. */
        stakeAt: string;
        duration: number | null;
        multiplier: number | null;
    } | null | undefined;
}>>;
type StakingKind = "tiered" | "flexible";
type PortfolioStakingPosition = z.infer<typeof stakingPositionSchema>;
declare const portfolioDefiSchema: z.ZodPipe<z.ZodObject<{
    minswap: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        project_code: z.ZodString;
        project_name: z.ZodString;
        project_description: z.ZodString;
        website_url: z.ZodString;
        icon_url: z.ZodString;
        cpmm: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            protocol: z.ZodString;
            coin_a: z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                coin_type?: string | null | undefined;
            }>>;
            coin_b: z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                coin_type?: string | null | undefined;
            }>>;
            amount_a: z.ZodNumber;
            amount_b: z.ZodNumber;
            lp_amount: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            pool_share: z.ZodNumber;
            a_usd_value: z.ZodNumber;
            b_usd_value: z.ZodNumber;
            position_id: z.ZodString;
            pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            fee_rate: z.ZodNumber;
            fee_rate_a: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            fee_rate_b: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            pool_type: z.ZodString;
            pool_info: z.ZodPipe<z.ZodObject<{
                fee_apr_24h: z.ZodNumber;
                fee_apr_1w: z.ZodNumber;
                rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
                    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    symbol: z.ZodString;
                    decimals: z.ZodNumber;
                    icon_url: z.ZodString;
                    verified: z.ZodBoolean;
                    daily_amount: z.ZodNumber;
                    daily_amount_usd: z.ZodNumber;
                    apr: z.ZodNumber;
                }, z.core.$strip>, z.ZodTransform<{
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }, {
                    symbol: string;
                    decimals: number;
                    icon_url: string;
                    verified: boolean;
                    daily_amount: number;
                    daily_amount_usd: number;
                    apr: number;
                    coin_type?: string | null | undefined;
                }>>>>>, z.ZodTransform<{
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[], {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[] | null | undefined>>;
            }, z.core.$strip>, z.ZodTransform<{
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            }, {
                fee_apr_24h: number;
                fee_apr_1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            }>>;
            total_usd_value: z.ZodNumber;
        }, z.core.$strip>, z.ZodTransform<{
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        }, {
            protocol: string;
            coin_a: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coin_b: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amount_a: number;
            amount_b: number;
            pool_share: number;
            a_usd_value: number;
            b_usd_value: number;
            position_id: string;
            fee_rate: number;
            pool_type: string;
            pool_info: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            total_usd_value: number;
            lp_amount?: string | null | undefined;
            pool_id?: string | null | undefined;
            fee_rate_a?: number | null | undefined;
            fee_rate_b?: number | null | undefined;
        }>>>>>, z.ZodTransform<{
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        }[], {
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        }[] | null | undefined>>;
        yields: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            protocol: z.ZodString;
            staked_coin: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
                amount: z.ZodNumber;
                usd_value: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                amount: number;
                usd_value: number;
                coin_type?: string | null | undefined;
            }>>>>;
            yield_position_id: z.ZodString;
            yield_pool_id: z.ZodString;
            yield_pending_rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
                amount: z.ZodNumber;
                usd_value: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                amount: number;
                usd_value: number;
                coin_type?: string | null | undefined;
            }>>>>>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[], {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[] | null | undefined>>;
            cpmm_position: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                protocol: z.ZodString;
                coin_a: z.ZodPipe<z.ZodObject<{
                    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    symbol: z.ZodString;
                    decimals: z.ZodNumber;
                    icon_url: z.ZodString;
                    verified: z.ZodBoolean;
                }, z.core.$strip>, z.ZodTransform<{
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                }, {
                    symbol: string;
                    decimals: number;
                    icon_url: string;
                    verified: boolean;
                    coin_type?: string | null | undefined;
                }>>;
                coin_b: z.ZodPipe<z.ZodObject<{
                    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    symbol: z.ZodString;
                    decimals: z.ZodNumber;
                    icon_url: z.ZodString;
                    verified: z.ZodBoolean;
                }, z.core.$strip>, z.ZodTransform<{
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                }, {
                    symbol: string;
                    decimals: number;
                    icon_url: string;
                    verified: boolean;
                    coin_type?: string | null | undefined;
                }>>;
                amount_a: z.ZodNumber;
                amount_b: z.ZodNumber;
                lp_amount: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                pool_share: z.ZodNumber;
                a_usd_value: z.ZodNumber;
                b_usd_value: z.ZodNumber;
                position_id: z.ZodString;
                pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                fee_rate: z.ZodNumber;
                fee_rate_a: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                fee_rate_b: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                pool_type: z.ZodString;
                pool_info: z.ZodPipe<z.ZodObject<{
                    fee_apr_24h: z.ZodNumber;
                    fee_apr_1w: z.ZodNumber;
                    rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
                        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                        symbol: z.ZodString;
                        decimals: z.ZodNumber;
                        icon_url: z.ZodString;
                        verified: z.ZodBoolean;
                        daily_amount: z.ZodNumber;
                        daily_amount_usd: z.ZodNumber;
                        apr: z.ZodNumber;
                    }, z.core.$strip>, z.ZodTransform<{
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }, {
                        symbol: string;
                        decimals: number;
                        icon_url: string;
                        verified: boolean;
                        daily_amount: number;
                        daily_amount_usd: number;
                        apr: number;
                        coin_type?: string | null | undefined;
                    }>>>>>, z.ZodTransform<{
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[], {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[] | null | undefined>>;
                }, z.core.$strip>, z.ZodTransform<{
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                }, {
                    fee_apr_24h: number;
                    fee_apr_1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                }>>;
                total_usd_value: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            }, {
                protocol: string;
                coin_a: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coin_b: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amount_a: number;
                amount_b: number;
                pool_share: number;
                a_usd_value: number;
                b_usd_value: number;
                position_id: string;
                fee_rate: number;
                pool_type: string;
                pool_info: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                total_usd_value: number;
                lp_amount?: string | null | undefined;
                pool_id?: string | null | undefined;
                fee_rate_a?: number | null | undefined;
                fee_rate_b?: number | null | undefined;
            }>>>>;
            vault_pair_position: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                protocol: z.ZodString;
                coin_a: z.ZodPipe<z.ZodObject<{
                    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    symbol: z.ZodString;
                    decimals: z.ZodNumber;
                    icon_url: z.ZodString;
                    verified: z.ZodBoolean;
                }, z.core.$strip>, z.ZodTransform<{
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                }, {
                    symbol: string;
                    decimals: number;
                    icon_url: string;
                    verified: boolean;
                    coin_type?: string | null | undefined;
                }>>;
                coin_b: z.ZodPipe<z.ZodObject<{
                    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                    symbol: z.ZodString;
                    decimals: z.ZodNumber;
                    icon_url: z.ZodString;
                    verified: z.ZodBoolean;
                }, z.core.$strip>, z.ZodTransform<{
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                }, {
                    symbol: string;
                    decimals: number;
                    icon_url: string;
                    verified: boolean;
                    coin_type?: string | null | undefined;
                }>>;
                amount_a: z.ZodNumber;
                amount_b: z.ZodNumber;
                a_usd_value: z.ZodNumber;
                b_usd_value: z.ZodNumber;
                pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                share: z.ZodNumber;
                total_usd_value: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            }, {
                protocol: string;
                coin_a: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coin_b: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amount_a: number;
                amount_b: number;
                a_usd_value: number;
                b_usd_value: number;
                share: number;
                total_usd_value: number;
                pool_id?: string | null | undefined;
            }>>>>;
            total_usd_value: z.ZodNumber;
            extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                script_version: z.ZodString;
                lb_whitelist_assets: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
            }, z.core.$strip>, z.ZodTransform<{
                scriptVersion: string;
                lbWhitelistAssets: string[];
            }, {
                script_version: string;
                lb_whitelist_assets: string[];
            }>>>>;
        }, z.core.$strip>, z.ZodTransform<{
            protocol: string;
            /**
             * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
             * `vaultPairPosition` describes it, checked in that precedence order
             * upstream.
             */
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            positionId: string;
            /** Identifies the farm; pass to farm actions. */
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            lpPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null;
            vaultPairPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null;
        }, {
            protocol: string;
            yield_position_id: string;
            yield_pool_id: string;
            yield_pending_rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            total_usd_value: number;
            staked_coin?: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null | undefined;
            cpmm_position?: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null | undefined;
            vault_pair_position?: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null | undefined;
            extra?: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null | undefined;
        }>>>>>, z.ZodTransform<{
            protocol: string;
            /**
             * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
             * `vaultPairPosition` describes it, checked in that precedence order
             * upstream.
             */
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            positionId: string;
            /** Identifies the farm; pass to farm actions. */
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            lpPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null;
            vaultPairPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null;
        }[], {
            protocol: string;
            /**
             * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
             * `vaultPairPosition` describes it, checked in that precedence order
             * upstream.
             */
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            positionId: string;
            /** Identifies the farm; pass to farm actions. */
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            lpPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null;
            vaultPairPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null;
        }[] | null | undefined>>;
        stakings: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            protocol: z.ZodString;
            staked_coin: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
                amount: z.ZodNumber;
                usd_value: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                amount: number;
                usd_value: number;
                coin_type?: string | null | undefined;
            }>>>>;
            staking_position_id: z.ZodString;
            staking_pool_id: z.ZodString;
            staking_pending_rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
                amount: z.ZodNumber;
                usd_value: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                amount: number;
                usd_value: number;
                coin_type?: string | null | undefined;
            }>>>>>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[], {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[] | null | undefined>>;
            share: z.ZodNumber;
            total_usd_value: z.ZodNumber;
            extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                script_version: z.ZodString;
                stake_at: z.ZodString;
                duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                multiplier: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            }, z.core.$strip>, z.ZodTransform<{
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            }, {
                script_version: string;
                stake_at: string;
                duration?: number | null | undefined;
                multiplier?: number | null | undefined;
            }>>>>;
        }, z.core.$strip>, z.ZodTransform<{
            protocol: string;
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            /** The staking UTxO reference; staking actions take this directly. */
            positionId: string;
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            /**
             * Share of the pool. Note `0` is ambiguous upstream between "no share" and
             * "could not be computed".
             */
            share: number;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null;
            /**
             * Tiered or flexible staking.
             *
             * The backend encodes this two ways and names it neither: flexible pools
             * carry a `-flexible` suffix on the pool id, and only tiered positions
             * carry `duration`/`multiplier`. Both signals are checked here so callers
             * never parse a string suffix.
             */
            kind: StakingKind;
        }, {
            protocol: string;
            staking_position_id: string;
            staking_pool_id: string;
            staking_pending_rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            share: number;
            total_usd_value: number;
            staked_coin?: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null | undefined;
            extra?: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null | undefined;
        }>>>>>, z.ZodTransform<{
            protocol: string;
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            /** The staking UTxO reference; staking actions take this directly. */
            positionId: string;
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            /**
             * Share of the pool. Note `0` is ambiguous upstream between "no share" and
             * "could not be computed".
             */
            share: number;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null;
            /**
             * Tiered or flexible staking.
             *
             * The backend encodes this two ways and names it neither: flexible pools
             * carry a `-flexible` suffix on the pool id, and only tiered positions
             * carry `duration`/`multiplier`. Both signals are checked here so callers
             * never parse a string suffix.
             */
            kind: StakingKind;
        }[], {
            protocol: string;
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            /** The staking UTxO reference; staking actions take this directly. */
            positionId: string;
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            /**
             * Share of the pool. Note `0` is ambiguous upstream between "no share" and
             * "could not be computed".
             */
            share: number;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null;
            /**
             * Tiered or flexible staking.
             *
             * The backend encodes this two ways and names it neither: flexible pools
             * carry a `-flexible` suffix on the pool id, and only tiered positions
             * carry `duration`/`multiplier`. Both signals are checked here so callers
             * never parse a string suffix.
             */
            kind: StakingKind;
        }[] | null | undefined>>;
        total_usd_value: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        projectCode: string;
        projectName: string;
        projectDescription: string;
        websiteUrl: string;
        iconUrl: string;
        lp: {
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        }[];
        farms: {
            protocol: string;
            /**
             * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
             * `vaultPairPosition` describes it, checked in that precedence order
             * upstream.
             */
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            positionId: string;
            /** Identifies the farm; pass to farm actions. */
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            lpPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null;
            vaultPairPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null;
        }[];
        stakings: {
            protocol: string;
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            /** The staking UTxO reference; staking actions take this directly. */
            positionId: string;
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            /**
             * Share of the pool. Note `0` is ambiguous upstream between "no share" and
             * "could not be computed".
             */
            share: number;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null;
            /**
             * Tiered or flexible staking.
             *
             * The backend encodes this two ways and names it neither: flexible pools
             * carry a `-flexible` suffix on the pool id, and only tiered positions
             * carry `duration`/`multiplier`. Both signals are checked here so callers
             * never parse a string suffix.
             */
            kind: StakingKind;
        }[];
        totalUsdValue: number;
    }, {
        project_code: string;
        project_name: string;
        project_description: string;
        website_url: string;
        icon_url: string;
        cpmm: {
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        }[];
        yields: {
            protocol: string;
            /**
             * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
             * `vaultPairPosition` describes it, checked in that precedence order
             * upstream.
             */
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            positionId: string;
            /** Identifies the farm; pass to farm actions. */
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            lpPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null;
            vaultPairPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null;
        }[];
        stakings: {
            protocol: string;
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            /** The staking UTxO reference; staking actions take this directly. */
            positionId: string;
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            /**
             * Share of the pool. Note `0` is ambiguous upstream between "no share" and
             * "could not be computed".
             */
            share: number;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null;
            /**
             * Tiered or flexible staking.
             *
             * The backend encodes this two ways and names it neither: flexible pools
             * carry a `-flexible` suffix on the pool id, and only tiered positions
             * carry `duration`/`multiplier`. Both signals are checked here so callers
             * never parse a string suffix.
             */
            kind: StakingKind;
        }[];
        total_usd_value: number;
    }>>>>;
    total_usd_value: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    /** Absent upstream when the wallet holds no Minswap position at all. */
    lp: {
        protocol: string;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amountA: number;
        amountB: number;
        /** Decimal string, not a number. Empty for Minswap CPMM positions. */
        lpAmount: string | null;
        poolShare: number;
        aUsdValue: number;
        bUsdValue: number;
        positionId: string;
        poolId: string | null;
        feeRate: number;
        feeRateA: number | null;
        feeRateB: number | null;
        poolType: string;
        poolInfo: {
            feeApr24h: number;
            feeApr1w: number;
            rewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                dailyAmount: number;
                dailyAmountUsd: number;
                apr: number;
            }[];
        };
        totalUsdValue: number;
    }[];
    farms: {
        protocol: string;
        /**
         * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
         * `vaultPairPosition` describes it, checked in that precedence order
         * upstream.
         */
        stakedCoin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            amount: number;
            usdValue: number;
        } | null;
        positionId: string;
        /** Identifies the farm; pass to farm actions. */
        poolId: string;
        pendingRewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            amount: number;
            usdValue: number;
        }[];
        lpPosition: {
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        } | null;
        vaultPairPosition: {
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            aUsdValue: number;
            bUsdValue: number;
            poolId: string | null;
            share: number;
            totalUsdValue: number;
        } | null;
        totalUsdValue: number;
        extra: {
            scriptVersion: string;
            lbWhitelistAssets: string[];
        } | null;
    }[];
    stakings: {
        protocol: string;
        stakedCoin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            amount: number;
            usdValue: number;
        } | null;
        /** The staking UTxO reference; staking actions take this directly. */
        positionId: string;
        poolId: string;
        pendingRewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            amount: number;
            usdValue: number;
        }[];
        /**
         * Share of the pool. Note `0` is ambiguous upstream between "no share" and
         * "could not be computed".
         */
        share: number;
        totalUsdValue: number;
        extra: {
            scriptVersion: string;
            /** ISO-8601 string, not an epoch number. */
            stakeAt: string;
            duration: number | null;
            multiplier: number | null;
        } | null;
        /**
         * Tiered or flexible staking.
         *
         * The backend encodes this two ways and names it neither: flexible pools
         * carry a `-flexible` suffix on the pool id, and only tiered positions
         * carry `duration`/`multiplier`. Both signals are checked here so callers
         * never parse a string suffix.
         */
        kind: StakingKind;
    }[];
    project: {
        code: string;
        name: string;
        description: string;
        websiteUrl: string;
        iconUrl: string;
    } | null;
    minswapUsdValue: number;
    totalUsdValue: number;
}, {
    total_usd_value: number;
    minswap?: {
        projectCode: string;
        projectName: string;
        projectDescription: string;
        websiteUrl: string;
        iconUrl: string;
        lp: {
            protocol: string;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amountA: number;
            amountB: number;
            /** Decimal string, not a number. Empty for Minswap CPMM positions. */
            lpAmount: string | null;
            poolShare: number;
            aUsdValue: number;
            bUsdValue: number;
            positionId: string;
            poolId: string | null;
            feeRate: number;
            feeRateA: number | null;
            feeRateB: number | null;
            poolType: string;
            poolInfo: {
                feeApr24h: number;
                feeApr1w: number;
                rewards: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                    dailyAmount: number;
                    dailyAmountUsd: number;
                    apr: number;
                }[];
            };
            totalUsdValue: number;
        }[];
        farms: {
            protocol: string;
            /**
             * The staked principal. Exactly one of `stakedCoin`, `lpPosition`, or
             * `vaultPairPosition` describes it, checked in that precedence order
             * upstream.
             */
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            positionId: string;
            /** Identifies the farm; pass to farm actions. */
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            lpPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                /** Decimal string, not a number. Empty for Minswap CPMM positions. */
                lpAmount: string | null;
                poolShare: number;
                aUsdValue: number;
                bUsdValue: number;
                positionId: string;
                poolId: string | null;
                feeRate: number;
                feeRateA: number | null;
                feeRateB: number | null;
                poolType: string;
                poolInfo: {
                    feeApr24h: number;
                    feeApr1w: number;
                    rewards: {
                        coinId: string | null;
                        symbol: string;
                        decimals: number;
                        iconUrl: string;
                        verified: boolean;
                        dailyAmount: number;
                        dailyAmountUsd: number;
                        apr: number;
                    }[];
                };
                totalUsdValue: number;
            } | null;
            vaultPairPosition: {
                protocol: string;
                coinA: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                coinB: {
                    coinId: string | null;
                    symbol: string;
                    decimals: number;
                    iconUrl: string;
                    verified: boolean;
                };
                amountA: number;
                amountB: number;
                aUsdValue: number;
                bUsdValue: number;
                poolId: string | null;
                share: number;
                totalUsdValue: number;
            } | null;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                lbWhitelistAssets: string[];
            } | null;
        }[];
        stakings: {
            protocol: string;
            stakedCoin: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            } | null;
            /** The staking UTxO reference; staking actions take this directly. */
            positionId: string;
            poolId: string;
            pendingRewards: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
                amount: number;
                usdValue: number;
            }[];
            /**
             * Share of the pool. Note `0` is ambiguous upstream between "no share" and
             * "could not be computed".
             */
            share: number;
            totalUsdValue: number;
            extra: {
                scriptVersion: string;
                /** ISO-8601 string, not an epoch number. */
                stakeAt: string;
                duration: number | null;
                multiplier: number | null;
            } | null;
            /**
             * Tiered or flexible staking.
             *
             * The backend encodes this two ways and names it neither: flexible pools
             * carry a `-flexible` suffix on the pool id, and only tiered positions
             * carry `duration`/`multiplier`. Both signals are checked here so callers
             * never parse a string suffix.
             */
            kind: StakingKind;
        }[];
        totalUsdValue: number;
    } | null | undefined;
}>>;
type PortfolioDefi = z.infer<typeof portfolioDefiSchema>;
type PortfolioGetDefiOptions = {
    /** Query the address verbatim rather than resolving its stake key. */
    directAddress?: boolean;
    currency?: MinswapCurrency;
};
/**
 * A wallet's positions across Minswap: liquidity, farms, and MIN staking.
 *
 * This is the only source of position data — there are no dedicated farm- or
 * staking-position endpoints — so the farm and staking modules read from here
 * too.
 */
declare class PortfolioModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    /**
     * Fetch every Minswap position held by an address.
     *
     * @param address A Cardano payment or stake address.
     */
    getDefi(address: string, options?: PortfolioGetDefiOptions): Promise<PortfolioDefi>;
}

/**
 * Wallet inputs the farm and staking mutations require.
 *
 * `inputsToChoose` are the wallet's UTxOs as CBOR hex, used to fund and balance
 * the transaction. `collateralUtxos` are pure-ADA UTxOs the server needs when
 * the transaction spends a script (every action except a first deposit).
 */
type ResolvedWalletInputs = {
    inputsToChoose: string[];
    collateralUtxos: string[];
};
type WalletInputParams = {
    /** The wallet address whose UTxOs fund the action. */
    address: string;
    /**
     * Wallet UTxOs as CBOR hex, overriding what the {@link RpcProvider} would
     * fetch. Supply this (with {@link WalletInputParams.collateralUtxos} when the
     * action needs collateral) to skip chain access entirely.
     */
    inputsToChoose?: string[];
    /** Collateral UTxOs as CBOR hex, overriding the provider's selection. */
    collateralUtxos?: string[];
};
/**
 * Resolve the UTxOs an action needs, from explicit overrides or the configured
 * {@link RpcProvider}.
 *
 * The provider is consulted only when an override is missing, and only farm and
 * staking actions ever reach here — which is why {@link MinswapSdkConfig.rpcProvider}
 * can stay optional. When it is needed and absent, the error names it.
 */
declare function resolveWalletInputs(sdk: MinswapSdk, action: string, params: WalletInputParams, needCollateral: boolean): Promise<ResolvedWalletInputs>;
/** GraphQL's `BigInt` scalar travels as a decimal string; accept either form. */
declare function toBigIntString(value: bigint | number | string): string;

/** Yield-farming protocols the app API indexes. */
declare const FARM_PROTOCOLS: readonly ["minswap-cpmm-v1", "minswap-cpmm-v2", "minswap-stable-cpmm-v1"];
type FarmProtocol = (typeof FARM_PROTOCOLS)[number];
declare const FARM_LIST_SORT_FIELDS: readonly ["liquidity_locked_usd", "fee_apr_24h", "fee_apr_1w", "reward_apr", "total_apr_24h", "total_apr_1w", "point"];
type FarmListSortField = (typeof FARM_LIST_SORT_FIELDS)[number];
declare const farmSchema: z.ZodPipe<z.ZodObject<{
    pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    protocol: z.ZodString;
    coin_a: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
        category?: string | null | undefined;
    }>>;
    coin_b: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
        category?: string | null | undefined;
    }>>;
    amount_a_locked: z.ZodNumber;
    amount_b_locked: z.ZodNumber;
    amount_a_locked_usd: z.ZodNumber;
    amount_b_locked_usd: z.ZodNumber;
    price_a: z.ZodNumber;
    price_b: z.ZodNumber;
    liquidity_locked: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    liquidity_locked_usd: z.ZodNumber;
    fee_apr_24h: z.ZodNumber;
    fee_apr_1w: z.ZodNumber;
    rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        daily_amount: z.ZodNumber;
        daily_amount_usd: z.ZodNumber;
        apr: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        daily_amount: number;
        daily_amount_usd: number;
        apr: number;
        coin_type?: string | null | undefined;
    }>>>>>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[], {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[] | null | undefined>>;
    active: z.ZodBoolean;
    pool_type: z.ZodString;
    point: z.ZodNumber;
    is_exclusive: z.ZodBoolean;
    nft_id_allowed: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>, z.ZodTransform<{
    /** The farm's LP token id. This is the `lpAsset` the action methods need. */
    poolId: string | null;
    protocol: string;
    coinA: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    coinB: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    amountALocked: number;
    amountBLocked: number;
    amountALockedUsd: number;
    amountBLockedUsd: number;
    priceA: number;
    priceB: number;
    /** Total staked liquidity, a raw decimal string. */
    liquidityLocked: string | null;
    liquidityLockedUsd: number;
    feeApr24h: number;
    feeApr1w: number;
    rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    active: boolean;
    poolType: string;
    point: number;
    /** Whether this is a Launch Bowl (exclusive) farm — the `hasLBBonus` flag. */
    isExclusive: boolean;
    nftIdAllowed: string | null;
}, {
    protocol: string;
    coin_a: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    coin_b: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    amount_a_locked: number;
    amount_b_locked: number;
    amount_a_locked_usd: number;
    amount_b_locked_usd: number;
    price_a: number;
    price_b: number;
    liquidity_locked_usd: number;
    fee_apr_24h: number;
    fee_apr_1w: number;
    rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    active: boolean;
    pool_type: string;
    point: number;
    is_exclusive: boolean;
    pool_id?: string | null | undefined;
    liquidity_locked?: string | null | undefined;
    nft_id_allowed?: string | null | undefined;
}>>;
type FarmSummary = z.infer<typeof farmSchema>;
type FarmListParams = PageParams & {
    poolIds?: string[];
    protocols?: FarmProtocol[];
    /** Filters to farms containing these coins. Upstream accepts at most two. */
    coinIds?: string[];
    /** Only Launch Bowl (exclusive) farms. */
    exclusiveOnly?: boolean;
    active?: boolean;
    search?: string;
    /** @default "liquidity_locked_usd" */
    sortBy?: FarmListSortField;
    /** @default "desc" */
    order?: "asc" | "desc";
    currency?: MinswapCurrency;
};
/** Identifies which farm an action targets. Comes straight from {@link FarmSummary}. */
type FarmRef = {
    /** The farm's LP token id ({@link FarmSummary.poolId}). */
    lpAsset: string;
    /** Whether it is a Launch Bowl farm ({@link FarmSummary.isExclusive}). */
    hasLBBonus: boolean;
};
type FarmDepositParams = WalletInputParams & FarmRef & {
    /** LP amount to stake, in raw base units. */
    amount: bigint | number | string;
    /**
     * Skip the position lookup by supplying it.
     *
     * `deposit` first checks whether a position exists to choose between a first
     * deposit and adding to an existing stake. Passing this (or `null` to assert
     * there is none) avoids the extra portfolio round trip.
     */
    position?: PortfolioFarmPosition | null;
    /** Launch Bowl NFT `coinId`s to whitelist, for exclusive farms. */
    lbWhitelistAssets?: string[];
    /** Split change into smaller UTxOs. Mirrors the app's setting. */
    shouldSplitChange?: boolean;
};
type FarmWithdrawParams = WalletInputParams & FarmRef & {
    /** LP amount to withdraw, in raw base units. Withdrawing the full stake routes to withdraw-all. */
    amount: bigint | number | string;
    position?: PortfolioFarmPosition | null;
    shouldSplitChange?: boolean;
};
type FarmHarvestParams = WalletInputParams & {
    /** One or more farms to harvest rewards from. */
    farms: FarmRef[];
    shouldSplitChange?: boolean;
};
type FarmEmergencyWithdrawParams = WalletInputParams & FarmRef;
/**
 * Yield farming: browse farms, read positions, and build stake/withdraw/harvest
 * transactions.
 *
 * Reads come from the app API; actions go through the key-app-api GraphQL host,
 * which builds and **partially signs** the transaction with Minswap-held keys —
 * these transactions cannot be built client-side. Every returned `cbor` must be
 * signed with `partialSign` and assembled onto the server's witness.
 *
 * Actions need the wallet's UTxOs. Pass an `address` and the SDK resolves them
 * through the configured {@link RpcProvider}, or pass `inputsToChoose` /
 * `collateralUtxos` directly to avoid chain access.
 */
declare class FarmModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    /** List farms with filtering and sorting. */
    list(params?: FarmListParams): Promise<Page<FarmSummary>>;
    /** An address's farm positions. Sourced from the DeFi portfolio. */
    getPositions(address: string): Promise<PortfolioFarmPosition[]>;
    /**
     * Stake LP tokens into a farm.
     *
     * Routes to a first deposit when the address holds no position in the farm,
     * or adds to the existing stake otherwise. The distinction is resolved from
     * the address's positions unless {@link FarmDepositParams.position} is given.
     */
    deposit(params: FarmDepositParams): Promise<{
        cbor: string;
    }>;
    /**
     * Withdraw staked LP tokens.
     *
     * Routes to withdraw-all when the amount is the entire stake, or a partial
     * withdrawal otherwise, comparing against the position's staked amount.
     */
    withdraw(params: FarmWithdrawParams): Promise<{
        cbor: string;
    }>;
    /** Harvest pending rewards from one or more farms in a single transaction. */
    harvest(params: FarmHarvestParams): Promise<{
        cbor: string;
    }>;
    /**
     * Force-withdraw a stake, forfeiting pending rewards.
     *
     * A safety valve for when a normal withdrawal cannot proceed. Prefer
     * {@link FarmModule.withdraw}.
     */
    emergencyWithdraw(params: FarmEmergencyWithdrawParams): Promise<{
        cbor: string;
    }>;
    private farmTx;
    private findPosition;
}

/**
 * Two token-identifier conventions coexist across Minswap's backends:
 *
 * - The **app API** uses a dotted `coinId`: `policyIdHex.assetNameHex`, a bare
 *   `policyIdHex` when the asset name is empty, or `lovelace` for ADA.
 * - The **aggregator** uses a concatenated *unit*: `policyIdHex + assetNameHex`
 *   with no separator, or `lovelace`.
 *
 * The SDK speaks the dotted `coinId` everywhere so callers learn one convention.
 * These converters bridge to the aggregator's form at that boundary.
 *
 * A Cardano policy id is always 28 bytes — 56 hex characters — so the split
 * point between policy and asset name is fixed, which makes the round trip
 * unambiguous.
 */
/** Dotted `coinId` (or bare policy / `lovelace`) to the aggregator's concatenated unit. */
declare function coinIdToAssetUnit(coinId: string): string;
/** The aggregator's concatenated unit back to a dotted `coinId`. */
declare function assetUnitToCoinId(unit: string): string;
/**
 * A coin's policy id and asset name as separate hex fields.
 *
 * The GraphQL mutations take assets in this split `InputAsset` shape rather than
 * as a single id.
 */
type InputAsset = {
    currencySymbol: string;
    tokenName: string;
};
/** Split a dotted `coinId` into an `InputAsset`. */
declare function coinIdToInputAsset(coinId: string): InputAsset;
/** Join a split `InputAsset` back into a dotted `coinId`. */
declare function inputAssetToCoinId(asset: InputAsset): string;

/**
 * Plain-object Plutus data, shaped exactly as `@minswap/internal-sdk`'s
 * `PlutusData` union so an encoded value can be handed straight to its
 * `PlutusData.toDataHex` serializer. Keeping the model here — rather than
 * importing the optional peer's types — lets the datum encoders be pure,
 * dependency-free, and unit-testable without the WASM serializer present.
 *
 * The canonical on-chain encoding these produce (constructor tag 121+i for
 * i≤6, 1280+(i-7) for 7..127; indefinite-length arrays for non-empty fields)
 * is fixed by the ledger, so the byte output is stable regardless of who
 * serializes it.
 */
type PlutusData = PlutusConstr | PlutusInt | PlutusBytes | PlutusList;
/** `constructor` is the on-chain alternative index; it shadows Object.prototype.constructor as an own property, which the serializer reads. */
type PlutusConstr = {
    constructor: number;
    fields: PlutusData[];
};
type PlutusInt = {
    int: string;
};
type PlutusBytes = {
    bytes: string;
};
type PlutusList = {
    list: PlutusData[];
};

type PoolReserves = {
    reserveA: bigint;
    reserveB: bigint;
    totalLiquidity: bigint;
    feeANumerator: bigint;
    feeBNumerator: bigint;
};

/**
 * On-chain state of a Minswap pool, read from the app GraphQL `appliedPoolsBy*`
 * queries. Used to quote liquidity operations (deposit/withdraw/zap) against the
 * live reserves without the SDK needing its own chain access — the query returns
 * the pool UTxO's Plutus datum (and value) and this module decodes it per
 * protocol version.
 */
type PoolVersion = "V1" | "V2" | "STABLESWAP";
/** A coin as split policy id + hex asset name (ADA is both empty strings). */
type PoolAsset = {
    policyId: string;
    nameHex: string;
};
/** V2 pool state: reserves + total liquidity + per-side fee numerators (all from the datum). */
type V2PoolState = {
    kind: "V2";
} & PoolReserves;
/** V1 pool state: reserves from the pool value, total liquidity from the datum. */
type V1PoolState = {
    kind: "V1";
    reserveA: bigint;
    reserveB: bigint;
    totalLiquidity: bigint;
};
/** Stableswap pool state: balances, total liquidity, and amplification — all from the datum. */
type StableswapPoolState = {
    kind: "STABLESWAP";
    balances: bigint[];
    totalLiquidity: bigint;
    amp: bigint;
};
type PoolState = V2PoolState | V1PoolState | StableswapPoolState;
type AppliedPool = {
    version: PoolVersion;
    lpAsset: PoolAsset;
    assetA: PoolAsset;
    assetB: PoolAsset;
    /** Decoded pool state, discriminated by `kind` (matches `version`). */
    state: PoolState;
    /** The pool UTxO reference, `txHash#index`. */
    utxoRef: string;
    /** The pool script address the UTxO sits at. */
    poolAddress: string;
    /** The pool datum as CBOR hex, exactly as returned. */
    rawDatum: string;
    /**
     * Decimals per coin, keyed by `coinId` — for converting decimal-normalized
     * token amounts to raw base units. ADA (`lovelace`) is always 6; a token with
     * no on-chain metadata is absent (its decimals are unknown). LP tokens are not
     * included: LP amounts are always raw.
     */
    decimals: Record<string, number>;
};
/** An unordered pair of coins, the `InputPair` GraphQL input. */
type InputPair = {
    assetA: InputAsset;
    assetB: InputAsset;
};
/** Fetch pool state by LP asset (the pool's LP token identifies it uniquely). */
declare function getAppliedPoolsByLpAssets(client: AppGraphqlClient, lpAssets: InputAsset[]): Promise<AppliedPool[]>;
/** Fetch pool state by asset pair. `appliedPoolsByPairs` returns the top pool per pair. */
declare function getAppliedPoolsByPairs(client: AppGraphqlClient, pairs: InputPair[]): Promise<AppliedPool[]>;

/**
 * A pool to operate on, identified either by its LP token `coinId` (always
 * unambiguous), or by its unordered coin pair. A pair can match several pools
 * across versions (e.g. an ADA/MIN V2 pool *and* a V1 pool) — pass `version` to
 * pick one, or use the LP token for exactness.
 */
type LiquidityPoolRef = string | {
    assetA: string;
    assetB: string;
    version?: PoolVersion;
};
type WalletInput = {
    /** Base bech32 address funding the order and receiving change. */
    sender: string;
    /** Wallet UTxOs as CBOR hex, overriding the configured `RpcProvider`. */
    walletUtxoCbors?: string[];
};
/** An amount in raw base units, or — with the matching `*InDecimal` flag — a decimal-normalized figure (e.g. `"1.5"`). */
type Amount = bigint | number | string;
type AddLiquidityParams = WalletInput & {
    pool: LiquidityPoolRef;
    /** Amount to deposit per coin, keyed by `coinId`. A one-sided entry is a zap-in. */
    amounts: Record<string, Amount>;
    /** Slippage tolerance, percent. */
    slippage: number;
    /** Treat `amounts` as decimal-normalized figures (converted using each coin's decimals) rather than raw base units. */
    amountsInDecimal?: boolean;
};
type ZapInParams = WalletInput & {
    pool: LiquidityPoolRef;
    /** The single coin to deposit, as a `coinId`. */
    assetIn: string;
    amountIn: Amount;
    slippage: number;
    /** Treat `amountIn` as a decimal-normalized figure rather than raw base units. */
    amountInDecimal?: boolean;
};
type RemoveLiquidityParams = WalletInput & {
    pool: LiquidityPoolRef;
    /** LP tokens to burn, always in raw base units (LP tokens are never decimal-normalized). */
    lpAmount: bigint | number | string;
    slippage: number;
    /**
     * Receive a single coin (`coinId`) instead of both sides — a zap-out. Omit for
     * a two-sided withdraw at the pool ratio. (V1 pools do not support zap-out.)
     */
    assetOut?: string;
};
type ZapOutParams = WalletInput & {
    pool: LiquidityPoolRef;
    /** LP tokens to burn, always in raw base units (LP tokens are never decimal-normalized). */
    lpAmount: bigint | number | string;
    /** The single coin to receive, as a `coinId`. */
    assetOut: string;
    slippage: number;
};
/**
 * Liquidity operations — add, remove, zap-in, zap-out — across DEX V2, DEX V1,
 * and Stableswap pools, built client-side and returned as unsigned CBOR (the SDK
 * never signs).
 *
 * The caller supplies only the pool (an LP token or a coin pair), amounts, and
 * slippage: the pool's version and on-chain state (reserves / balances / total
 * liquidity / fee) are fetched and decoded from the app GraphQL, all minimums are
 * computed from it, and the wallet's UTxOs are drawn from the configured
 * `RpcProvider`. Building the transaction requires the optional
 * `@minswap/internal-sdk` peer (Node-only).
 */
declare class LiquidityModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    addLiquidity(params: AddLiquidityParams): Promise<{
        cbor: string;
    }>;
    /** One-sided deposit. Routes through the version's correct on-chain step. */
    zapIn(params: ZapInParams): Promise<{
        cbor: string;
    }>;
    /**
     * Withdraw liquidity. Two-sided by default; pass `assetOut` to receive a single
     * coin instead (a zap-out) — the mirror of a one-sided {@link addLiquidity}.
     */
    removeLiquidity(params: RemoveLiquidityParams): Promise<{
        cbor: string;
    }>;
    /** One-sided withdraw. A convenience wrapper over {@link removeLiquidity} with `assetOut`. */
    zapOut(params: ZapOutParams): Promise<{
        cbor: string;
    }>;
    private withdrawOneSide;
    private resolvePool;
    private walletUtxos;
    /** The deposit amount for `coinId` in raw base units; `0` when the coin is not supplied. */
    private depositAmount;
    private toRaw;
}
/**
 * Convert a decimal-normalized amount to raw base units by shifting the decimal
 * point `decimals` places — done on the string form so no float precision is
 * lost. An integer input (bigint) is a whole number of tokens.
 */
declare function decimalToRaw(value: Amount, decimals: number): bigint;

declare const ORDER_STATUSES: readonly ["pending", "partially_filled", "filled", "cancelled"];
type OrderStatus = (typeof ORDER_STATUSES)[number];
/**
 * Marker for orders placed directly rather than through an aggregator.
 *
 * The backend treats this value specially: it matches a null source rather
 * than comparing equality, which is why it is not simply an empty string.
 */
declare const ORDER_SOURCE_DIRECT = "direct";
declare const orderExtraSchema: z.ZodPipe<z.ZodObject<{
    expired_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    max_cancelling_tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    killable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    limit_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    limit_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    stop_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    stop_loss_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    routes: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
    max_hop_count: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    min_fill_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    lp_asset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>, z.ZodTransform<{
    expiredAt: string | null;
    /** Already normalized to ADA by the backend, despite being a string on-chain. */
    maxCancellingTip: number | null;
    killable: boolean | null;
    limitAmount: number | null;
    /** Stays a string upstream; not converted. */
    limitRate: string | null;
    stopAmount: number | null;
    stopLossRate: string | null;
    routes: string[];
    maxHopCount: number | null;
    minFillAmount: number | null;
    lpAsset: string | null;
}, {
    routes: string[];
    expired_at?: string | null | undefined;
    max_cancelling_tip?: number | null | undefined;
    killable?: boolean | null | undefined;
    limit_amount?: number | null | undefined;
    limit_rate?: string | null | undefined;
    stop_amount?: number | null | undefined;
    stop_loss_rate?: string | null | undefined;
    max_hop_count?: number | null | undefined;
    min_fill_amount?: number | null | undefined;
    lp_asset?: string | null | undefined;
}>>;
type OrderExtra = z.infer<typeof orderExtraSchema>;
declare const orderFillSchema: z.ZodPipe<z.ZodObject<{
    amount_a: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
    amount_b: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
    lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
    tx_digest: z.ZodString;
    block: z.ZodNumber;
    filled_at: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    amountA: number;
    amountB: number;
    lpAmount: number;
    txHash: string;
    block: number;
    /** Epoch milliseconds. */
    filledAt: number;
}, {
    amount_a: number;
    amount_b: number;
    lp_amount: number;
    tx_digest: string;
    block: number;
    filled_at: number;
}>>;
type OrderFill = z.infer<typeof orderFillSchema>;
declare const orderHopSchema: z.ZodPipe<z.ZodObject<{
    type: z.ZodString;
    order_ref: z.ZodString;
    protocol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    coin_a: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
    }>>;
    coin_b: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
    }>>;
    a_to_b: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    amount_a: z.ZodNumber;
    amount_b: z.ZodNumber;
    lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
    batcher_fee: z.ZodNumber;
    deposit_ada: z.ZodNumber;
    extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        expired_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        max_cancelling_tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        killable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        limit_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        limit_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        stop_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        stop_loss_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        routes: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
        max_hop_count: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        min_fill_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        lp_asset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        expiredAt: string | null;
        /** Already normalized to ADA by the backend, despite being a string on-chain. */
        maxCancellingTip: number | null;
        killable: boolean | null;
        limitAmount: number | null;
        /** Stays a string upstream; not converted. */
        limitRate: string | null;
        stopAmount: number | null;
        stopLossRate: string | null;
        routes: string[];
        maxHopCount: number | null;
        minFillAmount: number | null;
        lpAsset: string | null;
    }, {
        routes: string[];
        expired_at?: string | null | undefined;
        max_cancelling_tip?: number | null | undefined;
        killable?: boolean | null | undefined;
        limit_amount?: number | null | undefined;
        limit_rate?: string | null | undefined;
        stop_amount?: number | null | undefined;
        stop_loss_rate?: string | null | undefined;
        max_hop_count?: number | null | undefined;
        min_fill_amount?: number | null | undefined;
        lp_asset?: string | null | undefined;
    }>>>>;
    fills: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        amount_a: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
        amount_b: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
        lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
        tx_digest: z.ZodString;
        block: z.ZodNumber;
        filled_at: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        amountA: number;
        amountB: number;
        lpAmount: number;
        txHash: string;
        block: number;
        /** Epoch milliseconds. */
        filledAt: number;
    }, {
        amount_a: number;
        amount_b: number;
        lp_amount: number;
        tx_digest: string;
        block: number;
        filled_at: number;
    }>>>>>, z.ZodTransform<{
        amountA: number;
        amountB: number;
        lpAmount: number;
        txHash: string;
        block: number;
        /** Epoch milliseconds. */
        filledAt: number;
    }[], {
        amountA: number;
        amountB: number;
        lpAmount: number;
        txHash: string;
        block: number;
        /** Epoch milliseconds. */
        filledAt: number;
    }[] | null | undefined>>;
}, z.core.$strip>, z.ZodTransform<{
    type: string;
    /**
     * The hop's UTxO reference, `txHash#index`.
     *
     * This is what a cancellation targets, and it is only cancellable while
     * the hop is still pending.
     */
    orderRef: string;
    protocol: string | null;
    poolId: string | null;
    coinA: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    coinB: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    aToB: boolean | null;
    amountA: number;
    amountB: number;
    lpAmount: number;
    batcherFee: number;
    depositAda: number;
    extra: {
        expiredAt: string | null;
        /** Already normalized to ADA by the backend, despite being a string on-chain. */
        maxCancellingTip: number | null;
        killable: boolean | null;
        limitAmount: number | null;
        /** Stays a string upstream; not converted. */
        limitRate: string | null;
        stopAmount: number | null;
        stopLossRate: string | null;
        routes: string[];
        maxHopCount: number | null;
        minFillAmount: number | null;
        lpAsset: string | null;
    } | null;
    fills: {
        amountA: number;
        amountB: number;
        lpAmount: number;
        txHash: string;
        block: number;
        /** Epoch milliseconds. */
        filledAt: number;
    }[];
}, {
    type: string;
    order_ref: string;
    coin_a: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    coin_b: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    amount_a: number;
    amount_b: number;
    lp_amount: number;
    batcher_fee: number;
    deposit_ada: number;
    fills: {
        amountA: number;
        amountB: number;
        lpAmount: number;
        txHash: string;
        block: number;
        /** Epoch milliseconds. */
        filledAt: number;
    }[];
    protocol?: string | null | undefined;
    pool_id?: string | null | undefined;
    a_to_b?: boolean | null | undefined;
    extra?: {
        expiredAt: string | null;
        /** Already normalized to ADA by the backend, despite being a string on-chain. */
        maxCancellingTip: number | null;
        killable: boolean | null;
        limitAmount: number | null;
        /** Stays a string upstream; not converted. */
        limitRate: string | null;
        stopAmount: number | null;
        stopLossRate: string | null;
        routes: string[];
        maxHopCount: number | null;
        minFillAmount: number | null;
        lpAsset: string | null;
    } | null | undefined;
}>>;
type OrderHop = z.infer<typeof orderHopSchema>;
declare const orderSplitSchema: z.ZodPipe<z.ZodObject<{
    root_id: z.ZodNumber;
    status: z.ZodString;
    executed_at: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    hops: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        type: z.ZodString;
        order_ref: z.ZodString;
        protocol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coin_a: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
        }>>;
        coin_b: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
        }>>;
        a_to_b: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        amount_a: z.ZodNumber;
        amount_b: z.ZodNumber;
        lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
        batcher_fee: z.ZodNumber;
        deposit_ada: z.ZodNumber;
        extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
            expired_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            max_cancelling_tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            killable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            limit_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            limit_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            stop_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            stop_loss_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            routes: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
            max_hop_count: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            min_fill_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            lp_asset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>, z.ZodTransform<{
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        }, {
            routes: string[];
            expired_at?: string | null | undefined;
            max_cancelling_tip?: number | null | undefined;
            killable?: boolean | null | undefined;
            limit_amount?: number | null | undefined;
            limit_rate?: string | null | undefined;
            stop_amount?: number | null | undefined;
            stop_loss_rate?: string | null | undefined;
            max_hop_count?: number | null | undefined;
            min_fill_amount?: number | null | undefined;
            lp_asset?: string | null | undefined;
        }>>>>;
        fills: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            amount_a: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
            amount_b: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
            lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
            tx_digest: z.ZodString;
            block: z.ZodNumber;
            filled_at: z.ZodNumber;
        }, z.core.$strip>, z.ZodTransform<{
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }, {
            amount_a: number;
            amount_b: number;
            lp_amount: number;
            tx_digest: string;
            block: number;
            filled_at: number;
        }>>>>>, z.ZodTransform<{
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[], {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[] | null | undefined>>;
    }, z.core.$strip>, z.ZodTransform<{
        type: string;
        /**
         * The hop's UTxO reference, `txHash#index`.
         *
         * This is what a cancellation targets, and it is only cancellable while
         * the hop is still pending.
         */
        orderRef: string;
        protocol: string | null;
        poolId: string | null;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        aToB: boolean | null;
        amountA: number;
        amountB: number;
        lpAmount: number;
        batcherFee: number;
        depositAda: number;
        extra: {
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        } | null;
        fills: {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[];
    }, {
        type: string;
        order_ref: string;
        coin_a: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coin_b: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        amount_a: number;
        amount_b: number;
        lp_amount: number;
        batcher_fee: number;
        deposit_ada: number;
        fills: {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[];
        protocol?: string | null | undefined;
        pool_id?: string | null | undefined;
        a_to_b?: boolean | null | undefined;
        extra?: {
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        } | null | undefined;
    }>>>>>, z.ZodTransform<{
        type: string;
        /**
         * The hop's UTxO reference, `txHash#index`.
         *
         * This is what a cancellation targets, and it is only cancellable while
         * the hop is still pending.
         */
        orderRef: string;
        protocol: string | null;
        poolId: string | null;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        aToB: boolean | null;
        amountA: number;
        amountB: number;
        lpAmount: number;
        batcherFee: number;
        depositAda: number;
        extra: {
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        } | null;
        fills: {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[];
    }[], {
        type: string;
        /**
         * The hop's UTxO reference, `txHash#index`.
         *
         * This is what a cancellation targets, and it is only cancellable while
         * the hop is still pending.
         */
        orderRef: string;
        protocol: string | null;
        poolId: string | null;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        aToB: boolean | null;
        amountA: number;
        amountB: number;
        lpAmount: number;
        batcherFee: number;
        depositAda: number;
        extra: {
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        } | null;
        fills: {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[];
    }[] | null | undefined>>;
}, z.core.$strip>, z.ZodTransform<{
    rootId: number;
    status: OrderStatus;
    executedAt: number | null;
    hops: {
        type: string;
        /**
         * The hop's UTxO reference, `txHash#index`.
         *
         * This is what a cancellation targets, and it is only cancellable while
         * the hop is still pending.
         */
        orderRef: string;
        protocol: string | null;
        poolId: string | null;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        aToB: boolean | null;
        amountA: number;
        amountB: number;
        lpAmount: number;
        batcherFee: number;
        depositAda: number;
        extra: {
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        } | null;
        fills: {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[];
    }[];
}, {
    root_id: number;
    status: string;
    hops: {
        type: string;
        /**
         * The hop's UTxO reference, `txHash#index`.
         *
         * This is what a cancellation targets, and it is only cancellable while
         * the hop is still pending.
         */
        orderRef: string;
        protocol: string | null;
        poolId: string | null;
        coinA: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        coinB: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
        };
        aToB: boolean | null;
        amountA: number;
        amountB: number;
        lpAmount: number;
        batcherFee: number;
        depositAda: number;
        extra: {
            expiredAt: string | null;
            /** Already normalized to ADA by the backend, despite being a string on-chain. */
            maxCancellingTip: number | null;
            killable: boolean | null;
            limitAmount: number | null;
            /** Stays a string upstream; not converted. */
            limitRate: string | null;
            stopAmount: number | null;
            stopLossRate: string | null;
            routes: string[];
            maxHopCount: number | null;
            minFillAmount: number | null;
            lpAsset: string | null;
        } | null;
        fills: {
            amountA: number;
            amountB: number;
            lpAmount: number;
            txHash: string;
            block: number;
            /** Epoch milliseconds. */
            filledAt: number;
        }[];
    }[];
    executed_at?: number | null | undefined;
}>>;
type OrderSplit = z.infer<typeof orderSplitSchema>;
declare const orderSchema: z.ZodPipe<z.ZodObject<{
    tx_digest: z.ZodString;
    order_key: z.ZodString;
    source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodString;
    created_at: z.ZodNumber;
    executed_at: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    splits: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        root_id: z.ZodNumber;
        status: z.ZodString;
        executed_at: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        hops: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            type: z.ZodString;
            order_ref: z.ZodString;
            protocol: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            coin_a: z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                coin_type?: string | null | undefined;
            }>>;
            coin_b: z.ZodPipe<z.ZodObject<{
                coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                symbol: z.ZodString;
                decimals: z.ZodNumber;
                icon_url: z.ZodString;
                verified: z.ZodBoolean;
            }, z.core.$strip>, z.ZodTransform<{
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            }, {
                symbol: string;
                decimals: number;
                icon_url: string;
                verified: boolean;
                coin_type?: string | null | undefined;
            }>>;
            a_to_b: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            amount_a: z.ZodNumber;
            amount_b: z.ZodNumber;
            lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
            batcher_fee: z.ZodNumber;
            deposit_ada: z.ZodNumber;
            extra: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
                expired_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                max_cancelling_tip: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                killable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
                limit_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                limit_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                stop_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                stop_loss_rate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                routes: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
                max_hop_count: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                min_fill_amount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                lp_asset: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            }, z.core.$strip>, z.ZodTransform<{
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            }, {
                routes: string[];
                expired_at?: string | null | undefined;
                max_cancelling_tip?: number | null | undefined;
                killable?: boolean | null | undefined;
                limit_amount?: number | null | undefined;
                limit_rate?: string | null | undefined;
                stop_amount?: number | null | undefined;
                stop_loss_rate?: string | null | undefined;
                max_hop_count?: number | null | undefined;
                min_fill_amount?: number | null | undefined;
                lp_asset?: string | null | undefined;
            }>>>>;
            fills: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
                amount_a: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
                amount_b: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
                lp_amount: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
                tx_digest: z.ZodString;
                block: z.ZodNumber;
                filled_at: z.ZodNumber;
            }, z.core.$strip>, z.ZodTransform<{
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }, {
                amount_a: number;
                amount_b: number;
                lp_amount: number;
                tx_digest: string;
                block: number;
                filled_at: number;
            }>>>>>, z.ZodTransform<{
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[], {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[] | null | undefined>>;
        }, z.core.$strip>, z.ZodTransform<{
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }, {
            type: string;
            order_ref: string;
            coin_a: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coin_b: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            amount_a: number;
            amount_b: number;
            lp_amount: number;
            batcher_fee: number;
            deposit_ada: number;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
            protocol?: string | null | undefined;
            pool_id?: string | null | undefined;
            a_to_b?: boolean | null | undefined;
            extra?: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null | undefined;
        }>>>>>, z.ZodTransform<{
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[], {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[] | null | undefined>>;
    }, z.core.$strip>, z.ZodTransform<{
        rootId: number;
        status: OrderStatus;
        executedAt: number | null;
        hops: {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[];
    }, {
        root_id: number;
        status: string;
        hops: {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[];
        executed_at?: number | null | undefined;
    }>>>>>, z.ZodTransform<{
        rootId: number;
        status: OrderStatus;
        executedAt: number | null;
        hops: {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[];
    }[], {
        rootId: number;
        status: OrderStatus;
        executedAt: number | null;
        hops: {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[];
    }[] | null | undefined>>;
}, z.core.$strip>, z.ZodTransform<{
    txHash: string;
    orderKey: string;
    /** `null` means the order was placed directly, not via an aggregator. */
    source: string | null;
    status: OrderStatus;
    /** Epoch milliseconds. */
    createdAt: number;
    executedAt: number | null;
    /**
     * An order can be split across several routes, each a chain of hops.
     * Cancellable UTxO references live on the hops.
     */
    splits: {
        rootId: number;
        status: OrderStatus;
        executedAt: number | null;
        hops: {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[];
    }[];
}, {
    tx_digest: string;
    order_key: string;
    status: string;
    created_at: number;
    splits: {
        rootId: number;
        status: OrderStatus;
        executedAt: number | null;
        hops: {
            type: string;
            /**
             * The hop's UTxO reference, `txHash#index`.
             *
             * This is what a cancellation targets, and it is only cancellable while
             * the hop is still pending.
             */
            orderRef: string;
            protocol: string | null;
            poolId: string | null;
            coinA: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            coinB: {
                coinId: string | null;
                symbol: string;
                decimals: number;
                iconUrl: string;
                verified: boolean;
            };
            aToB: boolean | null;
            amountA: number;
            amountB: number;
            lpAmount: number;
            batcherFee: number;
            depositAda: number;
            extra: {
                expiredAt: string | null;
                /** Already normalized to ADA by the backend, despite being a string on-chain. */
                maxCancellingTip: number | null;
                killable: boolean | null;
                limitAmount: number | null;
                /** Stays a string upstream; not converted. */
                limitRate: string | null;
                stopAmount: number | null;
                stopLossRate: string | null;
                routes: string[];
                maxHopCount: number | null;
                minFillAmount: number | null;
                lpAsset: string | null;
            } | null;
            fills: {
                amountA: number;
                amountB: number;
                lpAmount: number;
                txHash: string;
                block: number;
                /** Epoch milliseconds. */
                filledAt: number;
            }[];
        }[];
    }[];
    source?: string | null | undefined;
    executed_at?: number | null | undefined;
}>>;
type Order = z.infer<typeof orderSchema>;
type OrderHistoryParams = PageParams & {
    /** A Cardano payment or stake address. */
    address: string;
    statuses?: OrderStatus[];
    /** Uppercase order types, e.g. `DEPOSIT`, `WITHDRAW`, `ZAP_IN`, `ZAP_OUT`. */
    types?: string[];
    protocols?: string[];
    /** Aggregator that originated the order. Use {@link ORDER_SOURCE_DIRECT} for none. */
    sources?: string[];
    poolId?: string;
    timeRange?: {
        from: Date | number;
        to: Date | number;
    };
    /** Free text; also accepts a 64-character tx hash or a coin id. */
    search?: string;
    coinIds?: string[];
    txHash?: string;
    currency?: MinswapCurrency;
};
/**
 * DEX order history across every protocol Minswap indexes.
 *
 * Results are always newest-first — the backend ignores any sort direction the
 * client asks for, so the SDK does not offer one.
 *
 * Each order carries the UTxO references needed to cancel it: walk
 * `splits[].hops[].orderRef` for hops still in a pending state.
 */
declare class OrderModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    /** Fetch an address's order history, newest first. */
    getHistory(params: OrderHistoryParams): Promise<Page<Order>>;
    /**
     * Collect the UTxO references that can still be cancelled for an order.
     *
     * Convenience over walking `splits[].hops[]` by hand; the result feeds
     * straight into a cancellation request.
     */
    static cancellableRefs(order: Order): string[];
}

/**
 * Schemas shared across modules.
 *
 * Two upstream quirks drive most of the defensiveness here:
 *
 * - Go marshals a nil slice as `null`, not `[]`. Every array is therefore
 *   `.nullish()` and normalized to an empty array.
 * - `omitempty` on a numeric field drops it when it is zero, so several counts
 *   and amounts are absent rather than `0`. Those default to `0`.
 */
/** Nil-slice-tolerant array that always resolves to a real array. */
declare function arrayOf<T extends z.ZodTypeAny>(schema: T): z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<T>>>, z.ZodTransform<z.core.output<T>[], z.core.output<T>[] | null | undefined>>;
/** A numeric field the backend drops when it equals zero. */
declare const zeroableNumber: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodNumber>>, z.ZodTransform<number, number | null | undefined>>;
/** Identity of a coin, as embedded in most responses. */
declare const coinBasicInfoSchema: z.ZodPipe<z.ZodObject<{
    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    symbol: z.ZodString;
    decimals: z.ZodNumber;
    icon_url: z.ZodString;
    verified: z.ZodBoolean;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string | null;
    symbol: string;
    decimals: number;
    iconUrl: string;
    verified: boolean;
}, {
    symbol: string;
    decimals: number;
    icon_url: string;
    verified: boolean;
    coin_type?: string | null | undefined;
}>>;
type CoinBasicInfo = z.infer<typeof coinBasicInfoSchema>;
/** A coin plus how much of it, and what that is worth. */
declare const coinAmountInfoSchema: z.ZodPipe<z.ZodObject<{
    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    symbol: z.ZodString;
    decimals: z.ZodNumber;
    icon_url: z.ZodString;
    verified: z.ZodBoolean;
    amount: z.ZodNumber;
    usd_value: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string | null;
    symbol: string;
    decimals: number;
    iconUrl: string;
    verified: boolean;
    amount: number;
    usdValue: number;
}, {
    symbol: string;
    decimals: number;
    icon_url: string;
    verified: boolean;
    amount: number;
    usd_value: number;
    coin_type?: string | null | undefined;
}>>;
type CoinAmountInfo = z.infer<typeof coinAmountInfoSchema>;
/** A coin as it appears inside a pool, carrying a free-form category label. */
declare const poolCoinSchema: z.ZodPipe<z.ZodObject<{
    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    symbol: z.ZodString;
    decimals: z.ZodNumber;
    icon_url: z.ZodString;
    verified: z.ZodBoolean;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string | null;
    symbol: string;
    decimals: number;
    iconUrl: string;
    verified: boolean;
    /** Free-form; not constrained to the `categoryGroup` filter values. */
    category: string | null;
}, {
    symbol: string;
    decimals: number;
    icon_url: string;
    verified: boolean;
    coin_type?: string | null | undefined;
    category?: string | null | undefined;
}>>;
type PoolCoin = z.infer<typeof poolCoinSchema>;
/** An emission stream attached to a pool or farm. */
declare const poolRewardSchema: z.ZodPipe<z.ZodObject<{
    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    symbol: z.ZodString;
    decimals: z.ZodNumber;
    icon_url: z.ZodString;
    verified: z.ZodBoolean;
    daily_amount: z.ZodNumber;
    daily_amount_usd: z.ZodNumber;
    apr: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string | null;
    symbol: string;
    decimals: number;
    iconUrl: string;
    verified: boolean;
    dailyAmount: number;
    dailyAmountUsd: number;
    apr: number;
}, {
    symbol: string;
    decimals: number;
    icon_url: string;
    verified: boolean;
    daily_amount: number;
    daily_amount_usd: number;
    apr: number;
    coin_type?: string | null | undefined;
}>>;
type PoolReward = z.infer<typeof poolRewardSchema>;
declare const poolFeeSchema: z.ZodPipe<z.ZodObject<{
    fee_raw: z.ZodNumber;
    fee_usd: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    feeRaw: number;
    feeUsd: number;
}, {
    fee_raw: number;
    fee_usd: number;
}>>;
type PoolFee = z.infer<typeof poolFeeSchema>;
/**
 * One OHLC candle.
 *
 * The two upstream chart endpoints disagree on encoding — the coin chart
 * returns `{t: RFC3339, ohlcv: [...]}` while the pool chart returns a bare
 * `[unixSeconds, o, h, l, c, v]` tuple. Both normalize to this.
 */
type Candle = {
    /** Bucket start, epoch milliseconds. */
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    /** Gap-filled buckets report zero volume rather than being omitted. */
    volume: number;
};
/** `{t, ohlcv}` form, used by the coin chart. */
declare const coinCandleSchema: z.ZodPipe<z.ZodObject<{
    t: z.ZodString;
    ohlcv: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodNumber>>>;
}, z.core.$strip>, z.ZodTransform<Candle, {
    t: string;
    ohlcv?: number[] | null | undefined;
}>>;
/** Bare tuple form, used by the pool chart. Index 0 is seconds, not millis. */
declare const poolCandleSchema: z.ZodPipe<z.ZodArray<z.ZodNumber>, z.ZodTransform<Candle, number[]>>;
/**
 * Bucket sizes the Cardano chart endpoints accept, in minutes.
 *
 * Validated client-side so a bad value fails immediately instead of costing a
 * round trip and a 400.
 */
declare const VALID_BUCKET_MINUTES: readonly [1, 5, 15, 30, 60, 120, 240, 360, 720, 1440, 5760, 10080, 43200];
type BucketMinutes = (typeof VALID_BUCKET_MINUTES)[number];
declare function assertBucket(bucketMinutes: number): void;

/**
 * Pool types that can appear in a response.
 *
 * `unknown` is response-only — the backend emits it but rejects it as a filter
 * value, so {@link PoolListParams.poolTypes} excludes it.
 */
declare const POOL_TYPES: readonly ["cpmm", "clmm", "dlmm", "weighted", "stableswap", "oracle", "unknown"];
type PoolType = (typeof POOL_TYPES)[number];
declare const POOL_FILTER_TYPES: Exclude<PoolType, "unknown">[];
declare const POOL_CATEGORY_GROUPS: readonly ["stablecoin", "correlated", "meme", "other"];
type PoolCategoryGroup = (typeof POOL_CATEGORY_GROUPS)[number];
declare const POOL_LIST_SORT_FIELDS: readonly ["created_at", "tvl_usd", "apr_24h", "apr_1w", "apr_30d", "fee_24h", "fee_1w", "fee_30d", "volume_24h", "volume_1w", "volume_30d", "total_apr_24h", "total_apr_1w", "total_apr_30d"];
type PoolListSortField = (typeof POOL_LIST_SORT_FIELDS)[number];
/**
 * Pool event kinds.
 *
 * Renamed from the upstream `join`/`exit`, which read as ambiguous next to the
 * `buy`/`sell` swap directions.
 */
declare const POOL_EVENT_ACTIONS: readonly ["buy", "sell", "addLiquidity", "removeLiquidity"];
type PoolEventAction = (typeof POOL_EVENT_ACTIONS)[number];
declare const poolSchema: z.ZodPipe<z.ZodObject<{
    pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    protocol: z.ZodString;
    coin_a: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
        category?: string | null | undefined;
    }>>;
    coin_b: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
        category?: string | null | undefined;
    }>>;
    amount_a: z.ZodNumber;
    amount_b: z.ZodNumber;
    amount_a_usd: z.ZodNumber;
    amount_b_usd: z.ZodNumber;
    price_a: z.ZodNumber;
    price_b: z.ZodNumber;
    price_ab: z.ZodNumber;
    tvl_usd: z.ZodNumber;
    tvl_usd_24h_change: z.ZodNumber;
    fee_rate: z.ZodNumber;
    fee_rate_a: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fee_rate_b: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fee_24h: z.ZodNumber;
    fee_24h_change: z.ZodNumber;
    fee_1w: z.ZodNumber;
    fee_30d: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fee_a_24h: z.ZodPipe<z.ZodObject<{
        fee_raw: z.ZodNumber;
        fee_usd: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        feeRaw: number;
        feeUsd: number;
    }, {
        fee_raw: number;
        fee_usd: number;
    }>>;
    fee_b_24h: z.ZodPipe<z.ZodObject<{
        fee_raw: z.ZodNumber;
        fee_usd: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        feeRaw: number;
        feeUsd: number;
    }, {
        fee_raw: number;
        fee_usd: number;
    }>>;
    fee_a_1w: z.ZodPipe<z.ZodObject<{
        fee_raw: z.ZodNumber;
        fee_usd: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        feeRaw: number;
        feeUsd: number;
    }, {
        fee_raw: number;
        fee_usd: number;
    }>>;
    fee_b_1w: z.ZodPipe<z.ZodObject<{
        fee_raw: z.ZodNumber;
        fee_usd: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        feeRaw: number;
        feeUsd: number;
    }, {
        fee_raw: number;
        fee_usd: number;
    }>>;
    fee_a_30d: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        fee_raw: z.ZodNumber;
        fee_usd: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        feeRaw: number;
        feeUsd: number;
    }, {
        fee_raw: number;
        fee_usd: number;
    }>>>>;
    fee_b_30d: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        fee_raw: z.ZodNumber;
        fee_usd: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        feeRaw: number;
        feeUsd: number;
    }, {
        fee_raw: number;
        fee_usd: number;
    }>>>>;
    volume_24h: z.ZodNumber;
    volume_24h_change: z.ZodNumber;
    volume_1w: z.ZodNumber;
    volume_30d: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    fee_apr_24h: z.ZodNumber;
    fee_apr_1w: z.ZodNumber;
    fee_apr_30d: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        daily_amount: z.ZodNumber;
        daily_amount_usd: z.ZodNumber;
        apr: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        daily_amount: number;
        daily_amount_usd: number;
        apr: number;
        coin_type?: string | null | undefined;
    }>>>>>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[], {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[] | null | undefined>>;
    active: z.ZodBoolean;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    pool_type: z.ZodString;
}, z.core.$strip>, z.ZodTransform<{
    poolId: string | null;
    protocol: string;
    coinA: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    coinB: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    amountA: number;
    amountB: number;
    amountAUsd: number;
    amountBUsd: number;
    priceA: number;
    priceB: number;
    priceAB: number;
    tvlUsd: number;
    tvlUsd24hChange: number;
    feeRate: number;
    /** Per-side fee rates exist only on protocols that support them. */
    feeRateA: number | null;
    feeRateB: number | null;
    fee24h: number;
    fee24hChange: number;
    fee1w: number;
    /** 30-day windows are Cardano-only and absent elsewhere. */
    fee30d: number | null;
    feeA24h: {
        feeRaw: number;
        feeUsd: number;
    };
    feeB24h: {
        feeRaw: number;
        feeUsd: number;
    };
    feeA1w: {
        feeRaw: number;
        feeUsd: number;
    };
    feeB1w: {
        feeRaw: number;
        feeUsd: number;
    };
    feeA30d: {
        feeRaw: number;
        feeUsd: number;
    } | null;
    feeB30d: {
        feeRaw: number;
        feeUsd: number;
    } | null;
    volume24h: number;
    volume24hChange: number;
    volume1w: number;
    volume30d: number | null;
    feeApr24h: number;
    feeApr1w: number;
    feeApr30d: number | null;
    rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    active: boolean;
    createdAt: string | null;
    poolType: PoolType;
}, {
    protocol: string;
    coin_a: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    coin_b: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    amount_a: number;
    amount_b: number;
    amount_a_usd: number;
    amount_b_usd: number;
    price_a: number;
    price_b: number;
    price_ab: number;
    tvl_usd: number;
    tvl_usd_24h_change: number;
    fee_rate: number;
    fee_24h: number;
    fee_24h_change: number;
    fee_1w: number;
    fee_a_24h: {
        feeRaw: number;
        feeUsd: number;
    };
    fee_b_24h: {
        feeRaw: number;
        feeUsd: number;
    };
    fee_a_1w: {
        feeRaw: number;
        feeUsd: number;
    };
    fee_b_1w: {
        feeRaw: number;
        feeUsd: number;
    };
    volume_24h: number;
    volume_24h_change: number;
    volume_1w: number;
    fee_apr_24h: number;
    fee_apr_1w: number;
    rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    active: boolean;
    pool_type: string;
    pool_id?: string | null | undefined;
    fee_rate_a?: number | null | undefined;
    fee_rate_b?: number | null | undefined;
    fee_30d?: number | null | undefined;
    fee_a_30d?: {
        feeRaw: number;
        feeUsd: number;
    } | null | undefined;
    fee_b_30d?: {
        feeRaw: number;
        feeUsd: number;
    } | null | undefined;
    volume_30d?: number | null | undefined;
    fee_apr_30d?: number | null | undefined;
    created_at?: string | null | undefined;
}>>;
type PoolSummary = z.infer<typeof poolSchema>;
declare const poolEventSchema: z.ZodPipe<z.ZodObject<{
    id: z.ZodString;
    pool_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    coin_a: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
    }>>;
    coin_b: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
    }>>;
    amount_a: z.ZodString;
    amount_b: z.ZodString;
    amount_a_usd: z.ZodString;
    amount_b_usd: z.ZodString;
    sender: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    tx_digest: z.ZodString;
    created_at: z.ZodString;
    action: z.ZodString;
}, z.core.$strip>, z.ZodTransform<{
    id: string;
    poolId: string | null;
    coinA: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    coinB: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    /** Decimal strings, not numbers — parse with a bignum library. */
    amountA: string;
    amountB: string;
    amountAUsd: string;
    amountBUsd: string;
    sender: string | null;
    txHash: string;
    createdAt: string;
    action: "buy" | "sell" | "addLiquidity" | "removeLiquidity";
}, {
    id: string;
    coin_a: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    coin_b: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
    };
    amount_a: string;
    amount_b: string;
    amount_a_usd: string;
    amount_b_usd: string;
    tx_digest: string;
    created_at: string;
    action: string;
    pool_id?: string | null | undefined;
    sender?: string | null | undefined;
}>>;
type PoolEvent = z.infer<typeof poolEventSchema>;
type PoolListParams = PageParams & {
    poolIds?: string[];
    protocols?: string[];
    /** Filters to pools containing these coins. Upstream accepts at most two. */
    coinIds?: string[];
    minTvl?: number;
    poolType?: Exclude<PoolType, "unknown">;
    categoryGroup?: PoolCategoryGroup;
    isVerified?: boolean;
    search?: string;
    /** @default "volume_24h" */
    sortBy?: PoolListSortField;
    /** @default "desc" */
    order?: "asc" | "desc";
    currency?: MinswapCurrency;
};
type PoolOhlcParams = {
    poolId: string;
    from?: Date | number;
    to?: Date | number;
    /** Required here, unlike the token chart which defaults to 1. */
    bucketMinutes: BucketMinutes;
    /** 1..500. @default 500 */
    limit?: number;
    currency?: MinswapCurrency;
};
type PoolEventsParams = PageParams & {
    poolId: string;
    actions?: PoolEventAction[];
    address?: string;
    /** The backend caps the span at two months. */
    timeRange?: {
        from: Date | number;
        to: Date | number;
    };
    /** Newest first. @default true */
    descending?: boolean;
    currency?: MinswapCurrency;
};
/**
 * Liquidity pool data: listing, lookup, charts, and event history.
 *
 * Note that pool endpoints take query params where the token endpoints take a
 * JSON body, and spell sorting `sort_field`/`sort_direction` rather than
 * `sort_by`/`order`. Both are normalized to `sortBy`/`order` here.
 */
declare class PoolModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    /** List pools with filtering and sorting. */
    list(params?: PoolListParams): Promise<Page<PoolSummary>>;
    /**
     * Fetch a single pool.
     *
     * @throws {MinswapError} with code `NOT_FOUND` when no such pool exists.
     */
    getById(poolId: string, options?: {
        currency?: MinswapCurrency;
    }): Promise<PoolSummary>;
    /**
     * Fetch several pools by id.
     *
     * Chunked at 20, the upstream cap on `pool_addresses`. Ids that do not match
     * a pool are absent from the result rather than raising.
     */
    getByIds(poolIds: string[], options?: {
        currency?: MinswapCurrency;
    }): Promise<PoolSummary[]>;
    /** OHLC candles for a pool. */
    getOhlc(params: PoolOhlcParams): Promise<Candle[]>;
    /** Swaps and liquidity changes for a pool. */
    getEvents(params: PoolEventsParams): Promise<Page<PoolEvent>>;
}

declare const stakingPoolSchema: z.ZodPipe<z.ZodObject<{
    pool_id: z.ZodString;
    coin: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        coin_type?: string | null | undefined;
        category?: string | null | undefined;
    }>>;
    amount_locked: z.ZodNumber;
    amount_locked_usd: z.ZodNumber;
    active: z.ZodBoolean;
    rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        daily_amount: z.ZodNumber;
        daily_amount_usd: z.ZodNumber;
        apr: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        daily_amount: number;
        daily_amount_usd: number;
        apr: number;
        coin_type?: string | null | undefined;
    }>>>>>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[], {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[] | null | undefined>>;
    staked_share: z.ZodNumber;
    stakers: z.ZodNumber;
    positions: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    poolId: string;
    coin: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    amountLocked: number;
    amountLockedUsd: number;
    active: boolean;
    rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    stakedShare: number;
    stakers: number;
    positions: number;
    /**
     * Tiered (locked) or flexible staking.
     *
     * The backend encodes this only as a `-flexible` suffix on the pool id; the
     * SDK surfaces it as an explicit field so `stake`/`unstake` can route
     * without the caller parsing the id.
     */
    kind: StakingKind;
}, {
    pool_id: string;
    coin: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        category: string | null;
    };
    amount_locked: number;
    amount_locked_usd: number;
    active: boolean;
    rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    staked_share: number;
    stakers: number;
    positions: number;
}>>;
type StakingPool = z.infer<typeof stakingPoolSchema>;
declare const stakingListSchema: z.ZodPipe<z.ZodObject<{
    pools: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        pool_id: z.ZodString;
        coin: z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
            category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            coin_type?: string | null | undefined;
            category?: string | null | undefined;
        }>>;
        amount_locked: z.ZodNumber;
        amount_locked_usd: z.ZodNumber;
        active: z.ZodBoolean;
        rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
            coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            symbol: z.ZodString;
            decimals: z.ZodNumber;
            icon_url: z.ZodString;
            verified: z.ZodBoolean;
            daily_amount: z.ZodNumber;
            daily_amount_usd: z.ZodNumber;
            apr: z.ZodNumber;
        }, z.core.$strip>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }, {
            symbol: string;
            decimals: number;
            icon_url: string;
            verified: boolean;
            daily_amount: number;
            daily_amount_usd: number;
            apr: number;
            coin_type?: string | null | undefined;
        }>>>>>, z.ZodTransform<{
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[], {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[] | null | undefined>>;
        staked_share: z.ZodNumber;
        stakers: z.ZodNumber;
        positions: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        poolId: string;
        coin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        };
        amountLocked: number;
        amountLockedUsd: number;
        active: boolean;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
        stakedShare: number;
        stakers: number;
        positions: number;
        /**
         * Tiered (locked) or flexible staking.
         *
         * The backend encodes this only as a `-flexible` suffix on the pool id; the
         * SDK surfaces it as an explicit field so `stake`/`unstake` can route
         * without the caller parsing the id.
         */
        kind: StakingKind;
    }, {
        pool_id: string;
        coin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        };
        amount_locked: number;
        amount_locked_usd: number;
        active: boolean;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
        staked_share: number;
        stakers: number;
        positions: number;
    }>>>>>, z.ZodTransform<{
        poolId: string;
        coin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        };
        amountLocked: number;
        amountLockedUsd: number;
        active: boolean;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
        stakedShare: number;
        stakers: number;
        positions: number;
        /**
         * Tiered (locked) or flexible staking.
         *
         * The backend encodes this only as a `-flexible` suffix on the pool id; the
         * SDK surfaces it as an explicit field so `stake`/`unstake` can route
         * without the caller parsing the id.
         */
        kind: StakingKind;
    }[], {
        poolId: string;
        coin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        };
        amountLocked: number;
        amountLockedUsd: number;
        active: boolean;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
        stakedShare: number;
        stakers: number;
        positions: number;
        /**
         * Tiered (locked) or flexible staking.
         *
         * The backend encodes this only as a `-flexible` suffix on the pool id; the
         * SDK surfaces it as an explicit field so `stake`/`unstake` can route
         * without the caller parsing the id.
         */
        kind: StakingKind;
    }[] | null | undefined>>;
    total_amount_locked: z.ZodNumber;
    total_amount_locked_usd: z.ZodNumber;
    total_rewards: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        decimals: z.ZodNumber;
        icon_url: z.ZodString;
        verified: z.ZodBoolean;
        daily_amount: z.ZodNumber;
        daily_amount_usd: z.ZodNumber;
        apr: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }, {
        symbol: string;
        decimals: number;
        icon_url: string;
        verified: boolean;
        daily_amount: number;
        daily_amount_usd: number;
        apr: number;
        coin_type?: string | null | undefined;
    }>>>>>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[], {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[] | null | undefined>>;
    total_stakers: z.ZodNumber;
}, z.core.$strip>, z.ZodTransform<{
    pools: {
        poolId: string;
        coin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        };
        amountLocked: number;
        amountLockedUsd: number;
        active: boolean;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
        stakedShare: number;
        stakers: number;
        positions: number;
        /**
         * Tiered (locked) or flexible staking.
         *
         * The backend encodes this only as a `-flexible` suffix on the pool id; the
         * SDK surfaces it as an explicit field so `stake`/`unstake` can route
         * without the caller parsing the id.
         */
        kind: StakingKind;
    }[];
    totalAmountLocked: number;
    totalAmountLockedUsd: number;
    totalRewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    totalStakers: number;
}, {
    pools: {
        poolId: string;
        coin: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            category: string | null;
        };
        amountLocked: number;
        amountLockedUsd: number;
        active: boolean;
        rewards: {
            coinId: string | null;
            symbol: string;
            decimals: number;
            iconUrl: string;
            verified: boolean;
            dailyAmount: number;
            dailyAmountUsd: number;
            apr: number;
        }[];
        stakedShare: number;
        stakers: number;
        positions: number;
        /**
         * Tiered (locked) or flexible staking.
         *
         * The backend encodes this only as a `-flexible` suffix on the pool id; the
         * SDK surfaces it as an explicit field so `stake`/`unstake` can route
         * without the caller parsing the id.
         */
        kind: StakingKind;
    }[];
    total_amount_locked: number;
    total_amount_locked_usd: number;
    total_rewards: {
        coinId: string | null;
        symbol: string;
        decimals: number;
        iconUrl: string;
        verified: boolean;
        dailyAmount: number;
        dailyAmountUsd: number;
        apr: number;
    }[];
    total_stakers: number;
}>>;
type StakingOverview = z.infer<typeof stakingListSchema>;
/**
 * Rewards released when unstaking a tiered position.
 *
 * The GraphQL `FarmRewardAmount` carries a split asset and a raw `reward`;
 * normalized here to a `coinId` and a decimal-string amount.
 */
declare const rewardAmountSchema: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodPipe<z.ZodObject<{
    asset: z.ZodObject<{
        currencySymbol: z.ZodString;
        tokenName: z.ZodString;
    }, z.core.$strip>;
    reward: z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string;
    amount: string;
}, {
    asset: {
        currencySymbol: string;
        tokenName: string;
    };
    reward: string | number;
}>>>>>, z.ZodTransform<{
    coinId: string;
    amount: string;
}[], {
    coinId: string;
    amount: string;
}[] | null | undefined>>;
type StakingReward = z.infer<typeof rewardAmountSchema>[number];
type StakeParams = WalletInputParams & {
    /** The staked token as a `coinId` — MIN. */
    coinId: string;
    /** Amount to stake, in raw base units. */
    amount: bigint | number | string;
    /** Tiered (locked) or flexible staking. */
    kind: StakingKind;
};
type UnstakeParams = WalletInputParams & {
    /** The staking position's UTxO reference, `txHash#index` ({@link PortfolioStakingPosition.positionId}). */
    positionId: string;
    /** Which contract the position belongs to ({@link PortfolioStakingPosition.kind}). */
    kind: StakingKind;
};
type UnstakeResult = {
    cbor: string;
    /**
     * Rewards released by the unstake. Present only for a tiered position — the
     * flexible contract does not report them here.
     */
    pendingRewards: z.infer<typeof rewardAmountSchema> | null;
};
/**
 * MIN staking: browse pools, read positions, stake, and unstake.
 *
 * Two contracts exist — tiered (locked) and flexible — distinguished by
 * {@link StakingPool.kind} and {@link PortfolioStakingPosition.kind}. Reads come
 * from the app API; `stake` and `unstake` go through the key-app-api GraphQL
 * host, which builds and partially signs the transaction. As with farming, sign
 * the returned CBOR with `partialSign` and assemble it.
 */
declare class StakingModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    /**
     * All MIN staking pools, tiered and flexible, with totals.
     *
     * The endpoint takes no parameters — it returns the full set.
     */
    list(options?: {
        currency?: MinswapCurrency;
    }): Promise<StakingOverview>;
    /** An address's staking positions. Sourced from the DeFi portfolio. */
    getPositions(address: string): Promise<PortfolioStakingPosition[]>;
    /** Stake MIN into the tiered or flexible contract. */
    stake(params: StakeParams): Promise<{
        cbor: string;
    }>;
    /**
     * Unstake a position in full.
     *
     * A tiered unstake additionally reports the rewards it releases. For a partial
     * flexible withdrawal, this is not the method — unstake takes the whole
     * position.
     */
    unstake(params: UnstakeParams): Promise<UnstakeResult>;
}

declare const tokenDetailSchema: z.ZodPipe<z.ZodObject<{
    coin: z.ZodPipe<z.ZodObject<{
        coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        symbol: z.ZodString;
        name: z.ZodString;
        logo: z.ZodString;
        description: z.ZodString;
        liquidity: z.ZodString;
        market_cap: z.ZodString;
        fdv: z.ZodString;
        circulating_supply: z.ZodString;
        total_supply: z.ZodString;
        holders: z.ZodNumber;
        creator: z.ZodString;
        published_at: z.ZodString;
        first_trade_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        verified: z.ZodBoolean;
        decimals: z.ZodNumber;
        category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        scam_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        coinId: string | null;
        symbol: string;
        name: string;
        logo: string;
        description: string;
        liquidity: string;
        marketCap: string;
        fdv: string;
        circulatingSupply: string;
        totalSupply: string;
        holders: number;
        creator: string;
        publishedAt: string;
        firstTradeAt: string | null;
        verified: boolean;
        decimals: number;
        category: string | null;
        scamLabel: string | null;
    }, {
        symbol: string;
        name: string;
        logo: string;
        description: string;
        liquidity: string;
        market_cap: string;
        fdv: string;
        circulating_supply: string;
        total_supply: string;
        holders: number;
        creator: string;
        published_at: string;
        verified: boolean;
        decimals: number;
        coin_type?: string | null | undefined;
        first_trade_at?: string | null | undefined;
        category?: string | null | undefined;
        scam_label?: string | null | undefined;
    }>>;
    price_change: z.ZodPipe<z.ZodObject<{
        price: z.ZodNumber;
        price_change_1h: z.ZodNumber;
        price_change_6h: z.ZodNumber;
        price_change_1d: z.ZodNumber;
        price_change_7d: z.ZodNumber;
        price_change_30d: z.ZodNumber;
        price_24h_low: z.ZodNumber;
        price_24h_high: z.ZodNumber;
        ath: z.ZodNumber;
        atl: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        price: number;
        priceChange1h: number;
        priceChange6h: number;
        priceChange1d: number;
        priceChange7d: number;
        priceChange30d: number;
        price24hLow: number;
        price24hHigh: number;
        ath: number;
        atl: number;
    }, {
        price: number;
        price_change_1h: number;
        price_change_6h: number;
        price_change_1d: number;
        price_change_7d: number;
        price_change_30d: number;
        price_24h_low: number;
        price_24h_high: number;
        ath: number;
        atl: number;
    }>>;
    volume: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        vol_buy_1h: z.ZodNumber;
        vol_sell_1h: z.ZodNumber;
        vol_buy_24h: z.ZodNumber;
        vol_sell_24h: z.ZodNumber;
        vol_buy_1w: z.ZodNumber;
        vol_sell_1w: z.ZodNumber;
    }, z.core.$strip>, z.ZodTransform<{
        volBuy1h: number;
        volSell1h: number;
        volBuy24h: number;
        volSell24h: number;
        volBuy1w: number;
        volSell1w: number;
    }, {
        vol_buy_1h: number;
        vol_sell_1h: number;
        vol_buy_24h: number;
        vol_sell_24h: number;
        vol_buy_1w: number;
        vol_sell_1w: number;
    }>>>>;
    social_media: z.ZodPipe<z.ZodObject<{
        x: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        telegram: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        website: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        github: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        discord: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        facebook: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coingecko_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        coinmarketcap_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        banner_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        docs: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>, z.ZodTransform<{
        x: string | null;
        telegram: string | null;
        website: string | null;
        github: string | null;
        discord: string | null;
        facebook: string | null;
        coingeckoUrl: string | null;
        coinmarketcapUrl: string | null;
        bannerUrl: string | null;
        docs: string | null;
    }, {
        x?: string | null | undefined;
        telegram?: string | null | undefined;
        website?: string | null | undefined;
        github?: string | null | undefined;
        discord?: string | null | undefined;
        facebook?: string | null | undefined;
        coingecko_url?: string | null | undefined;
        coinmarketcap_url?: string | null | undefined;
        banner_url?: string | null | undefined;
        docs?: string | null | undefined;
    }>>;
    tags: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        name: z.ZodString;
    }, z.core.$strip>>>>, z.ZodTransform<{
        id: number;
        name: string;
    }[], {
        id: number;
        name: string;
    }[] | null | undefined>>;
    rank: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    security: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        mintable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        blacklist: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        top_10_holders: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>, z.ZodTransform<{
        mintable: boolean | null;
        blacklist: boolean | null;
        /** Share of supply held by the top 10 holders. */
        top10Holders: number | null;
    }, {
        mintable?: boolean | null | undefined;
        blacklist?: boolean | null | undefined;
        top_10_holders?: number | null | undefined;
    }>>>>;
    suspicious_labels: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
}, z.core.$strip>, z.ZodTransform<{
    coin: {
        coinId: string | null;
        symbol: string;
        name: string;
        logo: string;
        description: string;
        liquidity: string;
        marketCap: string;
        fdv: string;
        circulatingSupply: string;
        totalSupply: string;
        holders: number;
        creator: string;
        publishedAt: string;
        firstTradeAt: string | null;
        verified: boolean;
        decimals: number;
        category: string | null;
        scamLabel: string | null;
    };
    /** Spot price plus change/high/low windows. Named `price_change` upstream. */
    price: {
        price: number;
        priceChange1h: number;
        priceChange6h: number;
        priceChange1d: number;
        priceChange7d: number;
        priceChange30d: number;
        price24hLow: number;
        price24hHigh: number;
        ath: number;
        atl: number;
    };
    volume: {
        volBuy1h: number;
        volSell1h: number;
        volBuy24h: number;
        volSell24h: number;
        volBuy1w: number;
        volSell1w: number;
    } | null;
    socialMedia: {
        x: string | null;
        telegram: string | null;
        website: string | null;
        github: string | null;
        discord: string | null;
        facebook: string | null;
        coingeckoUrl: string | null;
        coinmarketcapUrl: string | null;
        bannerUrl: string | null;
        docs: string | null;
    };
    tags: {
        id: number;
        name: string;
    }[];
    rank: number | null;
    security: {
        mintable: boolean | null;
        blacklist: boolean | null;
        /** Share of supply held by the top 10 holders. */
        top10Holders: number | null;
    } | null;
    suspiciousLabels: string[];
}, {
    coin: {
        coinId: string | null;
        symbol: string;
        name: string;
        logo: string;
        description: string;
        liquidity: string;
        marketCap: string;
        fdv: string;
        circulatingSupply: string;
        totalSupply: string;
        holders: number;
        creator: string;
        publishedAt: string;
        firstTradeAt: string | null;
        verified: boolean;
        decimals: number;
        category: string | null;
        scamLabel: string | null;
    };
    price_change: {
        price: number;
        priceChange1h: number;
        priceChange6h: number;
        priceChange1d: number;
        priceChange7d: number;
        priceChange30d: number;
        price24hLow: number;
        price24hHigh: number;
        ath: number;
        atl: number;
    };
    social_media: {
        x: string | null;
        telegram: string | null;
        website: string | null;
        github: string | null;
        discord: string | null;
        facebook: string | null;
        coingeckoUrl: string | null;
        coinmarketcapUrl: string | null;
        bannerUrl: string | null;
        docs: string | null;
    };
    tags: {
        id: number;
        name: string;
    }[];
    suspicious_labels: string[];
    volume?: {
        volBuy1h: number;
        volSell1h: number;
        volBuy24h: number;
        volSell24h: number;
        volBuy1w: number;
        volSell1w: number;
    } | null | undefined;
    rank?: number | null | undefined;
    security?: {
        mintable: boolean | null;
        blacklist: boolean | null;
        /** Share of supply held by the top 10 holders. */
        top10Holders: number | null;
    } | null | undefined;
}>>;
type TokenDetail = z.infer<typeof tokenDetailSchema>;
/**
 * Compact token record from `getByIds`.
 *
 * Note the upstream field is `decimal`, singular, unlike every other endpoint;
 * it is normalized to `decimals` here.
 */
declare const tokenSummarySchema: z.ZodPipe<z.ZodObject<{
    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    name: z.ZodString;
    symbol: z.ZodString;
    icon_url: z.ZodString;
    website: z.ZodString;
    description: z.ZodString;
    decimal: z.ZodNumber;
    verified: z.ZodBoolean;
    first_trade_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    volume_24h: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    price: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    price_change_1d: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    price_change_7d: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    price_change_30d: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    published_at: z.ZodString;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string | null;
    name: string;
    symbol: string;
    iconUrl: string;
    website: string;
    description: string;
    decimals: number;
    verified: boolean;
    firstTradeAt: string | null;
    volume24h: number | null;
    price: number | null;
    priceChange1d: number | null;
    priceChange7d: number | null;
    priceChange30d: number | null;
    publishedAt: string;
}, {
    name: string;
    symbol: string;
    icon_url: string;
    website: string;
    description: string;
    decimal: number;
    verified: boolean;
    published_at: string;
    coin_type?: string | null | undefined;
    first_trade_at?: string | null | undefined;
    volume_24h?: number | null | undefined;
    price?: number | null | undefined;
    price_change_1d?: number | null | undefined;
    price_change_7d?: number | null | undefined;
    price_change_30d?: number | null | undefined;
}>>;
type TokenSummary = z.infer<typeof tokenSummarySchema>;
declare const tokenListItemSchema: z.ZodPipe<z.ZodObject<{
    coin_type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    name: z.ZodString;
    symbol: z.ZodString;
    logo: z.ZodString;
    price: z.ZodString;
    price_change_5m: z.ZodNumber;
    price_change_30m: z.ZodNumber;
    price_change_1h: z.ZodNumber;
    price_change_6h: z.ZodNumber;
    price_change_1d: z.ZodNumber;
    price_change_7d: z.ZodNumber;
    price_change_30d: z.ZodNumber;
    vol_change_1d: z.ZodNumber;
    liq_change_1d: z.ZodNumber;
    tx_change_1d: z.ZodNumber;
    tx_24h: z.ZodNumber;
    tx_buy_24h: z.ZodNumber;
    tx_sell_24h: z.ZodNumber;
    volume_1h: z.ZodString;
    volume_24h: z.ZodString;
    volume_1w: z.ZodString;
    vol_buy_24h: z.ZodString;
    vol_sell_24h: z.ZodString;
    maker_24h: z.ZodNumber;
    market_cap: z.ZodString;
    liquidity_usd: z.ZodString;
    circulating_supply: z.ZodString;
    total_supply: z.ZodString;
    published_at: z.ZodString;
    first_trade_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    verified: z.ZodBoolean;
    suspicious_labels: z.ZodPipe<z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>, z.ZodTransform<string[], string[] | null | undefined>>;
    rank: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    decimals: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    holders: z.ZodNumber;
    security: z.ZodOptional<z.ZodNullable<z.ZodPipe<z.ZodObject<{
        mintable: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        blacklist: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        top_10_holders: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strip>, z.ZodTransform<{
        mintable: boolean | null;
        blacklist: boolean | null;
        /** Share of supply held by the top 10 holders. */
        top10Holders: number | null;
    }, {
        mintable?: boolean | null | undefined;
        blacklist?: boolean | null | undefined;
        top_10_holders?: number | null | undefined;
    }>>>>;
    boosting_point: z.ZodNumber;
    scam_label: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>, z.ZodTransform<{
    coinId: string | null;
    name: string;
    symbol: string;
    logo: string;
    price: string;
    priceChange5m: number;
    priceChange30m: number;
    priceChange1h: number;
    priceChange6h: number;
    priceChange1d: number;
    priceChange7d: number;
    priceChange30d: number;
    volumeChange1d: number;
    liquidityChange1d: number;
    txChange1d: number;
    tx24h: number;
    txBuy24h: number;
    txSell24h: number;
    volume1h: string;
    volume24h: string;
    volume1w: string;
    volBuy24h: string;
    volSell24h: string;
    maker24h: number;
    marketCap: string;
    liquidityUsd: string;
    circulatingSupply: string;
    totalSupply: string;
    publishedAt: string;
    firstTradeAt: string | null;
    verified: boolean;
    suspiciousLabels: string[];
    rank: number | null;
    decimals: number | null;
    category: string | null;
    holders: number;
    security: {
        mintable: boolean | null;
        blacklist: boolean | null;
        /** Share of supply held by the top 10 holders. */
        top10Holders: number | null;
    } | null;
    boostingPoint: number;
    scamLabel: string | null;
}, {
    name: string;
    symbol: string;
    logo: string;
    price: string;
    price_change_5m: number;
    price_change_30m: number;
    price_change_1h: number;
    price_change_6h: number;
    price_change_1d: number;
    price_change_7d: number;
    price_change_30d: number;
    vol_change_1d: number;
    liq_change_1d: number;
    tx_change_1d: number;
    tx_24h: number;
    tx_buy_24h: number;
    tx_sell_24h: number;
    volume_1h: string;
    volume_24h: string;
    volume_1w: string;
    vol_buy_24h: string;
    vol_sell_24h: string;
    maker_24h: number;
    market_cap: string;
    liquidity_usd: string;
    circulating_supply: string;
    total_supply: string;
    published_at: string;
    verified: boolean;
    suspicious_labels: string[];
    holders: number;
    boosting_point: number;
    coin_type?: string | null | undefined;
    first_trade_at?: string | null | undefined;
    rank?: number | null | undefined;
    decimals?: number | null | undefined;
    category?: string | null | undefined;
    security?: {
        mintable: boolean | null;
        blacklist: boolean | null;
        /** Share of supply held by the top 10 holders. */
        top10Holders: number | null;
    } | null | undefined;
    scam_label?: string | null | undefined;
}>>;
type TokenListItem = z.infer<typeof tokenListItemSchema>;
declare const tokenTradeSchema: z.ZodPipe<z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodNumber;
    action: z.ZodString;
    from_coin_ident: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    from_coin_name: z.ZodString;
    from_coin_symbol: z.ZodString;
    to_coin_ident: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    to_coin_name: z.ZodString;
    to_coin_symbol: z.ZodString;
    price: z.ZodNumber;
    amount_in: z.ZodNumber;
    amount_out: z.ZodNumber;
    usd_value: z.ZodNumber;
    tx_digest: z.ZodString;
    sender: z.ZodString;
    protocol: z.ZodString;
    source: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodString;
}, z.core.$strip>, z.ZodTransform<{
    id: string;
    /** Epoch milliseconds. */
    timestamp: number;
    action: TokenTradeAction;
    fromCoinId: string | null;
    fromCoinName: string;
    fromCoinSymbol: string;
    toCoinId: string | null;
    toCoinName: string;
    toCoinSymbol: string;
    price: number;
    amountIn: number;
    amountOut: number;
    usdValue: number;
    txHash: string;
    sender: string;
    protocol: string;
    source: string | null;
    status: "executed" | "pending";
}, {
    id: string;
    timestamp: number;
    action: string;
    from_coin_name: string;
    from_coin_symbol: string;
    to_coin_name: string;
    to_coin_symbol: string;
    price: number;
    amount_in: number;
    amount_out: number;
    usd_value: number;
    tx_digest: string;
    sender: string;
    protocol: string;
    status: string;
    from_coin_ident?: string | null | undefined;
    to_coin_ident?: string | null | undefined;
    source?: string | null | undefined;
}>>;
type TokenTrade = z.infer<typeof tokenTradeSchema>;
declare const TOKEN_LIST_SORT_BY: readonly ["MARKETCAP", "VOLUME_1H", "VOLUME_1D", "VOLUME_1W", "PUBLISHED_AT", "LIQUIDITY", "TX_COUNT", "PRICE_CHANGE", "PRICE_CHANGE_5MIN", "PRICE_CHANGE_30MIN", "PRICE_CHANGE_1H", "PRICE_CHANGE_4H", "PRICE_CHANGE_6H", "PRICE_CHANGE_1D", "PRICE_CHANGE_1W"];
type TokenListSortBy = (typeof TOKEN_LIST_SORT_BY)[number];
declare const TOKEN_TRADE_ACTIONS: readonly ["buy", "sell", "join", "single_join", "exit", "single_exit"];
type TokenTradeAction = (typeof TOKEN_TRADE_ACTIONS)[number];
/** Every filter the token list supports. All optional; all combine with AND. */
type TokenListFilters = {
    searchTerm?: string;
    coinIds?: string[];
    minMarketCap?: number;
    maxMarketCap?: number;
    minLiquidity?: number;
    maxLiquidity?: number;
    minVolume?: number;
    maxVolume?: number;
    minTop10Holding?: number;
    maxTop10Holding?: number;
    minHolder?: number;
    maxHolder?: number;
    minPrice1hChange?: number;
    maxPrice1hChange?: number;
    minPrice6hChange?: number;
    maxPrice6hChange?: number;
    minPrice24hChange?: number;
    maxPrice24hChange?: number;
    minTxBuy24h?: number;
    maxTxBuy24h?: number;
    minTxSell24h?: number;
    maxTxSell24h?: number;
    minTx24h?: number;
    maxTx24h?: number;
    publishAtFrom?: Date | number;
    publishAtTo?: Date | number;
    hasXSocial?: boolean;
    hasTelegramSocial?: boolean;
    hasDiscordSocial?: boolean;
    hasWebsiteSocial?: boolean;
    hasSocial?: boolean;
    verified?: boolean;
    isBoosted?: boolean;
};
type TokenListParams = PageParams & {
    filters?: TokenListFilters;
    /** @default "VOLUME_1D" */
    sortBy?: TokenListSortBy;
    /** @default "DESC" */
    order?: "ASC" | "DESC";
    /**
     * Reproduce the app's implicit filtering.
     *
     * The backend quietly applies its own filters when none are supplied — a
     * `min_liquidity` of 1000 for most sorts, a three-month publish window for
     * `PUBLISHED_AT`. That makes an "unfiltered" list silently partial. By
     * default the SDK sends an explicit filter to suppress that, so `list()`
     * really does list everything. Set this to reproduce the app's behaviour.
     *
     * @default false
     */
    applyBackendDefaults?: boolean;
    currency?: MinswapCurrency;
};
type TokenOhlcParams = {
    coinId: string;
    from?: Date | number;
    to?: Date | number;
    /** One of {@link VALID_BUCKET_MINUTES}. @default 1 */
    bucketMinutes?: BucketMinutes;
    /** @default 500 */
    limit?: number;
    currency?: MinswapCurrency;
};
type TokenTradeHistoryParams = PageParams & {
    coinId: string;
    /** Inclusive range, epoch-millisecond bounds. The backend caps the span at two months. */
    timeRange?: {
        from: Date | number;
        to: Date | number;
    };
    /** @default ["buy", "sell"] */
    actions?: TokenTradeAction[];
    usdValue?: {
        from?: number;
        to?: number;
    };
    protocols?: string[];
    senders?: string[];
    currency?: MinswapCurrency;
};
type TokenGetByIdOptions = {
    /** Overrides the SDK-wide currency for this call only. */
    currency?: MinswapCurrency;
};
/**
 * Token data: lookup, listing, charts, and trade history.
 *
 * A `coinId` is `policyId.assetNameHex`, or the literal `lovelace` for ADA. The
 * upstream API spells this parameter three different ways depending on the
 * endpoint (`ident`, `coin_id`, `coin_type`); the SDK accepts one name and
 * translates.
 */
declare class TokenModule implements IMinswapModule {
    readonly sdk: MinswapSdk;
    constructor(sdk: MinswapSdk);
    /**
     * Fetch full detail for a single token.
     *
     * @param coinId `policyId.assetNameHex`, or `lovelace` for ADA.
     * @throws {MinswapError} with code `NOT_FOUND` when no such token exists.
     */
    getById(coinId: string, options?: TokenGetByIdOptions): Promise<TokenDetail>;
    /**
     * Fetch compact records for many tokens at once.
     *
     * Requests are chunked at 100 ids, the upstream cap. Tokens that do not
     * exist are simply absent from the result, so the output length may be
     * shorter than the input and the order is not guaranteed to match.
     */
    getByIds(coinIds: string[], options?: TokenGetByIdOptions): Promise<TokenSummary[]>;
    /** List tokens with filtering and sorting. */
    list(params?: TokenListParams): Promise<Page<TokenListItem>>;
    /** OHLC candles for a token, oldest bucket first. */
    getOhlc(params: TokenOhlcParams): Promise<Candle[]>;
    /** Recent trades for a token, newest first. */
    getTradeHistory(params: TokenTradeHistoryParams): Promise<Page<TokenTrade>>;
}

/**
 * The three backends this SDK speaks to.
 *
 * Exposed for advanced use — calling an endpoint the modules do not wrap yet,
 * or inspecting which host a module used. Prefer the modules for normal work.
 */
type MinswapClients = {
    /** Read API: tokens, pools, farms, staking, portfolio. Read-only. */
    appApi: AppApiClient;
    /** Aggregator REST: quoting, building, submitting, cancelling. */
    aggregatorApi: AggregatorApiClient;
    /** key-app-api GraphQL: farm and MIN staking transaction building. */
    keyAppApi: KeyAppApiClient;
    /** app GraphQL: applied pool state (reserves, liquidity, fee) for liquidity quoting. */
    appGraphql: AppGraphqlClient;
};
/**
 * Entry point to the Minswap API.
 *
 * Construct once and reach the modules from it:
 *
 * @example
 * const sdk = new MinswapSdk();
 * const token = await sdk.token.getById("lovelace");
 *
 * @example Raising the rate limit and pinning a currency
 * const sdk = new MinswapSdk({ apiKey: process.env.MINSWAP_API_KEY, currency: "ADA" });
 *
 * The SDK never signs or submits transactions. Action methods return CBOR for
 * you to sign with your own wallet. Some of that CBOR is already partially
 * signed by the server — sign those with `partialSign = true` and assemble
 * rather than replace the witness set.
 */
declare class MinswapSdk {
    readonly config: ResolvedMinswapConfig;
    readonly clients: MinswapClients;
    readonly token: TokenModule;
    readonly pool: PoolModule;
    readonly portfolio: PortfolioModule;
    readonly order: OrderModule;
    readonly aggregator: AggregatorModule;
    readonly farm: FarmModule;
    readonly staking: StakingModule;
    readonly liquidity: LiquidityModule;
    constructor(config?: MinswapSdkConfig);
    /**
     * Chain access, when configured.
     *
     * Present only if an `rpcProvider` was supplied. Farm and staking actions
     * require it; every read works without it.
     */
    get rpcProvider(): RpcProvider | undefined;
}

/**
 * Error model for the Minswap SDK HTTP layer.
 *
 * Two deliberate choices, both departures from patterns seen elsewhere:
 *
 * 1. Every failure throws. Nothing returns `null` to signal an error, so a
 *    caller never has to guess whether a nullish result means "not found",
 *    "network died", or "the backend changed shape".
 * 2. `details` is statically tied to `code` via {@link MinswapErrorDetailsMap},
 *    so narrowing on the code gives you a fully typed payload.
 */
declare enum MinswapErrorCode {
    /** Transport failed outright — DNS, connection reset, CORS, offline. */
    NETWORK = "NETWORK",
    /** The request exceeded the configured timeout and was aborted. */
    TIMEOUT = "TIMEOUT",
    /** HTTP 429. Never retried automatically — see the note on the details type. */
    RATE_LIMITED = "RATE_LIMITED",
    /** The requested resource does not exist (HTTP 404, or an empty singular response). */
    NOT_FOUND = "NOT_FOUND",
    /** Caller passed something the SDK rejected before any request was made. */
    INVALID_PARAMS = "INVALID_PARAMS",
    /** The response did not match its schema — almost always backend drift. */
    PARSE_ERROR = "PARSE_ERROR",
    /** Any other non-2xx HTTP response. */
    API_ERROR = "API_ERROR",
    /** A GraphQL response carried an `errors` array. */
    GRAPHQL_ERROR = "GRAPHQL_ERROR"
}
/** A single schema mismatch, flattened out of Zod so consumers need not depend on it. */
type MinswapParseIssue = {
    /** Dotted path to the offending field, e.g. `data.pools.0.tvl_usd`. */
    path: string;
    message: string;
};
type MinswapGraphQLIssue = {
    message: string;
    path?: (string | number)[];
};
type MinswapErrorDetailsMap = {
    [MinswapErrorCode.NETWORK]: {
        endpoint: string;
        cause?: unknown;
    };
    [MinswapErrorCode.TIMEOUT]: {
        endpoint: string;
        timeoutMs: number;
    };
    [MinswapErrorCode.RATE_LIMITED]: {
        host: string;
        /**
         * From the `Retry-After` header when present, otherwise `null`.
         *
         * Do not busy-retry on this. The app API host blocks a breaching IP for
         * 60 minutes, so retrying turns a momentary throttle into an hour of
         * downtime. The SDK never retries a 429 for this reason.
         */
        retryAfterMs: number | null;
    };
    [MinswapErrorCode.NOT_FOUND]: {
        resource: string;
        id: string;
    };
    [MinswapErrorCode.INVALID_PARAMS]: {
        param: string;
        reason: string;
    };
    [MinswapErrorCode.PARSE_ERROR]: {
        endpoint: string;
        issues: MinswapParseIssue[];
    };
    [MinswapErrorCode.API_ERROR]: {
        endpoint: string;
        status: number;
        body: unknown;
    };
    [MinswapErrorCode.GRAPHQL_ERROR]: {
        operation: string;
        errors: MinswapGraphQLIssue[];
    };
};
type MinswapErrorDetails<T extends MinswapErrorCode> = MinswapErrorDetailsMap[T];
declare class MinswapError<T extends MinswapErrorCode = MinswapErrorCode> extends Error {
    readonly name = "MinswapError";
    readonly code: T;
    readonly details: MinswapErrorDetails<T>;
    constructor(message: string, code: T, details: MinswapErrorDetails<T>);
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
    static is<C extends MinswapErrorCode>(error: unknown, code: C): error is MinswapError<C>;
}

type KupoRpcProviderOptions = {
    /**
     * Base URL of the Kupo instance, e.g. `https://kupo.example.com` or
     * `http://localhost:1442`.
     *
     * A full URL rather than host and port: hosted Kupo providers serve over
     * HTTPS and often behind a path prefix, which a host/port pair cannot express.
     */
    url: string;
    /** Extra headers, for hosted Kupo instances that require an API key. */
    headers?: Record<string, string>;
    /** @default globalThis.fetch */
    fetch?: FetchLike;
    /** @default 30000 */
    timeoutMs?: number;
    retry?: Partial<RetryConfig>;
    /**
     * Maximum simultaneous requests when resolving datums.
     * @default 20
     */
    maxConcurrency?: number;
    /**
     * Turns a Kupo match into UTxO CBOR.
     *
     * Defaults to a lazily-loaded serializer from `@minswap/internal-sdk`, which
     * is Node-only. Supply your own to use a different Cardano library, or to run
     * somewhere that WebAssembly build cannot go.
     */
    serializer?: KupoSerializer;
};
type KupoSerializer = {
    /**
     * @param datum The resolved datum body, when the output has one. Required
     *   for an inline datum, since it forms part of the output's bytes.
     * @returns CBOR hex of a full `TransactionUnspentOutput` (input and output).
     */
    toCborHex(utxo: LedgerKupoUtxo, datum?: string): string;
};
/**
 * {@link RpcProvider} backed by [Kupo](https://github.com/CardanoSolutions/kupo).
 *
 * ## Requirements
 *
 * Producing UTxO CBOR requires a Cardano serializer, which this provider loads
 * from `@minswap/internal-sdk`. That package is an **optional peer dependency**
 * — install it only if you use this provider:
 *
 * ```sh
 * npm install @minswap/internal-sdk
 * ```
 *
 * It ships Node-targeted WebAssembly, so **this provider does not run in a
 * browser**. In a browser, back the SDK with a provider that receives
 * already-serialized UTxOs from a server.
 *
 * ## What this costs
 *
 * Kupo returns JSON, not CBOR, and does not inline datums into a match. A
 * single `getUtxosByAddress` therefore makes one `/matches` request plus one
 * `/datums` request per distinct datum hash found. Datum hashes are deduplicated
 * and fetched concurrently, but an address holding many distinct script outputs
 * will be slower than one holding plain payments.
 *
 * ## Limits
 *
 * Kupo's `/matches` has no server-side pagination, so an address with very many
 * UTxOs returns them all in one response. There is nothing this provider can do
 * about that; be careful pointing it at exchange-scale addresses.
 */
declare class KupoRpcProvider implements RpcProvider {
    private readonly http;
    private readonly baseUrl;
    private readonly headers;
    private readonly maxConcurrency;
    private readonly configuredSerializer;
    private serializer;
    constructor(options: KupoRpcProviderOptions);
    getUtxosByAddress(address: string): Promise<RpcUtxo[]>;
    getUtxosByRefs(refs: RpcTxIn[]): Promise<RpcUtxo[]>;
    private matches;
    private getDatum;
    private toRpcUtxos;
    private toRpcUtxo;
    /**
     * Resolve the serializer on first use.
     *
     * Deferred rather than imported at module scope so consumers who never touch
     * this provider are not made to load a WebAssembly Cardano library.
     */
    private loadSerializer;
}
/** Kupo's match shape as the serializer expects it. */
type LedgerKupoUtxo = {
    transaction_id: string;
    transaction_index: number;
    output_index: number;
    address: string;
    value: {
        coins: bigint;
        assets?: Record<string, bigint>;
    };
    datum_hash: string | null;
    datum_type: "inline" | "hash" | null;
    created_at: {
        slot_no: number;
        header_hash: string;
    };
};

/**
 * Mainnet protocol constants for the liquidity builders, ported from the
 * production `@minswap/sdk`. Values are fixed by the deployed contracts; the SDK
 * targets mainnet only.
 */
/** internal-sdk `NetworkEnvironment.MAINNET`. */
declare const MAINNET_NETWORK_ENV = 764824073;
/** Batcher fee and order min-ADA locked in every liquidity order, in lovelace. */
declare const BATCHER_FEE = 2000000n;
declare const DEPOSIT_ADA = 2000000n;
type DexVersion = "V2" | "STABLESWAP" | "V1";
type DexV2Config = {
    /** LP token policy id (also the pool NFT / authen policy). */
    lpPolicyId: string;
    /** Payment script hash of the order address (a base address is formed with the sender's stake credential). */
    orderScriptHash: string;
    tradingFeeDenominator: bigint;
};
declare const DEX_V2: DexV2Config;
type DexV1Config = {
    lpPolicyId: string;
    orderScriptHash: string;
};
declare const DEX_V1: DexV1Config;

/**
 * The slice of `@minswap/internal-sdk` the liquidity builders use. Declared
 * structurally (with permissive shapes) so the optional peer stays optional at
 * type-check time — the concrete classes are only touched at runtime, after the
 * package is confirmed present.
 */
type DexSerializer = {
    PlutusData: {
        toDataHex(data: PlutusData): string;
    };
    RustModule: {
        load(): Promise<void>;
    };
    [key: string]: any;
};
type DexBuilder = DexSerializer;
/** Serialize an order datum to CBOR hex — the on-chain bytes the batcher reads. */
declare function toDatumHex(datum: PlutusData): Promise<string>;
/**
 * The loaded serializer handle, for the tx-assembly layer. `RustModule.load()`
 * has already run, so every class here is safe to touch.
 */
declare function loadDexBuilder(): Promise<DexBuilder>;

export { AGGREGATOR_PROTOCOLS, type AddLiquidityParams, AggregatorApiClient, type AggregatorApiGetOptions, type AggregatorApiPostOptions, type AggregatorAsset, type AggregatorEstimate, AggregatorModule, type AggregatorPath, type AggregatorProtocol, type Amount, AppApiClient, type AppApiGetOptions, type AppApiPagination, type AppApiPostOptions, type AppApiResult, AppGraphqlClient, type AppGraphqlOperation, type AppliedPool, BATCHER_FEE, type BucketMinutes, type BuildTxParams, CANCEL_ADAPTER_PROTOCOL, type CancelOrderRef, type CancelProtocol, type Candle, type CoinAmountInfo, type CoinBasicInfo, DEFAULT_ENDPOINTS, DEFAULT_RETRY, DEFAULT_TIMEOUT_MS, DEPOSIT_ADA, DEX_V1, DEX_V2, type DexBuilder, type DexV1Config, type DexV2Config, type DexVersion, type EstimateParams, FARM_LIST_SORT_FIELDS, FARM_PROTOCOLS, type FarmDepositParams, type FarmEmergencyWithdrawParams, type FarmHarvestParams, type FarmListParams, type FarmListSortField, FarmModule, type FarmProtocol, type FarmRef, type FarmSummary, type FarmWithdrawParams, type FetchLike, type GetPendingOrdersOptions, HttpCore, type HttpCoreOptions, type HttpRequest, type IMinswapModule, type InputAsset, type InputPair, KeyAppApiClient, type KeyAppApiOperation, KupoRpcProvider, type KupoRpcProviderOptions, type KupoSerializer, type LedgerKupoUtxo, LiquidityModule, type LiquidityPoolRef, MAINNET_NETWORK_ENV, type MinswapClients, type MinswapCurrency, type MinswapEndpoints, MinswapError, MinswapErrorCode, type MinswapErrorDetails, type MinswapErrorDetailsMap, type MinswapGraphQLIssue, type MinswapNetwork, type MinswapParseIssue, MinswapSdk, type MinswapSdkConfig, ORDER_SOURCE_DIRECT, ORDER_STATUSES, type Order, type OrderExtra, type OrderFill, type OrderHistoryParams, type OrderHop, OrderModule, type OrderSplit, type OrderStatus, POOL_CATEGORY_GROUPS, POOL_EVENT_ACTIONS, POOL_FILTER_TYPES, POOL_LIST_SORT_FIELDS, POOL_TYPES, type Page, type PageParams, type PendingOrder, type PoolAsset, type PoolCategoryGroup, type PoolCoin, type PoolEvent, type PoolEventAction, type PoolEventsParams, type PoolFee, type PoolListParams, type PoolListSortField, PoolModule, type PoolOhlcParams, type PoolReward, type PoolState, type PoolSummary, type PoolType, type PoolVersion, type PortfolioDefi, type PortfolioFarmPosition, type PortfolioGetDefiOptions, type PortfolioLpPosition, PortfolioModule, type PortfolioStakingPosition, type Query, type QueryValue, type RemoveLiquidityParams, type ResolvedMinswapConfig, type ResolvedWalletInputs, type RetryConfig, type RpcProvider, type RpcTxIn, type RpcUtxo, type StableswapPoolState, type StakeParams, type StakingKind, StakingModule, type StakingOverview, type StakingPool, type StakingReward, TOKEN_LIST_SORT_BY, TOKEN_TRADE_ACTIONS, type TokenDetail, type TokenGetByIdOptions, type TokenListFilters, type TokenListItem, type TokenListParams, type TokenListSortBy, TokenModule, type TokenOhlcParams, type TokenSummary, type TokenTrade, type TokenTradeAction, type TokenTradeHistoryParams, type UnstakeParams, type UnstakeResult, type V1PoolState, type V2PoolState, VALID_BUCKET_MINUTES, type WalletInputParams, type ZapInParams, type ZapOutParams, arrayOf, assertBucket, assertLimit, assetUnitToCoinId, buildUrl, coinAmountInfoSchema, coinBasicInfoSchema, coinCandleSchema, coinIdToAssetUnit, coinIdToInputAsset, collect, cursorPage, decimalToRaw, decodeOffsetCursor, encodeOffsetCursor, formatTxIn, getAppliedPoolsByLpAssets, getAppliedPoolsByPairs, inputAssetToCoinId, isPureAda, loadDexBuilder, lovelaceOf, offsetPage, paginate, parseTxIn, poolCandleSchema, poolCoinSchema, poolFeeSchema, poolRewardSchema, requireRpcProvider, resolveConfig, resolveWalletInputs, selectCollateral, toBigIntString, toDatumHex, toEpochMs, toEpochSeconds, toRfc3339, zeroableNumber };
