import { MdPipe } from './md.pipe';
import { DomSanitizer } from '@angular/platform-browser';

describe('MdPipe', () => {
  let pipe: MdPipe;

  beforeEach(() => {
    const sanitizer = {
      bypassSecurityTrustHtml: (html: string) => html as any,
    } as DomSanitizer;
    pipe = new MdPipe(sanitizer);
  });

  const strip = (html: string) => html.replace(/<\/?p>/g, '').trim();

  it('renders bold', () => {
    expect(strip(pipe.transform('**bold**') as any)).toContain('<strong>bold</strong>');
  });

  it('renders italic', () => {
    expect(strip(pipe.transform('*italic*') as any)).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    expect(strip(pipe.transform('text `code` here') as any)).toContain('<code>code</code>');
  });

  it('renders code blocks', () => {
    const result = pipe.transform('```\nconst x = 1;\n```') as string;
    expect(result).toContain('<pre>');
    expect(result).toContain('<code');
    expect(result).toContain('const x = 1;');
  });

  it('renders links with target=_blank', () => {
    const result = strip(pipe.transform('[click](https://x.com)') as any);
    expect(result).toContain('<a href="https://x.com" target="_blank" rel="noopener noreferrer">click</a>');
  });

  it('renders blockquotes', () => {
    const result = strip(pipe.transform('> quote text') as any);
    expect(result).toContain('<blockquote>');
    expect(result).toContain('quote text');
  });

  it('renders unordered lists', () => {
    const result = pipe.transform('- item 1\n- item 2') as string;
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item 1</li>');
    expect(result).toContain('<li>item 2</li>');
    expect(result).toContain('</ul>');
  });

  it('renders ordered lists', () => {
    const result = pipe.transform('1. first\n2. second') as string;
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>first</li>');
    expect(result).toContain('<li>second</li>');
    expect(result).toContain('</ol>');
  });

  it('renders headings', () => {
    const h1 = strip(pipe.transform('# Title') as any);
    expect(h1).toContain('<h1');
    expect(h1).toContain('Title');
    const h2 = strip(pipe.transform('## Subtitle') as any);
    expect(h2).toContain('<h2');
    expect(h2).toContain('Subtitle');
  });

  it('renders tables', () => {
    const md = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');
    const result = pipe.transform(md) as string;
    expect(result).toContain('<table>');
    expect(result).toContain('<th>A</th>');
    expect(result).toContain('<th>B</th>');
    expect(result).toContain('<td>1</td>');
    expect(result).toContain('<td>2</td>');
    expect(result).toContain('</table>');
  });

  it('renders table with alignment', () => {
    const md = [
      '| Left | Center | Right |',
      '| :--- | :----: | ----: |',
      '| a    | b      | c     |',
    ].join('\n');
    const result = pipe.transform(md) as string;
    expect(result).toContain('align="left"');
    expect(result).toContain('align="center"');
    expect(result).toContain('align="right"');
  });

  it('renders strikethrough', () => {
    const result = strip(pipe.transform('~~deleted~~') as any);
    expect(result).toContain('<del>deleted</del>');
  });

  it('handles empty input', () => {
    expect(pipe.transform('') as any).toBe('');
    expect(pipe.transform(null as any) as any).toBe('');
    expect(pipe.transform(undefined as any) as any).toBe('');
  });

  it('handles plain text without markdown', () => {
    const result = strip(pipe.transform('hello world') as any);
    expect(result).toBe('hello world');
  });

  it('escapes HTML in input', () => {
    const result = strip(pipe.transform('<script>alert(1)</script>') as any);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('renders line breaks with breaks option', () => {
    const result = pipe.transform('line1\nline2') as string;
    expect(result).toContain('line1<br>');
    expect(result).toContain('line2');
  });

  it('renders horizontal rule', () => {
    const result = pipe.transform('---') as string;
    expect(result).toContain('<hr');
  });
});
