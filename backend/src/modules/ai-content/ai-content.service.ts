import { Types, type HydratedDocument } from "mongoose";
import { Product, type ProductDocument } from "../../models/Product.model";
import { AiGeneratedContent } from "../../models/AiGeneratedContent.model";
import { ProductReview } from "../../models/ProductReview.model";
import { Errors } from "../../errors/AppError";
import { generate as aiGenerate } from "../ai/ai.orchestrator";
import { productService } from "../products/product.service";
import { MARKETING_CHANNELS, type MarketingCopyInput } from "./ai-content.validation";

/**
 * Module 6: AI Content Tools (Implementation_Plan.md Phase 4). Every function here is a thin
 * prompt template plus persistence around the AI Orchestrator built for this phase
 * (`../ai/ai.orchestrator.ts`); no new AI infrastructure is added here, per the plan's own
 * note that these tools "reuse the orchestrator and quota system... no new infrastructure,
 * just new prompt templates and thin endpoints".
 *
 * Two different patterns, both meant to satisfy "never silently overwrite merchant data":
 * - The product description has a full draft lifecycle (AiGeneratedContent: draft, edited,
 *   regenerated with a short capped history, then explicitly published into Product.description).
 * - Review summaries, auto-tag and SEO metadata are all simpler: auto-tag and SEO metadata are
 *   pure suggestions, returned but never written to the product at all - the merchant applies
 *   them (or not) through the ordinary product update endpoint, which already accepts the
 *   fields they suggest. The review summary is cached on the product (it is not merchant
 *   content to edit or publish, just an insight), and reports its own staleness instead of
 *   silently regenerating.
 */

// Bumped whenever a prompt below changes in a way that would make an old AiGeneratedContent's
// wording inconsistent with what the tool now produces; stored alongside each generation so a
// stale draft can eventually be told apart from a current one if that is ever needed.
const PROMPT_VERSION = "v1";

/** How many published reviews are fed to the summarizer; the plan calls for "recent" reviews, not the whole history. */
const MAX_REVIEWS_FOR_SUMMARY = 50;
/** How many new published reviews since the cached summary was generated before the admin UI offers regenerating it. */
const STALE_AFTER_NEW_REVIEWS = 5;

function objectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw Errors.notFound("Product");
  return new Types.ObjectId(id);
}

async function requireProduct(storeId: string, productId: string): Promise<HydratedDocument<ProductDocument>> {
  const doc = await Product.findOne({ _id: objectId(productId), storeId });
  if (!doc) throw Errors.notFound("Product");
  return doc;
}

function describeProduct(product: HydratedDocument<ProductDocument>): string {
  const lines = [`Title: ${product.title}`, `Category: ${product.category}`, `Price: ${Number(product.price.toString()).toFixed(2)}`];
  if (product.tags?.length) lines.push(`Tags: ${product.tags.join(", ")}`);
  if (product.description) lines.push(`Current description: ${product.description}`);
  return lines.join("\n");
}

const presentDraft = (doc: { _id: Types.ObjectId; productId: Types.ObjectId; status: string; content: string; model: string; editedByMerchant: boolean }) => ({
  id: doc._id.toString(),
  productId: doc.productId.toString(),
  status: doc.status,
  content: doc.content,
  model: doc.model,
  editedByMerchant: doc.editedByMerchant,
});

const DESCRIPTION_SYSTEM_PROMPT =
  "You write short, honest, appealing e-commerce product descriptions: 2 to 4 sentences, plain prose, " +
  "no headings, no markdown, no invented facts beyond what is given. Reply with only the description text.";

/** Used by both `generate` and `regenerate`: the plan describes them as the same action, the
 *  second time replacing whatever draft exists. If a draft (or a previously published one)
 *  already exists, its current content is pushed onto the capped history first. */
async function runGeneration(storeId: string, productId: string) {
  const product = await requireProduct(storeId, productId);
  const result = await aiGenerate({
    tenantId: storeId,
    promptType: "product_description",
    system: DESCRIPTION_SYSTEM_PROMPT,
    prompt: `Write a product description for this listing:\n${describeProduct(product)}`,
    maxTokens: 400,
  });

  const now = new Date();
  const existing = await AiGeneratedContent.findOne({ storeId, productId: product._id });
  if (existing) {
    const history = [...existing.history, { content: existing.content, generatedAt: existing.generatedAt }].slice(-5);
    existing.set({ status: "draft", content: result.text, model: result.model, promptVersion: PROMPT_VERSION, editedByMerchant: false, generatedAt: now, history });
    existing.publishedAt = undefined;
    await existing.save();
    return presentDraft(existing);
  }

  const doc = await AiGeneratedContent.create({
    storeId,
    productId: product._id,
    status: "draft",
    content: result.text,
    model: result.model,
    promptVersion: PROMPT_VERSION,
    editedByMerchant: false,
    history: [],
    generatedAt: now,
  });
  product.aiDescriptionId = doc._id;
  await product.save();
  return presentDraft(doc);
}

