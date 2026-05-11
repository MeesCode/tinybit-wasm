import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { LanguageSupport } from '@codemirror/language';

export function luaLang(): LanguageSupport {
    return new LanguageSupport(StreamLanguage.define(lua));
}
