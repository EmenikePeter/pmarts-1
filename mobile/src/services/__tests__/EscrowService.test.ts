/// <reference types="jest" />
import * as EscrowService from '../EscrowService';

// Mock piSDK to provide a current user with access token
jest.mock('../PiSDKService', () => ({
  __esModule: true,
  default: {
    getCurrentUser: () => ({ uid: 'test-user', accessToken: 'tok-123' }),
  },
}));

describe('EscrowService.refundEscrow', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('sends refund request and returns success when API responds ok', async () => {
    expect.assertions(3);

    global.fetch = jest.fn(async (url: any, opts: any) => {
      // ensure endpoint is called
      expect(String(url)).toContain('/api/escrow/v2/refund');

      // check body contains escrowId and userId
      const body = JSON.parse(opts.body);
      expect(body.escrowId).toBe('esc-123');

      return {
        ok: true,
        json: async () => ({ refundRequest: { id: 'r1', status: 'pending' } }),
      } as any;
    });

    const res = await EscrowService.refundEscrow('esc-123', 'non_delivery', {
      justification: 'This item never arrived and I tried contacting the vendor.',
      evidenceUrls: ['https://example.com/e1.jpg'],
      contactAttempted: true,
    });

    expect(res.success).toBe(true);
  });
});
