package api

import (
	fmt "fmt"
	"log/slog"
)

type Logger struct {
	logs []*Log
}

func NewLogger() *Logger {
	return &Logger{
		logs: []*Log{},
	}
}

func (l *Logger) debug(message string, a ...any) {
	slog.Info(message, a...)
	l.log(LogLevel_LEVEL_DEBUG, message, a...)
}

func (l *Logger) info(message string, a ...any) {
	slog.Info(message)
	l.log(LogLevel_LEVEL_INFO, message, a...)
}

func (l *Logger) warn(message string, a ...any) {
	slog.Warn(message)
	l.log(LogLevel_LEVEL_WARN, message, a...)
}

func (l *Logger) error(message string, err error) {
	slog.Error(message, "error", err)
	l.log(LogLevel_LEVEL_ERROR, message)
}

func (l *Logger) log(level LogLevel, message string, a ...any) {
	l.logs = append(l.logs, &Log{
		Message: fmt.Sprintf(message, a...),
		Level:   level,
	})
}
