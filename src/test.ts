import { SlskClient } from './client'

const main = async () => {
  const client = new SlskClient()
  await client.login('flibberty_gibbit__', 'jfewqiFEQEFj3219')
  await client.search('milk', {
    onResult: (result) => {
      console.log('result', result.username, result.results.length)
    },
  })
  client.destroy()
}

void main()
