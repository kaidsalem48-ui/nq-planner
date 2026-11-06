#!/usr/bin/env bash
# Merge phone alert picks (published by the site to the private ntfy plan channel) into
# plan.json. ntfy keeps messages ~12 hours, so the loop runs this around the clock.
set -u
git config user.name "kaidsalem48-ui"
git config user.email "kaidsalem48@gmail.com"
git pull --rebase -q origin main || true
node notify_updates.cjs --sync-only
if [ -n "$(git status --porcelain -- plan.json)" ]; then
  git add -- plan.json
  git commit -q -m "Sync phone alert picks (cloud)"
  for i in 1 2 3; do
    git pull --rebase -q origin main && git push -q origin HEAD:main && break
    sleep 10
  done
fi
