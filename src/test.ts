import fs from 'fs'

import { SlskClient } from './client'

const main = async () => {
  const client = new SlskClient()
  await client.login('flibberty_gibbit__', 'jfewqiFEQEFj3219')
  const results = await client.search('milk', {
    onResult: () => {
      // console.log('result', result.username, result.results.length)
    },
    timeout: 2000,
  })

  const bestResult = results
    .filter((result) => result.slotsFree > 0 && result.results.length > 0)
    .sort((a, b) => b.avgSpeed - a.avgSpeed)
    .at(0)

  if (bestResult) {
    const bestResultFile = bestResult.results[0]
    console.log('bestResultFile', bestResultFile)

    const stream = await client.download(
      bestResult.username,
      bestResultFile.filename,
      {
        onProgress: ({ progress }) => console.log('progress', progress),
      }
    )

    await new Promise((resolve) => {
      const downloaded = fs.createWriteStream('downloaded')
      stream.pipe(downloaded)
      stream.on('end', resolve)
    })
  } else {
    console.error('No results')
  }

  client.destroy()
}

void main()
