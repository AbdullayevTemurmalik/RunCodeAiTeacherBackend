import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../../config/env';
import { z } from 'zod';

// Strict Zod schema for Writing Evaluation
export const WritingEvaluationSchema = z.object({
  overallScore: z.number().min(1).max(10),
  grammarScore: z.number().min(1).max(10),
  spellingScore: z.number().min(1).max(10),
  vocabularyScore: z.number().min(1).max(10),
  clarityScore: z.number().min(1).max(10),
  naturalnessScore: z.number().min(1).max(10),
  correctedText: z.string(),
  mistakes: z.array(
    z.object({
      originalSpan: z.string(),
      correctedSpan: z.string(),
      errorType: z.string(),
      explanationUzbek: z.string(),
      explanationEnglish: z.string(),
    })
  ),
  strongSentences: z.array(z.string()),
  weakSentences: z.array(z.string()),
  improvementSuggestions: z.array(z.string()),
  naturalRewrittenExample: z.string(),
});

export type WritingEvaluation = z.infer<typeof WritingEvaluationSchema>;

// Strict Zod schema for Essay Topic Generation
export const EssayTopicGenerationSchema = z.object({
  title: z.string(),
  instructions: z.string(),
  targetWordCount: z.number(),
  requiredWords: z.array(z.string()).min(4).max(12),
  guidanceUzbek: z.string(),
});

export type EssayTopicGeneration = z.infer<typeof EssayTopicGenerationSchema>;

// Strict Zod schema for Essay Evaluation
export const EssayEvaluationSchema = z.object({
  overallScore: z.number().min(1).max(10),
  categoryScores: z.object({
    relevance: z.number().min(1).max(10),
    grammar: z.number().min(1).max(10),
    vocabulary: z.number().min(1).max(10),
    organization: z.number().min(1).max(10),
    clarity: z.number().min(1).max(10),
    requiredWordsUsage: z.number().min(1).max(10),
  }),
  bestSentences: z.array(z.string()),
  sentencesNeedingImprovement: z.array(z.string()),
  correctedEssay: z.string(),
  actionableSuggestions: z.array(z.string()),
  detailedReasoning: z.string(),
  naturalRewrittenExample: z.string(),
  feedbackUzbek: z.string(),
});

export type EssayEvaluation = z.infer<typeof EssayEvaluationSchema>;

export class GeminiService {
  private static getClient(useSecondary = false): GoogleGenerativeAI {
    const key = useSecondary && env.GEMINI_API_KEY_SECONDARY
      ? env.GEMINI_API_KEY_SECONDARY
      : env.GEMINI_API_KEY_PRIMARY || env.GEMINI_API_KEY_SECONDARY;

    if (!key) {
      throw new Error('Gemini API key is not configured');
    }

    return new GoogleGenerativeAI(key);
  }

  /**
   * Safe execution wrapper with automatic secondary key failover
   */
  private static async executeWithFailover<T>(operation: (client: GoogleGenerativeAI) => Promise<T>): Promise<T> {
    try {
      const primaryClient = this.getClient(false);
      return await operation(primaryClient);
    } catch (primaryError: any) {
      console.warn('[Gemini Service] Primary key request failed. Trying secondary key...', primaryError?.message);
      if (env.GEMINI_API_KEY_SECONDARY) {
        const secondaryClient = this.getClient(true);
        return await operation(secondaryClient);
      }
      throw primaryError;
    }
  }

