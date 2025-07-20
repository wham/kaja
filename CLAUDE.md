# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Run the application locally:**
```bash
scripts/run
```
This will:
- Check and install dependencies (Go, Node.js, protoc)
- Build proto files and install protoc plugins
- Start demo gRPC and Twirp servers
- Build and run the main kaja server on port 41520

**Run with Docker:**
```bash
scripts/docker
```

**Desktop version (Wails):**
```bash
scripts/desktop
```

**Testing:**
- UI tests: `(cd ui && npm test)`
- Server tests: `(cd server && go test ./... -v)`

**Code formatting:**
- UI: `(cd ui && npm run prettier)`
- TypeScript compilation: `(cd ui && npm run tsc)`

## Architecture Overview

Kaja is a multi-platform application for exploring Twirp and gRPC APIs with these main deployment modes:

### 1. Web Server Mode (Primary)
- **Server**: Go-based HTTP server (`server/`) with Twirp API endpoints
- **Frontend**: React/TypeScript UI (`ui/`) with Monaco editor
- **Compiler**: Shared protobuf compiler package (`pkg/compiler/`)

### 2. Desktop Mode (Wails)
- **Desktop app**: Wails v2 application (`desktop/`) embedding the same compiler
- **Frontend**: Same React frontend bundled into desktop app

### 3. Docker Container
- Production deployment with embedded workspace and demo servers

## Key Components

**Compiler System (`pkg/compiler/`):**
- Compiles protobuf files to TypeScript definitions
- Thread-safe with status tracking and logging
- Used by both web server and desktop applications

**API Service (`server/internal/api/`):**
- Twirp-based API for compilation requests
- Manages multiple project compilers concurrently
- Handles configuration and log streaming

**Frontend (`ui/src/`):**
- Monaco editor for editing and exploring API definitions
- Tab-based interface with task and definition views
- AI integration for API assistance
- Real-time compilation status and logging

**Protocol Support:**
- Twirp HTTP JSON protocol
- gRPC with grpcweb transport
- Dynamic protobuf compilation and TypeScript generation

## Project Structure

- `server/` - Main web server with Twirp API
- `ui/` - React frontend with Monaco editor
- `desktop/` - Wails desktop application
- `pkg/compiler/` - Shared protobuf compiler logic
- `workspace/` - Demo protobuf definitions and servers
- `scripts/` - Development and deployment scripts

## Configuration

Configuration via `kaja.json` in workspace directory:
- `projects`: Array of API endpoints to explore
- `ai.baseUrl`: AI service endpoint for API assistance
- Environment variable support for sensitive values

## Dependencies

- **Go 1.23+**: Server and compiler logic
- **Node.js**: Frontend build and development
- **protoc**: Protocol buffer compiler
- **Wails v2**: Desktop application framework