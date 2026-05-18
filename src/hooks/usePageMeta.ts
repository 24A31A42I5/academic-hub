import { useEffect } from 'react';

interface PageMeta {
  title: string;
  description?: string;
  canonical?: string;
}

const BASE_URL = 'https://academicshub.lovable.app';

function upsertMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Set per-route <title>, <meta description>, canonical, and og:* tags.
 */
export function usePageMeta({ title, description, canonical }: PageMeta) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) {
      upsertMeta('meta[name="description"]', 'name', 'description', description);
      upsertMeta('meta[property="og:description"]', 'property', 'og:description', description);
      upsertMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    }
    if (title) {
      upsertMeta('meta[property="og:title"]', 'property', 'og:title', title);
      upsertMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    }
    const url = canonical ? (canonical.startsWith('http') ? canonical : `${BASE_URL}${canonical}`) : `${BASE_URL}${window.location.pathname}`;
    upsertCanonical(url);
    upsertMeta('meta[property="og:url"]', 'property', 'og:url', url);
  }, [title, description, canonical]);
}
