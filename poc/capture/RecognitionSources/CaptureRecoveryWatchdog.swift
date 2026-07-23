import Foundation

public enum CaptureRecoveryWatchdogError: Error, Equatable, CustomStringConvertible {
    case invalidStallTimeout(TimeInterval)
    case invalidTimestamp(TimeInterval)
    case sessionNotStarted
    case nonMonotonicTimestamp(previous: TimeInterval, current: TimeInterval)

    public var description: String {
        switch self {
        case let .invalidStallTimeout(value):
            return "capture stall timeout must be finite and greater than zero: \(value)"
        case let .invalidTimestamp(value):
            return "capture watchdog timestamp must be finite and nonnegative: \(value)"
        case .sessionNotStarted:
            return "capture watchdog session has not been started"
        case let .nonMonotonicTimestamp(previous, current):
            return "capture watchdog timestamp moved backward from \(previous) to \(current)"
        }
    }
}

public final class CaptureRecoveryWatchdog: @unchecked Sendable {
    private let stallTimeout: TimeInterval
    private let lock = NSLock()
    private var sessionStartedAt: TimeInterval?
    private var lastFrameAt: TimeInterval?
    private var lastRecordedTimestamp: TimeInterval?

    public init(stallTimeout: TimeInterval) throws {
        guard stallTimeout.isFinite, stallTimeout > 0 else {
            throw CaptureRecoveryWatchdogError.invalidStallTimeout(stallTimeout)
        }
        self.stallTimeout = stallTimeout
    }

    public func markSessionStarted(at timestamp: TimeInterval) throws -> Void {
        lock.lock()
        defer { lock.unlock() }
        try markSessionStartedLocked(at: timestamp)
    }

    public func markSessionStartedNow() throws -> Void {
        lock.lock()
        defer { lock.unlock() }
        try markSessionStartedLocked(at: ProcessInfo.processInfo.systemUptime)
    }

    public func recordFrame(at timestamp: TimeInterval) throws -> Void {
        lock.lock()
        defer { lock.unlock() }
        try recordFrameLocked(at: timestamp)
    }

    public func recordFrameNow() throws -> Void {
        lock.lock()
        defer { lock.unlock() }
        try recordFrameLocked(at: ProcessInfo.processInfo.systemUptime)
    }

    public func shouldRecover(at timestamp: TimeInterval) throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return try shouldRecoverLocked(at: timestamp)
    }

    public func shouldRecoverNow() throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return try shouldRecoverLocked(at: ProcessInfo.processInfo.systemUptime)
    }

    private func markSessionStartedLocked(at timestamp: TimeInterval) throws -> Void {
        try validateRecordedTimestamp(timestamp)
        sessionStartedAt = timestamp
        lastFrameAt = nil
        lastRecordedTimestamp = timestamp
    }

    private func recordFrameLocked(at timestamp: TimeInterval) throws -> Void {
        guard sessionStartedAt != nil else {
            throw CaptureRecoveryWatchdogError.sessionNotStarted
        }
        try validateRecordedTimestamp(timestamp)
        lastFrameAt = timestamp
        lastRecordedTimestamp = timestamp
    }

    private func shouldRecoverLocked(at timestamp: TimeInterval) throws -> Bool {
        try validateTimestamp(timestamp)
        guard let sessionStartedAt else {
            throw CaptureRecoveryWatchdogError.sessionNotStarted
        }
        let activityAt = lastFrameAt ?? sessionStartedAt
        guard timestamp >= activityAt else {
            throw CaptureRecoveryWatchdogError.nonMonotonicTimestamp(
                previous: activityAt,
                current: timestamp
            )
        }
        return timestamp - activityAt >= stallTimeout
    }

    private func validateRecordedTimestamp(_ timestamp: TimeInterval) throws -> Void {
        try validateTimestamp(timestamp)
        if let previous = lastRecordedTimestamp, timestamp < previous {
            throw CaptureRecoveryWatchdogError.nonMonotonicTimestamp(
                previous: previous,
                current: timestamp
            )
        }
    }

    private func validateTimestamp(_ timestamp: TimeInterval) throws -> Void {
        guard timestamp.isFinite, timestamp >= 0 else {
            throw CaptureRecoveryWatchdogError.invalidTimestamp(timestamp)
        }
    }
}
