package main

import (
	"context"
	"strings"

	pb "github.com/wham/kaja-twirp/internal/demo-app"
)

type SearchServiceServer struct{}

var results = []*pb.Result{
	{
		Url: "https://twitchtv.github.io/twirp/",
		Title: "Simple RPC framework powered by protobuf",
		Snippets: []string{"Docs", "Spec"},
	},
	{
		Url: "https://developers.google.com/protocol-buffers",
		Title: "Protocol Buffers",
		Snippets: []string{"language-neutral", "platform-neutral"},
	},
	{
		Url: "https://go.dev/",
		Title: "The Go Programming Language",
		Snippets: []string{"Easy to learn and great for teams", "Built-in concurrency and a robust standard library", "Large ecosystem of partners, communities, and tools"},
	},
	{
		Url: "https://github.com/",
		Title: "GitHub: Let’s build from here",
		Snippets: []string{"Harnessed for productivity"},
	},
}

func (s *SearchServiceServer) Search(ctx context.Context, req *pb.SearchRequest) (*pb.SearchResponse, error) {
	out := []*pb.Result{}

	for _, r := range results {
		if req.Query == "" || strings.Contains(strings.ToLower(r.Title), strings.ToLower(req.Query)) {
			out = append(out, r)
		}
	}

	low := req.ResultPerPage * req.PageNumber
	high := low + req.ResultPerPage

	if high > int32(len(out)) {
		high = int32(len(out))
	}

	if high < 1 {
		high = int32(len(out))
	}
	
	return &pb.SearchResponse{
		Results: out[low:high],
	}, nil
}

func (s *SearchServiceServer) Index(ctx context.Context, req *pb.IndexRequest) (*pb.IndexResponse, error) {
	for i := uint64(0); i < 1 + req.AdditionalCopies; i++ {
		if req.Position == pb.Position_POSITION_TOP {
			results = append([]*pb.Result{req.Result}, results...)
		} else {
			results = append(results, req.Result)
		}
	}
	
	return &pb.IndexResponse{
		Result: req.Result,
	}, nil
}