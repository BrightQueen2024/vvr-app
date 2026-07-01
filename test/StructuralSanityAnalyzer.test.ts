import { StructuralSanityAnalyzerImpl } from '../pipeline-ai/StructuralSanityAnalyzerImpl';
import { VideoMetadata, TelemetryEnvelope } from '../pipeline-ai/IStructuralSanityAnalyzer';

describe('StructuralSanityAnalyzer Anti-Tamper Unit Tests', () => {
  let analyzer: StructuralSanityAnalyzerImpl;

  const validMetadata: VideoMetadata = {
    durationSec: 150, // 2.5 minutes
    codec: 'h265',
    bitrateKbps: 1200, // 1.2 Mbps
    creationTimeMs: 1719810000000
  };

  const validTelemetry: TelemetryEnvelope = {
    deviceTimestampMs: 1719810000500, // 500ms difference (well within 2s)
    gatewayTimestampMs: 1719810020000 // 20s network latency
  };

  beforeEach(() => {
    analyzer = new StructuralSanityAnalyzerImpl(2000); // 2 seconds tolerance
  });

  describe('Valid Eyewitness Video Validation', () => {
    it('should approve valid transcoded H.265 videos matching telemetry clocks', () => {
      const result = analyzer.analyzeStructuralSanity(validMetadata, validTelemetry);

      expect(result.isValid).toBe(true);
      expect(result.confidenceScore).toBe(100);
      expect(result.driftMs).toBe(500);
      expect(result.flaggedReasons).toHaveLength(0);
    });

    it('should accept HEVC codec spelling variant', () => {
      const hevcMeta = { ...validMetadata, codec: 'HEVC' };
      const result = analyzer.analyzeStructuralSanity(hevcMeta, validTelemetry);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Container Metadata Checks', () => {
    it('should reject non-H.265/HEVC video codecs (e.g. H.264)', () => {
      const invalidMeta = { ...validMetadata, codec: 'h264' };
      const result = analyzer.analyzeStructuralSanity(invalidMeta, validTelemetry);

      expect(result.isValid).toBe(false);
      expect(result.confidenceScore).toBeLessThan(100);
      expect(result.flaggedReasons).toContainEqual(
        expect.stringContaining('INVALID_CODEC')
      );
    });

    it('should reject videos exceeding maximum 300s runtime limits', () => {
      const invalidMeta = { ...validMetadata, durationSec: 301 };
      const result = analyzer.analyzeStructuralSanity(invalidMeta, validTelemetry);

      expect(result.isValid).toBe(false);
      expect(result.flaggedReasons).toContainEqual(
        expect.stringContaining('DURATION_LIMIT_EXCEEDED')
      );
    });

    it('should reject video bitrates exceeding 1.5 Mbps ceiling', () => {
      const invalidMeta = { ...validMetadata, bitrateKbps: 1501 };
      const result = analyzer.analyzeStructuralSanity(invalidMeta, validTelemetry);

      expect(result.isValid).toBe(false);
      expect(result.flaggedReasons).toContainEqual(
        expect.stringContaining('BITRATE_LIMIT_EXCEEDED')
      );
    });
  });

  describe('Temporal Clock Consistency Checks', () => {
    it('should reject files with high clock drift between video metadata and device logs', () => {
      // 5 seconds drift (above 2s tolerance limit)
      const driftedTelemetry = {
        ...validTelemetry,
        deviceTimestampMs: validMetadata.creationTimeMs + 5000
      };

      const result = analyzer.analyzeStructuralSanity(validMetadata, driftedTelemetry);

      expect(result.isValid).toBe(false);
      expect(result.driftMs).toBe(5000);
      expect(result.flaggedReasons).toContainEqual(
        expect.stringContaining('TEMPORAL_CLOCK_DRIFT')
      );
    });

    it('should reject chronological anomalies where video was created after gateway ingestion', () => {
      const futureMetadata = {
        ...validMetadata,
        creationTimeMs: validTelemetry.gatewayTimestampMs + 10000 // 10s after gateway
      };

      const result = analyzer.analyzeStructuralSanity(futureMetadata, validTelemetry);

      expect(result.isValid).toBe(false);
      expect(result.confidenceScore).toBe(20); // 100 - 50 (chronological anomaly) - 30 (clock drift)
      expect(result.flaggedReasons).toContainEqual(
        expect.stringContaining('CHRONOLOGICAL_IMPOSSIBILITY')
      );
    });
  });
});
