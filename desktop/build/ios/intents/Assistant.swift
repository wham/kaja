import Foundation
import FoundationModels

// The phone's own model, driving the same MCP tools an agent on the Mac drives. Each
// tool is a call into kajaAssistantCallTool, which goes through the agent session, so
// a run lands in a draft of its own and the window draws it as it would any agent's.

private struct Answer: Encodable {
    var text = ""
    var error = ""
}

private func encoded<T: Encodable>(_ value: T) -> UnsafeMutablePointer<CChar> {
    let data = (try? JSONEncoder().encode(value)) ?? Data("{}".utf8)
    return strdup(String(decoding: data, as: UTF8.self))
}

private final class Running: @unchecked Sendable {
    private let lock = NSLock()
    private var task: Task<Void, Never>?

    func set(_ task: Task<Void, Never>?) {
        lock.lock()
        self.task = task
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        task?.cancel()
        lock.unlock()
    }
}

private let running = Running()

@_cdecl("kajaAssistantStatus")
public func kajaAssistantStatus() -> UnsafeMutablePointer<CChar> {
    struct Status: Encodable {
        let available: Bool
        let reason: String
    }
    guard #available(iOS 26.0, *) else {
        return encoded(Status(available: false, reason: "The assistant needs iOS 26 or later."))
    }
    switch SystemLanguageModel.default.availability {
    case .available:
        return encoded(Status(available: true, reason: ""))
    case .unavailable(.deviceNotEligible):
        return encoded(Status(available: false, reason: "This device can't run Apple Intelligence."))
    case .unavailable(.appleIntelligenceNotEnabled):
        return encoded(Status(available: false, reason: "Turn on Apple Intelligence in Settings to use the assistant."))
    case .unavailable(.modelNotReady):
        return encoded(Status(available: false, reason: "Apple Intelligence is still downloading its model. Try again in a while."))
    case .unavailable:
        return encoded(Status(available: false, reason: "Apple Intelligence is unavailable."))
    }
}

// Blocks until the model has answered. The caller is a Go goroutine on a thread of
// its own, never one Swift concurrency shares.
@_cdecl("kajaAssistantAsk")
public func kajaAssistantAsk(_ prompt: UnsafeMutablePointer<CChar>) -> UnsafeMutablePointer<CChar> {
    let text = String(cString: prompt)
    guard #available(iOS 26.0, *) else {
        return encoded(Answer(error: "The assistant needs iOS 26 or later."))
    }
    final class Box: @unchecked Sendable { var answer = Answer() }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    running.set(Task.detached {
        box.answer = await Assistant.shared.ask(text)
        done.signal()
    })
    done.wait()
    running.set(nil)
    return encoded(box.answer)
}

@_cdecl("kajaAssistantStop")
public func kajaAssistantStop() {
    running.cancel()
}

@_cdecl("kajaAssistantReset")
public func kajaAssistantReset() {
    guard #available(iOS 26.0, *) else { return }
    Task { await Assistant.shared.reset() }
}

@available(iOS 26.0, *)
private actor Assistant {
    static let shared = Assistant()

    private var session: LanguageModelSession?

    func reset() {
        session = nil
        imports.forget()
    }

    func ask(_ prompt: String) async -> Answer {
        do {
            return Answer(text: try await respond(prompt, in: session ?? fresh()))
        } catch LanguageModelSession.GenerationError.exceededContextWindowSize {
            // The on-device context is a few thousand tokens, so a long conversation
            // runs out of room; the prompt is asked again with nothing before it.
            do {
                let text = try await respond(prompt, in: fresh())
                return Answer(text: text + "\n\n(The conversation ran out of room, so this answer starts from scratch.)")
            } catch {
                return Answer(error: describe(error))
            }
        } catch {
            return Answer(error: describe(error))
        }
    }

    private func respond(_ prompt: String, in session: LanguageModelSession) async throws -> String {
        self.session = session
        return try await session.respond(to: prompt).content
    }

    private func fresh() -> LanguageModelSession {
        LanguageModelSession(tools: tools, instructions: instructions)
    }

    private func describe(_ error: Error) -> String {
        if error is CancellationError {
            return "Stopped."
        }
        if let error = error as? LocalizedError, let description = error.errorDescription {
            return description
        }
        return "Apple Intelligence couldn't answer that. Try asking it another way."
    }

    // The model is small enough that every tool it is offered is one more it reaches for
    // at the wrong moment: offered the script tools, it saved describeMethod's answer as
    // a script and ran paths it made up.
    private let tools: [any Tool] = [ListApisTool(), DescribeMethodTool(), RunCodeTool()]

    private let instructions = """
    You are Kaja's assistant on an iPhone. Kaja calls the APIs in the person's workspace \
    by running TypeScript. To answer a question about an API's data: call describeMethod \
    for the method, then runCode with one call to it, then answer from the response the \
    run reports. Never guess a method or its fields.

    The code is one call, with every field the request needs, e.g.
    const repo = await Repos.Get({ owner: "apple", repo: "swift" });

    Answer in one or two plain sentences.
    """
}

