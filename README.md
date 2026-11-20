# Send to reMarkable (unofficial)

A Firefox extension that sends what you are reading to a reMarkable tablet,
through the reMarkable cloud:

- **PDFs and ePubs** are sent as they are. The extension keeps a copy of the
  document as the tab loads it, so one-time download links, POST responses and
  signed URLs work too; otherwise it downloads the file again (with your
  cookies, from the cache when possible).
- **Web pages** are turned into an ePub of their main article (Readability,
  the extraction behind Firefox's Reader View), images included.
- **Links**: right-click a link to send what it points to.

The cloud protocol comes from
[remarkable-annotations](https://github.com/bpiwowar/remarkable-annotations)'s
sans-I/O client (WebAssembly, a port of rmapi-js): the library decides which
requests to make, the extension makes them.

Not affiliated with reMarkable AS.

## Use

1. Open the extension's options, get a one-time code from
   [my.remarkable.com](https://my.remarkable.com/device/browser/connect) and
   connect. The device token is kept in the extension's local storage.
2. Optionally choose a destination folder (e.g. `Web/Articles`; created if
   missing).
3. Click the toolbar button and *Send* (the name can be changed first), or use
   the *Send page / link to reMarkable* menu entries.

## Architecture

```
source/
  manifest.json      MV3 manifest (Firefox)
  background.ts      menus, messages, send flow, notifications and badge
  capture.ts         copies PDF/ePub responses as tabs load them
                     (webRequest.filterResponseData), kept in IndexedDB
  document.ts        what to send for a tab or a link: captured bytes, the live
                     DOM (article), or a new download; type sniffing
  article.ts         Readability → cleaned XHTML, images fetched and embedded
  epub.ts            minimal EPUB 3 writer (fflate)
  cloud.ts           drives remarkable-annotations' cloud operations with fetch
  settings.ts        stored settings (device token, folder, images)
  popup/, options/   toolbar popup and options page
scripts/
  firefox-manifest.mjs  drops the service_worker key Parcel needs but Firefox ignores
tests/               node:test + jsdom: article → ePub, sniffing, file names
```

## Develop

```bash
nvm use            # Node 24
npm install
make watch         # Parcel watch -> distribution/
make run           # Firefox with the extension loaded (web-ext run)
```

Or load `distribution/manifest.json` from `about:debugging` → *This Firefox* →
*Load Temporary Add-on*.

## Quality gates

`npm test` runs XO, stylelint, `tsc --noEmit`, the unit tests and
`web-ext lint` (on a production build). A husky pre-commit hook runs
lint-staged; a commit-msg hook checks Conventional Commits. `make dist-zip`
builds the archive for addons.mozilla.org.

## Limits

- Firefox only (`filterResponseData`).
- `file://` documents and privileged pages (`about:`, addons.mozilla.org)
  cannot be sent.
- Articles are what Readability extracts; pages that are not articles may give
  little.

## License

MIT
