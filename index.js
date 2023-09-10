// noinspection JSJQueryEfficiency,JSUnresolvedReference
const fs = require('fs')
const {join} = require('path')
const cheerio = require('cheerio')
const entities =  require('entities')
const {load, cut} = require('@node-rs/jieba')
const {detectLang} = require('@notevenaneko/whatlang-node')
const {compile} = require('html-to-text')

const htmlToText = compile({
	formatters:{
		mePre: function (elem, walk, builder, formatOptions) {
			builder.openBlock({
				isPre: true,
				leadingLineBreaks: formatOptions.leadingLineBreaks || 1
			});
			builder.addInline('```\n');
			walk(elem.children, builder);
			builder.addInline('\n```');
			builder.closeBlock({ trailingLineBreaks: formatOptions.trailingLineBreaks || 1 });
		}
	},
	wordwrap:false,
	selectors: [
		{ selector: 'table', format: 'dataTable' },
		//{ selector: 'img', format: 'skip' },
		{ selector: 'a', options: { ignoreHref: true, noAnchorUrl: true } },
		{ selector: 'p', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
		{ selector: 'pre', format: 'mePre' },
		{ selector: 'ul', options: { itemPrefix: '* ' } },
		{ selector: 'h1', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
		{ selector: 'h2', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
		{ selector: 'h3', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
		{ selector: 'h4', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
		{ selector: 'h5', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
		{ selector: 'h6', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
	]
})

const stop_word_map = {}
const rootpath = join(__dirname, `./stopwords`)
for (const file of fs.readdirSync(rootpath)) {
	let _path = join(rootpath, file)
	const lang = file.split('.')[0]
	stop_word_map[lang] = {}
	for (const k of Array.from(new Set(fs.readFileSync(_path, 'utf-8').split('\n').filter(x => !!x)))) {
		stop_word_map[lang][k.toLowerCase()] = true
	}
}

load()
const KNOWN_ARTICLE_CONTENT_PATTERNS = [
	{attr: 'class', value: 'short-story'},
	{attr: 'itemprop', value: 'articleBody'},
	{attr: 'class', value: 'post-content'},
	{attr: 'class', value: 'g-content'},
	{attr: 'class', value: 'post-outer'},
	{tag: 'article'}
]

class TextExtractor {
	constructor(html) {
		this.$ = cheerio.load(html)
		for (const tag of ['script', 'style'])
			this.$(tag).remove()
		this.content = ''
		this.description = this.get_meta_content('meta[name=description]')
		this.keywords = this.get_meta_content('meta[name=keywords]')
		this.lang = this.get_meta_lang()
		this.title = this.extract_title()
		if (!this.lang) {
			this.lang = detectLang(this.$('body').text().replace(/\s{2,}/g, " ")).codeISO6391.toString()
		}
		const list = this.get_known_article_tags()
		if (list.length > 0) {
			this.$old = this.$
			this.$ = cheerio.load(list.html())
			try {
				this.content = htmlToText(this.$.html()).trim()
			} catch {}
		}
		this.clean()
	}
	
	clean() {
		if (this.content) return
		const $ = this.$
		const body = $('body')
		if (body.length) {
			body.removeAttr('class')
		}
		$('article').toArray().forEach(x => $(x).removeAttr('id').removeAttr('name').removeAttr('class'))
		
		for (const em of $('em').toArray().map(x => $(x))) {
			const images = em.find('img')
			if (!images.length) {
				em.contents().unwrap()
			}
		}
		
		$('span[class~="dropcap"], span[class~="drop_cap"]').toArray().forEach(x => $(x).contents().unwrap())
		
		$('*').contents().filter(function () {
			return this.type === 'comment'
		}).remove()
		
		let naughtyWords = '^side$|combx|retweet|mediaarticlerelated|menucontainer|navbar|storytopbar-bucket|utility-bar|inline-share-tools|comment|PopularQuestions|contact|foot|footer|Footer|footnote|cnn_strycaptiontxt|cnn_html_slideshow|cnn_strylftcntnt|^links$|meta$|shoutbox|sponsor|tags|socialnetworking|socialNetworking|cnnStryHghLght|cnn_stryspcvbx|^inset$|pagetools|post-attributes|welcome_form|contentTools2|the_answers|communitypromo|runaroundLeft|subscribe|vcard|articleheadings|date|^print$|popup|author-dropdown|tools|socialtools|byline|konafilter|KonaFilter|breadcrumbs|^fn$|wp-caption-text|legende|ajoutVideo|timestamp|js_replies|disclaim|^caption$| google |^[^entry-]more.*$|[^-]facebook|facebook-broadcasting|[^-]twitter'
		let regex = new RegExp(naughtyWords, 'i')
		
		$('*').toArray().forEach(x => {
			const el = $(x)
			let id = el.attr('id')
			let name = el.attr('name')
			let className = el.attr('class')
			if ((id && regex.test(id)) || (name && regex.test(name)) || (className && regex.test(className))) {
				el.remove()
			}
		})
		$('p span').toArray().forEach(x => $(x).contents().unwrap())
	}
	
	get_meta_content(select) {
		const meta = this.$(select)
		let content = null
		if (meta && meta.length > 0) content = meta.attr('content')
		if (content) {
			return content.trim()
		}
		return ''
	}
	
	get_meta_lang() {
		let attr = this.$('html').attr('lang')
		if (!attr) {
			// 在meta中寻找Content-Language
			const items = [{tag: 'meta', attr: 'http-equiv', value: 'content-language'}, {
				tag: 'meta',
				attr: 'name',
				value: 'lang'
			}]
			for (const item of items) {
				const meta = this.$(`${item.tag}[${item.attr}="${item.value}"]`)
				if (meta.length > 0) {
					attr = meta.attr('content')
					break
				}
			}
		}
		if (attr) {
			const value = attr.slice(0, 2)
			const reLang = /^[A-Za-z]{2}$/
			if (reLang.test(value)) {
				return value.toLowerCase()
			}
		}
		return ''
	}
	
	extract_title() {
		let title = ''
		const metaHeadline = this.$('meta[name="headline"]')
		if (metaHeadline.length) {
			title = metaHeadline.attr('content')
		}
		const titleElement = this.$('title')
		if (titleElement.length) {
			title = titleElement.text()
		}
		if (title) {
			/*const pattern = new RegExp(this.article.domain, 'i')
			title = title.replace(pattern, '').trim()*/
			const TITLE_SPLITTERS = ['|', '-', '»', ':']
			let titleWords = title.split(' ')
			if (titleWords[0] && TITLE_SPLITTERS.includes(titleWords[0])) {
				titleWords.shift()
			}
			if (!titleWords.length) {
				return ''
			}
			if (TITLE_SPLITTERS.includes(titleWords[titleWords.length - 1])) {
				titleWords.pop()
			}
			title = titleWords.join(' ').trim()
		}
		
		return title
	}
	
	get_stopword_count(content) {
		if (!content) return 0
		try {
			const stripped_input = content.replace(/[!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~]/g, '')
			const lang = /[\u4E00-\u9FA5\uF900-\uFA2D]+/.test(stripped_input) ? 'zh' : detectLang(stripped_input.replace(/\s/g, ''))?.codeISO6391?.toString() || 'en'
			const candidate_words = lang === 'zh' ? cut(stripped_input, true) : stripped_input.split(/\s|\xa0|\t/g)
			const sw = stop_word_map[lang] || stop_word_map['zh']
			return candidate_words.filter(x => sw[x.toLowerCase()]).length
		} catch {
			return 0
		}
	}
	
	
	getText(element) {
		let texts = []
		let self = this
		for (const el of this.$(element).contents().toArray()) {
			if (el.type === 'text') {
				texts.push(el.data.trim())
			} else if (el.type === 'tag') {
				texts.push(self.getText(el))
			} else {
				console.log(el.type)
			}
		}
		let value = texts.join(' ')
		value = value.replace(/\s|\t+/g, ' ')
		value = value.replace(/\n/g, '')
		return value.trim()
	}
	
	is_highlink_density(element) {
		let links = this.$(element).find('a').toArray()
		if (links.length === 0) return false
		let words = this.getText(element).split(' ')
		let number_of_link_words = links.map(x => this.$(x).text()).join('').split(' ').length
		return number_of_link_words / words.length * links.length >= 1.0
	}
	
	previousSibling(element) {
		const siblings = []
		let currentSibling = element.prev()
		while (currentSibling.length > 0) {
			siblings.push(currentSibling)
			currentSibling = currentSibling.prev()
		}
		return siblings.length > 0 ? siblings[0] : null
	}
	
	walk_siblings(node) {
		let currentSibling = this.previousSibling(node)
		const res = []
		while (currentSibling !== null) {
			res.push(currentSibling)
			const previousSibling = this.previousSibling(currentSibling)
			currentSibling = previousSibling === null ? null : previousSibling
		}
		return res
	}
	
	is_boostable(node) {
		const para = 'p'
		let stepsAway = 0
		const minimumStopwordCount = 5
		const maxStepsAwayFromNode = 3
		const nodes = this.walk_siblings(node)
		for (let current_node of nodes) {
			const current_node_tag = current_node[0].tagName
			if (current_node_tag === para) {
				if (stepsAway >= maxStepsAwayFromNode) {
					return false
				}
				const para_text = this.getText(current_node)
				if (this.get_stopword_count(para_text) > minimumStopwordCount) {
					return true
				}
				stepsAway += 1
			}
		}
		return false
	}
	
	getScore(el) {
		return parseInt(this.$(el).attr('core-score')) || 0
	}
	
	
	extract() {
		if (this.content) return this
		const $ = this.$
		const nodes_to_check = ['p', 'pre', 'td'].map(x => $(x).toArray()).flat()
		const parent_nodes = []
		const nodes_with_text = []
		
		const loc_update_parent = (node, upscore, depth = 1) => {
			let $parent_node = $(node).parent()
			if ($parent_node.length < 1) return
			const parent = $parent_node[0]
			const el = $(parent)
			el.attr('core-score', ((parseInt(el.attr('core-score')) || 0) + (upscore * (1.5 / (depth + 0.5)))).toString())
			if (!parent_nodes.includes(parent)) {
				parent_nodes.push(parent)
			}
			loc_update_parent(parent, upscore, depth + 1)
		}
		for (let node of nodes_to_check) {
			const text = this.getText(node)
			if (!text) continue
			let high_link_density = this.is_highlink_density(node)
			if (this.get_stopword_count(text) > 2 && !high_link_density) {
				nodes_with_text.push(node)
			}
		}
		
		const nodes_number = nodes_with_text.length
		const bottom_negativescore_nodes = nodes_number * 0.25
		let starting_boost = 1.0
		let cnt = 0
		let i = 0
		for (let node of nodes_with_text) {
			let boost_score = 0
			if (this.is_boostable($(node))) {
				if (cnt >= 0) {
					boost_score = (1.0 / starting_boost) * 50
					starting_boost += 1
				}
			}
			if (nodes_number > 15) {
				if ((nodes_number - i) <= bottom_negativescore_nodes) {
					let booster = bottom_negativescore_nodes - (nodes_number - i)
					boost_score = -(Math.pow(booster, 2))
					let negscore = Math.abs(boost_score)
					if (negscore > 40) {
						boost_score = 5
					}
				}
			}
			loc_update_parent(node, this.get_stopword_count(this.getText(node)) + boost_score)
			cnt += 1
			i += 1
		}
		let top_node = null
		let top_node_score = 0
		for (let el of parent_nodes) {
			let score = this.getScore(el)
			if (score > top_node_score) {
				top_node = el
				top_node_score = score
			}
			if (top_node === null) {
				top_node = el
			}
		}
		if (top_node == null) {
			if (this.$old) {
				this.$ = this.$old
				this.$old = undefined
				this.extract()
			}
			if (!this.content) {
				this.content = this.description
			}
			return this
		}
		const node = $(this.add_siblings($(top_node)))
		this.content = this.extractNodeText(node)
		return this
	}
	
	extractNodeText(node, is_remove = true){
		const $ = this.$
		if (is_remove) {
			for (const el of node.children().toArray().map(x => $(x))) {
				if (['p', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(el[0].tagName)) continue
				if (this.is_highlink_density(el) || this.is_table_and_no_para_exist(el) || !this.is_nodescore_threshold_met(node, el)) {
					$(el).remove()
				}
			}
			
			for (const el of node.find('[core-score]').toArray().map(x => $(x))) {
				const score = parseInt(el.attr('core-score'), 10) || 0
				score < 1 && el.parent().remove(el)
			}
			
			node.find('[core-score]').each((i, item) => {
				const el = $(item)
				let score = el.attr('core-score')
				score = parseInt(score, 10)
				if (score < 1) {
					el.parent().remove(el)
				}
			})
		}
		
		
		for (const el of node.find('a').toArray().map(x => $(x))) {
			el.replaceWith(el.text())
		}
		for (const el of node.find('br').toArray().map(x => $(x))) {
			el.replaceWith('\n')
		}
		if (is_remove) {
			for (const el of ['b', 'strong', 'i', 'br', 'sup'].map(tag => node.find(tag).toArray().map(x => $(x))).flat()) {
				//el.replaceWith(el.text())
				el.remove()
			}
			const allNodes = node.find('*').toArray().reverse().map(x => $(x))
			for (let el of allNodes) {
				const text = this.getText(el)
				if ((el[0].tagName !== 'br' || text !== '\\r') && this.get_stopword_count(text) < 3 && el.find('object').length === 0 && el.find('embed').length === 0) {
					el.remove()
				} else {
					const trimmed = text.trim()
					if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
						el.remove()
					}
				}
			}
		}
		
		for (const el of node.find('li').toArray().map(x => $(x))) {
			el.text(`• ${el.text()}`)
		}
		let txts = []
		for (const el of node.find('*').toArray().map(x => $(x))){
			let txt = this.getText(el)
			if (!txt) continue
			txts.push(...entities.decodeHTML(txt).trim().split('\n'))
		}
		return txts.join('\n\n').replace('\n•', '•').split('• ').map(item => item.trim()).join('\n• ').trim()
	}
	
	get_elements_by_tag(node, tag, attr, value) {
		const $node = this.$(node)
		let elements = this.$(attr ? `${ tag || '' }[${attr}~=${value}]` : tag || '*', $node).toArray()
		return tag ? elements.filter(elm => elm !== $node[0]) : elements
	}
	
	get_known_article_tags() {
		const $ = this.$
		const nodes = []
		const docs = $('*')
		for (const item of KNOWN_ARTICLE_CONTENT_PATTERNS) {
			nodes.push(...this.get_elements_by_tag(docs, item.tag, item.attr, item.value))
		}
		return nodes.length > 0 ? $(nodes) : []
	}
	
	is_articlebody(node) {
		for (const item of KNOWN_ARTICLE_CONTENT_PATTERNS) {
			if (item.attr && node.attr(item.attr) === item.value) return true
			if (item.tag && node[0].tagName === item.tag) return true
		}
		return false
	}
	
	get_siblings_score(topNode) {
		let base = 100000
		let paragraphsNumber = 0
		let paragraphsScore = 0
		for (const el of topNode.find('p').toArray().map(x => this.$(x))) {
			const stop_word_count = this.get_stopword_count(this.getText(el))
			if (stop_word_count > 2 && !this.is_highlink_density(el)) {
				paragraphsNumber += 1
				paragraphsScore += stop_word_count
			}
		}
		if (paragraphsNumber > 0) {
			base = paragraphsScore
		}
		return base
	}
	
	add_siblings(topNode) {
		if (this.is_articlebody(topNode)) {
			return topNode
		}
		const baselinescoreSiblingsPara = this.get_siblings_score(topNode)
		const results = this.walk_siblings(topNode)
		for (let currentNode of results) {
			const prevSibs = this.get_siblings_content(this.$(currentNode), baselinescoreSiblingsPara)
			for (const prev of prevSibs) {
				topNode.prepend(prev)
			}
		}
		return topNode
	}
	
	get_siblings_content(currentSibling, baselinescoreSiblingsPara) {
		if (currentSibling[0].tagName === 'p' && this.getText(currentSibling)) {
			let tmp = currentSibling.clone()
			if (tmp[0].next) {
				tmp[0].next.data = ''
			}
			return [tmp]
		}
		const potentialParagraphs = this.$(currentSibling.find('p')).toArray().map(x => this.$(x))
		if (potentialParagraphs.length === 0) {
			return []
		}
		const paragraphs = []
		for (const firstParagraph of potentialParagraphs) {
			const text = this.getText(firstParagraph)
			if (!text) continue
			const highLinkDensity = this.is_highlink_density(firstParagraph)
			if (baselinescoreSiblingsPara * 0.30 < this.get_stopword_count(text) && !highLinkDensity) {
				paragraphs.push(this.$('<p></p>').text(text))
			}
		}
		return paragraphs
	}
	
	is_nodescore_threshold_met(node, el) {
		return !((this.getScore(el) < this.getScore(node) * 0.08) && el[0].tagName !== 'td')
	}
	
	is_table_and_no_para_exist(el) {
		const self = this
		const p = el.find('p').toArray().map(x => this.$(x))
		for (const para of p) {
			self.getText(para).length < 25 && para.remove()
		}
		return p.length === 0 && el[0].tagName !== 'td'
	}
}

/**
 * @param html {string}
 * @return {TextExtractor}
 */
exports.ExtractorHtml = function ExtractorHtml(html) {
	const extractor = new TextExtractor(html)
	extractor.extract()
	return extractor
}
