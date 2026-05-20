import { useState, type CSSProperties, type RefObject } from 'react';
import { shellLayout, PLAYER_BUTTONS, PLAYER_BUTTON_IDX, type PlayerButton } from './shellLayout';
import { usePointerButton } from './usePointerButton';

export interface PlayerShellProps {
    canvasRef:   RefObject<HTMLCanvasElement>;
    onSetButton(idx: number, pressed: boolean): void;
    onExit():    void;
    onReset():   void;
}

const TOPBAR_H = 48;

const wrapStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100dvh',
    overflow: 'hidden',
    background: '#181820',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    display: 'flex',
    flexDirection: 'column',
};

const topbarStyle: CSSProperties = {
    flexShrink: 0,
    height: TOPBAR_H,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    gap: 8,
    background: '#181820',
};

const topButtonStyle: CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
};

const contentAreaStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const innerStyle = (aspect: number): CSSProperties => ({
    // Largest rectangle with the image's aspect that fits in the area below
    // the top bar. Width and height are clamped together so the aspect never
    // breaks, keeping hitbox %-coords aligned with the painted-on buttons.
    position: 'relative',
    width:  `min(100vw, calc((100dvh - ${TOPBAR_H}px) * ${aspect}))`,
    height: `min(calc(100dvh - ${TOPBAR_H}px), calc(100vw / ${aspect}))`,
});

const imageStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    display: 'block',
};

function rectStyle(r: { left: number; top: number; width: number; height: number }): CSSProperties {
    return {
        position: 'absolute',
        left:   `${r.left}%`,
        top:    `${r.top}%`,
        width:  `${r.width}%`,
        height: `${r.height}%`,
    };
}

function Hitbox({ name, onSetButton }: { name: PlayerButton; onSetButton(idx: number, pressed: boolean): void }) {
    const [pressed, setPressed] = useState(false);
    const handlers = usePointerButton((p) => {
        setPressed(p);
        onSetButton(PLAYER_BUTTON_IDX[name], p);
    });
    return (
        <button
            type="button"
            aria-label={`${name} button`}
            {...handlers}
            style={{
                ...rectStyle(shellLayout.buttons[name]),
                background: pressed ? 'rgba(0,0,0,0.30)' : 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                ...(handlers.style ?? {}),
            }}
        />
    );
}

export function PlayerShell({ canvasRef, onSetButton, onExit, onReset }: PlayerShellProps) {
    return (
        <div style={wrapStyle} data-route="player">
            <div style={topbarStyle}>
                <button
                    type="button"
                    aria-label="Restart launcher"
                    onClick={onReset}
                    style={topButtonStyle}
                >
                    ↻ Reset
                </button>
                <button
                    type="button"
                    aria-label="Exit player"
                    onClick={onExit}
                    style={topButtonStyle}
                >
                    ✕ Close
                </button>
            </div>
            <div style={contentAreaStyle}>
                <div style={innerStyle(shellLayout.imageAspect)}>
                    <img
                        src={shellLayout.imageUrl}
                        alt="Player shell"
                        style={imageStyle}
                        draggable={false}
                    />
                    <canvas
                        ref={canvasRef}
                        width={128}
                        height={128}
                        aria-label="TinyBit display"
                        style={{
                            ...rectStyle(shellLayout.screen),
                            background: '#000',
                            imageRendering: 'pixelated',
                        }}
                    />
                    {PLAYER_BUTTONS.map((name) => (
                        <Hitbox key={name} name={name} onSetButton={onSetButton} />
                    ))}
                </div>
            </div>
        </div>
    );
}
