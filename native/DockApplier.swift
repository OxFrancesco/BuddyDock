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
            return "Usage: DockApplier.swift <apply|apply-missing|reset> < requests.json"
        case .invalidInput:
            return "Expected a JSON array of { appPath, iconPath } objects on stdin"
        }
    }
}

// True when the bundle carries a complete Finder custom icon: the FinderInfo
// kHasCustomIcon bit is set and the Icon\r resource fork holds data.
func hasCompleteCustomIcon(_ appPath: String) -> Bool {
    let iconFile = "\(appPath)/Icon\r"
    let forkSize = (try? FileManager.default.attributesOfItem(atPath: "\(iconFile)/..namedfork/rsrc")[.size] as? Int) ?? 0
    guard forkSize > 0 else { return false }
    var buffer = [UInt8](repeating: 0, count: 32)
    let read = getxattr(appPath, "com.apple.FinderInfo", &buffer, 32, 0, 0)
    return read >= 10 && (buffer[8] & 0x04) != 0
}

func setIcon(_ request: ApplyRequest, reset: Bool, onlyMissing: Bool) -> ApplyResult {
    guard FileManager.default.fileExists(atPath: request.appPath) else {
        return ApplyResult(appPath: request.appPath, applied: false, error: "App not found")
    }
    if onlyMissing && !reset && hasCompleteCustomIcon(request.appPath) {
        return ApplyResult(appPath: request.appPath, applied: true, error: "already applied")
    }
    // A denied write still strips the existing icon, so never attempt one we know will fail.
    guard FileManager.default.isWritableFile(atPath: request.appPath) else {
        let owner = (try? FileManager.default.attributesOfItem(atPath: request.appPath)[.ownerAccountName] as? String) ?? "?"
        return ApplyResult(appPath: request.appPath, applied: false, error: owner == NSUserName()
            ? "write denied by macOS App Management; grant it to this process (System Settings > Privacy & Security > App Management)"
            : "owned by \(owner); re-run with sudo or fix ownership")
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
    return ApplyResult(appPath: request.appPath, applied: ok, error: ok ? nil : "NSWorkspace.setIcon returned false")
}

do {
    guard CommandLine.arguments.count == 2, ["apply", "apply-missing", "reset"].contains(CommandLine.arguments[1]) else {
        throw ApplierError.usage
    }
    let reset = CommandLine.arguments[1] == "reset"
    let onlyMissing = CommandLine.arguments[1] == "apply-missing"

    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let requests = try? JSONDecoder().decode([ApplyRequest].self, from: input) else {
        throw ApplierError.invalidInput
    }

    let results = requests.map { setIcon($0, reset: reset, onlyMissing: onlyMissing) }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    FileHandle.standardOutput.write(try encoder.encode(results))
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("buddydock: \(error)\n".utf8))
    exit(1)
}
