package main

import (
	"fmt"
	"log"
	"net"

	pb "github.com/wham/kaja/internal/demo-app"
	"google.golang.org/grpc"
)

func main() {
	lis, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", 41521))
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()

	pb.RegisterBasicsServer(grpcServer, &pb.BasicsService{})
	pb.RegisterQuirksServer(grpcServer, &pb.QuirksService{})
	pb.RegisterQuirks_2Server(grpcServer, &pb.Quirks_2Service{})

	grpcServer.Serve(lis)
}
