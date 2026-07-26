// PoC 0-1: USB接続iPhoneの画面キャプチャ最小実装
//
// 検証内容:
// 1. kCMIOHardwarePropertyAllowScreenCaptureDevices を有効化できるか
// 2. DiscoverySession のウォームアップ後、iPhoneが .external デバイスとして出現するか
// 3. AVCaptureSession でフレーム(CMSampleBuffer)を受信できるか
// 4. フレームレート・解像度・安定性を計測できるか
//
// 使い方:
//   swift run poke-capture-poc list                # デバイス列挙のみ
//   swift run poke-capture-poc capture [秒数]      # フレーム取得と統計表示（デフォルト30秒）

import AVFoundation
import CaptureRecognition
import CoreImage
import CoreMediaIO
import Foundation
import ImageIO
import Network

// MARK: - CoreMediaIO: スクリーンキャプチャデバイスの許可

func enableScreenCaptureDevices() {
    var prop = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
    )
    var allow: UInt32 = 1
    let result = CMIOObjectSetPropertyData(
        CMIOObjectID(kCMIOObjectSystemObject),
        &prop, 0, nil,
        UInt32(MemoryLayout<UInt32>.size), &allow
    )
    if result == kCMIOHardwareNoError {
        log("kCMIOHardwarePropertyAllowScreenCaptureDevices を有効化した")
    } else {
        log("警告: プロパティ設定に失敗 (OSStatus=\(result))")
    }
}

func log(_ message: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    print("[\(ts)] \(message)")
}

// MARK: - カメラ権限（TCC）

/// キャプチャデバイスの列挙にはカメラアクセス許可が必要。
/// 未許可だとエラーなしで空リストが返るため、明示的に確認・要求する。
func ensureCameraPermission() -> Bool {
    let status = AVCaptureDevice.authorizationStatus(for: .video)
    switch status {
    case .authorized:
        log("カメラ権限: 許可済み")
        return true
    case .notDetermined:
        log("カメラ権限: 未決定 → 許可ダイアログを要求（表示されたら「許可」を押して）")
        var granted = false
        let semaphore = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .video) { ok in
            granted = ok
            semaphore.signal()
        }
        // ダイアログ待ちの間もRunLoopを回す
        while semaphore.wait(timeout: .now()) == .timedOut {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        }
        log("カメラ権限: \(granted ? "許可された" : "拒否された")")
        return granted
    case .denied, .restricted:
        log("カメラ権限: 拒否/制限されている。システム設定 > プライバシーとセキュリティ > カメラ で、実行元のターミナルアプリを許可して再実行して。")
        return false
    @unknown default:
        log("カメラ権限: 不明なステータス(\(status.rawValue))")
        return false
    }
}

// MARK: - デバイス発見

/// mediaTypeを絞らず全ての外部デバイスを列挙する（診断用に全件返す）。
/// 参考実装(SO/CodeJam)はいずれも mediaType: nil で探索してから絞り込んでいる。
func discoverDevices() -> [AVCaptureDevice] {
    let deviceTypes: [AVCaptureDevice.DeviceType]
    if #available(macOS 14.0, *) {
        deviceTypes = [.external]
    } else {
        deviceTypes = [.externalUnknown]
    }
    let session = AVCaptureDevice.DiscoverySession(
        deviceTypes: deviceTypes,
        mediaType: nil,
        position: .unspecified
    )
    return session.devices
}

func isScreenCaptureDevice(_ device: AVCaptureDevice) -> Bool {
    device.hasMediaType(.muxed)
}

