// face.swift: where the face sits in a clip, so captions go just under the
// chin (rules/video-rules.md, rule 30).
//
//   face <video> [every seconds, default 0.5]
//
// Prints one JSON line per sample: {"t":12.5,"top":0.41,"bottom":0.70,"cx":0.46}
// as fractions of the displayed frame, measured from the top. A sample with
// no face prints {"t":12.5}. Apple Vision is built into macOS, so this needs
// no install; lib.mjs compiles it on first use.

import AVFoundation
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: face <video> [every]\n".data(using: .utf8)!)
  exit(2)
}
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let every = args.count > 2 ? Double(args[2]) ?? 0.5 : 0.5
let gen = AVAssetImageGenerator(asset: asset)
// Phone clips are often stored sideways with a rotation flag; this applies it.
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = CMTime(seconds: 0.1, preferredTimescale: 600)
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.1, preferredTimescale: 600)
gen.maximumSize = CGSize(width: 540, height: 960)

let duration = CMTimeGetSeconds(asset.duration)
var t = 0.0
while t < duration {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: time, actualTime: nil) {
    let req = VNDetectFaceRectanglesRequest()
    try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
    if let f = (req.results ?? []).max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
      let b = f.boundingBox  // origin bottom-left
      print(String(format: "{\"t\":%.2f,\"top\":%.3f,\"bottom\":%.3f,\"cx\":%.3f}", t, 1 - b.maxY, 1 - b.minY, b.midX))
    } else {
      print(String(format: "{\"t\":%.2f}", t))
    }
  }
  t += every
}
