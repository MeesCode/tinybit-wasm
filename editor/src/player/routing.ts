export type Route =
    | { kind: 'editor' }
    | { kind: 'player' };

export function pickRoute(search: string): Route {
    const params = new URLSearchParams(search);
    if (!params.has('play')) return { kind: 'editor' };
    return { kind: 'player' };
}
