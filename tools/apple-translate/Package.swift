// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "AppleTranslate",
  platforms: [.macOS(.v26)],
  products: [.executable(name: "kakao-apple-translate", targets: ["AppleTranslate"])],
  // Swift 5 mode: the download prompt only appears when prepareTranslation() runs on the main actor,
  // which Swift 6 region checks reject for the non-Sendable session (an @concurrent closure shows no prompt).
  targets: [.executableTarget(name: "AppleTranslate", swiftSettings: [.swiftLanguageMode(.v5)])]
)
