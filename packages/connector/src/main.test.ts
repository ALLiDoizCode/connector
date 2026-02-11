jest.mock('./core/connector-node');
jest.mock('./utils/logger');

import { main } from './main';
import { ConnectorNode } from './core/connector-node';
import { createLogger } from './utils/logger';

describe('main.ts', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  };

  const mockConnectorNode = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createLogger as jest.Mock).mockReturnValue(mockLogger);
    (ConnectorNode as jest.Mock).mockImplementation(() => mockConnectorNode);
  });

  it('should export main function', () => {
    expect(typeof main).toBe('function');
  });

  it('should load config and start connector', async () => {
    await main();

    expect(createLogger).toHaveBeenCalledWith('connector-startup', expect.any(String));
    expect(ConnectorNode).toHaveBeenCalledWith(expect.any(String), mockLogger);
    expect(mockConnectorNode.start).toHaveBeenCalled();
  });
});
