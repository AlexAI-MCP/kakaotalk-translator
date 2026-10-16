// On-device ko<->en translation via Apple's Translation framework.
// Never writes input or output text to stderr: these are private messages.
import AppKit
import Foundation
import SwiftUI
import Translation

func fail(_ message: String, _ code: Int32) -> Never {
  FileHandle.standardError.write(Data("kakao-apple-translate: \(message)\n".utf8))
  exit(code)
}

func emit(_ value: some Encodable) {
  let encoder = JSONEncoder()
  encoder.outputFormatting = .withoutEscapingSlashes
  guard let data = try? encoder.encode(value) else { fail("could not encode output", 1) }
  FileHandle.standardOutput.write(data + Data("\n".utf8))
}

func label(_ status: LanguageAvailability.Status) -> String {
  switch status {
  case .installed: "installed"
  case .supported: "supported"
  default: "unsupported"
  }
}

// The framework turns standalone compatibility jamo (ㅋㅋ, ㅠㅠ) into conjoining jamo
// (U+1100-U+11FF). Map them back. NFC first so jamo that do compose a syllable are left alone.
let jamo: [UInt32: UInt32] = {
  var map: [UInt32: UInt32] = [:]
  // Lead consonants U+1100-U+1112: ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ
  let leads: [UInt32] = [0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143,
                         0x3145, 0x3146, 0x3147, 0x3148, 0x3149, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E]
  for (i, c) in leads.enumerated() { map[0x1100 + UInt32(i)] = c }
  // Vowels U+1161-U+1175 map in order onto ㅏ-ㅣ (U+314F-U+3163).
  for i in UInt32(0)...20 { map[0x1161 + i] = 0x314F + i }
  // Tail consonants U+11A8-U+11C2.
  let tails: [UInt32] = [0x3131, 0x3132, 0x3133, 0x3134, 0x3135, 0x3136, 0x3137, 0x3139, 0x313A,
                         0x313B, 0x313C, 0x313D, 0x313E, 0x313F, 0x3140, 0x3141, 0x3142, 0x3144,
                         0x3145, 0x3146, 0x3147, 0x3148, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E]
  for (i, c) in tails.enumerated() { map[0x11A8 + UInt32(i)] = c }
  return map
}()

func fixJamo(_ text: String) -> String {
  guard text.unicodeScalars.contains(where: { (0x1100...0x11FF).contains($0.value) }) else { return text }
  var out = String.UnicodeScalarView()
  for s in text.precomposedStringWithCanonicalMapping.unicodeScalars {
    out.append(jamo[s.value].flatMap(Unicode.Scalar.init) ?? s)
  }
  return String(out)
}

let ko = Locale.Language(identifier: "ko")
let en = Locale.Language(identifier: "en")
let availability = LanguageAvailability()

if CommandLine.arguments.dropFirst().first == "--check" {
  emit([
    "ko-en": label(await availability.status(from: ko, to: en)),
    "en-ko": label(await availability.status(from: en, to: ko)),
  ])
  exit(0)
}
let usage = "usage: kakao-apple-translate [--check | --install <ko|en> <ko|en>]"
let codes = ["ko": ko, "en": en]

// --install: show Apple's native language download prompt in a small window.
struct InstallResult: Encodable { let status: String, prompted: Bool }

@MainActor enum Install { static var finished = false }
@MainActor func finishInstall(_ source: Locale.Language, _ target: Locale.Language) async -> Never {
  if !Install.finished {
    Install.finished = true
    emit(InstallResult(status: label(await LanguageAvailability().status(from: source, to: target)), prompted: true))
  }
  exit(0)
}

@MainActor final class CloseWatcher: NSObject, NSWindowDelegate {
  let source: Locale.Language, target: Locale.Language
  init(_ source: Locale.Language, _ target: Locale.Language) { self.source = source; self.target = target }
  func windowWillClose(_ notification: Notification) {
    Task { await finishInstall(source, target) }
  }
}

struct InstallView: View {
  let source: Locale.Language, target: Locale.Language
  var body: some View {
    Text("Download Korean to translate messages on this Mac.").padding(30)
      .fixedSize()
      // @concurrent: the session is not Sendable, so Swift 6 requires using it off the main actor.
      .translationTask(TranslationSession.Configuration(source: source, target: target)) { @concurrent session in
        try? await session.prepareTranslation()
        await finishInstall(source, target)
      }
  }
}

// Everything in --install runs inside the AppKit event loop. A top-level await before app.run() would
// resume on the main queue, which AppKit cannot drain, so Apple's prompt would never start.
@MainActor final class InstallDelegate: NSObject, NSApplicationDelegate {
  let source: Locale.Language, target: Locale.Language
  var window: NSWindow?, watcher: CloseWatcher?
  init(_ source: Locale.Language, _ target: Locale.Language) { self.source = source; self.target = target }
  func applicationDidFinishLaunching(_ notification: Notification) {
    Task {
      switch await LanguageAvailability().status(from: source, to: target) {
      case .installed: emit(InstallResult(status: "installed", prompted: false)); exit(0)
      case .supported: break
      default: emit(InstallResult(status: "unsupported", prompted: false)); exit(3)
      }
      let window = NSWindow(contentRect: .init(x: 0, y: 0, width: 440, height: 120), styleMask: [.titled, .closable],
                            backing: .buffered, defer: false)
      window.title = "KakaoTalk Translator"
      window.isReleasedWhenClosed = false
      watcher = CloseWatcher(source, target)
      window.delegate = watcher
      window.contentView = NSHostingView(rootView: InstallView(source: source, target: target))
      window.center()
      // Launched in the background by the viewer, so force the window in front of the browser.
      window.level = .floating
      window.makeKeyAndOrderFront(nil)
      window.orderFrontRegardless()
      NSApp.activate(ignoringOtherApps: true)
      self.window = window
    }
  }
}

if CommandLine.arguments.dropFirst().first == "--install" {
  let args = CommandLine.arguments
  guard args.count == 4, args[2] != args[3], let source = codes[args[2]], let target = codes[args[3]] else { fail(usage, 1) }
  let app = NSApplication.shared
  app.setActivationPolicy(.regular)
  let delegate = InstallDelegate(source, target)
  app.delegate = delegate
  app.run()
  exit(0)
}
guard CommandLine.arguments.count == 1 else { fail(usage, 1) }

struct Input: Decodable { let source: String, target: String, texts: [String] }
guard let input = try? JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile()),
      let source = codes[input.source], let target = codes[input.target], input.source != input.target
else { fail("invalid input JSON", 1) }

switch await availability.status(from: source, to: target) {
case .installed: break
case .supported: fail("language pack not installed", 2)
default: fail("language pair unsupported", 3)
}

var results = Array(repeating: "", count: input.texts.count)
let requests = input.texts.enumerated().filter { !$0.element.isEmpty }
  .map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
if !requests.isEmpty {
  let session = TranslationSession(installedSource: source, target: target)
  guard let responses = try? await session.translations(from: requests) else { fail("translation failed", 1) }
  for r in responses {
    guard let id = r.clientIdentifier.flatMap(Int.init), results.indices.contains(id) else { fail("unexpected response", 1) }
    results[id] = fixJamo(r.targetText)
  }
}
emit(results)
