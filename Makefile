# Send to reMarkable — common tasks. Run `make help` for the list.
.DEFAULT_GOAL := build
.PHONY: help install build rebuild watch run typecheck lint fix clean dist-zip

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

build: ## Production build -> distribution/
	npm run build

rebuild: clean build ## Clean caches and build from scratch

watch: ## Rebuild on change
	npm run watch

run: ## Start Firefox with the extension (rebuild with `make watch` alongside)
	npx web-ext run

typecheck: ## Type-check with tsc
	npx tsc --noEmit

lint: ## Run all linters (xo + stylelint + tsc + web-ext lint)
	npm run lint

fix: ## Auto-fix lint + formatting
	npm run lint-fix

clean: ## Remove build output and caches
	rm -rf distribution .parcel-cache

dist-zip: rebuild ## Build and zip distribution/ for addons.mozilla.org
	npx web-ext build --overwrite-dest --filename 'remarkable-send-{version}.zip'
