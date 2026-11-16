#!/usr/bin/env bash
# Keep the long-running recorder checkout current so scheduled native push alerts
# use the latest published rules between recordings.
# Wrapped in a function so bash reads it all before running: git pull can rewrite
# this file mid-run.
main() {
  git pull --rebase -q origin main || true
}
main "$@"
exit
