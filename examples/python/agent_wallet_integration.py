"""
Agent Wallet Integration Example - Python

Complete example showing how to integrate agent wallets via HTTP API.
Covers wallet creation, funding, balance tracking, and payment channels.

Requirements:
    pip install requests

Note: This example uses HTTP API calls since the agent wallet system
is implemented in TypeScript/Node.js. Python clients interact via REST API.
"""

import requests
import time
import json
from typing import Dict, List, Optional
from dataclasses import dataclass


# Configuration
API_BASE_URL = "http://localhost:3000/api/v1"
API_TIMEOUT = 30


@dataclass
class AgentWallet:
    """Agent wallet data structure"""
    agent_id: str
    evm_address: str
    xrp_address: str
    derivation_index: int
    created_at: str
    status: str


@dataclass
class AgentBalance:
    """Agent balance data structure"""
    agent_id: str
    chain: str
    token: str
    balance: int
    decimals: int
    last_updated: str


@dataclass
class AgentChannel:
    """Agent payment channel data structure"""
    id: str
    agent_id: str
    peer_id: str
    chain: str
    token: str
    balance: int
    initial_amount: int
    payments_count: int
    status: str


class AgentWalletClient:
    """Python client for Agent Wallet HTTP API"""

    def __init__(self, base_url: str = API_BASE_URL):
        self.base_url = base_url
        self.session = requests.Session()

    def create_wallet(self, agent_id: str) -> AgentWallet:
        """Create a new agent wallet"""
        response = self.session.post(
            f"{self.base_url}/wallets",
            json={"agentId": agent_id},
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        data = response.json()

        return AgentWallet(
            agent_id=data['agentId'],
            evm_address=data['evmAddress'],
            xrp_address=data['xrpAddress'],
            derivation_index=data['derivationIndex'],
            created_at=data['createdAt'],
            status=data['status']
        )

    def get_wallet(self, agent_id: str) -> Optional[AgentWallet]:
        """Get existing agent wallet"""
        response = self.session.get(
            f"{self.base_url}/wallets/{agent_id}",
            timeout=API_TIMEOUT
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        data = response.json()

        return AgentWallet(
            agent_id=data['agentId'],
            evm_address=data['evmAddress'],
            xrp_address=data['xrpAddress'],
            derivation_index=data['derivationIndex'],
            created_at=data['createdAt'],
            status=data['status']
        )

    def get_all_balances(self, agent_id: str) -> List[AgentBalance]:
        """Get all balances for an agent"""
        response = self.session.get(
            f"{self.base_url}/wallets/{agent_id}/balances",
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        data = response.json()

        return [
            AgentBalance(
                agent_id=b['agentId'],
                chain=b['chain'],
                token=b['token'],
                balance=int(b['balance']),
                decimals=b['decimals'],
                last_updated=b['lastUpdated']
            )
            for b in data['balances']
        ]

    def get_balance(self, agent_id: str, chain: str, token: str) -> int:
        """Get specific balance for an agent"""
        response = self.session.get(
            f"{self.base_url}/wallets/{agent_id}/balances/{chain}/{token}",
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        data = response.json()
        return int(data['balance'])

    def open_channel(
        self,
        agent_id: str,
        peer_id: str,
        chain: str,
        token: str,
        amount: int
    ) -> str:
        """Open a payment channel"""
        response = self.session.post(
            f"{self.base_url}/channels",
            json={
                "agentId": agent_id,
                "peerId": peer_id,
                "chain": chain,
                "token": token,
                "amount": str(amount)  # BigInt as string
            },
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        data = response.json()
        return data['channelId']

    def send_payment(self, agent_id: str, channel_id: str, amount: int) -> None:
        """Send payment through channel"""
        response = self.session.post(
            f"{self.base_url}/channels/{channel_id}/payments",
            json={
                "agentId": agent_id,
                "amount": str(amount)
            },
            timeout=API_TIMEOUT
        )
        response.raise_for_status()

    def close_channel(self, agent_id: str, channel_id: str) -> None:
        """Close a payment channel"""
        response = self.session.delete(
            f"{self.base_url}/channels/{channel_id}",
            json={"agentId": agent_id},
            timeout=API_TIMEOUT
        )
        response.raise_for_status()

    def get_agent_channels(self, agent_id: str) -> List[AgentChannel]:
        """Get all channels for an agent"""
        response = self.session.get(
            f"{self.base_url}/wallets/{agent_id}/channels",
            timeout=API_TIMEOUT
        )
        response.raise_for_status()
        data = response.json()

        return [
            AgentChannel(
                id=c['id'],
                agent_id=c['agentId'],
                peer_id=c['peerId'],
                chain=c['chain'],
                token=c['token'],
                balance=int(c['balance']),
                initial_amount=int(c['initialAmount']),
                payments_count=c['paymentsCount'],
                status=c['status']
            )
            for c in data['channels']
        ]


def format_balance(balance: int, decimals: int) -> str:
    """Format balance for human-readable output"""
    divisor = 10 ** decimals
    whole = balance // divisor
    fraction = balance % divisor
    return f"{whole}.{str(fraction).zfill(decimals)}"


def example_1_create_wallet():
    """Example 1: Create and Initialize Agent Wallet"""
    client = AgentWalletClient()

    print("=== Example 1: Create Agent Wallet ===")

    try:
        # Create new agent wallet
        wallet = client.create_wallet("agent-001")

        print(f"Agent wallet created:")
        print(f"  Agent ID: {wallet.agent_id}")
        print(f"  EVM Address: {wallet.evm_address}")
        print(f"  XRP Address: {wallet.xrp_address}")
        print(f"  Status: {wallet.status}")

        # Wait for wallet to become active
        while wallet.status == "pending":
            print(f"Waiting for wallet activation...")
            time.sleep(5)
            wallet = client.get_wallet(wallet.agent_id)

        print(f"Wallet is now active!")
        return wallet

    except requests.HTTPError as e:
        print(f"Wallet creation failed: {e}")
        raise


def example_2_check_balances(agent_id: str):
    """Example 2: Check Wallet Balances"""
    client = AgentWalletClient()

    print(f"\n=== Example 2: Check Balances for {agent_id} ===")

    try:
        # Get all balances
        balances = client.get_all_balances(agent_id)

        print(f"Agent has {len(balances)} balances:")
        for balance in balances:
            formatted = format_balance(balance.balance, balance.decimals)
            print(f"  {balance.chain.upper()} {balance.token}: {formatted}")
            print(f"    Raw: {balance.balance} (decimals: {balance.decimals})")

        return balances

    except requests.HTTPError as e:
        print(f"Balance check failed: {e}")
        raise


def example_3_payment_channel(agent_id: str, peer_id: str):
    """Example 3: Open Payment Channel and Send Payments"""
    client = AgentWalletClient()

    print(f"\n=== Example 3: Payment Channel ===")

    try:
        # Open payment channel with 1000 USDC
        print(f"Opening payment channel from {agent_id} to {peer_id}")
        channel_id = client.open_channel(
            agent_id=agent_id,
            peer_id=peer_id,
            chain="evm",
            token="USDC",
            amount=1000000000  # 1000 USDC (6 decimals)
        )

        print(f"Payment channel opened: {channel_id}")

        # Send multiple micropayments
        for i in range(1, 11):
            client.send_payment(
                agent_id=agent_id,
                channel_id=channel_id,
                amount=10000000  # 10 USDC per payment
            )
            print(f"Payment {i}/10 sent: 10 USDC")

        # Get channel details
        channels = client.get_agent_channels(agent_id)
        channel = next((c for c in channels if c.id == channel_id), None)

        if channel:
            print(f"\nChannel status:")
            print(f"  Channel ID: {channel.id}")
            print(f"  Remaining balance: {format_balance(channel.balance, 6)} USDC")
            print(f"  Payments sent: {channel.payments_count}")

        # Close channel
        print(f"\nClosing payment channel...")
        client.close_channel(agent_id, channel_id)
        print(f"Channel closed and settled")

    except requests.HTTPError as e:
        print(f"Payment channel operation failed: {e}")
        raise


def example_4_error_handling(agent_id: str):
    """Example 4: Error Handling Patterns"""
    client = AgentWalletClient()

    print(f"\n=== Example 4: Error Handling ===")

    try:
        # Attempt to create wallet
        wallet = client.create_wallet(agent_id)
        print(f"Wallet created: {agent_id}")
        return wallet

    except requests.HTTPError as e:
        if e.response.status_code == 409:  # Conflict - already exists
            print(f"Wallet already exists, retrieving existing wallet")
            return client.get_wallet(agent_id)

        elif e.response.status_code == 429:  # Rate limit
            print(f"Rate limit exceeded, waiting 60 seconds...")
            time.sleep(60)
            raise

        elif e.response.status_code == 500:  # Server error
            error_data = e.response.json()
            if "master-seed not found" in error_data.get("error", ""):
                print(f"Master seed not initialized - contact administrator")
                raise Exception("System configuration error")
            raise

        else:
            print(f"Unknown error: {e}")
            raise


def example_5_batch_operations():
    """Example 5: Batch Wallet Creation"""
    client = AgentWalletClient()
    agent_ids = ["agent-batch-001", "agent-batch-002", "agent-batch-003"]

    print(f"\n=== Example 5: Batch Wallet Creation ===")

    try:
        print(f"Creating {len(agent_ids)} wallets...")

        wallets = []
        for agent_id in agent_ids:
            try:
                wallet = client.create_wallet(agent_id)
                wallets.append(wallet)
                print(f"  Created: {wallet.agent_id}")
            except requests.HTTPError as e:
                if e.response.status_code == 409:
                    print(f"  Skipped (already exists): {agent_id}")
                else:
                    raise

        print(f"\nBatch creation complete: {len(wallets)} wallets created")
        return wallets

    except requests.HTTPError as e:
        print(f"Batch wallet creation failed: {e}")
        raise


def complete_lifecycle_example():
    """Complete agent lifecycle example"""
    agent_id = "agent-example-001"
    peer_id = "agent-example-002"

    print("\n" + "=" * 60)
    print("=== COMPLETE AGENT LIFECYCLE EXAMPLE ===")
    print("=" * 60)

    try:
        # Step 1: Create wallet
        print("\nStep 1: Creating agent wallet...")
        wallet = example_1_create_wallet()

        # Step 2: Check balances
        print("\nStep 2: Checking wallet balances...")
        example_2_check_balances(agent_id)

        # Step 3: Payment channel operations
        print("\nStep 3: Payment channel operations...")
        example_3_payment_channel(agent_id, peer_id)

        # Step 4: Error handling demonstration
        print("\nStep 4: Error handling demonstration...")
        example_4_error_handling("agent-error-001")

        # Step 5: Batch operations
        print("\nStep 5: Batch wallet operations...")
        example_5_batch_operations()

        print("\n" + "=" * 60)
        print("=== COMPLETE LIFECYCLE EXAMPLE FINISHED SUCCESSFULLY ===")
        print("=" * 60)

    except Exception as e:
        print(f"\nLifecycle example failed: {e}")
        raise


if __name__ == "__main__":
    # Run complete lifecycle example
    complete_lifecycle_example()
