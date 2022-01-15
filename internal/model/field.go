package model

import "time"

func FormatTime(Time time.Time) string {
	return Time.Format("2006-01-02") + "T00:00:00Z"
}