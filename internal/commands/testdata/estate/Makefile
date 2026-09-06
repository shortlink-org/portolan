# The stubs are generated from the contracts vendored in this tree.
GRPC := internal/transport/grpc
BIN ?= bin/pricing

.PHONY: help
help: ## List the targets
	@grep -E '^[a-z].*##' $(MAKEFILE_LIST)

.PHONY: gen build
gen: ## Regenerate the gRPC stubs
	buf generate $(GRPC)/quote/proto -o $(GRPC)/quote/gen
	buf generate $(GRPC)/price_list/proto -o $(GRPC)/price_list/gen

# Compiles every package. Nothing is installed.
build:
	go build ./...

test lint: build
	go test ./...

_internal:
	@true

$(BIN): build
	cp out $(BIN)

%.pb.go: %.proto
	protoc $<

ifeq ($(CI),1)
ci: test
	@echo done
endif
