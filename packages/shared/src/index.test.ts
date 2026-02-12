import { version } from './index';

describe('shared package', () => {
  it('should export version', () => {
    expect(version).toBe('1.0.0');
  });
});
