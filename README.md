# App Router route handlers get duplicate `.rsc` routes and outputs

Minimal reproduction for Next.js 16.3.1.

Every App Router **route handler** (`route.js` / `route.ts`) is duplicated during
`handleBuildComplete`:

1. dynamic handlers get a second entry in `routing.dynamicRoutes`, matching `.rsc` and
   `.segments/*.segment.rsc`
2. every handler gets a second output in `outputs.appRoutes`, pointing at the same built asset

A route handler returns a `Response`. It has no RSC payload and no segment tree, so the duplicates
cannot serve a request. They are written to disk regardless.

## The app

Four route handlers, nothing else:

```
app/api/hello/route.js                      static
app/api/[tenantId]/route.js                 dynamic, one param
app/api/[tenantId]/items/route.js           dynamic, one param
app/api/[tenantId]/items/[itemId]/route.js  dynamic, two params
```

No pages are authored. `scripts/probe-adapter.cjs` is a no-op adapter that only prints what Next.js
passes to `onBuildComplete`; it pulls in no provider packages, so the duplication below originates in
Next.js itself.

## Run

```bash
npm install
npm run build
```

### Expected

```
routing.dynamicRoutes (3)
outputs.appRoutes (4)
```

### Actual

```
  routing.dynamicRoutes (6)
    /api/[tenantId].rsc
    /api/[tenantId]
    /api/[tenantId]/items.rsc
    /api/[tenantId]/items
    /api/[tenantId]/items/[itemId].rsc
    /api/[tenantId]/items/[itemId]

  outputs.appRoutes (8)
    /api/[tenantId]/items/[itemId]  (type APP_ROUTE, from /api/[tenantId]/items/[itemId]/route)
    /api/[tenantId]/items/[itemId].rsc  (type APP_ROUTE, from /api/[tenantId]/items/[itemId]/route)
    /api/[tenantId]/items  (type APP_ROUTE, from /api/[tenantId]/items/route)
    /api/[tenantId]/items.rsc  (type APP_ROUTE, from /api/[tenantId]/items/route)
    /api/[tenantId]  (type APP_ROUTE, from /api/[tenantId]/route)
    /api/[tenantId].rsc  (type APP_ROUTE, from /api/[tenantId]/route)
    /api/hello  (type APP_ROUTE, from /api/hello/route)
    /api/hello.rsc  (type APP_ROUTE, from /api/hello/route)

  duplicate outputs share a filePath:
    /api/[tenantId] and /api/[tenantId].rsc -> same  (.next/server/app/api/[tenantId]/route.js)
    ...
```

Both members of each pair carry `type: APP_ROUTE` and a `sourcePage` ending in `/route`, so the
information needed to tell a handler from a page is present at the point of duplication.

## The duplicates are written to disk

```bash
npm run verify:files
```

Rebuilds with a real adapter attached and walks the emitted output:

```
function directories written for 4 route handlers: 8

  .next/output/functions/api/[tenantId].func
  .next/output/functions/api/[tenantId].rsc.func   <- unreachable duplicate
  .next/output/functions/api/[tenantId]/items.func
  .next/output/functions/api/[tenantId]/items.rsc.func   <- unreachable duplicate
  .next/output/functions/api/[tenantId]/items/[itemId].func
  .next/output/functions/api/[tenantId]/items/[itemId].rsc.func   <- unreachable duplicate
  .next/output/functions/api/hello.func
  .next/output/functions/api/hello.rsc.func   <- unreachable duplicate
```

Each `.rsc.func` is a full copy of its twin, traced dependencies included. This scales linearly, so an
API-only app doubles both its routing table and its emitted function count.

## Root cause

Both sites are in `packages/next/src/build/adapter/build-complete.ts`.

### 1. Dynamic route emission

