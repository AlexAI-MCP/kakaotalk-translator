// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "AppleTranslate",
  platforms: [.macOS(.v26)],
  products: [.executable(name: "kakao-apple-translate", targets: ["AppleTranslate"])],
  targets: [.executableTarget(name: "AppleTranslate")]
)
