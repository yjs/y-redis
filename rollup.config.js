
const paths = path => {
  if (/^lib0\//.test(path)) {
    return `lib0/dist/${path.slice(5, -3)}.cjs`
  }
  return path
}

export default [{
  input: './tests/index.js',
  output: {
    file: './dist/test.js',
    format: 'cjs',
    sourcemap: true,
    paths
  },
  external: id => /^(lib0|yjs|ioredis)/.test(id)
}, {
  input: './src/y-redis.js',
  output: {
    file: './dist/y-redis.cjs',
    format: 'cjs',
    sourcemap: true,
    paths
  },
  external: id => /^(lib0|yjs|ioredis)/.test(id)
}]
