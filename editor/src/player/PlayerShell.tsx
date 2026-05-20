import { useState, type CSSProperties, type RefObject } from 'react';
import { shellLayout, PLAYER_BUTTONS, PLAYER_BUTTON_IDX, type PlayerButton } from './shellLayout';
import { usePointerButton } from './usePointerButton';

export interface PlayerShellProps {
    canvasRef:   RefObject<HTMLCanvasElement>;
    onSetButton(idx: number, pressed: boolean): void;
    onExit():    void;
}

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
    alignItems: 'center',
    justifyContent: 'center',
};

const innerStyle = (aspect: number): CSSProperties => ({
    position: 'relative',
    height: '100dvh',
    aspectRatio: `${aspect}`,
    maxWidth: '100vw',
    maxHeight: '100dvh',
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

const exitStyle: CSSProperties = {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 999,
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    border: 'none',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    zIndex: 2,
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

export function PlayerShell({ canvasRef, onSetButton, onExit }: PlayerShellProps) {
    return (
        <div style={wrapStyle} data-route="player">
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
                <button
                    type="button"
                    aria-label="Exit player"
                    onClick={onExit}
                    style={exitStyle}
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
