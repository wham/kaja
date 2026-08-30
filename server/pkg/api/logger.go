package api

import (
	"log/slog"
)

type Logger struct {
	logs []*Log
	sink func(*Log)
}

func NewLogger() *Logger {
	return &Logger{
		logs: []*Log{},
	}
}

// NewStreamingLogger writes each line on to sink as it is logged, so a call
// reporting its log over a stream says each line where it happens.
func NewStreamingLogger(sink func(*Log)) *Logger {
	return &Logger{
		logs: []*Log{},
		sink: sink,
	}
}

func (l *Logger) debug(message string) {
	slog.Info(message)
	l.log(LogLevel_LEVEL_DEBUG, message)
}

func (l *Logger) info(message string) {
	slog.Info(message)
	l.log(LogLevel_LEVEL_INFO, message)
}

func (l *Logger) error(message string, err error) {
	slog.Error(message, "error", err)
	// Include the error details in the UI message
	if err != nil {
		l.log(LogLevel_LEVEL_ERROR, message+": "+err.Error())
	} else {
		l.log(LogLevel_LEVEL_ERROR, message)
	}
}

func (l *Logger) log(level LogLevel, message string) {
	entry := &Log{
		Message: message,
		Level:   level,
	}
	l.logs = append(l.logs, entry)
	if l.sink != nil {
		l.sink(entry)
	}
}
