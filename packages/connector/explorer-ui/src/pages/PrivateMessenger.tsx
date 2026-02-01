import { useState, useCallback, useEffect } from 'react';
import { ContactSidebar } from '@/components/ContactSidebar';
import { MessageList } from '@/components/MessageList';
import { MessageComposer } from '@/components/MessageComposer';
import { EncryptionInspector } from '@/components/EncryptionInspector';
import { RoutingVisualization } from '@/components/RoutingVisualization';
import { useKeyManager } from '@/hooks/useKeyManager';
import { useMessageReceiver, type ReceivedMessage } from '@/hooks/useMessageReceiver';
import { useRouteAnimation } from '@/hooks/useRouteAnimation';
import { type Event as NostrEvent, type UnsignedEvent } from 'nostr-tools/pure';

export interface Contact {
  pubkey: string;
  npub: string;
  ilpAddress: string;
  name?: string;
  online: boolean;
  messageCount: number;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  encrypted: boolean;
  delivered: boolean;
  cost?: number; // In M2M tokens (Aptos Testnet)
  direction: 'sent' | 'received';
}

const CONTACTS_STORAGE_KEY = 'messenger-contacts';
const MESSAGES_STORAGE_KEY = 'messenger-messages';

export default function PrivateMessenger() {
  const { privateKey, publicKey } = useKeyManager();

  // Load contacts from localStorage
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const stored = localStorage.getItem(CONTACTS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Load messages from localStorage
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = localStorage.getItem(MESSAGES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  // Store encryption details for EncryptionInspector
  const [encryptionDetails, setEncryptionDetails] = useState<{
    giftwrap: NostrEvent;
    seal: NostrEvent;
    rumor: UnsignedEvent;
  } | null>(null);

  // Routing animation state
  const { routeData, startAnimation, completeAnimation } = useRouteAnimation();

  // Persist contacts to localStorage
  useEffect(() => {
    localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  }, [contacts]);

  // Persist messages to localStorage
  useEffect(() => {
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  // Handle received messages via WebSocket
  const handleMessageReceived = useCallback(
    (receivedMessage: ReceivedMessage) => {
      const newMessage: Message = {
        id: crypto.randomUUID(),
        from: receivedMessage.from,
        to: publicKey || '',
        content: receivedMessage.content,
        timestamp: receivedMessage.timestamp,
        encrypted: true,
        delivered: true,
        direction: 'received',
      };

      setMessages((prev) => [...prev, newMessage]);
    },
    [publicKey]
  );

  const { isConnected } = useMessageReceiver(privateKey, handleMessageReceived);

  // Handle sent messages
  const handleSendMessage = useCallback(
    async ({
      giftwrap,
      seal,
      rumor,
      plaintextMessage,
      result,
    }: {
      giftwrap: NostrEvent;
      seal: NostrEvent;
      rumor: UnsignedEvent;
      plaintextMessage: string;
      result: { success: boolean };
    }) => {
      if (!selectedContact || !publicKey) return;

      // Store encryption details for inspector
      setEncryptionDetails({ giftwrap, seal, rumor });

      // Start routing animation (show initial state)
      startAnimation(selectedContact.name || selectedContact.npub, 300);

      // Send to X402 gateway
      try {
        const response = await fetch('http://localhost:3002/api/route-giftwrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            giftwrap,
            recipient: selectedContact.ilpAddress,
            amount: 300,
          }),
        });

        if (!response.ok) throw new Error('Failed to send message');

        const gatewayResult = await response.json();

        // Complete animation (mark all hops as done, show ILP Fulfill proof)
        completeAnimation(gatewayResult.latency || 4200);

        const newMessage: Message = {
          id: crypto.randomUUID(),
          from: publicKey,
          to: selectedContact.pubkey,
          content: plaintextMessage,
          timestamp: Date.now(),
          encrypted: true,
          delivered: result.success,
          cost: 300,
          direction: 'sent',
        };

        setMessages((prev) => [...prev, newMessage]);
      } catch (error) {
        console.error('Send failed:', error);
        // Animation remains in "processing" state to show error

        // Still add message as failed
        const newMessage: Message = {
          id: crypto.randomUUID(),
          from: publicKey,
          to: selectedContact.pubkey,
          content: plaintextMessage,
          timestamp: Date.now(),
          encrypted: true,
          delivered: false,
          cost: 300,
          direction: 'sent',
        };

        setMessages((prev) => [...prev, newMessage]);
      }
    },
    [selectedContact, publicKey, startAnimation, completeAnimation]
  );

  // Handle adding new contact
  const handleAddContact = useCallback((newContact: Contact) => {
    setContacts((prev) => [...prev, newContact]);
  }, []);

  return (
    <div className="h-screen flex dark">
      {/* Left Sidebar */}
      <ContactSidebar
        contacts={contacts}
        selectedContact={selectedContact}
        onSelectContact={setSelectedContact}
        onAddContact={handleAddContact}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        {selectedContact && (
          <div className="border-b p-4">
            <h2 className="font-semibold">
              Chat with {selectedContact.name || selectedContact.npub}
            </h2>
            <div className="text-sm flex items-center gap-2">
              {isConnected ? (
                <>
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-green-600">Connected</span>
                </>
              ) : (
                <>
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="text-red-600">Disconnected</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Message List */}
        <MessageList
          messages={messages.filter(
            (m) => m.from === selectedContact?.pubkey || m.to === selectedContact?.pubkey
          )}
          currentUserPubkey={publicKey || ''}
        />

        {/* Message Composer */}
        {selectedContact && (
          <div className="border-t p-4">
            <MessageComposer
              recipient={selectedContact}
              onSend={handleSendMessage}
              privateKey={privateKey}
            />

            {/* Encryption Inspector (only shows when message has been sent) */}
            {encryptionDetails && (
              <div className="mt-4">
                <EncryptionInspector
                  giftwrap={encryptionDetails.giftwrap}
                  seal={encryptionDetails.seal}
                  rumor={encryptionDetails.rumor}
                  yourPubkey={publicKey || ''}
                  recipientPubkey={selectedContact.pubkey}
                  recipientName={selectedContact.name}
                />
              </div>
            )}

            {/* Routing Visualization (below Encryption Inspector) */}
            {routeData && (
              <div className="mt-4">
                <RoutingVisualization route={routeData} />
              </div>
            )}
          </div>
        )}

        {!selectedContact && (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Select a contact to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}
