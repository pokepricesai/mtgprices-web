// app/insights/[slug]/page.tsx, article template.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { getInsight, listInsights, relatedInsights } from '@/lib/insights'

export const revalidate = 900

const SITE_URL = 'https://mtgprices.io'

type Params = { slug: string }

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return listInsights().map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params
  const article = getInsight(slug)
  if (!article) return { title: 'Article not found' }
  const canonical = `${SITE_URL}/insights/${article.slug}`
  return {
    title: article.title,
    description: article.description || undefined,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      url: canonical,
      title: article.title,
      description: article.description || undefined,
      publishedTime: `${article.publishedAt}T00:00:00Z`,
      modifiedTime: article.updatedAt ? `${article.updatedAt}T00:00:00Z` : undefined,
      authors: [article.author],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.description || undefined,
    },
  }
}

export default async function InsightPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const article = getInsight(slug)
  if (!article) notFound()
  const related = relatedInsights(slug, 3)
  const canonical = `${SITE_URL}/insights/${article.slug}`

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description || undefined,
    datePublished: `${article.publishedAt}T00:00:00Z`,
    dateModified: article.updatedAt ? `${article.updatedAt}T00:00:00Z` : `${article.publishedAt}T00:00:00Z`,
    author: { '@type': 'Organization', name: article.author },
    publisher: {
      '@type': 'Organization',
      name: 'MTGPrices',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    url: canonical,
  }
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home',     item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Insights', item: `${SITE_URL}/insights` },
      { '@type': 'ListItem', position: 3, name: article.title, item: canonical },
    ],
  }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 80px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/" style={{ color: 'inherit' }}>Home</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <Link href="/insights" style={{ color: 'inherit' }}>Insights</Link>
      </nav>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span className="chip chip-arcane" style={{ fontSize: 11 }}>{article.category}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(article.publishedAt)}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {article.readingTimeMin} min read</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {article.author}</span>
      </div>

      <h1 className="display" style={{
        margin: 0, fontSize: 'clamp(28px, 3.4vw, 40px)',
        color: 'var(--text-strong)', lineHeight: 1.15,
      }}>{article.title}</h1>

      {article.description && (
        <p style={{ marginTop: 12, fontSize: 17, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {article.description}
        </p>
      )}

      <article className="insight-article" style={{
        marginTop: 26,
        color: 'var(--text)',
        fontSize: 16.5, lineHeight: 1.75,
      }}>
        <ReactMarkdown
          components={{
            h2: ({ node, ...rest }: any) => { void node; return <h2 style={{ marginTop: 30, marginBottom: 10, fontSize: 24, color: 'var(--text-strong)' }} {...rest} /> },
            h3: ({ node, ...rest }: any) => { void node; return <h3 style={{ marginTop: 22, marginBottom: 8, fontSize: 19, color: 'var(--text-strong)' }} {...rest} /> },
            p:  ({ node, ...rest }: any) => { void node; return <p style={{ margin: '0 0 16px' }} {...rest} /> },
            a:  ({ node, href, ...rest }: any) => {
              void node
              const external = typeof href === 'string' && /^https?:\/\//.test(href) && !href.startsWith(SITE_URL)
              return <a href={href} {...rest}
                style={{ color: 'var(--primary)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined} />
            },
            ul: ({ node, ...rest }: any) => { void node; return <ul style={{ margin: '0 0 18px', paddingLeft: 24 }} {...rest} /> },
            ol: ({ node, ...rest }: any) => { void node; return <ol style={{ margin: '0 0 18px', paddingLeft: 24 }} {...rest} /> },
            li: ({ node, ...rest }: any) => { void node; return <li style={{ margin: '4px 0' }} {...rest} /> },
            code: ({ node, ...rest }: any) => { void node; return (
              <code
                style={{
                  padding: '2px 6px', borderRadius: 4,
                  background: 'var(--bg-light)', border: '1px solid var(--border)',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '0.92em',
                }}
                {...rest}
              />
            ) },
            blockquote: ({ node, ...rest }: any) => { void node; return (
              <blockquote
                style={{
                  margin: '20px 0', padding: '10px 16px',
                  borderLeft: '3px solid var(--gold-400)',
                  background: 'var(--bg-light)', borderRadius: 4,
                  color: 'var(--text-muted)',
                }}
                {...rest}
              />
            ) },
          }}
        >{article.body}</ReactMarkdown>
      </article>

      {related.length > 0 && (
        <section aria-label="Related insights" style={{ marginTop: 40 }}>
          <div className="label-mono" style={{ marginBottom: 10, color: 'var(--gold-600)' }}>More insights</div>
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          }}>
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/insights/${r.slug}`}
                className="card-hover card-hover-gold"
                style={{
                  padding: 14, borderRadius: 12,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  textDecoration: 'none', color: 'var(--text)',
                  display: 'block',
                }}
              >
                <div className="label-mono" style={{ color: 'var(--gold-600)' }}>{r.category}</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6, color: 'var(--text-strong)', lineHeight: 1.3 }}>
                  {r.title}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  {formatDate(r.publishedAt)} · {r.readingTimeMin} min
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
