import { useState } from 'react';
// Card components removed - KeyManager has its own Card
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { KeyManager } from '@/components/KeyManager';
import { Contact } from '@/pages/PrivateMessenger';
import { Plus } from 'lucide-react';
import { decode } from 'nostr-tools/nip19';

interface ContactSidebarProps {
  contacts: Contact[];
  selectedContact: Contact | null;
  onSelectContact: (contact: Contact) => void;
  onAddContact: (contact: Contact) => void;
}

export function ContactSidebar({
  contacts,
  selectedContact,
  onSelectContact,
  onAddContact,
}: ContactSidebarProps) {
  const [isAddContactOpen, setIsAddContactOpen] = useState(false);
  const [newContactNpub, setNewContactNpub] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactIlpAddress, setNewContactIlpAddress] = useState('');

  const handleAddNewContact = () => {
    if (!newContactNpub.trim() || !newContactIlpAddress.trim()) return;

    try {
      // Convert npub to pubkey using nostr-tools Bech32 decoding
      const decoded = decode(newContactNpub);

      if (decoded.type !== 'npub') {
        alert('Invalid npub format. Please enter a valid npub address.');
        return;
      }

      const pubkey = decoded.data as string;

      const newContact: Contact = {
        pubkey,
        npub: newContactNpub,
        ilpAddress: newContactIlpAddress,
        name: newContactName || undefined,
        online: false,
        messageCount: 0,
      };

      onAddContact(newContact);
      setIsAddContactOpen(false);
      setNewContactNpub('');
      setNewContactName('');
      setNewContactIlpAddress('');
    } catch (error) {
      alert('Failed to decode npub. Please check the format and try again.');
      console.error('npub decode error:', error);
    }
  };

  return (
    <div className="w-72 min-w-72 border-r h-full flex flex-col">
      {/* Key Manager Section */}
      <div className="p-2">
        <KeyManager />
      </div>

      {/* Contacts List */}
      <div className="flex-1 overflow-hidden">
        <div className="px-2 py-1 font-semibold text-sm">💬 Conversations</div>
        <ScrollArea className="h-full">
          {contacts.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No contacts yet. Add a contact to start messaging.
            </div>
          ) : (
            contacts.map((contact) => (
              <div
                key={contact.pubkey}
                onClick={() => onSelectContact(contact)}
                className={`p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  selectedContact?.pubkey === contact.pubkey ? 'bg-blue-50 dark:bg-blue-950' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Avatar>
                    <AvatarFallback>
                      {contact.name?.[0] || contact.npub.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {contact.name || contact.npub.slice(0, 12) + '...'}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {contact.messageCount} message{contact.messageCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <Badge variant={contact.online ? 'default' : 'secondary'} className="text-xs">
                    {contact.online ? '🟢' : '🔴'}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Add New Contact Button */}
      <div className="p-2 border-t">
        <Dialog open={isAddContactOpen} onOpenChange={setIsAddContactOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full gap-2">
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Contact npub (required)</label>
                <Input
                  placeholder="npub1..."
                  value={newContactNpub}
                  onChange={(e) => setNewContactNpub(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">ILP Address (required)</label>
                <Input
                  placeholder="g.agent.alice"
                  value={newContactIlpAddress}
                  onChange={(e) => setNewContactIlpAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Display Name (optional)</label>
                <Input
                  placeholder="Alice"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddContactOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAddNewContact}
                disabled={!newContactNpub.trim() || !newContactIlpAddress.trim()}
              >
                Add Contact
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
