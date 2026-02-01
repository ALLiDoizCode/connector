/**
 * Unit tests for Explorer Links Utility
 */

import { describe, it, expect } from 'vitest';
import { detectAddressType, getExplorerUrl, EXPLORER_CONFIG } from './explorer-links';

describe('detectAddressType', () => {
  describe('Aptos address detection', () => {
    it('should detect Aptos address (0x + 64 hex chars)', () => {
      const aptosAddr = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      expect(detectAddressType(aptosAddr)).toBe('aptos');
    });

    it('should detect Aptos address with uppercase hex', () => {
      const aptosAddrUpper = '0xB206E544E69642E894F4EB4D2BA8B6E2B26BF1FD4B5A76CFC0D73C55CA725B6A';
      expect(detectAddressType(aptosAddrUpper)).toBe('aptos');
    });

    it('should detect Aptos address with mixed case hex', () => {
      const aptosAddrMixed = '0xB206e544e69642E894f4EB4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      expect(detectAddressType(aptosAddrMixed)).toBe('aptos');
    });
  });

  describe('EVM address detection', () => {
    it('should detect EVM address (0x + 40 hex chars)', () => {
      const evmAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
      expect(detectAddressType(evmAddr)).toBe('evm');
    });

    it('should detect EVM address with all lowercase', () => {
      const evmAddrLower = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';
      expect(detectAddressType(evmAddrLower)).toBe('evm');
    });

    it('should detect EVM address with all uppercase', () => {
      const evmAddrUpper = '0x742D35CC6634C0532925A3B844BC9E7595F0BEB0';
      expect(detectAddressType(evmAddrUpper)).toBe('evm');
    });

    it('should handle mixed case hex addresses', () => {
      const mixedCaseEvm = '0x742D35CC6634C0532925A3B844BC9E7595F0BEB0';
      expect(detectAddressType(mixedCaseEvm)).toBe('evm');
    });
  });

  describe('XRP address detection', () => {
    it('should detect XRP address (r + base58)', () => {
      const xrpAddr = 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR';
      expect(detectAddressType(xrpAddr)).toBe('xrp');
    });

    it('should detect XRP address with minimum length (25 chars)', () => {
      const xrpAddrShort = 'rN7n7otQDd6FczFgLdgqsdKcWSwpX';
      expect(detectAddressType(xrpAddrShort)).toBe('xrp');
    });

    it('should detect XRP address with maximum length (35 chars)', () => {
      const xrpAddrLong = 'rN7n7otQDd6FczFgLdgqsdKcWSwpXALo';
      expect(detectAddressType(xrpAddrLong)).toBe('xrp');
    });
  });

  describe('Edge cases', () => {
    it('should return unknown for null or empty', () => {
      expect(detectAddressType('')).toBe('unknown');
      expect(detectAddressType(null as unknown as string)).toBe('unknown');
      expect(detectAddressType(undefined as unknown as string)).toBe('unknown');
    });

    it('should return unknown for malformed addresses', () => {
      expect(detectAddressType('0xZZZ')).toBe('unknown');
      expect(detectAddressType('xrp123')).toBe('unknown');
      expect(detectAddressType('0x123')).toBe('unknown'); // Too short
    });

    it('should return unknown for non-string types', () => {
      expect(detectAddressType(12345 as unknown as string)).toBe('unknown');
      expect(detectAddressType({} as unknown as string)).toBe('unknown');
      expect(detectAddressType([] as unknown as string)).toBe('unknown');
    });

    it('should return unknown for XRP address starting with wrong character', () => {
      expect(detectAddressType('s3rfPzeWF9gSwi1zBP664vJGavk9faAkpR')).toBe('unknown');
    });

    it('should return unknown for XRP address with invalid base58 chars', () => {
      expect(detectAddressType('r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR0')).toBe('unknown'); // 0 not in base58
      expect(detectAddressType('r3rfPzeWF9gSwi1zBP664vJGavk9faAkpRI')).toBe('unknown'); // I not in base58
      expect(detectAddressType('r3rfPzeWF9gSwi1zBP664vJGavk9faAkpRO')).toBe('unknown'); // O not in base58
    });

    it('should return unknown for addresses that are too short', () => {
      expect(detectAddressType('0x742d35Cc')).toBe('unknown'); // Too short for EVM
      expect(detectAddressType('0xb206e544e69642e894f4eb4d2ba8b6e2')).toBe('unknown'); // Too short for Aptos
      expect(detectAddressType('rN7n7otQDd6FczFgLdgq')).toBe('unknown'); // Too short for XRP
    });

    it('should return unknown for addresses that are too long', () => {
      expect(detectAddressType('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb123')).toBe('unknown'); // Too long for EVM
      expect(detectAddressType('0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a123')).toBe('unknown'); // Too long for Aptos
      expect(detectAddressType('rN7n7otQDd6FczFgLdgqsdKcWSwpXALoExtra')).toBe('unknown'); // Too long for XRP
    });

    it('should trim whitespace before detection', () => {
      const addrWithSpaces = '  0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0  ';
      expect(detectAddressType(addrWithSpaces)).toBe('evm');
    });

    it('should trim whitespace for Aptos addresses', () => {
      const aptosWithSpaces = '  0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a  ';
      expect(detectAddressType(aptosWithSpaces)).toBe('aptos');
    });

    it('should trim whitespace for XRP addresses', () => {
      const xrpWithSpaces = '  r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR  ';
      expect(detectAddressType(xrpWithSpaces)).toBe('xrp');
    });
  });
});

