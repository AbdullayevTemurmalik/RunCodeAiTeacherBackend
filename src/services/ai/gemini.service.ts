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

// Strict Zod schema for Live Writing Check
export const LiveCheckWritingSchema = z.object({
  errors: z.array(
    z.object({
      originalSpan: z.string(),
      replacement: z.string(),
      errorType: z.string(),
      explanationUzbek: z.string(),
      explanationEnglish: z.string(),
      grammarRule: z.string().optional(),
    })
  ),
  verifiedSentences: z.array(z.string()),
  overallStatus: z.string(),
});

export type LiveCheckWriting = z.infer<typeof LiveCheckWritingSchema>;

// Strict Zod schema for Essay Topic Generation with Words & Phrases
export const EssayTopicGenerationSchema = z.object({
  title: z.string(),
  instructions: z.string(),
  targetWordCount: z.number(),
  requiredWords: z.array(z.string()).min(4).max(16),
  requiredPhrases: z.array(z.string()).min(1).max(6),
  guidanceUzbek: z.string(),
});

export type EssayTopicGeneration = z.infer<typeof EssayTopicGenerationSchema>;

// Sentence analysis for post-submission Red/Green viewer
export const EssaySentenceAnalysisSchema = z.object({
  original: z.string(),
  isCorrect: z.boolean(),
  status: z.enum(['CORRECT', 'ERROR', 'SUGGESTION']),
  corrected: z.string().optional(),
  explanationUzbek: z.string().optional(),
  explanationEnglish: z.string().optional(),
  grammarRule: z.string().optional(),
});

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
  sentences: z.array(EssaySentenceAnalysisSchema).optional(),
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
   * Real-time live grammar & spelling check for Writing Page (as student types)
   */
  static async liveCheckWriting(text: string, level = 'B2', topic?: string): Promise<LiveCheckWriting> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { errors: [], verifiedSentences: [], overallStatus: 'EMPTY' };
    }

    const systemPrompt = `You are a real-time English writing assistant on RunCodeAITeacher.
Analyze the following text written by a CEFR ${level} student.
Topic: ${topic || 'General writing'}

Student Text:
"""
${trimmed}
"""

TASK:
1. Detect confirmed spelling and grammar errors.
2. For each error, provide:
   - "originalSpan": the exact substring from the text that has the error.
   - "replacement": the correct replacement word or phrase.
   - "errorType": e.g. "Spelling", "Subject-Verb Agreement", "Verb Tense", "Preposition".
   - "explanationUzbek": brief explanation in Uzbek why it is incorrect.
   - "explanationEnglish": brief explanation in English.
   - "grammarRule": the applicable rule.
3. List sentences that are confidently verified as correct in "verifiedSentences".
4. Do NOT mark incomplete sentences as errors.
5. Do NOT invent errors.

Output strictly valid JSON:
{
  "errors": [
    {
      "originalSpan": string,
      "replacement": string,
      "errorType": string,
      "explanationUzbek": string,
      "explanationEnglish": string,
      "grammarRule": string
    }
  ],
  "verifiedSentences": [string],
  "overallStatus": "ANALYZED"
}`;

    return this.executeWithFailover(async (client) => {
      const model = client.getGenerativeModel({
        model: env.GEMINI_TEXT_MODEL,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const response = await model.generateContent(systemPrompt);
      const rawText = response.response.text();
      const parsed = JSON.parse(rawText);
      return LiveCheckWritingSchema.parse(parsed);
    });
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
   * Generate an essay topic with mandatory vocabulary AND 2-3 word phrases based on target length
   */
  static async generateEssayTopic(level: string, category: string, wordCount: number): Promise<EssayTopicGeneration> {
    // Length table rules:
    // 30: 4-5 words, 1 phrase
    // 40: 5 words, 1 phrase
    // 50: 5-6 words, 1-2 phrases
    // 100: 7-8 words, 2 phrases
    // 150: 8-10 words, 3 phrases
    // 200: 10-12 words, 3-4 phrases
    // 250: 12-14 words, 4 phrases
    // 250+: 12-16 words, 4-6 phrases
    let wordsCount = 5;
    let phrasesCount = 1;

    if (wordCount <= 30) {
      wordsCount = 5;
      phrasesCount = 1;
    } else if (wordCount <= 40) {
      wordsCount = 5;
      phrasesCount = 1;
    } else if (wordCount <= 50) {
      wordsCount = 6;
      phrasesCount = 2;
    } else if (wordCount <= 100) {
      wordsCount = 8;
      phrasesCount = 2;
    } else if (wordCount <= 150) {
      wordsCount = 10;
      phrasesCount = 3;
    } else if (wordCount <= 200) {
      wordsCount = 12;
      phrasesCount = 3;
    } else {
      wordsCount = 14;
      phrasesCount = 4;
    }

    const prompt = `Generate an engaging English essay assignment for CEFR level ${level} in category "${category}".
Target word count: ${wordCount} words.
1. Generate exactly ${wordsCount} mandatory single English words that are natural for this topic (e.g. "benefit", "challenge", "improve", "environment").
2. Generate exactly ${phrasesCount} mandatory natural 2-word or 3-word English phrases (e.g. "free time", "in my opinion", "take care of", "every day", "hard work").
3. Provide clear instructions and brief Uzbek guidance.

Output strictly valid JSON:
{
  "title": string,
  "instructions": string,
  "targetWordCount": ${wordCount},
  "requiredWords": [array of ${wordsCount} single words],
  "requiredPhrases": [array of ${phrasesCount} 2-to-3 word phrases],
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
   * Evaluate advanced essay with sentence-level Red/Green annotations and mandatory vocabulary review
   */
  static async evaluateEssay(
    essayText: string,
    topicTitle: string,
    requiredWords: string[],
    requiredPhrases: string[],
    level: string,
    targetWordCount: number
  ): Promise<EssayEvaluation> {
    const prompt = `You are a senior academic English essay evaluator on RunCodeAITeacher.
Level: ${level}
Topic: "${topicTitle}"
Target word count: ${targetWordCount} words.
Mandatory single words required: ${requiredWords.join(', ')}
Mandatory 2-3 word phrases required: ${requiredPhrases.join(', ')}

Student's Essay:
"""
${essayText}
"""

EVALUATION INSTRUCTIONS:
1. Break down the student's essay into individual sentences and analyze each sentence:
   - "original": original sentence text.
   - "isCorrect": true if grammatically and syntactically correct, false if it contains an error.
   - "status": "CORRECT" for correct sentences, "ERROR" for confirmed grammar/spelling errors, "SUGGESTION" for stylistic tips.
   - "corrected": polished correct version of the sentence.
   - "explanationUzbek": explanation in Uzbek of the grammar rule or reason.
   - "explanationEnglish": explanation in English.
   - "grammarRule": the specific grammar rule.
2. Calculate overallScore (1-10) and categoryScores (1-10) adapted for CEFR level ${level}.
3. Provide model high-scoring essay (correctedEssay) and inspiring feedback in Uzbek.

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
  "sentences": [
    {
      "original": string,
      "isCorrect": boolean,
      "status": "CORRECT" | "ERROR" | "SUGGESTION",
      "corrected": string,
      "explanationUzbek": string,
      "explanationEnglish": string,
      "grammarRule": string
    }
  ],
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
   */
  static async synthesizeSpeech(text: string): Promise<string> {
    return `data:audio/wav;placeholder,${encodeURIComponent(text.slice(0, 50))}`;
  }
}
