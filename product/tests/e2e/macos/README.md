# macOS Retina E2E lane

This lane proves the product seam on one controlled macOS 14+ Retina machine. A normal Vitest run skips every real-desktop assertion. Only `run.sh` can set the `CUA_MACOS_PREFLIGHT=passed` marker after checking the machine, signed Runtime, permissions, exact lock version and display.

## Prerequisites

- An unlocked, logged-in Aqua session owned by the user running the test.
- Node.js 22.21–22.x or 24.5+, Google Chrome and a built product checkout.
- The unmodified `/Applications/CuaDriver.app`, or an absolute path supplied as `CUA_E2E_CUA_APP_PATH`.
- Cua Screen Recording and Accessibility grants. Use the upstream signed-app flow: `cua-driver permissions grant`.
- An engine installed at the exact version in `engine.lock.json`.
- A new absolute output path outside the repository for `CUA_E2E_EVIDENCE_PATH`.

The development lane is diagnostic and always non-promotable. The candidate lane accepts only a formally staged SemVer whose source commit contains every locked required fix; it deliberately requires `release_eligible:false`. Task 15 alone may validate and promote candidate evidence.

`CUA_REPEAT` counts complete deterministic iterations. Each iteration starts fresh fixture/browser/MCP processes, executes the full nine-action desktop lane and its freshness assertion, then runs the Retina click/drag checks plus one exact-window discovery, semantic-element background click, fresh-window-state assertion, and bounded window-area check. The controlled permission contract and disruptive real Runtime restart lane run once after all deterministic iterations. Evidence is written only if every iteration and both platform gates pass.

## Measure the content origin

The two origin values are the location of the fixture's top-left content pixel in the **full Cua screenshot pixel frame**. They are not CSS coordinates.

1. Start the loopback fixture and open its URL in Chrome with the fixed `1280x800`, 100%-zoom app-window arguments used in `retina.spec.ts`.
2. Capture the full primary display through Cua/`computer_observe`.
3. In that actual PNG, locate the fixture's visible yellow square with red right/bottom edges at CSS `(0,0)`.
4. Measure the screenshot-pixel coordinate of the marker's top-left pixel and provide it as `CUA_E2E_CONTENT_ORIGIN_X_PX` and `CUA_E2E_CONTENT_ORIGIN_Y_PX`.
5. Keep window placement and display configuration unchanged for the run. Re-measure after any display, scaling, browser or window-manager change.

`window.screenX`, `window.screenY`, browser-reported borders and guessed title-bar offsets are diagnostic only and are never accepted as evidence. Missing injected values are a hard failure. The click and drag tests validate the measurement against the fixture's independent `/state` oracle.

## Run

Development smoke:

```bash
cd product
CUA_E2E=1 \
CUA_E2E_MODE=development \
CUA_REPEAT=1 \
CUA_E2E_CONTENT_ORIGIN_X_PX=<measured-x> \
CUA_E2E_CONTENT_ORIGIN_Y_PX=<measured-y> \
CUA_E2E_EVIDENCE_PATH=/absolute/private/path/macos-development.json \
bash tests/e2e/macos/run.sh
```

Candidate gate:

```bash
cd product
CUA_E2E=1 \
CUA_E2E_MODE=candidate \
CUA_REPEAT=20 \
CUA_E2E_CONTENT_ORIGIN_X_PX=<measured-x> \
CUA_E2E_CONTENT_ORIGIN_Y_PX=<measured-y> \
CUA_E2E_EVIDENCE_PATH=/absolute/private/path/macos-candidate.json \
bash tests/e2e/macos/run.sh
```

The runner refuses to overwrite evidence. It writes mode/version/asset, protocol fingerprint, OS/architecture, screenshot size/scale/origin, permission booleans, redacted app location, bundle ID, TeamIdentifier, designated-requirement hash, Gatekeeper status and aggregate pass counts. It never writes image bytes, entered text, key content, clipboard data, model messages, arbitrary environment values, usernames or hostnames. Do not commit real evidence to this repository.

If preflight reports `engine_version_mismatch`, install the exact staged version through the reviewed development setup flow. Do not edit the lock or mark evidence passed to accommodate a different local Runtime.
