package demo_app

import (
	"context"
)

type BasicsService struct {
	UnimplementedBasicsServer
}

func (s *BasicsService) Types(ctx context.Context, req *TypesRequest) (*TypesRequest, error) {
	return req, nil
}

func (s *BasicsService) Map(ctx context.Context, req *MapRequest) (*MapRequest, error) {
	return req, nil
}

func (s *BasicsService) Panic(ctx context.Context, req *Void) (*Message, error) {
	panic("This is broken")
}

func (s *BasicsService) Repeated(ctx context.Context, req *RepeatedRequest) (*RepeatedRequest, error) {
	return req, nil
}
