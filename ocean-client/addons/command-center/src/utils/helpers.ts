import { StoredSettings } from "./store";
import { Message } from "./telegram";

export function isNullOrEmpty(value: string): boolean {
    return value === undefined || value.length === 0
}

export function checkSafetyOf(message: Message, settings: StoredSettings): boolean {
    let lastExecutedMessageId = settings.lastExecutedMessageId ?? 0
    return message.id > lastExecutedMessageId && // only execute new messages
            message.username === settings.username && // only messages of the configured user
            message.chat_id === settings.chatId && // only from configured chat
            !message.is_bot // message should not come from a bot
}