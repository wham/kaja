package mcp

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"path"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"
)

// The Skills extension (io.modelcontextprotocol/skills): the parts of the guide an
// agent needs only for some work are folders under skills/, each file a resource the
// agent reads when that work comes up rather than text every session carries.

//go:embed skills
var skillFiles embed.FS

const (
	skillsExtension = "io.modelcontextprotocol/skills"
	skillScheme     = "skill://"
	skillFile       = "SKILL.md"
	skillsRoot      = "skills"
)

type skillResource struct {
	URI    string `json:"uri"`
	Digest string `json:"digest"`
	Size   int    `json:"size"`
	text   string
}

type skill struct {
	URI         string                 `json:"uri"`
	Frontmatter map[string]interface{} `json:"frontmatter"`
	// Every file of the skill, SKILL.md among them. A host verifies what it reads
	// against these digests, so they are of the bytes resources/read hands back.
	Resources []skillResource `json:"resources"`
}

var skills = loadSkills()

// loadSkills reads the embedded folders. What it reads was compiled in, so a file it
// cannot make a skill of is a build that is wrong rather than a request that is.
func loadSkills() []skill {
	entries, err := fs.ReadDir(skillFiles, skillsRoot)
	if err != nil {
		panic(err)
	}
	var loaded []skill
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		s := skill{URI: skillScheme + name + "/" + skillFile}
		root := path.Join(skillsRoot, name)
		err := fs.WalkDir(skillFiles, root, func(file string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			content, err := fs.ReadFile(skillFiles, file)
			if err != nil {
				return err
			}
			sum := sha256.Sum256(content)
			s.Resources = append(s.Resources, skillResource{
				URI:    skillScheme + strings.TrimPrefix(file, skillsRoot+"/"),
				Digest: "sha256:" + hex.EncodeToString(sum[:]),
				Size:   len(content),
				text:   string(content),
			})
			return nil
		})
		if err != nil {
			panic(err)
		}
		text, ok := s.read(s.URI)
		if !ok {
			panic(fmt.Sprintf("skill %s has no %s", name, skillFile))
		}
		if s.Frontmatter, err = frontmatter(text); err != nil {
			panic(fmt.Sprintf("skill %s: %v", name, err))
		}
		loaded = append(loaded, s)
	}
	sort.Slice(loaded, func(i, j int) bool { return loaded[i].URI < loaded[j].URI })
	return loaded
}

// frontmatter is the YAML between the two `---` lines a SKILL.md opens with, as the
// JSON object a listing carries it as.
func frontmatter(text string) (map[string]interface{}, error) {
	rest, ok := strings.CutPrefix(text, "---\n")
	if !ok {
		return nil, fmt.Errorf("no frontmatter")
	}
	block, _, ok := strings.Cut(rest, "\n---\n")
	if !ok {
		return nil, fmt.Errorf("unterminated frontmatter")
	}
	fields := map[string]interface{}{}
	if err := yaml.Unmarshal([]byte(block), &fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func (s skill) read(uri string) (string, bool) {
	for _, resource := range s.Resources {
		if resource.URI == uri {
			return resource.text, true
		}
	}
	return "", false
}

func (s skill) field(name string) string {
	value, _ := s.Frontmatter[name].(string)
	return value
}

// skillText is one file of one skill, addressed the way a manifest names it.
func skillText(uri string) (string, bool) {
	for _, s := range skills {
		if text, ok := s.read(uri); ok {
			return text, true
		}
	}
	return "", false
}

func skillMimeType(uri string) string {
	if strings.HasSuffix(uri, ".md") {
		return "text/markdown"
	}
	if mimeType := mime.TypeByExtension(path.Ext(uri)); mimeType != "" {
		return mimeType
	}
	return "text/plain"
}

// skillPointers is how the guide names the skills: a URI in the instructions is
// readable by an agent whose host has never heard of the extension, which today is
// nearly all of them.
func skillPointers() string {
	var b strings.Builder
	for _, s := range skills {
		fmt.Fprintf(&b, "- `%s` — %s\n", s.URI, s.field("description"))
	}
	return b.String()
}

// skillResources is each skill as resources/list names it. Only SKILL.md is listed:
// it is the way in, and the manifest names the rest.
func skillResources() []map[string]interface{} {
	var resources []map[string]interface{}
	for _, s := range skills {
		resources = append(resources, map[string]interface{}{
			"uri":         s.URI,
			"name":        s.field("name"),
			"description": s.field("description"),
			"mimeType":    "text/markdown",
		})
	}
	return resources
}

func (s *Server) handleSkillsList() (interface{}, *rpcError) {
	return cacheable(map[string]interface{}{"skills": skills}, staticTTL), nil
}

func (s *Server) handleSkillsGet(params json.RawMessage) (interface{}, *rpcError) {
	var p resourceReadParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcError{Code: codeInvalidParams, Message: "invalid params"}
	}
	for _, candidate := range skills {
		if candidate.URI == p.URI {
			return cacheable(map[string]interface{}{"skill": candidate}, staticTTL), nil
		}
	}
	return nil, &rpcError{Code: codeInvalidParams, Message: fmt.Sprintf("unknown skill %q", p.URI)}
}
