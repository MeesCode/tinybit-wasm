export interface DirtyRect { x: number; y: number; w: number; h: number; }

export interface Patch {
    rect:   DirtyRect;
    before: Uint8Array;
    after:  Uint8Array;
}

export interface History {
    push(p: Patch): void;
    undo(apply: (p: Patch) => void): void;
    redo(apply: (p: Patch) => void): void;
    canUndo(): boolean;
    canRedo(): boolean;
    undoDepth(): number;
    redoDepth(): number;
    clear(): void;
}

export function makeHistory(cap: number): History {
    let undoStack: Patch[] = [];
    let redoStack: Patch[] = [];
    return {
        push(p) {
            undoStack.push(p);
            if (undoStack.length > cap) undoStack.shift();
            redoStack = [];
        },
        undo(apply) {
            const p = undoStack.pop();
            if (!p) return;
            apply(p);
            redoStack.push(p);
        },
        redo(apply) {
            const p = redoStack.pop();
            if (!p) return;
            apply(p);
            undoStack.push(p);
        },
        canUndo()    { return undoStack.length > 0; },
        canRedo()    { return redoStack.length > 0; },
        undoDepth()  { return undoStack.length; },
        redoDepth()  { return redoStack.length; },
        clear()      { undoStack = []; redoStack = []; },
    };
}
