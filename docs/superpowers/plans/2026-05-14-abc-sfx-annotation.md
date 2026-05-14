# `--@sfx` Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark scores in the editor as either music or SFX so the chip bar, capacity badges, and Play button match the channel the script will route through, surfacing the engine's true per-channel limits (music 400 notes/voice, SFX 10 notes/voice; both share 3 voices).

**Architecture:** Add a sibling annotation `--@sfx[: name]` parsed alongside `--@score[: name]`. `ScoreLink` gains a `kind: 'music' | 'sfx'` field and IDs become `<kind>:name:<name>` / `<kind>:anon:<line>` so the same name can coexist across kinds. The `ScoreTab` reads `kind` to (a) color the chip, (b) pick the note-cap for the badge, (c) route Play through `preview.music` or `preview.sfx`. A second "+ New SFX" button sits next to "+ New score". No engine changes.

**Tech Stack:** TypeScript, React, Vitest, CodeMirror 6, Zustand. All changes are inside `editor/src/score/` plus a small `editor/src/info/abcInfo.ts` doc update and a spec-doc refresh.

---

## File Structure

**Modify:**
- `editor/src/score/scoreLinks.ts` — add `kind`, broaden annotation regex, per-kind dup-name check, kind-encoded ids.
- `editor/src/score/scoreLinks.test.ts` — cover `--@sfx`, mixed scripts, dup-name scoping.
- `editor/src/score/abcCounts.ts` — add `SFX_MAX_NOTES`, kind-aware `notesCap` and `noteStatus`.
- `editor/src/score/abcCounts.test.ts` — cover kind-aware status thresholds.
- `editor/src/score/scoreSync.ts` — `insertNewScoreSnippet` takes a `kind`, emits the matching annotation + name prefix.
- `editor/src/score/scoreSync.test.ts` — cover sfx-kind insertion.
- `editor/src/score/ScoreTab.tsx` — chip color by kind, "+ New SFX" button, Play routing by kind, badge label/cap by kind.
- `editor/src/score/ScoreTab.test.tsx` — cover sfx routing and the new button.
- `editor/src/info/abcInfo.ts` — short section on `--@sfx` vs `--@score` and the per-channel limits.
- `docs/superpowers/specs/2026-05-13-abc-score-editor-design.md` — spec update for the new annotation.

No new files.

---

## Task 1: `scoreLinks` parses `--@sfx` and tags every link with `kind`

**Files:**
- Modify: `editor/src/score/scoreLinks.ts`
- Test:   `editor/src/score/scoreLinks.test.ts`

- [ ] **Step 1.1: Add the failing tests**

Add to `editor/src/score/scoreLinks.test.ts` (inside the existing `describe('findScores', …)`):

```ts
it('detects --@sfx followed by a literal and tags kind="sfx"', () => {
    const script = `--@sfx: jump\nlocal j = "c/4d/4e/4"\n`;
    const { links, diagnostics } = findScores(script);
    expect(diagnostics).toEqual([]);
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('sfx');
    expect(links[0].name).toBe('jump');
    expect(links[0].id).toBe('sfx:name:jump');
});

it('tags --@score links with kind="music"', () => {
    const script = `--@score: tune\nlocal t = [[K:C\nC\n]]\n`;
    const { links } = findScores(script);
    expect(links[0].kind).toBe('music');
    expect(links[0].id).toBe('music:name:tune');
});

it('allows same name across kinds without a duplicate diagnostic', () => {
    const script =
        `--@score: bass\nlocal a = [[K:C\nC\n]]\n` +
        `--@sfx: bass\nlocal b = "c"\n`;
    const { links, diagnostics } = findScores(script);
    expect(diagnostics).toEqual([]);
    expect(links.map((l) => l.id).sort()).toEqual(['music:name:bass', 'sfx:name:bass']);
});

it('still flags duplicates within the same kind', () => {
    const script =
        `--@sfx: hit\nlocal a = "c"\n` +
        `--@sfx: hit\nlocal b = "d"\n`;
    const { diagnostics } = findScores(script);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ kind: 'duplicate-name', name: 'hit' });
});

it('uses kind-prefixed anon ids when no name is given', () => {
    const script = `--@sfx\nlocal s = "c"\n`;
    const { links } = findScores(script);
    expect(links[0].id).toBe('sfx:anon:1');
});
```

