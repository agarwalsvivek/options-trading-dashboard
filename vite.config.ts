import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The pure logic where a regression would be silent; the worker shell and React hooks are thin
      include: [
        'src/stream/core/**/*.ts',
        'src/stream/connectionPolicy.ts',
        'src/state/createStore.ts',
        'server/validation.ts',
      ],
      exclude: ['**/*.test.ts'],
      // Branches are lower because of `?? default` fallbacks on decoded protobuf fields: the generated
      // types are nullable, but the decoder always fills proto3 defaults, so those branches can't run
      thresholds: { lines: 90, functions: 90, branches: 80, statements: 90 },
    },
  },
})
