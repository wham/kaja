package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/pluginpb"
)

func main() {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		os.Stderr.WriteString("failed to read input: " + err.Error() + "\n")
		os.Exit(1)
	}

	req := &pluginpb.CodeGeneratorRequest{}
	if err := proto.Unmarshal(input, req); err != nil {
		os.Stderr.WriteString("failed to unmarshal request: " + err.Error() + "\n")
		os.Exit(1)
	}

	resp := generate(req)

	output, err := proto.Marshal(resp)
	if err != nil {
		os.Stderr.WriteString("failed to marshal response: " + err.Error() + "\n")
		os.Exit(1)
	}

	os.Stdout.Write(output)
}

type params struct {
	longType string
}

func parseParameters(paramStr *string) params {
	p := params{longType: "string"} // default
	if paramStr == nil {
		return p
	}

	for _, param := range strings.Split(*paramStr, ",") {
		if strings.HasPrefix(param, "long_type_") {
			p.longType = strings.TrimPrefix(param, "long_type_")
		}
	}
	return p
}

func findFile(files []*descriptorpb.FileDescriptorProto, name string) *descriptorpb.FileDescriptorProto {
	for _, f := range files {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

func getOutputFileName(protoFile string) string {
	base := strings.TrimSuffix(protoFile, ".proto")
	return base + ".ts"
}

func getClientOutputFileName(protoFile string) string {
	base := strings.TrimSuffix(protoFile, ".proto")
	return base + ".client.ts"
}

func generate(req *pluginpb.CodeGeneratorRequest) *pluginpb.CodeGeneratorResponse {
	resp := &pluginpb.CodeGeneratorResponse{}
	resp.SupportedFeatures = proto.Uint64(uint64(pluginpb.CodeGeneratorResponse_FEATURE_PROTO3_OPTIONAL))

	// Parse plugin parameters
	params := parseParameters(req.Parameter)

	// Pre-scan: identify files with services in this batch
	filesWithServices := make(map[string]bool)
	importedByServiceFiles := make(map[string]bool)
	
	for _, fileName := range req.FileToGenerate {
		file := findFile(req.ProtoFile, fileName)
		if file != nil && len(file.Service) > 0 {
			filesWithServices[fileName] = true
			
			// Mark all dependencies of this service file
			for _, dep := range file.Dependency {
				importedByServiceFiles[dep] = true
			}
		}
	}

	// Generate files for each proto file to generate
	for _, fileName := range req.FileToGenerate {
		file := findFile(req.ProtoFile, fileName)
		if file == nil {
			continue
		}

		// Check if this file is imported by a service file in the batch
		isImportedByService := importedByServiceFiles[fileName]
		
		content := generateFile(file, req.ProtoFile, params, isImportedByService)
		if content == "" {
			continue
		}

		outputName := getOutputFileName(fileName)
		resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
			Name:    proto.String(outputName),
			Content: proto.String(content),
		})

		// Generate client file if there are services
		if len(file.Service) > 0 {
			clientContent := generateClientFile(file, req.ProtoFile, params)
			clientName := getClientOutputFileName(fileName)
			resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
				Name:    proto.String(clientName),
				Content: proto.String(clientContent),
			})
		}
	}
	
	// Also generate for google.protobuf well-known types if they're dependencies
	for _, file := range req.ProtoFile {
		fileName := file.GetName()
		// Check if this is a well-known type
		if strings.HasPrefix(fileName, "google/protobuf/") {
			// Check if any file to generate depends on this
			needsGeneration := false
			for _, genFileName := range req.FileToGenerate {
				genFile := findFile(req.ProtoFile, genFileName)
				if genFile == nil {
					continue
				}
				for _, dep := range genFile.Dependency {
					if dep == fileName {
						needsGeneration = true
						break
					}
				}
				if needsGeneration {
					break
				}
			}
			
			if needsGeneration {
				content := generateFile(file, req.ProtoFile, params, false) // Well-known types are never imported by service files
				if content != "" {
					outputName := getOutputFileName(fileName)
					resp.File = append(resp.File, &pluginpb.CodeGeneratorResponse_File{
						Name:    proto.String(outputName),
						Content: proto.String(content),
					})
				}
			}
		}
	}

	return resp
}

type generator struct {
	b                   strings.Builder
	params              params
	file                *descriptorpb.FileDescriptorProto
	allFiles            []*descriptorpb.FileDescriptorProto
	indent              string
	isImportedByService bool
}

func (g *generator) p(format string, args ...interface{}) {
	g.b.WriteString(g.indent)
	fmt.Fprintf(&g.b, format, args...)
	g.b.WriteString("\n")
}

func (g *generator) pNoIndent(format string, args ...interface{}) {
	fmt.Fprintf(&g.b, format, args...)
	g.b.WriteString("\n")
}

// getLeadingComments retrieves leading comments for a given path in SourceCodeInfo
func (g *generator) getLeadingComments(path []int32) string {
	if g.file.SourceCodeInfo == nil {
		return ""
	}
	for _, loc := range g.file.SourceCodeInfo.Location {
		if len(loc.Path) != len(path) {
			continue
		}
		match := true
		for i := range path {
			if loc.Path[i] != path[i] {
				match = false
				break
			}
		}
		if match && loc.LeadingComments != nil {
			comment := *loc.LeadingComments
			// Check if original comment ends with blank line before trimming
			hasTrailingBlank := strings.HasSuffix(comment, "\n\n") || strings.HasSuffix(comment, "\n \n")
			
			comment = strings.TrimSpace(comment)
			// Strip one leading space from each line (protobuf convention)
			lines := strings.Split(comment, "\n")
			for i, line := range lines {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					lines[i] = "" // Keep empty for blank comment lines
				} else if strings.HasPrefix(line, " ") {
					lines[i] = line[1:]
				} else {
					lines[i] = line
				}
			}
			result := strings.Join(lines, "\n")
			// Add marker if original had trailing blank
			if hasTrailingBlank {
				result += "\n__HAS_TRAILING_BLANK__"
			}
			return result
		}
	}
	return ""
}

// getTrailingComments retrieves trailing comments for a given path in SourceCodeInfo
func (g *generator) getTrailingComments(path []int32) string {
	if g.file.SourceCodeInfo == nil {
		return ""
	}
	for _, loc := range g.file.SourceCodeInfo.Location {
		if len(loc.Path) != len(path) {
			continue
		}
		match := true
		for i := range path {
			if loc.Path[i] != path[i] {
				match = false
				break
			}
		}
		if match && loc.TrailingComments != nil {
			comment := *loc.TrailingComments
			comment = strings.TrimSpace(comment)
			// Strip one leading space from each line (protobuf convention)
			lines := strings.Split(comment, "\n")
			for i, line := range lines {
				line = strings.TrimRight(line, " \t")
				if line == "" {
					lines[i] = ""
				} else if strings.HasPrefix(line, " ") {
					lines[i] = line[1:]
				} else {
					lines[i] = line
				}
			}
			return strings.Join(lines, "\n")
		}
	}
	return ""
}


func generateFile(file *descriptorpb.FileDescriptorProto, allFiles []*descriptorpb.FileDescriptorProto, params params, isImportedByService bool) string {
	g := &generator{
		params:              params,
		file:                file,
		allFiles:            allFiles,
		isImportedByService: isImportedByService,
	}

	// Header
	g.pNoIndent("// @generated by protobuf-ts 2.11.1 with parameter long_type_%s", params.longType)
	pkgComment := ""
	syntax := file.GetSyntax()
	if syntax == "" {
		syntax = "proto2" // Default to proto2 when syntax is not specified
	}
	if file.Package != nil && *file.Package != "" {
		pkgComment = fmt.Sprintf(" (package \"%s\", syntax %s)", *file.Package, syntax)
	} else {
		pkgComment = fmt.Sprintf(" (syntax %s)", syntax)
	}
	g.pNoIndent("// @generated from protobuf file \"%s\"%s", file.GetName(), pkgComment)
	g.pNoIndent("// tslint:disable")
	
	// Add file-level leading detached comments (license headers, etc.)
	// These are typically attached to the syntax declaration (field 12)
	if file.SourceCodeInfo != nil {
		for _, loc := range file.SourceCodeInfo.Location {
			// Check for syntax field with detached comments
			if len(loc.Path) == 1 && loc.Path[0] == 12 && len(loc.LeadingDetachedComments) > 0 {
				// Blank line before the license header
				g.pNoIndent("//")
				for _, detached := range loc.LeadingDetachedComments {
					comments := strings.TrimSpace(detached)
					if comments != "" {
						for _, line := range strings.Split(comments, "\n") {
							line = strings.TrimRight(line, " \t")
							if line == "" {
								g.pNoIndent("//")
							} else {
								// Strip one leading space if present (protobuf convention)
								if strings.HasPrefix(line, " ") {
									line = line[1:]
								}
								g.pNoIndent("// %s", line)
							}
						}
						// Add blank line after detached comment block
						g.pNoIndent("//")
					}
				}
			}
		}
	}

	// Collect imports needed
	imports := g.collectImports(file)
	
	// Write imports
	g.writeImports(imports)

	// Generate message interfaces (with nested types/enums)
	for msgIdx, msg := range file.MessageType {
		g.generateMessageInterface(msg, "", []int32{4, int32(msgIdx)})
	}

	// Generate top-level enums
	for _, enum := range file.EnumType {
		g.generateEnum(enum, "")
	}

	// Generate message implementation classes
	for _, msg := range file.MessageType {
		g.generateMessageClass(msg, "")
	}

	// Generate services
	for _, svc := range file.Service {
		g.generateService(svc)
	}

	return g.b.String()
}

func (g *generator) collectUsedTypes() (map[string]bool, []string) {
	usedInMessages := make(map[string]bool)
	usedInServices := make(map[string]bool)
	var messageFieldTypes []string
	var serviceTypes []string
	
	// Scan all messages for field types in reverse field order
	var scanMessage func(*descriptorpb.DescriptorProto)
	scanMessage = func(msg *descriptorpb.DescriptorProto) {
		// Process fields in reverse order
		for i := len(msg.Field) - 1; i >= 0; i-- {
			field := msg.Field[i]
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE ||
				field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
				typeName := field.GetTypeName()
				// Store the full type name (e.g., .api.v1.HealthCheckResponse.Status)
				if !usedInMessages[typeName] {
					usedInMessages[typeName] = true
					messageFieldTypes = append(messageFieldTypes, typeName)
				}
			}
		}
		for _, nested := range msg.NestedType {
			scanMessage(nested)
		}
	}
	
	// Process messages in reverse order
	for i := len(g.file.MessageType) - 1; i >= 0; i-- {
		scanMessage(g.file.MessageType[i])
	}
	
	// Scan services for method input/output types (in reverse method order)
	for _, service := range g.file.Service {
		for i := len(service.Method) - 1; i >= 0; i-- {
			method := service.Method[i]
			// Add input type
			inputType := method.GetInputType()
			if inputType != "" && !usedInServices[inputType] {
				usedInServices[inputType] = true
				serviceTypes = append(serviceTypes, inputType)
			}
			// Add output type
			outputType := method.GetOutputType()
			if outputType != "" && !usedInServices[outputType] {
				usedInServices[outputType] = true
				serviceTypes = append(serviceTypes, outputType)
			}
		}
	}
	
	// Build final ordered list:
	// 1. Service-only types (not used in message fields) - these go BEFORE ServiceType
	// 2. Message field types (even if also used in services) - these go AFTER runtime imports
	var orderedTypes []string
	used := make(map[string]bool)
	
	// First add service-only types
	for _, typeName := range serviceTypes {
		if !usedInMessages[typeName] {
			orderedTypes = append(orderedTypes, typeName)
			used[typeName] = true
		}
	}
	
	// Then add message field types
	for _, typeName := range messageFieldTypes {
		if !used[typeName] {
			orderedTypes = append(orderedTypes, typeName)
			used[typeName] = true
		}
	}
	
	return used, orderedTypes
}

