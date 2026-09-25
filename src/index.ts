interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * OpenFEMA MCP — US Federal Emergency Management Agency open data.
 *
 * Keyless. API base: https://www.fema.gov/api/open
 *
 * OData-style query params on every dataset endpoint:
 *   $top, $skip, $filter, $select, $orderby, $inlinecount=allpages, $format=json
 *
 * Filter syntax (OData):
 *   field eq 'value'        (string values are single-quoted)
 *   field eq 2024           (numbers/booleans unquoted)
 *   <expr> and <expr>       (combine with `and` / `or`)
 *   e.g. "state eq 'TX' and fyDeclared eq 2023 and incidentType eq 'Fire'"
 *
 * Datasets are VERSIONED (v1/v2/v4 etc.) — each entity has its own current
 * version; the version is part of the path (/v2/DisasterDeclarationsSummaries).
 *
 * Response shape: { metadata: { count, skip, top, ... }, <EntityName>: [...records] }
 * Records live under a key named exactly after the entity (e.g. response.DisasterDeclarationsSummaries).
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Openfema');
}


const BASE = 'https://www.fema.gov/api/open';
const UA = 'pipeworx-mcp-openfema/1.0 (+https://pipeworx.io)';

// Verified live 2026-06: entity name -> current version path segment.
const DATASETS: Record<string, { version: string; description: string }> = {
  DisasterDeclarationsSummaries: {
    version: 'v2',
    description: 'One row per declared disaster + designated area (state, incidentType, declarationType DR/EM/FM, fyDeclared, programs declared).',
  },
  FemaWebDisasterDeclarations: {
    version: 'v1',
    description: 'Disaster-level declaration summary (disasterName, dates, stateName, incidentType).',
  },
  PublicAssistanceFundedProjectsDetails: {
    version: 'v2',
    description: 'Public Assistance grant project detail (applicant, damage category, federal share obligated).',
  },
  IndividualsAndHouseholdsProgramValidRegistrations: {
    version: 'v2',
    description: 'Individuals & Households Program valid registrations (county/fips, damaged location, assistance amounts). Very large.',
  },
  HazardMitigationAssistanceProjects: {
    version: 'v4',
    description: 'Hazard Mitigation Assistance funded projects (programArea, state, county, project amounts).',
  },
  MissionAssignments: {
    version: 'v2',
    description: 'Inter-agency Mission Assignments tied to disasters (supportFunction, agency, obligation amounts).',
  },
  FemaRegions: {
    version: 'v2',
    description: 'The 10 FEMA regions + national office (region number, address, member states). Small reference table.',
  },
};

const ODATA_PARAMS = ['$filter', '$select', '$orderby', '$top', '$skip'];

