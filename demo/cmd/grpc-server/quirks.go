package main

import (
	"context"
	"strings"

	pb "github.com/wham/kaja/internal/demo-app"
)

type QuirksServerImpl struct {
	pb.UnimplementedQuirksServer
}

func (s *QuirksServerImpl) GetAuthentication(ctx context.Context, req *pb.Void) (*pb.Message, error) {
	return &pb.Message{
		Name: ctx.Value("authentication").(string),
	}, nil
}

func (s *QuirksServerImpl) XMap(ctx context.Context, req *pb.MapRequest) (*pb.MapRequest, error) {
	return req, nil
}

func (s *QuirksServerImpl) MethodWithAReallyLongNameGmthggupcbmnphflnnvu(ctx context.Context, req *pb.Void) (*pb.Message, error) {
	return &pb.Message{
		Name: strings.Repeat("Ha ", 1000),
	}, nil
}

func (s *QuirksServerImpl) Panic(ctx context.Context, req *pb.Void) (*pb.Message, error) {
	panic("This is broken")
}

func (s *QuirksServerImpl) Repeated(ctx context.Context, req *pb.RepeatedRequest) (*pb.RepeatedRequest, error) {
	return req, nil
}

func (s *QuirksServerImpl) Types(ctx context.Context, req *pb.TypesRequest) (*pb.TypesRequest, error) {
	return req, nil
}
