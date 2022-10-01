import { StoredSettings } from '../../store'

const defaultStoredSettings: StoredSettings = {
  chatId: 'some-test-chat-id',
  token: 'some-test-token',
  lastExecutedMessageId: 42,
  username: 'some-test-user',
  states: [],
}

export function createDefaultStoredSettings(): StoredSettings {
  return createCustomStoredSettings({})
}

export function createCustomStoredSettings(customValues: Partial<StoredSettings>): StoredSettings {
  return { ...defaultStoredSettings, ...customValues }
}
