#!/usr/bin/env node
// Copies the repository Markdown (docs/, CHANGELOG, CONTRIBUTING, SECURITY) into
// site/docs/ so VitePress can render it without hand-maintained duplicates.
//
// Links are rewritten so they work on the website:
// - links to another copied file point to its site page (dead links fail the build);
// - every other relative link (sources, Compose files, LICENSE, README, …) points
//   to the file on GitHub.
// The output directory is generated and gitignored; edit the original files instead.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_URL = 'https://github.com/petrleocompel/hlidac-cuzk'
const BRANCH = 'main'

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(siteDir, '..')
const outDir = path.join(siteDir, 'docs')

/**
 * Source (repository-relative) → output page (relative to site/docs) and page language.
 * Unknown docs/*.md files are still published under a slug derived from their name.
 */
const KNOWN_PAGES = {
  'docs/self-hosting.cs.md': { page: 'instalace.md', lang: 'cs' },
  'docs/self-hosting.md': { page: 'self-hosting.md', lang: 'en' },
  'docs/testing.md': { page: 'testing.md', lang: 'en' },
  'docs/cuzk-successors-wsdp-research.md': {
    page: 'cuzk-successors-wsdp-research.md',
    lang: 'cs',
  },
  'CHANGELOG.md': { page: 'changelog.md', lang: 'en' },
  'CONTRIBUTING.md': { page: 'contributing.md', lang: 'en' },
  'SECURITY.md': { page: 'security.md', lang: 'en' },
}

function collectSources() {
  const pages = new Map(Object.entries(KNOWN_PAGES))
  for (const name of fs.readdirSync(path.join(repoDir, 'docs')).sort()) {
    const source = `docs/${name}`
    if (!name.endsWith('.md') || pages.has(source)) continue
    const slug = name.slice(0, -'.md'.length).replace(/[^a-zA-Z0-9-]+/g, '-')
    pages.set(source, { page: `${slug}.md`, lang: 'en' })
  }
  for (const source of pages.keys()) {
    if (!fs.existsSync(path.join(repoDir, source))) pages.delete(source)
  }
  return pages
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** Rewrites one link target found in `source` (repository-relative path). */
function rewriteTarget(target, source, pages, isImage) {
  if (!target || target.startsWith('#') || EXTERNAL.test(target)) return target
  const hashIndex = target.indexOf('#')
  const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : target.slice(hashIndex)
  let decoded = rawPath
  try {
    decoded = decodeURI(rawPath)
  } catch {
    // keep the raw path
  }
  const repoPath = rawPath.startsWith('/')
    ? decoded.replace(/^\/+/, '')
    : path.posix.normalize(path.posix.join(path.posix.dirname(source), decoded))

  if (repoPath.startsWith('..')) {
    throw new Error(`${source}: link "${target}" points outside the repository`)
  }

  const linked = pages.get(repoPath)
  if (linked && !isImage) {
    const from = path.posix.dirname(pages.get(source).page)
    let rel = path.posix.relative(from, linked.page)
    if (!rel.startsWith('.')) rel = `./${rel}`
    return encodeURI(rel) + hash
  }

  const absolute = path.join(repoDir, repoPath)
  const isDir =
    repoPath === '.' ||
    rawPath.endsWith('/') ||
    (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory())
  const clean = repoPath === '.' ? '' : repoPath.replace(/\/+$/, '')
  if (isImage) {
    return `https://raw.githubusercontent.com/petrleocompel/hlidac-cuzk/${BRANCH}/${encodeURI(clean)}`
  }
  const kind = isDir ? 'tree' : 'blob'
  return `${REPO_URL}/${kind}/${BRANCH}/${encodeURI(clean)}${hash}`
}

/** Applies `fn` only to text outside fenced code blocks. */
function mapProse(markdown, fn) {
  const lines = markdown.split('\n')
  const out = []
  let fence = null
  let buffer = []
  const flush = () => {
    if (buffer.length === 0) return
    out.push(fn(buffer.join('\n')))
    buffer = []
  }
  for (const line of lines) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      out.push(line)
      if (
        match &&
        match[1][0] === fence[0] &&
        match[1].length >= fence.length
      ) {
        fence = null
      }
    } else if (match) {
      flush()
      fence = match[1]
      out.push(line)
    } else {
      buffer.push(line)
    }
  }
  flush()
  return out.join('\n')
}

function rewriteLinks(markdown, source, pages) {
  return mapProse(markdown, (text) =>
    text
      // Inline links and images: [text](target "title") / ![alt](target).
      // Inline code spans are matched too, so that links shown as code stay as-is.
      .replace(
        /(`+)[\s\S]*?\1|(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^\s)]+)((?:\s+"[^"]*")?\s*)\)/g,
        (all, code, bang, label, rawTarget, title) => {
          if (code) return all
          const angle = rawTarget.startsWith('<')
          const target = angle ? rawTarget.slice(1, -1) : rawTarget
          const next = rewriteTarget(target, source, pages, bang === '!')
          return `${bang}[${label}](${angle ? `<${next}>` : next}${title})`
        },
      )
      // Reference definitions: [label]: target
      .replace(
        /^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/gm,
        (_all, head, target) =>
          head + rewriteTarget(target, source, pages, false),
      ),
  )
}

function main() {
  const pages = collectSources()
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })

  for (const [source, { page, lang }] of pages) {
    const original = fs.readFileSync(path.join(repoDir, source), 'utf8')
    const body = rewriteLinks(original.replace(/\r\n/g, '\n'), source, pages)
    // The wrapper keeps the copied Markdown static (no Vue interpolation of
    // `{{ … }}`) and marks English pages for assistive technology.
    const output = [
      '---',
      `source: ${JSON.stringify(source)}`,
      '---',
      '',
      `<!-- Generated from ${source} by site/scripts/sync-docs.mjs. Do not edit. -->`,
      '',
      `<div v-pre lang="${lang}">`,
      '',
      body.trimEnd(),
      '',
      '</div>',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(outDir, page), output)
  }
  console.log(
    `sync-docs: wrote ${pages.size} pages to ${path.relative(repoDir, outDir)}/`,
  )
}

main()
