# Synthetic Chromium workspace regression

This isolated package exercises the **actual production-built Next.js UI in
Chromium**, not jsdom or a replacement component harness. It does not alter Web
production dependencies. Playwright Test is exactly pinned in `package.json`
and `package-lock.json`; its official installer selects the matching Chromium
revision. CI follows the [official Playwright GitHub Actions guidance](https://playwright.dev/docs/ci).

## Scope and safety

- Mobile drawer focus wrapping, Escape/focus restoration, navigation, desktop
  resize and removal of the background `inert` state.
- Native layout geometry: horizontal header/cell alignment, vertical sticky
  header position and bounded rendered rows after scrolling the 10,000-row lab.
- Inline commit/cancel; company switching clears lab edits and unfinished input.
- Production customer list cannot create inline editors when it is read-only.
- Workspace tab activation, duplicate prevention and active-tab close fallback.

Each test has an isolated browser context with a synthetic, unsigned JWT-shaped
localStorage identity and two synthetic companies. **Authentication is mocked**;
this suite does not validate login, authorization enforcement, API persistence,
real user UAT or production readiness. Existing HTTP/PostgreSQL tests and manual
business sign-off remain necessary. Every API request must match an explicit
GET fixture with a synthetic company header. Unknown APIs, writes and external
network requests are aborted and fail the test; browser exceptions also fail.
No production host, API keys, passwords or repository secrets are used. The
server binds only to loopback, with API fallback pointed at an unused local port.

## Run

From the repository root in a permitted browser-install environment:

```sh
npm ci --prefix apps/web
npm ci --prefix e2e
npm --prefix e2e run audit:security
(cd e2e && npx --no-install playwright install --with-deps chromium)
NEXT_PUBLIC_API_BASE_URL=/api/proxy API_BASE_URL=http://127.0.0.1:9 npm --prefix apps/web run build
npm --prefix e2e test
```

For static discovery without downloading or starting a browser:

```sh
npm --prefix e2e run test:list
```

CI installs official Chromium on the GitHub-hosted runner, not this restricted
workspace. There is no third-party binary or alternate browser-download mirror.
The `browser-workspace` job is required by the existing `validate` aggregator;
failed, skipped and cancelled browser jobs cannot make that gate green.

Bounds: one worker, no retries, 30 seconds/test, 5 minutes/test run, 60 seconds
server startup, 5 seconds graceful shutdown, 10 minutes browser installation,
20 minutes/job. Playwright owns and stops the Web process; it never reuses an
existing server. CI retains HTML reports, failure traces/screenshots and a
synthetic scroll screenshot for seven days. These reports contain only fixtures,
not real business data. A listed/static test is **not a browser pass**: record the
exact commit and successful GitHub run before claiming browser verification.
