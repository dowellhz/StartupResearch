#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_HOST="${REMOTE_HOST:-}"
SSH_KEY="${SSH_KEY:-}"
REMOTE_DIR="${REMOTE_DIR:-}"
SERVICE_NAME="${SERVICE_NAME:-startup-research.service}"
SERVICE_USER="${SERVICE_USER:-}"
SERVICE_GROUP="${SERVICE_GROUP:-}"
PORT="${PORT:-}"
REMOTE_BIND_HOST="${REMOTE_BIND_HOST:-}"
PUBLIC_HEALTH_URL="${PUBLIC_HEALTH_URL:-}"
MAX_REMOTE_DELETIONS="${MAX_REMOTE_DELETIONS:-300}"
REQUIRE_OPENALEX="${REQUIRE_OPENALEX:-0}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-}"
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
[ -n "$REMOTE_HOST" ] || fail "REMOTE_HOST is required"
[ -n "$SSH_KEY" ] || fail "SSH_KEY is required"
[ -n "$REMOTE_DIR" ] || fail "REMOTE_DIR is required"
[ -n "$REMOTE_BACKUP_DIR" ] || fail "REMOTE_BACKUP_DIR is required"
[ -n "$PORT" ] || fail "PORT is required"
[ -n "$REMOTE_BIND_HOST" ] || fail "REMOTE_BIND_HOST is required"
[ -n "$SERVICE_USER" ] || fail "SERVICE_USER is required"
[ -n "$SERVICE_GROUP" ] || fail "SERVICE_GROUP is required"
[ -f "$SSH_KEY" ] || fail "SSH key not found: $SSH_KEY"
[[ "$REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "REMOTE_DIR contains unsupported characters"
[[ "$REMOTE_BACKUP_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "REMOTE_BACKUP_DIR contains unsupported characters"
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || fail "SERVICE_NAME is invalid"
[[ "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "SERVICE_USER is invalid"
[[ "$SERVICE_GROUP" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "SERVICE_GROUP is invalid"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "PORT must be numeric"
[[ "$REMOTE_BIND_HOST" =~ ^[A-Za-z0-9:.-]+$ ]] || fail "REMOTE_BIND_HOST is invalid"
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
[ -z "$(git status --porcelain --untracked-files=normal)" ] || fail "generated public assets changed during checks; run npm run build:public and commit them before deployment"

SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
remote() {
  ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "$@"
}

log "Checking remote target"
remote "test -d '$REMOTE_DIR' && test -f '$REMOTE_DIR/.env' && systemctl cat '$SERVICE_NAME' >/dev/null"
DEEPSEEK_KEY_FIELDS="$(remote "grep -c '^DEEPSEEK_API_KEY=' '$REMOTE_DIR/.env'")"
[ "$DEEPSEEK_KEY_FIELDS" = "1" ] || fail "remote .env must contain exactly one DEEPSEEK_API_KEY field"
if [ -z "$PUBLIC_HEALTH_URL" ]; then
  PUBLIC_BASE_URL_FIELDS="$(remote "grep -c '^PUBLIC_BASE_URL=' '$REMOTE_DIR/.env'")"
  [ "$PUBLIC_BASE_URL_FIELDS" = "1" ] || fail "remote .env must contain exactly one PUBLIC_BASE_URL field"
  PUBLIC_BASE_URL="$(remote "sed -n 's/^PUBLIC_BASE_URL=//p' '$REMOTE_DIR/.env'")"
  [ -n "$PUBLIC_BASE_URL" ] || fail "remote PUBLIC_BASE_URL must not be empty"
  PUBLIC_HEALTH_URL="${PUBLIC_BASE_URL%/}/api/health"
fi
remote "systemctl cat '$SERVICE_NAME' | grep -Fq 'EnvironmentFile=$REMOTE_DIR/.env'" || fail "service must load credentials from $REMOTE_DIR/.env"
BACKUP_DIR="$REMOTE_BACKUP_DIR/$DEPLOY_COMMIT-$(date -u '+%Y%m%dT%H%M%SZ')"
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
remote "cd '$REMOTE_DIR' && npm ci --omit=dev && sed -e 's|__SERVICE_USER__|$SERVICE_USER|g' -e 's|__SERVICE_GROUP__|$SERVICE_GROUP|g' -e 's|__REMOTE_DIR__|$REMOTE_DIR|g' ops/startup-research.service > '/tmp/$SERVICE_NAME' && sudo install -m 0644 '/tmp/$SERVICE_NAME' '/etc/systemd/system/$SERVICE_NAME' && rm -f '/tmp/$SERVICE_NAME' && sudo systemctl daemon-reload && sudo systemctl restart '$SERVICE_NAME'"

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
