
export default [{
  input: './src/y-redis.js',
  output: {
    file: './dist/y-redis.cjs',
    format: 'cjs',
    sourcemap: true
  },
  external: id => /^(lib0|yjs|ioredis)/.test(id)
}]