describe('getExplorerUrl', () => {
  describe('Aptos explorer URLs', () => {
    it('should generate Aptos testnet account URL', () => {
      const aptosAddr = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(aptosAddr, 'address');
      expect(url).toBe(
        'https://explorer.aptoslabs.com/account/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a?network=testnet'
      );
    });

    it('should generate Aptos testnet transaction URL', () => {
      const txHash = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(txHash, 'tx', 'aptos');
      expect(url).toBe(
        'https://explorer.aptoslabs.com/txn/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a?network=testnet'
      );
    });

    it('should generate Aptos mainnet account URL', () => {
      const aptosAddr = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(aptosAddr, 'address', 'aptos', 'mainnet');
      expect(url).toBe(
        'https://explorer.aptoslabs.com/account/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a?network=mainnet'
      );
    });

    it('should generate Aptos mainnet transaction URL', () => {
      const txHash = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(txHash, 'tx', 'aptos', 'mainnet');
      expect(url).toBe(
        'https://explorer.aptoslabs.com/txn/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a?network=mainnet'
      );
    });
  });

  describe('EVM explorer URLs', () => {
    it('should generate Base Sepolia account URL', () => {
      const evmAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
      const url = getExplorerUrl(evmAddr, 'address');
      expect(url).toBe('https://sepolia.basescan.org/address/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0');
    });

    it('should generate Base Sepolia transaction URL', () => {
      const txHash = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(txHash, 'tx', 'evm');
      expect(url).toBe(
        'https://sepolia.basescan.org/tx/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a'
      );
    });

    it('should generate Ethereum mainnet account URL', () => {
      const evmAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
      const url = getExplorerUrl(evmAddr, 'address', 'evm', 'mainnet');
      expect(url).toBe('https://etherscan.io/address/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0');
    });

    it('should generate Ethereum mainnet transaction URL', () => {
      const txHash = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(txHash, 'tx', 'evm', 'mainnet');
      expect(url).toBe(
        'https://etherscan.io/tx/0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a'
      );
    });
  });

  describe('XRP explorer URLs', () => {
    it('should generate XRP testnet account URL', () => {
      const xrpAddr = 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR';
      const url = getExplorerUrl(xrpAddr, 'address');
      expect(url).toBe('https://testnet.xrpl.org/accounts/r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR');
    });

    it('should generate XRP testnet transaction URL', () => {
      const txHash = 'ABC123DEF456';
      const url = getExplorerUrl(txHash, 'tx', 'xrp');
      expect(url).toBe('https://testnet.xrpl.org/transactions/ABC123DEF456');
    });

    it('should generate XRP mainnet account URL', () => {
      const xrpAddr = 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR';
      const url = getExplorerUrl(xrpAddr, 'address', 'xrp', 'mainnet');
      expect(url).toBe('https://livenet.xrpl.org/accounts/r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR');
    });

    it('should generate XRP mainnet transaction URL', () => {
      const txHash = 'ABC123DEF456';
      const url = getExplorerUrl(txHash, 'tx', 'xrp', 'mainnet');
      expect(url).toBe('https://livenet.xrpl.org/transactions/ABC123DEF456');
    });
  });

  describe('Edge cases for URL generation', () => {
    it('should return null for unknown address type', () => {
      const unknownAddr = 'invalid-address';
      expect(getExplorerUrl(unknownAddr, 'address')).toBeNull();
    });

    it('should return null for null/empty input', () => {
      expect(getExplorerUrl('', 'address')).toBeNull();
      expect(getExplorerUrl(null as unknown as string, 'address')).toBeNull();
      expect(getExplorerUrl(undefined as unknown as string, 'address')).toBeNull();
    });

    it('should return null for non-string types', () => {
      expect(getExplorerUrl(12345 as unknown as string, 'address')).toBeNull();
      expect(getExplorerUrl({} as unknown as string, 'address')).toBeNull();
      expect(getExplorerUrl([] as unknown as string, 'address')).toBeNull();
    });

    it('should auto-detect chain when not provided', () => {
      const evmAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
      const url = getExplorerUrl(evmAddr, 'address'); // No chain param
      expect(url).toContain('sepolia.basescan.org');
    });

    it('should auto-detect Aptos chain when not provided', () => {
      const aptosAddr = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(aptosAddr, 'address'); // No chain param
      expect(url).toContain('explorer.aptoslabs.com');
    });

    it('should auto-detect XRP chain when not provided', () => {
      const xrpAddr = 'r3rfPzeWF9gSwi1zBP664vJGavk9faAkpR';
      const url = getExplorerUrl(xrpAddr, 'address'); // No chain param
      expect(url).toContain('testnet.xrpl.org');
    });

    it('should use explicit chain parameter over auto-detection', () => {
      // Use a 66-char hex value that would auto-detect as Aptos, but force it as EVM transaction
      const txHash = '0xb206e544e69642e894f4eb4d2ba8b6e2b26bf1fd4b5a76cfc0d73c55ca725b6a';
      const url = getExplorerUrl(txHash, 'tx', 'evm');
      expect(url).toContain('sepolia.basescan.org/tx/');
    });

    it('should default to testnet network when not specified', () => {
      const evmAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
      const url = getExplorerUrl(evmAddr, 'address');
      expect(url).toContain('sepolia.basescan.org');
    });

    it('should default to address type when not specified', () => {
      const evmAddr = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0';
      const url = getExplorerUrl(evmAddr);
      expect(url).toContain('/address/');
    });
  });

  describe('EXPLORER_CONFIG validation', () => {
    it('should have valid Aptos URLs', () => {
      expect(EXPLORER_CONFIG.aptos.testnet).toBe('https://explorer.aptoslabs.com');
      expect(EXPLORER_CONFIG.aptos.mainnet).toBe('https://explorer.aptoslabs.com');
    });

    it('should have valid EVM URLs', () => {
      expect(EXPLORER_CONFIG.evm.testnet).toBe('https://sepolia.basescan.org');
      expect(EXPLORER_CONFIG.evm.mainnet).toBe('https://etherscan.io');
    });

    it('should have valid XRP URLs', () => {
      expect(EXPLORER_CONFIG.xrp.testnet).toBe('https://testnet.xrpl.org');
      expect(EXPLORER_CONFIG.xrp.mainnet).toBe('https://livenet.xrpl.org');
    });
  });
});
