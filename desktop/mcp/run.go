package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// What each failure kind means for the caller's next move. This is the whole
// point of classifying: without it "invalid argument" and "the response codec
// broke" read the same, and the only way to tell them apart is to try again with
// a different request - which is wasted on a failure the request had nothing to
// do with.
var failureAdvice = map[string]string{
	"INVALID_REQUEST": "The service rejected the request. Check the field names and values against describe_method.",
	"UNAUTHORIZED":    "The credentials were missing or refused. This is the app's configuration, not the request.",
	"NOT_FOUND":       "The target does not exist. The request shape is fine; the identifier or the route is not.",
	"RATE_LIMITED":    "Too many calls. Wait and retry the same request.",
	"SERVER":          "The service reached an error of its own. Retrying the same request may or may not help; changing its shape will not.",
	"TRANSPORT":       "The call never completed a valid exchange - a connection or codec failure, not a rejected request. Sending different parameters will not help.",
	"UNKNOWN":         "The failure carried nothing to classify it by.",
}

// maxPayload caps one request or response body in the run report. A script that
// wants all of a large response should console.log the part it cares about.
const maxPayload = 4000

// maxConsoleLines caps the console output echoed back.
const maxConsoleLines = 200

// renderRun reports a run the way a caller reads it: what it printed, what each
// call did, and - when it stopped early - that it stopped and why.
func renderRun(label string, result RunResult) string {
	var b strings.Builder

	failed := 0
	for _, call := range result.MethodCalls {
		if call.Failure != nil {
			failed++
		}
	}
	fmt.Fprintf(&b, "Ran %s — %d call(s)", label, len(result.MethodCalls))
	if failed > 0 {
		fmt.Fprintf(&b, ", %d failed", failed)
	}
	b.WriteString("\n")

	if len(result.Console) > 0 {
		b.WriteString("\nconsole\n")
		lines := result.Console
		dropped := 0
		if len(lines) > maxConsoleLines {
			dropped = len(lines) - maxConsoleLines
			lines = lines[:maxConsoleLines]
		}
		for _, line := range lines {
			b.WriteString("  " + line + "\n")
		}
		if dropped > 0 {
			fmt.Fprintf(&b, "  … %d more line(s) not shown\n", dropped)
		}
	}

	if len(result.MethodCalls) > 0 {
		b.WriteString("\ncalls\n")
		for i, call := range result.MethodCalls {
			b.WriteString(renderCall(i+1, call))
		}
	}

	if len(result.Result) > 0 && string(result.Result) != "null" {
		b.WriteString("\nreturned\n")
		b.WriteString(indent(truncate(string(result.Result)), "  "))
	}

	if result.Error != "" {
		b.WriteString("\nthe script stopped here\n")
		b.WriteString(indent(result.Error, "  "))
		b.WriteString("  Statements after this point did not run. Wrap a call in try/catch to let a script survive one failing call.\n")
	}
	return b.String()
}

func renderCall(index int, call MethodCallLog) string {
	var b strings.Builder
	status := "ok"
	if call.Failure != nil {
		status = call.Failure.Kind
	}
	where := call.Service + "." + call.Method
	if call.App != "" {
		where = call.App + " " + where
	}
	fmt.Fprintf(&b, "  %d. %s  %s", index, where, status)
	if call.DurationMs > 0 {
		fmt.Fprintf(&b, "  %.0f ms", call.DurationMs)
	}
	b.WriteString("\n")

	if call.Failure != nil {
		if label := failureLabel(*call.Failure); label != "" {
			fmt.Fprintf(&b, "     %s\n", label)
		}
		fmt.Fprintf(&b, "     %s\n", call.Failure.Message)
		if advice := failureAdvice[call.Failure.Kind]; advice != "" {
			fmt.Fprintf(&b, "     %s\n", advice)
		}
	}
	if len(call.Input) > 0 {
		fmt.Fprintf(&b, "     request  %s\n", truncate(string(call.Input)))
	}
	if len(call.Output) > 0 {
		fmt.Fprintf(&b, "     response %s\n", truncate(string(call.Output)))
	}
	return b.String()
}

func failureLabel(failure CallFailure) string {
	switch {
	case failure.Status > 0:
		return fmt.Sprintf("HTTP %d", failure.Status)
	case failure.Code != "":
		return failure.Code
	}
	return ""
}

func truncate(text string) string {
	if len(text) <= maxPayload {
		return text
	}
	// Cut on a rune boundary: a payload sliced mid-character comes back as
	// mojibake, which reads as a data problem rather than a truncation.
	cut := maxPayload
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut] + fmt.Sprintf("… (truncated, %d bytes total)", len(text))
}

// compactJSON keeps a payload on one line, which is what makes a call in the run
// report one line rather than a page.
func compactJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return raw
	}
	return json.RawMessage(buf.Bytes())
}
