package mcp

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestSkillsAreDeclared(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	discovered := modernResult(t, srv, "server/discover", nil)
	capabilities, _ := discovered["capabilities"].(map[string]interface{})
	extensions, _ := capabilities["extensions"].(map[string]interface{})
	if _, ok := extensions[skillsExtension]; !ok {
		t.Fatalf("capabilities = %v, want the skills extension", capabilities)
	}
	if _, ok := capabilities["resources"]; !ok {
		t.Fatalf("capabilities = %v, want resources beside the extension", capabilities)
	}
}

// A host verifies every file it reads against the listing, so the listing has to be
// about the bytes resources/read hands back and the frontmatter those bytes open with.
func TestSkillsListMatchesWhatIsRead(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	result := modernResult(t, srv, "skills/list", nil)
	cached(t, result, staticTTL)
	listed, _ := result["skills"].([]interface{})
	if len(listed) == 0 {
		t.Fatal("no skills listed")
	}
	for _, entry := range listed {
		skill := entry.(map[string]interface{})
		uri := skill["uri"].(string)
		front := skill["frontmatter"].(map[string]interface{})
		name, _ := front["name"].(string)
		if want := skillScheme + name + "/" + skillFile; uri != want {
			t.Errorf("uri = %q, want %q: the folder is the skill's name", uri, want)
		}
		if description, _ := front["description"].(string); description == "" {
			t.Errorf("%s has no description", uri)
		}

		named := false
		for _, file := range skill["resources"].([]interface{}) {
			resource := file.(map[string]interface{})
			fileURI := resource["uri"].(string)
			named = named || fileURI == uri
			read := modernResult(t, srv, "resources/read", map[string]interface{}{"uri": fileURI})
			cached(t, read, staticTTL)
			text := read["contents"].([]interface{})[0].(map[string]interface{})["text"].(string)
			sum := sha256.Sum256([]byte(text))
			if want := "sha256:" + hex.EncodeToString(sum[:]); resource["digest"] != want {
				t.Errorf("%s digest = %v, want %s", fileURI, resource["digest"], want)
			}
			if size := int(resource["size"].(float64)); size != len(text) {
				t.Errorf("%s size = %d, want %d", fileURI, size, len(text))
			}
		}
		if !named {
			t.Errorf("%s is missing from its own manifest", uri)
		}

		got := modernResult(t, srv, "skills/get", map[string]interface{}{"uri": uri})
		if got["skill"].(map[string]interface{})["uri"] != uri {
			t.Errorf("skills/get %s = %v", uri, got["skill"])
		}
	}
}

func TestUnknownSkill(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	for _, method := range []string{"skills/get", "resources/read"} {
		resp := call(t, srv, method, map[string]string{"uri": "skill://nothing/SKILL.md"})
		if resp.Error == nil || resp.Error.Code != codeInvalidParams {
			t.Errorf("%s error = %+v, want %d", method, resp.Error, codeInvalidParams)
		}
	}
}

// Nearly no host loads a skill on its own yet, so the instructions and the resource
// listing are how an agent comes to know one is there.
func TestSkillsAreReachableWithoutTheExtension(t *testing.T) {
	srv := NewServer(newFakeBridge(), token, version)
	instructions := call(t, srv, "initialize", nil).Result.(map[string]interface{})["instructions"].(string)
	resources := call(t, srv, "resources/list", nil).Result.(map[string]interface{})["resources"].([]interface{})
	listed := map[string]bool{}
	for _, resource := range resources {
		listed[resource.(map[string]interface{})["uri"].(string)] = true
	}
	for _, s := range skills {
		if !strings.Contains(instructions, s.URI) {
			t.Errorf("instructions do not name %s", s.URI)
		}
		if !listed[s.URI] {
			t.Errorf("resources/list does not name %s", s.URI)
		}
	}
}
