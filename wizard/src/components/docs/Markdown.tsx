import { Children, isValidElement, type ReactNode } from 'react';
import { Alert, Box, Link, Typography } from '@mui/material';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Text } from 'hast';
import { markdownHeadings, resolveDocImage, resolveDocLink, type Chapter } from '../../docs/model';
import CodeBlock from './CodeBlock';

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '').join('');
}

export default function Markdown({ chapter }: { chapter: Chapter }) {
  const headings = new Map(markdownHeadings(chapter.markdown).map((item, index) => [item.offset, chapter.headings[index]?.anchor ?? item.anchor]));
  const heading = (level: 2 | 3 | 4 | 5 | 6) => ({ children, node }: { children?: ReactNode; node?: Element }) => {
    const anchor = headings.get(node?.position?.start.offset ?? -1);
    // Keep original repository anchors while the reader supplies its chapter title.
    if (node?.position?.start.offset === 0 && 'sourceStart' in chapter) return <Box component="span" id={`docs-section-${anchor}`} tabIndex={-1} sx={{ display: 'block', scrollMarginTop: '7rem' }} />;
    return <Typography component={`h${level}`} id={`docs-section-${anchor}`} tabIndex={-1} variant={level <= 2 ? 'h5' : level === 3 ? 'h6' : 'subtitle1'} sx={{ mt: 4, mb: 1.5, fontWeight: 650, scrollMarginTop: '7rem', overflowWrap: 'anywhere', outline: 'none' }}>{children}</Typography>;
  };
  const components: Components = {
    h1: heading(2), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    a: ({ href = '', children }) => {
      const target = resolveDocLink(href, chapter);
      const external = !target.startsWith('#docs/');
      return <Link href={target} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</Link>;
    },
    img: ({ src = '', alt = '' }) => <Box component="img" src={resolveDocImage(typeof src === 'string' ? src : '', chapter)} alt={alt} loading="lazy" sx={{ display: 'block', maxWidth: '100%', height: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, my: 2 }} />,
    pre: ({ node }) => {
      const codeNode = node?.children.find(child => child.type === 'element' && child.tagName === 'code') as Element | undefined;
      const code = codeNode?.children.filter(child => child.type === 'text').map(child => (child as Text).value).join('') ?? '';
      const language = /language-([\w-]+)/.exec(String(codeNode?.properties.className ?? ''))?.[1] ?? '';
      return <CodeBlock code={code} language={language} />;
    },
    code: ({ children }) => <Box component="code" sx={{ bgcolor: 'action.selected', color: 'text.primary', borderRadius: .6, px: .55, py: .1, fontSize: '.9em', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', overflowWrap: 'anywhere' }}>{children}</Box>,
    blockquote: ({ children }) => {
      const text = textContent(children);
      const severity = /warning|caution|warnung|vorsicht/i.test(text.slice(0, 24)) ? 'warning' : /tip|tipp/i.test(text.slice(0, 16)) ? 'success' : 'info';
      return <Alert severity={severity} variant="outlined" sx={{ my: 3, '& p': { my: .25 }, '& .MuiAlert-message': { minWidth: 0 } }}>{children}</Alert>;
    },
    table: ({ children }) => <Box sx={{ overflowX: 'auto', my: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}><Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left', fontSize: '.9rem', '& th, & td': { p: 1.5, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top', minWidth: 120 }, '& th': { bgcolor: 'action.hover', fontWeight: 650 } }}>{children}</Box></Box>,
  };
  return <Box sx={{ lineHeight: 1.8, overflowWrap: 'anywhere', '& p': { my: 1.5 }, '& li': { mb: .7 }, '& ul, & ol': { pl: 3 }, '& a': { textUnderlineOffset: '3px' } }}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{chapter.markdown}</ReactMarkdown></Box>;
}
