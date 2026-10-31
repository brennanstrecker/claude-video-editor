// phone.swift: the Mac side of send.mjs, which gets finished videos to the
// creator's iPhone at full quality.
//
//   phone airdrop <file>...   opens the AirDrop window with the files; click the iPhone
//   phone check <file>...     says whether AirDrop can take the files, with no window
//   phone uploaded <file>     prints 1 once iCloud Drive has the file, else 0
import AppKit

final class Watcher: NSObject, NSSharingServiceDelegate {
  func sharingService(_ s: NSSharingService, didShareItems items: [Any]) {
    print("sent"); exit(0)
  }
  func sharingService(_ s: NSSharingService, didFailToShareItems items: [Any], error: Error) {
    print("not sent: \(error.localizedDescription)"); exit(1)
  }
}

let args = Array(CommandLine.arguments.dropFirst())
guard let mode = args.first, args.count > 1 else {
  print("usage: phone airdrop|check|uploaded <file>..."); exit(2)
}
let urls = args.dropFirst().map { URL(fileURLWithPath: $0) }
let watcher = Watcher()

switch mode {
case "uploaded":
  let v = try? urls[0].resourceValues(forKeys: [.ubiquitousItemIsUploadedKey])
  print(v?.ubiquitousItemIsUploaded == true ? 1 : 0)
case "check", "airdrop":
  guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: urls) else {
    print("AirDrop is not available: turn on Wi-Fi and Bluetooth"); exit(2)
  }
  if mode == "check" { print("ok"); exit(0) }
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  service.delegate = watcher
  DispatchQueue.main.async {
    app.activate(ignoringOtherApps: true)
    service.perform(withItems: urls)
  }
  // Nobody picked a device: close the window after 10 minutes.
  DispatchQueue.main.asyncAfter(deadline: .now() + 600) { print("not sent: no device picked"); exit(1) }
  app.run()
default:
  print("unknown mode \(mode)"); exit(2)
}
