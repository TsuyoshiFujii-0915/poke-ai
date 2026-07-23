import Testing
@testable import CaptureRecognition

@Suite
struct CaptureRecoveryWatchdogTests {
    @Test
    func requestsRecoveryAfterFrameTimeout() throws -> Void {
        let watchdog = try CaptureRecoveryWatchdog(stallTimeout: 5.0)
        try watchdog.markSessionStarted(at: 10.0)
        try watchdog.recordFrame(at: 12.0)

        #expect(try !watchdog.shouldRecover(at: 16.9))
        #expect(try watchdog.shouldRecover(at: 17.0))
    }

    @Test
    func sessionRestartClearsPreviousFrameDeadline() throws -> Void {
        let watchdog = try CaptureRecoveryWatchdog(stallTimeout: 5.0)
        try watchdog.markSessionStarted(at: 10.0)
        try watchdog.recordFrame(at: 12.0)
        #expect(try watchdog.shouldRecover(at: 17.0))

        try watchdog.markSessionStarted(at: 20.0)

        #expect(try !watchdog.shouldRecover(at: 24.9))
        #expect(try watchdog.shouldRecover(at: 25.0))
    }

    @Test
    func rejectsInvalidAndBackwardTimestamps() throws -> Void {
        #expect(throws: CaptureRecoveryWatchdogError.invalidStallTimeout(0)) {
            _ = try CaptureRecoveryWatchdog(stallTimeout: 0)
        }

        let watchdog = try CaptureRecoveryWatchdog(stallTimeout: 5.0)
        try watchdog.markSessionStarted(at: 10.0)
        try watchdog.recordFrame(at: 12.0)

        #expect(throws: CaptureRecoveryWatchdogError.nonMonotonicTimestamp(
            previous: 12.0,
            current: 11.0
        )) {
            try watchdog.recordFrame(at: 11.0)
        }
    }
}
