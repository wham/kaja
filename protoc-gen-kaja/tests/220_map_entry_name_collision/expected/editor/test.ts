/**
 * A message whose name "Entry" is a suffix of the synthetic map entry
 * type name "SettingsEntry". This triggers a bug in findMessageType
 * where HasSuffix matching finds this Entry instead of Config.SettingsEntry.
 */
export interface Entry {
    key: string;
    value: string;
}

export interface Config {
    settings: { [key: string]: string };
    entries: { [key: number]: Entry };
    label: string;
}
