#!/bin/bash

set -euo pipefail

fail() {
  printf 'macOS E2E preflight failed: %s\n' "$1" >&2
  exit 1
}

if [[ "${CUA_E2E:-0}" != "1" ]]; then
  printf 'SKIP: CUA_E2E=1 is required for real macOS desktop evidence\n'
  exit 0
fi

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PRODUCT_DIR="$(cd -- "${SCRIPT_DIR}/../../.." && pwd -P)"
readonly LOCK_PATH="${PRODUCT_DIR}/engine.lock.json"
readonly MODE="${CUA_E2E_MODE:-}"
readonly REPEAT="${CUA_REPEAT:-}"
readonly ORIGIN_X="${CUA_E2E_CONTENT_ORIGIN_X_PX:-}"
readonly ORIGIN_Y="${CUA_E2E_CONTENT_ORIGIN_Y_PX:-}"
readonly EVIDENCE_PATH="${CUA_E2E_EVIDENCE_PATH:-}"

[[ "$(uname -s)" == "Darwin" ]] || fail "Darwin is required"
[[ "${MODE}" == "development" || "${MODE}" == "candidate" ]] || fail "CUA_E2E_MODE must be development or candidate"
[[ "${REPEAT}" =~ ^[1-9][0-9]*$ ]] || fail "CUA_REPEAT must be an integer from 1 to 100"
(( 10#${REPEAT} <= 100 )) || fail "CUA_REPEAT must not exceed 100"
if [[ "${MODE}" == "candidate" ]]; then
  (( 10#${REPEAT} >= 20 )) || fail "candidate mode requires CUA_REPEAT of at least 20"
fi
[[ "${ORIGIN_X}" =~ ^[0-9]+$ && "${ORIGIN_Y}" =~ ^[0-9]+$ ]] || fail "inject measured screenshot-pixel content origin X/Y"
(( 10#${ORIGIN_X} <= 32767 && 10#${ORIGIN_Y} <= 32767 )) || fail "measured content origin exceeds the supported screenshot frame"
[[ "${EVIDENCE_PATH}" == /* ]] || fail "CUA_E2E_EVIDENCE_PATH must be a new absolute path"
[[ ! -e "${EVIDENCE_PATH}" ]] || fail "evidence path already exists; refusing to overwrite"
[[ -d "$(dirname -- "${EVIDENCE_PATH}")" ]] || fail "evidence parent directory does not exist"

readonly NODE_BIN="$(command -v node || true)"
[[ -n "${NODE_BIN}" && -x "${NODE_BIN}" ]] || fail "Node.js is required"
"${NODE_BIN}" -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major<22 || (major===22 && minor<19)) process.exit(1)' \
  || fail "Node.js 22.19 or newer is required"

readonly APP_PATH="${CUA_E2E_CUA_APP_PATH:-/Applications/CuaDriver.app}"
[[ "${APP_PATH}" == /* && -d "${APP_PATH}" ]] || fail "CUA_E2E_CUA_APP_PATH must name an installed absolute .app path"
readonly CUA_EXECUTABLE="${APP_PATH}/Contents/MacOS/cua-driver"
[[ -x "${CUA_EXECUTABLE}" ]] || fail "Cua executable is missing from the reviewed app bundle"

cd "${PRODUCT_DIR}"
npx --yes pnpm@9.0.4 build >/dev/null || fail "product build failed"
[[ -f "${PRODUCT_DIR}/dist/mcp/main.js" && -f "${PRODUCT_DIR}/dist/cli/main.js" ]] || fail "built MCP and CLI entrypoints are required"

LOCK_FIELDS="$("${NODE_BIN}" --input-type=module -e '
  import { readFile } from "node:fs/promises";
  const path = process.argv[1];
  const mode = process.argv[2];
  const lock = JSON.parse(await readFile(path, "utf8"));
  const hex40 = /^[0-9a-f]{40}$/;
  const hex64 = /^[0-9a-f]{64}$/;
  const semver = /^\d+\.\d+\.\d+$/;
  const mac = lock.platforms?.macos;
  if (lock.engine !== "cua-driver" || !semver.test(lock.version) || lock.tag !== `cua-driver-rs-v${lock.version}`) throw new Error("lock is not one formal pinned Cua release");
  if (!hex40.test(lock.source_commit) || !Array.isArray(lock.required_fix_commits) || !lock.required_fix_commits.every((value) => hex40.test(value))) throw new Error("lock commit metadata is malformed");
  if (mac?.development_eligible !== true || mac.release_eligible !== false) throw new Error("runner requires development eligible and release eligible false");
  if (!hex64.test(mac.sha256) || mac.asset !== `cua-driver-rs-${lock.version}-darwin-universal.tar.gz`) throw new Error("locked macOS asset is malformed");
  if (mode === "candidate" && lock.required_fix_commits.length === 0) throw new Error("candidate lock has no required fixes");
  const pkg = JSON.parse(await readFile(new URL("./package.json", `file://${process.cwd()}/`), "utf8"));
  if (pkg.dependencies?.["@trycua/cua-driver"] !== lock.version) throw new Error("npm SDK and engine lock versions differ");
  process.stdout.write([lock.version, lock.tag, lock.source_commit, mac.asset, mac.sha256].join("\t"));
' "${LOCK_PATH}" "${MODE}" 2>/dev/null)" || fail "engine lock is not a valid staged macOS candidate"
readonly LOCK_FIELDS
IFS=$'\t' read -r LOCK_VERSION LOCK_TAG LOCK_COMMIT LOCK_ASSET LOCK_ASSET_SHA <<<"${LOCK_FIELDS}"
readonly LOCK_VERSION LOCK_TAG LOCK_COMMIT LOCK_ASSET LOCK_ASSET_SHA

readonly INSTALLED_VERSION="$("${CUA_EXECUTABLE}" --version 2>/dev/null | sed -E -n 's/^cua-driver ([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -n 1)"
[[ -n "${INSTALLED_VERSION}" ]] || fail "installed Cua version could not be read"
[[ "${INSTALLED_VERSION}" == "${LOCK_VERSION}" ]] || fail "engine_version_mismatch (installed ${INSTALLED_VERSION}, locked ${LOCK_VERSION})"

if [[ "${MODE}" == "candidate" ]]; then
  "${NODE_BIN}" --input-type=module -e '
    import { readFile } from "node:fs/promises";
    const lock = JSON.parse(await readFile(process.argv[1], "utf8"));
    for (const fix of lock.required_fix_commits) {
      const response = await fetch(`https://api.github.com/repos/trycua/cua/compare/${fix}...${lock.source_commit}`, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`cannot verify required fix ancestry (${response.status})`);
      const comparison = await response.json();
      if (comparison.status !== "ahead" && comparison.status !== "identical") throw new Error(`required fix ${fix} is absent from staged release`);
    }
  ' "${LOCK_PATH}" >/dev/null || fail "candidate required-fix ancestry could not be proven"
fi

readonly OS_VERSION="$(sw_vers -productVersion)"
readonly OS_MAJOR="${OS_VERSION%%.*}"
[[ "${OS_MAJOR}" =~ ^[0-9]+$ ]] || fail "macOS version could not be parsed"
(( OS_MAJOR >= 14 )) || fail "macOS 14 or newer is required"
readonly ARCHITECTURE="$(uname -m)"
[[ "${ARCHITECTURE}" == "arm64" || "${ARCHITECTURE}" == "x86_64" ]] || fail "unsupported macOS architecture"

readonly CONSOLE_USER="$(stat -f%Su /dev/console)"
[[ "${CONSOLE_USER}" == "$(id -un)" && "${CONSOLE_USER}" != "root" && "${CONSOLE_USER}" != "loginwindow" ]] \
  || fail "an interactive Aqua console owned by the current user is required"
launchctl print "gui/$(id -u)" >/dev/null 2>&1 || fail "the interactive Aqua launch domain is unavailable"
readonly SESSION_JSON="$(/usr/sbin/ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers json -o - - 2>/dev/null)"
"${NODE_BIN}" -e '
  const sessions=JSON.parse(process.argv[1]);
  const user=process.argv[2];
  const current=sessions.find((item)=>item.kCGSSessionOnConsoleKey===true && item.kCGSessionLoginDoneKey===true && item.kCGSSessionUserNameKey===user);
  if (!current || current.CGSSessionScreenIsLocked===true) process.exit(1);
' "${SESSION_JSON}" "${CONSOLE_USER}" || fail "the Aqua desktop is locked"

readonly BROWSER="${CUA_E2E_BROWSER:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[[ "${BROWSER}" == /* && -x "${BROWSER}" ]] || fail "a fixed Google Chrome executable is required"

codesign --verify --deep --strict "${APP_PATH}" >/dev/null 2>&1 || fail "Cua app code signature is invalid"
spctl --assess --type execute "${APP_PATH}" >/dev/null 2>&1 || fail "Gatekeeper did not accept the Cua app"
readonly SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "${APP_PATH}" 2>&1)"
readonly TEAM_ID="$(printf '%s\n' "${SIGNATURE_DETAILS}" | sed -E -n 's/^TeamIdentifier=([A-Z0-9]{10})$/\1/p' | head -n 1)"
readonly BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw -o - "${APP_PATH}/Contents/Info.plist" 2>/dev/null)"
[[ "${TEAM_ID}" =~ ^[A-Z0-9]{10}$ ]] || fail "signed TeamIdentifier is missing"
[[ "${BUNDLE_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{2,127}$ ]] || fail "signed bundle identifier is malformed"
readonly REQUIREMENT="$(codesign -d -r- "${APP_PATH}" 2>&1 | sed -E -n 's/^designated => //p')"
[[ -n "${REQUIREMENT}" ]] || fail "designated requirement is missing"
readonly REQUIREMENT_SHA="$(printf '%s' "${REQUIREMENT}" | shasum -a 256 | awk '{print $1}')"
readonly APP_PATH_SHA="$(printf '%s' "${APP_PATH}" | shasum -a 256 | awk '{print $1}')"
if [[ "${APP_PATH}" == "/Applications/CuaDriver.app" ]]; then
  readonly APP_LOCATION="/Applications/CuaDriver.app"
else
  readonly APP_LOCATION="<redacted-custom-path>"
fi

/usr/bin/open "${APP_PATH}" >/dev/null 2>&1 || fail "Cua app could not be launched"
PERMISSION_GRANTED=0
for _permission_probe in {1..40}; do
  PERMISSION_JSON="$("${CUA_EXECUTABLE}" permissions status --json 2>/dev/null)" || PERMISSION_JSON=""
  if [[ -n "${PERMISSION_JSON}" ]] && "${NODE_BIN}" -e '
    const root=JSON.parse(process.argv[1]);
    let accessibility=false;
    let screenRecording=false;
    const visit=(value)=>{
      if (!value || typeof value!=="object") return;
      for (const [key,child] of Object.entries(value)) {
        const normalized=key.toLowerCase().replace(/[^a-z]/g,"");
        if (normalized==="accessibility" && child===true) accessibility=true;
        if (normalized==="screenrecording" && child===true) screenRecording=true;
        visit(child);
      }
    };
    visit(root);
    if (!accessibility || !screenRecording) process.exit(1);
  ' "${PERMISSION_JSON}"; then
    PERMISSION_GRANTED=1
    break
  fi
  sleep 0.25
done
readonly PERMISSION_JSON PERMISSION_GRANTED
(( PERMISSION_GRANTED == 1 )) || fail "Screen Recording and Accessibility must both be granted to the signed Cua app"

set +e
DOCTOR_JSON="$("${NODE_BIN}" "${PRODUCT_DIR}/dist/cli/main.js" doctor --json 2>/dev/null)"
DOCTOR_STATUS=$?
set -e
(( DOCTOR_STATUS == 0 )) || fail "computer-use doctor failed"
readonly DOCTOR_JSON
DOCTOR_FIELDS="$("${NODE_BIN}" -e '
  const report=JSON.parse(process.argv[1]);
  const locked=process.argv[2];
  if (report.ok!==true || report.platform!=="macos" || report.expected_engine_version!==locked || report.reported_engine_version!==locked || report.engine_connected!==true || report.required_tools_present!==true || report.desktop_unlocked!==true || report.observation_succeeded!==true) process.exit(1);
  if (!Number.isInteger(report.screenshot?.width) || report.screenshot.width<=0 || !Number.isInteger(report.screenshot?.height) || report.screenshot.height<=0) process.exit(1);
  process.stdout.write(`${report.screenshot.width}\t${report.screenshot.height}`);
' "${DOCTOR_JSON}" "${LOCK_VERSION}")" || fail "doctor did not prove the exact engine and a positive desktop screenshot"
readonly DOCTOR_FIELDS
IFS=$'\t' read -r DOCTOR_WIDTH DOCTOR_HEIGHT <<<"${DOCTOR_FIELDS}"
readonly DOCTOR_WIDTH DOCTOR_HEIGHT

DISPLAY_PROBE="$("${NODE_BIN}" --input-type=module -e '
  import { CuaEngine } from "./dist/engine/cua.js";
  import { loadEngineLock } from "./dist/engine/lock.js";
  const lock=await loadEngineLock();
  const engine=await CuaEngine.connect(lock);
  try {
    const observed=await engine.observe(new AbortController().signal);
    process.stdout.write([observed.platform, observed.image.width, observed.image.height, observed.scaleFactor].join("\t"));
  } finally {
    await engine.close();
  }
' 2>/dev/null)" || fail "Cua display probe failed"
readonly DISPLAY_PROBE
IFS=$'\t' read -r DISPLAY_PLATFORM DISPLAY_WIDTH DISPLAY_HEIGHT BACKING_SCALE <<<"${DISPLAY_PROBE}"
readonly DISPLAY_PLATFORM DISPLAY_WIDTH DISPLAY_HEIGHT BACKING_SCALE
[[ "${DISPLAY_PLATFORM}" == "macos" && "${DISPLAY_WIDTH}" == "${DOCTOR_WIDTH}" && "${DISPLAY_HEIGHT}" == "${DOCTOR_HEIGHT}" ]] \
  || fail "doctor and Cua display probes disagree"
"${NODE_BIN}" -e 'const scale=Number(process.argv[1]); if (!Number.isFinite(scale) || scale<=1) process.exit(1)' "${BACKING_SCALE}" \
  || fail "the primary display backing scale must be greater than 1"

export CUA_MACOS_PREFLIGHT="passed"
export CUA_E2E_BROWSER="${BROWSER}"
export CUA_E2E_CUA_APP_PATH="${APP_PATH}"
export CUA_E2E_CUA_EXECUTABLE="${CUA_EXECUTABLE}"
export CUA_E2E_BACKING_SCALE="${BACKING_SCALE}"

for (( E2E_ITERATION = 1; E2E_ITERATION <= 10#${REPEAT}; E2E_ITERATION += 1 )); do
  printf 'macOS deterministic iteration %d/%d\n' "${E2E_ITERATION}" "${REPEAT}"
  CUA_REPEAT=1 npx --yes pnpm@9.0.4 exec vitest run tests/e2e/shared tests/e2e/macos/retina.spec.ts --sequence.concurrent=false
done

# Permission mapping and the disruptive real Runtime restart are platform
# gates, not deterministic action iterations. Run them exactly once after all
# full shared+Retina iterations succeed.
CUA_REPEAT=1 npx --yes pnpm@9.0.4 exec vitest run tests/e2e/macos/permissions.spec.ts --sequence.concurrent=false

export EVIDENCE_MODE="${MODE}"
export EVIDENCE_REPEAT="${REPEAT}"
export EVIDENCE_OS_VERSION="${OS_VERSION}"
export EVIDENCE_ARCHITECTURE="${ARCHITECTURE}"
export EVIDENCE_WIDTH="${DISPLAY_WIDTH}"
export EVIDENCE_HEIGHT="${DISPLAY_HEIGHT}"
export EVIDENCE_SCALE="${BACKING_SCALE}"
export EVIDENCE_ORIGIN_X="${ORIGIN_X}"
export EVIDENCE_ORIGIN_Y="${ORIGIN_Y}"
export EVIDENCE_APP_LOCATION="${APP_LOCATION}"
export EVIDENCE_APP_PATH_SHA="${APP_PATH_SHA}"
export EVIDENCE_BUNDLE_ID="${BUNDLE_ID}"
export EVIDENCE_TEAM_ID="${TEAM_ID}"
export EVIDENCE_REQUIREMENT_SHA="${REQUIREMENT_SHA}"
export EVIDENCE_PATH="${EVIDENCE_PATH}"

"${NODE_BIN}" --input-type=module -e '
  import { createHash } from "node:crypto";
  import { readFile, writeFile } from "node:fs/promises";
  import { PUBLIC_TOOL_SCHEMAS } from "./dist/protocol.js";
  const lock=JSON.parse(await readFile("./engine.lock.json", "utf8"));
  const integer=(name)=>{
    const value=Number(process.env[name]);
    if (!Number.isInteger(value)) throw new Error(`${name} is not an integer`);
    return value;
  };
  const number=(name)=>{
    const value=Number(process.env[name]);
    if (!Number.isFinite(value)) throw new Error(`${name} is not finite`);
    return value;
  };
  const sha256=(value)=>createHash("sha256").update(value).digest("hex");
  const evidence={
    schema_version: 1,
    platform: "macos",
    mode: process.env.EVIDENCE_MODE,
    generated_at: new Date().toISOString(),
    promotion_authority: "task15-only",
    release_eligible_at_test: false,
    engine: {
      name: "cua-driver",
      version: lock.version,
      tag: lock.tag,
      source_commit: lock.source_commit,
      asset: lock.platforms.macos.asset,
      asset_sha256: lock.platforms.macos.sha256,
      required_fix_commits: lock.required_fix_commits,
    },
    contract_fingerprint_sha256: sha256(JSON.stringify(PUBLIC_TOOL_SCHEMAS)),
    system: {
      os_version: process.env.EVIDENCE_OS_VERSION,
      architecture: process.env.EVIDENCE_ARCHITECTURE,
      interactive_aqua: true,
      desktop_unlocked: true,
      permissions: { accessibility: "granted", screen_recording: "granted" },
      display: {
        screenshot_width: integer("EVIDENCE_WIDTH"),
        screenshot_height: integer("EVIDENCE_HEIGHT"),
        backing_scale: number("EVIDENCE_SCALE"),
        content_origin_x: integer("EVIDENCE_ORIGIN_X"),
        content_origin_y: integer("EVIDENCE_ORIGIN_Y"),
        origin_source: "injected-visible-marker-measurement",
      },
    },
    signature: {
      app_location: process.env.EVIDENCE_APP_LOCATION,
      app_path_sha256: process.env.EVIDENCE_APP_PATH_SHA,
      bundle_id: process.env.EVIDENCE_BUNDLE_ID,
      team_identifier: process.env.EVIDENCE_TEAM_ID,
      designated_requirement_sha256: process.env.EVIDENCE_REQUIREMENT_SHA,
      codesign: "valid",
      gatekeeper: "accepted",
    },
    results: {
      repeat_requested: integer("EVIDENCE_REPEAT"),
      repeat_completed: integer("EVIDENCE_REPEAT"),
      plugin_seam_failures: 0,
      shared_lane: "passed",
      retina_lane: "passed",
      permission_contract_lane: "passed-controlled-fixture",
      restart_lane: "passed-real-runtime",
    },
  };
  const forbidden=/(screenshot_data|typed_text|prompt|environment|clipboard|keys_pressed)/i;
  if (forbidden.test(JSON.stringify(evidence))) throw new Error("sensitive evidence field detected");
  await writeFile(process.env.EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
'

if [[ "${MODE}" == "development" ]]; then
  printf 'PASS: development evidence is non-promotable; Task 15 is the only promotion authority\n'
else
  printf 'PASS: candidate evidence remains release_eligible=false pending Task 15 promotion\n'
fi