func (g *generator) collectImports(file *descriptorpb.FileDescriptorProto) map[string]bool {
	imports := make(map[string]bool)
	
	// Always need runtime imports for messages
	if len(file.MessageType) > 0 {
		imports["@protobuf-ts/runtime"] = true
	}
	
	// Check for dependencies (other proto files)
	for _, dep := range file.Dependency {
		if strings.Contains(dep, "google/protobuf/") {
			// Well-known types
			imports["./" + strings.TrimSuffix(filepath.Base(dep), ".proto")] = true
		} else {
			imports["./" + strings.TrimSuffix(filepath.Base(dep), ".proto")] = true
		}
	}
	
	return imports
}

func (g *generator) writeImports(imports map[string]bool) {
	// Collect used types - service-only types first, then message field types
	usedTypes, orderedTypes := g.collectUsedTypes()
	
	// Build a map from dependency path to file for quick lookup
	depFiles := make(map[string]*descriptorpb.FileDescriptorProto)
	currentFileDir := filepath.Dir(g.file.GetName())
	
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil {
			// Compute relative path from current file to dependency
			depPath := strings.TrimSuffix(dep, ".proto")
			relPath := g.getRelativeImportPath(currentFileDir, depPath)
			depFiles[relPath] = depFile
		}
	}
	
	// Helper to generate import statement for a type
	generateImport := func(typeName string) string {
		if !usedTypes[typeName] {
			return ""
		}
		
		// Find which dependency this type belongs to
		typeNameStripped := strings.TrimPrefix(typeName, ".")
		var matchedDepFile *descriptorpb.FileDescriptorProto
		var matchedImportPath string
		
		// First, find all files matching the package
		var candidateFiles []*struct {
			file *descriptorpb.FileDescriptorProto
			path string
		}
		for importPath, depFile := range depFiles {
			depPkg := ""
			if depFile.Package != nil {
				depPkg = *depFile.Package
			}
			if strings.HasPrefix(typeNameStripped, depPkg+".") {
				candidateFiles = append(candidateFiles, &struct {
					file *descriptorpb.FileDescriptorProto
					path string
				}{depFile, importPath})
			}
		}
		
		if len(candidateFiles) == 0 {
			return ""
		}
		
		// If multiple files have the same package, we need to find which one contains the type
		if len(candidateFiles) == 1 {
			matchedDepFile = candidateFiles[0].file
			matchedImportPath = candidateFiles[0].path
		} else {
			// Check each candidate to find which one contains the type
			for _, candidate := range candidateFiles {
				depPkg := ""
				if candidate.file.Package != nil {
					depPkg = *candidate.file.Package
				}
				parts := strings.Split(strings.TrimPrefix(typeNameStripped, depPkg+"."), ".")
				
				// Check if this file contains the type
				found := false
				
				// Check top-level enums
				for _, enum := range candidate.file.EnumType {
					if enum.GetName() == parts[0] && len(parts) == 1 {
						found = true
						break
					}
				}
				
				// Check nested enums
				if !found && len(parts) == 2 {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							for _, enum := range msg.EnumType {
								if enum.GetName() == parts[1] {
									found = true
									break
								}
							}
							if found {
								break
							}
						}
					}
				}
				
				// Check messages
				if !found {
					for _, msg := range candidate.file.MessageType {
						if msg.GetName() == parts[0] {
							found = true
							break
						}
					}
				}
				
				if found {
					matchedDepFile = candidate.file
					matchedImportPath = candidate.path
					break
				}
			}
		}
		
		if matchedDepFile == nil {
			return ""
		}
		
		// Extract the type from this dependency
		depPkg := ""
		if matchedDepFile.Package != nil {
			depPkg = *matchedDepFile.Package
		}
		parts := strings.Split(strings.TrimPrefix(typeNameStripped, depPkg+"."), ".")
		
		var importStmt string
		
		// Check if it's a top-level enum
		found := false
		for _, enum := range matchedDepFile.EnumType {
			if enum.GetName() == parts[0] && len(parts) == 1 {
				importStmt = fmt.Sprintf("import { %s } from \"%s\";", enum.GetName(), matchedImportPath)
				found = true
				break
			}
		}
		if !found && len(parts) == 2 {
			// Check if it's a nested enum (Message.Enum)
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					for _, enum := range msg.EnumType {
						if enum.GetName() == parts[1] {
							importStmt = fmt.Sprintf("import { %s_%s } from \"%s\";", parts[0], parts[1], matchedImportPath)
							found = true
							break
						}
					}
					if found {
						break
					}
				}
			}
		}
		if !found {
			// Must be a message
			for _, msg := range matchedDepFile.MessageType {
				if msg.GetName() == parts[0] {
					importStmt = fmt.Sprintf("import { %s } from \"%s\";", msg.GetName(), matchedImportPath)
					break
				}
			}
		}
		
		return importStmt
	}
	
	// Determine which types are service-only (imported before ServiceType)
	// vs message-field types (imported after MessageType)
	usedInMessages := make(map[string]bool)
	var scanMessage func(*descriptorpb.DescriptorProto)
	scanMessage = func(msg *descriptorpb.DescriptorProto) {
		for _, field := range msg.Field {
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE ||
				field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
				usedInMessages[field.GetTypeName()] = true
			}
		}
		for _, nested := range msg.NestedType {
			scanMessage(nested)
		}
	}
	for _, msg := range g.file.MessageType {
		scanMessage(msg)
	}
	
	// Phase 1: Import service-only external types (before ServiceType)
	seenImports := make(map[string]bool)
	for _, typeName := range orderedTypes {
		// Skip if used in messages (will be imported later)
		if usedInMessages[typeName] {
			continue
		}
		// Skip if it's defined in the current file (not external)
		if g.isLocalType(typeName) {
			continue
		}
		importStmt := generateImport(typeName)
		if importStmt != "" && !seenImports[importStmt] {
			g.pNoIndent("%s", importStmt)
			seenImports[importStmt] = true
		}
	}
	
	// Check if we need ServiceType import
	needsServiceType := len(g.file.Service) > 0
	
	// Check if service comes before messages in the file
	// The WireType import position depends on source order in certain cases
	serviceBeforeMessages := false
	if needsServiceType && len(g.file.MessageType) > 0 {
		// Service is field 6, MessageType is field 4 in FileDescriptorProto
		// Check source code info to see which appears first
		if g.file.SourceCodeInfo != nil {
			firstServiceLine := int32(999999)
			firstMessageLine := int32(999999)
			
			for _, loc := range g.file.SourceCodeInfo.Location {
				// Service definition: path [6, index]
				if len(loc.Path) >= 2 && loc.Path[0] == 6 && loc.Span != nil && len(loc.Span) > 0 {
					if loc.Span[0] < firstServiceLine {
						firstServiceLine = loc.Span[0]
					}
				}
				// Message definition: path [4, index]
				if len(loc.Path) >= 2 && loc.Path[0] == 4 && loc.Span != nil && len(loc.Span) > 0 {
					if loc.Span[0] < firstMessageLine {
						firstMessageLine = loc.Span[0]
					}
				}
			}
			
			// Use special ordering only for files with many messages where service comes first
			// This matches the pattern in teams.proto and users.proto
			serviceBeforeMessages = firstServiceLine < firstMessageLine && len(g.file.MessageType) > 10
		}
	}
	
	// Check if this is google.protobuf.Timestamp for special imports
	isTimestamp := false
	if g.file.Package != nil && *g.file.Package == "google.protobuf" {
		for _, msg := range g.file.MessageType {
			if msg.GetName() == "Timestamp" {
				isTimestamp = true
				break
			}
		}
	}
	
	// Phase 2: Standard runtime imports if we have messages or services
	if len(g.file.MessageType) > 0 || needsServiceType {
		// Special case: file without services imported by service files
		wireTypeFirst := !needsServiceType && g.isImportedByService
		
		if needsServiceType {
			g.pNoIndent("import { ServiceType } from \"@protobuf-ts/runtime-rpc\";")
			if serviceBeforeMessages {
				g.pNoIndent("import { WireType } from \"@protobuf-ts/runtime\";")
			}
		} else if wireTypeFirst {
			// No services but imported by service file - WireType first
			g.pNoIndent("import { WireType } from \"@protobuf-ts/runtime\";")
		}
		g.pNoIndent("import type { BinaryWriteOptions } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import type { IBinaryWriter } from \"@protobuf-ts/runtime\";")
		if !serviceBeforeMessages && !wireTypeFirst {
			g.pNoIndent("import { WireType } from \"@protobuf-ts/runtime\";")
		}
		g.pNoIndent("import type { BinaryReadOptions } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import type { IBinaryReader } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import { UnknownFieldHandler } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import type { PartialMessage } from \"@protobuf-ts/runtime\";")
		g.pNoIndent("import { reflectionMergePartial } from \"@protobuf-ts/runtime\";")
		
		// Add JSON imports for Timestamp
		if isTimestamp {
			g.pNoIndent("import { typeofJsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonValue } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonReadOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import type { JsonWriteOptions } from \"@protobuf-ts/runtime\";")
			g.pNoIndent("import { PbLong } from \"@protobuf-ts/runtime\";")
		}
		
		g.pNoIndent("import { MessageType } from \"@protobuf-ts/runtime\";")
	}
	
	// Phase 3: Import message field types and types used in both services and messages
	for _, typeName := range orderedTypes {
		// Skip if already imported (service-only)
		importStmt := generateImport(typeName)
		if importStmt == "" || seenImports[importStmt] {
			continue
		}
		// Skip local types
		if g.isLocalType(typeName) {
			continue
		}
		g.pNoIndent("%s", importStmt)
		seenImports[importStmt] = true
	}
}

func (g *generator) isLocalType(typeName string) bool {
	// Check if the type is defined in the current file
	typeNameStripped := strings.TrimPrefix(typeName, ".")
	currentPkg := ""
	if g.file.Package != nil {
		currentPkg = *g.file.Package
	}
	
	// If it doesn't start with current package, it's not local
	if !strings.HasPrefix(typeNameStripped, currentPkg+".") {
		return false
	}
	
	// Extract just the type name without package
	localName := strings.TrimPrefix(typeNameStripped, currentPkg+".")
	parts := strings.Split(localName, ".")
	
	// Check if it's a top-level message or enum
	for _, msg := range g.file.MessageType {
		if msg.GetName() == parts[0] {
			return true
		}
	}
	for _, enum := range g.file.EnumType {
		if enum.GetName() == parts[0] {
			return true
		}
	}
	
	return false
}

func (g *generator) getRelativeImportPath(fromDir, toPath string) string {
	// If fromDir is empty (file at root), use simple ./ path
	if fromDir == "" || fromDir == "." {
		return "./" + toPath
	}
	
	// Handle same directory
	if fromDir == filepath.Dir(toPath) {
		return "./" + filepath.Base(toPath)
	}
	
	// Handle parent directory navigation
	fromParts := []string{}
	if fromDir != "" {
		fromParts = strings.Split(fromDir, "/")
	}
	toParts := strings.Split(toPath, "/")
	
	// Find common prefix length
	commonLen := 0
	minLen := len(fromParts)
	if len(toParts) < minLen {
		minLen = len(toParts)
	}
	for i := 0; i < minLen; i++ {
		if fromParts[i] == toParts[i] {
			commonLen++
		} else {
			break
		}
	}
	
	// Build relative path
	upCount := len(fromParts) - commonLen
	var result []string
	for i := 0; i < upCount; i++ {
		result = append(result, "..")
	}
	for i := commonLen; i < len(toParts); i++ {
		result = append(result, toParts[i])
	}
	
	if len(result) == 0 {
		return "./" + filepath.Base(toPath)
	}
	
	// Don't use ./ prefix when going up directories
	if upCount > 0 {
		return strings.Join(result, "/")
	}
	
	return "./" + strings.Join(result, "/")
}

