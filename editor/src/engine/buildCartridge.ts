import { EncodeError, type Encoder } from './encoder';
import { getPlaceholderCover, getPlaceholderSprite } from './placeholders';

export interface SketchInput {
    script: string;
    sprite: Uint8Array | null;
    cover:  Uint8Array | null;
    title:  string;
    author: string;
}

export type BuildResult =
    | { ok: true;  bytes: Uint8Array }
    | { ok: false; error: string };

export async function buildCartridge(enc: Encoder, s: SketchInput): Promise<BuildResult> {
    const sprite = s.sprite ?? await getPlaceholderSprite();
    const cover  = s.cover  ?? await getPlaceholderCover();
    try {
        const bytes = enc.encode({
            script: new TextEncoder().encode(s.script),
            sprite,
            cover,
            title:  s.title  || 'untitled',
            author: s.author || '',
        });
        return { ok: true, bytes };
    } catch (err) {
        if (err instanceof EncodeError) {
            return { ok: false, error: `Encode failed (${err.code}): ${err.message}` };
        }
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