export const aiContentService = {
  generateDescription: (storeId: string, productId: string) => runGeneration(storeId, productId),
  regenerateDescription: (storeId: string, productId: string) => runGeneration(storeId, productId),

  /** The current draft (or last-published content), for reopening a product without spending
   *  a generation just to see what is already there. Null when nothing has ever been generated. */
  async getDraft(storeId: string, productId: string) {
    const pid = objectId(productId);
    const doc = await AiGeneratedContent.findOne({ storeId, productId: pid });
    return doc ? presentDraft(doc) : null;
  },

  /** The merchant editing the draft by hand before publishing; never touches quota. */
  async updateDraft(storeId: string, productId: string, content: string) {
    const pid = objectId(productId);
    const draft = await AiGeneratedContent.findOne({ storeId, productId: pid });
    if (!draft) throw Errors.notFound("AI draft");
    draft.content = content;
    draft.editedByMerchant = true;
    await draft.save();
    return presentDraft(draft);
  },

  /** Copies the current draft into the product's live description. */
  async publishDescription(storeId: string, productId: string) {
    const pid = objectId(productId);
    const draft = await AiGeneratedContent.findOne({ storeId, productId: pid });
    if (!draft) throw Errors.notFound("AI draft");
    draft.status = "published";
    draft.publishedAt = new Date();
    await draft.save();
    await Product.updateOne({ _id: pid, storeId }, { description: draft.content });
    return productService.get(storeId, productId);
  },

  /** The cached summary plus whether enough new reviews have arrived to offer regenerating it. Free: never calls the AI. */
  async getReviewSummary(storeId: string, productId: string) {
    const product = await requireProduct(storeId, productId);
    const currentReviewCount = await ProductReview.countDocuments({ storeId, productId: product._id, status: "published" });
    const cached = product.reviewSummary;
    return {
      summary: cached
        ? { text: cached.text, model: cached.model, generatedAt: cached.generatedAt, reviewCountAtGeneration: cached.reviewCountAtGeneration }
        : null,
      currentReviewCount,
      stale: cached ? currentReviewCount - cached.reviewCountAtGeneration >= STALE_AFTER_NEW_REVIEWS : false,
    };
  },

  /** Generates a fresh summary from the most recent published reviews and caches it on the product. */
  async summarizeReviews(storeId: string, productId: string) {
    const product = await requireProduct(storeId, productId);
    const totalPublished = await ProductReview.countDocuments({ storeId, productId: product._id, status: "published" });
    if (totalPublished === 0) throw Errors.validation("This product has no published reviews to summarize yet.");

    const reviews = await ProductReview.find({ storeId, productId: product._id, status: "published" })
      .sort({ createdAt: -1 })
      .limit(MAX_REVIEWS_FOR_SUMMARY)
      .select("rating title comment");
    const body = reviews
      .map((r, i) => `${i + 1}. ${r.rating}/5${r.title ? ` "${r.title}"` : ""}: ${r.comment ?? "(no written comment)"}`)
      .join("\n");

    const result = await aiGenerate({
      tenantId: storeId,
      promptType: "review_summary",
      system:
        "You summarize customer reviews for the merchant selling this product, in 2 to 4 short sentences: common " +
        "praise, common complaints, and anything actionable. Plain prose, no headings, no markdown, no claims beyond " +
        "what reviewers actually wrote.",
      prompt: `Reviews of "${product.title}":\n${body}`,
      maxTokens: 300,
    });

    const reviewSummary = { text: result.text, model: result.model, generatedAt: new Date(), reviewCountAtGeneration: totalPublished };
    await Product.updateOne({ _id: product._id, storeId }, { reviewSummary });
    return { summary: reviewSummary, currentReviewCount: totalPublished, stale: false };
  },

  /** A category + tag suggestion. Returned only; saving it is the merchant's own product-form save. */
  async autoTag(storeId: string, productId: string) {
    const product = await requireProduct(storeId, productId);
    const result = await aiGenerate({
      tenantId: storeId,
      promptType: "auto_tag",
      system:
        "Suggest a single short category and 3 to 6 short tags for this product, based only on the title and " +
        "description given. Reply with EXACTLY two lines and nothing else, in this exact format:\n" +
        "Category: <category>\nTags: <tag1>, <tag2>, <tag3>",
      prompt: `Title: ${product.title}\nDescription: ${product.description || "(none given)"}\nCurrent category: ${product.category}`,
      maxTokens: 100,
    });
    return parseAutoTag(result.text);
  },

  /** A meta title/description suggestion. Returned only, same "suggest, don't overwrite" rule as auto-tag. */
  async generateSeoMetadata(storeId: string, productId: string) {
    const product = await requireProduct(storeId, productId);
    const result = await aiGenerate({
      tenantId: storeId,
      promptType: "seo_metadata",
      system:
        "Write an SEO meta title (under 70 characters) and meta description (under 160 characters) for this " +
        "product's storefront page. Reply with EXACTLY two lines and nothing else, in this exact format:\n" +
        "Title: <meta title>\nDescription: <meta description>",
      prompt: `Product: ${product.title}\nCategory: ${product.category}\nDescription: ${product.description || "(none given)"}`,
      maxTokens: 150,
    });
    return parseSeoMetadata(result.text);
  },

  /**
   * Promotional text for one channel (a social post, an email, or short ad headlines) in a chosen
   * tone. Returned only, like auto-tag and SEO metadata: nothing is stored, the merchant copies
   * or edits it. The model is told to use only the product facts and the merchant's own
   * `notes` for any offer, because inventing a discount or a claim in advertising text is the
   * failure that would actually cost a merchant something.
   */
  async generateMarketingCopy(storeId: string, productId: string, input: MarketingCopyInput) {
    const product = await requireProduct(storeId, productId);
    const spec = MARKETING_SPECS[input.channel];
    const result = await aiGenerate({
      tenantId: storeId,
      promptType: "marketing_copy",
      system:
        `You write ${spec.what} for an online store. Tone: ${input.tone}. ${spec.format} ` +
        "Use only the product facts and offer details given below. Never invent a discount, price, " +
        "shipping promise, stock level, review or claim that is not given. Plain text, no markdown.",
      prompt:
        `${describeProduct(product)}\n` +
        (input.notes ? `Offer details from the merchant: ${input.notes}` : "Offer details from the merchant: none (do not mention any offer)."),
      maxTokens: spec.maxTokens,
    });
    return { channel: input.channel, tone: input.tone, text: spec.parse(result.text) };
  },
};

