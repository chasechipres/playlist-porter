#!/usr/bin/env bash
# Claude Code PreToolUse hook: blocks `gh pr create` until README.md has been
# changed on this branch (compared with origin/main), so every PR keeps the
# README in step with the code. Needs only bash and git.

input=$(cat)
case "$input" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git fetch -q origin main 2>/dev/null
base=$(git merge-base HEAD origin/main 2>/dev/null) || exit 0  # can't tell; don't block

if git diff --quiet "$base" HEAD -- README.md; then
  echo "Blocked: README.md is unchanged on this branch. Update README.md for this change and commit it before opening the PR. If the README truly needs nothing, say so to the user and ask them to open the PR themselves." >&2
  exit 2
fi
exit 0
