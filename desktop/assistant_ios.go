//go:build ios

package main

/*
#include <stdlib.h>

// Implemented in build/ios/intents/Assistant.swift; every answer is the caller's to free.
extern char *kajaAssistantStatus(void);
extern char *kajaAssistantAsk(char *prompt);
extern void kajaAssistantStop(void);
extern void kajaAssistantReset(void);
*/
import "C"

import (
	"encoding/json"
	"errors"
	"sync"
	"unsafe"
)

// The client the assistant's runs are made as, which names its draft in the sidebar.
const assistantClient = "Apple Intelligence"

var (
	stepMu sync.Mutex
	onStep func(AssistantStep)
)

func assistantStatus() AssistantStatus {
	raw := C.kajaAssistantStatus()
	defer C.free(unsafe.Pointer(raw))
	var status AssistantStatus
	_ = json.Unmarshal([]byte(C.GoString(raw)), &status)
	return status
}

func assistantAsk(prompt string, step func(AssistantStep)) (string, error) {
	stepMu.Lock()
	onStep = step
	stepMu.Unlock()
	defer func() {
		stepMu.Lock()
		onStep = nil
		stepMu.Unlock()
	}()

	cPrompt := C.CString(prompt)
	defer C.free(unsafe.Pointer(cPrompt))
	raw := C.kajaAssistantAsk(cPrompt)
	defer C.free(unsafe.Pointer(raw))
	var answer struct {
		Text  string `json:"text"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(C.GoString(raw)), &answer); err != nil {
		return "", errors.New("The assistant gave no answer.")
	}
	if answer.Error != "" {
		return "", errors.New(answer.Error)
	}
	return answer.Text, nil
}

func assistantStop() { C.kajaAssistantStop() }

func assistantReset() { C.kajaAssistantReset() }

// kajaAssistantCallTool is how the model's tools reach the agent session, the same
// door an App Intent goes through, and reports each call to the window as it lands.
//
//export kajaAssistantCallTool
func kajaAssistantCallTool(tool, arguments, detail *C.char) *C.char {
	result := callTool(assistantClient, C.GoString(tool), C.GoString(arguments))
	stepMu.Lock()
	step := onStep
	stepMu.Unlock()
	if step != nil {
		var code struct {
			Code string `json:"code"`
		}
		_ = json.Unmarshal([]byte(C.GoString(arguments)), &code)
		step(AssistantStep{Tool: C.GoString(tool), Detail: C.GoString(detail), Code: code.Code, IsError: result.IsError})
	}
	encoded, _ := json.Marshal(result)
	return C.CString(string(encoded))
}