- [ ] **Step 1.2: Run the new tests and confirm they fail**

Run: `cd editor && npx vitest run src/score/scoreLinks.test.ts`
Expected: 5 failures — `kind` undefined, ids missing `music:`/`sfx:` prefix, dup-check too eager.

- [ ] **Step 1.3: Implement `kind` and kind-scoped IDs**

In `editor/src/score/scoreLinks.ts`:

a) Add `kind` to `ScoreLink`:

```ts
export type ScoreKind = 'music' | 'sfx';

export interface ScoreLink {
    id: string;
    kind: ScoreKind;
    name?: string;
    annotationLine: number;
    contentRange: Range;
    openerRange: Range;
    closerRange: Range;
    form: ScoreForm;
    content: string;
}
```

b) Replace the annotation regex and the dup-name set inside `findScores`. The current line is:

```ts
const m = /^--\s*@score(?:\s*:\s*(\S+)?)?\s*$/.exec(lineSlice);
```

Replace with:

```ts
const m = /^--\s*@(score|sfx)(?:\s*:\s*(\S+)?)?\s*$/.exec(lineSlice);
```

c) The current capture group indices change: `m[1]` is now the kind, `m[2]` is the (optional) name. Update accordingly:

```ts
const kind: ScoreKind = m[1] === 'sfx' ? 'sfx' : 'music';
const rawName = m[2];
```

d) Make the dup-name set per-kind. Replace `const seenNames = new Set<string>();` near the top of `findScores` with:

```ts
const seenNames: Record<ScoreKind, Set<string>> = { music: new Set(), sfx: new Set() };
```

…and update the duplicate-check block to read from `seenNames[kind]`.

e) Change the id construction:

```ts
const id = name ? `${kind}:name:${name}` : `${kind}:anon:${annotationLine}`;
```

f) Add `kind` to the `links.push({...})` object literal.

- [ ] **Step 1.4: Run the file's tests; confirm pass**

Run: `cd editor && npx vitest run src/score/scoreLinks.test.ts`
Expected: all tests pass (existing + 5 new).

- [ ] **Step 1.5: Commit**

```bash
git add editor/src/score/scoreLinks.ts editor/src/score/scoreLinks.test.ts
git commit -m "score: parse --@sfx annotations and tag links with kind"
```

---

## Task 2: `abcCounts` exposes per-kind note cap and status

**Files:**
- Modify: `editor/src/score/abcCounts.ts`
- Test:   `editor/src/score/abcCounts.test.ts`

- [ ] **Step 2.1: Add the failing tests**

Append to `editor/src/score/abcCounts.test.ts`:

```ts
import { SFX_MAX_NOTES, notesCap, noteStatus } from './abcCounts';

describe('per-kind note caps', () => {
    it('exposes SFX_MAX_NOTES = 10 (engine limit from audio.c)', () => {
        expect(SFX_MAX_NOTES).toBe(10);
    });
    it('notesCap returns 400 for music, 10 for sfx', () => {
        expect(notesCap('music')).toBe(400);
        expect(notesCap('sfx')).toBe(10);
    });
    it('noteStatus uses the kind-specific cap', () => {
        expect(noteStatus(11, 'sfx')).toBe('over');
        expect(noteStatus(9,  'sfx')).toBe('warn'); // >=90% of 10 → 9
        expect(noteStatus(8,  'sfx')).toBe('ok');
        expect(noteStatus(11, 'music')).toBe('ok');
        expect(noteStatus(400, 'music')).toBe('ok');     // 400 itself is == cap, not over
        expect(noteStatus(401, 'music')).toBe('over');
    });
});
```

