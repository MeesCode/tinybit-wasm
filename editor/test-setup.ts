import '@testing-library/jest-dom/vitest';

// jsdom does not implement URL.createObjectURL / revokeObjectURL — stub them out globally
if (typeof URL.createObjectURL === 'undefined') {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:mock' });
}
if (typeof URL.revokeObjectURL === 'undefined') {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {} });
}
