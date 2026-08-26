import { http, HttpResponse, type RequestHandler } from "msw";

/**
 * INTENTIONALLY EMPTY.
 *
 * Combined with `onUnhandledRequest: "error"` in vitest.setup.ts, this forces
 * every test to declare the requests it expects via `server.use(...)`. A global
 * handler list would let a component quietly fire an unexpected Supabase call and
 * still pass — which is precisely the bug class this silo exists to catch.
 */
export const handlers: RequestHandler[] = [];

// ============================================================
// Helpers for per-test server.use(...) calls
// ============================================================
// Paths are matched with a leading wildcard so tests never depend on which
// Supabase URL the local env happens to be pointing at.

/** PostgREST table endpoint, e.g. supabaseUrl("/rest/v1/organizations"). */
export const supabaseUrl = (path: string) => `*${path}`;

/** Edge function endpoint, e.g. edgeFn("envelopes_send"). */
export const edgeFn = (name: string) => `*/functions/v1/${name}`;

/** Cloudflare Worker file endpoint (ENVs.ViteR2WorkerUrl). */
export const workerFile = (path: string) => `*/${path.replace(/^\//, "")}`;

/** 200 with a JSON body. */
export const ok = (body: unknown = [], init?: ResponseInit) =>
    HttpResponse.json(body as never, { status: 200, ...init });

/** A PostgREST-shaped error response. */
export const supabaseError = (message: string, status = 400, code = "PGRST000") =>
    HttpResponse.json({ message, code, details: null, hint: null } as never, { status });

export { http, HttpResponse };
