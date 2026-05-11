import { render } from '@testing-library/react';
import { App } from './App';

test('App mounts without crashing', () => {
    const { container } = render(<App />);
    // Sanity: a non-empty root means React mounted, the JSX runtime is wired,
    // and the test environment (jsdom + @testing-library) works. The actual
    // app shape is asserted by later component tests once UI exists.
    expect(container.firstChild).not.toBeNull();
});
