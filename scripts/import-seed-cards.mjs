#!/usr/bin/env node
// Reusable importer for adding new seed cards in bulk — this is the "best
// way to add 100 more later" tool: point it at a file, it validates,
// dedupes, categorizes, and produces ready-to-run SQL. It never writes to
// the database itself (no token/credentials needed to just run it) — you
// paste the generated SQL into the Supabase SQL editor, or hand it to
// Claude to run via the Management API.
//
// Usage:
//   node scripts/import-seed-cards.mjs <input-file> [output-file]
//
// Input file can be:
//   - a .json array of strings:            ["He still texts his ex...", ...]
//   - a .json array of [text, category]:    [["He still texts...", "relationship"], ...]
//   - a .json array of {text, category}:    [{"text": "...", "category": "relationship"}, ...]
//   - a .txt/.csv file, one question per line (optionally "text,category")
//
// category is optional in every format above — anything missing/unrecognized
// gets auto-assigned via keyword matching against the five app categories
// (relationship/friendship/career/family/other), same as picking "assign
// them for me" when adding a batch interactively.
//
// Output: a timestamped .sql file next to supabase/seed.sql, plus a summary
// printed to the console (accepted / rejected / categorization breakdown).
// Nothing is written to seed.sql automatically — review the generated file,
// then either paste it into the Supabase SQL editor, or append the same
// rows into supabase/seed.sql if you want fresh installs to include them.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { Filter } from 'bad-words'

const MIN_LENGTH = 5
const MAX_LENGTH = 180 // must match src/lib/moderation.js MAX_CONFESSION_LENGTH
const CATEGORIES = ['relationship', 'friendship', 'career', 'family', 'other']

const PHONE_REGEX = /(\+?\d[\d\s-]{8,}\d)/
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/
const HANDLE_REGEX = /[@#][\w.]{2,}/
const URL_REGEX = /(https?:\/\/|www\.)\S+/i

const CATEGORY_KEYWORDS = {
  // Checked in this order — family beats relationship (an in-law mention
  // should count as family even in a sentence that's otherwise about a
  // partner), relationship beats the more generic friendship/career lists.
  family: ['mom', 'dad', 'mother', 'father', 'parent', 'sister', 'brother', 'sibling', 'in-law', 'in law', 'cousin', 'aunt', 'uncle', 'grandma', 'grandpa', 'grandmother', 'grandfather', 'family'],
  relationship: ['partner', 'boyfriend', 'girlfriend', 'husband', 'wife', 'dating', ' ex ', "ex'", 'ex,', 'ex.', 'fianc', 'romantic', 'crush', 'marry', 'married', 'marriage', 'engage', 'wedding', 'date '],
  career: ['boss', 'coworker', 'co-worker', 'colleague', 'job', 'work', 'office', 'manager', 'salary', 'interview', 'promotion', 'client', 'workplace'],
  friendship: ['friend', 'roommate', 'room-mate', 'bestie', 'buddy'],
}

function guessCategory(text) {
  const lower = ` ${text.toLowerCase()} `
  for (const cat of ['family', 'relationship', 'career', 'friendship']) {
    if (CATEGORY_KEYWORDS[cat].some((kw) => lower.includes(kw))) return cat
  }
  return 'other'
}

function parseInput(path) {
  const raw = readFileSync(path, 'utf8')

  if (path.endsWith('.json')) {
    const parsed = JSON.parse(raw)
    return parsed.map((item) => {
      if (typeof item === 'string') return { text: item, category: null }
      if (Array.isArray(item)) return { text: item[0], category: item[1] || null }
      return { text: item.text, category: item.category || null }
    })
  }

  // .txt / .csv — one per line, optional ",category" suffix
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const commaIdx = line.lastIndexOf(',')
      if (commaIdx === -1) return { text: line, category: null }
      const maybeCategory = line.slice(commaIdx + 1).trim().toLowerCase()
      if (CATEGORIES.includes(maybeCategory)) {
        return { text: line.slice(0, commaIdx).trim(), category: maybeCategory }
      }
      return { text: line, category: null }
    })
}

