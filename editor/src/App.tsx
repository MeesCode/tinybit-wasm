import { Editor } from './Editor';
import { PlayerRoute } from './player/PlayerRoute';
import { pickRoute } from './player/routing';

export function App() {
    const route = pickRoute(window.location.search);
    if (route.kind === 'player') return <PlayerRoute initial={route.mode} />;
    return <Editor />;
}