Note: the existing `noteStatus(notes: number)` single-arg form is being replaced — the existing tests need to be migrated to pass `'music'` explicitly. Update each existing call to `noteStatus(n)` in the file to `noteStatus(n, 'music')`. Do the same for `MUSIC_MAX_NOTES` usages already in the tests — they stay, but assertions that depended on the implicit "music" interpretation get an explicit kind arg.

- [ ] **Step 2.2: Run the file's tests and confirm failures**

Run: `cd editor && npx vitest run src/score/abcCounts.test.ts`
Expected: new tests fail (`SFX_MAX_NOTES is undefined`, `notesCap is not a function`, signature mismatch on `noteStatus`).

- [ ] **Step 2.3: Implement per-kind caps**

In `editor/src/score/abcCounts.ts`:

a) Add the SFX cap right after `MUSIC_MAX_NOTES`:

```ts
export const SFX_MAX_NOTES = 10;
```

b) Import the kind type at the top:

```ts
import type { ScoreKind } from './scoreLinks';
```

c) Add a `notesCap` helper and change `noteStatus` to take a kind:

```ts
export function notesCap(kind: ScoreKind): number {
    return kind === 'sfx' ? SFX_MAX_NOTES : MUSIC_MAX_NOTES;
}

export function noteStatus(notes: number, kind: ScoreKind): CountStatus {
    const cap = notesCap(kind);
    if (notes > cap) return 'over';
    if (notes >= Math.floor(cap * 0.9)) return 'warn';
    return 'ok';
}
```

(Replace the existing single-arg `noteStatus` entirely. `voiceStatus` is unchanged — both kinds share `MAX_VOICES = 3`.)

- [ ] **Step 2.4: Run abcCounts tests; confirm pass**

Run: `cd editor && npx vitest run src/score/abcCounts.test.ts`
Expected: all green.

- [ ] **Step 2.5: Commit**

```bash
git add editor/src/score/abcCounts.ts editor/src/score/abcCounts.test.ts
git commit -m "score: kind-aware noteStatus + SFX_MAX_NOTES from engine"
```

---

## Task 3: `scoreSync.insertNewScoreSnippet` takes a `kind`

**Files:**
- Modify: `editor/src/score/scoreSync.ts`
- Test:   `editor/src/score/scoreSync.test.ts`

- [ ] **Step 3.1: Add the failing tests**

Append to `editor/src/score/scoreSync.test.ts`:

```ts
describe('insertNewScoreSnippet (sfx kind)', () => {
    it('emits a --@sfx annotation with a quoted literal and an sfx_N name', () => {
        const { script: out, newLink } = insertNewScoreSnippet('', 0, 'sfx');
        expect(out).toContain('--@sfx: sfx_1');
        expect(out).toContain('local sfx_1 = "c/4d/4e/4"');
        expect(newLink.kind).toBe('sfx');
    });

    it('picks the next unused sfx_N when one already exists', () => {
        const start = `--@sfx: sfx_1\nlocal a = "c"\n`;
        const { script: out } = insertNewScoreSnippet(start, start.length, 'sfx');
        expect(out).toContain('--@sfx: sfx_2');
    });

    it('music and sfx name pools are independent', () => {
        // A music score named score_1 should not push the sfx counter past sfx_1.
        const start = `--@score: score_1\nlocal a = [[K:C\nC\n]]\n`;
        const { script: out } = insertNewScoreSnippet(start, start.length, 'sfx');
        expect(out).toContain('--@sfx: sfx_1');
    });
});
```

Also update the existing music-side tests to pass `'music'` explicitly to the new function signature, e.g.:

```ts
const result = insertNewScoreSnippet('', 0, 'music');
```

…wherever the test currently calls `insertNewScoreSnippet(script, cursor)`.

- [ ] **Step 3.2: Run; confirm failures**

Run: `cd editor && npx vitest run src/score/scoreSync.test.ts`
Expected: existing tests fail on the new required arg, new tests fail too.

- [ ] **Step 3.3: Implement kind-aware insertion**

Replace the body of `insertNewScoreSnippet` and the `TEMPLATE_BODY` constant in `editor/src/score/scoreSync.ts`:

```ts
import { findScores, type ScoreKind, type ScoreLink } from './scoreLinks';

const MUSIC_TEMPLATE_BODY = '\nL:1/4\nK:C\nC D E F |\n';
const SFX_TEMPLATE_BODY   = 'c/4d/4e/4';

export interface InsertResult {
    script: string;
    newLink: ScoreLink;
    cursor: number;
}

export function insertNewScoreSnippet(
    script: string,
    cursor: number,
    kind: ScoreKind,
): InsertResult {
    const name = nextUnusedName(script, kind);
    const annotation = kind === 'sfx' ? `--@sfx: ${name}` : `--@score: ${name}`;
    const body = kind === 'sfx'
        ? `local ${name} = "${SFX_TEMPLATE_BODY}"\n`
        : `local ${name} = [[${MUSIC_TEMPLATE_BODY}]]\n`;
    const lead = cursor > 0 && script[cursor - 1] !== '\n' ? '\n' : '';
    const snippet = `${lead}${annotation}\n${body}`;
    const newScript = script.slice(0, cursor) + snippet + script.slice(cursor);
    const newLink = findScores(newScript).links.find((l) => l.kind === kind && l.name === name);
    if (!newLink) throw new Error('insertNewScoreSnippet: failed to round-trip; this is a bug');
    return { script: newScript, newLink, cursor: newLink.contentRange.from };
}

function nextUnusedName(script: string, kind: ScoreKind): string {
    const prefix = kind === 'sfx' ? 'sfx' : 'score';
    const taken = new Set(
        findScores(script).links
            .filter((l) => l.kind === kind && l.name)
            .map((l) => l.name!) as string[]
    );
    for (let n = 1; n < 1000; n++) {
        const candidate = `${prefix}_${n}`;
        if (!taken.has(candidate)) return candidate;
    }
    return `${prefix}_${Date.now()}`;
}
```

- [ ] **Step 3.4: Run; confirm pass**

Run: `cd editor && npx vitest run src/score/scoreSync.test.ts`
Expected: green.

- [ ] **Step 3.5: Commit**

```bash
git add editor/src/score/scoreSync.ts editor/src/score/scoreSync.test.ts
git commit -m "score: insertNewScoreSnippet takes a kind, emits --@sfx or --@score"
```

---

## Task 4: `ScoreTab` UI reflects kind on chips, badge, button, Play

**Files:**
- Modify: `editor/src/score/ScoreTab.tsx`
- Test:   `editor/src/score/ScoreTab.test.tsx`

- [ ] **Step 4.1: Add the failing UI tests**

Append to `editor/src/score/ScoreTab.test.tsx`:

```ts
describe('ScoreTab — sfx scores', () => {
    const SFX_SCRIPT = '--@sfx: jump\nlocal j = "c/4d/4"\nsfx(j)\n';

    it('renders a chip for the sfx score', () => {
        useSketchStore.setState({ script: SFX_SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        expect(screen.getByRole('button', { name: /jump/i })).toBeInTheDocument();
    });

    it('routes Play through preview.sfx when the selected score is sfx-kind', () => {
        useSketchStore.setState({ script: SFX_SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /play/i }));
        expect(preview.sfx).toHaveBeenCalledTimes(1);
        expect(preview.music).not.toHaveBeenCalled();
    });

    it('shows the SFX 10-note cap in the badge when an sfx score is selected', () => {
        useSketchStore.setState({ script: SFX_SCRIPT });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        // Badge text reflects the SFX cap, not the music 400 cap.
        expect(screen.getByText(/\/10 notes/i)).toBeInTheDocument();
    });

    it('inserts a starter --@sfx snippet when "+ New SFX" is clicked', () => {
        useSketchStore.setState({ script: 'function _draw() end\n' });
        render(<ScoreTab preview={preview as any} previewAvailable />);
        fireEvent.click(screen.getByRole('button', { name: /\+ new sfx/i }));
        const updated = useSketchStore.getState().script;
        expect(updated).toContain('--@sfx: sfx_1');
    });
});
```

- [ ] **Step 4.2: Run; confirm fail**

