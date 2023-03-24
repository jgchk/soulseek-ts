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
  const results = await client.search('autechre')

  // grab the first result we find
  const result = results.at(0)
  if (!result) {
    throw new Error('No results')
  }

  // grab the first file from the result
  const file = result.files.at(0)
  if (!file) {
    throw new Error('No files')
  }

  // send a download request
  const download = await client.download(result.username, file.filename)

  // create a unique filename for our download and make sure the downloads directory exists
  const parsedFilename = path.parse(file.filename.replaceAll('\\', '/'))
  const filePath = path.join(
    DOWNLOADS_DIR,
    `slsk-${result.username}-${parsedFilename.name}-${Date.now()}${parsedFilename.ext}`
  )
  await fs.promises.mkdir(DOWNLOADS_DIR, { recursive: true })

  // stream the download data into the file and wait until it is finished
  await new Promise((resolve) => {
    const downloaded = fs.createWriteStream(filePath)
    download.stream.pipe(downloaded)
    download.stream.on('end', resolve)
  })

  // clean up our client
  client.destroy()
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
