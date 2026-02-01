import { Badge } from '@/components/ui/badge';
import { Message } from '@/pages/PrivateMessenger';

interface MessageBubbleProps {
  message: Message;
  isSent: boolean;
}

export function MessageBubble({ message, isSent }: MessageBubbleProps) {
  return (
    <div className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] ${
          isSent ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700'
        } rounded-lg p-3`}
      >
        {/* Sender name (for received messages) */}
        {!isSent && (
          <div className="text-xs font-semibold mb-1 opacity-70">{message.from.slice(0, 8)}...</div>
        )}

        {/* Message content */}
        <div className="text-sm">{message.content}</div>

        {/* Message metadata */}
        <div className="flex items-center gap-1 mt-2 text-xs opacity-70 flex-wrap">
          {message.encrypted && (
            <Badge variant="secondary" className="text-xs">
              🔒 Encrypted
            </Badge>
          )}
          {message.delivered && isSent && (
            <Badge variant="secondary" className="text-xs">
              ✅ Delivered
            </Badge>
          )}
          {message.cost && isSent && (
            <Badge variant="secondary" className="text-xs">
              💰 {message.cost} M2M
            </Badge>
          )}
          <span className="ml-auto">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
