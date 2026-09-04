// Package quote answers the rpcs of shop.v1.Pricing.
package quote

import (
	"context"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/get_quote"
	getdto "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/get_quote/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/issue_quote"
	issuedto "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/quote/usecases/issue_quote/dto"
	pricingv1 "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/quote/gen/shop/v1"
)

// Handler is the way in for quotes: one method per rpc the contract declares,
// and each of them runs one use case and translates.
type Handler struct {
	pricingv1.UnimplementedPricingServer

	issue *issue_quote.UseCase
	get   *get_quote.UseCase
}

func NewHandler(issueQuote *issue_quote.UseCase, getQuote *get_quote.UseCase) *Handler {
	return &Handler{issue: issueQuote, get: getQuote}
}

// IssueQuote prices a basket and promises the price for a window.
func (h *Handler) IssueQuote(ctx context.Context, in *pricingv1.IssueQuoteRequest) (*pricingv1.IssueQuoteResponse, error) {
	items := make([]issuedto.Line, 0, len(in.GetItems()))
	for _, item := range in.GetItems() {
		items = append(items, issuedto.Line{SKU: item.GetSku(), Quantity: item.GetQuantity()})
	}

	out, err := h.issue.Handle(ctx, issuedto.Input{
		BasketID: in.GetBasketId(),
		SKUs:     items,
		Currency: in.GetCurrency(),
	})
	if err != nil {
		return nil, err
	}

	return &pricingv1.IssueQuoteResponse{
		QuoteId:    out.QuoteID,
		TotalMinor: out.TotalMinor,
		Currency:   out.Currency,
		ExpiresAt:  out.ExpiresAt,
	}, nil
}

// GetQuote reads one quote, by its id or by the basket it priced.
func (h *Handler) GetQuote(ctx context.Context, in *pricingv1.GetQuoteRequest) (*pricingv1.GetQuoteResponse, error) {
	out, err := h.get.Handle(ctx, getdto.Input{QuoteID: in.GetQuoteId(), BasketID: in.GetBasketId()})
	if err != nil {
		return nil, err
	}

	return &pricingv1.GetQuoteResponse{
		QuoteId:    out.QuoteID,
		BasketId:   out.BasketID,
		TotalMinor: out.TotalMinor,
		Currency:   out.Currency,
		State:      out.State,
		ExpiresAt:  out.ExpiresAt,
	}, nil
}