/// ウォームアップ + RunLoopを回しながらデバイスの出現を待つ。
/// 既知の罠:
/// - プロパティ設定の反映に数秒かかる
/// - 一度Discoveryを呼ばないと AVCaptureDeviceWasConnected 通知が発火しない
/// - デバイス出現イベントはRunLoop経由で配送されるため、Thread.sleepで待つと受け取れない
func waitForDevice(timeoutSeconds: Int) -> AVCaptureDevice? {
    log("デバイス探索を開始（最大 \(timeoutSeconds) 秒待機）")

    var notified: AVCaptureDevice?
    let observer = NotificationCenter.default.addObserver(
        forName: .AVCaptureDeviceWasConnected, object: nil, queue: nil
    ) { notification in
        if let device = notification.object as? AVCaptureDevice {
            log("接続通知: \(device.localizedName) (muxed=\(device.hasMediaType(.muxed)))")
            if isScreenCaptureDevice(device) {
                notified = device
            }
        }
    }
    defer { NotificationCenter.default.removeObserver(observer) }

    _ = discoverDevices() // ウォームアップ呼び出し

    var reportedNames = Set<String>()
    let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
    while Date() < deadline {
        // RunLoopを回してCMIO/AVFoundationのイベントを処理させる
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(1.0))

        if let device = notified {
            log("デバイス発見(通知経由): \(device.localizedName) (modelID=\(device.modelID))")
            return device
        }

        let devices = discoverDevices()
        for device in devices where !reportedNames.contains(device.uniqueID) {
            reportedNames.insert(device.uniqueID)
            log("検出デバイス: \(device.localizedName) [modelID=\(device.modelID), muxed=\(device.hasMediaType(.muxed)), video=\(device.hasMediaType(.video))]")
        }
        if let device = devices.first(where: isScreenCaptureDevice) {
            log("デバイス発見(ポーリング経由): \(device.localizedName) (modelID=\(device.modelID))")
            return device
        }
    }
    if !reportedNames.isEmpty {
        log("外部デバイスは見つかったが、スクリーンキャプチャ(muxed)デバイスではなかった。")
    }
    return nil
}

// MARK: - フレーム受信と統計

final class FrameCollector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private(set) var frameCount = 0
    private(set) var droppedCount = 0
    private(set) var firstFrameAt: Date?
    private(set) var lastFrameAt: Date?
    private(set) var width = 0
    private(set) var height = 0
    private var lastReportAt = Date()
    private var framesSinceReport = 0

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = Date()
        if firstFrameAt == nil {
            firstFrameAt = now
            if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
                width = CVPixelBufferGetWidth(pixelBuffer)
                height = CVPixelBufferGetHeight(pixelBuffer)
                let format = CVPixelBufferGetPixelFormatType(pixelBuffer)
                log("初回フレーム受信: \(width)x\(height), pixelFormat=\(fourCCString(format))")
            }
        }
        frameCount += 1
        framesSinceReport += 1
        lastFrameAt = now

        // 5秒ごとにfpsを報告
        if now.timeIntervalSince(lastReportAt) >= 5.0 {
            let fps = Double(framesSinceReport) / now.timeIntervalSince(lastReportAt)
            log(String(format: "受信中: 累計 %d フレーム, 直近 %.1f fps, ドロップ %d", frameCount, fps, droppedCount))
            lastReportAt = now
            framesSinceReport = 0
        }
    }

    func captureOutput(_ output: AVCaptureOutput,
                       didDrop sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        droppedCount += 1
    }

    private func fourCCString(_ code: OSType) -> String {
        let chars: [Character] = (0..<4).compactMap {
            let byte = UInt8((code >> (8 * (3 - $0))) & 0xFF)
            return Character(UnicodeScalar(byte))
        }
        return String(chars)
    }
}

// MARK: - キャプチャ実行

