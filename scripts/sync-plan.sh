#!/usr/bin/env bash
# Merge phone alert picks (published by the site to the private ntfy plan channel) into
# plan.json, and book "News in 2 min" pushes ahead. ntfy keeps messages ~12 hours, so the loop runs this around the clock.
set -u
git config user.name "kaidsalem48-ui"
git config user.email "kaidsalem48@gmail.com"
git pull --rebase -q origin main || true
node notify_updates.cjs --sync-only
if [ -n "$(git status --porcelain -- plan.json notified.json)" ]; then
  git add -- plan.json notified.json 2>/dev/null || git add -- notified.json
  git commit -q -m "Sync phone alert picks and news alerts (cloud)"
  for i in 1 2 3; do
    git pull --rebase -q origin main && git push -q origin HEAD:main && break
    sleep 10
  done
fi
