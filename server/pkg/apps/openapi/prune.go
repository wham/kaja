package openapi

import (
	"bytes"
	"encoding/json"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// pruneMismatched rewrites a response object so it can be read as the given
// message, dropping every member whose value cannot be read into the field the
// document maps it to — the counterpart of DiscardUnknown, for a member the
// document declares with a shape the API no longer sends. protojson itself is
// the judge: a member is kept exactly when decoding it alone succeeds, so this
// can never disagree with the real decode. Inside a kept member the same rule
// applies per list element, map entry and nested member, so one drifted field
// costs itself and nothing around it. Returns the pruned JSON and whether
// anything was dropped; a body that is not the object the message wants is
// returned unchanged.
func pruneMismatched(desc protoreflect.MessageDescriptor, raw []byte) ([]byte, bool) {
	out, pruned, _ := pruneObject(desc, bytes.TrimSpace(raw))
	return out, pruned
}

func pruneObject(desc protoreflect.MessageDescriptor, raw json.RawMessage) (json.RawMessage, bool, bool) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return raw, false, false
	}
	pruned := false
	for key, value := range obj {
		if memberFits(desc, key, value) {
			continue
		}
		if repaired, ok := repairMember(desc, key, value); ok {
			obj[key] = repaired
		} else {
			delete(obj, key)
		}
		pruned = true
	}
	if !pruned {
		return raw, false, true
	}
	out, err := json.Marshal(obj)
	if err != nil {
		return raw, false, true
	}
	return out, true, true
}

// memberFits reports whether protojson reads {key: value} into a fresh message.
func memberFits(desc protoreflect.MessageDescriptor, key string, value json.RawMessage) bool {
	probe, err := json.Marshal(map[string]json.RawMessage{key: value})
	if err != nil {
		return false
	}
	msg := dynamicpb.NewMessage(desc)
	return (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(probe, msg) == nil
}

// repairMember prunes inside a member that doesn't fit whole — a list keeps the
// elements that fit, a map the entries, a message the members — rather than
// dropping it. It reports false when nothing inside can be saved either.
func repairMember(desc protoreflect.MessageDescriptor, key string, raw json.RawMessage) (json.RawMessage, bool) {
	f := desc.Fields().ByJSONName(key)
	if f == nil {
		f = desc.Fields().ByTextName(key)
	}
	if f == nil {
		return nil, false
	}
	switch {
	case f.IsMap():
		var entries map[string]json.RawMessage
		if err := json.Unmarshal(raw, &entries); err != nil {
			return nil, false
		}
		for k, v := range entries {
			if memberFits(desc, key, mustMarshal(map[string]json.RawMessage{k: v})) {
				continue
			}
			if f.MapValue().Kind() == protoreflect.MessageKind {
				if repaired, _, isObject := pruneObject(f.MapValue().Message(), v); isObject &&
					memberFits(desc, key, mustMarshal(map[string]json.RawMessage{k: repaired})) {
					entries[k] = repaired
					continue
				}
			}
			delete(entries, k)
		}
		return mustMarshal(entries), true
	case f.IsList():
		var elements []json.RawMessage
		if err := json.Unmarshal(raw, &elements); err != nil {
			return nil, false
		}
		kept := make([]json.RawMessage, 0, len(elements))
		for _, e := range elements {
			if memberFits(desc, key, mustMarshal([]json.RawMessage{e})) {
				kept = append(kept, e)
				continue
			}
			if f.Kind() == protoreflect.MessageKind {
				if repaired, _, isObject := pruneObject(f.Message(), e); isObject &&
					memberFits(desc, key, mustMarshal([]json.RawMessage{repaired})) {
					kept = append(kept, repaired)
				}
			}
		}
		return mustMarshal(kept), true
	case f.Kind() == protoreflect.MessageKind:
		if repaired, _, isObject := pruneObject(f.Message(), raw); isObject && memberFits(desc, key, repaired) {
			return repaired, true
		}
	}
	return nil, false
}

func mustMarshal(v any) json.RawMessage {
	out, _ := json.Marshal(v)
	return out
}
