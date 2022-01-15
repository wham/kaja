package main

import (
	"fmt"

	pb "github.com/wham/kaja-twirp/internal/demo-app"
	"google.golang.org/protobuf/encoding/protojson"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
)

func main() {
	req := &pb.TypesRequest{
		Timestamp: &timestamppb.Timestamp{
			Seconds: 100,
			Nanos: 50,
		},
	}

	marshaler := &protojson.MarshalOptions{UseProtoNames: true}
	reqBytes, _ := marshaler.Marshal(req)
	fmt.Println(string(reqBytes))
}