import CoreGraphics
import Foundation
// usage: sendkey <pid> <keycode> [hold_ms=250] [keycode hold_ms ...] — posts key down/up to that process only
let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2, let pid = pid_t(args[0]) else { print("usage: sendkey <pid> <keycode> [hold_ms] ..."); exit(1) }
var i = 1
while i < args.count {
    let code = CGKeyCode(UInt16(args[i]) ?? 0)
    var hold = 250
    if i + 1 < args.count, let h = Int(args[i+1]) { hold = h; i += 1 }
    i += 1
    let src = CGEventSource(stateID: .hidSystemState)
    if let d = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true) { d.postToPid(pid) }
    usleep(useconds_t(hold * 1000))
    if let u = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false) { u.postToPid(pid) }
    usleep(150_000)
}
