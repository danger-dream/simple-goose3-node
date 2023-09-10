# simple-goose3-node


参考 [goose3](https://github.com/goose3/goose3) 的简单实现

## To install:

```sh
npm install simple-goose3-node
```

## example

```js
import { ExtractorHtml } from 'simple-goose3-node'
// or
const { ExtractorHtml } = require('simple-goose3-node')

fetch('https://www.163.com/news/article/IE9IOC75000189FH.html', {
	method: 'GET',
}).then(async resp => {
	const html = await resp.text()
	const result = await ExtractorHtml(html)
	console.log(result)
})

```
