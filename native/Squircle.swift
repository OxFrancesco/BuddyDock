#!/usr/bin/env swift

import AppKit
import Foundation

// Masks a square PNG into a macOS app-icon squircle on a 1024x1024 transparent canvas.
// Apple's icon grid: the tile occupies 824/1024 of the canvas with a ~185px corner radius.

enum SquircleError: Error, CustomStringConvertible {
    case usage
    case unreadable(String)
    case encodingFailed

    var description: String {
        switch self {
        case .usage: return "Usage: Squircle.swift <input.png> <output.png>"
        case .unreadable(let path): return "Could not read image at \(path)"
        case .encodingFailed: return "Could not encode the squircle PNG"
        }
    }
}

func squirclePath(in rect: CGRect) -> CGPath {
    let radius = rect.width * 0.2237
    return CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
}

do {
    guard CommandLine.arguments.count == 3 else { throw SquircleError.usage }
    let inputPath = CommandLine.arguments[1]
    let outputPath = CommandLine.arguments[2]

    guard let source = NSImage(contentsOfFile: inputPath),
          let cgSource = source.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { throw SquircleError.unreadable(inputPath) }

    let canvas = 1024
    let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let context = CGContext(
        data: nil, width: canvas, height: canvas, bitsPerComponent: 8, bytesPerRow: 0,
        space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { throw SquircleError.encodingFailed }

    context.interpolationQuality = .high
    context.addPath(squirclePath(in: tile))
    context.clip()

    // Aspect-fill the source into the tile so no transparent gaps show inside the squircle.
    let scale = max(tile.width / CGFloat(cgSource.width), tile.height / CGFloat(cgSource.height))
    let drawSize = CGSize(width: CGFloat(cgSource.width) * scale, height: CGFloat(cgSource.height) * scale)
    let drawRect = CGRect(
        x: tile.midX - drawSize.width / 2, y: tile.midY - drawSize.height / 2,
        width: drawSize.width, height: drawSize.height
    )
    context.draw(cgSource, in: drawRect)

    guard let output = context.makeImage() else { throw SquircleError.encodingFailed }
    let rep = NSBitmapImageRep(cgImage: output)
    guard let png = rep.representation(using: .png, properties: [:]) else { throw SquircleError.encodingFailed }
    try png.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
} catch {
    FileHandle.standardError.write(Data("buddydock: \(error)\n".utf8))
    exit(1)
}
