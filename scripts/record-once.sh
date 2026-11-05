#!/usr/bin/env bash
# One cloud recording: collect, push new phone updates, commit and push the archive.
# Used by both workflows. Vercel only deploys commits from the account owner, so commit as him.
set -u
git config user.name "kaidsalem48-ui"
git config user.email "kaidsalem48@gmail.com"
git pull --rebase -q origin main || true
python collect_market_conditions.py || { echo "collect failed"; exit 0; }
node notify_updates.cjs
if git diff --quiet -- market-conditions.json notified.json; then
  echo "No change to record"
else
  git add market-conditions.json notified.json
  git commit -q -m "Record sourced market conditions for $(TZ=America/New_York date +%F) (cloud)"
  for i in 1 2 3; do
    git pull --rebase -q origin main && git push -q origin HEAD:main && break
    sleep 10
  done
fi
