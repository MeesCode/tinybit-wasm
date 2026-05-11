import '@testing-library/jest-dom/vitest';

// jsdom does not implement URL.createObjectURL — stub it out globally
if (typeof URL.createObjectURL === 'undefined') {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock' });
}
