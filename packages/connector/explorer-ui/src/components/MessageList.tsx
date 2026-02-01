import { useRef, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from '@/components/MessageBubble';
import { Message } from '@/pages/PrivateMessenger';

interface MessageListProps {
  messages: Message[];
  currentUserPubkey: string;
}

export function MessageList({ messages, currentUserPubkey }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom on new message
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <ScrollArea className="flex-1 p-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-500">
          <div className="text-center">
            <p className="text-lg">No messages yet</p>
            <p className="text-sm">Send your first encrypted message!</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isSent={message.from === currentUserPubkey}
            />
          ))}
          <div ref={scrollRef} />
        </div>
      )}
    </ScrollArea>
  );
}