func runCapture(device: AVCaptureDevice, durationSeconds: Int) -> Bool {
    let session = AVCaptureSession()
    let collector = FrameCollector()

    do {
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            log("エラー: 入力を追加できない")
            return false
        }
        session.addInput(input)
    } catch {
        log("エラー: AVCaptureDeviceInput 作成失敗: \(error.localizedDescription)")
        return false
    }

    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    output.alwaysDiscardsLateVideoFrames = true
    let queue = DispatchQueue(label: "capture.frames")
    output.setSampleBufferDelegate(collector, queue: queue)
    guard session.canAddOutput(output) else {
        log("エラー: 出力を追加できない")
        return false
    }
    session.addOutput(output)

    log("キャプチャ開始（\(durationSeconds) 秒間）")
    session.startRunning()

    // 指定時間メインループを回す（デバイス切断も検知したいのでRunLoopを使う）
    let deadline = Date().addingTimeInterval(TimeInterval(durationSeconds))
    while Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.5))
        if !session.isRunning {
            log("警告: セッションが停止した")
            break
        }
    }
    session.stopRunning()

    // 統計サマリー
    log("キャプチャ終了")
    print("")
    print("=== 統計サマリー ===")
    print("総フレーム数: \(collector.frameCount)")
    print("ドロップ数: \(collector.droppedCount)")
    if let first = collector.firstFrameAt, let last = collector.lastFrameAt, collector.frameCount > 1 {
        let elapsed = last.timeIntervalSince(first)
        let avgFps = Double(collector.frameCount - 1) / elapsed
        print(String(format: "実効時間: %.1f 秒", elapsed))
        print(String(format: "平均フレームレート: %.1f fps", avgFps))
        print("解像度: \(collector.width)x\(collector.height)")
    }
    return collector.frameCount > 0
}

// MARK: - MJPEG配信（PoC 0-2: 候補C）

/// 127.0.0.1限定の最小HTTPサーバー。全リクエストにMJPEGストリームを返す。
final class MJPEGServer {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "mjpeg.server")
    private var connections: [NWConnection] = []

    init(port: UInt16) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        listener = try NWListener(using: params)
        listener.newConnectionHandler = { [weak self] conn in
            self?.accept(conn)
        }
    }

    func start() {
        listener.start(queue: queue)
    }

    var clientCount: Int {
        queue.sync { connections.count }
    }

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        // リクエスト内容は見ずに、最初のデータ受信をトリガーにストリームを開始する
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] _, _, _, error in
            guard let self, error == nil else {
                conn.cancel()
                return
            }
            let headers = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Connection: close\r\n\r\n"
            conn.send(content: headers.data(using: .utf8), completion: .contentProcessed { [weak self] sendError in
                guard let self, sendError == nil else {
                    conn.cancel()
                    return
                }
                self.connections.append(conn)
                log("クライアント接続 (現在 \(self.connections.count) 台)")
            })
        }
    }

    /// 全クライアントへ1フレーム送信する（サーバーキュー上で実行）
    func broadcast(jpeg: Data) {
        queue.async {
            guard !self.connections.isEmpty else { return }
            var packet = Data()
            packet.append("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: \(jpeg.count)\r\n\r\n".data(using: .utf8)!)
            packet.append(jpeg)
            packet.append("\r\n".data(using: .utf8)!)
            for conn in self.connections {
                conn.send(content: packet, completion: .contentProcessed { [weak self] error in
                    if error != nil {
                        self?.queue.async { self?.remove(conn) }
                    }
                })
            }
        }
    }

    private func remove(_ conn: NWConnection) {
        connections.removeAll { $0 === conn }
        conn.cancel()
        log("クライアント切断 (現在 \(connections.count) 台)")
    }
}

