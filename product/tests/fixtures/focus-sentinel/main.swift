import AppKit
import Foundation

let application = NSApplication.shared
application.setActivationPolicy(.regular)

let window = NSWindow(
    contentRect: NSRect(x: 80, y: 80, width: 360, height: 220),
    styleMask: [.titled, .closable],
    backing: .buffered,
    defer: false
)
window.title = "UCU Acceptance Focus Sentinel"
window.isReleasedWhenClosed = false

let label = NSTextField(labelWithString: "UCU owns this temporary focus sentinel.")
label.alignment = .center
label.frame = NSRect(x: 20, y: 130, width: 320, height: 24)
window.contentView?.addSubview(label)

let textField = NSTextField(frame: NSRect(x: 40, y: 75, width: 280, height: 28))
textField.placeholderString = "Native acceptance value"
textField.setAccessibilityLabel("Native unique text value")
window.contentView?.addSubview(textField)

var resetGeneration = 0
var textWriteCount = 0
var observedText = ""

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func emitState() {
    emit([
        "event": "state",
        "reset_generation": resetGeneration,
        "text": observedText,
        "text_write_count": textWriteCount,
    ])
}

Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { _ in
    let current = textField.stringValue
    if current != observedText {
        observedText = current
        textWriteCount += 1
        emitState()
    }
}

func activateSentinel() {
    DispatchQueue.main.async {
        window.makeKeyAndOrderFront(nil)
        application.activate(ignoringOtherApps: true)
    }
}

signal(SIGUSR1, SIG_IGN)
let reactivate = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
reactivate.setEventHandler(handler: activateSentinel)
reactivate.resume()

signal(SIGUSR2, SIG_IGN)
let resetText = DispatchSource.makeSignalSource(signal: SIGUSR2, queue: .main)
resetText.setEventHandler {
    resetGeneration += 1
    textField.stringValue = ""
    observedText = ""
    textWriteCount = 0
    emitState()
}
resetText.resume()

activateSentinel()
emit([
    "ready": true,
    "pid": ProcessInfo.processInfo.processIdentifier,
    "reset_generation": resetGeneration,
    "text": observedText,
    "text_write_count": textWriteCount,
])
application.run()