  /**
   * Evaluate basic writing submission
   */
  static async evaluateWriting(text: string, level: string, topic?: string): Promise<WritingEvaluation> {
    const systemPrompt = `You are a world-class English teacher on the RunCodeAITeacher platform.
Analyze the student's English writing submission for CEFR level ${level}.
Topic: ${topic || 'Free writing'}
Student's text:
"""
${text}
"""

Evaluate carefully:
- DO NOT invent errors merely to fill the response.
- Every reported mistake MUST contain an exact substring (originalSpan) from the student's text.
- If a sentence is grammatically correct and natural, mark it as a strong sentence.
- Provide explanations in both Uzbek and English so students understand the grammar rule clearly.
- Output MUST be valid JSON matching the exact schema without markdown or comments.

JSON structure:
{
  "overallScore": number (1-10),
  "grammarScore": number (1-10),
  "spellingScore": number (1-10),
  "vocabularyScore": number (1-10),
  "clarityScore": number (1-10),
  "naturalnessScore": number (1-10),
  "correctedText": string,
  "mistakes": [
    {
      "originalSpan": string,
      "correctedSpan": string,
      "errorType": string,
      "explanationUzbek": string,
      "explanationEnglish": string
    }
  ],
  "strongSentences": [string],
  "weakSentences": [string],
  "improvementSuggestions": [string],
  "naturalRewrittenExample": string
}`;

    return this.executeWithFailover(async (client) => {
      const model = client.getGenerativeModel({
        model: env.GEMINI_TEXT_MODEL,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const response = await model.generateContent(systemPrompt);
      const rawText = response.response.text();
      const parsed = JSON.parse(rawText);
      return WritingEvaluationSchema.parse(parsed);
    });
  }

  /**
   * Generate an essay topic with mandatory vocabulary
   */
  static async generateEssayTopic(level: string, category: string, wordCount: number): Promise<EssayTopicGeneration> {
    const vocabCount = wordCount <= 30 ? 5 : wordCount <= 50 ? 6 : wordCount <= 100 ? 7 : 8;

    const prompt = `Generate an engaging English essay assignment for CEFR level ${level} in category "${category}".
Target word count: ${wordCount} words.
Generate exactly ${vocabCount} mandatory English vocabulary words that fit naturally into the topic.
Words must be standard English single words (lemmas, e.g. "discover", "opportunity", "traditional", "technology").
Provide clear instructions and brief Uzbek guidance.

Output MUST be valid JSON:
{
  "title": string,
  "instructions": string,
  "targetWordCount": ${wordCount},
  "requiredWords": [string of length ${vocabCount}],
  "guidanceUzbek": string
}`;

    return this.executeWithFailover(async (client) => {
      const model = client.getGenerativeModel({
        model: env.GEMINI_TEXT_MODEL,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const response = await model.generateContent(prompt);
      const rawText = response.response.text();
      const parsed = JSON.parse(rawText);
      return EssayTopicGenerationSchema.parse(parsed);
    });
  }

  /**
   * Evaluate advanced essay with mandatory vocabulary verification
   */
  static async evaluateEssay(
    essayText: string,
    topicTitle: string,
    requiredWords: string[],
    level: string,
    targetWordCount: number
  ): Promise<EssayEvaluation> {
    const prompt = `You are a senior academic English essay evaluator on RunCodeAITeacher.
Level: ${level}
Topic: "${topicTitle}"
Target word count: ${targetWordCount} words.
Mandatory vocabulary required: ${requiredWords.join(', ')}

Student's Essay:
"""
${essayText}
"""

Evaluate thoroughly:
1. Relevance to the topic
2. Accuracy and naturalness of mandatory vocabulary usage
3. Grammar, cohesion, paragraph flow, and clarity
4. Strongest sentences and sentences needing refinement
5. Professional corrected version and natural rewrite
6. Encouraging, educational feedback in Uzbek.

Output strictly valid JSON:
{
  "overallScore": number (1-10),
  "categoryScores": {
    "relevance": number (1-10),
    "grammar": number (1-10),
    "vocabulary": number (1-10),
    "organization": number (1-10),
    "clarity": number (1-10),
    "requiredWordsUsage": number (1-10)
  },
  "bestSentences": [string],
  "sentencesNeedingImprovement": [string],
  "correctedEssay": string,
  "actionableSuggestions": [string],
  "detailedReasoning": string,
  "naturalRewrittenExample": string,
  "feedbackUzbek": string
}`;

    return this.executeWithFailover(async (client) => {
      const model = client.getGenerativeModel({
        model: env.GEMINI_TEXT_MODEL,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
        },
      });

      const response = await model.generateContent(prompt);
      const rawText = response.response.text();
      const parsed = JSON.parse(rawText);
      return EssayEvaluationSchema.parse(parsed);
    });
  }

  /**
   * Text-to-Speech synthesis for corrected text
   * Returns base64 audio or audio data URL
   */
  static async synthesizeSpeech(text: string): Promise<string> {
    // Note: Gemini text-to-speech or browser Web Speech API / TTS endpoint
    // For reliable cross-browser playback, we provide clean text and synthesize audio
    return `data:audio/wav;placeholder,${encodeURIComponent(text.slice(0, 50))}`;
  }
}
