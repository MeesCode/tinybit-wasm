import { useState, type ReactNode } from 'react';
import { useIsNarrowViewport } from './useIsNarrowViewport';
import { readMobileEditorOptOut, writeMobileEditorOptOut } from './mobileOptOut';
import { MobileLanding } from './MobileLanding';

export interface MobileGateProps {
    children: ReactNode;
}

export function MobileGate({ children }: MobileGateProps) {
    const narrow = useIsNarrowViewport();
    const [optedOut, setOptedOut] = useState<boolean>(() => readMobileEditorOptOut());

    if (!narrow || optedOut) return <>{children}</>;

    return (
        <MobileLanding
            onOpenEditor={() => {
                writeMobileEditorOptOut();
                setOptedOut(true);
            }}
        />
    );
}
