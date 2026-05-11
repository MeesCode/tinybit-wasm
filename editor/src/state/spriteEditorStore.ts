import { create } from 'zustand';
import { snapAllChannels } from '../sprite/color';
import { makeHistory, type Patch } from '../sprite/history';
import { anchoredZoom, type Zoom } from '../sprite/viewport';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';
export type PencilSize = 1 | 2 | 3 | 4 | 8;
export type OverlayMode = 'auto' | 'on' | 'off';

export interface SpriteEditorState {
    tool: Tool;
    pencilSize: PencilSize;
    zoom: Zoom;
    pan: { x: number; y: number };
    color: number;
    recent: number[];
    showGrid: OverlayMode;
    showNumbers: OverlayMode;

    undoDepth: number;
    redoDepth: number;

    setTool(t: Tool): void;
    setPencilSize(n: PencilSize): void;
    setZoom(z: Zoom, anchor?: { sx: number; sy: number; canvasW: number; canvasH: number }): void;
    setPan(p: { x: number; y: number }): void;
    setColor(rgba: number): void;
    setOverlay(which: 'grid' | 'numbers', mode: OverlayMode): void;
    pushPatch(p: Patch): void;
    undo(apply: (p: Patch) => void): void;
    redo(apply: (p: Patch) => void): void;
    reset(): void;
}

const initial = {
    tool: 'pencil' as Tool,
    pencilSize: 1 as PencilSize,
    zoom: 8 as Zoom,
    pan: { x: 0, y: 0 },
    color: 0x000000FF,
    recent: [] as number[],
    showGrid: 'auto' as OverlayMode,
    showNumbers: 'auto' as OverlayMode,
    undoDepth: 0,
    redoDepth: 0,
};

const RECENT_CAP = 12;

export const useSpriteEditorStore = create<SpriteEditorState>((set, get) => {
    const history = makeHistory(50);

    return {
        ...initial,
        setTool(t)       { set({ tool: t }); },
        setPencilSize(n) { set({ pencilSize: n }); },
        setZoom(z, anchor) {
            const cur = get();
            if (!anchor) { set({ zoom: z }); return; }
            const v = anchoredZoom({ zoom: cur.zoom, pan: cur.pan }, z, anchor);
            set({ zoom: v.zoom, pan: v.pan });
        },
        setPan(p) { set({ pan: p }); },
        setColor(rgba) {
            const snapped = (snapAllChannels(rgba) >>> 0);
            const recent = [rgba, ...get().recent.filter((c) => c !== rgba)].slice(0, RECENT_CAP);
            set({ color: snapped, recent });
        },
        setOverlay(which, mode) {
            set(which === 'grid' ? { showGrid: mode } : { showNumbers: mode });
        },
        pushPatch(p) {
            history.push(p);
            set({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });
        },
        undo(apply) {
            history.undo(apply);
            set({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });
        },
        redo(apply) {
            history.redo(apply);
            set({ undoDepth: history.undoDepth(), redoDepth: history.redoDepth() });
        },
        reset() { history.clear(); set(initial); },
    };
});