func (g *generator) getImportPathForType(fullTypeName string) string {
	// fullTypeName starts with . (e.g., .lib.Void, .quirks.v1.TypesRequest)
	typeNameStripped := strings.TrimPrefix(fullTypeName, ".")
	
	// Check if it's in the current file
	currentPkg := ""
	if g.file.Package != nil {
		currentPkg = *g.file.Package
	}
	
	// If it starts with current package, it's in the current file
	if currentPkg != "" && strings.HasPrefix(typeNameStripped, currentPkg+".") {
		return "./" + strings.TrimSuffix(filepath.Base(g.file.GetName()), ".proto")
	}
	
	// Check dependencies
	currentFileDir := filepath.Dir(g.file.GetName())
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile == nil {
			continue
		}
		
		depPkg := ""
		if depFile.Package != nil {
			depPkg = *depFile.Package
		}
		
		if depPkg != "" && strings.HasPrefix(typeNameStripped, depPkg+".") {
			// Found it - compute relative import path
			depPath := strings.TrimSuffix(dep, ".proto")
			return g.getRelativeImportPath(currentFileDir, depPath)
		}
	}
	
	// Default to current file
	return "./" + strings.TrimSuffix(filepath.Base(g.file.GetName()), ".proto")
}

func (g *generator) findFileByName(name string) *descriptorpb.FileDescriptorProto {
	for _, f := range g.allFiles {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

func (g *generator) generateMessageInterface(msg *descriptorpb.DescriptorProto, parentPrefix string, msgPath []int32) {
	// Skip map entry messages
	if msg.Options != nil && msg.GetOptions().GetMapEntry() {
		return
	}
	
	fullName := parentPrefix + msg.GetName()
	
	// Message interface first
	g.pNoIndent("/**")
	
	// Add leading comments if available (msgPath should point to this message)
	if len(msgPath) > 0 {
		leadingComments := g.getLeadingComments(msgPath)
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", line)
				}
			}
			// Add separator blank line(s) before @generated
			if hasTrailingBlank {
				// Comment had trailing blank, add two separators
				g.pNoIndent(" *")
				g.pNoIndent(" *")
			} else {
				// Comment didn't have trailing blank, add one separator
				g.pNoIndent(" *")
			}
		}
	}
	
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	g.pNoIndent(" * @generated from protobuf message %s%s", pkgPrefix, strings.ReplaceAll(fullName, "_", "."))
	g.pNoIndent(" */")
	g.pNoIndent("export interface %s {", fullName)
	
	// Group fields by oneof
	oneofGroups := make(map[int32][]*descriptorpb.FieldDescriptorProto)
	var regularFields []*descriptorpb.FieldDescriptorProto
	
	for _, field := range msg.Field {
		if field.OneofIndex != nil {
			oneofGroups[field.GetOneofIndex()] = append(oneofGroups[field.GetOneofIndex()], field)
		} else {
			regularFields = append(regularFields, field)
		}
	}
	
	// Generate regular fields
	for _, field := range regularFields {
		var fieldPath []int32
		if len(msgPath) > 0 {
			// Find actual field index in msg.Field (not just regularFields)
			fieldIdx := -1
			for j, f := range msg.Field {
				if f == field {
					fieldIdx = j
					break
				}
			}
			if fieldIdx >= 0 {
				fieldPath = append(msgPath, 2, int32(fieldIdx))
			}
		}
		g.generateField(field, fullName, fieldPath)
	}
	
	// Generate oneof fields
	for oneofIdx, fields := range oneofGroups {
		if oneofIdx < int32(len(msg.OneofDecl)) {
			oneofName := msg.OneofDecl[oneofIdx].GetName()
			g.indent = "    "
			g.p("/**")
			g.p(" * @generated from protobuf oneof: %s", oneofName)
			g.p(" */")
			g.p("%s: {", oneofName)
			g.indent = "        "
			
			for i, field := range fields {
				// Find field index for source comments
				fieldIdx := -1
				for j, f := range msg.Field {
					if f == field {
						fieldIdx = j
						break
					}
				}
				
				g.p("oneofKind: \"%s\";", g.propertyName(field))
				
				// Add leading comments if available
				if len(msgPath) > 0 && fieldIdx >= 0 {
					fieldPath := append(msgPath, 2, int32(fieldIdx))
					leadingComments := g.getLeadingComments(fieldPath)
					if leadingComments != "" {
						hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
						if hasTrailingBlank {
							leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
						}
						
						g.p("/**")
						lines := strings.Split(leadingComments, "\n")
						for _, line := range lines {
							if line == "" {
								g.p(" *")
							} else {
								g.p(" * %s", line)
							}
						}
						// Add separator blank line(s) before @generated
						if hasTrailingBlank {
							// Comment had trailing blank, add two separators
							g.p(" *")
							g.p(" *")
						} else {
							// Comment didn't have trailing blank, add one separator
							g.p(" *")
						}
						g.p(" * @generated from protobuf field: %s %s = %d", g.getProtoType(field), field.GetName(), field.GetNumber())
						g.p(" */")
					} else {
						// No source comments, just add @generated comment
						g.p("/**")
						g.p(" * @generated from protobuf field: %s %s = %d", g.getProtoType(field), field.GetName(), field.GetNumber())
						g.p(" */")
					}
				} else {
					// No msgPath, just add @generated comment
					g.p("/**")
					g.p(" * @generated from protobuf field: %s %s = %d", g.getProtoType(field), field.GetName(), field.GetNumber())
					g.p(" */")
				}
				
				g.p("%s: %s;", g.propertyName(field), g.getTypescriptType(field))
				
				if i < len(fields)-1 {
					g.indent = "    "
					g.p("} | {")
					g.indent = "        "
				}
			}
			
			// Add undefined case
			g.indent = "    "
			g.p("} | {")
			g.indent = "        "
			g.p("oneofKind: undefined;")
			
			g.indent = "    "
			g.p("};")
		}
	}
	
	g.pNoIndent("}")
	
	// Generate nested message interfaces first
	for nestedIdx, nested := range msg.NestedType {
		nestedPath := append(msgPath, 3, int32(nestedIdx))
		g.generateMessageInterface(nested, fullName + "_", nestedPath)
	}
	
	// Generate nested enums after nested messages
	for _, nested := range msg.EnumType {
		g.generateEnum(nested, fullName + "_")
	}
}

func (g *generator) generateMessageClass(msg *descriptorpb.DescriptorProto, parentPrefix string) {
	// Skip map entry messages
	if msg.Options != nil && msg.GetOptions().GetMapEntry() {
		return
	}
	
	fullName := parentPrefix + msg.GetName()
	
	// Message type class
	g.generateMessageTypeClass(msg, fullName)
	
	// Generate nested message classes
	for _, nested := range msg.NestedType {
		g.generateMessageClass(nested, fullName + "_")
	}
}

func (g *generator) generateField(field *descriptorpb.FieldDescriptorProto, msgName string, fieldPath []int32) {
	g.indent = "    "
	g.p("/**")
	
	// Add leading comments if fieldPath is provided
	if len(fieldPath) > 0 {
		leadingComments := g.getLeadingComments(fieldPath)
		if leadingComments != "" {
			for _, line := range strings.Split(leadingComments, "\n") {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", line)
				}
			}
			g.p(" *")
		}
	}
	
	g.p(" * @generated from protobuf field: %s %s = %d", g.getProtoType(field), field.GetName(), field.GetNumber())
	g.p(" */")
	
	fieldName := g.propertyName(field)
	
	// Get trailing comments if fieldPath is provided
	trailingComment := ""
	if len(fieldPath) > 0 {
		tc := g.getTrailingComments(fieldPath)
		if tc != "" {
			// Convert multiline comments to single line with proper formatting
			lines := strings.Split(tc, "\n")
			trailingComment = " // " + strings.Join(lines, " ")
		}
	}
	
	// Check if it's a repeated field
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		// Check if it's a map field
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			// Map field - multiline format
			keyField := msgType.Field[0]
			valueField := msgType.Field[1]
			keyType := g.getTypescriptTypeForMapKey(keyField)
			valueType := g.getBaseTypescriptType(valueField)
			g.p("%s: {", fieldName)
			g.indent = "        "
			g.p("[key: %s]: %s;", keyType, valueType)
			g.indent = "    "
			g.p("};%s", trailingComment)
		} else {
			// Regular repeated field
			baseType := g.getBaseTypescriptType(field)
			g.p("%s: %s[];%s", fieldName, baseType, trailingComment)
		}
	} else {
		// Singular field
		fieldType := g.getBaseTypescriptType(field)
		optional := ""
		// Mark as optional if:
		// 1. Proto2 optional (syntax is proto2 AND label is OPTIONAL)
		// 2. Proto3 message (messages are always optional)
		// 3. Proto3 explicit optional scalar (proto3_optional = true)
		isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
		if field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REPEATED &&
		   field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REQUIRED {
			if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
				// Proto2 optional scalar or message
				optional = "?"
			} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				// Proto3 message (implicitly optional)
				optional = "?"
			} else if field.Proto3Optional != nil && *field.Proto3Optional {
				// Proto3 explicit optional scalar
				optional = "?"
			}
		}
		g.p("%s%s: %s;%s", fieldName, optional, fieldType, trailingComment)
	}
	
	g.indent = ""
}

func (g *generator) generateOneofField(oneofName string, fields []*descriptorpb.FieldDescriptorProto, msgIndex int) {
	g.indent = "    "
	g.p("/**")
	g.p(" * @generated from protobuf oneof: %s", oneofName)
	g.p(" */")
	g.p("%s: {", oneofName)
	
	// Generate each alternative
	for i, field := range fields {
		g.indent = "        "
		fieldJsonName := g.propertyName(field)
		g.p("oneofKind: \"%s\";", fieldJsonName)
		g.p("/**")
		g.p(" * @generated from protobuf field: %s %s = %d", g.getProtoType(field), field.GetName(), field.GetNumber())
		g.p(" */")
		fieldType := g.getTypescriptType(field)
		g.p("%s: %s;", fieldJsonName, fieldType)
		g.indent = "    "
		if i < len(fields)-1 {
			g.p("} | {")
		}
	}
	
	// Add undefined alternative
	g.p("} | {")
	g.indent = "        "
	g.p("oneofKind: undefined;")
	g.indent = "    "
	g.p("};")
	g.indent = ""
}

// propertyName returns the TypeScript property name for a field
// This does camelCase conversion where all letters after underscores are capitalized
func (g *generator) propertyName(field *descriptorpb.FieldDescriptorProto) string {
	name := field.GetName()
	// Convert snake_case to camelCase: capitalize all letters after underscores
	parts := strings.Split(name, "_")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	result := strings.Join(parts, "")
	
	// Special handling: if a lowercase letter follows a digit, capitalize it
	// Example: "int32s" becomes "int32S" in "fInt32S"
	runes := []rune(result)
	for i := 1; i < len(runes); i++ {
		if runes[i] >= 'a' && runes[i] <= 'z' && runes[i-1] >= '0' && runes[i-1] <= '9' {
			runes[i] = runes[i] - 'a' + 'A'
		}
	}
	result = string(runes)
	
	// Lowercase the first letter
	if len(result) > 0 {
		result = strings.ToLower(result[:1]) + result[1:]
	}
	return result
}

