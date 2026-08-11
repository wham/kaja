package mcp

import (
	"bytes"
	"encoding/json"
)

// schema is the subset of JSON Schema a tool's inputSchema and outputSchema are
// read through. MCP defaults to draft 2020-12; the keywords below are the ones
// that decide a proto field's shape, and everything else is documentation the
// generated comment carries or a constraint kaja leaves to the server.
type schema struct {
	Ref                  string             `json:"$ref"`
	Type                 schemaType         `json:"type"`
	Title                string             `json:"title"`
	Description          string             `json:"description"`
	Format               string             `json:"format"`
	Items                *schema            `json:"items"`
	Properties           orderedProperties  `json:"properties"`
	AdditionalProperties *additional        `json:"additionalProperties"`
	Required             []string           `json:"required"`
	Enum                 []json.RawMessage  `json:"enum"`
	AllOf                []*schema          `json:"allOf"`
	AnyOf                []*schema          `json:"anyOf"`
	OneOf                []*schema          `json:"oneOf"`
	Defs                 map[string]*schema `json:"$defs"`
	Definitions          map[string]*schema `json:"definitions"`
}

// schemaType reads the `type` keyword, which is a string in every dialect and
// may also be an array in 2020-12. A union with "null" is the same field as its
// non-null counterpart - a proto3 field already models an absent value - so the
// first entry that isn't "null" is the type.
type schemaType string

func (t *schemaType) UnmarshalJSON(data []byte) error {
	var single string
	if json.Unmarshal(data, &single) == nil {
		*t = schemaType(single)
		return nil
	}
	var many []string
	if json.Unmarshal(data, &many) != nil {
		return nil
	}
	for _, entry := range many {
		if entry != "null" {
			*t = schemaType(entry)
			return nil
		}
	}
	return nil
}

// additional is `additionalProperties`, either a boolean or a schema.
type additional struct {
	Allowed bool
	Schema  *schema
}

func (a *additional) UnmarshalJSON(data []byte) error {
	if json.Unmarshal(data, &a.Allowed) == nil {
		return nil
	}
	a.Allowed = true
	return json.Unmarshal(data, &a.Schema)
}

// property is one entry of a schema's `properties`, kept with its position.
type property struct {
	Name   string
	Schema *schema
}

// orderedProperties keeps `properties` in the order the document declares them.
// A JSON object is unordered to Go's decoder, and sorting the names instead
// would renumber a generated message's fields the moment a tool gains one - and
// would reorder the request kaja writes away from how the tool documents itself.
type orderedProperties []property

func (p *orderedProperties) UnmarshalJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return err
		}
		name, ok := key.(string)
		if !ok {
			return nil
		}
		value := &schema{}
		if err := decoder.Decode(value); err != nil {
			return err
		}
		*p = append(*p, property{Name: name, Schema: value})
	}
	return nil
}

func (p orderedProperties) get(name string) *schema {
	for _, entry := range p {
		if entry.Name == name {
			return entry.Schema
		}
	}
	return nil
}
