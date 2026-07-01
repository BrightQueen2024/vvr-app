import { IStructuralSanityAnalyzer, VideoMetadata, TelemetryEnvelope, SanityCheckResult } from './IStructuralSanityAnalyzer';

export class StructuralSanityAnalyzerImpl implements IStructuralSanityAnalyzer {
  // Configurable thresholds matching system guidelines
  private readonly MAX_DURATION_SEC = 300;     // FR-2.1.1: 5 minutes limit
  private readonly MAX_BITRATE_KBPS = 1500;    // FR-2.1.2: 1.5 Mbps ceiling
  private readonly DEFAULT_DRIFT_TOLERANCE_MS = 2000; // 2 seconds threshold
  private readonly VALID_CODECS = ['h265', 'hevc'];

  private driftToleranceMs: number;

  constructor(driftToleranceMs: number = 2000) {
    this.driftToleranceMs = driftToleranceMs;
  }

  /**
   * Evaluates the structural integrity and temporal clock consistency of the video container.
   */
  public analyzeStructuralSanity(
    metadata: VideoMetadata,
    telemetry: TelemetryEnvelope
  ): SanityCheckResult {
    const flaggedReasons: string[] = [];
    let confidenceScore = 100;

    // 1. Verify Codec Profile: Must be H.265/HEVC
    const normalizedCodec = metadata.codec.trim().toLowerCase();
    if (!this.VALID_CODECS.includes(normalizedCodec)) {
      flaggedReasons.push('INVALID_CODEC: Codec must strictly be H.265/HEVC for data minimization.');
      confidenceScore -= 40;
    }

    // 2. Verify Duration Limits (FR-2.1.1)
    if (metadata.durationSec <= 0) {
      flaggedReasons.push('INVALID_DURATION: Video duration must be greater than 0.');
      confidenceScore -= 30;
    } else if (metadata.durationSec > this.MAX_DURATION_SEC) {
      flaggedReasons.push(`DURATION_LIMIT_EXCEEDED: Video runtime exceeds maximum limit of ${this.MAX_DURATION_SEC} seconds.`);
      confidenceScore -= 30;
    }

    // 3. Verify Transcoding Bitrate Ceiling (FR-2.1.2)
    if (metadata.bitrateKbps <= 0) {
      flaggedReasons.push('INVALID_BITRATE: Video average bitrate must be positive.');
      confidenceScore -= 20;
    } else if (metadata.bitrateKbps > this.MAX_BITRATE_KBPS) {
      flaggedReasons.push(`BITRATE_LIMIT_EXCEEDED: Video bitrate exceeds maximum allowed threshold of ${this.MAX_BITRATE_KBPS} Kbps.`);
      confidenceScore -= 30;
    }

    // 4. Verify Temporal Clock Consistency (Clock Drift & Chronological Safety)
    const driftMs = Math.abs(metadata.creationTimeMs - telemetry.deviceTimestampMs);
    if (driftMs > this.driftToleranceMs) {
      flaggedReasons.push(`TEMPORAL_CLOCK_DRIFT: Video container creation time drifted abnormally from device log epoch (${driftMs}ms delay).`);
      confidenceScore -= 30;
    }

    // Chronological safety check: video creation cannot happen in the future compared to gateway receipt
    if (metadata.creationTimeMs > telemetry.gatewayTimestampMs) {
      flaggedReasons.push('CHRONOLOGICAL_IMPOSSIBILITY: Video container creation timestamp lies in the future relative to gateway ingestion.');
      confidenceScore -= 50;
    }

    // Enforce confidence score bounding
    confidenceScore = Math.max(0, confidenceScore);

    const isValid = flaggedReasons.length === 0;

    return {
      isValid,
      confidenceScore,
      driftMs,
      flaggedReasons
    };
  }
}