/// フレームを縮小・JPEG化してMJPEGサーバーへ流すデリゲート
final class StreamCollector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let server: MJPEGServer
    private let frameObserver: CapturedFrameObserver
    private let recoveryWatchdog: CaptureRecoveryWatchdog
    private let scale: CGFloat
    private let quality: CGFloat
    private let minFrameInterval: TimeInterval
    private let ciContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()

    private var lastSentAt = Date.distantPast
    // 統計
    private var inputFrames = 0
    private var sentFrames = 0
    private var encodeTotalMs = 0.0
    private var lastJpegBytes = 0
    private var lastReportAt = Date()
    private(set) var outputSize: CGSize = .zero

    init(
        server: MJPEGServer,
        scale: CGFloat,
        quality: CGFloat,
        targetFps: Double,
        frameObserver: CapturedFrameObserver,
        recoveryWatchdog: CaptureRecoveryWatchdog
    ) {
        self.server = server
        self.scale = scale
        self.quality = quality
        self.minFrameInterval = 1.0 / targetFps
        self.frameObserver = frameObserver
        self.recoveryWatchdog = recoveryWatchdog
    }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        do {
            try recoveryWatchdog.recordFrameNow()
        } catch {
            log("エラー: キャプチャ監視時刻の記録に失敗: \(error)")
            exit(1)
        }
        inputFrames += 1
        let now = Date()
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            log("エラー: 映像フレームにCVPixelBufferがない")
            return
        }
        frameObserver.receive(pixelBuffer: pixelBuffer, sampleBuffer: sampleBuffer)

        // fpsスロットリング（間引き）
        if now.timeIntervalSince(lastSentAt) >= minFrameInterval {
            lastSentAt = now
            let start = CFAbsoluteTimeGetCurrent()
            var image = CIImage(cvPixelBuffer: pixelBuffer)
            if scale != 1.0 {
                image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            }
            outputSize = image.extent.size
            let options = [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): quality]
            if let jpeg = ciContext.jpegRepresentation(of: image, colorSpace: colorSpace, options: options) {
                encodeTotalMs += (CFAbsoluteTimeGetCurrent() - start) * 1000
                sentFrames += 1
                lastJpegBytes = jpeg.count
                server.broadcast(jpeg: jpeg)
            }
        }

        // 5秒ごとに統計を報告
        if now.timeIntervalSince(lastReportAt) >= 5.0 {
            let elapsed = now.timeIntervalSince(lastReportAt)
            let inFps = Double(inputFrames) / elapsed
            let outFps = Double(sentFrames) / elapsed
            let avgEncode = sentFrames > 0 ? encodeTotalMs / Double(sentFrames) : 0
            log(String(format: "入力 %.1f fps → 配信 %.1f fps, エンコード平均 %.1f ms, JPEG %d KB, クライアント %d 台",
                       inFps, outFps, avgEncode, lastJpegBytes / 1024, server.clientCount))
            inputFrames = 0
            sentFrames = 0
            encodeTotalMs = 0
            lastReportAt = now
        }
    }
}

private enum StreamCaptureError: Error, CustomStringConvertible {
    case cannotAddInput(String)
    case cannotAddOutput(String)
    case sessionDidNotStart(String)

    var description: String {
        switch self {
        case let .cannotAddInput(deviceName):
            return "capture input could not be added for device '\(deviceName)'"
        case let .cannotAddOutput(deviceName):
            return "capture output could not be added for device '\(deviceName)'"
        case let .sessionDidNotStart(deviceName):
            return "capture session did not start for device '\(deviceName)'"
        }
    }
}

private func makeStreamCaptureSession(
    device: AVCaptureDevice,
    collector: StreamCollector,
    captureQueue: DispatchQueue
) throws -> AVCaptureSession {
    let session = AVCaptureSession()
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
        throw StreamCaptureError.cannotAddInput(device.localizedName)
    }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(collector, queue: captureQueue)
    guard session.canAddOutput(output) else {
        throw StreamCaptureError.cannotAddOutput(device.localizedName)
    }
    session.addOutput(output)
    return session
}

private func startStreamCaptureSession(
    device: AVCaptureDevice,
    collector: StreamCollector,
    captureQueue: DispatchQueue,
    sessionQueue: DispatchQueue,
    recoveryWatchdog: CaptureRecoveryWatchdog
) throws -> AVCaptureSession {
    let session = try makeStreamCaptureSession(
        device: device,
        collector: collector,
        captureQueue: captureQueue
    )
    try recoveryWatchdog.markSessionStartedNow()
    sessionQueue.sync {
        session.startRunning()
    }
    guard session.isRunning else {
        throw StreamCaptureError.sessionDidNotStart(device.localizedName)
    }
    return session
}