```js
if (appPageKeys && appPageKeys.length > 0) {
    dynamicRoutes.push({
        source: route.page + '.rsc',
        sourceRegex: sourceRegex.replace(..., '(?<rscSuffix>\\.rsc|\\.segments/.+\\.segment\\.rsc)(?:/)?$'),
        destination: destination?.replace(/($|\?)/, '$rscSuffix$1'),
        ...
    });
}
```

The guard asks whether the app has *any* App Router entries, not whether *this* route is an App Router
page. Any app with at least one app-dir entry gets an `.rsc` route for every dynamic route, route
handlers included. In a hybrid app this reaches Pages Router dynamic routes as well.

### 2. Output emission

```js
if (output.type === AdapterOutputType.APP_PAGE) {
    outputs.appPages.push({ ...output, pathname: normalizePagePath(output.pathname) + '.rsc', id: ... });
    outputs.appPages.push(output);
} else {
    outputs.appRoutes.push(output);
    outputs.appRoutes.push({ ...output, pathname: normalizePagePath(output.pathname) + '.rsc', id: ... });
}
```

The `else` branch is `APP_ROUTE` and pushes an `.rsc` twin unconditionally. This is inconsistent with
an earlier site in the same function, which gates the identical operation:

```js
// need to add matching .rsc output
if (isAppPage) {
    const rscPathname = normalizePagePath(output.pathname) + '.rsc';
    outputs.appPages.push({ ...output, pathname: rscPathname, id: page.name + '.rsc' });
}
```

The signal is already computed in this file when typing the output:

```js
type: page.endsWith('/route') ? AdapterOutputType.APP_ROUTE : AdapterOutputType.APP_PAGE
```

and `isAppRouteRoute()` in `packages/next/src/lib/is-app-route-route.ts` is its canonical form.

## Suggested fix

Build the set of App Router *page* pathnames once and test each route against it:

```ts
import { isAppRouteRoute } from '../../lib/is-app-route-route'
import { normalizeAppPath } from '../../shared/lib/router/utils/app-paths'

const appPagePathnames = new Set(
  (appPageKeys ?? [])
    .filter((appPath) => !isAppRouteRoute(appPath))
    .map((appPath) => normalizeAppPath(appPath))
)
```

Site 1:

```diff
- if (appPageKeys && appPageKeys.length > 0) {
+ if (appPagePathnames.has(route.page)) {
      dynamicRoutes.push({
          source: route.page + '.rsc',
```

Site 2:

```diff
  } else {
      outputs.appRoutes.push(output)
-     outputs.appRoutes.push({
-         ...output,
-         pathname: normalizePagePath(output.pathname) + '.rsc',
-         id: normalizePagePath(output.pathname) + '.rsc',
-     })
  }
```

`appPageKeys` is passed as `denormalizedAppPages`, so entries keep their `/page` and `/route` suffixes
and `isAppRouteRoute` applies directly. `normalizeAppPath` brings them into the same shape as
`route.page` from the routes manifest.

Applying both locally yields the expected counts, with all plain route entries and the generic
`rscSuffix` fallback route preserved.

## Open questions for maintainers

- Metadata routes (`sitemap.ts`, `robots.ts`, `opengraph-image.tsx`) are also `APP_ROUTE`. They serve
  bytes rather than RSC payloads, so dropping their `.rsc` twin looks correct, but worth confirming
  nothing internally requests `/sitemap.xml.rsc`.
- After the change, a request for `/some/handler.rsc` 404s instead of being rewritten to the handler.
  That appears correct, but it is a behaviour change.
- Site 1's guard currently also applies to Pages Router dynamic routes in hybrid apps. The proposed
  condition changes that too; worth confirming it is not load-bearing.

## Environment

```
Next.js  16.3.1 (Turbopack)
Node     24.x
```

Also reproduces on `next@canary` (16.3.1-canary.24) with identical counts:

```bash
npm install next@canary
npm run build
```

Code above is quoted from the compiled `next/dist/build/adapter/build-complete.js`. The source file is
`packages/next/src/build/adapter/build-complete.ts`.
