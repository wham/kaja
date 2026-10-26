import AppIntents
import Foundation

// Every intent is one of Kaja's MCP tools, called through kajaCallTool in the Go
// archive, so what Siri and Shortcuts get is what an agent gets.

@available(iOS 16.0, *)
struct KajaFailure: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { "\(message)" }
}

@available(iOS 16.0, *)
enum Kaja {
    static func call(_ tool: String, _ arguments: [String: Any?] = [:]) async throws -> String {
        let data = try JSONSerialization.data(withJSONObject: arguments.compactMapValues { $0 })
        let json = String(decoding: data, as: UTF8.self)
        // kajaCallTool blocks until the window is up and the tool has answered, which is
        // not something to do on a thread Swift concurrency shares.
        let answer: String = await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let raw = tool.withCString { tool in
                    json.withCString { json in
                        kajaCallTool(UnsafeMutablePointer(mutating: tool), UnsafeMutablePointer(mutating: json))
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
            throw KajaFailure(message: "Kaja gave no answer.")
        }
        if result.isError {
            throw KajaFailure(message: result.text)
        }
        return result.text
    }

    // What Siri says aloud; the whole answer is the intent's value, for a Shortcut to use.
    static func headline(_ text: String) -> IntentDialog {
        IntentDialog(stringLiteral: String(text.split(separator: "\n").first ?? "Done"))
    }
}

@available(iOS 16.0, *)
struct ScriptEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Script"
    static var defaultQuery = ScriptQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

@available(iOS 16.0, *)
struct ScriptQuery: EntityStringQuery {
    private struct Listed: Decodable {
        let path: String
        let name: String
    }

    private func all() async throws -> [ScriptEntity] {
        let text = try await Kaja.call("list_scripts")
        let listed = try JSONDecoder().decode([Listed].self, from: Data(text.utf8))
        return listed.map { ScriptEntity(id: $0.path, name: $0.name) }
    }

    func entities(for identifiers: [String]) async throws -> [ScriptEntity] {
        try await all().filter { identifiers.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [ScriptEntity] {
        try await all().filter { $0.name.localizedCaseInsensitiveContains(string) }
    }

    func suggestedEntities() async throws -> [ScriptEntity] {
        try await all()
    }
}

@available(iOS 16.0, *)
enum ApiKind: String, AppEnum {
    case openapi, grpc, mcp

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "API type"
    static var caseDisplayRepresentations: [ApiKind: DisplayRepresentation] = [
        .openapi: "OpenAPI",
        .grpc: "gRPC",
        .mcp: "MCP",
    ]
}

@available(iOS 16.0, *)
struct ListApis: AppIntent {
    static var title: LocalizedStringResource = "List APIs"
    static var description = IntentDescription("Every API in the Kaja workspace, with its services and methods.")
    static var openAppWhenRun = true

    @Parameter(title: "Search", description: "Only the methods whose name, service or app contains this.")
    var search: String?

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let text = try await Kaja.call("list_services", ["search": search])
        return .result(value: text, dialog: Kaja.headline(text))
    }
}

@available(iOS 16.0, *)
struct DescribeMethod: AppIntent {
    static var title: LocalizedStringResource = "Describe Method"
    static var description = IntentDescription("How to call one method: its signature, the types it names, and a call to start from.")
    static var openAppWhenRun = true

    @Parameter(title: "Method", description: "The method's name, e.g. ListForRepo or Issues.ListForRepo.")
    var method: String

    static var parameterSummary: some ParameterSummary {
        Summary("Describe \(\.$method)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await Kaja.call("describe_method", ["method": method]))
    }
}

@available(iOS 16.0, *)
struct ListScripts: AppIntent {
    static var title: LocalizedStringResource = "List Scripts"
    static var description = IntentDescription("The scripts saved in the Kaja workspace.")

    func perform() async throws -> some IntentResult & ReturnsValue<[ScriptEntity]> {
        .result(value: try await ScriptQuery().suggestedEntities())
    }
}

@available(iOS 16.0, *)
struct ReadScript: AppIntent {
    static var title: LocalizedStringResource = "Read Script"
    static var description = IntentDescription("A saved script's code.")

    @Parameter(title: "Script")
    var script: ScriptEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Read \(\.$script)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await Kaja.call("read_script", ["path": script.id]))
    }
}

@available(iOS 16.0, *)
struct RunScript: AppIntent {
    static var title: LocalizedStringResource = "Run Script"
    static var description = IntentDescription("Run a saved script, and get back what it printed, drew and called.")
    static var openAppWhenRun = true

    @Parameter(title: "Script")
    var script: ScriptEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Run \(\.$script)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let text = try await Kaja.call("run_script", ["path": script.id])
        return .result(value: text, dialog: Kaja.headline(text))
    }
}

@available(iOS 16.0, *)
struct RunCode: AppIntent {
    static var title: LocalizedStringResource = "Run Code"
    static var description = IntentDescription("Run TypeScript against the workspace's APIs, and get back what it printed, drew and called.")
    static var openAppWhenRun = true

    @Parameter(title: "Code", inputOptions: String.IntentInputOptions(multiline: true))
    var code: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let text = try await Kaja.call("run_script", ["code": code])
        return .result(value: text, dialog: Kaja.headline(text))
    }
}

@available(iOS 16.0, *)
struct AddApi: AppIntent {
    static var title: LocalizedStringResource = "Add API"
    static var description = IntentDescription("Add an API to the workspace. Where it needs a credential, Kaja opens the form for it.")
    static var openAppWhenRun = true

    @Parameter(title: "Type", default: .openapi)
    var kind: ApiKind

    @Parameter(title: "Address", description: "The OpenAPI document's URL, the gRPC server's address, or the MCP endpoint.")
    var address: String

    @Parameter(title: "Name", description: "What a script imports it as. Read off the address when left out.")
    var name: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$kind) API at \(\.$address)") {
            \.$name
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        var parameters: [String: String]
        switch kind {
        case .openapi: parameters = ["spec_url": address]
        case .grpc: parameters = ["url": address, "reflection": "true"]
        case .mcp: parameters = ["url": address]
        }
        let text = try await Kaja.call("add_app", [
            "name": name ?? Self.name(from: address),
            "type": kind.rawValue,
            "parameters": parameters,
        ])
        return .result(value: text, dialog: Kaja.headline(text))
    }

    static func name(from address: String) -> String {
        let host = URL(string: address)?.host ?? URL(string: "https://" + address)?.host ?? ""
        let label = host.split(separator: ".").first { !["www", "api"].contains($0) } ?? "api"
        return label.prefix(1).uppercased() + label.dropFirst()
    }
}

@available(iOS 16.0, *)
struct KajaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RunScript(),
            phrases: ["Run a script in \(.applicationName)", "Run \(.applicationName)"],
            shortTitle: "Run Script",
            systemImageName: "play"
        )
        AppShortcut(
            intent: ListApis(),
            phrases: ["What APIs are in \(.applicationName)", "List APIs in \(.applicationName)"],
            shortTitle: "List APIs",
            systemImageName: "list.bullet"
        )
        AppShortcut(
            intent: AddApi(),
            phrases: ["Add an API to \(.applicationName)", "Explore an API in \(.applicationName)"],
            shortTitle: "Add API",
            systemImageName: "plus"
        )
    }
}
