import express from 'express'

const app = express()
const port = 5173

// serve static files
app.use(express.static('./'))

app.listen(port, () => {
  console.log(`Express BlockSuite server listening on port ${port}`)
})
