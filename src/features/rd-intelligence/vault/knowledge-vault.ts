import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  link,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import type {
  Analysis,
  ContentDraft,
  Experiment,
  SourceItem,
} from "../domain/entities.js";
import {
  HYPOTHESIS_SUPPORT_VALUES,
  type HypothesisSupport,
} from "../domain/enums.js";
import type { PracticeEvidence } from "../providers/x-draft-provider.js";

const INPUT_DIRECTORY = "01 - インプット";
const PRACTICE_DIRECTORY = "02 - 実践ログ";
const DRAFT_DIRECTORY = "03 - ポスト下書き";
const ASSET_DIRECTORY = "Assets";
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class VaultBoundaryError extends Error {
  readonly code = "VAULT_BOUNDARY_VIOLATION";
}

export class VaultNoteInvalidError extends Error {
  readonly code = "VAULT_NOTE_INVALID";
}

export class VaultNoteNotFoundError extends Error {
  readonly code = "VAULT_NOTE_NOT_FOUND";
}

export interface VaultNoteReference {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface ParsedNote {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly body: string;
}

export interface ImportedPracticeLog {
  readonly note: VaultNoteReference;
  readonly evidence: PracticeEvidence;
  readonly hypothesisSupport: HypothesisSupport;
}

function normalizedRelativePath(value: string): string {
  if (
    value.trim() === "" ||
    value.includes("\0") ||
    isAbsolute(value)
  ) {
    throw new VaultBoundaryError("Vault path must be relative");
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new VaultBoundaryError("Parent traversal is not allowed");
  }
  return normalized;
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function shortId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]/gu, "");
  return (normalized || "item").slice(0, 10).toLocaleLowerCase("en-US");
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60);
  return normalized || "note";
}

function noteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function frontmatter(
  properties: Readonly<Record<string, unknown>>,
): string {
  return `---\n${stringify(properties, { lineWidth: 0 }).trim()}\n---\n`;
}

function parseNote(content: string): ParsedNote {
  if (!content.startsWith("---\n")) {
    throw new VaultNoteInvalidError("Markdown note has no frontmatter");
  }
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new VaultNoteInvalidError("Markdown frontmatter is not closed");
  }
  let propertiesValue: unknown;
  try {
    propertiesValue = parse(content.slice(4, end));
  } catch {
    throw new VaultNoteInvalidError("Markdown frontmatter is invalid YAML");
  }
  if (
    typeof propertiesValue !== "object" ||
    propertiesValue === null ||
    Array.isArray(propertiesValue)
  ) {
    throw new VaultNoteInvalidError("Markdown frontmatter must be an object");
  }
  return {
    properties: propertiesValue as Readonly<Record<string, unknown>>,
    body: content.slice(end + 5).trim(),
  };
}

