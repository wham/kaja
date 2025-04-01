package main

import (
	"fmt"
	"net/http"

	pb "github.com/wham/kaja/internal/demo-app"
)

func main() {
	basicsServer := pb.NewBasicsServer(&pb.BasicsService{})
	quirksServer := pb.NewQuirksServer(&pb.QuirksService{})
	quirks_2Server := pb.NewQuirks_2Server(&pb.Quirks_2Service{})
	mux := http.NewServeMux()
	fmt.Printf("Handling BasicServer on %s\n", basicsServer.PathPrefix())
	mux.Handle(basicsServer.PathPrefix(), basicsServer)
	fmt.Printf("Handling QuirksServer on %s\n", quirksServer.PathPrefix())
	mux.Handle(quirksServer.PathPrefix(), quirksServer)
	fmt.Printf("Handling Quirks_2Server on %s\n", quirks_2Server.PathPrefix())
	mux.Handle(quirks_2Server.PathPrefix(), quirks_2Server)
	http.ListenAndServe(":41522", mux)
}
