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

type Quirks_2Service struct {
	UnimplementedQuirks_2Server
}

func (s *Quirks_2Service) CamelCaseMethod(ctx context.Context, req *Void) (*Void, error) {
	return &Void{}, nil
}
