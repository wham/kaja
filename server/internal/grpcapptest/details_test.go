package grpcapptest

import (
	"encoding/json"
	"strings"
	"testing"

	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// TestInvokeErrorDetails is how a gRPC API explains a refusal: a status with
// google.rpc details attached, which is what every API built on the Google design
// guide answers a bad request with. The code and the sentence are what a client
// already has; the details are the only place the field that was wrong is named.
func TestInvokeErrorDetails(t *testing.T) {
	refusal, err := status.New(codes.InvalidArgument, "latitude out of range").WithDetails(
		&errdetails.BadRequest{FieldViolations: []*errdetails.BadRequest_FieldViolation{
			{Field: "latitude", Description: "must be between -90 and 90 degrees"},
		}},
		&errdetails.ErrorInfo{Reason: "LATITUDE_OUT_OF_RANGE", Domain: "routeguide.example.com"},
	)
	if err != nil {
		t.Fatalf("build status: %v", err)
	}

	up, k := openRouteGuide(t, upstreamOptions{Behave: func(*call) error { return refusal.Err() }}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	code, message := e.grpcStatus(t)
	if code != "3" || message != "latitude out of range" {
		t.Fatalf("status = %q / %q", code, message)
	}

	details := e.trailer("grpc-status-details-bin")
	if details == "" {
		t.Fatalf("the details the server attached reached the client nowhere: trailers = %q", e.Trailers)
	}
	var read []map[string]any
	if err := json.Unmarshal([]byte(details), &read); err != nil {
		t.Fatalf("the details are not readable: %v\n%s", err, details)
	}
	if len(read) != 2 {
		t.Fatalf("%d details, want the 2 the server attached: %s", len(read), details)
	}
	if !strings.Contains(details, "must be between -90 and 90 degrees") {
		t.Errorf("the violation the API named is missing: %s", details)
	}
	if !strings.Contains(details, "LATITUDE_OUT_OF_RANGE") {
		t.Errorf("the reason the API named is missing: %s", details)
	}
	t.Logf("details: %s", details)
}

// TestInvokeErrorDetailsOfAnUnknownType is a detail kaja has no type for, which is
// what an API's own error message is. It may not take the ones beside it with it.
func TestInvokeErrorDetailsOfAnUnknownType(t *testing.T) {
	refusal, err := status.New(codes.FailedPrecondition, "nope").WithDetails(&errdetails.RetryInfo{})
	if err != nil {
		t.Fatalf("build status: %v", err)
	}
	unknown := refusal.Proto()
	unknown.Details[0].TypeUrl = "type.googleapis.com/example.v1.WhateverTheApiSends"

	up, k := openRouteGuide(t, upstreamOptions{Behave: func(*call) error {
		return status.FromProto(unknown).Err()
	}}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	details := e.trailer("grpc-status-details-bin")
	if !strings.Contains(details, "example.v1.WhateverTheApiSends") {
		t.Errorf("a detail of a type kaja doesn't know says nothing at all: %q", details)
	}
	t.Logf("details: %s", details)
}

// TestInvokeWithoutDetails is the ordinary refusal: nothing is invented where the
// server attached nothing.
func TestInvokeWithoutDetails(t *testing.T) {
	up, k := openRouteGuide(t, upstreamOptions{Behave: failWith(codes.NotFound, "no such feature")}, nil)

	e := k.invoke(t, getFeature, build(t, up.Files, point, nil), nil)

	if got := e.trailer("grpc-status-details-bin"); got != "" {
		t.Errorf("grpc-status-details-bin = %q, want nothing", got)
	}
}