// jsonName returns the jsonName for use in reflection metadata
// This uses protoc's JsonName which follows JSON naming conventions
func (g *generator) jsonName(field *descriptorpb.FieldDescriptorProto) string {
	if field.JsonName != nil {
		// Use the proto-provided JsonName as-is
		return *field.JsonName
	}
	// Fallback: convert snake_case to camelCase (should not happen with protoc)
	return g.propertyName(field)
}

func (g *generator) getProtoType(field *descriptorpb.FieldDescriptorProto) string {
	// Check if it's a map field
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED && 
	   field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			// It's a map field
			keyField := msgType.Field[0]
			valueField := msgType.Field[1]
			keyType := g.getProtoTypeSimple(keyField)
			valueType := g.getProtoTypeSimple(valueField)
			return fmt.Sprintf("map<%s, %s>", keyType, valueType)
		}
	}
	
	label := ""
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		label = "repeated "
	} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
		// Only show "optional" for proto2 optional fields
		isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
		if isProto2 {
			label = "optional "
		}
	} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REQUIRED {
		label = "required "
	}
	
	typeName := ""
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName = g.getProtoTypeName(field.GetTypeName())
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		typeName = g.getProtoTypeName(field.GetTypeName())
	default:
		typeName = strings.ToLower(field.GetType().String()[5:]) // Remove TYPE_ prefix
	}
	
	return label + typeName
}

func (g *generator) getProtoTypeSimple(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		return g.getProtoTypeName(field.GetTypeName())
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return g.getProtoTypeName(field.GetTypeName())
	default:
		return strings.ToLower(field.GetType().String()[5:]) // Remove TYPE_ prefix
	}
}

func (g *generator) getProtoTypeName(typeName string) string {
	// Remove leading dot
	typeName = strings.TrimPrefix(typeName, ".")
	// Keep package prefix and convert nested types
	return strings.ReplaceAll(typeName, ".", ".")
}

func (g *generator) stripPackage(typeName string) string {
	// Remove leading dot
	typeName = strings.TrimPrefix(typeName, ".")
	
	// Check if this is from the same package
	if g.file.Package != nil && *g.file.Package != "" {
		prefix := *g.file.Package + "."
		if strings.HasPrefix(typeName, prefix) {
			// Same package - strip package and replace dots with underscores for nested types
			typeName = strings.TrimPrefix(typeName, prefix)
			return strings.ReplaceAll(typeName, ".", "_")
		}
	}
	
	// Different package - need to strip package but keep message.nested structure
	// e.g., api.v1.HealthCheckResponse.Status -> HealthCheckResponse_Status
	parts := strings.Split(typeName, ".")
	
	// Find where the package ends and the type begins
	// We need to identify the first capital letter as start of type name
	for i, part := range parts {
		if len(part) > 0 && part[0] >= 'A' && part[0] <= 'Z' {
			// Found the start of the type name
			typeParts := parts[i:]
			return strings.Join(typeParts, "_")
		}
	}
	
	// Fallback: just take the last part (shouldn't happen)
	return parts[len(parts)-1]
}

func (g *generator) getTypescriptType(field *descriptorpb.FieldDescriptorProto) string {
	baseType := g.getBaseTypescriptType(field)
	
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		// Check if it's a map
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				// It's a map entry
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				keyType := g.getBaseTypescriptType(keyField)
				valueType := g.getBaseTypescriptType(valueField)
				return fmt.Sprintf("{\n        [key: %s]: %s;\n    }", keyType, valueType)
			}
		}
		return baseType + "[]"
	}
	
	return baseType
}

func (g *generator) getTypescriptTypeForMapKey(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "number"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		// 64-bit integers as map keys use the same type as regular fields
		return g.params.longType
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "boolean"
	default:
		return "string"
	}
}

func (g *generator) getBaseTypescriptType(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "number"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return g.params.longType
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "boolean"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "Uint8Array"
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		return g.stripPackage(field.GetTypeName())
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return g.stripPackage(field.GetTypeName())
	default:
		return "any"
	}
}

func (g *generator) findMessageType(typeName string) *descriptorpb.DescriptorProto {
	typeName = strings.TrimPrefix(typeName, ".")
	
	// Search in current file
	for _, msg := range g.file.MessageType {
		if found := g.findMessageTypeInMessage(msg, typeName, ""); found != nil {
			return found
		}
	}
	
	// Search in dependencies
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil {
			for _, msg := range depFile.MessageType {
				if found := g.findMessageTypeInMessage(msg, typeName, ""); found != nil {
					return found
				}
			}
		}
	}
	
	return nil
}

func (g *generator) findEnumType(typeName string) *descriptorpb.EnumDescriptorProto {
	typeName = strings.TrimPrefix(typeName, ".")
	
	// Search in current file top-level enums
	for _, enum := range g.file.EnumType {
		fullName := ""
		if g.file.Package != nil && *g.file.Package != "" {
			fullName = *g.file.Package + "."
		}
		fullName += enum.GetName()
		if typeName == fullName {
			return enum
		}
	}
	
	// Search in current file nested enums
	currentPkg := ""
	if g.file.Package != nil && *g.file.Package != "" {
		currentPkg = *g.file.Package
	}
	for _, msg := range g.file.MessageType {
		if found := g.findEnumTypeInMessage(msg, typeName, currentPkg); found != nil {
			return found
		}
	}
	
	// Search in dependencies
	for _, dep := range g.file.Dependency {
		depFile := g.findFileByName(dep)
		if depFile != nil {
			depPkg := ""
			if depFile.Package != nil && *depFile.Package != "" {
				depPkg = *depFile.Package
			}
			
			for _, enum := range depFile.EnumType {
				fullName := ""
				if depPkg != "" {
					fullName = depPkg + "."
				}
				fullName += enum.GetName()
				if typeName == fullName {
					return enum
				}
			}
			for _, msg := range depFile.MessageType {
				prefix := depPkg
				if found := g.findEnumTypeInMessage(msg, typeName, prefix); found != nil {
					return found
				}
			}
		}
	}
	
	return nil
}

func (g *generator) findEnumTypeInMessage(msg *descriptorpb.DescriptorProto, typeName string, prefix string) *descriptorpb.EnumDescriptorProto {
	msgFullName := prefix
	if msgFullName != "" {
		msgFullName += "."
	}
	msgFullName += msg.GetName()
	
	// Check nested enums
	for _, enum := range msg.EnumType {
		fullName := msgFullName + "." + enum.GetName()
		if typeName == fullName {
			return enum
		}
	}
	
	// Search nested messages
	for _, nested := range msg.NestedType {
		if found := g.findEnumTypeInMessage(nested, typeName, msgFullName); found != nil {
			return found
		}
	}
	
	return nil
}

func (g *generator) findMessageTypeInMessage(msg *descriptorpb.DescriptorProto, typeName string, prefix string) *descriptorpb.DescriptorProto {
	fullName := prefix
	if fullName != "" {
		fullName += "."
	}
	fullName += msg.GetName()
	
	// Check if current message matches
	if strings.HasSuffix(typeName, fullName) {
		return msg
	}
	
	// Search nested types
	for _, nested := range msg.NestedType {
		if found := g.findMessageTypeInMessage(nested, typeName, fullName); found != nil {
			return found
		}
	}
	
	return nil
}

