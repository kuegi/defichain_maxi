import { StoredSettings } from "./store";
import { Message } from "./telegram";

export function isNullOrEmpty(value: string): boolean {
    return value === undefined || value.length === 0
}

export function checkSafetyOf(message: Message, settings: StoredSettings): boolean {
    // TODO: other checks like username, chat-id
    let lastExecutedMessageId = settings.lastExecutedMessageId ?? 0
    return message.id > lastExecutedMessageId
}