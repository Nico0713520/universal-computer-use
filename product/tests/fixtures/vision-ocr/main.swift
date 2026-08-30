import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count == 2 else { exit(2) }
let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { exit(3) }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
request.customWords = ["0", "703"]
request.regionOfInterest = CGRect(x: 0, y: 0.55, width: 1, height: 0.45)
let handler = VNImageRequestHandler(cgImage: image)
do {
    try handler.perform([request])
    let text = (request.results ?? []).compactMap { observation in
        observation.topCandidates(1).first?.string
    }
    let data = try JSONSerialization.data(withJSONObject: text)
    FileHandle.standardOutput.write(data)
} catch {
    exit(4)
}
