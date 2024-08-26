package main

import (
	"context"
	"fmt"
	"net/http"

	pb "github.com/wham/kaja-twirp/internal/demo-app"
)

func main() {
	quirksServer := pb.NewQuirksServer(&QuirksServer{})
	searchServiceServer := pb.NewSearchServiceServer(&SearchServiceServer{})
	mux := http.NewServeMux()
	fmt.Printf("Handling QuirksServer on %s\n", quirksServer.PathPrefix())
	mux.Handle(quirksServer.PathPrefix(), withAuthentication(quirksServer))
	fmt.Printf("Handling SearchServiceServer on %s\n", searchServiceServer.PathPrefix())
	mux.Handle(searchServiceServer.PathPrefix(), searchServiceServer)
    http.ListenAndServe(":41521", mux)
}

func withAuthentication(base http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        a := r.Header.Get("Authentication")
        ctx = context.WithValue(ctx, "authentication", a)
        r = r.WithContext(ctx)
        base.ServeHTTP(w, r)
    })
}