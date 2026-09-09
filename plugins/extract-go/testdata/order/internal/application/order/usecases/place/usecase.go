// Package place places a draft order.
package place

type Repository interface {
	Save(any, string) error
}

type UseCase struct {
	repository Repository
}

func (uc *UseCase) Handle(ctx any, id string) error {
	return uc.repository.Save(ctx, id)
}
