#!/usr/bin/env sh
set -eu

EVIDENCE_DIR="${1:-infra/admin-panel/evidence}"
REQUIRE_COMPLETE="${2:-}"
MANIFEST="${EVIDENCE_DIR}/local-release-manifest.json"

test -f "$MANIFEST" || {
  echo "missing release manifest: ${MANIFEST}" >&2
  exit 1
}

jq -e '
  (.releaseId | type == "string" and length > 0) and
  (.frontendImageDigest | test("^sha256:[0-9a-f]{64}$")) and
  (.backendImageDigest | test("^sha256:[0-9a-f]{64}$")) and
  (.gitSha | type == "string" and length > 0) and
  (.apiContract == "/admin/v1") and
  (.route == "/backoffice") and
  (.rollbackTarget == "adminjs") and
  (.routeGateDryRun.panelEnabled == true) and
  (.routeGateDryRun.adminJsRollback == true)
' "$MANIFEST" >/dev/null

for required_file in \
  local-smoke-report.md \
  deployment-rollback.md \
  security-data-audit.md \
  exceptions.md \
  approvals.md \
  unit-api-report.txt; do
  test -f "${EVIDENCE_DIR}/${required_file}" || {
    echo "missing evidence artifact: ${required_file}" >&2
    exit 1
  }
done

if [ "$REQUIRE_COMPLETE" = '--require-complete' ]; then
  test -f "${EVIDENCE_DIR}/parity-matrix.csv" || {
    echo 'release gate incomplete: parity-matrix.csv is missing' >&2
    exit 1
  }
  test -d "${EVIDENCE_DIR}/browser-report" || {
    echo 'release gate incomplete: browser-report is missing' >&2
    exit 1
  }
  jq -e '
    .approvals.engineering == true and
    .approvals.operationsOwner == true and
    .approvals.security == true and
    .routeGateDryRun.liveTraefikRehearsed == true
  ' "$MANIFEST" >/dev/null || {
    echo 'release gate incomplete: approvals or live rollback evidence is missing' >&2
    exit 1
  }
  grep -Eqi 'not yet rehearsed|pending|not release-complete' \
    "${EVIDENCE_DIR}/deployment-rollback.md" && {
    echo 'release gate incomplete: deployment rollback evidence is still pending' >&2
    exit 1
  }
fi

echo "evidence pack structure passed: ${EVIDENCE_DIR}"
