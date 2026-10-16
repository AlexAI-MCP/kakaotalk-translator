// On-device ko<->en translation via Apple's Translation framework.
// Never writes input or output text to stderr: these are private messages.
import Foundation
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
guard CommandLine.arguments.count == 1 else { fail("usage: kakao-apple-translate [--check]", 1) }

struct Input: Decodable { let source: String, target: String, texts: [String] }
let codes = ["ko": ko, "en": en]
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
