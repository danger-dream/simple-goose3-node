
export interface TextExtractor {
	title: string
	description: string
	keywords: string
	lang: string
	content: string
}

export declare function ExtractorHtml(html: string): Promise<TextExtractor>;