Run: `cd editor && npx vitest run src/score/ScoreTab.test.tsx`
Expected: 4 new failures (no `/jump/i` chip, `preview.sfx` not called, `/10 notes/` not present, no `+ new sfx` button).

- [ ] **Step 4.3: Implement chip color, sfx button, kind-aware Play, kind-aware badge**

In `editor/src/score/ScoreTab.tsx`:

a) Add an SFX accent constant near the existing chip styles:

```ts
const SFX_ACCENT = '#0EA5E9';   // sky-500
const SFX_BG     = '#E0F2FE';   // sky-100
```

b) Replace `chipStyle(active: boolean)` with a kind-aware variant:

```ts
function chipStyle(active: boolean, kind: ScoreKind): CSSProperties {
    const accent = kind === 'sfx' ? SFX_ACCENT : '#ED225D';
    const activeBg = kind === 'sfx' ? SFX_BG : '#FDE4EF';
    return {
        padding: '3px 8px', fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
        borderRadius: 999, border: '1px solid ' + (active ? accent : '#ECECF0'),
        background: active ? activeBg : '#FFFFFF', color: active ? accent : '#181820',
        cursor: 'pointer',
    };
}
```

…and update the chip-render call site to pass `l.kind`:

```tsx
<button key={l.id}
    type="button"
    style={chipStyle(l.id === selectedId, l.kind)}
    onClick={() => setSelected(l.id)}>
    {l.name ?? `(anon @ line ${l.annotationLine})`}
</button>
```

c) Add a second create button. Right after the existing `newScoreBtn`:

```ts
const newSfxBtn: CSSProperties = {
    marginLeft: 4, padding: '3px 10px', fontSize: 11, fontWeight: 600,
    borderRadius: 999, border: '1px solid ' + SFX_ACCENT,
    background: SFX_ACCENT, color: '#FFFFFF', cursor: 'pointer',
};
```

…and refactor `handleNewScore` to accept a kind, then render both buttons:

```ts
const handleCreate = useCallback((kind: 'music' | 'sfx') => {
    flushWriteback();
    const current = useSketchStore.getState().script;
    const { script: newScript, newLink } = insertNewScoreSnippet(current, current.length, kind);
    setScript(newScript);
    setSelected(newLink.id);
}, [flushWriteback, setScript, setSelected]);
```

```tsx
<button type="button" style={newScoreBtn} onClick={() => handleCreate('music')}>+ New score</button>
<button type="button" style={newSfxBtn}   onClick={() => handleCreate('sfx')}>+ New SFX</button>
```

d) Make Play route by kind:

```ts
const handlePlay = useCallback(async () => {
    if (!selectedLink) return;
    onBeforePreview?.();
    try {
        if (selectedLink.kind === 'sfx') await preview.sfx(buffer);
        else                              await preview.music(buffer);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        consoleAppend('error', `Score preview failed: ${msg}`);
    }
}, [preview, selectedLink, buffer, consoleAppend, onBeforePreview]);
```

e) Make the note-count badge use the selected kind's cap. The current code reads:

```tsx
const counts = useMemo(() => countAbc(buffer), [buffer]);
const nStatus = noteStatus(counts.notes);
```

Replace with:

```tsx
const counts = useMemo(() => countAbc(buffer), [buffer]);
const kind: ScoreKind = selectedLink?.kind ?? 'music';
const nStatus = noteStatus(counts.notes, kind);
const cap     = notesCap(kind);
```

…and update the badge JSX so the cap and title text reference `cap`:

```tsx
<span
    style={countBadgeStyle(nStatus)}
    title={nStatus === 'over' ? `Over engine limit of ${cap} notes per voice` : `Notes (max ${cap} per voice)`}>
    {counts.notes}/{cap} notes
</span>
```

f) Update the import line at the top:

```ts
import { countAbc, noteStatus, voiceStatus, notesCap, MAX_VOICES, type CountStatus } from './abcCounts';
import type { ScoreKind } from './scoreLinks';
```

