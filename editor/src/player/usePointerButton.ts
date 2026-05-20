import { useCallback, type HTMLAttributes, type PointerEvent } from 'react';

export interface PointerButtonHandlers extends HTMLAttributes<HTMLElement> {
    onPointerDown(e: PointerEvent<HTMLElement>): void;
    onPointerUp(e:   PointerEvent<HTMLElement>): void;
    onPointerCancel(e: PointerEvent<HTMLElement>): void;
    onLostPointerCapture(e: PointerEvent<HTMLElement>): void;
}

export function usePointerButton(setPressed: (pressed: boolean) => void): PointerButtonHandlers {
    const down = useCallback((e: PointerEvent<HTMLElement>) => {
        if (e.currentTarget.setPointerCapture) {
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        setPressed(true);
    }, [setPressed]);

    const release = useCallback(() => {
        setPressed(false);
    }, [setPressed]);

    return {
        onPointerDown:        down,
        onPointerUp:          release,
        onPointerCancel:      release,
        onLostPointerCapture: release,
        style: { touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' },
    };
}