func runStream(
    device: AVCaptureDevice,
    port: UInt16,
    scale: CGFloat,
    quality: CGFloat,
    targetFps: Double,
    frameObserver: CapturedFrameObserver,
    captureQueue: DispatchQueue
) -> Never {
    let server: MJPEGServer
    do {
        server = try MJPEGServer(port: port)
    } catch {
        log("エラー: サーバー起動失敗: \(error.localizedDescription)")
        exit(1)
    }
    server.start()

    let recoveryWatchdog: CaptureRecoveryWatchdog
    do {
        recoveryWatchdog = try CaptureRecoveryWatchdog(stallTimeout: 5.0)
    } catch {
        log("エラー: キャプチャ復旧監視の初期化に失敗: \(error)")
        exit(1)
    }
    let collector = StreamCollector(
        server: server,
        scale: scale,
        quality: quality,
        targetFps: targetFps,
        frameObserver: frameObserver,
        recoveryWatchdog: recoveryWatchdog
    )
    let sessionQueue = DispatchQueue(label: "capture.session")
    var session: AVCaptureSession

    do {
        session = try startStreamCaptureSession(
            device: device,
            collector: collector,
            captureQueue: captureQueue,
            sessionQueue: sessionQueue,
            recoveryWatchdog: recoveryWatchdog
        )
    } catch {
        log("エラー: キャプチャセッション開始失敗: \(error)")
        exit(1)
    }
    log("配信開始: http://127.0.0.1:\(port)/stream (scale=\(scale), quality=\(quality), 上限\(Int(targetFps))fps)")
    log("自動復旧: 5秒間フレームが届かなければキャプチャセッションを再接続")
    log("停止: Ctrl+C")

    while true {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(1.0))
        let stalled: Bool
        do {
            stalled = try recoveryWatchdog.shouldRecoverNow()
        } catch {
            log("エラー: キャプチャ停止判定に失敗: \(error)")
            exit(1)
        }
        guard !stalled, session.isRunning else {
            let reason = stalled ? "5秒間フレーム未受信" : "セッション停止"
            log("警告: \(reason)を検知。自動再接続を開始")
            sessionQueue.sync {
                if session.isRunning {
                    session.stopRunning()
                }
            }
            guard let replacementDevice = waitForDevice(timeoutSeconds: 5) else {
                log("警告: 再接続先が見つからないため5秒後に再試行")
                continue
            }
            do {
                try frameObserver.captureDidRestart()
                session = try startStreamCaptureSession(
                    device: replacementDevice,
                    collector: collector,
                    captureQueue: captureQueue,
                    sessionQueue: sessionQueue,
                    recoveryWatchdog: recoveryWatchdog
                )
                log("キャプチャセッションの自動再接続に成功: \(replacementDevice.localizedName)")
            } catch {
                log("警告: キャプチャセッションの自動再接続に失敗: \(error)。再試行する")
            }
            continue
        }
    }
}

// MARK: - Still-image Pokémon name recognition

private struct JapaneseNameTables: Decodable {
    let species: [String: String]
}

private enum RecognitionCommandError: Error, CustomStringConvertible {
    case invalidSide(String)
    case imageSourceCreationFailed(String)
    case imageDecodeFailed(String)
    case missingJapaneseName(String)

    var description: String {
        switch self {
        case let .invalidSide(value):
            return "invalid side '\(value)'; expected player or opponent"
        case let .imageSourceCreationFailed(path):
            return "could not open image source at \(path)"
        case let .imageDecodeFailed(path):
            return "could not decode image at \(path)"
        case let .missingJapaneseName(species):
            return "Japanese name is missing for species '\(species)'"
        }
    }
}

private func battleSide(from value: String) throws -> BattleSide {
    guard let side = BattleSide(rawValue: value) else {
        throw RecognitionCommandError.invalidSide(value)
    }
    return side
}

