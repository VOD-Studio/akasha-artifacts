# Akasha 构建与检查入口：本地开发和 CI 共用同一套目标。
.DEFAULT_GOAL := help
CHECKS ?= all

help: ## 列出所有目标
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

install: ## 安装依赖
	pnpm install --frozen-lockfile

lint: ## 代码与提交检查（Biome + TypeScript + Commit 规范）
	pnpm lint
	pnpm typecheck
	@if [ -n "$$COMMIT_RANGE" ]; then python3 scripts/ci/check-commits.py "$$COMMIT_RANGE"; fi

test: ## 运行单元测试
	pnpm test

build: ## 构建产物到 dist/
	pnpm build

format: ## 自动格式化代码
	pnpm format

clean: ## 清理构建产物
	rm -rf dist coverage

.PHONY: help install lint test build format clean