function section(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = body.match(
    new RegExp(`^## ${escaped}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "mu"),
  );
  const value = (match?.[1] ?? "").replace(/<!--[\s\S]*?-->/gu, "").trim();
  if (value === "") {
    throw new VaultNoteInvalidError(`Required section is empty: ${heading}`);
  }
  return value;
}

function markdownList(items: readonly string[]): string {
  return items.length === 0 ? "- 未特定" : items.map((item) => `- ${item}`).join("\n");
}

function safeSourceUrl(item: SourceItem): string {
  return item.canonicalUrl ?? "URLなし";
}

function imageMimeType(
  path: string,
): "image/jpeg" | "image/png" | "image/webp" {
  const extension = extname(path).toLocaleLowerCase("en-US");
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  throw new VaultNoteInvalidError("Only PNG, JPEG, and WebP images are allowed");
}

function imageReferences(body: string): readonly string[] {
  const references: string[] = [];
  for (const match of body.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/gu)) {
    const value = match[1]?.trim();
    if (value !== undefined && value !== "") references.push(value);
  }
  for (const match of body.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const value = match[1]?.trim();
    if (value !== undefined && value !== "") references.push(value);
  }
  return [...new Set(references)];
}

export interface KnowledgeVaultOptions {
  readonly vaultPath: string;
  readonly areaPath: string;
  readonly id?: () => string;
}

export class KnowledgeVault {
  private readonly id: () => string;
  private rootPath?: string;
  private areaRoot?: string;

  constructor(private readonly options: KnowledgeVaultOptions) {
    this.id = options.id ?? randomUUID;
    normalizedRelativePath(options.areaPath);
  }

  async readiness(): Promise<{
    readonly available: boolean;
    readonly areaPath: string;
  }> {
    try {
      await this.initialize();
      await access(this.area(), constants.R_OK | constants.W_OK);
      return { available: true, areaPath: this.options.areaPath };
    } catch {
      return { available: false, areaPath: this.options.areaPath };
    }
  }

  async saveInput(
    item: SourceItem,
    analysis: Analysis,
  ): Promise<VaultNoteReference> {
    const existing = await this.findByProperty(
      INPUT_DIRECTORY,
      "jarvis_id",
      item.id,
    );
    if (existing !== undefined) return existing;
    const filename = `${noteDate(analysis.analyzedAt)}-rd-input-${shortId(item.id)}-${slug(item.title)}.md`;
    const relativePath = join(INPUT_DIRECTORY, filename);
    const content = `${frontmatter({
      type: "rd-input",
      status: "new",
      created: analysis.analyzedAt,
      updated: analysis.analyzedAt,
      tags: ["rd-intelligence", "stage/input"],
      jarvis_id: item.id,
      analysis_id: analysis.id,
      source_type: item.sourceType,
      source_url: item.canonicalUrl ?? "",
      source_published_at: item.publishedAt ?? "",
      trial_difficulty: analysis.trialDifficulty,
    })}\n# ${item.title}\n\n## 元情報\n\n- 出典: ${safeSourceUrl(item)}\n- 著者: ${item.author}\n- 公開日時: ${item.publishedAt ?? "不明"}\n\n## 概要\n\n${analysis.summary}\n\n## 試すための難易度\n\n${analysis.trialDifficulty}\n\n## 必要な環境\n\n${markdownList(analysis.requiredEnvironment)}\n\n## 最小の実践手順\n\n${analysis.suggestedFirstExperiment}\n\n## 仮説\n\n${analysis.hypothesis}\n\n## 成功条件\n\n${analysis.successCriteria}\n\n## リスク・注意点\n\n${markdownList(analysis.risksAndLimitations)}\n`;
    return this.writeNew(relativePath, content);
  }

  async createPractice(
    item: SourceItem,
    analysis: Analysis,
    experiment: Experiment,
  ): Promise<VaultNoteReference> {
    const existing = await this.findByProperty(
      PRACTICE_DIRECTORY,
      "experiment_id",
      experiment.id,
    );
    if (existing !== undefined) return existing;
    const input = await this.findByProperty(
      INPUT_DIRECTORY,
      "jarvis_id",
      item.id,
    );
    if (input === undefined) {
      throw new VaultNoteNotFoundError("Input note does not exist");
    }
    const filename = `${noteDate(experiment.createdAt)}-rd-practice-${shortId(experiment.id)}-${slug(experiment.title)}.md`;
    const relativePath = join(PRACTICE_DIRECTORY, filename);
    const content = `${frontmatter({
      type: "rd-practice",
      status: "in_progress",
      created: experiment.createdAt,
      updated: experiment.updatedAt,
      tags: ["rd-intelligence", "stage/practice"],
      jarvis_id: experiment.id,
      experiment_id: experiment.id,
      source_id: item.id,
      source_note: input.relativePath,
      hypothesis_support: "inconclusive",
    })}\n# ${experiment.title}\n\n元情報: [[${input.relativePath.replace(/\.md$/u, "")}]]\n\n## 仮説\n\n${analysis.hypothesis}\n\n## 実施環境\n\n${markdownList(analysis.requiredEnvironment)}\n\n## やったこと\n\n${experiment.smallestFirstStep}\n\n## 結果\n\n<!-- 実行結果を記入してください -->\n\n## エラー・詰まり\n\n<!-- なければ「なし」と記入してください -->\n\n## 気付き\n\n<!-- 再利用できる学びを記入してください -->\n\n## 公開可能な一次体験\n\n<!-- Xへ公開してよい範囲を自分の言葉で記入してください -->\n\n## スクリーンショット\n\n画像は ../Assets/ に保存して埋め込めます。画像がなければ「なし」と記入してください。\n`;
    return this.writeNew(relativePath, content);
  }

  async readPractice(experimentId: string): Promise<ImportedPracticeLog> {
    const note = await this.findByProperty(
      PRACTICE_DIRECTORY,
      "experiment_id",
      experimentId,
    );
    if (note === undefined) {
      throw new VaultNoteNotFoundError("Practice note does not exist");
    }
    const parsed = parseNote(await readFile(note.absolutePath, "utf8"));
    const hypothesisSupportValue = parsed.properties["hypothesis_support"];
    if (
      typeof hypothesisSupportValue !== "string" ||
      !HYPOTHESIS_SUPPORT_VALUES.includes(
        hypothesisSupportValue as HypothesisSupport,
      )
    ) {
      throw new VaultNoteInvalidError(
        "hypothesis_support must be a supported value",
      );
    }
    return {
      note,
      hypothesisSupport: hypothesisSupportValue as HypothesisSupport,
      evidence: {
        environment: section(parsed.body, "実施環境"),
        actions: section(parsed.body, "やったこと"),
        result: section(parsed.body, "結果"),
        errors: section(parsed.body, "エラー・詰まり"),
        learning: section(parsed.body, "気付き"),
        publishableExperience: section(
          parsed.body,
          "公開可能な一次体験",
        ),
        images: await this.readImages(
          note.absolutePath,
          imageReferences(parsed.body),
        ),
      },
    };
  }

  async saveDraft(
    draft: ContentDraft,
    title: string,
    sourceId: string,
    sourceNote: string,
    practiceNote: string,
    text: string,
  ): Promise<VaultNoteReference> {
    const existing = await this.findByProperty(
      DRAFT_DIRECTORY,
      "jarvis_id",
      draft.id,
    );
    if (existing !== undefined) return existing;
    const filename = `${noteDate(draft.generatedAt)}-rd-draft-${shortId(draft.id)}-${slug(title)}.md`;
    const relativePath = join(DRAFT_DIRECTORY, filename);
    const content = `${frontmatter({
      type: "rd-post-draft",
      status: "draft",
      created: draft.generatedAt,
      updated: draft.updatedAt,
      tags: ["rd-intelligence", "stage/draft"],
      jarvis_id: draft.id,
      experiment_id: draft.relatedExperimentId ?? "",
      source_id: sourceId,
      source_note: sourceNote,
      practice_note: practiceNote,
      x_weighted_length: draft.characterCount,
    })}\n# ${title}\n\n## X投稿本文\n\n${text}\n\n## 校閲メモ\n\n- [ ] 事実と自分の解釈を分けた\n- [ ] 実際に試した範囲だけを書いた\n- [ ] 出典URLを含めた\n- [ ] Xの文字数制限内である\n`;
    return this.writeNew(relativePath, content);
  }

  async readDraftText(draftId: string): Promise<{
    readonly note: VaultNoteReference;
    readonly text: string;
  }> {
    const note = await this.findByProperty(
      DRAFT_DIRECTORY,
      "jarvis_id",
      draftId,
    );
    if (note === undefined) {
      throw new VaultNoteNotFoundError("Draft note does not exist");
    }
    const parsed = parseNote(await readFile(note.absolutePath, "utf8"));
    return { note, text: section(parsed.body, "X投稿本文") };
  }

  async findInputForSource(sourceId: string): Promise<VaultNoteReference> {
    const note = await this.findByProperty(
      INPUT_DIRECTORY,
      "jarvis_id",
      sourceId,
    );
    if (note === undefined) {
      throw new VaultNoteNotFoundError("Input note does not exist");
    }
    return note;
  }

  private async initialize(): Promise<void> {
    if (this.rootPath !== undefined && this.areaRoot !== undefined) return;
    const configuredRootStats = await lstat(this.options.vaultPath);
    if (configuredRootStats.isSymbolicLink()) {
      throw new VaultBoundaryError("Vault root must not be a symbolic link");
    }
    const root = await realpath(this.options.vaultPath);
    if (root !== resolve(this.options.vaultPath)) {
      throw new VaultBoundaryError("Vault root path must not contain symbolic links");
    }
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new VaultBoundaryError("Vault root must be a real directory");
    }
    const areaCandidate = resolve(root, normalizedRelativePath(this.options.areaPath));
    const configuredAreaStats = await lstat(areaCandidate);
    if (configuredAreaStats.isSymbolicLink()) {
      throw new VaultBoundaryError("R&D area must not be a symbolic link");
    }
    const area = await realpath(areaCandidate);
    if (area !== areaCandidate) {
      throw new VaultBoundaryError("R&D area path must not contain symbolic links");
    }
    if (!isWithin(root, area)) {
      throw new VaultBoundaryError("R&D area is outside the Vault root");
    }
    const areaStats = await lstat(area);
    if (!areaStats.isDirectory() || areaStats.isSymbolicLink()) {
      throw new VaultBoundaryError("R&D area must be a real directory");
    }
    this.rootPath = root;
    this.areaRoot = area;
  }

  private area(): string {
    if (this.areaRoot === undefined) {
      throw new VaultBoundaryError("Vault is not initialized");
    }
    return this.areaRoot;
  }

  private async resolveExisting(relativePath: string): Promise<string> {
    await this.initialize();
    const candidate = resolve(this.area(), normalizedRelativePath(relativePath));
    const configuredStats = await lstat(candidate);
    if (configuredStats.isSymbolicLink()) {
      throw new VaultBoundaryError("Symbolic links are not allowed");
    }
    const canonical = await realpath(candidate);
    if (canonical !== candidate) {
      throw new VaultBoundaryError("Path must not contain symbolic links");
    }
    if (!isWithin(this.area(), canonical)) {
      throw new VaultBoundaryError("Path escapes the R&D area");
    }
    const stats = await lstat(canonical);
    if (stats.isSymbolicLink()) {
      throw new VaultBoundaryError("Symbolic links are not allowed");
    }
    return canonical;
  }

  private async writeNew(
    relativePath: string,
    content: string,
  ): Promise<VaultNoteReference> {
    await this.initialize();
    const normalized = normalizedRelativePath(relativePath);
    const target = resolve(this.area(), normalized);
    const parent = await realpath(dirname(target));
    if (parent !== dirname(target)) {
      throw new VaultBoundaryError("Write path must not contain symbolic links");
    }
    if (!isWithin(this.area(), parent)) {
      throw new VaultBoundaryError("Write target escapes the R&D area");
    }
    const temporary = join(parent, `.${basename(target)}.${this.id()}.tmp`);
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    try {
      await link(temporary, target);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null
          ? (error as { readonly code?: unknown }).code
          : undefined;
      if (code !== "EEXIST") throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    const absolutePath = await this.resolveExisting(normalized);
    return { absolutePath, relativePath: normalized.replaceAll("\\", "/") };
  }

  private async findByProperty(
    directory: string,
    property: string,
    expected: string,
  ): Promise<VaultNoteReference | undefined> {
    const canonicalDirectory = await this.resolveExisting(directory);
    const entries = await readdir(canonicalDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".md")) {
        continue;
      }
      const relativePath = join(directory, entry.name).replaceAll("\\", "/");
      const absolutePath = await this.resolveExisting(relativePath);
      const parsed = parseNote(await readFile(absolutePath, "utf8"));
      if (parsed.properties[property] === expected) {
        return { absolutePath, relativePath };
      }
    }
    return undefined;
  }

  private async readImages(
    notePath: string,
    references: readonly string[],
  ): Promise<PracticeEvidence["images"]> {
    if (references.length > MAX_IMAGES) {
      throw new VaultNoteInvalidError("At most three screenshots are allowed");
    }
    const images: PracticeEvidence["images"][number][] = [];
    for (const rawReference of references) {
      if (/^(?:https?:|data:|file:)/iu.test(rawReference)) {
        throw new VaultBoundaryError("Remote and absolute image references are not allowed");
      }
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawReference);
      } catch {
        throw new VaultNoteInvalidError("Image reference has invalid encoding");
      }
      const candidates = decoded.includes("/")
        ? [resolve(dirname(notePath), decoded)]
        : [
            resolve(this.area(), ASSET_DIRECTORY, decoded),
            resolve(dirname(notePath), ASSET_DIRECTORY, decoded),
            resolve(dirname(notePath), decoded),
          ];
      let imagePath: string | undefined;
      for (const candidate of candidates) {
        try {
          const configuredStats = await lstat(candidate);
          if (configuredStats.isSymbolicLink()) {
            throw new VaultBoundaryError("Symbolic links are not allowed");
          }
          const canonical = await realpath(candidate);
          if (canonical !== candidate) {
            throw new VaultBoundaryError("Image path must not contain symbolic links");
          }
          if (isWithin(this.area(), canonical)) {
            imagePath = canonical;
            break;
          }
        } catch (error) {
          if (error instanceof VaultBoundaryError) throw error;
          // Try the next deterministic Vault-local location.
        }
      }
      if (imagePath === undefined) {
        throw new VaultNoteInvalidError("Referenced screenshot does not exist");
      }
      const stats = await lstat(imagePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new VaultBoundaryError("Screenshot must be a regular Vault file");
      }
      if (stats.size > MAX_IMAGE_BYTES) {
        throw new VaultNoteInvalidError("Screenshot exceeds 5 MB");
      }
      images.push({
        mimeType: imageMimeType(imagePath),
        base64: (await readFile(imagePath)).toString("base64"),
      });
    }
    return images;
  }
}
