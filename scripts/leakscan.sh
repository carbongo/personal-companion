#!/usr/bin/env bash
# Leak gate for this public repository. Blocks publishing anything private:
#
#   1. secrets           — gitleaks over the commits being published
#   2. private terms     — the maintainer's own denylist (names, places, IDs, hosts)
#                          over the added lines and commit messages
#   3. private files     — .env, databases, persona/, data/, import/, *.local.md
#
# The denylist lives OUTSIDE the repo (it is itself private), one fixed string per
# line, '#' for comments, matched case-insensitively:
#   ${LEAK_DENYLIST:-~/.config/personal-companion/leak-denylist}
# A missing or empty denylist is a failure, not a pass.
#
# Usage:
#   scripts/leakscan.sh                 commits not on any remote, plus uncommitted changes
#   scripts/leakscan.sh <commit>...     exactly these commits (the pre-push hook)
#
# See docs/security.md ("Publishing safely").
set -euo pipefail

DENYLIST="${LEAK_DENYLIST:-$HOME/.config/personal-companion/leak-denylist}"
# Files a private term may legitimately appear in (the copyright line).
EXCLUDE=(':(exclude)LICENSE')
FORBIDDEN='(^|/)\.env($|\.)|\.db(-wal|-shm)?$|^(persona|data|import)/|\.local\.md$'

fail=0
say() { printf '%s\n' "$*" >&2; }

command -v gitleaks >/dev/null || {
	say "leakscan: gitleaks is not installed (brew install gitleaks) — refusing."
	exit 1
}
terms=$(grep -v '^[[:space:]]*#' "$DENYLIST" 2>/dev/null | sed '/^[[:space:]]*$/d' || true)
[ -n "$terms" ] || {
	say "leakscan: no private denylist at $DENYLIST — refusing."
	exit 1
}

if [ $# -gt 0 ]; then
	commits=("$@")
	worktree=0
else
	commits=()
	while read -r c; do commits+=("$c"); done < <(git rev-list HEAD --not --remotes)
	worktree=1
fi

# Everything that would become public: each commit's message and added lines.
added() {
	for c in ${commits[@]+"${commits[@]}"}; do
		git log -1 --format='%B' "$c"
		git show --format= --unified=0 --no-color "$c" -- . "${EXCLUDE[@]}" |
			grep -E '^\+' | grep -vE '^\+\+\+ ' || true
	done
	if [ "$worktree" = 1 ]; then
		git diff HEAD --unified=0 --no-color -- . "${EXCLUDE[@]}" |
			grep -E '^\+' | grep -vE '^\+\+\+ ' || true
	fi
}

# 1. secrets
if [ ${#commits[@]} -gt 0 ]; then
	if ! gitleaks detect --source . --no-banner --redact \
		--log-opts="--no-walk ${commits[*]}" >&2; then
		say "leakscan: gitleaks found a secret in the commits above."
		fail=1
	fi
fi
# Uncommitted changes to tracked files (new untracked files are checked once
# committed — the pre-push hook is the gate that counts).
if [ "$worktree" = 1 ] && ! git diff HEAD --no-color | gitleaks stdin --no-banner --redact >&2; then
	say "leakscan: gitleaks found a secret in the uncommitted changes."
	fail=1
fi

# 2. private terms
hits=$(added | grep -inF -f <(printf '%s\n' "$terms") || true)
if [ -n "$hits" ]; then
	say "leakscan: private terms in what would be published:"
	say "$(printf '%s\n' "$hits" | cut -c1-160)"
	fail=1
fi

# 3. private files
files=$(
	for c in ${commits[@]+"${commits[@]}"}; do git show --format= --name-only "$c"; done
	[ "$worktree" = 1 ] && git diff HEAD --name-only
	true
)
bad=$(printf '%s\n' "$files" | grep -E "$FORBIDDEN" | grep -v '^\.env\.example$' | sort -u || true)
if [ -n "$bad" ]; then
	say "leakscan: private files would be published:"
	say "$bad"
	fail=1
fi

if [ "$fail" = 0 ]; then
	say "leakscan: clean (${#commits[@]} commit(s) checked)."
fi
exit "$fail"
