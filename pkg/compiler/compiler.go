package compiler

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

// Status represents the current state of the compiler
type Status int

const (
	StatusUnknown Status = iota
	StatusReady
	StatusError
	StatusRunning
)

// LogLevel represents the severity level of a log message
type LogLevel int

const (
	LevelDebug LogLevel = iota
	LevelInfo
	LevelWarn
	LevelError
)

// Log represents a single log entry
type Log struct {
	Level   LogLevel
	Message string
}

// Logger interface for compiler logging
type Logger interface {
	Debug(msg string)
	Info(msg string)
	Error(msg string, err error)
	GetLogs() []Log
	GetLogsFromOffset(offset int) []Log
}

// DefaultLogger is a simple implementation of the Logger interface
type DefaultLogger struct {
	logs []Log
	mu   sync.Mutex
}

func (l *DefaultLogger) Debug(msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = append(l.logs, Log{Level: LevelDebug, Message: msg})
	fmt.Printf("[DEBUG] %s\n", msg)
}

func (l *DefaultLogger) Info(msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = append(l.logs, Log{Level: LevelInfo, Message: msg})
	fmt.Printf("[INFO] %s\n", msg)
}

func (l *DefaultLogger) Error(msg string, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	errMsg := msg
	if err != nil {
		errMsg = fmt.Sprintf("%s: %v", msg, err)
	}
	l.logs = append(l.logs, Log{Level: LevelError, Message: errMsg})
	fmt.Printf("[ERROR] %s\n", errMsg)
}

func (l *DefaultLogger) GetLogs() []Log {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.logs
}

func (l *DefaultLogger) GetLogsFromOffset(offset int) []Log {
	l.mu.Lock()
	defer l.mu.Unlock()
	if offset >= len(l.logs) {
		return nil
	}
	return l.logs[offset:]
}

// Compiler represents the compiler instance
type Compiler struct {
	mu      sync.Mutex
	status  Status
	logger  Logger
	sources []string
}

// NewCompiler creates a new compiler instance
func NewCompiler(logger Logger) *Compiler {
	if logger == nil {
		logger = &DefaultLogger{}
	}
	return &Compiler{
		status: StatusReady,
		logger: logger,
	}
}

// Compile starts the compilation process and returns the current status and logs
func (c *Compiler) Compile(projectName string, workspace string, force bool, logOffset int) (Status, []Log, []string, error) {
	if projectName == "" {
		return StatusError, nil, nil, fmt.Errorf("project name is required")
	}

	c.mu.Lock()
	if c.status != StatusRunning && logOffset == 0 {
		c.status = StatusRunning
		c.logger = &DefaultLogger{}
		c.sources = []string{}
		c.logger.Info("Starting compilation")
		go c.start(projectName, workspace, force)
	}
	c.mu.Unlock()

	// Get logs from the specified offset
	logs := c.logger.GetLogsFromOffset(logOffset)

	// Get current status and sources
	c.mu.Lock()
	status := c.status
	sources := c.sources
	c.mu.Unlock()

	return status, logs, sources, nil
}

// start begins the compilation process
func (c *Compiler) start(projectName string, workspace string, force bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	cwd, err := os.Getwd()
	if err != nil {
		c.status = StatusError
		return err
	}
	c.logger.Debug("cwd: " + cwd)

	sourcesDir := filepath.Join(cwd, "./build/sources/"+projectName)
	c.logger.Debug("sourcesDir: " + sourcesDir)

	var sources []string

	if !force {
		c.logger.Debug("Not forcing recompilation, using cached sources")
		sources = c.getSources(sourcesDir)
	}

	if force || len(sources) == 0 {
		c.logger.Debug("Starting fresh compilation")
		c.protoc(cwd, sourcesDir, workspace)
		sources = c.getSources(sourcesDir)
	}

	c.logger.Debug("Sources: " + strings.Join(sources, ", "))
	c.sources = sources

	c.status = StatusReady

	c.logger.Info("Compilation completed successfully")

	return nil
}

// GetSources returns the list of compiled source files
func (c *Compiler) GetSources() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sources
}

// GetStatus returns the current compiler status
func (c *Compiler) GetStatus() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.status
}

// GetLogs returns all logs
func (c *Compiler) GetLogs() []Log {
	return c.logger.GetLogs()
}

// GetLogsFromOffset returns logs from the specified offset
func (c *Compiler) GetLogsFromOffset(offset int) []Log {
	return c.logger.GetLogsFromOffset(offset)
}

func (c *Compiler) getSources(sourcesDir string) []string {
	var sources []string

	err := filepath.Walk(sourcesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			relativePath := strings.TrimPrefix(path, sourcesDir+"/")
			if strings.HasSuffix(relativePath, ".ts") {
				sources = append(sources, relativePath)
			}
		}
		return nil
	})

	if err != nil {
		c.logger.Error("Failed to walk sourcesDir", err)
	}

	return sources
}

func (c *Compiler) protoc(cwd string, sourcesDir string, workspace string) {
	if _, err := os.Stat(sourcesDir); err == nil {
		c.logger.Debug("Directory " + sourcesDir + " already exists, removing it")
		os.RemoveAll(sourcesDir)
	}
	os.MkdirAll(sourcesDir, os.ModePerm)

	workspaceDir := filepath.Join(cwd, "../workspace/"+workspace)
	c.logger.Debug("workspaceDir: " + workspaceDir)

	buildDir := filepath.Join(cwd, "../build")
	c.logger.Debug("binDir: " + buildDir)

	protocCommand := "protoc --plugin=protoc-gen-ts=" + buildDir + "/protoc-gen-ts --ts_out " + sourcesDir + " --ts_opt long_type_bigint -I" + workspaceDir + " $(find " + workspaceDir + " -iname \"*.proto\")"
	c.logger.Debug("Running protoc")
	c.logger.Debug(protocCommand)

	cmd := exec.Command("sh", "-c", protocCommand)
	var stderr strings.Builder
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		c.logger.Error("Failed to run protoc", err)
		c.logger.Error(stderr.String(), err)
		fmt.Printf("Failed to run protoc: %v\nStderr: %s\n", err, stderr.String())
		return
	}

	c.logger.Debug("Protoc completed successfully")
}