const tools: McpToolExport['tools'] = [
  {
    name: 'disaster_declarations',
    description:
      "Look up and COUNT US federal disaster declarations (FEMA DisasterDeclarationsSummaries). Filters: state (2-letter), incidentType (e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'), declarationType ('DR' major disaster, 'EM' emergency, 'FM' fire management), year (fyDeclared, the federal FISCAL year), and since/until for a real calendar date range — use since/until for questions like 'in the past year', which a fiscal year does not answer. Counts are DISTINCT DISASTERS by default, not table rows: FEMA publishes one row per disaster per designated county, so Hurricane Harvey is ~60 rows for Texas but one declaration. Pass designatedArea or grain:'area' for county-level rows. Returns the most recent first.",
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: "2-letter state/territory code, e.g. 'CA', 'TX'." },
        year: { type: 'integer', description: 'Federal FISCAL year declared (fyDeclared), e.g. 2024. For a calendar window use since/until instead.' },
        since: { type: 'string', description: "Only declarations on/after this date — ISO 'YYYY-MM-DD'. Use with until for windows like 'the past year'." },
        until: { type: 'string', description: "Only declarations on/before this date — ISO 'YYYY-MM-DD'." },
        incidentType: { type: 'string', description: "Incident type, e.g. 'Fire', 'Flood', 'Hurricane', 'Severe Storm'." },
        declarationType: { type: 'string', description: "'DR' (major disaster), 'EM' (emergency), or 'FM' (fire management)." },
        designatedArea: { type: 'string', description: "Filter to a designated area, e.g. 'Harris (County)'. Implies county-level grain." },
        grain: { type: 'string', enum: ['disaster', 'area'], description: "'disaster' (default) = one record per declaration; 'area' = one record per designated county." },
        limit: { type: 'integer', description: 'Max records (default 50, max 1000).' },
        orderby: { type: 'string', description: "OData $orderby, default 'declarationDate desc'. Live-API path only." },
      },
    },
  },
  {
    name: 'query_dataset',
    description:
      'Generic OData query against any OpenFEMA dataset. Specify the entity name (and optionally version; defaults to the verified current version) plus OData params: filter, select, orderby, top, skip. Use list_datasets to see available entities/versions and the filter syntax. Returns { metadata, records }.',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: "Dataset entity name, e.g. 'PublicAssistanceFundedProjectsDetails'." },
        version: { type: 'string', description: "Path version like 'v1'/'v2'/'v4'. Optional — defaults to the verified current version for known entities." },
        filter: { type: 'string', description: "OData $filter, e.g. \"state eq 'TX' and fyDeclared eq 2023\"." },
        select: { type: 'string', description: 'Comma-separated $select fields, e.g. "disasterNumber,state,incidentType".' },
        orderby: { type: 'string', description: "OData $orderby, e.g. 'declarationDate desc'." },
        top: { type: 'integer', description: 'Max records ($top, default 50, max 1000).' },
        skip: { type: 'integer', description: 'Records to skip ($skip) for paging.' },
      },
      required: ['entity'],
    },
  },
  {
    name: 'list_datasets',
    description:
      'List the OpenFEMA datasets this pack knows about, with their entity name, current version, and a description. Also documents the OData filter syntax and response shape. Call this first to discover what query_dataset can target.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  PROXY =
    typeof args._proxyUrl === 'string' && typeof args._proxyToken === 'string'
      ? { url: args._proxyUrl, token: args._proxyToken }
      : null;
  delete args._proxyUrl;
  delete args._proxyToken;
  switch (name) {
    case 'disaster_declarations': {
      // MIRROR FIRST. FEMA blocks the gateway's egress outright (see femaQuery
      // below), so the live path cannot answer this at all from production —
      // the mirror is the only path that works there. Falls through to the API
      // when the mirror isn't reachable or hasn't loaded yet, which keeps local
      // dev and the pre-first-cron window behaving as before.
      const cfg = mirrorConfig(args);
      if (cfg) {
        const fresh = await mirrorFreshness(cfg);
        if (fresh) return declarationsFromMirror(cfg, args, fresh);
      }
      const clauses: string[] = [];
      const state = args.state as string | undefined;
      const incidentType = args.incidentType as string | undefined;
      const declarationType = args.declarationType as string | undefined;
      const year = args.year;
      if (state?.trim()) clauses.push(`state eq '${odataEscape(state.trim().toUpperCase())}'`);
      if (typeof year === 'number') clauses.push(`fyDeclared eq ${Math.trunc(year)}`);
      if (incidentType?.trim()) clauses.push(`incidentType eq '${odataEscape(incidentType.trim())}'`);
      if (declarationType?.trim()) clauses.push(`declarationType eq '${odataEscape(declarationType.trim().toUpperCase())}'`);

      const params: Record<string, string> = {
        $top: String(clampLimit(args.limit)),
        $orderby: (args.orderby as string | undefined)?.trim() || 'declarationDate desc',
        $inlinecount: 'allpages',
      };
      if (clauses.length) params.$filter = clauses.join(' and ');
      return femaQuery('DisasterDeclarationsSummaries', 'v2', params);
    }
    case 'query_dataset': {
      const entity = reqStr(args, 'entity', '"DisasterDeclarationsSummaries"').trim();
      const known = DATASETS[entity];
      const version = ((args.version as string | undefined)?.trim() || known?.version);
      if (!version) {
        throw new Error(
          `Unknown entity "${entity}". Pass a version (e.g. "v2"), or use one of: ${Object.keys(DATASETS).join(', ')}. Call list_datasets for details.`,
        );
      }
      const params: Record<string, string> = { $inlinecount: 'allpages' };
      if ((args.filter as string | undefined)?.trim()) params.$filter = (args.filter as string).trim();
      if ((args.select as string | undefined)?.trim()) params.$select = (args.select as string).trim();
      if ((args.orderby as string | undefined)?.trim()) params.$orderby = (args.orderby as string).trim();
      params.$top = String(clampLimit(args.top));
      if (typeof args.skip === 'number' && args.skip > 0) params.$skip = String(Math.trunc(args.skip));
      return femaQuery(entity, version, params);
    }
    case 'list_datasets': {
      return {
        apiBase: BASE,
        note: 'Datasets are versioned (v1/v2/v4...). Records are returned under a key named exactly after the entity.',
        responseShape: '{ metadata: { count, top, skip, ... }, <EntityName>: [...records] }',
        odataParams: ODATA_PARAMS.concat(['$inlinecount=allpages', '$format=json']),
        filterSyntax: {
          string: "field eq 'value'  (single-quote string values)",
          number: 'field eq 2024',
          combine: "expr and expr  /  expr or expr",
          example: "state eq 'TX' and fyDeclared eq 2023 and incidentType eq 'Fire'",
        },
        datasets: Object.entries(DATASETS).map(([entity, d]) => ({
          entity,
          version: d.version,
          path: `/${d.version}/${entity}`,
          description: d.description,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// OpenFEMA answers 200 from a residential IP and serves a Drupal 503
// maintenance page to Cloudflare Workers egress — verified 3/3 back-to-back on
// 2026-08-01 (laptop 200 / gateway 503, same second, same query). It is an
// origin-range block, so no key or retry lifts it, and because it arrives as an
// HTML page rather than a refusal the host reads as merely flaky. The gateway
// hands us a non-CF relay (supabase/functions/egress-proxy) via
// _proxyUrl/_proxyToken; set per call, since the pack itself is stateless.
let PROXY: { url: string; token: string } | null = null;

async function femaQuery(entity: string, version: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(params);
  const target = `${BASE}/${version}/${entity}?${qs.toString()}`;
  const headers = { Accept: 'application/json', 'User-Agent': UA };

  const direct = () => pwFetch(target, { headers });
  let res: Response;
  if (!PROXY) {
    res = await direct();
  } else {
    res = await pwFetch(PROXY.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PROXY.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target }),
    });
    // The gateway and the relay deploy on separate tracks, so the gateway can
    // hand us credentials for a relay whose allow-list has not learned this
    // host yet. Fall back to direct rather than failing the call outright.
    if (res.status === 403 || res.status === 404) res = await direct();
  }

  if (!res.ok) {
    const body = await res.text();
    // A 503 carrying an HTML body is the CF-egress block, not a real outage;
    // say so instead of pasting Drupal markup into the caller's answer.
    const looksHtml = /^\s*<(!doctype|html)/i.test(body);
    if (looksHtml) {
      throw new Error(
        `OpenFEMA returned ${res.status} with an HTML page rather than JSON — FEMA blocks datacenter egress ranges, so this call needs the egress relay (EGRESS_PROXY_URL/_TOKEN on the gateway, host www.fema.gov on the relay allow-list).`,
      );
    }
    throw new Error(`OpenFEMA: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const metadata = data.metadata;
  const records = data[entity] ?? [];
  return { metadata, records };
}

/* ------------------------------------------------------------------ */
/* Supabase mirror (supabase/migrations/058_openfema_mirror.sql)        */
/*                                                                     */
/* Loaded by scripts/openfema-upsert.sh on a GitHub runner, because     */
/* FEMA answers Cloudflare Worker egress with a Drupal 503 and answers  */
/* a GH runner with 200 in 0.24s. Verified 2026-08-01.                  */
/* ------------------------------------------------------------------ */

interface MirrorCfg {
  url: string;
  key: string;
}

function mirrorConfig(args: Record<string, unknown>): MirrorCfg | null {
  const url = (args._supabaseUrl as string | undefined)?.trim();
  const key = (args._supabaseKey as string | undefined)?.trim();
  return url && key ? { url, key } : null;
}

/**
 * Last successful load. Returned to the caller alongside the data so a stale
 * mirror is visible rather than passed off as current — the SpaceX mirror
 * served 25-day-old data while its cron reported healthy, and nothing in the
 * response would have told you.
 *
 * null means "no successful load on record", which is the signal to fall back
 * to the live API instead of reporting a confident zero out of an empty table.
 */
async function mirrorFreshness(cfg: MirrorCfg): Promise<{ loaded_at: string; row_count: number } | null> {
  try {
    const rows = await pgJson<{ finished_at: string; row_count: number }[]>(
      cfg,
      'openfema_ingest_runs',
      'status=eq.ok&order=finished_at.desc&limit=1&select=finished_at,row_count',
    );
    const r = rows[0];
    if (!r?.finished_at || !r.row_count) return null;
    return { loaded_at: r.finished_at, row_count: r.row_count };
  } catch {
    return null; // unreachable mirror -> live path, not a hard failure
  }
}

async function pgJson<T>(cfg: MirrorCfg, rel: string, query: string): Promise<T> {
  const res = await pwFetch(`${cfg.url}/rest/v1/${rel}?${query}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
  });
  if (!res.ok) throw new Error(`openfema ${rel}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json() as Promise<T>;
}

/** Same, plus the exact match count from PostgREST's Content-Range header. */
async function pgWithCount<T>(cfg: MirrorCfg, rel: string, query: string): Promise<{ rows: T[]; total: number | null }> {
  const res = await pwFetch(`${cfg.url}/rest/v1/${rel}?${query}`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) throw new Error(`openfema ${rel}: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const rows = (await res.json()) as T[];
  // Content-Range is "0-49/1234"; the tail is the unfiltered-by-limit total.
  const total = Number(res.headers.get('content-range')?.split('/')[1]);
  return { rows, total: Number.isFinite(total) ? total : null };
}

function isoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return s.slice(0, 10);
}

async function declarationsFromMirror(
  cfg: MirrorCfg,
  args: Record<string, unknown>,
  fresh: { loaded_at: string; row_count: number },
): Promise<unknown> {
  const area = (args.designatedArea as string | undefined)?.trim();
  // County grain only when the caller actually asks for it — either explicitly
  // via grain, or implicitly by filtering on a designated area.
  const areaGrain = args.grain === 'area' || !!area;
  const rel = areaGrain ? 'openfema_disaster_declarations' : 'openfema_disasters';

  const f: string[] = [];
  const state = (args.state as string | undefined)?.trim();
  const incidentType = (args.incidentType as string | undefined)?.trim();
  const declarationType = (args.declarationType as string | undefined)?.trim();
  const since = isoDate(args.since);
  const until = isoDate(args.until);

  if (state) f.push(`state=eq.${encodeURIComponent(state.toUpperCase())}`);
  if (typeof args.year === 'number') f.push(`fy_declared=eq.${Math.trunc(args.year)}`);
  if (incidentType) f.push(`incident_type=eq.${encodeURIComponent(incidentType)}`);
  if (declarationType) f.push(`declaration_type=eq.${encodeURIComponent(declarationType.toUpperCase())}`);
  if (since) f.push(`declaration_date=gte.${since}`);
  if (until) f.push(`declaration_date=lte.${until}`);
  if (area) f.push(`designated_area=ilike.*${encodeURIComponent(area)}*`);

  f.push(`order=declaration_date.desc`);
  f.push(`limit=${clampLimit(args.limit)}`);

  const { rows, total } = await pgWithCount<Record<string, unknown>>(cfg, rel, f.join('&'));

  return {
    // The count is the answer to "how many", so lead with it and say what it
    // counts. Naming it `total_disasters` vs `total_designated_areas` is the
    // whole point: the same filters give 730 and 4,086 on the same data.
    [areaGrain ? 'total_designated_areas' : 'total_disasters']: total,
    grain: areaGrain ? 'designated area (one row per county)' : 'disaster (one row per declaration per state)',
    returned: rows.length,
    records: rows,
    source: 'FEMA OpenFEMA DisasterDeclarationsSummaries',
    mirror: {
      loaded_at: fresh.loaded_at,
      rows_in_mirror: fresh.row_count,
      note: 'Freshness is the load time above, not the moment you called.',
    },
  };
}

function clampLimit(v: unknown): number {
  const n = typeof v === 'number' && v > 0 ? Math.trunc(v) : 50;
  return Math.min(n, 1000);
}

function odataEscape(v: string): string {
  return v.replace(/'/g, "''");
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