func (g *generator) generateMessageTypeClass(msg *descriptorpb.DescriptorProto, fullName string) {
	className := fullName + "$Type"
	
	g.pNoIndent("// @generated message type with reflection information, may provide speed optimized methods")
	g.pNoIndent("class %s extends MessageType<%s> {", className, fullName)
	g.indent = "    "
	
	// Constructor
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	typeName := pkgPrefix + strings.ReplaceAll(fullName, "_", ".")
	
	g.p("constructor() {")
	g.indent = "        "
	
	// Group oneof fields
	oneofFieldGroups := make(map[int32][]*descriptorpb.FieldDescriptorProto)
	var regularFields []*descriptorpb.FieldDescriptorProto
	for _, field := range msg.Field {
		if field.OneofIndex != nil {
			oneofFieldGroups[field.GetOneofIndex()] = append(oneofFieldGroups[field.GetOneofIndex()], field)
		} else {
			regularFields = append(regularFields, field)
		}
	}
	
	// Count total field descriptors
	totalFields := len(regularFields)
	for _, fields := range oneofFieldGroups {
		totalFields += len(fields)
	}
	
	// If no fields, use compact format
	if totalFields == 0 {
		g.p("super(\"%s\", []);", typeName)
	} else {
		g.p("super(\"%s\", [", typeName)
		
		// Field descriptors
		g.indent = "            "
		currentField := 0
	
		// Generate regular field descriptors
		for _, field := range regularFields {
		comma := ","
		if currentField == totalFields-1 {
			comma = ""
		}
		currentField++
		
		kind := "scalar"
		t := g.getScalarTypeEnum(field)
		extraFields := ""
		
		if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				kind = "map"
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				keyT := g.getScalarTypeEnum(keyField)
				keyTypeName := g.getScalarTypeName(keyField)
				if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"message\", T: () => %s }", keyT, keyTypeName, g.stripPackage(valueField.GetTypeName()))
				} else if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
					valueTypeName := g.stripPackage(valueField.GetTypeName())
					valueFullTypeName := g.getProtoTypeName(valueField.GetTypeName())
					enumType := g.findEnumType(valueField.GetTypeName())
					enumPrefix := ""
					if enumType != nil {
						enumPrefix = g.detectEnumPrefix(enumType)
					}
					extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"enum\", T: () => [\"%s\", %s, \"%s\"] }", keyT, keyTypeName, valueFullTypeName, valueTypeName, enumPrefix)
				} else {
					valueT := g.getScalarTypeEnum(valueField)
					valueTypeName := g.getScalarTypeName(valueField)
					extraFields = fmt.Sprintf(", K: %s /*ScalarType.%s*/, V: { kind: \"scalar\", T: %s /*ScalarType.%s*/ }", keyT, keyTypeName, valueT, valueTypeName)
				}
			} else {
				kind = "message"
				extraFields = fmt.Sprintf(", T: () => %s", g.stripPackage(field.GetTypeName()))
			}
		} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
			kind = "enum"
			typeName := g.stripPackage(field.GetTypeName())
			fullTypeName := g.getProtoTypeName(field.GetTypeName())
			
			// Get enum to detect prefix
			enumType := g.findEnumType(field.GetTypeName())
			enumPrefix := ""
			if enumType != nil {
				enumPrefix = g.detectEnumPrefix(enumType)
			}
			
			// Only include enumPrefix if it's non-empty
			if enumPrefix != "" {
				extraFields = fmt.Sprintf(", T: () => [\"%s\", %s, \"%s\"]", fullTypeName, typeName, enumPrefix)
			} else {
				extraFields = fmt.Sprintf(", T: () => [\"%s\", %s]", fullTypeName, typeName)
			}
		}
		
		repeat := ""
		if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			if kind == "map" {
				// Map fields don't use repeat
			} else if g.isPackedType(field) {
				repeat = ", repeat: 1 /*RepeatType.PACKED*/"
			} else {
				repeat = ", repeat: 2 /*RepeatType.UNPACKED*/"
			}
		}
		
		// Add jsonName only when needed (non-standard naming)
		// Include jsonName if:
		// 1. Field name starts with capital letter, OR
		// 2. Field name doesn't contain underscore (already camelCase/special)
		jsonNameField := ""
		fieldName := field.GetName()
		needsJsonName := false
		
		if len(fieldName) > 0 && fieldName[0] >= 'A' && fieldName[0] <= 'Z' {
			// Starts with capital letter
			needsJsonName = true
		} else if !strings.Contains(fieldName, "_") {
			// No underscore - might be special
			needsJsonName = false // Actually, if no underscore and lowercase, no need for jsonName
		} else {
			// Has underscore - check if it ends with a number+s pattern (like int32s, int64s)
			// In this case, the 's' should not be capitalized
			if matched, _ := regexp.MatchString(`\d+s$`, fieldName); matched {
				needsJsonName = true
			}
		}
		
		if needsJsonName && field.JsonName != nil {
			jn := g.jsonName(field)
			jsonNameField = fmt.Sprintf(", jsonName: \"%s\"", jn)
		}
		
		opt := ""
		// Mark as optional if proto3 optional OR proto2 optional
		isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
		if (field.Proto3Optional != nil && *field.Proto3Optional) ||
		   (isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL && 
		    field.GetType() != descriptorpb.FieldDescriptorProto_TYPE_MESSAGE) {
			opt = ", opt: true"
		}
		
		if kind == "scalar" {
			// Scalars need T
			typeName := g.getScalarTypeName(field)
			g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s%s%s, T: %s /*ScalarType.%s*/ }%s",
				field.GetNumber(), field.GetName(), kind, jsonNameField, repeat, opt, t, typeName, comma)
		} else {
			g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s%s%s%s }%s",
				field.GetNumber(), field.GetName(), kind, jsonNameField, repeat, extraFields, opt, comma)
		}
	}
	
	// Generate oneof field descriptors - all alternatives for each oneof
	for oneofIdx, fields := range oneofFieldGroups {
		if oneofIdx < int32(len(msg.OneofDecl)) {
			oneofName := msg.OneofDecl[oneofIdx].GetName()
			for _, field := range fields {
				comma := ","
				if currentField == totalFields-1 {
					comma = ""
				}
				currentField++
				
				kind := "scalar"
				t := g.getScalarTypeEnum(field)
				extraFields := ""
				
				if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					kind = "message"
					extraFields = fmt.Sprintf(", oneof: \"%s\", T: () => %s", oneofName, g.stripPackage(field.GetTypeName()))
					g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s }%s",
						field.GetNumber(), field.GetName(), kind, extraFields, comma)
				} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_ENUM {
					kind = "enum"
					typeName := g.stripPackage(field.GetTypeName())
					fullTypeName := g.getProtoTypeName(field.GetTypeName())
					enumType := g.findEnumType(field.GetTypeName())
					enumPrefix := ""
					if enumType != nil {
						enumPrefix = g.detectEnumPrefix(enumType)
					}
					extraFields = fmt.Sprintf(", oneof: \"%s\", T: () => [\"%s\", %s, \"%s\"]", oneofName, fullTypeName, typeName, enumPrefix)
					g.p("{ no: %d, name: \"%s\", kind: \"%s\"%s }%s",
						field.GetNumber(), field.GetName(), kind, extraFields, comma)
				} else {
					// Scalar oneof field
					typeName := g.getScalarTypeName(field)
					g.p("{ no: %d, name: \"%s\", kind: \"%s\", oneof: \"%s\", T: %s /*ScalarType.%s*/ }%s",
						field.GetNumber(), field.GetName(), kind, oneofName, t, typeName, comma)
				}
			}
		}
	}
		
		g.indent = "        "
		g.p("]);")
	}
	g.indent = "    "
	g.p("}")
	
	// Check if this is a well-known type that needs special handling
	isTimestamp := g.file.Package != nil && *g.file.Package == "google.protobuf" && fullName == "Timestamp"
	
	// Add special methods for well-known types BEFORE standard methods
	if isTimestamp {
		g.generateTimestampMethods()
	}
	
	// create method
	g.p("create(value?: PartialMessage<%s>): %s {", fullName, fullName)
	g.indent = "        "
	g.p("const message = globalThis.Object.create((this.messagePrototype!));")
	
	// Initialize regular fields with defaults
	for _, field := range msg.Field {
		if field.OneofIndex != nil {
			continue
		}
		
		fieldName := g.propertyName(field)
		defaultVal := g.getDefaultValue(field)
		if defaultVal != "" {
			g.p("message.%s = %s;", fieldName, defaultVal)
		}
	}
	
	// Initialize oneof fields
	oneofInit := make(map[int32]bool)
	for _, field := range msg.Field {
		if field.OneofIndex != nil && !oneofInit[field.GetOneofIndex()] {
			oneofIdx := field.GetOneofIndex()
			if oneofIdx < int32(len(msg.OneofDecl)) {
				oneofName := msg.OneofDecl[oneofIdx].GetName()
				g.p("message.%s = { oneofKind: undefined };", oneofName)
				oneofInit[oneofIdx] = true
			}
		}
	}
	
	g.p("if (value !== undefined)")
	g.indent = "            "
	g.p("reflectionMergePartial<%s>(this, message, value);", fullName)
	g.indent = "        "
	g.p("return message;")
	g.indent = "    "
	g.p("}")
	
	// internalBinaryRead method
	g.p("internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: %s): %s {", fullName, fullName)
	g.indent = "        "
	g.p("let message = target ?? this.create(), end = reader.pos + length;")
	g.p("while (reader.pos < end) {")
	g.indent = "            "
	g.p("let [fieldNo, wireType] = reader.tag();")
	g.p("switch (fieldNo) {")
	
	// Read each field
	for _, field := range msg.Field {
		g.indent = "                "
		fieldName := g.propertyName(field)
		g.p("case /* %s %s */ %d:", g.getProtoType(field), field.GetName(), field.GetNumber())
		g.indent = "                    "
		
		if field.OneofIndex != nil {
			// Get oneof name
			oneofIdx := field.GetOneofIndex()
			oneofName := msg.OneofDecl[oneofIdx].GetName()
			fieldJsonName := g.propertyName(field)
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				// For message types, support merging
				g.p("message.%s = {", oneofName)
				g.indent = "                        "
				g.p("oneofKind: \"%s\",", fieldJsonName)
				g.p("%s: %s", fieldJsonName, g.getReaderMethodWithMerge(field, fmt.Sprintf("(message.%s as any).%s", oneofName, fieldJsonName)))
				g.indent = "                    "
				g.p("};")
			} else {
				g.p("message.%s = {", oneofName)
				g.indent = "                        "
				g.p("oneofKind: \"%s\",", fieldJsonName)
				g.p("%s: %s", fieldJsonName, g.getReaderMethod(field))
				g.indent = "                    "
				g.p("};")
			}
		} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				// Map field
				_ = msgType.Field[1] // valueField used in map generation
				g.p("this.binaryReadMap%d(message.%s, reader, options);", field.GetNumber(), fieldName)
			} else if g.isPackedType(field) {
				// Packed repeated fields can come as either packed or unpacked
				g.p("if (wireType === WireType.LengthDelimited)")
				g.indent = "                        "
				g.p("for (let e = reader.int32() + reader.pos; reader.pos < e;)")
				g.indent = "                            "
				g.p("message.%s.push(%s);", fieldName, g.getReaderMethodSimple(field))
				g.indent = "                    "
				g.p("else")
				g.indent = "                        "
				g.p("message.%s.push(%s);", fieldName, g.getReaderMethod(field))
				g.indent = "                    "
			} else {
				g.p("message.%s.push(%s);", fieldName, g.getReaderMethod(field))
			}
		} else {
			if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				// For message fields, pass existing message for merging
				fieldName := g.propertyName(field)
				g.p("message.%s = %s;", fieldName, g.getReaderMethodWithMerge(field, "message."+fieldName))
			} else {
				g.p("message.%s = %s;", fieldName, g.getReaderMethod(field))
			}
		}
		
		g.indent = "                    "
		g.p("break;")
	}
	
	g.indent = "                "
	g.p("default:")
	g.indent = "                    "
	g.p("let u = options.readUnknownField;")
	g.p("if (u === \"throw\")")
	g.indent = "                        "
	g.p("throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);")
	g.indent = "                    "
	g.p("let d = reader.skip(wireType);")
	g.p("if (u !== false)")
	g.indent = "                        "
	g.p("(u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);")
	g.indent = "            "
	g.p("}")
	g.indent = "        "
	g.p("}")
	g.p("return message;")
	g.indent = "    "
	g.p("}")
	
	// Add map read helpers if needed
	pkgPrefix = ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	protoTypeName := pkgPrefix + strings.ReplaceAll(fullName, "_", ".")
	
	for _, field := range msg.Field {
		if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				
				fieldName := g.propertyName(field)
				g.p("private binaryReadMap%d(map: %s[\"%s\"], reader: IBinaryReader, options: BinaryReadOptions): void {",
					field.GetNumber(),
					fullName,
					fieldName)
				g.indent = "        "
				g.p("let len = reader.uint32(), end = reader.pos + len, key: keyof %s[\"%s\"] | undefined, val: %s[\"%s\"][any] | undefined;",
					fullName, fieldName, fullName, fieldName)
				g.p("while (reader.pos < end) {")
				g.indent = "            "
				g.p("let [fieldNo, wireType] = reader.tag();")
				g.p("switch (fieldNo) {")
				g.indent = "                "
				g.p("case 1:")
				g.indent = "                    "
				g.p("key = %s;", g.getReaderMethod(keyField))
				g.indent = "                    "
				g.p("break;")
				g.indent = "                "
				g.p("case 2:")
				g.indent = "                    "
				g.p("val = %s;", g.getReaderMethod(valueField))
				g.indent = "                    "
				g.p("break;")
				g.indent = "                "
				g.p("default: throw new globalThis.Error(\"unknown map entry field for %s.%s\");", protoTypeName, field.GetName())
				g.indent = "            "
				g.p("}")
				g.indent = "        "
				g.p("}")
				
				// Generate proper default assignment
				keyDefault := g.getMapKeyDefault(keyField)
				valueDefault := g.getMapValueDefault(valueField)
				g.p("map[key ?? %s] = val ?? %s;", keyDefault, valueDefault)
				g.indent = "    "
				g.p("}")
			}
		}
	}
	
	// internalBinaryWrite method
	g.p("internalBinaryWrite(message: %s, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {", fullName)
	g.indent = "        "
	
	for _, field := range msg.Field {
		fieldName := g.propertyName(field)
		g.p("/* %s %s = %d; */", g.getProtoType(field), field.GetName(), field.GetNumber())
		
		if field.OneofIndex != nil {
			// Get oneof name
			oneofIdx := field.GetOneofIndex()
			oneofName := msg.OneofDecl[oneofIdx].GetName()
			fieldJsonName := g.propertyName(field)
			g.p("if (message.%s.oneofKind === \"%s\")", oneofName, fieldJsonName)
			g.indent = "            "
			g.p("%s", g.getWriterMethod(field, "message."+oneofName+"."+fieldJsonName))
			g.indent = "        "
		} else if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
			msgType := g.findMessageType(field.GetTypeName())
			if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
				// Map field
				keyField := msgType.Field[0]
				valueField := msgType.Field[1]
				
				// Check if key is numeric
				isNumericKey := keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED64 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED32 ||
					keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED64
				
				if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					// Message value - needs special handling
					if isNumericKey {
						g.p("for (let k of globalThis.Object.keys(message.%s)) {", fieldName)
						g.indent = "            "
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.Varint).int32(parseInt(k));", field.GetNumber())
						g.p("writer.tag(2, WireType.LengthDelimited).fork();")
						g.p("%s.internalBinaryWrite(message.%s[k as any], writer, options);", g.stripPackage(valueField.GetTypeName()), fieldName)
						g.p("writer.join().join();")
						g.indent = "        "
						g.p("}")
					} else {
						g.p("for (let k of globalThis.Object.keys(message.%s)) {", fieldName)
						g.indent = "            "
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string(k);", field.GetNumber())
						g.p("writer.tag(2, WireType.LengthDelimited).fork();")
						g.p("%s.internalBinaryWrite(message.%s[k], writer, options);", g.stripPackage(valueField.GetTypeName()), fieldName)
						g.p("writer.join().join();")
						g.indent = "        "
						g.p("}")
					}
				} else {
					// Scalar value
					g.p("for (let k of globalThis.Object.keys(message.%s))", fieldName)
					g.indent = "            "
					if isNumericKey {
						// For 64-bit types and signed types that use string keys, use k directly
						// For 32-bit types that use number keys, use parseInt(k)
						keyVar := "k"
						valueAccessor := "message." + fieldName + "[k]"
						if keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED32 ||
							keyField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED32 {
							keyVar = "parseInt(k)"
							valueAccessor = "message." + fieldName + "[k as any]"
						}
						keyWriter := g.getMapKeyWriter(keyField, keyVar)
						valueWriter := g.getMapValueWriter(valueField, valueAccessor)
						g.p("writer.tag(%d, WireType.LengthDelimited).fork()%s%s.join();",
							field.GetNumber(), keyWriter, valueWriter)
					} else {
						valueWriter := g.getMapValueWriter(valueField, "message."+fieldName+"[k]")
						g.p("writer.tag(%d, WireType.LengthDelimited).fork().tag(1, WireType.LengthDelimited).string(k)%s.join();",
							field.GetNumber(), valueWriter)
					}
					g.indent = "        "
				}
			} else if g.isPackedType(field) {
				// Write packed repeated fields
				g.p("if (message.%s.length) {", fieldName)
				g.indent = "            "
				g.p("writer.tag(%d, WireType.LengthDelimited).fork();", field.GetNumber())
				g.p("for (let i = 0; i < message.%s.length; i++)", fieldName)
				g.indent = "                "
				method := g.getWriterMethodName(field)
				g.p("writer.%s(message.%s[i]);", method, fieldName)
				g.indent = "            "
				g.p("writer.join();")
				g.indent = "        "
				g.p("}")
			} else {
				g.p("for (let i = 0; i < message.%s.length; i++)", fieldName)
				g.indent = "            "
				g.p("%s", g.getWriterMethod(field, "message."+fieldName+"[i]"))
				g.indent = "        "
			}
		} else {
			condition := g.getWriteCondition(field, fieldName)
			if condition != "" {
				g.p("if (%s)", condition)
				g.indent = "            "
			}
			g.p("%s", g.getWriterMethod(field, "message."+fieldName))
			if condition != "" {
				g.indent = "        "
			}
		}
	}
	
	g.p("let u = options.writeUnknownFields;")
	g.p("if (u !== false)")
	g.indent = "            "
	g.p("(u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);")
	g.indent = "        "
	g.p("return writer;")
	g.indent = "    "
	g.p("}")
	
	g.indent = ""
	g.pNoIndent("}")
	
	// Export constant
	g.pNoIndent("/**")
	g.pNoIndent(" * @generated MessageType for protobuf message %s", typeName)
	g.pNoIndent(" */")
	g.pNoIndent("export const %s = new %s();", fullName, className)
}

