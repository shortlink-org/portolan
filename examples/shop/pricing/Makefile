# The stubs are generated from the contracts vendored in this tree, one call per
# module, into the gen directory beside the code that uses it.
GRPC := internal/infrastructure/transport/grpc

.PHONY: gen
gen:
	buf generate $(GRPC)/quote/proto -o $(GRPC)/quote/gen
	buf generate $(GRPC)/price_list/proto -o $(GRPC)/price_list/gen

.PHONY: build
build:
	go build ./...
