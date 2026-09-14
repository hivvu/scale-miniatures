import CoreGraphics
import Foundation
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { exit(1) }
let filter = CommandLine.arguments.count > 1 ? CommandLine.arguments[1].lowercased() : ""
for w in list {
    let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
    let name = (w[kCGWindowName as String] as? String) ?? ""
    let id = (w[kCGWindowNumber as String] as? Int) ?? 0
    let b = (w[kCGWindowBounds as String] as? [String: Any]) ?? [:]
    let layer = (w[kCGWindowLayer as String] as? Int) ?? 0; let opid = (w[kCGWindowOwnerPID as String] as? Int) ?? 0
    if filter.isEmpty || owner.lowercased().contains(filter) || name.lowercased().contains(filter) {
        print("\(id)\t\(layer)\t\(opid)\t\(owner)\t\(name)\t\(b["X"] ?? 0),\(b["Y"] ?? 0) \(b["Width"] ?? 0)x\(b["Height"] ?? 0)")
    }
}