func (g *generator) getScalarTypeEnum(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "1"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "2"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "3"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "4"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "5"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "6"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "7"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "8"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "9"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "12"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "13"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "15"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "16"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "17"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "18"
	default:
		return "9" // default to string
	}
}

func (g *generator) getScalarTypeName(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "DOUBLE"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "FLOAT"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "INT64"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "UINT64"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "INT32"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "FIXED64"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "FIXED32"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "BOOL"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "STRING"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "BYTES"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "UINT32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "SFIXED32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "SFIXED64"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "SINT32"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "SINT64"
	default:
		return "STRING"
	}
}

func (g *generator) getDefaultValue(field *descriptorpb.FieldDescriptorProto) string {
	if field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		msgType := g.findMessageType(field.GetTypeName())
		if msgType != nil && msgType.Options != nil && msgType.GetOptions().GetMapEntry() {
			return "{}"
		}
		return "[]"
	}
	
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		return "" // optional messages don't get defaults
	}
	
	// Proto2 optional scalars don't get defaults
	isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
	if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
		return ""
	}
	
	// Proto3 explicit optional scalars don't get defaults
	if field.Proto3Optional != nil && *field.Proto3Optional {
		return ""
	}
	
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		if g.params.longType == "string" {
			return "\"0\""
		}
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "false"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "\"\""
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "new Uint8Array(0)"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "0"
	default:
		return ""
	}
}

func (g *generator) getReaderMethod(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "reader.double()"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "reader.float()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "reader.int64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "reader.uint64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "reader.fixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "reader.fixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "reader.bool()"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "reader.string()"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "reader.bytes()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "reader.uint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "reader.sfixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "reader.sfixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "reader.sint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "reader.sint64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.internalBinaryRead(reader, reader.uint32(), options)", typeName)
	default:
		return "reader.string()"
	}
}

func (g *generator) getReaderMethodWithMerge(field *descriptorpb.FieldDescriptorProto, existingVar string) string {
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.internalBinaryRead(reader, reader.uint32(), options, %s)", typeName, existingVar)
	}
	return g.getReaderMethod(field)
}

func (g *generator) getReaderMethodSimple(field *descriptorpb.FieldDescriptorProto) string {
	// Simpler reader for packed repeated fields (no length prefix)
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "reader.double()"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "reader.float()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "reader.int64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "reader.uint64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "reader.fixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "reader.fixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "reader.bool()"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "reader.uint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "reader.int32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "reader.sfixed32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "reader.sfixed64().toString()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "reader.sint32()"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "reader.sint64().toString()"
	default:
		return "reader.int32()"
	}
}

func (g *generator) getWriterMethod(field *descriptorpb.FieldDescriptorProto, varName string) string {
	wireType := g.getWireType(field)
	
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.internalBinaryWrite(%s, writer.tag(%d, %s).fork(), options).join();",
			typeName, varName, field.GetNumber(), wireType)
	default:
		method := g.getWriterMethodName(field)
		return fmt.Sprintf("writer.tag(%d, %s).%s(%s);", field.GetNumber(), wireType, method, varName)
	}
}

