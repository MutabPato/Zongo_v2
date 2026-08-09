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
  MATRIX="${EVIDENCE_DIR}/parity-matrix.csv"
  test -f "$MATRIX" || {
    echo 'release gate incomplete: parity-matrix.csv is missing' >&2
    exit 1
  }
  awk -F, '
    BEGIN {
      expected["overview"] = 1
      expected["operations-search"] = 1
      expected["transaction-investigation"] = 1
      expected["transaction-recovery"] = 1
      expected["reconciliation"] = 1
      expected["verification"] = 1
      expected["beneficiaries"] = 1
      expected["alerts"] = 1
      expected["pilot-readiness"] = 1
      expected["audit"] = 1
      expected["admin-controls"] = 1
      required_roles["SUPPORT"] = 1
      required_roles["OPS"] = 1
      required_roles["ADMIN"] = 1
    }
    NR == 1 {
      if ($1 != "workflow" || $13 != "unit_evidence" || $14 != "api_evidence" || $15 != "browser_evidence" || $16 != "status")
        invalid = 1
      next
    }
    NF < 16 || $1 == "" || $3 == "" || $13 == "" || $14 == "" || $15 == "" {
      invalid = 1
    }
    {
      workflows[$1] = 1
      roles[$3] = 1
      pairs[$1 ":" $3] = 1
      status = tolower($16)
      if (status == "pass" || status == "passed" || status == "complete" || status == "verified")
        passed[$1 ":" $3] = 1
    }
    END {
      for (workflow in expected) {
        if (!workflows[workflow]) missing = 1
        for (role in required_roles) {
          pair = workflow ":" role
          if (!pairs[pair] || !passed[pair]) missing = 1
        }
      }
      if (!roles["SUPPORT"] || !roles["OPS"] || !roles["ADMIN"]) missing = 1
      if (invalid || missing) exit 1
    }
  ' "$MATRIX" || {
    echo 'release gate incomplete: parity matrix is malformed, incomplete, or lacks passing evidence for every workflow/role' >&2
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
