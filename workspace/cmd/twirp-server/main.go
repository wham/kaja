package main

import (
	"fmt"
	"net/http"

	pb "github.com/wham/kaja/internal/demo-app"
)

func main() {
	basicsServer := pb.NewBasicsServer(&pb.BasicsService{})
	quirksServer := pb.NewQuirksServer(&pb.QuirksService{})
	mux := http.NewServeMux()
	fmt.Printf("Handling BasicServer on %s\n", basicsServer.PathPrefix())
	mux.Handle(basicsServer.PathPrefix(), basicsServer)
	fmt.Printf("Handling QuirksServer on %s\n", quirksServer.PathPrefix())
	mux.Handle(quirksServer.PathPrefix(), quirksServer)
	http.ListenAndServe(":41522", mux)
}