func (g *generator) getMapValueWriter(field *descriptorpb.FieldDescriptorProto, varName string) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return fmt.Sprintf(".tag(2, WireType.Varint).int32(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return fmt.Sprintf(".tag(2, WireType.LengthDelimited).string(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return fmt.Sprintf(".tag(2, WireType.Varint).bool(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return fmt.Sprintf(".tag(2, WireType.Varint).int32(%s)", varName)
	default:
		return fmt.Sprintf(".tag(2, WireType.LengthDelimited).string(%s)", varName)
	}
}

func (g *generator) getMapKeyWriter(field *descriptorpb.FieldDescriptorProto, varName string) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return fmt.Sprintf(".tag(1, WireType.Varint).int32(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return fmt.Sprintf(".tag(1, WireType.Varint).sint32(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return fmt.Sprintf(".tag(1, WireType.Varint).uint32(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return fmt.Sprintf(".tag(1, WireType.Varint).int64(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return fmt.Sprintf(".tag(1, WireType.Varint).sint64(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return fmt.Sprintf(".tag(1, WireType.Varint).uint64(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return fmt.Sprintf(".tag(1, WireType.LengthDelimited).string(%s)", varName)
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return fmt.Sprintf(".tag(1, WireType.Varint).bool(%s)", varName)
	default:
		return fmt.Sprintf(".tag(1, WireType.LengthDelimited).string(%s)", varName)
	}
}

func (g *generator) getWireType(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "WireType.Bit64"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "WireType.Bit32"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING,
		descriptorpb.FieldDescriptorProto_TYPE_BYTES,
		descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		return "WireType.LengthDelimited"
	default:
		return "WireType.Varint"
	}
}

func (g *generator) getWriterMethodName(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return "double"
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return "float"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return "int64"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT64:
		return "uint64"
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return "int32"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED64:
		return "fixed64"
	case descriptorpb.FieldDescriptorProto_TYPE_FIXED32:
		return "fixed32"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "bool"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "string"
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "bytes"
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return "uint32"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "int32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "sfixed32"
	case descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		return "sfixed64"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT32:
		return "sint32"
	case descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return "sint64"
	default:
		return "string"
	}
}

func (g *generator) getWriteCondition(field *descriptorpb.FieldDescriptorProto, fieldName string) string {
	isProto2 := g.file.GetSyntax() == "proto2" || g.file.GetSyntax() == ""
	isProto3Optional := field.Proto3Optional != nil && *field.Proto3Optional
	
	// Proto2 optional fields or proto3 explicit optional fields need undefined check
	if isProto2 && field.GetLabel() == descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL {
		return fmt.Sprintf("message.%s !== undefined", fieldName)
	}
	if isProto3Optional {
		return fmt.Sprintf("message.%s !== undefined", fieldName)
	}
	
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_BYTES {
		return fmt.Sprintf("message.%s.length", fieldName)
	}
	
	// Optional message fields need existence check
	if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE && 
	   field.GetLabel() != descriptorpb.FieldDescriptorProto_LABEL_REPEATED {
		return fmt.Sprintf("message.%s", fieldName)
	}
	
	defaultVal := g.getDefaultValue(field)
	if defaultVal == "" || defaultVal == "[]" || defaultVal == "{}" {
		return ""
	}
	return fmt.Sprintf("message.%s !== %s", fieldName, defaultVal)
}

func (g *generator) generateEnum(enum *descriptorpb.EnumDescriptorProto, parentPrefix string) {
	enumName := parentPrefix + enum.GetName()
	
	g.pNoIndent("/**")
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	g.pNoIndent(" * @generated from protobuf enum %s%s", pkgPrefix, strings.ReplaceAll(enumName, "_", "."))
	g.pNoIndent(" */")
	g.pNoIndent("export enum %s {", enumName)
	
	// Detect common prefix
	commonPrefix := g.detectEnumPrefix(enum)
	
	for i, value := range enum.Value {
		g.indent = "    "
		g.p("/**")
		g.p(" * @generated from protobuf enum value: %s = %d;", value.GetName(), value.GetNumber())
		g.p(" */")
		
		// Strip common prefix
		tsName := value.GetName()
		if commonPrefix != "" {
			tsName = strings.TrimPrefix(tsName, commonPrefix)
		}
		
		// No comma on last value
		comma := ","
		if i == len(enum.Value)-1 {
			comma = ""
		}
		g.p("%s = %d%s", tsName, value.GetNumber(), comma)
	}
	
	g.indent = ""
	g.pNoIndent("}")
}

func (g *generator) detectEnumPrefix(enum *descriptorpb.EnumDescriptorProto) string {
	if len(enum.Value) == 0 {
		return ""
	}
	
	// Get first value name as candidate prefix
	first := enum.Value[0].GetName()
	
	// Try to find common prefix ending with _
	for i := len(first); i > 0; i-- {
		if first[i-1] == '_' {
			candidate := first[:i]
			// Check if all values have this prefix
			allHave := true
			validAfterStrip := true
			for _, v := range enum.Value {
				if !strings.HasPrefix(v.GetName(), candidate) {
					allHave = false
					break
				}
				// Also check if stripping this prefix leaves valid identifiers
				// (not starting with a digit)
				remainder := strings.TrimPrefix(v.GetName(), candidate)
				if len(remainder) == 0 || (remainder[0] >= '0' && remainder[0] <= '9') {
					validAfterStrip = false
					break
				}
			}
			if allHave && validAfterStrip {
				return candidate
			}
		}
	}
	
	return ""
}

func generateClientFile(file *descriptorpb.FileDescriptorProto, allFiles []*descriptorpb.FileDescriptorProto, params params) string {
	g := &generator{
		params: params,
		file:   file,
		allFiles: allFiles,
	}
	
	// Header
	g.pNoIndent("// @generated by protobuf-ts 2.11.1 with parameter long_type_%s", params.longType)
	pkgComment := ""
	syntax := file.GetSyntax()
	if syntax == "" {
		syntax = "proto2" // Default to proto2 when syntax is not specified
	}
	if file.Package != nil && *file.Package != "" {
		pkgComment = fmt.Sprintf(" (package \"%s\", syntax %s)", *file.Package, syntax)
	} else {
		pkgComment = fmt.Sprintf(" (syntax %s)", syntax)
	}
	g.pNoIndent("// @generated from protobuf file \"%s\"%s", file.GetName(), pkgComment)
	g.pNoIndent("// tslint:disable")
	
	// Add file-level leading detached comments (license headers, etc.)
	if file.SourceCodeInfo != nil {
		for _, loc := range file.SourceCodeInfo.Location {
			// Check for syntax field with detached comments
			if len(loc.Path) == 1 && loc.Path[0] == 12 && len(loc.LeadingDetachedComments) > 0 {
				// Blank line before the license header
				g.pNoIndent("//")
				for _, detached := range loc.LeadingDetachedComments {
					comments := strings.TrimSpace(detached)
					if comments != "" {
						for _, line := range strings.Split(comments, "\n") {
							line = strings.TrimRight(line, " \t")
							if line == "" {
								g.pNoIndent("//")
							} else {
								// Strip one leading space if present (protobuf convention)
								if strings.HasPrefix(line, " ") {
									line = line[1:]
								}
								g.pNoIndent("// %s", line)
							}
						}
						// Add blank line after detached comment block
						g.pNoIndent("//")
					}
				}
			}
		}
	}
	
	baseFileName := strings.TrimSuffix(filepath.Base(file.GetName()), ".proto")
	
	// Collect imports
	seen := make(map[string]bool)
	
	// For services 2..N (in reverse order), output Service + all method types
	for svcIdx := len(file.Service) - 1; svcIdx >= 1; svcIdx-- {
		service := file.Service[svcIdx]
		g.pNoIndent("import { %s } from \"./%s\";", service.GetName(), baseFileName)
		
		// Add method types in reverse order
		for i := len(service.Method) - 1; i >= 0; i-- {
			method := service.Method[i]
			resType := g.stripPackage(method.GetOutputType())
			reqType := g.stripPackage(method.GetInputType())
			resTypePath := g.getImportPathForType(method.GetOutputType())
			reqTypePath := g.getImportPathForType(method.GetInputType())
			
			if !seen[resType] {
				g.pNoIndent("import type { %s } from \"%s\";", resType, resTypePath)
				seen[resType] = true
			}
			if !seen[reqType] {
				g.pNoIndent("import type { %s } from \"%s\";", reqType, reqTypePath)
				seen[reqType] = true
			}
		}
	}
	
	// RPC imports
	g.pNoIndent("import type { RpcTransport } from \"@protobuf-ts/runtime-rpc\";")
	g.pNoIndent("import type { ServiceInfo } from \"@protobuf-ts/runtime-rpc\";")
	
	// Declare streaming types list for later use
	var streamingTypes []struct{ name, path string }
	
	// First service + methods types with special ordering
	if len(file.Service) > 0 {
		service := file.Service[0]
		g.pNoIndent("import { %s } from \"./%s\";", service.GetName(), baseFileName)
		
		// Collect method 0 types for filtering
		method0Types := make(map[string]bool)
		if len(service.Method) > 0 {
			method0 := service.Method[0]
			method0Types[g.stripPackage(method0.GetOutputType())] = true
			method0Types[g.stripPackage(method0.GetInputType())] = true
		}
		
		// Collect types from methods 1-N in reverse order
		type typeInfo struct {
			name       string
			path       string
			methodIdx  int  // method index where first seen
		}
		var collectedTypes []typeInfo
		
		for i := len(service.Method) - 1; i >= 1; i-- {
			method := service.Method[i]
			isStreaming := method.GetServerStreaming() || method.GetClientStreaming()
			
			resType := g.stripPackage(method.GetOutputType())
			reqType := g.stripPackage(method.GetInputType())
			resTypePath := g.getImportPathForType(method.GetOutputType())
			reqTypePath := g.getImportPathForType(method.GetInputType())
			
			// Process output type first
			if !seen[resType] && !method0Types[resType] {
				if isStreaming {
					streamingTypes = append(streamingTypes, struct{ name, path string }{resType, resTypePath})
				} else {
					collectedTypes = append(collectedTypes, typeInfo{resType, resTypePath, i})
				}
				seen[resType] = true
			}
			
			// Process input type second
			if !seen[reqType] && !method0Types[reqType] {
				if isStreaming {
					streamingTypes = append(streamingTypes, struct{ name, path string }{reqType, reqTypePath})
				} else {
					collectedTypes = append(collectedTypes, typeInfo{reqType, reqTypePath, i})
				}
				seen[reqType] = true
			}
		}
		
		// Emit imports: group all types by path in order of first appearance of each path
		if len(collectedTypes) > 0 {
			// Track paths in order of first appearance
			var pathOrder []string
			pathsSeen := make(map[string]bool)
			for _, t := range collectedTypes {
				if !pathsSeen[t.path] {
					pathOrder = append(pathOrder, t.path)
					pathsSeen[t.path] = true
				}
			}
			
			// Determine if we have multiple paths
			multiplePaths := len(pathOrder) > 1
			
			// Emit imports grouped by path
			for _, path := range pathOrder {
				// Collect types for this path
				var pathTypes []typeInfo
				for _, t := range collectedTypes {
					if t.path == path {
						pathTypes = append(pathTypes, t)
					}
				}
				
				// If multiple paths: sort each path group in forward order (smaller methodIdx first)
				// If single path: keep encounter order (which is already reverse)
				if multiplePaths {
					for i := 0; i < len(pathTypes); i++ {
						for j := i + 1; j < len(pathTypes); j++ {
							if pathTypes[i].methodIdx > pathTypes[j].methodIdx {
								pathTypes[i], pathTypes[j] = pathTypes[j], pathTypes[i]
							}
						}
					}
				}
				
				// Emit types for this path
				for _, t := range pathTypes {
					g.pNoIndent("import type { %s } from \"%s\";", t.name, path)
				}
			}
		}
	}
	
	// Import call types based on method types
	hasUnary := false
	hasServerStreaming := false
	hasClientStreaming := false
	hasDuplex := false
	
	for _, service := range file.Service {
		for _, method := range service.Method {
			if method.GetClientStreaming() && method.GetServerStreaming() {
				hasDuplex = true
			} else if method.GetServerStreaming() {
				hasServerStreaming = true
			} else if method.GetClientStreaming() {
				hasClientStreaming = true
			} else {
				hasUnary = true
			}
		}
	}
	
	// Import streaming call types in reverse order
	if hasDuplex {
		g.pNoIndent("import type { DuplexStreamingCall } from \"@protobuf-ts/runtime-rpc\";")
	}
	if hasClientStreaming {
		g.pNoIndent("import type { ClientStreamingCall } from \"@protobuf-ts/runtime-rpc\";")
	}
	if hasServerStreaming {
		g.pNoIndent("import type { ServerStreamingCall } from \"@protobuf-ts/runtime-rpc\";")
	}
	
	// Import streaming method types (before stackIntercept)
	for _, typeInfo := range streamingTypes {
		g.pNoIndent("import type { %s } from \"%s\";", typeInfo.name, typeInfo.path)
	}
	
	if hasUnary {
		g.pNoIndent("import { stackIntercept } from \"@protobuf-ts/runtime-rpc\";")
	}
	
	// First service, first method types (output first, then input)
	if len(file.Service) > 0 && len(file.Service[0].Method) > 0 {
		method := file.Service[0].Method[0]
		resType := g.stripPackage(method.GetOutputType())
		reqType := g.stripPackage(method.GetInputType())
		resTypePath := g.getImportPathForType(method.GetOutputType())
		reqTypePath := g.getImportPathForType(method.GetInputType())
		
		// Import output type first
		if !seen[resType] {
			g.pNoIndent("import type { %s } from \"%s\";", resType, resTypePath)
			seen[resType] = true
		}
		// Import input type second
		if !seen[reqType] {
			g.pNoIndent("import type { %s } from \"%s\";", reqType, reqTypePath)
			seen[reqType] = true
		}
	}
	
	if hasUnary || hasServerStreaming || hasClientStreaming || hasDuplex {
		g.pNoIndent("import type { UnaryCall } from \"@protobuf-ts/runtime-rpc\";")
		g.pNoIndent("import type { RpcOptions } from \"@protobuf-ts/runtime-rpc\";")
	}
	
	// Generate service clients
	for _, service := range file.Service {
		g.generateServiceClient(service)
	}
	
	return g.b.String()
}

func (g *generator) generateServiceClient(service *descriptorpb.ServiceDescriptorProto) {
	serviceName := service.GetName()
	clientName := "I" + serviceName + "Client"
	
	pkgPrefix := ""
	if g.file.Package != nil && *g.file.Package != "" {
		pkgPrefix = *g.file.Package + "."
	}
	
	// Get service index for comments
	svcIndex := -1
	for i, s := range g.file.Service {
		if s.GetName() == serviceName {
			svcIndex = i
			break
		}
	}
	
	// Interface
	g.pNoIndent("/**")
	
	// Add service-level leading comments if available
	if svcIndex >= 0 {
		leadingComments := g.getLeadingComments([]int32{6, int32(svcIndex)})
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", line)
				}
			}
			g.pNoIndent(" *")
		}
	}
	
	g.pNoIndent(" * @generated from protobuf service %s%s", pkgPrefix, serviceName)
	g.pNoIndent(" */")
	g.pNoIndent("export interface %s {", clientName)
	g.indent = "    "
	
	for methodIdx, method := range service.Method {
		reqType := g.stripPackage(method.GetInputType())
		resType := g.stripPackage(method.GetOutputType())
		methodName := g.lowerFirst(method.GetName())
		
		g.p("/**")
		
		// Add method-level leading comments if available
		methodPath := []int32{6, int32(svcIndex), 2, int32(methodIdx)}
		leadingComments := g.getLeadingComments(methodPath)
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", line)
				}
			}
			g.p(" *")
		}
		
		g.p(" * @generated from protobuf rpc: %s", method.GetName())
		g.p(" */")
		
		// Determine call type and signature based on streaming
		if method.GetClientStreaming() && method.GetServerStreaming() {
			// Bidirectional streaming
			g.p("%s(options?: RpcOptions): DuplexStreamingCall<%s, %s>;", methodName, reqType, resType)
		} else if method.GetServerStreaming() {
			// Server streaming
			g.p("%s(input: %s, options?: RpcOptions): ServerStreamingCall<%s, %s>;", methodName, reqType, reqType, resType)
		} else if method.GetClientStreaming() {
			// Client streaming
			g.p("%s(options?: RpcOptions): ClientStreamingCall<%s, %s>;", methodName, reqType, resType)
		} else {
			// Unary
			g.p("%s(input: %s, options?: RpcOptions): UnaryCall<%s, %s>;", methodName, reqType, reqType, resType)
		}
	}
	
	g.indent = ""
	g.pNoIndent("}")
	
	// Implementation
	g.pNoIndent("/**")
	
	// Add service-level leading comments if available
	if svcIndex >= 0 {
		leadingComments := g.getLeadingComments([]int32{6, int32(svcIndex)})
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.pNoIndent(" *")
				} else {
					g.pNoIndent(" * %s", line)
				}
			}
			g.pNoIndent(" *")
		}
	}
	
	g.pNoIndent(" * @generated from protobuf service %s%s", pkgPrefix, serviceName)
	g.pNoIndent(" */")
	g.pNoIndent("export class %sClient implements %s, ServiceInfo {", serviceName, clientName)
	g.indent = "    "
	g.p("typeName = %s.typeName;", serviceName)
	g.p("methods = %s.methods;", serviceName)
	g.p("options = %s.options;", serviceName)
	g.p("constructor(private readonly _transport: RpcTransport) {")
	g.p("}")
	
	for methodIdx, method := range service.Method {
		reqType := g.stripPackage(method.GetInputType())
		resType := g.stripPackage(method.GetOutputType())
		methodName := g.lowerFirst(method.GetName())
		
		g.p("/**")
		
		// Add method-level leading comments if available
		methodPath := []int32{6, int32(svcIndex), 2, int32(methodIdx)}
		leadingComments := g.getLeadingComments(methodPath)
		if leadingComments != "" {
			hasTrailingBlank := strings.HasSuffix(leadingComments, "__HAS_TRAILING_BLANK__")
			if hasTrailingBlank {
				leadingComments = strings.TrimSuffix(leadingComments, "\n__HAS_TRAILING_BLANK__")
			}
			
			lines := strings.Split(leadingComments, "\n")
			for _, line := range lines {
				if line == "" {
					g.p(" *")
				} else {
					g.p(" * %s", line)
				}
			}
			g.p(" *")
		}
		
		g.p(" * @generated from protobuf rpc: %s", method.GetName())
		g.p(" */")
		
		// Determine call type and implementation based on streaming
		if method.GetClientStreaming() && method.GetServerStreaming() {
			// Bidirectional streaming
			g.p("%s(options?: RpcOptions): DuplexStreamingCall<%s, %s> {", methodName, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"duplex\", this._transport, method, opt);", reqType, resType)
			g.indent = "    "
			g.p("}")
		} else if method.GetServerStreaming() {
			// Server streaming
			g.p("%s(input: %s, options?: RpcOptions): ServerStreamingCall<%s, %s> {", methodName, reqType, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"serverStreaming\", this._transport, method, opt, input);", reqType, resType)
			g.indent = "    "
			g.p("}")
		} else if method.GetClientStreaming() {
			// Client streaming
			g.p("%s(options?: RpcOptions): ClientStreamingCall<%s, %s> {", methodName, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"clientStreaming\", this._transport, method, opt);", reqType, resType)
			g.indent = "    "
			g.p("}")
		} else {
			// Unary
			g.p("%s(input: %s, options?: RpcOptions): UnaryCall<%s, %s> {", methodName, reqType, reqType, resType)
			g.indent = "        "
			g.p("const method = this.methods[%d], opt = this._transport.mergeOptions(options);", g.findMethodIndex(service, method))
			g.p("return stackIntercept<%s, %s>(\"unary\", this._transport, method, opt, input);", reqType, resType)
			g.indent = "    "
			g.p("}")
		}
	}
	
	g.indent = ""
	g.pNoIndent("}")
}

