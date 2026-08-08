package apps

import "testing"

func TestTakeAppName(t *testing.T) {
	headers := map[string]string{"X-Kaja-App": "seating", "X-Tenant": "acme"}
	if name := TakeAppName(headers); name != "seating" {
		t.Errorf("TakeAppName() = %q, want %q", name, "seating")
	}
	if _, still := headers["X-Kaja-App"]; still {
		t.Error("the reserved header stayed in the map; it must never reach the wire")
	}
	if headers["X-Tenant"] != "acme" {
		t.Error("TakeAppName touched a header that wasn't its own")
	}

	// Whatever case the transport made of it.
	lowered := map[string]string{"x-kaja-app": "quirks"}
	if name := TakeAppName(lowered); name != "quirks" {
		t.Errorf("TakeAppName() = %q, want %q", name, "quirks")
	}
	if len(lowered) != 0 {
		t.Errorf("headers = %v, want it emptied", lowered)
	}

	if name := TakeAppName(map[string]string{}); name != "" {
		t.Errorf("TakeAppName() = %q, want empty", name)
	}
}

func TestMergeMetadata(t *testing.T) {
	// A header written out by hand is the more specific instruction, whatever case
	// it is written in.
	headers := MergeMetadata(map[string]string{"Authorization": "Bear brown"}, map[string]string{"authorization": "Bearer abc"})
	if headers["Authorization"] != "Bear brown" {
		t.Errorf("Authorization = %q, want the configured header kept", headers["Authorization"])
	}
	if _, added := headers["authorization"]; added {
		t.Error("the credential was added beside a header that already carries it")
	}

	headers = MergeMetadata(map[string]string{"X-Tenant": "acme"}, map[string]string{"authorization": "Bearer abc"})
	if headers["authorization"] != "Bearer abc" {
		t.Errorf("authorization = %q, want the credential applied", headers["authorization"])
	}

	if headers := MergeMetadata(nil, nil); len(headers) != 0 {
		t.Errorf("MergeMetadata(nil, nil) = %v, want nothing", headers)
	}
	if headers := MergeMetadata(nil, map[string]string{"authorization": "Bearer abc"}); headers["authorization"] != "Bearer abc" {
		t.Errorf("MergeMetadata(nil, ...) = %v, want the credential applied", headers)
	}
}