const MARKETING_SPECS: Record<
  (typeof MARKETING_CHANNELS)[number],
  { what: string; format: string; maxTokens: number; parse: (text: string) => string }
> = {
  social_post: {
    what: "a short social media post (Instagram or Facebook style)",
    format: "2 to 4 sentences, then 2 or 3 relevant hashtags on a final line. Reply with only the post.",
    maxTokens: 250,
    parse: (text) => cleanCopy(text, 800),
  },
  email: {
    what: "a short promotional email",
    format:
      "Reply in exactly this format: a first line 'Subject: <subject under 60 characters>', a blank line, then " +
      "a body of 3 to 5 short sentences ending with a call to action.",
    maxTokens: 350,
    parse: (text) => {
      const cleaned = cleanCopy(text, 1500);
      if (!/^Subject:\s*\S/i.test(cleaned)) throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
      return cleaned;
    },
  },
  ad_headlines: {
    what: "three alternative advertising headlines",
    format: "Each under 30 characters. Reply with exactly three lines, one headline per line, nothing else.",
    maxTokens: 100,
    parse: (text) => {
      const lines = text
        .split("\n")
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["']|["']$/g, "").trim())
        .filter(Boolean)
        .slice(0, 3);
      if (lines.length === 0) throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
      return lines.join("\n");
    },
  },
};

/** Trims the reply, drops markdown emphasis the prompt asked not to use (but keeps # for hashtags), and caps its length. */
function cleanCopy(text: string, max: number): string {
  const cleaned = text.replace(/[*`]+/g, "").trim();
  if (!cleaned) throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
  return cleaned.slice(0, max);
}

/** The prompts above ask for a strict two-line reply so it can be parsed without a structured-output
 *  API feature; a model that does not follow the format is treated as a (retryable) service failure
 *  rather than silently saving garbage. */
function parseAutoTag(text: string): { category: string; tags: string[] } {
  const categoryMatch = text.match(/Category:\s*(.+)/i);
  const tagsMatch = text.match(/Tags:\s*(.+)/i);
  if (!categoryMatch || !tagsMatch) {
    throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
  }
  const category = categoryMatch[1].trim().split("\n")[0].slice(0, 100);
  const tags = tagsMatch[1]
    .trim()
    .split("\n")[0]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((t) => t.slice(0, 30));
  if (!category || tags.length === 0) throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
  return { category, tags };
}

function parseSeoMetadata(text: string): { seoTitle: string; seoDescription: string } {
  const titleMatch = text.match(/Title:\s*(.+)/i);
  const descriptionMatch = text.match(/Description:\s*(.+)/i);
  if (!titleMatch || !descriptionMatch) {
    throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
  }
  const seoTitle = titleMatch[1].trim().split("\n")[0].slice(0, 70);
  const seoDescription = descriptionMatch[1].trim().split("\n")[0].slice(0, 160);
  if (!seoTitle || !seoDescription) throw Errors.serviceUnavailable("The AI's suggestion could not be understood; please try again.");
  return { seoTitle, seoDescription };
}
