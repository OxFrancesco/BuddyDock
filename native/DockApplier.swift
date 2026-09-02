#!/usr/bin/env swift

import AppKit
import Foundation

struct ApplyRequest: Codable {
    let appPath: String
    let iconPath: String?
}

struct ApplyResult: Codable {
    let appPath: String
    let applied: Bool
    let error: String?
}

enum ApplierError: Error, CustomStringConvertible {
    case usage
    case invalidInput

    var description: String {
        switch self {
        case .usage:
            return "Usage: DockApplier.swift <apply|reset> < requests.json"
        case .invalidInput:
            return "Expected a JSON array of { appPath, iconPath } objects on stdin"
        }
    }
}

func setIcon(_ request: ApplyRequest, reset: Bool) -> ApplyResult {
    guard FileManager.default.fileExists(atPath: request.appPath) else {
        return ApplyResult(appPath: request.appPath, applied: false, error: "App not found")
    }

    var image: NSImage? = nil
    if !reset {
        guard let iconPath = request.iconPath, let loaded = NSImage(contentsOfFile: iconPath) else {
            return ApplyResult(appPath: request.appPath, applied: false, error: "Could not load icon \(request.iconPath ?? "<none>")")
        }
        image = loaded
    }

    var ok = NSWorkspace.shared.setIcon(image, forFile: request.appPath, options: [])
    if !ok {
        // Finder occasionally rejects the first write right after a bundle was replaced.
        Thread.sleep(forTimeInterval: 0.5)
        ok = NSWorkspace.shared.setIcon(image, forFile: request.appPath, options: [])
    }
    if ok { return ApplyResult(appPath: request.appPath, applied: true, error: nil) }

    let attributes = try? FileManager.default.attributesOfItem(atPath: request.appPath)
    let owner = attributes?[.ownerAccountName] as? String ?? "?"
    let writable = FileManager.default.isWritableFile(atPath: request.appPath)
    let hint = writable
        ? "NSWorkspace.setIcon returned false"
        : owner == NSUserName()
            ? "write denied by macOS App Management; grant it to this process (System Settings > Privacy & Security > App Management)"
            : "owned by \(owner); re-run with sudo or fix ownership"
    return ApplyResult(appPath: request.appPath, applied: false, error: hint)
}

do {
    guard CommandLine.arguments.count == 2, ["apply", "reset"].contains(CommandLine.arguments[1]) else {
        throw ApplierError.usage
    }
    let reset = CommandLine.arguments[1] == "reset"

    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let requests = try? JSONDecoder().decode([ApplyRequest].self, from: input) else {
        throw ApplierError.invalidInput
    }

    let results = requests.map { setIcon($0, reset: reset) }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(results))
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("buddydock: \(error)\n".utf8))
    exit(1)
}
