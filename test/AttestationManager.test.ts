import { AttestationManagerImpl } from '../core-crypto/AttestationManagerImpl';
import { INativeAttestationBridge } from '../core-crypto/INativeAttestationBridge';

describe('AttestationManager Security Unit Tests', () => {
  let mockBridge: jest.Mocked<INativeAttestationBridge>;
  let manager: AttestationManagerImpl;

  beforeEach(() => {
    mockBridge = {
      getPlatformName: jest.fn().mockReturnValue('android'),
      fetchHardwareToken: jest.fn().mockResolvedValue('mock-attestation-jwt-token')
    };
    manager = new AttestationManagerImpl(mockBridge);
  });

  describe('CSPRNG Nonce Generation', () => {
    it('should generate a cryptographically secure 256-bit (64 hex characters) nonce', () => {
      const nonce1 = manager.generateNonce();
      const nonce2 = manager.generateNonce();

      expect(nonce1).toHaveLength(64);
      expect(nonce2).toHaveLength(64);
      expect(nonce1).not.toBe(nonce2); // Entropy assertion
      expect(/^[0-9a-fA-F]+$/.test(nonce1)).toBe(true); // Hex format validation
    });
  });

  describe('Zero-Trust Header Generation & Delegation', () => {
    it('should correctly fetch and wrap attestation parameters for Android platform', async () => {
      mockBridge.getPlatformName.mockReturnValue('android');
      mockBridge.fetchHardwareToken.mockResolvedValue('android-play-integrity-token');

      const headers = await manager.getSecureHeaders();

      expect(mockBridge.getPlatformName).toHaveBeenCalled();
      expect(mockBridge.fetchHardwareToken).toHaveBeenCalledWith(headers['X-VVR-Nonce']);
      
      expect(headers).toEqual({
        'X-VVR-Attestation-Token': 'android-play-integrity-token',
        'X-VVR-Nonce': expect.any(String),
        'X-VVR-Timestamp': expect.any(String),
        'X-VVR-Platform': 'android'
      });
    });

    it('should correctly fetch and wrap attestation parameters for iOS platform', async () => {
      mockBridge.getPlatformName.mockReturnValue('ios');
      mockBridge.fetchHardwareToken.mockResolvedValue('ios-app-attest-token');

      const headers = await manager.getSecureHeaders();

      expect(mockBridge.getPlatformName).toHaveBeenCalled();
      expect(mockBridge.fetchHardwareToken).toHaveBeenCalledWith(headers['X-VVR-Nonce']);
      
      expect(headers).toEqual({
        'X-VVR-Attestation-Token': 'ios-app-attest-token',
        'X-VVR-Nonce': expect.any(String),
        'X-VVR-Timestamp': expect.any(String),
        'X-VVR-Platform': 'ios'
      });
    });

    it('should throw an error and refuse execution if platform is unsupported', async () => {
      mockBridge.getPlatformName.mockReturnValue('unsupported');

      await expect(manager.getSecureHeaders()).rejects.toThrow(
        'Zero-Trust Policy Violation: Current hardware platform is unsupported.'
      );
      expect(mockBridge.fetchHardwareToken).not.toHaveBeenCalled();
    });
  });

  describe('Replay Prevention (Monotonic Rising Timestamp)', () => {
    it('should enforce strictly increasing timestamps even when system clock is frozen', async () => {
      const fixedTime = 1719810000000; // Mock fixed epoch millisecond
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const headers1 = await manager.getSecureHeaders();
      const headers2 = await manager.getSecureHeaders();
      const headers3 = await manager.getSecureHeaders();

      const time1 = parseInt(headers1['X-VVR-Timestamp'], 10);
      const time2 = parseInt(headers2['X-VVR-Timestamp'], 10);
      const time3 = parseInt(headers3['X-VVR-Timestamp'], 10);

      expect(time1).toBe(fixedTime);
      expect(time2).toBe(fixedTime + 1); // Strictly incremented
      expect(time3).toBe(fixedTime + 2); // Strictly incremented
      expect(time3).toBeGreaterThan(time2);
      expect(time2).toBeGreaterThan(time1);

      dateSpy.mockRestore();
    });
  });

  describe('Error Resilience', () => {
    it('should propagate descriptive error when native hardware bridge fails', async () => {
      mockBridge.fetchHardwareToken.mockRejectedValue(new Error('Play Integrity API not available'));

      await expect(manager.getSecureHeaders()).rejects.toThrow(
        'Device attestation failed: Play Integrity API not available'
      );
    });

    it('should throw error if native hardware bridge returns empty/whitespace tokens', async () => {
      mockBridge.fetchHardwareToken.mockResolvedValue('   ');

      await expect(manager.getSecureHeaders()).rejects.toThrow(
        'Device attestation failed: Empty attestation token received from hardware bridge'
      );
    });
  });
});
