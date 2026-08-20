import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        ignores: ['build', 'coverage', '.dev-server', 'test/**/*.js', '*.config.mjs'],
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-check': 'off',
            'jsdoc/require-returns-description': 'off',
        },
    },
];
