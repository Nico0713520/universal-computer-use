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
