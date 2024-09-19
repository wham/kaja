package main

import (
	"context"

	pb "github.com/wham/kaja-twirp/internal/server"
)

type ServerServer struct{
	b pb.Compiler;
}

func (s *ServerServer) Compile(ctx context.Context, req *pb.CompileRequest) (*pb.CompileResponse, error) {
	return s.b.Compile(ctx, req)
}