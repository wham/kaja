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
	"UNSUPPORTED":     "Kaja does not support this kind of method yet and refused the call before it went anywhere. No request will work; the method is listed so the app's surface is complete.",
	"UNKNOWN":         "The failure carried nothing to classify it by.",
}

// maxPayload caps one request or response body in the run report. A script that
// wants all of a large response should console.log the part it cares about.
const maxPayload = 4000

// maxConsoleLines caps the console output echoed back.
const maxConsoleLines = 200

// maxDiagnostics caps the type errors listed. One mistyped import can put an error
// on every line that uses it, and the first few say the same thing the rest do.
const maxDiagnostics = 20

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

	// Ahead of what the run did, because it is about the script rather than the run:
	// what a person opening this file is shown before they press anything.
	if len(result.Diagnostics) > 0 {
		b.WriteString("\ntype errors\n")
		shown := result.Diagnostics
		dropped := 0
		if len(shown) > maxDiagnostics {
			dropped = len(shown) - maxDiagnostics
			shown = shown[:maxDiagnostics]
		}
		for _, diagnostic := range shown {
			fmt.Fprintf(&b, "  %d:%d  %s\n", diagnostic.Line, diagnostic.Column, diagnostic.Message)
		}
		if dropped > 0 {
			fmt.Fprintf(&b, "  … %d more\n", dropped)
		}
		b.WriteString("  These did not stop the run: a script is transpiled rather than compiled, so a type error runs.\n")
		b.WriteString("  They are the editor's own errors against the declarations describe_method prints, so a script kept with them in it is red in the window it is opened in.\n")
	}

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

	if len(result.Blocks) > 0 {
		b.WriteString("\ncanvas\n")
		for i, block := range result.Blocks {
			b.WriteString(renderBlock(i+1, block))
		}
	}

	// A script has no return value: the app refuses to run one with a top-level
	// return (it is a TypeScript error), so a value that arrives here means the
	// script works over MCP and is a dead file the moment a person opens it.
	// Saying so is the whole reason the value is carried this far.
	if len(result.Result) > 0 && string(result.Result) != "null" {
		b.WriteString("\nthis script returned a value, which does nothing\n")
		b.WriteString(indent(truncate(string(result.Result)), "  "))
		b.WriteString("  A script is a body of statements, not a function - Kaja will not run one with a top-level `return`.\n")
		b.WriteString("  Draw what you produced instead: kaja.table(columns).row(...) for a table, kaja.text/kaja.code for prose\n")
		b.WriteString("  and snippets. describe_type \"kaja\" has the rest.\n")
	}

	if result.Error != "" {
		b.WriteString("\nthe script stopped here\n")
		b.WriteString(indent(result.Error, "  "))
		// A rejected call does not throw - it is reported above and the script
		// carries on with undefined in place of the response. So reaching here
		// means the script itself failed, which is usually that undefined being
		// read a line later.
		b.WriteString("  Statements after this point did not run. This is the script failing, not a call being rejected: a rejected call is reported above and does not stop the script.\n")
	}
	return b.String()
}

func renderCall(index int, call MethodCallLog) string {
	var b strings.Builder
	status := "ok"
	if call.Failure != nil {
		status = call.Failure.Kind
	}
	fmt.Fprintf(&b, "  %d. %s  %s", index, callLabel(call), status)
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

// callLabel is what a call is named by, in the text report and the structured one
// alike. A fetch is named by the request it made: there is no service and no method,
// and the URL is the whole of what the agent asked for.
func callLabel(call MethodCallLog) string {
	if call.Http != "" {
		return call.Http
	}
	where := call.Service + "." + call.Method
	if call.App != "" {
		where = call.App + " " + where
	}
	return where
}

func renderBlock(index int, block BlockLog) string {
	var b strings.Builder
	fmt.Fprintf(&b, "  %d. %s", index, block.Kind)
	if block.Kind == "table" {
		fmt.Fprintf(&b, "  %d column(s) × %d row(s)", len(block.Columns), block.Rows)
		if len(block.Columns) > 0 {
			fmt.Fprintf(&b, "  [%s]", strings.Join(block.Columns, ", "))
		}
		// A cell that is a function is fetched when its row is drawn, and nobody
		// is drawing this one past the first page.
		if block.Pending > 0 {
			fmt.Fprintf(&b, "  %d cell(s) not loaded", block.Pending)
		}
		if block.Failed > 0 {
			fmt.Fprintf(&b, "  %d cell(s) failed", block.Failed)
		}
	} else if block.Label != "" {
		fmt.Fprintf(&b, "  %s", block.Label)
	}
	b.WriteString("\n")
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

// RunReport is run_script's structured answer: the same run renderRun writes out, in
// the shape a caller parses rather than reads. Both are sent, because the text is
// what a client with no structured content is left with and what a person reads in a
// transcript - so the two are built from the same values and cut by the same caps,
// and neither can say something the other doesn't.
type RunReport struct {
	Script      string          `json:"script"`
	Calls       []ReportedCall  `json:"calls,omitempty"`
	Console     []string        `json:"console,omitempty"`
	Blocks      []BlockLog      `json:"blocks,omitempty"`
	Diagnostics []Diagnostic    `json:"diagnostics,omitempty"`
	Stopped     string          `json:"stopped,omitempty"`
	Returned    json.RawMessage `json:"returned,omitempty"`
}

// ReportedCall is one call the script made. The failure carries the advice the text
// report prints under it, since that is the half of a classification a caller acts on.
type ReportedCall struct {
	Label      string           `json:"label"`
	DurationMs float64          `json:"durationMs,omitempty"`
	Request    json.RawMessage  `json:"request,omitempty"`
	Response   json.RawMessage  `json:"response,omitempty"`
	Failure    *ReportedFailure `json:"failure,omitempty"`
}

type ReportedFailure struct {
	CallFailure
	Advice string `json:"advice,omitempty"`
}

// reportRun shapes a run into the structured report. Everything it drops, it drops
// where renderRun drops it too.
func reportRun(label string, result RunResult) RunReport {
	report := RunReport{Script: label, Stopped: result.Error, Blocks: result.Blocks}

	if len(result.Result) > 0 && string(result.Result) != "null" {
		report.Returned = payload(result.Result)
	}
	report.Console = result.Console
	if len(report.Console) > maxConsoleLines {
		report.Console = report.Console[:maxConsoleLines]
	}
	report.Diagnostics = result.Diagnostics
	if len(report.Diagnostics) > maxDiagnostics {
		report.Diagnostics = report.Diagnostics[:maxDiagnostics]
	}
	for _, call := range result.MethodCalls {
		reported := ReportedCall{
			Label:      callLabel(call),
			DurationMs: call.DurationMs,
			Request:    payload(call.Input),
			Response:   payload(call.Output),
		}
		if call.Failure != nil {
			reported.Failure = &ReportedFailure{CallFailure: *call.Failure, Advice: failureAdvice[call.Failure.Kind]}
		}
		report.Calls = append(report.Calls, reported)
	}
	return report
}

// payload is a request or response as the structured report carries it. A payload
// past the cap is replaced rather than cut: JSON sliced in half is not JSON, and a
// caller that cannot parse the report has lost the calls that were under it too.
func payload(raw json.RawMessage) json.RawMessage {
	if len(raw) <= maxPayload {
		return raw
	}
	note := fmt.Sprintf("… %d bytes, too large to report. console.log the part you need.", len(raw))
	quoted, err := json.Marshal(note)
	if err != nil {
		return nil
	}
	return quoted
}
