package demo_app

import (
	"context"
	"strings"
)

type QuirksService struct {
	UnimplementedQuirksServer
}

func (s *QuirksService) MethodWithAReallyLongNameGmthggupcbmnphflnnvu(ctx context.Context, req *Void) (*Message, error) {
	return &Message{
		Name: strings.Repeat("Ha ", 1000),
	}, nil
}
