import fs from 'fs'
import path from 'path'

import { SlskClient } from '../src/client'

const DOWNLOADS_DIR = path.join(__dirname, '../downloads')
const USERNAME = 'groober_____'
const PASSWORD = 'fjewQFEWfewij34'

const main = async () => {
  // create a new client and login
  const client = new SlskClient()
  await client.login(USERNAME, PASSWORD)

  // send a search request and wait for the results
  const results = await client.search('autechre', { timeout: 2000 })

  // find a peer with download slots open and an mp3 file that is small but still a decent size
  const bestPeer = results
    .map((result) => ({
      ...result,
      results: result.results.filter(
        (file) => file.size > 10000 && file.filename.endsWith('.mp3')
      ),
    }))
    .filter((result) => result.slotsFree && result.results.length > 0)
    .sort((a, b) => {
      const aSmallestFile = a.results.sort((a, b) => Number(a.size - b.size))[0]
      const bSmallestFile = b.results.sort((a, b) => Number(a.size - b.size))[0]
      return (
        a.queueLength - b.queueLength ||
        Number(aSmallestFile.size - bSmallestFile.size) ||
        b.avgSpeed - a.avgSpeed
      )
    })
    .at(0)

  if (!bestPeer) {
    throw new Error('No results')
  }

  // grab their smallest file (which will be at least 10kb due to our filter above)
  const smallestFile = bestPeer.results
    .sort((a, b) => Number(a.size - b.size))
    .at(0)

  if (!smallestFile) {
    throw new Error('No files')
  }

  console.log('Downloading', smallestFile.filename, 'from', bestPeer.username)

  // send a download request
  const download = await client.download(
    bestPeer.username,
    smallestFile.filename
  )

  // optional: subscribe to updates on our download so we can log them to the console
  download.events
    .on('progress', ({ progress }) => {
      console.log(`Downloaded ${Math.round(progress * 100)}%`)
    })
    .on('status', (status, data) => {
      console.log('Status:', status, ', Data:', data)
    })

  // create a unique filename for our download and make sure the downloads directory exists
  const parsedFilename = path.parse(smallestFile.filename.replaceAll('\\', '/'))
  const fileName = `slsk-${bestPeer.username}-${
    parsedFilename.name
  }-${Date.now()}${parsedFilename.ext}`
  const filePath = path.join(DOWNLOADS_DIR, fileName)
  await fs.promises.mkdir(DOWNLOADS_DIR, { recursive: true })

  // stream the download data into the file and wait until it is finished
  await new Promise((resolve) => {
    const downloaded = fs.createWriteStream(filePath)
    download.stream.pipe(downloaded)
    download.stream.on('end', resolve)
  })

  console.log('Download complete! File saved to', filePath)

  // clean up our client
  client.destroy()
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
