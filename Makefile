# Akasha 构建与检查入口：本地开发和 CI 共用同一套目标。
.DEFAULT_GOAL := help
CHECKS ?= all
IMAGE ?= akasha-hub:dev
TEST_ARGS ?=

help: ## 列出所有目标
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-15s %s\n", $$1, $$2}'

install: ## 安装依赖
	pnpm install --frozen-lockfile

lint: ## 代码、依赖方向与提交检查（Biome + 架构边界 + TypeScript + Commit 规范）
	pnpm lint
	$(MAKE) typecheck
	@if [ -n "$$COMMIT_RANGE" ]; then python3 scripts/ci/check-commits.py "$$COMMIT_RANGE"; fi

typecheck: ## 单独运行 TypeScript 类型检查
	pnpm typecheck

test: ## 运行单元测试
	pnpm test $(TEST_ARGS)

build: ## 构建所有工作区产物
	pnpm build

dev: ## 启动前端和沙盒热更新（5173/5174，后端需另起 make serve）
	pnpm dev

serve: build ## 构建并启动完整应用（工作台、后端和沙盒，无源码热更新）
	node packages/akasha/dist/cli.js serve

hub-image: ## 构建单容器 Cloud Hub 镜像
	docker build --file deploy/docker/Dockerfile --tag "$(IMAGE)" .

format: ## 自动格式化代码
	pnpm format

clean: ## 清理构建产物
	rm -rf dist coverage packages/*/dist apps/*/dist

.PHONY: help install lint typecheck test build dev serve hub-image format clean
