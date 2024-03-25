import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import postcss from 'rollup-plugin-postcss'
import alias from '@rollup/plugin-alias'

export default [{
  input: './client/main.js',
  output: {
    name: 'test',
    dir: 'dist',
    format: 'esm',
    sourcemap: true
  },
  plugins: [
    alias({
      entries: [
        { find: 'yjs', replacement: './node_modules/yjs/dist/yjs.mjs' }
      ]
    }),
    nodeResolve({
      mainFields: ['module', 'browser', 'main']
    }),
    commonjs(),
    json(),
    postcss()
  ]
}]
