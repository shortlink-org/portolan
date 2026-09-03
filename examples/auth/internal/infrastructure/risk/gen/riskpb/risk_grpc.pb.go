// The shape protoc-gen-go-grpc produces for the client side of RiskService,
// written by hand for the same reason as risk.pb.go. The full method name
// constants and the client interface are exactly what the generator emits -
// they are what anything reading this tree goes by - and the server side is
// left out because this service is never one.
package riskpb

import (
	"context"

	"google.golang.org/grpc"
)

const (
	RiskService_Assess_FullMethodName = "/risk.v1.RiskService/Assess"
)

// RiskServiceClient is the client API for RiskService service.
type RiskServiceClient interface {
	// Assess says whether a login attempt should go ahead.
	Assess(ctx context.Context, in *AssessRequest, opts ...grpc.CallOption) (*AssessResponse, error)
}

type riskServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewRiskServiceClient(cc grpc.ClientConnInterface) RiskServiceClient {
	return &riskServiceClient{cc}
}

func (c *riskServiceClient) Assess(ctx context.Context, in *AssessRequest, opts ...grpc.CallOption) (*AssessResponse, error) {
	out := new(AssessResponse)
	err := c.cc.Invoke(ctx, RiskService_Assess_FullMethodName, in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
