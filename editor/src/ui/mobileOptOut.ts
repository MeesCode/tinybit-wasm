export const MOBILE_OPT_OUT_KEY = 'tinybit:editor-on-mobile';

export function readMobileEditorOptOut(): boolean {
    try {
        return sessionStorage.getItem(MOBILE_OPT_OUT_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeMobileEditorOptOut(): void {
    try {
        sessionStorage.setItem(MOBILE_OPT_OUT_KEY, '1');
    } catch {
        // Storage may be unavailable (private mode, quota, security policy).
        // Failure mode: landing screen shows again — the safer fallback.
    }
}