async function fetchExistingTexts() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.warn('⚠ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — skipping DB-side dedupe (will still dedupe within this batch).')
    return new Set()
  }
  const supabase = createClient(url, key)
  const existing = new Set()
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await supabase.from('posts').select('text').range(from, from + pageSize - 1)
    if (error) {
      console.warn('⚠ Could not fetch existing posts for dedupe:', error.message)
      break
    }
    for (const row of data) existing.add(normalize(row.text))
    if (data.length < pageSize) break
    from += pageSize
  }
  return existing
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

function sqlEscape(text) {
  return text.replace(/'/g, "''")
}

async function main() {
  const [, , inputPath, outputPathArg] = process.argv
  if (!inputPath) {
    console.error('Usage: node scripts/import-seed-cards.mjs <input-file> [output-file]')
    process.exit(1)
  }
  if (!existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`)
    process.exit(1)
  }

  const filter = new Filter()
  const items = parseInput(inputPath)
  const existingTexts = await fetchExistingTexts()
  const seenInBatch = new Set()

  const accepted = []
  const rejected = []
  const categoryCounts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]))

  for (const { text: rawText, category: rawCategory } of items) {
    const text = (rawText || '').trim()
    const norm = normalize(text)

    if (text.length < MIN_LENGTH) { rejected.push({ text, reason: 'too short' }); continue }
    if (text.length > MAX_LENGTH) { rejected.push({ text, reason: `too long (${text.length} chars)` }); continue }
    if (PHONE_REGEX.test(text)) { rejected.push({ text, reason: 'looks like a phone number' }); continue }
    if (EMAIL_REGEX.test(text)) { rejected.push({ text, reason: 'looks like an email' }); continue }
    if (HANDLE_REGEX.test(text)) { rejected.push({ text, reason: '@handle or #hashtag' }); continue }
    if (URL_REGEX.test(text)) { rejected.push({ text, reason: 'contains a link' }); continue }
    if (filter.isProfane(text)) { rejected.push({ text, reason: 'profanity filter' }); continue }
    if (existingTexts.has(norm)) { rejected.push({ text, reason: 'duplicate of existing card' }); continue }
    if (seenInBatch.has(norm)) { rejected.push({ text, reason: 'duplicate within this batch' }); continue }

    seenInBatch.add(norm)
    const category = CATEGORIES.includes(rawCategory) ? rawCategory : guessCategory(text)
    categoryCounts[category] += 1
    accepted.push({ text, category })
  }

  if (accepted.length === 0) {
    console.log('Nothing to insert — every row was rejected or duplicate. See reasons below.')
  } else {
    const values = accepted
      .map((c) => `  ('${sqlEscape(c.text)}', '${c.category}', false, 'approved', 'seed')`)
      .join(',\n')
    const sql = `-- Generated by scripts/import-seed-cards.mjs from ${inputPath}\n` +
      `-- ${accepted.length} cards — review before running.\n\n` +
      `insert into posts (text, category, safety_flag, status, source) values\n${values};\n`

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputPath = outputPathArg || `supabase/seed_import_${stamp}.sql`
    writeFileSync(outputPath, sql, 'utf8')
    console.log(`✓ Wrote ${accepted.length} cards to ${outputPath}`)
  }

  console.log('\nCategory breakdown:')
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > 0) console.log(`  ${cat}: ${count}`)
  }

  if (rejected.length > 0) {
    console.log(`\n${rejected.length} rejected:`)
    const byReason = {}
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] || 0) + 1
    for (const [reason, count] of Object.entries(byReason)) {
      console.log(`  ${count} × ${reason}`)
    }
    console.log('\n(Full rejected list below — re-check anything unexpected.)')
    for (const r of rejected) console.log(`  [${r.reason}] ${r.text.slice(0, 80)}`)
  }
}

main()
