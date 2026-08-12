// Red de seguridad minima, centrada en el fallo que ya nos ha roto produccion:
// un hook colocado por debajo de un `return` temprano. React exige que los hooks
// se ejecuten siempre, en el mismo orden y en el mismo numero; cuando no es asi
// aborta con el error #310 y se cae el visor entero, no solo la parte nueva.
// TypeScript no ve ese fallo y solo aparece en ejecucion, con datos reales.
//
// A proposito NO se activa el resto de reglas de estilo: aqui no se busca opinar
// sobre el codigo, sino evitar que vuelva a colarse un fallo de esta clase.
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default [
  { ignores: ['dist/**', 'ios/**', 'node_modules/**', '.wrangler/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'functions/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // typescript-eslint se registra solo para que resuelvan los comentarios
    // `eslint-disable` que ya hay repartidos por el codigo; sus reglas siguen
    // apagadas a proposito.
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]
