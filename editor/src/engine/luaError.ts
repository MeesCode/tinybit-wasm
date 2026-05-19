export interface LuaError {
    line: number | null;
    message: string;
    rawMessage: string;
    traceback: string | null;
}

const PREFIX_RE = /^script:(\d+):\s*/;

export function parseLuaError(rawMessage: string, traceback: string | null): LuaError {
    const m = PREFIX_RE.exec(rawMessage);
    if (m) {
        return {
            line: Number.parseInt(m[1], 10),
            message: rawMessage.slice(m[0].length),
            rawMessage,
            traceback,
        };
    }
    return { line: null, message: rawMessage, rawMessage, traceback };
}

export function formatLuaError(err: LuaError): string {
    const head = err.line !== null
        ? `Lua error at line ${err.line}: ${err.message}`
        : `Lua error: ${err.message}`;
    if (!err.traceback) return head;
    const indented = err.traceback
        .split('\n')
        .map((line) => '  ' + (line.startsWith('\t') ? '  ' + line.slice(1) : line))
        .join('\n');
    return `${head}\n${indented}`;
}
