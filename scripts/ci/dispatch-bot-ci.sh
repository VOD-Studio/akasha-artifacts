#!/usr/bin/env bash
# 为机器人 PR 手动触发 CI，并删掉 GitHub 自动生成的重复运行。
# 用法：dispatch-bot-ci.sh <仓库> <分支>，GH_TOKEN 需要 actions: write。
set -euo pipefail

REPO="$1"
BRANCH="$2"

gh workflow run ci.yml -R "$REPO" --ref "$BRANCH"
sleep 10
gh run list -R "$REPO" --branch "$BRANCH" --event pull_request --status action_required \
  --json databaseId --jq '.[].databaseId' |
  while read -r id; do
    gh api -X DELETE "repos/$REPO/actions/runs/$id"
    echo "已删除等待批准的重复运行 $id"
  done
