export type PlayerMode = 'current' | 'gallery';

export type Route =
    | { kind: 'editor' }
    | { kind: 'player'; mode: PlayerMode };

export function pickRoute(search: string): Route {
    const params = new URLSearchParams(search);
    if (!params.has('play')) return { kind: 'editor' };
    const v = params.get('play');
    if (v === 'current') return { kind: 'player', mode: 'current' };
    return { kind: 'player', mode: 'gallery' };
}