private func loadCGImage(path: String) throws -> CGImage {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
        throw RecognitionCommandError.imageSourceCreationFailed(path)
    }
    guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw RecognitionCommandError.imageDecodeFailed(path)
    }
    return image
}

private func loadPokemonNameCandidates(
    speciesPath: String,
    japaneseNamesPath: String
) throws -> [PokemonNameCandidate] {
    let speciesData = try Data(contentsOf: URL(fileURLWithPath: speciesPath))
    let japaneseNamesData = try Data(contentsOf: URL(fileURLWithPath: japaneseNamesPath))
    let species = try JSONDecoder().decode([String].self, from: speciesData)
    let tables = try JSONDecoder().decode(JapaneseNameTables.self, from: japaneseNamesData)
    return try species.map { speciesName in
        guard let japaneseName = tables.species[speciesName] else {
            throw RecognitionCommandError.missingJapaneseName(speciesName)
        }
        return PokemonNameCandidate(id: speciesName, displayName: japaneseName)
    }
}

private func makeIPadHUDNameRecognizer() throws -> PokemonNameRecognizer {
    let regions = BattleNameRegions(
        player: try NormalizedRegion(
            topLeftX: 0.06452,
            topLeftY: 0.86964,
            width: 0.14144,
            height: 0.06429
        ),
        opponent: try NormalizedRegion(
            topLeftX: 0.81141,
            topLeftY: 0.02500,
            width: 0.13896,
            height: 0.06429
        )
    )
    return try PokemonNameRecognizer(
        regions: regions,
        recognitionLanguage: "ja-JP",
        maximumCandidateCount: 3,
        minimumTextHeight: 0.01,
        maximumEditDistance: 1
    )
}

private func printRecognitionOutcome(_ outcome: PokemonNameDetectionOutcome) -> Void {
    switch outcome {
    case let .detected(detection):
        print("status: detected")
        print("side: \(detection.side.rawValue)")
        print("pokemon: \(detection.candidate.id)")
        print("displayName: \(detection.candidate.displayName)")
        print("rawText: \(detection.rawText)")
        print("visionConfidence: \(detection.visionConfidence)")
        print("editDistance: \(detection.editDistance)")
    case let .noText(side):
        print("status: noText")
        print("side: \(side.rawValue)")
    case let .noMatch(side, rawText, recognizedTexts):
        print("status: noMatch")
        print("side: \(side.rawValue)")
        print("rawText: \(rawText)")
        print("recognizedTexts: \(recognizedTexts.map(\.text))")
    case let .ambiguous(side, rawText, candidates):
        print("status: ambiguous")
        print("side: \(side.rawValue)")
        print("rawText: \(rawText)")
        print("candidateIDs: \(candidates.map(\.id))")
    }
}

// MARK: - エントリポイント

// パイプ経由でもログが即時に出るよう行バッファリングを無効化
setbuf(stdout, nil)

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "list"

func prepareCaptureEnvironment() -> Void {
    guard ensureCameraPermission() else {
        exit(1)
    }
    enableScreenCaptureDevices()
}

