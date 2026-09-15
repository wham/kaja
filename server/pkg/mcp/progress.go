package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// RunProgress is what a window says about a run that is still going. The count is the
// window's, because only the window knows what the script has done; the clock is not,
// because what a caller is waiting through is measured where it is waiting.
type RunProgress struct {
	Calls int `json:"calls"`
}

// notifier is how a handler says something before it has an answer. Only a streamed
// response has anywhere to put one, so a handler answering with a single body is handed
// nothing and says nothing rather than queueing what nobody will read.
type notifier func(method string, params map[string]interface{})

type notifierKey struct{}

func withNotifier(ctx context.Context, notify notifier) context.Context {
	return context.WithValue(ctx, notifierKey{}, notify)
}

func notifierFrom(ctx context.Context) notifier {
	notify, _ := ctx.Value(notifierKey{}).(notifier)
	return notify
}

// progressToken is the handle a caller passes when it wants to hear about its request
// while it is still being served. It is echoed verbatim and carried as raw JSON,
// because it is the caller's own name for the request and may be a string or a number.
func progressToken(params json.RawMessage) json.RawMessage {
	token := metaFields(params)["progressToken"]
	if len(token) == 0 || string(token) == "null" {
		return nil
	}
	return token
}

// runProgress is what a run says about itself while it is going, or nothing at all
// where the caller asked for no progress or the answer is a single body. Nothing is
// what the window is told too, so a run nobody is listening to reports into no beat.
func runProgress(ctx context.Context, token json.RawMessage) func(RunProgress) {
	notify := notifierFrom(ctx)
	if notify == nil || token == nil {
		return nil
	}
	started := time.Now()
	return func(progress RunProgress) {
		elapsed := time.Since(started)
		notify("notifications/progress", map[string]interface{}{
			"progressToken": token,
			// Seconds waited rather than calls made: each notification has to carry a
			// larger number than the last, and a run can go a long way without calling
			// anything. Unrounded for the same reason - two beats a moment apart have
			// to differ. What the calls are is the message's to say.
			"progress": elapsed.Seconds(),
			"message":  progressMessage(progress.Calls, elapsed),
		})
	}
}

func progressMessage(calls int, elapsed time.Duration) string {
	unit := "calls"
	if calls == 1 {
		unit = "call"
	}
	return fmt.Sprintf("%d %s · %.1f s", calls, unit, elapsed.Seconds())
}
