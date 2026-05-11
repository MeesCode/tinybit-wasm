import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders toolbar brand', () => {
    render(<App />);
    expect(screen.getByText(/tinybit/i)).toBeInTheDocument();
});
