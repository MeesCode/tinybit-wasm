import { Editor } from './Editor';
import { PlayerRoute } from './player/PlayerRoute';
import { pickRoute } from './player/routing';
import { MobileGate } from './ui/MobileGate';

export function App() {
    const route = pickRoute(window.location.search);
    if (route.kind === 'player') return <PlayerRoute />;
    return (
        <MobileGate>
            <Editor />
        </MobileGate>
    );
}