func (g *generator) findMethodIndex(service *descriptorpb.ServiceDescriptorProto, method *descriptorpb.MethodDescriptorProto) int {
	for i, m := range service.Method {
		if m == method {
			return i
		}
	}
	return 0
}

func (g *generator) lowerFirst(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func (g *generator) isPackedType(field *descriptorpb.FieldDescriptorProto) bool {
	// In proto3, numeric and bool types are packed by default
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_BOOL,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_ENUM,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64:
		return true
	default:
		return false
	}
}

func (g *generator) getMapKeyDefault(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		if g.params.longType == "string" && (field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_INT64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_UINT64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SINT64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_FIXED64 ||
			field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_SFIXED64) {
			return "\"0\""
		}
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "false"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "\"\""
	default:
		return "\"\""
	}
}

func (g *generator) getMapValueDefault(field *descriptorpb.FieldDescriptorProto) string {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE,
		descriptorpb.FieldDescriptorProto_TYPE_FLOAT,
		descriptorpb.FieldDescriptorProto_TYPE_INT32,
		descriptorpb.FieldDescriptorProto_TYPE_UINT32,
		descriptorpb.FieldDescriptorProto_TYPE_SINT32,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED32,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED32:
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_INT64,
		descriptorpb.FieldDescriptorProto_TYPE_UINT64,
		descriptorpb.FieldDescriptorProto_TYPE_SINT64,
		descriptorpb.FieldDescriptorProto_TYPE_FIXED64,
		descriptorpb.FieldDescriptorProto_TYPE_SFIXED64:
		if g.params.longType == "string" {
			return "\"0\""
		}
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return "false"
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return "\"\""
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return "new Uint8Array(0)"
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		return "0"
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		typeName := g.stripPackage(field.GetTypeName())
		return fmt.Sprintf("%s.create()", typeName)
	default:
		return "\"\""
	}
}

func (g *generator) generateService(svc *descriptorpb.ServiceDescriptorProto) {
pkgPrefix := ""
if g.file.Package != nil && *g.file.Package != "" {
pkgPrefix = *g.file.Package + "."
}

svcName := svc.GetName()
fullName := pkgPrefix + svcName

g.pNoIndent("/**")
g.pNoIndent(" * @generated ServiceType for protobuf service %s", fullName)
g.pNoIndent(" */")
g.pNoIndent("export const %s = new ServiceType(\"%s\", [", svcName, fullName)

// Generate method descriptors
g.indent = "    "
for i, method := range svc.Method {
inputType := g.stripPackage(method.GetInputType())
outputType := g.stripPackage(method.GetOutputType())
comma := ","
if i == len(svc.Method)-1 {
comma = ""
}

	// Build streaming flags
	streamingFlags := ""
	if method.GetServerStreaming() {
		streamingFlags += "serverStreaming: true, "
	}
	if method.GetClientStreaming() {
		streamingFlags += "clientStreaming: true, "
	}

	g.p("{ name: \"%s\", %soptions: {}, I: %s, O: %s }%s",
		method.GetName(), streamingFlags, inputType, outputType, comma)
}
g.indent = ""
g.pNoIndent("]);")
}

func (g *generator) generateTimestampMethods() {
g.indent = "    "

// now() method
g.p("/**")
g.p(" * Creates a new `Timestamp` for the current time.")
g.p(" */")
g.p("now(): Timestamp {")
g.indent = "        "
g.p("const msg = this.create();")
g.p("const ms = Date.now();")
g.p("msg.seconds = PbLong.from(Math.floor(ms / 1000)).toString();")
g.p("msg.nanos = (ms %% 1000) * 1000000;")
g.p("return msg;")
g.indent = "    "
g.p("}")

// toDate() method
g.p("/**")
g.p(" * Converts a `Timestamp` to a JavaScript Date.")
g.p(" */")
g.p("toDate(message: Timestamp): Date {")
g.indent = "        "
g.p("return new Date(PbLong.from(message.seconds).toNumber() * 1000 + Math.ceil(message.nanos / 1000000));")
g.indent = "    "
g.p("}")

// fromDate() method
g.p("/**")
g.p(" * Converts a JavaScript Date to a `Timestamp`.")
g.p(" */")
g.p("fromDate(date: Date): Timestamp {")
g.indent = "        "
g.p("const msg = this.create();")
g.p("const ms = date.getTime();")
g.p("msg.seconds = PbLong.from(Math.floor(ms / 1000)).toString();")
g.p("msg.nanos = ((ms %% 1000) + (ms < 0 && ms %% 1000 !== 0 ? 1000 : 0)) * 1000000;")
g.p("return msg;")
g.indent = "    "
g.p("}")

// internalJsonWrite() method
g.p("/**")
g.p(" * In JSON format, the `Timestamp` type is encoded as a string")
g.p(" * in the RFC 3339 format.")
g.p(" */")
g.p("internalJsonWrite(message: Timestamp, options: JsonWriteOptions): JsonValue {")
g.indent = "        "
g.p("let ms = PbLong.from(message.seconds).toNumber() * 1000;")
g.p("if (ms < Date.parse(\"0001-01-01T00:00:00Z\") || ms > Date.parse(\"9999-12-31T23:59:59Z\"))")
g.indent = "            "
g.p("throw new Error(\"Unable to encode Timestamp to JSON. Must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive.\");")
g.indent = "        "
g.p("if (message.nanos < 0)")
g.indent = "            "
g.p("throw new Error(\"Unable to encode invalid Timestamp to JSON. Nanos must not be negative.\");")
g.indent = "        "
g.p("let z = \"Z\";")
g.p("if (message.nanos > 0) {")
g.indent = "            "
g.p("let nanosStr = (message.nanos + 1000000000).toString().substring(1);")
g.p("if (nanosStr.substring(3) === \"000000\")")
g.indent = "                "
g.p("z = \".\" + nanosStr.substring(0, 3) + \"Z\";")
g.indent = "            "
g.p("else if (nanosStr.substring(6) === \"000\")")
g.indent = "                "
g.p("z = \".\" + nanosStr.substring(0, 6) + \"Z\";")
g.indent = "            "
g.p("else")
g.indent = "                "
g.p("z = \".\" + nanosStr + \"Z\";")
g.indent = "        "
g.p("}")
g.p("return new Date(ms).toISOString().replace(\".000Z\", z);")
g.indent = "    "
g.p("}")

// internalJsonRead() method
g.p("/**")
g.p(" * In JSON format, the `Timestamp` type is encoded as a string")
g.p(" * in the RFC 3339 format.")
g.p(" */")
g.p("internalJsonRead(json: JsonValue, options: JsonReadOptions, target?: Timestamp): Timestamp {")
g.indent = "        "
g.p("if (typeof json !== \"string\")")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Timestamp from JSON \" + typeofJsonValue(json) + \".\");")
g.indent = "        "
g.p("let matches = json.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:Z|\\.([0-9]{3,9})Z|([+-][0-9][0-9]:[0-9][0-9]))$/);")
g.p("if (!matches)")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Timestamp from JSON. Invalid format.\");")
g.indent = "        "
g.p("let ms = Date.parse(matches[1] + \"-\" + matches[2] + \"-\" + matches[3] + \"T\" + matches[4] + \":\" + matches[5] + \":\" + matches[6] + (matches[8] ? matches[8] : \"Z\"));")
g.p("if (Number.isNaN(ms))")
g.indent = "            "
g.p("throw new Error(\"Unable to parse Timestamp from JSON. Invalid value.\");")
g.indent = "        "
g.p("if (ms < Date.parse(\"0001-01-01T00:00:00Z\") || ms > Date.parse(\"9999-12-31T23:59:59Z\"))")
g.indent = "            "
g.p("throw new globalThis.Error(\"Unable to parse Timestamp from JSON. Must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive.\");")
g.indent = "        "
g.p("if (!target)")
g.indent = "            "
g.p("target = this.create();")
g.indent = "        "
g.p("target.seconds = PbLong.from(ms / 1000).toString();")
g.p("target.nanos = 0;")
g.p("if (matches[7])")
g.indent = "            "
g.p("target.nanos = (parseInt(\"1\" + matches[7] + \"0\".repeat(9 - matches[7].length)) - 1000000000);")
g.indent = "        "
g.p("return target;")
g.indent = "    "
g.p("}")
}
