// Flat XO config (rules relaxed as in venue-rank).
/** @type {import('xo').FlatXoConfig} */
const config = [
	{
		ignores: ['distribution/**', 'scripts/**', '*.config.js'],
	},
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/naming-convention': 'off',
			'@typescript-eslint/prefer-nullish-coalescing': 'off',
			'@typescript-eslint/no-dynamic-delete': 'off',
			'@typescript-eslint/switch-exhaustiveness-check': 'off',
			// These ban `null` as a type and would rewrite our intentional
			// `| null` annotations to `| undefined`; keep null.
			'@typescript-eslint/ban-types': 'off',
			'@typescript-eslint/no-restricted-types': 'off',
			'unicorn/no-null': 'off',
			'unicorn/number-literal-case': 'off',
			'unicorn/prefer-global-this': 'off',
			'unicorn/prevent-abbreviations': 'off',
			'unicorn/no-nested-ternary': 'off',
			'unicorn/prefer-top-level-await': 'off',
			'unicorn/no-await-expression-member': 'off',
			'no-await-in-loop': 'off',
			'no-bitwise': 'off',
			'no-alert': 'off',
			'no-void': 'off',
			'no-eq-null': 'off',
			'no-return-assign': 'off',
			'no-promise-executor-return': 'off',
			'no-mixed-operators': 'off',
			'max-statements-per-line': 'off',
			'@stylistic/no-mixed-operators': 'off',
			'@stylistic/max-statements-per-line': 'off',
			'unicorn/prefer-spread': 'off',
			'logical-assignment-operators': 'off',
			complexity: 'off',
			// IndexedDB requests and StreamFilter are used through their on* handlers.
			'unicorn/prefer-add-event-listener': 'off',
			'capitalized-comments': 'off',
			eqeqeq: ['error', 'always', {null: 'ignore'}],
		},
	},
];

export default config;
