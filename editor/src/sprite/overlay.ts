import type { Zoom } from './viewport';
import type { OverlayMode } from '../state/spriteEditorStore';

export interface OverlayPlan {
    showCellGrid:     boolean;
    showPixelGrid:    boolean;
    cellGridAlpha:    number;
    pixelGridAlpha:   number;
    showCellNumbers:  boolean;
    showPixelNumbers: boolean;
    gutterTop:        number;
    gutterLeft:       number;
}

export function computeOverlay(zoom: Zoom, gridMode: OverlayMode, numbersMode: OverlayMode): OverlayPlan {
    const autoCellGrid = zoom >= 4;
    const autoPixelGrid = zoom >= 8;
    const autoCellNumbers = zoom >= 8;
    const autoPixelNumbers = zoom >= 24;

    const showCellGrid     = gridMode    === 'off' ? false : gridMode    === 'on' ? true : autoCellGrid;
    const showPixelGrid    = gridMode    === 'off' ? false : gridMode    === 'on' ? zoom >= 4 : autoPixelGrid;
    const showCellNumbers  = numbersMode === 'off' ? false : numbersMode === 'on' ? true : autoCellNumbers;
    const showPixelNumbers = numbersMode === 'off' ? false : numbersMode === 'on' ? zoom >= 12 : autoPixelNumbers;

    const cellGridAlpha  = zoom >= 12 ? 0.35 : 0.25;
    const pixelGridAlpha = zoom >= 12 ? 0.15 : 0.08;
    const gutterTop  = showCellNumbers ? (showPixelNumbers ? 24 : 16) : 0;
    const gutterLeft = showCellNumbers ? (showPixelNumbers ? 26 : 18) : 0;

    return { showCellGrid, showPixelGrid, cellGridAlpha, pixelGridAlpha, showCellNumbers, showPixelNumbers, gutterTop, gutterLeft };
}

export interface DrawOverlayInput {
    ctx: CanvasRenderingContext2D;
    canvasW: number;
    canvasH: number;
    plan: OverlayPlan;
    spriteRect: { x: number; y: number; w: number; h: number };
    zoom: Zoom;
}

export function drawOverlay({ ctx, canvasW, canvasH, plan, spriteRect, zoom }: DrawOverlayInput): void {
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (plan.showPixelGrid) {
        ctx.strokeStyle = `rgba(0,0,0,${plan.pixelGridAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 128; i++) {
            const x = spriteRect.x + i * zoom + 0.5;
            ctx.moveTo(x, spriteRect.y);
            ctx.lineTo(x, spriteRect.y + spriteRect.h);
            const y = spriteRect.y + i * zoom + 0.5;
            ctx.moveTo(spriteRect.x, y);
            ctx.lineTo(spriteRect.x + spriteRect.w, y);
        }
        ctx.stroke();
    }
    if (plan.showCellGrid) {
        ctx.strokeStyle = `rgba(0,0,0,${plan.cellGridAlpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
            const x = spriteRect.x + i * 8 * zoom + 0.5;
            ctx.moveTo(x, spriteRect.y);
            ctx.lineTo(x, spriteRect.y + spriteRect.h);
            const y = spriteRect.y + i * 8 * zoom + 0.5;
            ctx.moveTo(spriteRect.x, y);
            ctx.lineTo(spriteRect.x + spriteRect.w, y);
        }
        ctx.stroke();
    }
    if (plan.showCellNumbers) {
        ctx.fillStyle = '#6B6B76';
        ctx.font = '10px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 16; i++) {
            const num = (i * 8).toString();
            const x = spriteRect.x + i * 8 * zoom + (8 * zoom) / 2;
            ctx.textAlign = 'center';
            ctx.fillText(num, x, spriteRect.y - 8);
            const y = spriteRect.y + i * 8 * zoom + (8 * zoom) / 2;
            ctx.textAlign = 'right';
            ctx.fillText(num, spriteRect.x - 4, y);
        }
    }
    if (plan.showPixelNumbers) {
        ctx.fillStyle = '#A0A0AA';
        ctx.font = '8px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < 128; i++) {
            const x = spriteRect.x + i * zoom + zoom / 2;
            ctx.textAlign = 'center';
            ctx.fillText(i.toString(), x, spriteRect.y - 20);
            const y = spriteRect.y + i * zoom + zoom / 2;
            ctx.textAlign = 'right';
            ctx.fillText(i.toString(), spriteRect.x - 16, y);
        }
    }
}
