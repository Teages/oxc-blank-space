import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { transplat } from '../src'

describe('typeScript transpilation', () => {
  const srcDir = path.join(__dirname, 'fixture/src')
  const distDir = path.join(__dirname, 'fixture/dist')
  const expectedDir = path.join(__dirname, 'fixture/expected')

  // create dist directory
  fs.mkdirSync(distDir, { recursive: true })

  // Get all TypeScript files from src directory
  const testFiles = fs.readdirSync(srcDir)
    .filter(file => file.endsWith('.ts'))

  testFiles.forEach((file) => {
    it(`should correctly transpile ${file}`, () => {
      const sourcePath = path.join(srcDir, file)
      const expectedPath = path.join(expectedDir, file.replace('.ts', '.js'))

      // Read source and expected files
      const source = fs.readFileSync(sourcePath, 'utf-8')
      const expected = fs.readFileSync(expectedPath, 'utf-8')

      // Transpile the source
      const result = transplat(source)

      // write to dist for debugging
      fs.writeFileSync(path.join(distDir, file.replace('.ts', '.js')), result)

      // Compare the result with expected output
      expect(result).toBe(expected)
    })
  })
})
