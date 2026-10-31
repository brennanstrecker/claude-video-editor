// sdr.swift: an iPhone HDR clip as standard colour (SDR, BT.709) ProRes, using
// Apple's own HDR conversion, so the picture matches what the phone shows.
// build.mjs calls it through pictureFile() in lib.mjs.
//
//   sdr <in.MOV> <out.mov>
import AVFoundation

let a = CommandLine.arguments
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let comp = AVMutableVideoComposition(propertiesOf: asset)
comp.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
comp.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
comp.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

let out = URL(fileURLWithPath: a[2])
try? FileManager.default.removeItem(at: out)
guard let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleProRes422LPCM) else {
  print("sdr: no export session for \(a[1])"); exit(1)
}
ex.videoComposition = comp
ex.outputURL = out
ex.outputFileType = .mov
let done = DispatchSemaphore(value: 0)
ex.exportAsynchronously { done.signal() }
done.wait()
if ex.status != .completed { print("sdr: \(ex.error?.localizedDescription ?? "export failed")"); exit(1) }
