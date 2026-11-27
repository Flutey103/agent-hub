import Markdown from "react-markdown"

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown text-sm leading-6">
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
