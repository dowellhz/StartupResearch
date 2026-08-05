#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_HOST="${REMOTE_HOST:-nlvcadmin@57.158.28.133}"
SSH_KEY="${SSH_KEY:-/Users/linlu/Downloads/nlvc.com.pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/nlvcadmin/startup-research}"
SERVICE_NAME="${SERVICE_NAME:-startup-research.service}"
PORT="${PORT:-1235}"
REMOTE_BIND_HOST="${REMOTE_BIND_HOST:-127.0.0.2}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-https://check.nlvcwiki.com/api/health}"
MAX_REMOTE_DELETIONS="${MAX_REMOTE_DELETIONS:-300}"
REQUIRE_OPENALEX="${REQUIRE_OPENALEX:-0}"
DEPLOY_BRANCH="main"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

require_command git
require_command npm
require_command node
require_command ssh
require_command rsync
require_command curl
[ -f "$SSH_KEY" ] || fail "SSH key not found: $SSH_KEY"
[[ "$MAX_REMOTE_DELETIONS" =~ ^[0-9]+$ ]] || fail "MAX_REMOTE_DELETIONS must be a non-negative integer"
[[ "$REQUIRE_OPENALEX" =~ ^[01]$ ]] || fail "REQUIRE_OPENALEX must be 0 or 1"

log "Verifying release tree"
git fetch --quiet origin "$DEPLOY_BRANCH"
[ "$(git branch --show-current)" = "$DEPLOY_BRANCH" ] || fail "deployment requires branch $DEPLOY_BRANCH"
[ -z "$(git status --porcelain --untracked-files=normal)" ] || fail "working tree must be clean"
DEPLOY_COMMIT="$(git rev-parse HEAD)"
[ "$DEPLOY_COMMIT" = "$(git rev-parse origin/$DEPLOY_BRANCH)" ] || fail "HEAD must equal origin/$DEPLOY_BRANCH"

log "Running release checks"
npm run check

SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
remote() {
  ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "$@"
}

log "Checking remote target"
remote "test -d '$REMOTE_DIR' && test -f '$REMOTE_DIR/.env' && systemctl cat '$SERVICE_NAME' >/dev/null"
BACKUP_DIR="/home/nlvcadmin/startup-research-backups/$DEPLOY_COMMIT-$(date -u '+%Y%m%dT%H%M%SZ')"
remote "mkdir -p '$BACKUP_DIR' && tar -C '$REMOTE_DIR' --exclude=.env --exclude=data --exclude=node_modules --exclude=output --exclude=tmp -czf '$BACKUP_DIR/app.tgz' ."

RSYNC_ARGS=(
  -az
  --delete
  --exclude=.git/
  --exclude=.env
  --exclude=data/
  --exclude=node_modules/
  --exclude=output/
  --exclude=tmp/
)
log "Previewing remote changes"
DELETE_PREVIEW="$(rsync "${RSYNC_ARGS[@]}" --dry-run --itemize-changes -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" ./ "$REMOTE_HOST:$REMOTE_DIR/")"
DELETE_COUNT="$(printf '%s\n' "$DELETE_PREVIEW" | awk '/^\*deleting/{count++} END{print count+0}')"
[ "$DELETE_COUNT" -le "$MAX_REMOTE_DELETIONS" ] || fail "remote deletion count $DELETE_COUNT exceeds limit $MAX_REMOTE_DELETIONS"

log "Syncing committed application ($DELETE_COUNT managed deletions)"
rsync "${RSYNC_ARGS[@]}" -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" ./ "$REMOTE_HOST:$REMOTE_DIR/"

log "Installing production dependencies and restarting service"
remote "cd '$REMOTE_DIR' && npm ci --omit=dev && sudo cp ops/startup-research.service /etc/systemd/system/startup-research.service && sudo systemctl daemon-reload && sudo systemctl restart '$SERVICE_NAME'"

log "Checking service health"
HEALTH=""
for _attempt in $(seq 1 20); do
  HEALTH="$(remote "curl -fsS 'http://$REMOTE_BIND_HOST:$PORT/api/health'" 2>/dev/null || true)"
  [ -n "$HEALTH" ] && break
  sleep 1
done
[ -n "$HEALTH" ] || fail "remote health check failed"
HEALTH_PAYLOAD="$HEALTH" EXPECT_OPENALEX="$REQUIRE_OPENALEX" node -e '
const health = JSON.parse(process.env.HEALTH_PAYLOAD || "{}");
if (health.ok !== true) process.exit(1);
if (!Array.isArray(health.zeroKeyResearchTools) || health.zeroKeyResearchTools.length < 7) process.exit(2);
if (process.env.EXPECT_OPENALEX === "1" && health.keyedResearchTools?.openalex_research_search !== true) process.exit(3);
'

PUBLIC_HEALTH="$(curl -fsS "$PUBLIC_HEALTH_URL")"
HEALTH_PAYLOAD="$PUBLIC_HEALTH" EXPECT_OPENALEX="$REQUIRE_OPENALEX" node -e '
const health = JSON.parse(process.env.HEALTH_PAYLOAD || "{}");
if (health.ok !== true) process.exit(1);
if (process.env.EXPECT_OPENALEX === "1" && health.keyedResearchTools?.openalex_research_search !== true) process.exit(2);
'
DEPLOYED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
remote "cd '$REMOTE_DIR' && printf '{\n  \"commit\": \"%s\",\n  \"ref\": \"main\",\n  \"deployedAt\": \"%s\"\n}\n' '$DEPLOY_COMMIT' '$DEPLOYED_AT' > .deployment-version.json"
REMOTE_VERSION="$(remote "node -e 'const value=require(\"$REMOTE_DIR/.deployment-version.json\");process.stdout.write(String(value.commit||\"\"))'")"
[ "$REMOTE_VERSION" = "$DEPLOY_COMMIT" ] || fail "remote deployment version mismatch"
remote "systemctl is-active --quiet '$SERVICE_NAME'"
log "Deployment complete: $DEPLOY_COMMIT"
