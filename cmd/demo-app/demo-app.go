package main

import (
	"fmt"
	"net/http"

	pb "github.com/wham/kaja-twirp/internal/demo-app"
)

func main() {
	quirksServer := pb.NewQuirksServer(&QuirksServer{})
	searchServiceServer := pb.NewSearchServiceServer(&SearchServiceServer{})
	mux := http.NewServeMux()
	fmt.Printf("Handling QuirksServer on %s\n", quirksServer.PathPrefix())
	mux.Handle(quirksServer.PathPrefix(), quirksServer)
	fmt.Printf("Handling SearchServiceServer on %s\n", searchServiceServer.PathPrefix())
	mux.Handle(searchServiceServer.PathPrefix(), searchServiceServer)
    http.ListenAndServe(":41521", mux)
}