// Each answer is capped, because the whole conversation has to fit the on-device
// context and one method's declarations can be longer than all of it.
private let answerLimit = 1800

// The model leaves the import out of the code it writes however it is asked to, so
// the tools remember what describeMethod said each service is imported from and add
// what is missing.
private final class Imports: @unchecked Sendable {
    private let lock = NSLock()
    private var lines = ["kaja": "import { kaja } from \"kaja\";"]

    func learn(from answer: String) {
        lock.lock()
        defer { lock.unlock() }
        for line in answer.split(separator: "\n") {
            let line = line.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("import { "), let end = line.range(of: " }") else { continue }
            let name = line[line.index(line.startIndex, offsetBy: 9)..<end.lowerBound]
            lines[String(name)] = line
        }
    }

    func complete(_ code: String) -> String {
        lock.lock()
        defer { lock.unlock() }
        let missing = lines.keys.sorted().filter { name in
            code.range(of: "\\b\(name)\\.", options: .regularExpression) != nil
                && code.range(of: "import\\s*\\{[^}]*\\b\(name)\\b", options: .regularExpression) == nil
        }
        if missing.isEmpty { return code }
        return missing.compactMap { lines[$0] }.joined(separator: "\n") + "\n\n" + code
    }

    func forget() {
        lock.lock()
        lines = lines.filter { $0.key == "kaja" }
        lock.unlock()
    }
}

private let imports = Imports()

@available(iOS 26.0, *)
private func callKaja(_ tool: String, _ arguments: [String: String?], detail: String) async -> String {
    let data = (try? JSONSerialization.data(withJSONObject: arguments.compactMapValues { $0 })) ?? Data("{}".utf8)
    let json = String(decoding: data, as: UTF8.self)
    let answer: String = await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
            let raw = tool.withCString { tool in
                json.withCString { json in
                    detail.withCString { detail in
                        kajaAssistantCallTool(UnsafeMutablePointer(mutating: tool), UnsafeMutablePointer(mutating: json), UnsafeMutablePointer(mutating: detail))
                    }
                }
            }
            guard let raw else {
                continuation.resume(returning: "")
                return
            }
            continuation.resume(returning: String(cString: raw))
            free(raw)
        }
    }
    struct Result: Decodable {
        let text: String
        let isError: Bool
    }
    guard let result = try? JSONDecoder().decode(Result.self, from: Data(answer.utf8)) else {
        return "Kaja gave no answer."
    }
    let text = result.isError ? "Error: " + result.text : result.text
    if text.count <= answerLimit {
        return text
    }
    return String(text.prefix(answerLimit)) + "\n[cut short; narrow the request to see more]"
}

@available(iOS 26.0, *)
private struct ListApisTool: Tool {
    let name = "listApis"
    let description = "Lists the workspace's apps, services and methods, each with its signature."

    @Generable
    struct Arguments {
        @Guide(description: "Only methods whose name, service or app contains this, e.g. a resource name. Empty for everything.")
        var search: String?
    }

    func call(arguments: Arguments) async throws -> String {
        let search = arguments.search?.trimmingCharacters(in: .whitespaces) ?? ""
        return await callKaja("list_services", ["search": search.isEmpty ? nil : search], detail: search)
    }
}

@available(iOS 26.0, *)
private struct DescribeMethodTool: Tool {
    let name = "describeMethod"
    let description = "How to call one method: the import, its request and response types, and a call to start from."

    @Generable
    struct Arguments {
        @Guide(description: "Service.Method, e.g. Repos.Get")
        var method: String
    }

    func call(arguments: Arguments) async throws -> String {
        let answer = await callKaja("describe_method", ["method": arguments.method], detail: arguments.method)
        imports.learn(from: answer)
        return answer
    }
}

@available(iOS 26.0, *)
private struct RunCodeTool: Tool {
    let name = "runCode"
    let description = "Runs TypeScript against the workspace's APIs and reports every call's response."

    @Generable
    struct Arguments {
        @Guide(description: "The TypeScript to run")
        var code: String
    }

    func call(arguments: Arguments) async throws -> String {
        await callKaja("run_script", ["code": imports.complete(arguments.code)], detail: "")
    }
}
