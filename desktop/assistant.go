package main

// AssistantStatus says whether the phone's own model can be asked anything, and
// if not, why: the person can fix two of the three reasons in Settings.
type AssistantStatus struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason"`
}

// AssistantStep is one tool the model called on the way to its answer, sent as
// the "assistant:step" event while AskAssistant is still waiting.
type AssistantStep struct {
	Tool   string `json:"tool"`
	Detail string `json:"detail"`
	// The TypeScript the model ran, so the window can show what it wrote.
	Code    string `json:"code"`
	IsError bool   `json:"isError"`
}

func (a *App) AssistantStatus() AssistantStatus {
	return assistantStatus()
}

// AskAssistant hands the prompt to the conversation the model is already in and
// waits for its answer, which may take several tool calls into the agent session.
func (a *App) AskAssistant(prompt string) (string, error) {
	return assistantAsk(prompt, func(step AssistantStep) {
		a.app.Event.Emit("assistant:step", step)
	})
}

func (a *App) StopAssistant() {
	assistantStop()
}

// ResetAssistant starts the next prompt on an empty transcript. The model's
// context is a few thousand tokens, so a new topic is worth a new conversation.
func (a *App) ResetAssistant() {
	assistantReset()
}
