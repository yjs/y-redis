import nodeResolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import postcss from 'rollup-plugin-postcss'

export default [{
  input: './client/main.js',
  output: {
    name: 'test',
    dir: 'dist',
    format: 'esm',
    sourcemap: true
  },
  plugins: [
    nodeResolve({
      mainFields: ['module', 'browser', 'main']
    }),
    commonjs(),
    json(),
    postcss()
  ]
}]
