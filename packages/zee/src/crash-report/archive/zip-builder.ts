/**
 * @file ZIP Builder
 * @description Creates ZIP archives for crash reports
 */

import * as fs from "fs"
import * as path from "path"
import * as tar from "tar"

/**
 * Simple ZIP-like archive builder (TAR.GZ format for simplicity)
 * For a real ZIP, you'd use the 'archiver' package
 */
export class ZipBuilder {
  private files: Array<{ archivePath: string; content: string | Buffer }> = []
  private outputPath: string

  constructor(outputPath: string) {
    this.outputPath = outputPath
  }

  /**
   * Add JSON data to the archive
   */
  addJson(archivePath: string, data: unknown): void {
    this.files.push({
      archivePath,
      content: JSON.stringify(data, null, 2),
    })
  }

  /**
   * Add text content to the archive
   */
  addText(archivePath: string, content: string): void {
    this.files.push({
      archivePath,
      content,
    })
  }

  /**
   * Add a file from the filesystem
   */
  async addFile(archivePath: string, sourcePath: string): Promise<void> {
    try {
      const content = await fs.promises.readFile(sourcePath)
      this.files.push({ archivePath, content })
    } catch {
      // File doesn't exist, skip
    }
  }

  /**
   * Get list of files in the archive
   */
  getFileList(): string[] {
    return this.files.map((f) => f.archivePath)
  }

  /**
   * Finalize and write the archive
   * Creates a directory structure with the files (simpler than actual ZIP)
   */
  async finalize(): Promise<string> {
    // Create output directory
    const outputDir = this.outputPath.replace(/\.(zip|tar\.gz)$/, "")
    await fs.promises.mkdir(outputDir, { recursive: true })

    // Write all files
    for (const file of this.files) {
      const filePath = path.join(outputDir, file.archivePath)
      const dir = path.dirname(filePath)
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(filePath, file.content)
    }

    // Create tar.gz of the directory
    const tarPath = `${outputDir}.tar.gz`
    await this.createTarGz(outputDir, tarPath)

    // Clean up directory
    await fs.promises.rm(outputDir, { recursive: true })

    return tarPath
  }

  private async createTarGz(sourceDir: string, outputPath: string): Promise<void> {
    const parentDir = path.dirname(sourceDir)
    const dirName = path.basename(sourceDir)

    try {
      await tar.c({ cwd: parentDir, file: outputPath, gzip: true }, [dirName])
    } catch (error) {
      // Fallback: just keep the directory
      throw new Error(`Failed to create archive: ${String(error)}`)
    }
  }
}