(Drop `MUSIC_MAX_NOTES` from the import; it's no longer referenced in this file.)

- [ ] **Step 4.4: Run all score tests; confirm pass**

Run: `cd editor && npx vitest run src/score`
Expected: all 60+ tests green.

- [ ] **Step 4.5: Smoke-test in the browser**

Run: `./scripts/dev.sh` and in the Score tab:
- Click "+ New SFX" → a blue chip "sfx_1" appears, badge reads "X/10 notes", script gains `--@sfx: sfx_1`.
- Click "+ New score" → a pink chip "score_1" appears, badge reads "X/400 notes".
- Select the sfx chip and click Play → SFX channel plays (one-shot, short).
- Type past 10 notes in the sfx editor → badge turns red.

- [ ] **Step 4.6: Commit**

```bash
git add editor/src/score/ScoreTab.tsx editor/src/score/ScoreTab.test.tsx
git commit -m "score: ScoreTab routes Play and caps by selected score's kind"
```

---

## Task 5: Document the new annotation in the help modal

**Files:**
- Modify: `editor/src/info/abcInfo.ts`

- [ ] **Step 5.1: Add a section on `--@score` vs `--@sfx`**

Append a new section to the `ABC_SECTIONS` array in `editor/src/info/abcInfo.ts`:

```ts
{
    title: 'Music vs SFX scores',
    body: [
        { text: 'A score annotated --@score is played through music(), which loops and has room for up to 400 notes per voice.' },
        { text: 'A score annotated --@sfx is played through sfx(), which is one-shot and is limited to 10 notes per voice.' },
        { text: 'Both kinds share 3 voices. The note-count badge in the Score tab reflects the limit of the kind you are editing.' },
        { text: 'Example of a short SFX phrase:', abc: 'L:1/8\nK:C\nc/4d/4e/4g/4' },
    ],
},
```

- [ ] **Step 5.2: Sanity-check the modal renders**

Run: `cd editor && npx vitest run src/info`
Expected: green. (`AbcInfoModal.test.tsx` iterates sections defensively.)

- [ ] **Step 5.3: Commit**

```bash
git add editor/src/info/abcInfo.ts
git commit -m "info: document --@sfx annotation and per-channel limits"
```

---

## Task 6: Refresh the spec doc

**Files:**
- Modify: `docs/superpowers/specs/2026-05-13-abc-score-editor-design.md`

- [ ] **Step 6.1: Locate and update the *Annotation syntax* section**

In that file, find the section that introduces the `--@score` annotation (around line 65). Add a short subsection after the existing example:

```markdown
### Music vs SFX scores

A score may be annotated with either `--@score` (music channel; up to 400 notes per voice, looped via `music(...)`) or `--@sfx` (SFX channel; up to 10 notes per voice, one-shot via `sfx(...)`). Both share 3 voices. The annotation determines the chip color in the Score tab, the note-count cap shown by the editor's badge, and which `tb_preview_*_play` export the Play button routes through. Names are unique per kind: `--@score: bass` and `--@sfx: bass` may coexist.
```

If the section already mentions `sfx` example code in passing, leave the example alone — just add the explicit subsection above.

- [ ] **Step 6.2: Commit**

```bash
git add docs/superpowers/specs/2026-05-13-abc-score-editor-design.md
git commit -m "docs: spec covers --@sfx annotation"
```

---

## Final verification

- [ ] **Step F.1: Full test sweep**

Run: `cd editor && npx vitest run`
Expected: all suites green.

- [ ] **Step F.2: Typecheck**

Run: `cd editor && npx tsc --noEmit`
Expected: clean.

- [ ] **Step F.3: Browser smoke**

Run: `./scripts/dev.sh`. Confirm in the Score tab:
- music chip is pink, sfx chip is blue
- selecting an sfx score changes the note cap badge to `/10`
- Play on an sfx score uses the SFX channel (short, no loop)
- "+ New SFX" inserts `--@sfx: sfx_N` with a quoted-string literal
- name collisions across kinds are allowed (`--@score: bass` + `--@sfx: bass` produces no diagnostic)
