import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;

marked.setOptions({ renderer, breaks: true });

@Pipe({ name: 'md', standalone: true })
export class MdPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(text: string): SafeHtml {
    if (!text) return '';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;');
    const html = marked.parse(escaped, { async: false }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
