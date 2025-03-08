package api

import "log/slog"

type Logger struct {
	logs []*Log
}

func NewLogger() *Logger {
	return &Logger{
		logs: []*Log{},
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

func (l *Logger) warn(message string) {
	slog.Warn(message)
	l.log(LogLevel_LEVEL_WARN, message)
}

func (l *Logger) error(message string, err error) {
	slog.Error(message, "error", err)
	l.log(LogLevel_LEVEL_ERROR, message)
}

func (l *Logger) log(level LogLevel, message string) {
	l.logs = append(l.logs, &Log{
		Message: message,
		Level:   level,
	})
}
