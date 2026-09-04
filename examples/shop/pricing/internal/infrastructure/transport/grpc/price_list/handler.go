// Package price_list answers the rpcs of shop.v1.PriceLists.
package price_list

import (
	"context"

	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/archive_price_list"
	archivedto "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/archive_price_list/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/import_price_list"
	importdto "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/import_price_list/dto"
	"github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists"
	listdto "github.com/shortlink-org/portolan/examples/shop/pricing/internal/application/price_list/usecases/list_price_lists/dto"
	pricelistv1 "github.com/shortlink-org/portolan/examples/shop/pricing/internal/infrastructure/transport/grpc/price_list/gen/shop/v1"
)

// Handler is the way in for price lists.
type Handler struct {
	pricelistv1.UnimplementedPriceListsServer

	importList *import_price_list.UseCase
	archive    *archive_price_list.UseCase
	list       *list_price_lists.UseCase
}

func NewHandler(importList *import_price_list.UseCase, archiveList *archive_price_list.UseCase, listLists *list_price_lists.UseCase) *Handler {
	return &Handler{importList: importList, archive: archiveList, list: listLists}
}

// ImportPriceList takes in a whole list.
func (h *Handler) ImportPriceList(ctx context.Context, in *pricelistv1.ImportPriceListRequest) (*pricelistv1.ImportPriceListResponse, error) {
	rows := make([]importdto.Row, 0, len(in.GetRows()))
	for _, row := range in.GetRows() {
		rows = append(rows, importdto.Row{SKU: row.GetSku(), AmountMinor: row.GetAmountMinor()})
	}

	out, err := h.importList.Handle(ctx, importdto.Input{
		Name:      in.GetName(),
		Currency:  in.GetCurrency(),
		Rows:      rows,
		ValidFrom: in.GetValidFrom(),
	})
	if err != nil {
		return nil, err
	}

	return &pricelistv1.ImportPriceListResponse{PriceListId: out.PriceListID, Rows: int32(out.Rows)}, nil
}

// ArchivePriceList takes a list out of use without losing it.
func (h *Handler) ArchivePriceList(ctx context.Context, in *pricelistv1.ArchivePriceListRequest) (*pricelistv1.ArchivePriceListResponse, error) {
	out, err := h.archive.Handle(ctx, archivedto.Input{PriceListID: in.GetPriceListId()})
	if err != nil {
		return nil, err
	}

	return &pricelistv1.ArchivePriceListResponse{PriceListId: out.PriceListID}, nil
}

// ListPriceLists answers with every list there is.
func (h *Handler) ListPriceLists(ctx context.Context, in *pricelistv1.ListPriceListsRequest) (*pricelistv1.ListPriceListsResponse, error) {
	out, err := h.list.Handle(ctx, listdto.Input{})
	if err != nil {
		return nil, err
	}

	lists := make([]*pricelistv1.PriceListSummary, 0, len(out.Lists))
	for _, summary := range out.Lists {
		lists = append(lists, &pricelistv1.PriceListSummary{
			PriceListId: summary.PriceListID,
			Name:        summary.Name,
			Currency:    summary.Currency,
			Rows:        int32(summary.Rows),
			Archived:    summary.Archived,
		})
	}

	return &pricelistv1.ListPriceListsResponse{Lists: lists}, nil
}
