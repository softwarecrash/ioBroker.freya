import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['build', 'coverage', '.dev-server', 'test/**/*.js', '*.config.mjs'],
    },
];

