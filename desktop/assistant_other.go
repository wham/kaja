//go:build !ios

package main

import "errors"

func assistantStatus() AssistantStatus {
	return AssistantStatus{Reason: "unsupported"}
}

func assistantAsk(string, func(AssistantStep)) (string, error) {
	return "", errors.New("The assistant runs on the phone's own model, which only the iOS app has.")
}

func assistantStop() {}

func assistantReset() {}