switch command {
case "list":
    prepareCaptureEnvironment()
    if let device = waitForDevice(timeoutSeconds: 30) {
        print("")
        print("=== 発見デバイス ===")
        print("名前: \(device.localizedName)")
        print("modelID: \(device.modelID)")
        print("uniqueID: \(device.uniqueID)")
        print("接続状態: \(device.isConnected ? "接続中" : "未接続")")
        exit(0)
    } else {
        log("iPhone/iPadが見つからなかった。以下を確認して再実行して:")
        log("  1. USBケーブルがデータ通信対応か（充電専用ケーブルでは映像が取れない）")
        log("  2. デバイス側で「このコンピュータを信頼」を承認済みか")
        log("  3. QuickTime Player の「新規ムービー収録」でカメラソースにデバイスが出るか（出ないならOS/ケーブル側の問題）")
        log("補足: プロパティ設定にはレート制限があるため、連続実行した場合は60秒ほど待つと改善することがある。")
        exit(1)
    }

case "capture":
    prepareCaptureEnvironment()
    let duration = args.count > 2 ? (Int(args[2]) ?? 30) : 30
    guard let device = waitForDevice(timeoutSeconds: 20) else {
        log("iPhoneが見つからなかったためキャプチャを中止。")
        exit(1)
    }
    let ok = runCapture(device: device, durationSeconds: duration)
    exit(ok ? 0 : 1)

case "stream":
    prepareCaptureEnvironment()
    // stream [port] [scale] [quality] [fps]
    let port = UInt16(args.count > 2 ? (Int(args[2]) ?? 8787) : 8787)
    let scale = CGFloat(args.count > 3 ? (Double(args[3]) ?? 0.5) : 0.5)
    let quality = CGFloat(args.count > 4 ? (Double(args[4]) ?? 0.6) : 0.6)
    let fps = args.count > 5 ? (Double(args[5]) ?? 30) : 30
    guard let device = waitForDevice(timeoutSeconds: 20) else {
        log("デバイスが見つからなかったため配信を中止。")
        exit(1)
    }
    runStream(
        device: device,
        port: port,
        scale: scale,
        quality: quality,
        targetFps: fps,
        frameObserver: IgnoringCapturedFrameObserver(),
        captureQueue: DispatchQueue(label: "capture.frames")
    )

case "recognize-stream":
    guard args.count == 4 else {
        print("使い方: poke-capture-poc recognize-stream <species-json-path> <ja-names-json-path>")
        exit(64)
    }
    do {
        let candidates = try loadPokemonNameCandidates(
            speciesPath: args[2],
            japaneseNamesPath: args[3]
        )
        let captureQueue = DispatchQueue(label: "capture.frames")
        let eventRelay = RecognitionEventRelay()
        let detector = UserTriggeredPokemonNameObserver(
            candidates: candidates,
            captureQueue: captureQueue,
            eventPublisher: eventRelay.publish
        )
        let controlServer = try DetectionControlServer(
            port: 8_788,
            detectionController: detector
        )
        try eventRelay.install(handler: controlServer.publishRecognitionEvent)
        controlServer.start()
        prepareCaptureEnvironment()
        guard let device = waitForDevice(timeoutSeconds: 20) else {
            log("デバイスが見つからなかったため認識配信を中止。")
            exit(1)
        }
        runStream(
            device: device,
            port: 8787,
            scale: 0.5,
            quality: 0.6,
            targetFps: 30,
            frameObserver: detector,
            captureQueue: captureQueue
        )
    } catch {
        log("ライブ名前認識の初期化に失敗: \(error)")
        exit(1)
    }

case "recognize-ipad-image":
    guard args.count == 6 else {
        print("使い方: poke-capture-poc recognize-ipad-image <image-path> <player|opponent> <species-json-path> <ja-names-json-path>")
        exit(64)
    }
    do {
        let image = try loadCGImage(path: args[2])
        let side = try battleSide(from: args[3])
        let candidates = try loadPokemonNameCandidates(
            speciesPath: args[4],
            japaneseNamesPath: args[5]
        )
        let outcome = try makeIPadHUDNameRecognizer().recognize(
            cgImage: image,
            orientation: .up,
            side: side,
            candidates: candidates
        )
        printRecognitionOutcome(outcome)
        exit(0)
    } catch {
        log("名前認識エラー: \(error)")
        exit(1)
    }

default:
    print("使い方: poke-capture-poc [list|capture|stream|recognize-stream|recognize-ipad-image] ...")
    print("  capture [秒数]")
    print("  stream [port=8787] [scale=0.5] [quality=0.6] [fps=30]")
    print("  recognize-stream <species-json-path> <ja-names-json-path>")
    print("  recognize-ipad-image <image-path> <player|opponent> <species-json-path> <ja-names-json-path>")
    exit(64)
}
