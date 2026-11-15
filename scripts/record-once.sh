#!/usr/bin/env bash
# One cloud recording: collect, publish the archive, then send native updates.
# Used by both workflows. Vercel only deploys commits from the account owner, so commit as him.
# Wrapped in a function so bash reads it all before running: the git pull below can
# rewrite this file mid-run.
main() {
  set -u
  git config user.name "kaidsalem48-ui"
  git config user.email "kaidsalem48@gmail.com"
  git pull --rebase -q origin main || true
  python collect_market_conditions.py || { echo "collect failed"; exit 0; }
  node notify_updates.cjs
  published=1
  if [ -z "$(git status --porcelain -- market-conditions.json notified.json plan.json)" ]; then
    echo "No change to record"
  else
    published=0
    git add -- market-conditions.json notified.json plan.json 2>/dev/null || git add -- market-conditions.json notified.json
    git commit -q -m "Record sourced market conditions for $(TZ=America/New_York date +%F) (cloud)"
    for i in 1 2 3; do
      if git pull --rebase -q origin main && git push -q origin HEAD:main; then published=1; break; fi
      sleep 10
    done
  fi
  if [ "$published" -ne 1 ]; then echo "Archive push failed; native alert withheld"; return 1; fi
  # Vercel's alias may trail the Git push. Do not alert until the same (or newer)
  # sourced recording is publicly readable from the planner.
  python - <<'PY' || { echo "Archive publication not verified; native alert withheld"; return 1; }
import json, time
from datetime import datetime
from urllib.request import Request, urlopen
from pathlib import Path
archive=json.loads(Path('market-conditions.json').read_text(encoding='utf-8'))
day=max(archive['days'])
target=datetime.fromisoformat(archive['days'][day]['recordedAt'].replace('Z','+00:00'))
deadline=time.monotonic()+120
while True:
    try:
        request=Request('https://nq-planner.vercel.app/market-conditions.json?push-ready='+str(time.time()),headers={'User-Agent':'NQPlannerCloudRecorder/1.0'})
        with urlopen(request,timeout=10) as response: live=json.load(response)
        observed=live.get('days',{}).get(day,{}).get('recordedAt')
        if observed and datetime.fromisoformat(observed.replace('Z','+00:00'))>=target:
            print('Published archive verified for',day,observed)
            break
    except Exception as error:
        print('Waiting for published archive:',error)
    if time.monotonic()>=deadline:raise SystemExit('Publication verification timed out')
    time.sleep(5)
PY
  node scripts/dispatch-push.cjs
}
main "$@"
exit
