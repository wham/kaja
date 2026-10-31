import AppIntents
import Foundation
import SwiftUI

// Every intent is one of Kaja's MCP tools, called through kajaCallTool in the Go
// archive, so what Siri and Shortcuts get is what an agent gets.

@available(iOS 16.0, *)
struct KajaFailure: Error, CustomLocalizedStringResourceConvertible {
    let message: String
    var localizedStringResource: LocalizedStringResource { "\(message)" }
}

@available(iOS 16.0, *)
enum Kaja {
    struct Result: Decodable {
        let text: String
        let isError: Bool
        let structured: RunReport?
    }

    static func call(_ tool: String, _ arguments: [String: Any?] = [:]) async throws -> String {
        let result = try await answer(tool, arguments)
        if result.isError {
            throw KajaFailure(message: result.text)
        }
        return result.text
    }

    static func answer(_ tool: String, _ arguments: [String: Any?] = [:]) async throws -> Result {
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
        guard let result = try? JSONDecoder().decode(Result.self, from: Data(answer.utf8)) else {
            throw KajaFailure(message: "Kaja gave no answer.")
        }
        return result
    }

    // A run that failed still has a report worth showing, so it comes back as a card
    // rather than as an error; only a run that never started is thrown.
    static func run(_ arguments: [String: Any?]) async throws -> (String, RunReport) {
        let result = try await answer("run_script", arguments)
        guard let report = result.structured else {
            throw KajaFailure(message: result.text)
        }
        return (result.text, report)
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
        let scripts = try await ScriptQuery().suggestedEntities()
        KajaShortcuts.updateAppShortcutParameters()
        return .result(value: scripts)
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

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let (text, report) = try await Kaja.run(["path": script.id])
        return .result(value: text, dialog: Kaja.headline(text), view: RunCard(name: script.name, report: report))
    }
}

@available(iOS 16.0, *)
struct RunCode: AppIntent {
    static var title: LocalizedStringResource = "Run Code"
    static var description = IntentDescription("Run TypeScript against the workspace's APIs, and get back what it printed, drew and called.")
    static var openAppWhenRun = true

    @Parameter(title: "Code", inputOptions: String.IntentInputOptions(multiline: true))
    var code: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let (text, report) = try await Kaja.run(["code": code])
        return .result(value: text, dialog: Kaja.headline(text), view: RunCard(name: report.script, report: report))
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
            phrases: ["Run \(\.$script) in \(.applicationName)", "Run a script in \(.applicationName)", "Run \(.applicationName)"],
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

// Siri and Spotlight offer one phrase per saved script, which they learn by asking the
// script query again. Called once the process is up, since that is when the folder can
// first be read.
@_cdecl("kajaRefreshShortcuts")
public func kajaRefreshShortcuts() {
    guard #available(iOS 16.0, *) else { return }
    KajaShortcuts.updateAppShortcutParameters()
}

@available(iOS 16.0, *)
struct RunReport: Decodable {
    struct Failure: Decodable {
        let message: String
        let status: Int?
        let code: String?
    }

    struct Call: Decodable {
        let label: String
        let durationMs: Double?
        let failure: Failure?
    }

    struct Block: Decodable {
        let kind: String
        let label: String?
        let rows: Int?
    }

    let script: String
    let calls: [Call]?
    let console: [String]?
    let blocks: [Block]?
    let stopped: String?
}

// What Siri and Shortcuts show under a run: the verdict, the calls it made and what it
// drew. The contents of what it drew are the window's, so a table is its size.
@available(iOS 16.0, *)
struct RunCard: View {
    let name: String
    let report: RunReport

    private static let shown = 4

    private var calls: [RunReport.Call] { report.calls ?? [] }
    private var failed: Int { calls.filter { $0.failure != nil }.count }
    private var succeeded: Bool { report.stopped == nil && failed == 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: succeeded ? "checkmark.circle.fill" : "xmark.octagon.fill")
                    .foregroundStyle(succeeded ? .green : .red)
                Text(name).font(.headline).lineLimit(1)
                Spacer()
                Text(summary).font(.caption).foregroundStyle(.secondary)
            }
            if let stopped = report.stopped {
                Text(stopped).font(.caption).foregroundStyle(.red).lineLimit(3)
            }
            if !calls.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(calls.prefix(Self.shown).enumerated()), id: \.offset) { _, call in
                        HStack {
                            Text(call.label).font(.caption.monospaced()).lineLimit(1)
                            Spacer()
                            Text(outcome(call)).font(.caption.monospaced())
                                .foregroundStyle(call.failure == nil ? Color.secondary : Color.red)
                        }
                    }
                    if calls.count > Self.shown {
                        Text("\(calls.count - Self.shown) more").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            ForEach(Array((report.blocks ?? []).filter { $0.kind == "table" }.prefix(2).enumerated()), id: \.offset) { _, block in
                Label(drawn(block), systemImage: "tablecells").font(.caption)
            }
            if let console = report.console, !console.isEmpty {
                Text(console.prefix(3).joined(separator: "\n"))
                    .font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(3)
            }
        }
        .padding()
    }

    private var summary: String {
        let count = calls.count == 1 ? "1 call" : "\(calls.count) calls"
        return failed == 0 ? count : "\(count), \(failed) failed"
    }

    private func outcome(_ call: RunReport.Call) -> String {
        if let failure = call.failure {
            if let status = failure.status { return "\(status)" }
            return failure.code ?? "failed"
        }
        guard let ms = call.durationMs else { return "" }
        return ms < 1000 ? "\(Int(ms.rounded())) ms" : String(format: "%.1f s", ms / 1000)
    }

    private func drawn(_ block: RunReport.Block) -> String {
        let rows = block.rows ?? 0
        let size = rows == 1 ? "1 row" : "\(rows) rows"
        if let label = block.label, !label.isEmpty { return "\(label): \(size)" }
        return "A table of \(size)"
    }
}
