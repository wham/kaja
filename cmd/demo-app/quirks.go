package main

import (
	"context"

	pb "github.com/wham/kaja-twirp/internal/demo-app"
)

type QuirksServer struct{}

func (s *QuirksServer) Map(ctx context.Context, req *pb.MapRequest) (*pb.MapRequest, error) {
	return req, nil
}

func (s *QuirksServer) MethodWithAReallyLongNameGmthggupcbmnphflnnvu(ctx context.Context, req *pb.Void) (*pb.Void, error) {
	return nil, nil
}

func (s *QuirksServer) Repeated(ctx context.Context, req *pb.RepeatedRequest) (*pb.RepeatedRequest, error) {
	return req, nil
}

func (s *QuirksServer) Types(ctx context.Context, req *pb.TypesRequest) (*pb.TypesRequest, error) {
	return req, nil
}