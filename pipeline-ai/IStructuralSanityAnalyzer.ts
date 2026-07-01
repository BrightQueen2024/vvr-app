export interface VideoMetadata {
  /**
   * Duration of the video in seconds.
   */
  durationSec: number;
  /**
   * Video codec (e.g. 'h265', 'hevc', 'h264'). Must be H.265 profile.
   */
  codec: string;
  /**
   * Average bitrate in kilobits per second (Kbps).
   */
  bitrateKbps: number;
  /**
   * Creation timestamp embedded in the video container metadata (Unix epoch in milliseconds).
   */
  creationTimeMs: number;
}

export interface TelemetryEnvelope {
  /**
   * Timestamp when the client recorded the file creation event (Unix epoch in milliseconds).
   */
  deviceTimestampMs: number;
  /**
   * Timestamp when the edge gateway accepted the upload transaction (Unix epoch in milliseconds).
   */
  gatewayTimestampMs: number;
}

export interface SanityCheckResult {
  /**
   * Flag indicating if the video complies with structural parameters.
   */
  isValid: boolean;
  /**
   * Reliability/authenticity rating (0 - 100).
   */
  confidenceScore: number;
  /**
   * Clock drift in milliseconds between video metadata and telemetry logs.
   */
  driftMs: number;
  /**
   * Reason codes indicating why verification checks failed.
   */
  flaggedReasons: string[];
}

export interface IStructuralSanityAnalyzer {
  /**
   * Evaluates the structural integrity, codec profiles, and temporal alignment of
   * the video upload against the signed telemetry envelope data.
   * 
   * @param metadata Extract file metadata properties from the video container.
   * @param telemetry The signed network telemetry envelope.
   */
  analyzeStructuralSanity(
    metadata: VideoMetadata,
    telemetry: TelemetryEnvelope
  ): SanityCheckResult;
}
