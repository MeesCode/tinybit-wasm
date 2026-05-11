import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ReactNode, CSSProperties } from 'react';
import { saveUiLayout, loadUiLayout } from '../state/persist';

const handleStyle = (vertical: boolean): CSSProperties => ({
    background: '#ECECF0',
    width:  vertical ? '100%' : 4,
    height: vertical ? 4      : '100%',
    cursor: vertical ? 'row-resize' : 'col-resize',
});

interface SplitState { editorPct: number; canvasPct: number; }
const DEFAULT_LAYOUT: SplitState = { editorPct: 50, canvasPct: 65 };

function getStoredLayout(): SplitState {
    return loadUiLayout<SplitState>() ?? DEFAULT_LAYOUT;
}

export interface AppSplitProps {
    left: ReactNode;
    rightTop: ReactNode;
    rightBottom: ReactNode;
}

export function AppSplit({ left, rightTop, rightBottom }: AppSplitProps) {
    const stored = getStoredLayout();
    const onLayoutH = (sizes: number[]) => {
        const next = { ...getStoredLayout(), editorPct: sizes[0] };
        saveUiLayout(next);
    };
    const onLayoutV = (sizes: number[]) => {
        const next = { ...getStoredLayout(), canvasPct: sizes[0] };
        saveUiLayout(next);
    };
    return (
        <PanelGroup direction="horizontal" onLayout={onLayoutH} style={{ flex: 1, minHeight: 0 }}>
            <Panel defaultSize={stored.editorPct} minSize={25}>{left}</Panel>
            <PanelResizeHandle style={handleStyle(false)} />
            <Panel defaultSize={100 - stored.editorPct} minSize={25}>
                <PanelGroup direction="vertical" onLayout={onLayoutV}>
                    <Panel defaultSize={stored.canvasPct} minSize={25}>{rightTop}</Panel>
                    <PanelResizeHandle style={handleStyle(true)} />
                    <Panel defaultSize={100 - stored.canvasPct} minSize={15}>{rightBottom}</Panel>
                </PanelGroup>
            </Panel>
        </PanelGroup>
    );
}
