import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WalletOverview } from './WalletOverview';
import type { WalletBalances } from '@/lib/event-types';

describe('WalletOverview', () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    windowOpenSpy.mockRestore();
  });

  describe('Header Explorer Links', () => {
    it('should render EVM address with explorer link', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: null,
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // Verify address is clickable (link rendered)
      const addressElement = getByText('0x742d...bEb0').closest('a');
      expect(addressElement).toHaveAttribute(
        'href',
        'https://sepolia.basescan.org/address/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      );
      expect(addressElement).toHaveAttribute('target', '_blank');
      expect(addressElement).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should render XRP address with explorer link', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR',
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: '100',
        aptBalance: null,
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // Verify XRP address is clickable
      const addressElement = getByText('r3rfPz...AkpR').closest('a');
      expect(addressElement).toHaveAttribute(
        'href',
        'https://testnet.xrpl.org/accounts/r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR'
      );
    });

    it('should open explorer URL in new tab when EVM address clicked', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: null,
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      const addressElement = getByText('0x742d...bEb0').closest('a');
      if (addressElement) {
        fireEvent.click(addressElement);
        expect(windowOpenSpy).toHaveBeenCalledWith(
          'https://sepolia.basescan.org/address/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
          '_blank',
          'noopener,noreferrer'
        );
      }
    });
  });

  describe('EVM Channel Explorer Links', () => {
    it('should render EVM channel IDs with explorer links', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: null,
        evmChannels: [
          {
            channelId: '0xabc123def456789012345678901234567890abcd',
            peerAddress: '0x1234567890123456789012345678901234567890',
            deposit: '5.0',
            transferredAmount: '2.5',
            status: 'opened',
          },
        ],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // Verify channel ID is clickable
      const channelIdElement = getByText('0xabc1...abcd').closest('a');
      expect(channelIdElement).toHaveAttribute(
        'href',
        'https://sepolia.basescan.org/address/0xabc123def456789012345678901234567890abcd'
      );

      // Verify peer address is clickable
      const peerElement = getByText('0x1234...7890').closest('a');
      expect(peerElement).toHaveAttribute(
        'href',
        'https://sepolia.basescan.org/address/0x1234567890123456789012345678901234567890'
      );
    });

    it('should open Base Sepolia Etherscan when EVM channel ID clicked', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: null,
        evmChannels: [
          {
            channelId: '0xabc123def456789012345678901234567890abcd',
            peerAddress: '0x1234567890123456789012345678901234567890',
            deposit: '5.0',
            transferredAmount: '2.5',
            status: 'opened',
          },
        ],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      const channelIdElement = getByText('0xabc1...abcd').closest('a');
      if (channelIdElement) {
        fireEvent.click(channelIdElement);
        expect(windowOpenSpy).toHaveBeenCalledWith(
          'https://sepolia.basescan.org/address/0xabc123def456789012345678901234567890abcd',
          '_blank',
          'noopener,noreferrer'
        );
      }
    });
  });

  describe('XRP Channel Explorer Links', () => {
    it('should render XRP destination addresses with explorer links', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR',
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: '100',
        aptBalance: null,
        evmChannels: [],
        xrpChannels: [
          {
            channelId: 'ABCD1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
            destination: 'rN7n7otQDd6FczFgLdkqtyMVrn3HMfgnGi',
            amount: '1000',
            balance: '500',
            status: 'open',
          },
        ],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // Verify destination is clickable
      const destElement = getByText('rN7n7o...gnGi').closest('a');
      expect(destElement).toHaveAttribute(
        'href',
        'https://testnet.xrpl.org/accounts/rN7n7otQDd6FczFgLdkqtyMVrn3HMfgnGi'
      );

      // Verify channel ID links to wallet's XRP address (fallback)
      const channelIdElement = getByText('ABCD12...90AB').closest('a');
      expect(channelIdElement).toHaveAttribute(
        'href',
        'https://testnet.xrpl.org/accounts/r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR'
      );
    });

    it('should open XRP Testnet Explorer when destination clicked', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR',
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: '100',
        aptBalance: null,
        evmChannels: [],
        xrpChannels: [
          {
            channelId: 'ABCD1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
            destination: 'rN7n7otQDd6FczFgLdkqtyMVrn3HMfgnGi',
            amount: '1000',
            balance: '500',
            status: 'open',
          },
        ],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      const destElement = getByText('rN7n7o...gnGi').closest('a');
      if (destElement) {
        fireEvent.click(destElement);
        expect(windowOpenSpy).toHaveBeenCalledWith(
          'https://testnet.xrpl.org/accounts/rN7n7otQDd6FczFgLdkqtyMVrn3HMfgnGi',
          '_blank',
          'noopener,noreferrer'
        );
      }
    });
  });

  describe('Aptos Explorer Links', () => {
    it('should render Aptos address with explorer link', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a',
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: '50',
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // Verify Aptos address is clickable
      const addressElement = getByText('0xb206...5b6a').closest('a');
      expect(addressElement).toHaveAttribute(
        'href',
        'https://explorer.aptoslabs.com/account/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a?network=testnet'
      );
    });

    it('should render Aptos channel IDs with explorer links', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a',
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: '50',
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [
          {
            channelId: '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
            peerAddress: '0xc3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4',
            deposit: '10.0',
            transferredAmount: '5.0',
            status: 'active',
          },
        ],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // Verify channel ID is clickable
      const channelIdElement = getByText('0xa1b2...a1b2').closest('a');
      expect(channelIdElement).toHaveAttribute(
        'href',
        'https://explorer.aptoslabs.com/account/0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2?network=testnet'
      );

      // Verify peer address is clickable
      const peerElement = getByText('0xc3d4...c3d4').closest('a');
      expect(peerElement).toHaveAttribute(
        'href',
        'https://explorer.aptoslabs.com/account/0xc3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4?network=testnet'
      );
    });

    it('should open Aptos Explorer when address clicked', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a',
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: '50',
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      const addressElement = getByText('0xb206...5b6a').closest('a');
      if (addressElement) {
        fireEvent.click(addressElement);
        expect(windowOpenSpy).toHaveBeenCalledWith(
          'https://explorer.aptoslabs.com/account/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a?network=testnet',
          '_blank',
          'noopener,noreferrer'
        );
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should render as link when explorerUrl is provided via getExplorerUrl', () => {
      const mockData: WalletBalances = {
        agentId: 'agent-0',
        evmAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        xrpAddress: null,
        aptosAddress: null,
        ethBalance: '1.5',
        agentTokenBalance: '1000',
        xrpBalance: null,
        aptBalance: null,
        evmChannels: [],
        xrpChannels: [],
        aptosChannels: [],
      };

      const { getByText } = render(
        <WalletOverview data={mockData} lastUpdated={Date.now()} onRefresh={() => {}} />
      );

      // All addresses should be links (explorerUrl is always provided via getExplorerUrl)
      const addressElement = getByText('0x742d...bEb0');
      expect(addressElement.closest('a')).toBeInTheDocument();
    });
  });
});
